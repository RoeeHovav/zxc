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
PROMPT_VERSION = "p4"
BATCH = 12  # passages per request: a small free daily request allowance then covers hundreds of passages
MIN_INTERVAL = 4.2  # seconds between requests: stays under the free tier's ~15 requests/minute

NIQQUD = re.compile("[֑-ׇ]")  # cantillation + vowel points + dots
HEB_WORD = re.compile("[א-ת][א-תְ-ׇ֑-֯\"'׳״]*")
HAS_NIQQUD = re.compile("[ְ-ּׁׂ]")

SYSTEM = (
    "You are an expert in Modern Israeli Hebrew pronunciation. You receive several Hebrew passages; each has its words "
    "numbered from 0. Some Hebrew words are written the same but pronounced differently, for example "
    "שמן = שֶׁמֶן (oil, fat) or שְׁמָן (their name); ספר = סֵפֶר (book), סַפָּר (barber) or סָפַר (he counted / told); "
    "הספר = הַסֵּפֶר (the book) or הַסַּפָּר (the barber); מלך = מֶלֶךְ or מָלַךְ; כלל = כְּלָל or כָּלַל; הקפה = הַקָּפֶה or הֶקֵּף. "
    "First understand each whole sentence, then decide the correct pronunciation of every word that is ambiguous without "
    "vowel marks, and return that word fully vowelled (niqqud: vowels, dagesh, shin/sin dot), including any prefix letters "
    "(ו, ה, ב, כ, ל, מ, ש). Do NOT return words that have only one natural reading, numbers, abbreviations, or non-Hebrew words. "
    "Never change, add or remove letters; only add vowel marks. "
    "Reply with a JSON object whose keys are the passage numbers (as strings); each value is an object whose keys are word "
    "numbers (as strings) and whose values are the vowelled words, or {} if no word in that passage is ambiguous."
)
EXAMPLES = [
    ("מקראות ישראל הינו שמן של חוברות", {"3": "שְׁמָן"}),
    ("הספר במספרה ספר את הכסף בקפידה", {"0": "הַסַּפָּר", "2": "סָפַר"}),
    ("הספר שקניתי אתמול מרתק", {"0": "הַסֵּפֶר"}),
]


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


