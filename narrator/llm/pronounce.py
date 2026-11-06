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
PROMPT_VERSION = "p3"
PREFERRED_MODELS = ["gemini-2.5-flash-lite", "gemini-flash-lite-latest", "gemini-2.5-flash", "gemini-flash-latest"]
MIN_INTERVAL = 4.2  # seconds between requests: stays under the free tier's ~15 requests/minute

NIQQUD = re.compile("[֑-ׇ]")  # cantillation + vowel points + dots
HEB_WORD = re.compile("[א-ת][א-תְ-ׇ֑-֯\"'׳״]*")
HAS_NIQQUD = re.compile("[ְ-ּׁׂ]")

SYSTEM = (
    "You are an expert in Modern Israeli Hebrew pronunciation. You receive a Hebrew passage and its words "
    "numbered from 0. Some Hebrew words are written the same but pronounced differently, for example "
    "שמן = שֶׁמֶן (oil, fat) or שְׁמָן (their name); ספר = סֵפֶר (book), סַפָּר (barber) or סָפַר (he counted); "
    "מלך = מֶלֶךְ or מָלַךְ; כלל = כְּלָל or כָּלַל; הקפה = הַקָּפֶה or הֶקֵּף. Using the meaning of the whole sentence, "
    "decide the correct pronunciation of every word that is ambiguous without vowel marks, and return that word "
    "fully vowelled (niqqud: vowels, dagesh, shin/sin dot), including any prefix letters (ו, ה, ב, כ, ל, מ, ש). "
    "Do NOT return words that have only one natural reading, numbers, abbreviations, names that are not ambiguous, or "
    "non-Hebrew words. Never change, add or remove letters; only add vowel marks. "
    "Reply with a JSON object whose keys are the word numbers (as strings) and whose values are the vowelled words. "
    "Reply {} if no word is ambiguous."
)
EXAMPLE = {
    "passage": "מקראות ישראל הינו שמן של חוברות",
    "words": {"0": "מקראות", "1": "ישראל", "2": "הינו", "3": "שמן", "4": "של", "5": "חוברות"},
    "answer": {"3": "שְׁמָן"},
}


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


def build_user_message(text: str, words: List[Tuple[int, int, str]]) -> str:
    shown = {str(i): w for i, (_, _, w) in enumerate(words)}
    ex = json.dumps(EXAMPLE["words"], ensure_ascii=False)
    return (
        f"Example\npassage: {EXAMPLE['passage']}\nwords: {ex}\nanswer: {json.dumps(EXAMPLE['answer'], ensure_ascii=False)}\n\n"
        f"Now the real input\npassage: {text}\nwords: {json.dumps(shown, ensure_ascii=False)}\nanswer:"
    )


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

    async def vocalize(self, text: str) -> Tuple[List[Tuple[int, int, str]], Dict[int, str], bool]:
        """-> (words, chosen {index: vowelled}, from_cache).  Raises PronounceError on a service problem."""
        words = hebrew_words(text)
        if not words:
            return words, {}, True
        path = self._cache_path(text)
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as fh:
                    cached = {int(k): v for k, v in json.load(fh).items()}
                self.stats["cached"] += 1
                return words, validate({str(k): v for k, v in cached.items()}, words), True
            except Exception:
                pass
        if not self.key:
            raise PronounceError("no Gemini key")
        if time.time() < self.cooldown_until:
            raise PronounceError("cooling down", quota=True)
        answer = await self._ask(text, words)
        chosen = validate(answer, words)
        self.stats["asked"] += 1
        self.stats["words"] += len(chosen)
        try:
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump({str(k): v for k, v in chosen.items()}, fh, ensure_ascii=False)
            os.replace(tmp, path)
        except OSError:
            pass
        return words, chosen, False

    # ------------------------------------------------------------- service
    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=60, transport=self.transport, headers={"x-goog-api-key": self.key or ""})

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
                                and not any(x in n for x in ("tts", "image", "live", "audio", "embedding", "vision", "robotics"))):
                            names.append(n)
        except httpx.HTTPError:
            pass

        def rank(n: str):
            for i, p in enumerate(PREFERRED_MODELS):
                if n == p:
                    return (0, i, n)
            return (1, 0 if "flash-lite" in n else 1 if "flash" in n else 2, n)

        have = set(names)
        order = [p for p in PREFERRED_MODELS if p in have or not have] + sorted(have - set(PREFERRED_MODELS), key=rank)
        self._models = order or PREFERRED_MODELS
        return self._models

    async def _ask(self, text: str, words) -> object:
        body = {
            "systemInstruction": {"parts": [{"text": SYSTEM}]},
            "contents": [{"role": "user", "parts": [{"text": build_user_message(text, words)}]}],
            "generationConfig": {"temperature": 0, "responseMimeType": "application/json"},
        }
        last = ""
        for model in await self._model_order():
            if self._blocked.get(model, 0) > time.time():
                continue
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
                    return _parse_json(r.json())
                if r.status_code == 429:
                    low = r.text.replace("_", "").replace(" ", "").lower()
                    last = "Google's free allowance for the pronunciation assistant is used up"
                    if "perday" in low or attempt >= 1:
                        self._blocked[model] = time.time() + 3600
                        break
                    self._next_time = time.time() + _retry(r, 20.0)
                    continue
                if r.status_code in (404, 400) and "not found" in r.text.lower():
                    self._blocked[model] = time.time() + 6 * 3600
                    break
                if r.status_code >= 500:
                    last = f"Gemini error {r.status_code}"
                    await asyncio.sleep(2.0 * (attempt + 1))
                    continue
                raise PronounceError(f"Gemini error {r.status_code}: {r.text[:200]}")
        if any(t > time.time() for t in self._blocked.values()) and "allowance" in last:
            self.cooldown_until = min(self._blocked.values())
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
