"""Turn source words (as printed in the PDF) into *spoken tokens*.

Every spoken token remembers the range of source words it came from, so audio
timing reported for the spoken text can be mapped back to the exact words on
the page for highlighting.  Normalisation never invents content; it only
* repairs extraction artefacts (detached punctuation, split words, leaders),
* expands abbreviations/acronyms that speech engines misread,
* applies the user's pronunciation dictionary,
* verbalises mathematical notation.
"""
from __future__ import annotations

import csv
import os
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from . import math_speech
from .script import is_hebrew_word, is_latin_word

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")

HEB_PREFIX_LETTERS = set("והבכלמש")
_TRAIL_PUNCT = ".,;:!?)]}»”’…"
_LEAD_PUNCT = "([{«“‘"
_QUOTES = "\"'״׳"
_LEADER_RE = re.compile(r"^[.…·_\-–]{3,}$")
_TRAIL_LEADER_RE = re.compile(r"[.…·_]{4,}$")
_NUM_RE = re.compile(r"^[\d][\d,.]*%?$")
_CITATION_RE = re.compile(r"^\[\d{1,3}([,–\-]\s*\d{1,3})*\][.,;:]?$")
_URL_RE = re.compile(r"^(https?://)?(www\.)?([A-Za-z0-9-]+\.)+[A-Za-z]{2,}(/\S*)?$")
NIQQUD_RE = re.compile(r"[֑-ׇ]")


def strip_niqqud(s: str) -> str:
    return NIQQUD_RE.sub("", s)


def unify_quotes(s: str) -> str:
    return s.replace("״", '"').replace("׳", "'").replace("”", '"').replace("“", '"').replace("’", "'").replace("‘", "'")


@dataclass
class Tok:
    text: str
    a: int
    b: int
    replaced: bool = False  # produced by lexicon/math, do not re-process

    def span(self) -> Tuple[int, int]:
        return self.a, self.b


@dataclass
class LexEntry:
    written: str
    spoken: str
    lang: str = "*"
    context: str = "any"
    scope: str = "builtin"
    id: Optional[int] = None

    @property
    def words(self) -> List[str]:
        return [lex_key(w) for w in self.written.split()]


def lex_key(token: str) -> str:
    t = unify_quotes(strip_niqqud(token)).strip()
    t = t.lstrip(_LEAD_PUNCT + '"')
    while t and t[-1] in ",;:!?)]}»":
        t = t[:-1]
    return t.lower()


class Lexicon:
    """Ordered collection of pronunciation entries (user entries win)."""

    def __init__(self, entries: Iterable[LexEntry] = ()):
        self.index: Dict[str, List[LexEntry]] = {}
        for e in entries:
            self.add(e)

    def add(self, e: LexEntry) -> None:
        ws = e.words
        if not ws or not ws[0]:
            return
        self.index.setdefault(ws[0], []).append(e)
        # longest phrases first, user entries before builtin
        self.index[ws[0]].sort(key=lambda x: (-len(x.words), 0 if x.scope != "builtin" else 1))

    def candidates(self, key: str) -> List[LexEntry]:
        out = list(self.index.get(key, ()))
        if key.endswith("'") or key.endswith('"') or key.endswith("."):
            out += self.index.get(key[:-1], [])
        else:
            out += self.index.get(key + ".", [])
        return out

    def __len__(self) -> int:
        return sum(len(v) for v in self.index.values())


def load_builtin(lang: str) -> List[LexEntry]:
    path = os.path.join(DATA_DIR, f"lexicon_{lang}.tsv")
    out: List[LexEntry] = []
    if not os.path.exists(path):
        return out
    with open(path, encoding="utf-8") as fh:
        for row in csv.reader(fh, delimiter="\t"):
            if not row or row[0].startswith("#") or len(row) < 2:
                continue
            ctx = row[2].strip() if len(row) > 2 and row[2].strip() else "any"
            out.append(LexEntry(written=row[0].strip(), spoken=row[1].strip(), lang=lang, context=ctx, scope="builtin"))
    return out


def vowelize_prefix(prefix: str, rest: str) -> str:
    out = []
    letters = list(prefix)
    i = 0
    first_rest = next((c for c in rest if "א" <= c <= "ת"), "")
    while i < len(letters):
        c = letters[i]
        nxt = letters[i + 1] if i + 1 < len(letters) else None
        if c in "בכל" and nxt == "ה":
            out.append({"ב": "בַּ", "כ": "כַּ", "ל": "לַ"}[c])
            i += 2
            continue
        if c == "ו":
            following = nxt or first_rest
            out.append("וּ" if following in ("ב", "מ", "פ") else "וְ")
        elif c == "ה":
            out.append("הַ")
        elif c == "ב":
            out.append("בְּ")
        elif c == "כ":
            out.append("כְּ")
        elif c == "ל":
            out.append("לְ")
        elif c == "מ":
            out.append("מֵ")
        elif c == "ש":
            out.append("שֶׁ")
        i += 1
    return "".join(out) + rest


