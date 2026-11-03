"""Sentence segmentation and sentence-type classification over word lists."""
from __future__ import annotations

import re
from typing import List, Sequence, Tuple

_CLOSERS = "\"'”’״׳)]}»"
_OPENERS = "\"'“‘״(«[{"
_END = set(".!?…؟")
_EN_ABBR = {
    "mr.", "mrs.", "ms.", "dr.", "prof.", "sr.", "jr.", "st.", "vs.", "e.g.", "i.e.", "fig.", "figs.", "eq.", "eqs.",
    "no.", "vol.", "pp.", "p.", "al.", "approx.", "cf.", "inc.", "ltd.", "co.", "jan.", "feb.", "mar.", "apr.",
    "jun.", "jul.", "aug.", "sep.", "sept.", "oct.", "nov.", "dec.", "ch.", "sec.", "ed.", "eds.", "resp.",
    "u.s.", "u.k.", "a.m.", "p.m.", "dept.", "univ.", "incl.", "est.", "gen.", "col.", "lt.", "sgt.", "capt.",
}
_ENUM_RE = re.compile(r"^(\(?\d{1,3}[.)]|\(?[a-zA-Z][.)]|\(?[א-ת]['׳]?[.)]|[ivxIVX]{1,4}[.)])$")

DEFINITION_PATTERNS = [
    r"\b(is|are) (defined|known|called|referred to) as\b", r"\brefers? to\b", r"\bis called\b", r"\bmeans\b",
    r"\bdefinition\b", r"\bwe define\b", r"\bis termed\b",
    r"מוגדר(ת|ים|ות)? כ", r"\bהגדרה\b", r"\bפירושו\b", r"\bפירושה\b", r"\bנקרא(ת|ים|ות)?\b", r"\bמכונה\b", r"\bמשמעו(ת)?\b",
    r"\bהכוונה ל", r"\bהינו\b", r"\bהינה\b",
]
WARNING_PATTERNS = [
    r"^(note|warning|caution|important|attention|remember|tip)\b", r"^(שים|שימו) לב", r"^(הערה|אזהרה|חשוב|זכור|דגש|דגשים)\b",
]
CONCLUSION_PATTERNS = [
    r"^(in conclusion|to conclude|to summarize|in summary|therefore|thus|hence|overall)\b",
    r"^(לסיכום|לכן|מכאן ש|לפיכך|בסיכומו של דבר|כלומר)",
]
EXAMPLE_PATTERNS = [r"^(for example|for instance|e\.g\.)", r"^(לדוגמה|לדוגמא|למשל|כך למשל)"]


def _core(word: str) -> str:
    return word.rstrip(_CLOSERS)


def is_sentence_end(words: Sequence[str], i: int, unit_kind: str = "paragraph") -> bool:
    w = words[i]
    core = _core(w)
    if not core or core[-1] not in _END:
        return False
    if i == 0 and _ENUM_RE.match(w):
        return False  # list enumerator "1." / "א."
    low = core.lower()
    nxt = words[i + 1] if i + 1 < len(words) else None
    if low in _EN_ABBR:
        if low == "etc." and nxt and nxt[:1].isupper():
            return True
        return False
    if re.fullmatch(r"[A-Z]\.", core):  # initial
        return False
    if re.fullmatch(r"(\d+\.)+", core) and i == 0:
        return False
    if nxt is not None:
        n0 = nxt.lstrip(_OPENERS)[:1]
        if n0 and n0.isalpha() and n0.islower() and core[-1] == ".":
            return False  # "approx. the" style continuation
        if core.endswith("...") and n0.islower():
            return False
    return True


def split_sentences(words: Sequence[str], unit_kind: str = "paragraph", max_words: int = 70) -> List[Tuple[int, int]]:
    """Return [start, end) word index ranges."""
    out: List[Tuple[int, int]] = []
    start = 0
    n = len(words)
    for i in range(n):
        if is_sentence_end(words, i, unit_kind) or i == n - 1:
            out.append((start, i + 1))
            start = i + 1
    if start < n:
        out.append((start, n))
    # very long "sentences" (lists without punctuation, run-ons) are split at
    # semicolons/colons so highlighting and seeking stay useful
    final: List[Tuple[int, int]] = []
    for a, b in out:
        if b - a <= max_words:
            final.append((a, b))
            continue
        cur = a
        for k in range(a, b):
            c = _core(words[k])
            if c and c[-1] in ";:" and k + 1 - cur >= 12 and b - (k + 1) >= 6:
                final.append((cur, k + 1))
                cur = k + 1
        final.append((cur, b))
    return final


def sentence_type(text: str, unit_kind: str) -> str:
    t = text.strip()
    if unit_kind == "heading":
        return "heading"
    core = t.rstrip(_CLOSERS).rstrip()
    low = t.lower()
    for p in WARNING_PATTERNS:
        if re.search(p, low):
            return "warning"
    if core.endswith("?") or core.endswith("؟"):
        return "question"
    for p in CONCLUSION_PATTERNS:
        if re.search(p, low):
            return "conclusion"
    for p in EXAMPLE_PATTERNS:
        if re.search(p, low):
            return "example"
    for p in DEFINITION_PATTERNS:
        if re.search(p, low):
            return "definition"
    if t[:1] in "\"“״«" and core[-1:] in "\"”״»":
        return "quotation"
    if core.endswith("!"):
        return "exclamation"
    if unit_kind == "list_item":
        return "list"
    return "statement"
