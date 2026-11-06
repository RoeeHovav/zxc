"""Script and language identification.

Languages written in a unique script are identified from the script alone
(Hebrew, Arabic, Greek, Cyrillic-majority, CJK, ...).  Latin-script text is
identified from language function words (no model download); very short text
falls back to the document's default language.
"""
from __future__ import annotations

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

# Function words per language: at paragraph length, counting them identifies a
# Latin-script language very reliably, with no model download (the previous
# statistical detector weighed 170 MB).
_STOPWORDS = {
    "en": "the of and to in is that it for was on are as with be by this have from or not but which they his an were been their at we can has more also".split(),
    "fr": "le la les de des et est un une du que dans pour qui sur pas au avec ce il elle sont ne se plus par mais ou nous vous leur aux été cette".split(),
    "de": "der die das und ist nicht ein eine zu den von mit sich des auf für im dem auch es als an wird werden sind bei oder aus nach wie einer".split(),
    "es": "el la los las de que y en un una es por con para no se del al lo como más pero sus le ya o este sí porque esta entre cuando muy sin sobre".split(),
    "it": "il la di che e un una per non sono con del della le gli è da si nel alla come più ma anche questo dei delle ha essere".split(),
    "pt": "o a os as de que e do da em um uma para com não é se na no por mais dos das como mas ao ele ela foi são também".split(),
    "nl": "de het een en van in is dat op te zijn met voor niet aan er ook als bij door maar om dan nog wordt worden deze".split(),
    "pl": "i w na z do się nie że jest to o jak co ale po od przez za dla tak już jego jej są być może tylko".split(),
    "tr": "ve bir bu da de için ile ne olarak çok daha gibi ama değil olan kadar sonra her ancak şu en mi var".split(),
    "sv": "och i att det som en på är av för med till den har inte om ett de var men så kan från".split(),
    "da": "og i at det en den til er som på de med af for ikke der var et har men om fra kan".split(),
    "nb": "og i det at en på er som til for med av ikke den har de var om et men fra kan".split(),
    "fi": "ja on ei se että oli hän mutta kun niin myös tai joka ovat ole tämä mitä vain sen".split(),
    "cs": "a se na je v že to z s do o jako ale by jsou které pro tak jeho jak už".split(),
    "ro": "și de la în a un o să cu nu pe care este din mai ce pentru sunt sau fost".split(),
    "hu": "a az és hogy nem is egy ez meg de van már csak mint még volt ki".split(),
    "id": "dan yang di ini itu dengan untuk tidak dari dalam akan pada juga ke ada adalah oleh karena".split(),
    "vi": "và của là có không được trong cho này một những người với các đã khi để".split(),
    "la": "et in est non ad cum quod qui ut sed ex de quae per esse sunt enim".split(),
}
_STOP_SETS = {k: set(v) for k, v in _STOPWORDS.items()}


def _latin_language(text: str) -> Optional[str]:
    words = [w.strip(".,;:!?()[]\"'«»“”’").lower() for w in text.split()]
    words = [w for w in words if w]
    if len(words) < 4:
        return None
    scores = {lang: sum(1 for w in words if w in sw) for lang, sw in _STOP_SETS.items()}
    best = max(scores.items(), key=lambda kv: kv[1])
    if best[1] == 0:
        return None
    ranked = sorted(scores.values(), reverse=True)
    if len(ranked) > 1 and ranked[1] == best[1]:
        return "en" if scores.get("en") == best[1] else None
    return best[0]


def _cyrillic_language(text: str) -> str:
    if any(c in text for c in "іїєґІЇЄҐ"):
        return "uk"
    if "ъ" in text and "ы" not in text and "э" not in text:
        return "bg"
    return "ru"


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
    if top == "Cyrillic":
        return _cyrillic_language(text)
    if top == "Latin":
        lang = _latin_language(text)
        if lang:
            return lang
        return default if default not in ("he", "ar") else "en"
    return SCRIPT_DEFAULT_LANG.get(top, default)


def strip_marks(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c))
