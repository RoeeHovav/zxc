"""Vowel marks (niqqud) for EVERY Hebrew word, from Dicta's free Nakdan service.

Unvowelled Hebrew leaves the voice to guess how each word is read, and it guesses wrong more often than one
would think: not only real homographs (שמן, ספר, הספר), but ordinary words too.  The Microsoft voices follow
vowel marks when they are given (checked by listening: plain "הספר במספרה ספר" came out as "the book ... counted",
with marks as "the barber ... counted").

Dicta (dicta.org.il, an Israeli non-profit) runs the best-known Hebrew diacritizer.  Measured on the 48 ambiguous
words of scripts/eval_pronunciation.py it picked the right reading for 46 (96%), as many as the best Gemini model,
with no daily allowance, in about half a second, and for every word of the passage instead of the few a language
model chooses to mark.  Where Gemini is also available its decisions on ambiguous words take precedence (together:
47/48).

* No account or key.  This is Dicta's public web service (the one its own website uses); Dicta could change or
  limit it, in which case passages are simply read without it.
* Only the text being read is sent, never the PDF; results are kept on disk per passage.
* Every answer is validated: stripped of its vowel marks it must be the original word (a vowelled spelling may leave
  out a ו or י that only marks a vowel, as vowelled texts do).
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import time
import unicodedata
from typing import Dict, List, Optional, Tuple

import httpx

log = logging.getLogger(__name__)

URL = "https://nakdan-2-0.loadbalancer.dicta.org.il/api"
VERSION = "d2"
TIMEOUT = 12.0
MAX_CHARS = 9000  # Dicta's own page splits at 10 000 characters

NIQQUD = re.compile("[֑-ׇ]")
HAS_NIQQUD = re.compile("[ְ-ׇּׁׂ]")
HEBREW = re.compile("[א-ת]")
QAMATS_QATAN = "ׇ"  # Dicta marks it when asked (keepqq); a voice reads it as a plain qamats ("kal" for כׇּל)
HATAF_QAMATS = "ֳ"
HOLAM = "ֹ"


class NakdanError(Exception):
    pass


def strip_marks(s: str) -> str:
    return NIQQUD.sub("", s)


def same_word(vowelled: str, written: str) -> bool:
    """The vowelled form is the written word: the same letters, except that a vowelled spelling may leave out a ו or
    י that only marks a vowel (Dicta writes סיפורים as סִפּוּרִים, as vowelled texts do)."""
    a, b = strip_marks(vowelled), strip_marks(written)
    return a == b or (len(a) < len(b) and a.replace("ו", "").replace("י", "") == b.replace("ו", "").replace("י", ""))


def clean(v: str) -> str:
    """Dicta's reading as the voice should get it: no prefix separators or meteg, and the "o" vowels written as
    holam so no voice can read them as "a"."""
    v = v.replace("|", "").replace("ֽ", "")
    v = v.replace(QAMATS_QATAN, HOLAM).replace(HATAF_QAMATS, HOLAM)
    return unicodedata.normalize("NFC", v)


GERESH = re.compile("[\"'׳״]")


def without_marks(text: str) -> Tuple[str, List[int]]:
    """The text with its vowel marks removed (Dicta re-vowels whatever it is given, so a word the app or the user
    already marked would come back changed and spoil the whole answer), and for each remaining character its
    position in `text`."""
    plain, back = [], []
    for i, c in enumerate(text):
        if not NIQQUD.match(c):
            plain.append(c)
            back.append(i)
    return "".join(plain), back


def _first(option) -> str:
    return option[0] if isinstance(option, list) and option else option if isinstance(option, str) else ""


def parse(reply: object, text: str) -> Optional[List[Tuple[int, int, str]]]:
    """[(start, end, vowelled)] for each Hebrew word of `text` that Dicta vowelled; None if the reply does not
    match the text (then nothing from it is used)."""
    if not isinstance(reply, list):
        return None
    out: List[Tuple[int, int, str]] = []
    pos = 0
    for w in reply:
        if not isinstance(w, dict) or not isinstance(w.get("word"), str):
            return None
        word = w["word"]
        if text[pos:pos + len(word)] != word:
            return None
        start, pos = pos, pos + len(word)
        if w.get("sep") or not HEBREW.search(word) or HAS_NIQQUD.search(word):
            continue
        if len(word) < 2 or GERESH.search(word):
            # a one-letter prefix before a number ("ב-1948") and abbreviations or foreign sounds written with a
            # geresh (צה"ל, ג'ירפה) are left to the voice, which reads them better without marks
            continue
        opts = w.get("options") or []
        v = clean(_first(opts[0])) if opts else ""
        if v and same_word(v, word) and HAS_NIQQUD.search(v):
            out.append((start, pos, v))
    return out if pos == len(text) else None


class Nakdan:
    def __init__(self, cache_dir: str, transport: Optional[httpx.AsyncBaseTransport] = None):
        self.cache_dir = cache_dir
        os.makedirs(cache_dir, exist_ok=True)
        self.transport = transport
        self.cooldown_until = 0.0
        self.last_error = ""
        self.stats = {"asked": 0, "cached": 0, "failed": 0}

    def available(self) -> bool:
        return time.time() >= self.cooldown_until

    def _path(self, text: str) -> str:
        return os.path.join(self.cache_dir, hashlib.sha256((VERSION + "\n" + text).encode("utf-8")).hexdigest()[:40] + ".json")

    def _cached(self, text: str) -> Optional[List[Tuple[int, int, str]]]:
        try:
            with open(self._path(text), encoding="utf-8") as fh:
                raw = json.load(fh)
            out = [(int(s), int(e), v) for s, e, v in raw]
            if all(same_word(v, text[s:e]) for s, e, v in out):
                self.stats["cached"] += 1
                return out
        except (OSError, ValueError, TypeError):
            pass
        return None

    def _store(self, text: str, spans) -> None:
        path = self._path(text)
        try:
            with open(path + ".tmp", "w", encoding="utf-8") as fh:
                json.dump(spans, fh, ensure_ascii=False)
            os.replace(path + ".tmp", path)
        except OSError:
            pass

    async def _ask(self, text: str) -> object:
        body = {"task": "nakdan", "data": text, "genre": "modern", "addmorph": False, "keepqq": True,
                "nodageshdefmem": False, "patachma": False, "keepmetagim": False, "matchpartial": True}
        async with httpx.AsyncClient(timeout=TIMEOUT, transport=self.transport) as c:
            r = await c.post(URL, content=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                             headers={"content-type": "text/plain;charset=UTF-8"})
        if r.status_code != 200:
            raise NakdanError(f"Dicta answered {r.status_code}")
        try:
            return r.json()
        except ValueError:
            raise NakdanError("Dicta's answer could not be read") from None

    async def vowel_many(self, texts: List[str]) -> List[Optional[List[Tuple[int, int, str]]]]:
        """Vowelled spans for each text (None where Dicta could not be asked).  Texts not yet remembered are sent
        together, one request per ~9000 characters.  Words that already carry vowel marks keep them."""
        maps = {t: without_marks(t) for t in texts}
        res = await self._vowel_plain([maps[t][0] for t in texts])
        out: List[Optional[list]] = []
        for t, spans in zip(texts, res):
            if spans is None:
                out.append(None)
                continue
            plain, back = maps[t]
            mine = []
            for a, b, v in spans:
                oa, ob = back[a], back[b - 1] + 1
                if NIQQUD.search(t[oa:ob]) or NIQQUD.match(t[ob:ob + 1]):
                    continue  # already marked in the text: keep those marks
                mine.append((oa, ob, v))
            out.append(mine)
        return out

    async def _vowel_plain(self, texts: List[str]) -> List[Optional[List[Tuple[int, int, str]]]]:
        """Dicta's spans for texts without vowel marks (remembered on disk per text)."""
        out: List[Optional[list]] = [None] * len(texts)
        todo: Dict[str, List[int]] = {}
        for i, t in enumerate(texts):
            if not HEBREW.search(t):
                out[i] = []
                continue
            c = self._cached(t)
            if c is not None:
                out[i] = c
            else:
                todo.setdefault(t, []).append(i)
        if not todo:
            return out
        if not self.available():
            return out
        groups: List[List[str]] = [[]]
        for t in todo:
            if groups[-1] and sum(len(x) + 1 for x in groups[-1]) + len(t) > MAX_CHARS:
                groups.append([])
            groups[-1].append(t)
        for group in groups:
            joined = "\n".join(group)
            try:
                reply = await self._ask(joined)
                self.stats["asked"] += 1
            except (httpx.HTTPError, NakdanError) as exc:
                self.stats["failed"] += 1
                self.last_error = str(exc) or type(exc).__name__
                self.cooldown_until = time.time() + 60  # do not make every passage wait for the same failure
                log.info("Dicta Nakdan unavailable: %s", self.last_error)
                return out
            spans = parse(reply, joined)
            if spans is None:  # unexpected shape: try the passages one by one before giving up on them
                if len(group) == 1:
                    self.stats["failed"] += 1
                    continue
                for t in group:
                    try:
                        one = parse(await self._ask(t), t)
                    except (httpx.HTTPError, NakdanError):
                        one = None
                    if one is not None:
                        self._store(t, one)
                        for i in todo[t]:
                            out[i] = one
                continue
            offset = 0
            for t in group:
                end = offset + len(t)
                mine = [(s - offset, e - offset, v) for s, e, v in spans if s >= offset and e <= end]
                self._store(t, mine)
                for i in todo[t]:
                    out[i] = mine
                offset = end + 1
        return out

    async def vowel(self, text: str) -> Optional[List[Tuple[int, int, str]]]:
        return (await self.vowel_many([text]))[0]