@dataclass
class NormOptions:
    lang: str = "he"
    skip_citations: bool = True
    skip_footnote_marks: bool = True
    expand_abbreviations: bool = True
    verbalize_math: bool = True
    vocab: Optional[Counter] = None


def _split_affixes(token: str) -> Tuple[str, str, str]:
    i = 0
    while i < len(token) and token[i] in _LEAD_PUNCT:
        i += 1
    j = len(token)
    while j > i and token[j - 1] in _TRAIL_PUNCT:
        j -= 1
    return token[:i], token[i:j], token[j:]


def normalize_words(words: Sequence[str], flags: Sequence[int], opts: NormOptions, lexicon: Lexicon,
                    occurrence: Optional[Dict[int, str]] = None) -> List[Tok]:
    """Main entry point.  ``flags`` uses the page word flags (bit 4 = script)."""
    toks = _initial(words, flags, opts)
    toks = _cleanup(toks)
    toks = _attach_punctuation(toks)
    toks = _hebrew_joins(toks, opts)
    toks = _english_hyphenation(toks, opts)
    if opts.skip_citations:
        toks = [t for t in toks if not _CITATION_RE.match(t.text)]
    toks = _urls(toks)
    toks = _apply_occurrences(toks, occurrence or {})
    toks = _apply_lexicon(toks, lexicon, opts)
    if opts.verbalize_math:
        toks = _math(toks, opts)
    return [t for t in toks if t.text.strip()]


def _initial(words: Sequence[str], flags: Sequence[int], opts: NormOptions) -> List[Tok]:
    toks: List[Tok] = []
    for i, w in enumerate(words):
        script = bool(flags[i] & 4) if i < len(flags) else False
        if script and toks:
            prev = toks[-1].text
            base = prev.rstrip(_TRAIL_PUNCT)
            mathy = bool(re.search(r"(^|[^A-Za-z֐-׿])[A-Za-z]$|[\d)\]]$", base)) and len(base) <= 6
            if mathy and re.fullmatch(r"[\d\-−+n]{1,3}", w):
                toks[-1] = Tok(prev + "^" + w, toks[-1].a, i)
                continue
            if opts.skip_footnote_marks and re.fullmatch(r"[\d*†‡§,]{1,6}", w):
                # footnote reference glued to a word: keep the mapping, drop the sound
                toks[-1] = Tok(prev, toks[-1].a, i)
                continue
        toks.append(Tok(w, i, i))
    return toks


def _cleanup(toks: List[Tok]) -> List[Tok]:
    out: List[Tok] = []
    for t in toks:
        s = "".join(c for c in t.text if unicodedata.category(c) not in ("Cf", "Cc"))
        s = s.replace("־", "-")  # maqaf -> hyphen
        if _LEADER_RE.match(s):
            if out:
                out[-1] = Tok(out[-1].text, out[-1].a, t.b)
            continue
        s = _TRAIL_LEADER_RE.sub("", s)
        if not s:
            if out:
                out[-1] = Tok(out[-1].text, out[-1].a, t.b)
            continue
        out.append(Tok(s, t.a, t.b))
    return out


_PUNCT_ONLY_RE = re.compile(r"^[.,;:!?)\]}»”’…\"'״׳]+$")
_LEADING_PUNCT_RE = re.compile(r"^([.,;:!?]+)(\w.*)$", re.UNICODE)


def _attach_punctuation(toks: List[Tok]) -> List[Tok]:
    out: List[Tok] = []
    for t in toks:
        if _PUNCT_ONLY_RE.match(t.text) and out:
            if all(c in "\"'״׳" for c in t.text):
                # a lone quote mark: attach to the neighbour it closes
                out[-1] = Tok(out[-1].text + t.text, out[-1].a, t.b)
            else:
                out[-1] = Tok(out[-1].text + t.text, out[-1].a, t.b)
            continue
        m = _LEADING_PUNCT_RE.match(t.text)
        if m and out and is_hebrew_word(t.text):
            # ".אך" -> previous token gets the period (Word RTL artefact)
            out[-1] = Tok(out[-1].text + m.group(1), out[-1].a, out[-1].b)
            out.append(Tok(m.group(2), t.a, t.b))
            continue
        out.append(t)
    return out


