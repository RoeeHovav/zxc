"""Script and language identification.

Languages written in a unique script are identified from the script alone
(Hebrew, Arabic, Greek, Cyrillic-majority, CJK, ...).  Latin-script text is
identified with the ``lingua`` detector when it is installed (offline, accurate
on short text) and otherwise falls back to the document's default language.
"""
from __future__ import annotations

import functools
import logging
import unicodedata
from typing import Dict, Iterable, Optional

log = logging.getLogger(__name__)

HEBREW_RANGE = (0x0590, 0x05FF)
ARABIC_RANGES = ((0x0600, 0x06FF), (0x0750, 0x077F), (0x08A0, 0x08FF), (0xFB50, 0xFDFF), (0xFE70, 0xFEFF))


def char_script(ch: str) -> str:
    cp = ord(ch)
    if 0x0590 <= cp <= 0x05FF or 0xFB1D <= cp <= 0xFB4F:
        return "Hebrew"
    for a, b in ARABIC_RANGES:
        if a <= cp <= b:
            return "Arabic"
    if 0x0370 <= cp <= 0x03FF or 0x1F00 <= cp <= 0x1FFF:
        return "Greek"
    if 0x0400 <= cp <= 0x04FF:
        return "Cyrillic"
    if 0x0900 <= cp <= 0x097F:
        return "Devanagari"
    if 0x0E00 <= cp <= 0x0E7F:
        return "Thai"
    if 0xAC00 <= cp <= 0xD7AF or 0x1100 <= cp <= 0x11FF:
        return "Hangul"
    if 0x3040 <= cp <= 0x30FF:
        return "Kana"
    if 0x4E00 <= cp <= 0x9FFF or 0x3400 <= cp <= 0x4DBF:
        return "Han"
    if ch.isalpha() and cp < 0x0250 or 0x1E00 <= cp <= 0x1EFF:
        return "Latin"
    return "Other"


def script_counts(text: str) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for ch in text:
        if not ch.isalpha():
            continue
        s = char_script(ch)
        counts[s] = counts.get(s, 0) + 1
    return counts


def is_hebrew_word(w: str) -> bool:
    return any(0x05D0 <= ord(c) <= 0x05EA for c in w)


def is_latin_word(w: str) -> bool:
    return any(char_script(c) == "Latin" for c in w)


SCRIPT_DEFAULT_LANG = {
    "Hebrew": "he", "Arabic": "ar", "Greek": "el", "Cyrillic": "ru", "Devanagari": "hi", "Thai": "th",
    "Hangul": "ko", "Kana": "ja", "Han": "zh",
}

# Languages offered to the Latin/Cyrillic detector.  Keep the list focused to
# make short-text detection more reliable.
_LINGUA_LANGS = [
    "ENGLISH", "FRENCH", "GERMAN", "SPANISH", "ITALIAN", "PORTUGUESE", "DUTCH", "POLISH", "TURKISH",
    "SWEDISH", "DANISH", "BOKMAL", "FINNISH", "CZECH", "ROMANIAN", "HUNGARIAN", "INDONESIAN", "VIETNAMESE",
    "RUSSIAN", "UKRAINIAN", "BULGARIAN", "LATIN",
]


@functools.lru_cache(maxsize=1)
def _lingua_detector():
    try:
        from lingua import Language, LanguageDetectorBuilder
    except Exception:  # pragma: no cover - optional dependency
        return None
    langs = [getattr(Language, n) for n in _LINGUA_LANGS if hasattr(Language, n)]
    try:
        return LanguageDetectorBuilder.from_languages(*langs).with_preloaded_language_models().build()
    except Exception:
        try:
            return LanguageDetectorBuilder.from_languages(*langs).build()
        except Exception as exc:  # pragma: no cover
            log.warning("lingua unavailable: %s", exc)
            return None


def _iso(lang) -> str:
    code = lang.iso_code_639_1.name.lower()
    return {"nb": "nb"}.get(code, code)


def detect_language(text: str, default: str = "en") -> str:
    counts = script_counts(text)
    total = sum(counts.values())
    if total == 0:
        return default
    if counts.get("Hebrew", 0) >= 0.3 * total:
        return "he"
    if counts.get("Arabic", 0) >= 0.3 * total:
        return "ar"
    top = max(counts.items(), key=lambda kv: kv[1])[0]
    if top in ("Latin", "Cyrillic"):
        det = _lingua_detector()
        if det is not None and len(text) >= 12:
            try:
                lang = det.detect_language_of(text)
                if lang is not None:
                    return _iso(lang)
            except Exception:  # pragma: no cover
                pass
        if top == "Cyrillic":
            return "ru"
        return default if default not in ("he", "ar") else "en"
    return SCRIPT_DEFAULT_LANG.get(top, default)


def strip_marks(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c))
