"""Prepare a unit for synthesis: normalise, split into chunks, route languages,
and plan delivery (pauses, pacing)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from ..text.normalize import Lexicon, NormOptions, Tok, normalize_words
from ..text.script import detect_language, script_counts
from .units import Unit

# Delivery profile per block kind: pauses in ms at 1x speed and synthesis rate
# adjustment in percent.  Headings are read a touch slower and set apart;
# list items flow faster; footnotes/captions are separated from the main text.
DELIVERY = {
    "heading": {"before": 650, "after": 700, "rate": -6},
    "paragraph": {"before": 0, "after": 450, "rate": 0},
    "list_item": {"before": 0, "after": 280, "rate": 0},
    "note": {"before": 250, "after": 450, "rate": 0},
    "caption": {"before": 350, "after": 450, "rate": 0},
    "footnote": {"before": 450, "after": 450, "rate": 0},
    "toc": {"before": 0, "after": 250, "rate": 0},
}
DEFAULT_DELIVERY = {"before": 0, "after": 400, "rate": 0}


@dataclass
class PreparedChunk:
    index: int
    lang: str
    text: str
    tokens: List[Tuple[int, int, int, int]]  # char_start, char_end, word_a, word_b (unit word idx, inclusive)
    word_range: Tuple[int, int]  # [a, b)
    rate: int = 0

    def to_json(self) -> dict:
        return {"i": self.index, "lang": self.lang, "words": list(self.word_range), "chars": len(self.text)}


@dataclass
class PrepOptions:
    max_chars: int = 900
    switch_voice_min_words: int = 4
    skip_citations: bool = True
    skip_footnote_marks: bool = True
    verbalize_math: bool = True


def _sentence_lang(texts: List[str], unit_lang: str, default: str) -> str:
    s = " ".join(texts)
    counts = script_counts(s)
    total = sum(counts.values()) or 1
    if unit_lang == "he":
        if counts.get("Hebrew", 0) < 0.15 * total and counts.get("Latin", 0) > 0.6 * total:
            return detect_language(s, "en")
        return "he"
    if counts.get("Hebrew", 0) > 0.5 * total:
        return "he"
    return unit_lang


def prepare_unit(unit: Unit, lexicon: Lexicon, opts: PrepOptions, vocab=None,
                 occurrences: Optional[Dict[Tuple[int, int], str]] = None) -> List[PreparedChunk]:
    occ_local: Dict[int, str] = {}
    if occurrences:
        for i, ref in enumerate(unit.words):
            if ref in occurrences:
                occ_local[i] = occurrences[ref]
    nopts = NormOptions(lang=unit.lang, vocab=vocab, skip_citations=opts.skip_citations,
                        skip_footnote_marks=opts.skip_footnote_marks, verbalize_math=opts.verbalize_math, kind=unit.kind)
    toks = normalize_words(unit.texts, unit.flags, nopts, lexicon, occ_local)
    # assign tokens to sentences by their first source word
    sent_of_word = {}
    for si, (a, b, _t) in enumerate(unit.sentences):
        for w in range(a, b):
            sent_of_word[w] = si
    groups: List[List[Tok]] = [[] for _ in unit.sentences] or [[]]
    for t in toks:
        si = sent_of_word.get(t.a, len(groups) - 1)
        groups[si].append(t)
    sent_langs = []
    for si, (a, b, _t) in enumerate(unit.sentences):
        words = unit.texts[a:b]
        lang = unit.lang
        if b - a >= opts.switch_voice_min_words:
            lang = _sentence_lang(words, unit.lang, unit.lang)
        sent_langs.append(lang)
    rate = DELIVERY.get(unit.kind, DEFAULT_DELIVERY)["rate"]
    chunks: List[PreparedChunk] = []
    cur: List[Tok] = []
    cur_lang: Optional[str] = None

    def flush():
        nonlocal cur
        if not cur:
            return
        parts = []
        tokens = []
        pos = 0
        for t in cur:
            if parts:
                parts.append(" ")
                pos += 1
            start = pos
            parts.append(t.text)
            pos += len(t.text)
            tokens.append((start, pos, t.a, t.b))
        text = "".join(parts)
        wa = min(t.a for t in cur)
        wb = max(t.b for t in cur) + 1
        chunks.append(PreparedChunk(len(chunks), cur_lang or unit.lang, text, tokens, (wa, wb), rate))
        cur = []

    for si, group in enumerate(groups):
        if not group:
            continue
        lang = sent_langs[si] if si < len(sent_langs) else unit.lang
        glen = sum(len(t.text) + 1 for t in group)
        cur_len = sum(len(t.text) + 1 for t in cur)
        if cur and (lang != cur_lang or cur_len + glen > opts.max_chars):
            flush()
        cur_lang = lang
        if glen > opts.max_chars * 1.6:
            # an extremely long sentence: split at commas/semicolons
            piece: List[Tok] = []
            plen = 0
            for t in group:
                piece.append(t)
                plen += len(t.text) + 1
                if plen > opts.max_chars and t.text[-1:] in ",;:":
                    cur.extend(piece)
                    flush()
                    cur_lang = lang
                    piece, plen = [], 0
            cur.extend(piece)
            continue
        cur.extend(group)
    flush()
    # make word ranges contiguous so every unit word belongs to exactly one chunk
    for i, c in enumerate(chunks):
        a = 0 if i == 0 else chunks[i - 1].word_range[1]
        b = len(unit.words) if i == len(chunks) - 1 else c.word_range[1]
        c.word_range = (a, max(a, b))
    return chunks


def delivery_for(kind: str) -> dict:
    return DELIVERY.get(kind, DEFAULT_DELIVERY)