def _hebrew_joins(toks: List[Tok], opts: NormOptions) -> List[Tok]:
    out: List[Tok] = []
    i = 0
    vocab = opts.vocab or Counter()
    while i < len(toks):
        t = toks[i]
        nxt = toks[i + 1] if i + 1 < len(toks) else None
        core = t.text
        # "ב-" + "90", "על-" + "פי"
        if nxt is not None and core.endswith("-") and is_hebrew_word(core):
            left = core[:-1]
            if 1 <= len(strip_niqqud(left)) <= 3 and (nxt.text[:1].isdigit() or is_hebrew_word(nxt.text[:1])):
                out.append(Tok(core + nxt.text, t.a, nxt.b))
                i += 2
                continue
        # "כ" + "-2500"
        if nxt is not None and len(core) == 1 and core in HEB_PREFIX_LETTERS and re.match(r"^-\d", nxt.text):
            out.append(Tok(core + nxt.text, t.a, nxt.b))
            i += 2
            continue
        # single-letter fragment ("נקודו ת", "א תה") repaired with document vocabulary
        bare = strip_niqqud(core)
        if len(bare) == 1 and "א" <= bare <= "ת" and vocab:
            prev = out[-1] if out else None
            best = None
            best_score = 1
            if prev is not None and is_hebrew_word(prev.text) and prev.text[-1:].isalpha():
                cand = strip_niqqud(prev.text) + bare
                sc = vocab.get(cand, 0)
                if sc > best_score:
                    best, best_score = "prev", sc
            if nxt is not None and is_hebrew_word(nxt.text) and nxt.text[:1].isalpha():
                nb, _, _ = _split_affixes(strip_niqqud(nxt.text))[1], None, None
                cand = bare + strip_niqqud(_split_affixes(nxt.text)[1])
                sc = vocab.get(cand, 0)
                if sc > best_score:
                    best, best_score = "next", sc
            if best == "prev":
                out[-1] = Tok(prev.text + core, prev.a, t.b)
                i += 1
                continue
            if best == "next":
                out.append(Tok(core + nxt.text, t.a, nxt.b))
                i += 2
                continue
        out.append(t)
        i += 1
    return out


def _english_hyphenation(toks: List[Tok], opts: NormOptions) -> List[Tok]:
    out: List[Tok] = []
    i = 0
    vocab = opts.vocab or Counter()
    while i < len(toks):
        t = toks[i]
        nxt = toks[i + 1] if i + 1 < len(toks) else None
        if nxt is not None and re.search(r"[A-Za-z]-$", t.text) and not t.text.endswith("--") and nxt.text[:1].islower():
            left = t.text[:-1]
            right_core = _split_affixes(nxt.text)[1]
            joined = (left + right_core).lower()
            if vocab.get(joined, 0) >= 1 or vocab.get(joined.strip(".,;:"), 0) >= 1:
                out.append(Tok(left + nxt.text, t.a, nxt.b))
            else:
                out.append(Tok(t.text + nxt.text, t.a, nxt.b))
            i += 2
            continue
        out.append(t)
        i += 1
    return out


def _urls(toks: List[Tok]) -> List[Tok]:
    out = []
    for t in toks:
        lead, core, trail = _split_affixes(t.text)
        if _URL_RE.match(core) and ("/" in core or core.startswith("www") or core.startswith("http")):
            m = _URL_RE.match(core)
            host = re.sub(r"^(https?://)?(www\.)?", "", core).split("/")[0]
            out.append(Tok(lead + host + trail, t.a, t.b, replaced=True))
        else:
            out.append(t)
    return out


def _apply_occurrences(toks: List[Tok], occurrence: Dict[int, str]) -> List[Tok]:
    if not occurrence:
        return toks
    out = []
    for t in toks:
        hit = None
        for k in range(t.a, t.b + 1):
            if k in occurrence:
                hit = occurrence[k]
                break
        if hit is not None:
            lead, core, trail = _split_affixes(t.text)
            out.append(Tok(lead + hit + trail, t.a, t.b, replaced=True))
        else:
            out.append(t)
    return out


def _context_ok(entry: LexEntry, toks: List[Tok], i: int, n: int) -> bool:
    ctx = entry.context
    if ctx == "any":
        return True
    prev = toks[i - 1].text if i > 0 else ""
    nxt = toks[i + n].text if i + n < len(toks) else ""
    prev_is_num = bool(_NUM_RE.match(prev.strip(_TRAIL_PUNCT))) or bool(re.search(r"\d$", prev))
    if ctx == "after_number":
        return prev_is_num
    if ctx == "not_after_number":
        return not prev_is_num
    if ctx == "before_number":
        return bool(re.match(r"^[(\[]?\d", nxt))
    return True