def build_user_message(items: List[Tuple[str, List[Tuple[int, int, str]]]]) -> str:
    ex_in = {str(i): {"passage": t, "words": _numbered(hebrew_words(t))} for i, (t, _) in enumerate(EXAMPLES)}
    ex_out = {str(i): a for i, (_, a) in enumerate(EXAMPLES)}
    real = {str(i): {"passage": t, "words": _numbered(w)} for i, (t, w) in enumerate(items)}
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
        self._gate: Optional[asyncio.Lock] = None  # created lazily inside the running loop
        self._next_time = 0.0
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

    def _read_cache(self, text: str, words) -> Optional[Dict[int, str]]:
        path = self._cache_path(text)
        if not os.path.exists(path):
            return None
        try:
            with open(path, encoding="utf-8") as fh:
                raw = json.load(fh)
            self.stats["cached"] += 1
            return validate(raw, words)
        except Exception:
            return None

    def _write_cache(self, text: str, chosen: Dict[int, str]) -> None:
        path = self._cache_path(text)
        try:
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump({str(k): v for k, v in chosen.items()}, fh, ensure_ascii=False)
            os.replace(tmp, path)
        except OSError:
            pass

    async def vocalize_many(self, texts: List[str]):
        """-> [(words, chosen {index: vowelled}, from_cache)] aligned with `texts`.  Passages not yet remembered are
        asked together in as few requests as possible.  Raises PronounceError when they cannot be asked."""
        out: list = [None] * len(texts)
        missing: List[int] = []
        for i, t in enumerate(texts):
            words = hebrew_words(t)
            if not words:
                out[i] = (words, {}, True)
                continue
            cached = self._read_cache(t, words)
            if cached is not None:
                out[i] = (words, cached, True)
            else:
                out[i] = (words, {}, False)
                missing.append(i)
        if not missing:
            return out
        if not self.key:
            raise PronounceError("no Gemini key")
        if time.time() < self.cooldown_until:
            raise PronounceError("cooling down", quota=True)
        # identical passages are asked once
        unique: Dict[str, int] = {}
        for i in missing:
            unique.setdefault(texts[i], i)
        order = list(unique)
        answers: Dict[str, Dict[int, str]] = {}
        for g in range(0, len(order), BATCH):
            group = order[g:g + BATCH]
            items = [(t, out[unique[t]][0]) for t in group]
            reply = await self._ask(items)
            self.stats["asked"] += 1
            for j, (t, words) in enumerate(items):
                chosen = validate(reply.get(str(j)) if isinstance(reply, dict) else None, words)
                answers[t] = chosen
                self.stats["words"] += len(chosen)
                self._write_cache(t, chosen)
        for i in missing:
            out[i] = (out[i][0], answers.get(texts[i], {}), False)
        return out

    async def vocalize(self, text: str) -> Tuple[List[Tuple[int, int, str]], Dict[int, str], bool]:
        return (await self.vocalize_many([text]))[0]

    # ------------------------------------------------------------- service
    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=60, transport=self.transport, headers={"x-goog-api-key": self.key or ""})

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

    async def _ask(self, items) -> object:
        body = {
            "systemInstruction": {"parts": [{"text": SYSTEM}]},
            "contents": [{"role": "user", "parts": [{"text": build_user_message(items)}]}],
            "generationConfig": {"temperature": 0, "responseMimeType": "application/json"},
        }
        last = ""
        queue = list(await self._model_order())
        tried = set()
        while queue:
            model = queue.pop(0)
            if model in tried or self._blocked.get(model, 0) > time.time():
                continue
            tried.add(model)
            for attempt in range(3):
                if self._gate is None:
                    self._gate = asyncio.Lock()
                async with self._gate:  # one request every few seconds, however many chunks ask at once
                    wait = self._next_time - time.time()
                    if wait > 0:
                        await asyncio.sleep(wait)
                    self._next_time = time.time() + MIN_INTERVAL
                try:
                    async with self._client() as c:
                        r = await c.post(f"{API}/models/{model}:generateContent", json=body)
                except httpx.HTTPError as exc:
                    last = f"could not reach Google: {exc}"
                    await asyncio.sleep(1.5 * (attempt + 1))
                    continue
                if r.status_code == 200:
                    self.working_model = model
                    if model in self._models:  # remember what works: try it first from now on
                        self._models.remove(model)
                    self._models.insert(0, model)
                    return _parse_json(r.json())
                low = r.text.lower()
                if r.status_code == 429:
                    last = "Google's free allowance for the pronunciation assistant is used up"
                    if "perday" in low.replace("_", "").replace(" ", "") or attempt >= 1:
                        self._blocked[model] = time.time() + 3600
                        break
                    self._next_time = time.time() + _retry(r, 20.0)
                    continue
                if r.status_code == 404 or (r.status_code == 400 and any(
                        w in low for w in ("not found", "no longer available", "not supported", "deprecated", "unavailable"))):
                    # renamed / retired / not offered to this key: remember, and follow Google's own suggestion
                    last = f"model {model} is not available to this key"
                    self._blocked[model] = time.time() + 6 * 3600
                    for sug in re.findall(r"models/(gemini-[\w.\-]+)", r.text):
                        if sug != model and sug not in tried:
                            queue.insert(0, sug)
                    break
                if r.status_code >= 500:
                    last = f"Gemini error {r.status_code}"
                    await asyncio.sleep(2.0 * (attempt + 1))
                    continue
                raise PronounceError(f"Gemini error {r.status_code}: {r.text[:200]}")
        if "allowance" in last:
            self.cooldown_until = min((t for t in self._blocked.values() if t > time.time()), default=time.time() + 3600)
            raise PronounceError(last, quota=True)
        raise PronounceError(last or "the pronunciation assistant did not answer")


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
