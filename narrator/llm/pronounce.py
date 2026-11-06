"""Context-aware Hebrew pronunciation ("which word is it really?").

Unvowelled Hebrew has many homographs: שמן = שֶׁמֶן (oil, fat) or שְׁמָן (their name),
ספר = סֵפֶר (book) / סַפָּר (barber) / סָפַר (counted).  A voice that reads word by word
picks the most frequent reading.  A language model that sees the whole sentence picks
the right one.

This module asks Google's Gemini *text* model (a much larger free allowance than its
voice) to return vowel marks (niqqud) for the ambiguous words of a passage only.  The
displayed text is never changed; only the string handed to the voice is.

* Needs the Gemini API key (free, same key as the Gemini voices).
* Results are cached on disk per passage, so each passage is asked once.
* Every answer is validated: stripped of vowel marks it must equal the original word;
  anything else is ignored.  On any failure the passage is simply read as before.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import time
from typing import Dict, List, Optional, Tuple

import httpx

log = logging.getLogger(__name__)

API = "https://generativelanguage.googleapis.com/v1beta"
PROMPT_VERSION = "p5"
BATCH = 12  # passages per request: a small free daily request allowance then covers hundreds of passages
MIN_INTERVAL = 4.2  # seconds between requests to the same model: stays under the free tier's ~15 requests/minute
BUDGET = 25.0       # seconds one passage group may spend asking before the app reads normally instead
MAX_MODELS = 4      # models tried per request before giving up

NIQQUD = re.compile("[֑-ׇ]")  # cantillation + vowel points + dots
HEB_WORD = re.compile("[א-ת][א-תְ-ׇ֑-֯\"'׳״]*")
HAS_NIQQUD = re.compile("[ְ-ּׁׂ]")

SYSTEM = (
    "You are an expert in Modern Israeli Hebrew grammar and pronunciation. You receive several Hebrew passages; each has "
    "its words numbered from 0, and may have 'before' and 'after' (neighbouring text, for context only: never return "
    "words from them). Some Hebrew words are written the same but pronounced differently, for example "
    "שמן = שֶׁמֶן (oil), שָׁמֵן (fat, adjective) or שְׁמָן (their [feminine plural] name); ספר = סֵפֶר (book), סַפָּר (barber) "
    "or סָפַר (he counted / told); הספר = הַסֵּפֶר (the book) or הַסַּפָּר (the barber); מלך = מֶלֶךְ or מָלַךְ; "
    "כלל = כְּלָל or כָּלַל; הקפה = הַקָּפֶה or הֶקֵּף. "
    "For every word that is ambiguous without vowel marks, reason like a careful grammarian: its part of speech; gender "
    "and number agreement with nearby words; what it is followed by (a noun followed by 'של' is often a possessive "
    "noun such as 'their name of'; a possessive suffix refers back to a preceding plural noun, e.g. feminine plural "
    "'חוברות' pairs with the feminine plural suffix ן); and, above all, which reading makes sense in the sentence "
    "(reject readings that give nonsense such as 'oil of booklets'). "
    "Return for each ambiguous word an object {\"c\": [candidate readings, fully vowelled with niqqud: vowels, dagesh, "
    "shin/sin dot, including prefix letters; the most plausible FIRST, at most 3], \"g\": [a 1-3 word English gloss for each "
    "candidate], \"why\": \"at most 12 words\"}. The first candidate is your final decision. "
    "Do NOT include words that have only one natural reading, numbers, abbreviations or non-Hebrew words. Never change, add "
    "or remove letters; only add vowel marks. "
    "Reply with a JSON object whose keys are the passage numbers (as strings); each value is an object whose keys are word "
    "numbers (as strings) and whose values are those objects, or {} if no word in the passage is ambiguous."
)
EXAMPLES = [
    ("החוברות יצאו לאור, ושמן הוא מקראות ישראל",
     {"3": {"c": ["וּשְׁמָן", "וְשֶׁמֶן"], "g": ["and their name", "and oil"], "why": "refers back to feminine plural booklets"}}),
    ("הספר במספרה ספר את הכסף בקפידה",
     {"0": {"c": ["הַסַּפָּר", "הַסֵּפֶר"], "g": ["the barber", "the book"], "why": "he is in a barbershop and counts money"},
      "2": {"c": ["סָפַר", "סֵפֶר"], "g": ["counted", "book"], "why": "verb with an object"}}),
    ("שמן זית משובח הוא תוספת מצוינת לסלט",
     {"0": {"c": ["שֶׁמֶן", "שָׁמֵן"], "g": ["oil", "fat"], "why": "olive oil"}}),
]
SUGGEST_SYSTEM = (
    "You are an expert in Modern Israeli Hebrew pronunciation. Given a Hebrew passage and one word from it, list every "
    "common way that written word can be read, each fully vowelled with niqqud (including prefix letters), with a 1-3 "
    "word English gloss, and mark which one fits this passage. Never change the letters. Reply with JSON: "
    "{\"readings\": [{\"v\": \"vowelled word\", \"g\": \"gloss\", \"fits\": true|false}]} ordered with the best fit first."
)


class PronounceError(Exception):
    def __init__(self, message: str, quota: bool = False):
        super().__init__(message)
        self.quota = quota


def strip_marks(s: str) -> str:
    return NIQQUD.sub("", s)


def hebrew_words(text: str) -> List[Tuple[int, int, str]]:
    """(start, end, word) of every Hebrew word that has no vowel marks yet."""
    out = []
    for m in HEB_WORD.finditer(text):
        w = m.group(0)
        if HAS_NIQQUD.search(w):
            continue
        core = strip_marks(w)
        if len(core.strip("\"'׳״")) < 2:
            continue
        out.append((m.start(), m.end(), w))
    return out


def _numbered(words: List[Tuple[int, int, str]]) -> dict:
    return {str(i): w for i, (_, _, w) in enumerate(words)}


def build_user_message(items) -> str:
    """items: [(text, words, before, after)] (before/after optional)."""
    def entry(text, words, before="", after=""):
        d = {"passage": text, "words": _numbered(words)}
        if before:
            d["before"] = before
        if after:
            d["after"] = after
        return d

    ex_in = {str(i): entry(t, hebrew_words(t)) for i, (t, _) in enumerate(EXAMPLES)}
    ex_out = {str(i): a for i, (_, a) in enumerate(EXAMPLES)}
    real = {}
    for i, it in enumerate(items):
        t, w = it[0], it[1]
        real[str(i)] = entry(t, w, it[2] if len(it) > 2 else "", it[3] if len(it) > 3 else "")
    dump = lambda o: json.dumps(o, ensure_ascii=False)  # noqa: E731
    return f"Example input:\n{dump(ex_in)}\nExample answer:\n{dump(ex_out)}\n\nReal input:\n{dump(real)}\nAnswer:"


def validate(answer: object, words: List[Tuple[int, int, str]]) -> Dict[int, str]:
    """Keep only answers that are the same word with vowel marks added."""
    ok: Dict[int, str] = {}
    if not isinstance(answer, dict):
        return ok
    for k, v in answer.items():
        try:
            i = int(k)
        except (TypeError, ValueError):
            continue
        if not (0 <= i < len(words)) or not isinstance(v, str):
            continue
        orig = words[i][2]
        v = v.strip()
        if strip_marks(v) != strip_marks(orig) or not HAS_NIQQUD.search(v):
            continue
        ok[i] = v
    return ok


def validate_details(answer: object, words: List[Tuple[int, int, str]]) -> Dict[int, dict]:
    """{index: {"c": [vowelled candidates], "g": [glosses], "why": str}}; the first candidate is the decision.
    Accepts only candidates that are the same word with vowel marks added."""
    out: Dict[int, dict] = {}
    if not isinstance(answer, dict):
        return out
    for k, v in answer.items():
        try:
            i = int(k)
        except (TypeError, ValueError):
            continue
        if not (0 <= i < len(words)):
            continue
        if isinstance(v, str):  # plain "word -> vowelled" answers are fine too
            v = {"c": [v], "g": [], "why": ""}
        if not isinstance(v, dict) or not isinstance(v.get("c"), list):
            continue
        orig = strip_marks(words[i][2])
        cands, gloss = [], []
        raw_g = v.get("g") if isinstance(v.get("g"), list) else []
        for j, c in enumerate(v["c"]):
            if isinstance(c, str) and strip_marks(c.strip()) == orig and HAS_NIQQUD.search(c) and c.strip() not in cands:
                cands.append(c.strip())
                gloss.append(str(raw_g[j]) if j < len(raw_g) else "")
        if cands:
            out[i] = {"c": cands[:3], "g": gloss[:3], "why": str(v.get("why", ""))[:160]}
    return out


def apply(text: str, words: List[Tuple[int, int, str]], chosen: Dict[int, str],
          tokens: List[Tuple[int, int, int, int]]):
    """Substitute vowelled words into `text`; keep token character ranges in step."""
    edits = sorted((words[i][0], words[i][1], v) for i, v in chosen.items())
    out, last, shift_at = [], 0, []  # shift_at: (old_end, cumulative_delta)
    delta = 0
    for s, e, v in edits:
        out.append(text[last:s])
        out.append(v)
        delta += len(v) - (e - s)
        shift_at.append((e, delta))
        last = e
    out.append(text[last:])

    def shift(pos: int) -> int:
        d = 0
        for end, cum in shift_at:
            if end <= pos:
                d = cum
            else:
                break
        return pos + d

    new_tokens = [(shift(s), shift(e), a, b) for s, e, a, b in tokens]
    return "".join(out), new_tokens


class Vocalizer:
    """Asks Gemini's text model for vowel marks on ambiguous words of a passage."""

    def __init__(self, cache_dir: str, transport: Optional[httpx.AsyncBaseTransport] = None):
        self.cache_dir = cache_dir
        os.makedirs(cache_dir, exist_ok=True)
        self.transport = transport
        self.key: Optional[str] = None
        self.model_pref = ""
        self.cooldown_until = 0.0
        self.cool_message = ""
        self.cool_quota = False
        self._gate: Optional[asyncio.Lock] = None  # created lazily inside the running loop
        self._next_by_model: Dict[str, float] = {}
        self._models: List[str] = []
        self._blocked: Dict[str, float] = {}
        self.working_model: Optional[str] = None
        self.stats = {"asked": 0, "cached": 0, "words": 0, "failed": 0}

    def configure(self, key: Optional[str], model: str = "") -> None:
        key = (key or "").strip() or None
        if key != self.key or model != self.model_pref:
            self._models, self._blocked, self.cooldown_until = [], {}, 0.0
        self.key, self.model_pref = key, model.strip()

    def available(self) -> bool:
        return bool(self.key) and time.time() >= self.cooldown_until

    def _cache_path(self, text: str) -> str:
        h = hashlib.sha256((PROMPT_VERSION + "\n" + text).encode("utf-8")).hexdigest()[:40]
        return os.path.join(self.cache_dir, h + ".json")

    def _read_cache(self, text: str, words) -> Optional[Dict[int, dict]]:
        path = self._cache_path(text)
        if not os.path.exists(path):
            return None
        try:
            with open(path, encoding="utf-8") as fh:
                raw = json.load(fh)
            self.stats["cached"] += 1
            return validate_details(raw, words)
        except Exception:
            return None

    def _write_cache(self, text: str, details: Dict[int, dict]) -> None:
        path = self._cache_path(text)
        try:
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump({str(k): v for k, v in details.items()}, fh, ensure_ascii=False)
            os.replace(tmp, path)
        except OSError:
            pass

    async def vocalize_many(self, texts: List[str], contexts: Optional[List[Tuple[str, str]]] = None):
        """-> [(words, chosen {index: vowelled}, from_cache, details)] aligned with `texts`.  Passages not yet
        remembered are asked together in as few requests as possible (`contexts[i]` = text before/after, for
        understanding only).  Raises PronounceError when they cannot be asked."""
        out: list = [None] * len(texts)
        missing: List[int] = []
        for i, t in enumerate(texts):
            words = hebrew_words(t)
            if not words:
                out[i] = (words, {}, True, {})
                continue
            cached = self._read_cache(t, words)
            if cached is not None:
                out[i] = (words, {k: d["c"][0] for k, d in cached.items()}, True, cached)
            else:
                out[i] = (words, {}, False, {})
                missing.append(i)
        if not missing:
            return out
        if not self.key:
            raise PronounceError("no Gemini key")
        if time.time() < self.cooldown_until:
            raise PronounceError(self.cool_message or "cooling down", quota=self.cool_quota)
        unique: Dict[str, int] = {}
        for i in missing:
            unique.setdefault(texts[i], i)
        order = list(unique)
        answers: Dict[str, Dict[int, dict]] = {}
        for g in range(0, len(order), BATCH):
            group = order[g:g + BATCH]
            items = []
            for t in group:
                ctx = contexts[unique[t]] if contexts else ("", "")
                items.append((t, out[unique[t]][0], ctx[0], ctx[1]))
            try:
                reply = await self._ask(items)
            except PronounceError as exc:
                # do not make every following passage wait for the same failure
                self.cooldown_until = max(self.cooldown_until, time.time() + (300 if exc.quota else 60))
                self.cool_message, self.cool_quota = str(exc), exc.quota
                raise
            self.stats["asked"] += 1
            for j, it in enumerate(items):
                t, words = it[0], it[1]
                details = validate_details(reply.get(str(j)) if isinstance(reply, dict) else None, words)
                answers[t] = details
                self.stats["words"] += len(details)
                self._write_cache(t, details)
        for i in missing:
            d = answers.get(texts[i], {})
            out[i] = (out[i][0], {k: v["c"][0] for k, v in d.items()}, False, d)
        return out

    async def vocalize(self, text: str):
        return (await self.vocalize_many([text]))[0]

    async def suggest(self, passage: str, word: str) -> List[dict]:
        """All common readings of `word` in `passage`: [{"v", "g", "fits"}] (best fit first).  Cached."""
        if not self.key:
            raise PronounceError("no Gemini key")
        key = hashlib.sha256((PROMPT_VERSION + "S\n" + passage + "\n" + word).encode("utf-8")).hexdigest()[:40]
        path = os.path.join(self.cache_dir, "s_" + key + ".json")
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as fh:
                    return json.load(fh)
            except Exception:
                pass
        if time.time() < self.cooldown_until:
            raise PronounceError(self.cool_message or "cooling down", quota=self.cool_quota)
        reply = await self._ask_raw(SUGGEST_SYSTEM, json.dumps({"passage": passage, "word": word}, ensure_ascii=False))
        out, seen = [], set()
        target = strip_marks(word)
        for r in (reply.get("readings") if isinstance(reply, dict) else None) or []:
            v = str(r.get("v", "")).strip() if isinstance(r, dict) else ""
            if v and strip_marks(v) == target and HAS_NIQQUD.search(v) and v not in seen:
                seen.add(v)
                out.append({"v": v, "g": str(r.get("g", ""))[:60], "fits": bool(r.get("fits"))})
        try:
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(out, fh, ensure_ascii=False)
        except OSError:
            pass
        return out

    # ------------------------------------------------------------- service
    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=25, transport=self.transport, headers={"x-goog-api-key": self.key or ""})

    @staticmethod
    def rank_model(name: str):
        """Newest, most accurate, free-friendly first: the alias for the current flash model, then flash by
        version (newest first), then flash-lite, then the rest.  Google renames models often, so nothing is
        hard-coded except these preferences."""
        if name == "gemini-flash-latest":
            return (0, 0.0, name)
        m = re.match(r"gemini-(\d+(?:\.\d+)?)-(.+)$", name)
        ver = float(m.group(1)) if m else 0.0
        rest = m.group(2) if m else name
        family = 1 if rest == "flash" else 2 if rest == "flash-lite" else 3 if rest.startswith("flash") else 4 if "pro" in rest else 5
        if name == "gemini-flash-lite-latest":
            return (2, 0.0, name)
        return (family, -ver, name)

    async def _model_order(self) -> List[str]:
        if self.model_pref:
            return [self.model_pref]
        if self._models:
            return self._models
        names: List[str] = []
        try:
            async with self._client() as c:
                r = await c.get(f"{API}/models", params={"pageSize": 200})
                if r.status_code == 200:
                    for m in r.json().get("models", []):
                        n = m.get("name", "").split("/")[-1]
                        if (n.startswith("gemini") and "generateContent" in m.get("supportedGenerationMethods", [])
                                and not any(x in n for x in ("tts", "image", "live", "audio", "embedding", "vision", "robotics",
                                                              "computer-use", "thinking", "learnlm", "exp"))):
                            names.append(n)
        except httpx.HTTPError:
            pass
        order = sorted(set(names), key=self.rank_model)
        for fallback in ("gemini-flash-latest", "gemini-flash-lite-latest"):  # always worth a try
            if fallback not in order:
                order.append(fallback)
        self._models = order
        return order

    async def _ask(self, items, budget: float = BUDGET) -> object:
        return await self._ask_raw(SYSTEM, build_user_message(items), budget)

    async def _ask_raw(self, system: str, user: str, budget: float = BUDGET) -> object:
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {"temperature": 0, "responseMimeType": "application/json"},
        }
        deadline = time.time() + budget
        notes: List[str] = []
        queue = list(await self._model_order())
        tried: List[str] = []
        quota = False
        while queue and len(tried) < MAX_MODELS and time.time() < deadline:
            model = queue.pop(0)
            if model in tried or self._blocked.get(model, 0) > time.time():
                continue
            tried.append(model)
            for attempt in range(2):
                if time.time() >= deadline:
                    break
                if self._gate is None:
                    self._gate = asyncio.Lock()
                async with self._gate:  # pace requests to the same model
                    wait = self._next_by_model.get(model, 0.0) - time.time()
                    if wait > 0:
                        await asyncio.sleep(min(wait, 10.0))
                    self._next_by_model[model] = time.time() + MIN_INTERVAL
                try:
                    async with self._client() as c:
                        r = await c.post(f"{API}/models/{model}:generateContent", json=body)
                except httpx.HTTPError as exc:
                    notes.append(f"{model}: could not reach Google ({type(exc).__name__})")
                    continue
                if r.status_code == 200:
                    self.working_model = model
                    if model in self._models:  # remember what works: try it first from now on
                        self._models.remove(model)
                    self._models.insert(0, model)
                    return _parse_json(r.json())
                low = r.text.lower()
                if r.status_code == 429:
                    quota = True
                    retry = _retry(r, 20.0)
                    notes.append(f"{model}: free allowance used up")
                    if "perday" in low.replace("_", "").replace(" ", "") or retry > 10 or attempt >= 1:
                        self._blocked[model] = time.time() + min(max(retry, 60.0), 3600.0)
                        break  # another model has its own allowance
                    self._next_by_model[model] = time.time() + retry
                    continue
                if r.status_code == 404 or (r.status_code == 400 and any(
                        w in low for w in ("not found", "no longer available", "not supported", "deprecated", "unavailable"))):
                    # renamed / retired / not offered to this key: remember, and follow Google's own suggestion
                    notes.append(f"{model}: not available to this key")
                    self._blocked[model] = time.time() + 6 * 3600
                    self._next_by_model.pop(model, None)
                    for sug in re.findall(r"models/(gemini-[\w.\-]+)", r.text):
                        if sug != model and sug not in tried:
                            queue.insert(0, sug)
                    break
                if r.status_code >= 500:
                    notes.append(f"{model}: Gemini error {r.status_code}")
                    await asyncio.sleep(1.0)
                    continue
                raise PronounceError(f"Gemini error {r.status_code}: {r.text[:200]}")
        summary = "; ".join(notes[-4:]) or "no answer in time"
        log.info("pronunciation assistant gave up: %s", summary)
        if quota and all("allowance" in n or "not available" in n for n in notes):
            self.cooldown_until = min((t for t in self._blocked.values() if t > time.time()), default=time.time() + 300)
            raise PronounceError("Google's free allowance is used up (" + summary + ")", quota=True)
        raise PronounceError("could not get an answer (" + summary + ")")


def _retry(r: httpx.Response, default: float) -> float:
    try:
        for d in r.json().get("error", {}).get("details", []):
            if "retryDelay" in d:
                return float(str(d["retryDelay"]).rstrip("s"))
    except Exception:
        pass
    return default


def _parse_json(data: dict) -> object:
    try:
        parts = data["candidates"][0]["content"]["parts"]
        txt = "".join(p.get("text", "") for p in parts)
    except Exception:
        raise PronounceError("the pronunciation assistant returned nothing")
    txt = txt.strip()
    if txt.startswith("```"):
        txt = re.sub(r"^```(?:json)?|```$", "", txt, flags=re.MULTILINE).strip()
    try:
        return json.loads(txt)
    except Exception:
        m = re.search(r"\{.*\}", txt, flags=re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                pass
    raise PronounceError("the pronunciation assistant's answer could not be read")