def _apply_lexicon(toks: List[Tok], lex: Lexicon, opts: NormOptions) -> List[Tok]:
    if not len(lex):
        return toks
    out: List[Tok] = []
    i = 0
    while i < len(toks):
        t = toks[i]
        if t.replaced:
            out.append(t)
            i += 1
            continue
        key = lex_key(t.text)
        matched = False
        for e in lex.candidates(key):
            if e.lang not in ("*", opts.lang) and not (e.lang == "he" and is_hebrew_word(t.text)) and not (e.lang == "en" and is_latin_word(t.text)):
                continue
            ws = e.words
            n = len(ws)
            if i + n > len(toks):
                continue
            ok = True
            for k in range(1, n):
                if lex_key(toks[i + k].text) != ws[k]:
                    ok = False
                    break
            if not ok and not (n == 1):
                continue
            if n == 1 and not _key_equal(key, ws[0]):
                continue
            if not ok or not _context_ok(e, toks, i, n):
                continue
            lead, _, _ = _split_affixes(toks[i].text)
            _, _, trail = _split_affixes(toks[i + n - 1].text)
            trail = _keep_trailing_punct(toks[i + n - 1].text, e.written)
            out.append(Tok(lead + e.spoken + trail, toks[i].a, toks[i + n - 1].b, replaced=True))
            i += n
            matched = True
            break
        if matched:
            continue
        # Hebrew prefixes: "בצה"ל", "והרמטכ"ל"
        if is_hebrew_word(key) and len(key) >= 3:
            done = False
            for p in (1, 2, 3):
                prefix, rest = key[:p], key[p:]
                if not all(c in HEB_PREFIX_LETTERS for c in prefix) or len(strip_niqqud(rest)) < 2:
                    break
                for e in lex.candidates(rest):
                    if len(e.words) != 1 or e.lang not in ("*", "he") or not _key_equal(rest, e.words[0]):
                        continue
                    if not _context_ok(e, toks, i, 1):
                        continue
                    lead, _, _ = _split_affixes(t.text)
                    trail = _keep_trailing_punct(t.text, e.written)
                    out.append(Tok(lead + vowelize_prefix(prefix, e.spoken) + trail, t.a, t.b, replaced=True))
                    done = True
                    break
                if done:
                    break
            if done:
                i += 1
                continue
        out.append(t)
        i += 1
    return out


def _key_equal(a: str, b: str) -> bool:
    if a == b:
        return True
    for x, y in ((a, b), (b, a)):
        if x.endswith(("'", '"', ".")) and x[:-1] == y:
            return True
    return False


def _keep_trailing_punct(token: str, written: str) -> str:
    """Return the punctuation that followed the matched word in the source,
    excluding characters that are part of the dictionary entry itself."""
    t = unify_quotes(strip_niqqud(token))
    w = unify_quotes(written.split()[-1])
    idx = t.rfind(w)
    if idx >= 0:
        tail = t[idx + len(w):]
    else:
        _, _, tail = _split_affixes(t)
    return "".join(c for c in tail if c in ".,;:!?)]}»")


def _math(toks: List[Tok], opts: NormOptions) -> List[Tok]:
    out = []
    for i, t in enumerate(toks):
        if t.replaced:
            out.append(t)
            continue
        lead, core, trail = _split_affixes(t.text)
        # keep a closing bracket that belongs to the notation, e.g. "f(x)"
        whole = t.text.rstrip(".,;:!?")
        if math_speech._FUNC_RE.match(whole):
            out.append(Tok(math_speech.verbalize(whole, opts.lang) + t.text[len(whole):], t.a, t.b, replaced=True))
            continue
        if core in ("-", "–") or not core:
            out.append(t)
            continue
        if core in math_speech.OPS and (len(core) == 1):
            prev = toks[i - 1].text if i > 0 else ""
            nxt = toks[i + 1].text if i + 1 < len(toks) else ""
            if core in "<>" and not (re.search(r"[\w)]$", prev) and re.match(r"^[\w(]", nxt)):
                out.append(t)
                continue
            word = math_speech.OPS[core][1 if opts.lang == "he" else 0]
            out.append(Tok(lead + word + trail, t.a, t.b, replaced=True))
            continue
        if math_speech.looks_like_math(core):
            spoken = math_speech.verbalize(core, opts.lang)
            out.append(Tok(lead + spoken + trail, t.a, t.b, replaced=True))
            continue
        out.append(t)
    return out


def build_vocab(word_lists: Iterable[Iterable[str]]) -> Counter:
    c: Counter = Counter()
    for ws in word_lists:
        for w in ws:
            core = strip_niqqud(_split_affixes(w)[1])
            if len(core) >= 2:
                c[core.lower()] += 1
    return c
