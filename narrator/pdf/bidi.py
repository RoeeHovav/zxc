"""Minimal Unicode Bidirectional Algorithm used to recover *logical* order from
glyphs that were sorted by their *visual* (geometric) position on a PDF page.

Why not python-bidi?  We need the permutation (which glyph goes where) so every
glyph keeps its bounding box, not just a reordered string.

The algorithm implemented here is UAX #9 restricted to a single paragraph with
no explicit embeddings/isolates (which PDFs never carry anyway):
W1-W7, N1-N2, I1-I2, L1 (trailing whitespace) and L2 (reordering).

Applying UBA to a visual-order string yields the logical order for the
overwhelmingly common cases (RTL text with embedded LTR runs and numbers),
because the L2 reversal is its own inverse for 2-3 level structures.
"""
from __future__ import annotations

import unicodedata
from typing import List, Sequence

STRONG_R = {"R", "AL"}
NEUTRAL = {"B", "S", "WS", "ON", "BN", "LRE", "RLE", "LRO", "RLO", "PDF", "LRI", "RLI", "FSI", "PDI"}


def bidi_class(ch: str) -> str:
    if not ch:
        return "ON"
    c = unicodedata.bidirectional(ch[0])
    return c or "ON"


def is_rtl_char(ch: str) -> bool:
    return bidi_class(ch) in STRONG_R


def is_ltr_char(ch: str) -> bool:
    return bidi_class(ch) == "L"


def resolve_levels(classes: Sequence[str], base_level: int) -> List[int]:
    """Return an embedding level for each item (UAX#9 W1-W7, N1-N2, I1-I2, L1)."""
    n = len(classes)
    if n == 0:
        return []
    t = list(classes)
    sos = "R" if base_level % 2 else "L"

    # W1: NSM takes the class of the previous char (sos at start)
    prev = sos
    for i in range(n):
        if t[i] == "NSM":
            t[i] = prev if prev not in NEUTRAL else "ON"
        prev = t[i]

    # W2: EN after AL becomes AN
    last_strong = sos
    for i in range(n):
        c = t[i]
        if c in ("L", "R", "AL"):
            last_strong = c
        elif c == "EN" and last_strong == "AL":
            t[i] = "AN"

    # W3: AL -> R
    for i in range(n):
        if t[i] == "AL":
            t[i] = "R"

    # W4: single separators between numbers
    for i in range(1, n - 1):
        if t[i] == "ES" and t[i - 1] == "EN" and t[i + 1] == "EN":
            t[i] = "EN"
        elif t[i] == "CS" and t[i - 1] == t[i + 1] and t[i - 1] in ("EN", "AN"):
            t[i] = t[i - 1]

    # W5: ET sequences adjacent to EN become EN
    i = 0
    while i < n:
        if t[i] == "ET":
            j = i
            while j < n and t[j] == "ET":
                j += 1
            if (i > 0 and t[i - 1] == "EN") or (j < n and t[j] == "EN"):
                for k in range(i, j):
                    t[k] = "EN"
            i = j
        else:
            i += 1

    # W6: remaining separators/terminators -> ON
    for i in range(n):
        if t[i] in ("ES", "ET", "CS"):
            t[i] = "ON"

    # W7: EN after L (or L sos) becomes L
    last_strong = sos
    for i in range(n):
        c = t[i]
        if c in ("L", "R"):
            last_strong = c
        elif c == "EN" and last_strong == "L":
            t[i] = "L"

    # N1/N2: neutrals
    def strong_dir(c: str) -> str | None:
        if c == "L":
            return "L"
        if c in ("R", "EN", "AN"):
            return "R"
        return None

    i = 0
    while i < n:
        if t[i] in NEUTRAL:
            j = i
            while j < n and t[j] in NEUTRAL:
                j += 1
            before = strong_dir(t[i - 1]) if i > 0 else sos
            after = strong_dir(t[j]) if j < n else sos
            if before is None:
                before = sos
            if after is None:
                after = sos
            fill = before if before == after else ("R" if base_level % 2 else "L")
            for k in range(i, j):
                t[k] = fill
            i = j
        else:
            i += 1

    # I1/I2
    levels = []
    for c in t:
        if base_level % 2 == 0:
            if c == "R":
                levels.append(base_level + 1)
            elif c in ("AN", "EN"):
                levels.append(base_level + 2)
            else:
                levels.append(base_level)
        else:
            if c in ("L", "EN", "AN"):
                levels.append(base_level + 1)
            else:
                levels.append(base_level)

    # L1: trailing whitespace goes to the paragraph level
    k = n - 1
    while k >= 0 and classes[k] in ("WS", "S", "B", "BN"):
        levels[k] = base_level
        k -= 1
    return levels


def reorder(levels: Sequence[int]) -> List[int]:
    """UAX#9 L2: return the permutation of indices after reversing runs."""
    order = list(range(len(levels)))
    if not levels:
        return order
    highest = max(levels)
    lowest_odd = min((lv for lv in levels if lv % 2), default=highest + 1)
    lv = list(levels)
    for level in range(highest, lowest_odd - 1, -1):
        i = 0
        n = len(order)
        while i < n:
            if lv[i] >= level:
                j = i
                while j < n and lv[j] >= level:
                    j += 1
                order[i:j] = order[i:j][::-1]
                lv[i:j] = lv[i:j][::-1]
                i = j
            else:
                i += 1
    return order


def visual_to_logical(items_text: Sequence[str], base_rtl: bool) -> List[int]:
    """Given the text of items in visual (left-to-right) order, return the
    indices of the items in logical order."""
    classes = []
    for s in items_text:
        if s == " ":
            classes.append("WS")
            continue
        # use the first strong class in the item, else the class of first char
        cls = None
        for ch in s:
            bc = bidi_class(ch)
            if bc in ("L", "R", "AL"):
                cls = bc
                break
        if cls is None:
            cls = bidi_class(s[0]) if s else "ON"
            if cls == "NSM":
                cls = "ON"
        classes.append(cls)
    levels = resolve_levels(classes, 1 if base_rtl else 0)
    return reorder(levels)


def logical_to_visual_string(text: str, base_rtl: bool) -> str:
    """Utility for tests/fixtures: produce the visual (display) string."""
    chars = list(text)
    classes = [bidi_class(c) for c in chars]
    levels = resolve_levels(classes, 1 if base_rtl else 0)
    order = reorder(levels)
    return "".join(chars[i] for i in order)


MIRROR = {"(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{", "<": ">", ">": "<",
          "«": "»", "»": "«", "‹": "›", "›": "‹"}


def mirror_char(ch: str) -> str:
    return MIRROR.get(ch, ch)
