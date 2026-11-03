"""Map speech-engine word boundaries back to source words.

Engines report boundaries either with a character offset into the submitted
text (Azure SDK) or only with the spoken word text (Edge).  We align
sequentially, tolerant of tokens the engine merges, splits or skips.  Words
without a boundary get times interpolated from their neighbours, and the result
says honestly whether timing is word-exact or estimated.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

from ..text.normalize import strip_niqqud


@dataclass
class Boundary:
    start: float  # seconds
    duration: float
    text: str
    char_offset: Optional[int] = None


def _norm(s: str) -> str:
    s = strip_niqqud(unicodedata.normalize("NFC", s))
    return re.sub(r"[^\w]", "", s.lower())


def align(chunk_text: str, tokens: Sequence[Tuple[int, int, int, int]], boundaries: Sequence[Boundary],
          duration: float, word_range: Tuple[int, int]) -> Tuple[List[Tuple[int, float, float]], str]:
    """Return ([(unit_word_index, start, end)], timing_quality)."""
    n = len(tokens)
    tok_start: List[Optional[float]] = [None] * n
    tok_end: List[Optional[float]] = [None] * n
    matched = 0
    if boundaries:
        cursor = 0
        norm_text = chunk_text
        for bd in boundaries:
            pos = None
            if bd.char_offset is not None and 0 <= bd.char_offset < len(chunk_text):
                pos = bd.char_offset
            else:
                needle = bd.text.strip()
                if not needle:
                    continue
                p = norm_text.find(needle, cursor)
                if p < 0 or p - cursor > 200:
                    # try a punctuation/niqqud-insensitive search on the next tokens
                    target = _norm(needle)
                    p = None
                    for ti in range(_token_at(tokens, cursor), min(n, _token_at(tokens, cursor) + 8)):
                        s, e, _, _ = tokens[ti]
                        if target and target in _norm(chunk_text[s:e]):
                            p = s
                            break
                    if p is None:
                        continue
                pos = p
                cursor = p + max(1, len(needle))
            ti = _token_at(tokens, pos)
            if ti is None:
                continue
            st, en = bd.start, bd.start + max(bd.duration, 0.02)
            if tok_start[ti] is None or st < tok_start[ti]:
                tok_start[ti] = st
            if tok_end[ti] is None or en > tok_end[ti]:
                tok_end[ti] = en
            matched += 1
    quality = "word" if n and matched and sum(1 for x in tok_start if x is not None) >= 0.6 * n else "estimated"
    _interpolate(tokens, tok_start, tok_end, duration)
    # tokens -> words (a token may cover several words, a word may be split)
    words: dict = {}
    for ti, (s, e, wa, wb) in enumerate(tokens):
        st, en = tok_start[ti], tok_end[ti]
        span = wb - wa + 1
        for k, w in enumerate(range(wa, wb + 1)):
            ws = st + (en - st) * k / span
            we = st + (en - st) * (k + 1) / span
            if w in words:
                words[w] = (min(words[w][0], ws), max(words[w][1], we))
            else:
                words[w] = (ws, we)
    a, b = word_range
    out = []
    last = 0.0
    for w in range(a, b):
        if w in words:
            st, en = words[w]
            last = en
            out.append((w, round(st, 3), round(en, 3)))
        else:
            # word with no spoken token (e.g. dropped leader dots) gets a zero-length slot
            out.append((w, round(last, 3), round(last, 3)))
    return out, quality


def _token_at(tokens, pos) -> Optional[int]:
    if pos is None:
        return None
    lo, hi = 0, len(tokens) - 1
    best = None
    while lo <= hi:
        mid = (lo + hi) // 2
        s, e, _, _ = tokens[mid]
        if pos < s:
            hi = mid - 1
        elif pos >= e + 1:  # include the following space
            lo = mid + 1
        else:
            return mid
        best = mid
    return min(max(best or 0, 0), len(tokens) - 1) if tokens else None


def _interpolate(tokens, tok_start, tok_end, duration: float) -> None:
    n = len(tokens)
    if n == 0:
        return
    weights = [max(1, e - s) + (6 if tokens[i][1] and i < n else 0) for i, (s, e, _, _) in enumerate(tokens)]
    known = [i for i in range(n) if tok_start[i] is not None]
    if not known:
        total = sum(weights) or 1
        # leave a little lead-in/out silence typical of TTS output
        lead = min(0.15, duration * 0.03)
        usable = max(0.0, duration - 2 * lead)
        t = lead
        for i in range(n):
            d = usable * weights[i] / total
            tok_start[i], tok_end[i] = t, t + d
            t += d
        return
    # fill gaps between known anchors proportionally to token length
    anchors = [(-1, 0.0)] + [(i, tok_start[i]) for i in known] + [(n, duration)]
    for (i0, t0), (i1, t1) in zip(anchors, anchors[1:]):
        if i1 - i0 <= 1:
            continue
        start_t = tok_end[i0] if i0 >= 0 and tok_end[i0] is not None else t0
        span = max(0.0, t1 - start_t)
        mids = list(range(i0 + 1, i1))
        total = sum(weights[i] for i in mids) or 1
        t = start_t
        for i in mids:
            d = span * weights[i] / total
            tok_start[i], tok_end[i] = t, t + d
            t += d
    for i in range(n):
        if tok_end[i] is None or tok_end[i] < tok_start[i]:
            tok_end[i] = tok_start[i]
