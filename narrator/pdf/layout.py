"""Page layout analysis: PDF glyphs -> words -> lines -> blocks in reading order.

Design notes
------------
* We never trust the content-stream order of a PDF.  Word processors (MS Word in
  particular) emit Hebrew/Arabic text with punctuation, numbers and spaces out of
  logical order.  Instead every glyph is placed by geometry and the logical order
  is recovered with the Unicode Bidirectional Algorithm (see ``bidi.py``).
* Combining marks (Hebrew niqqud, Arabic harakat, Latin accents) are attached to
  their base glyph so they move with it during reordering.
* Word boundaries come from real (non zero-width) space glyphs *and* from
  geometric gaps, which fixes PDFs that drop the space at direction changes
  (e.g. ``בשנת1992``).
* Coordinates are PDF points in the *displayed* (rotation-applied) page space,
  origin top-left, which is exactly the space the page image is rendered in.
"""
from __future__ import annotations

import math
import re
import statistics
import unicodedata
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

import pymupdf

from .bidi import bidi_class, mirror_char, visual_to_logical

# Characters that carry no visible content and only confuse text processing.
_INVISIBLE = {
    "­", "​", "‌", "‍", "‎", "‏", "‪", "‫", "‬",
    "‭", "‮", "⁦", "⁧", "⁨", "⁩", "﻿", "⁠",
}
_BULLETS = set("•◦▪▫■□●○◆◇►▶➢➤✓✔✗✘-–—*·⁃∙")
_LEADER_RE = re.compile(r"(\.{4,}|…{2,}|(\. ){3,}|_{4,}|·{4,})")
_ENUM_RE = re.compile(
    r"^(\(?\d{1,3}[.)]|\(?[a-zA-Z][.)]|\(?[א-ת]['׳]?[.)]|[ivxIVX]{1,4}[.)]|\d{1,2}(\.\d{1,2}){1,4}\.?)$"
)
_SENT_END = set(".!?…:;؟。")


@dataclass
class Glyph:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    size: float
    bold: bool
    italic: bool
    baseline: float
    seq: int
    font: str = ""
    script: bool = False  # superscript / subscript

    @property
    def xc(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def is_space(self) -> bool:
        return self.text == " "


@dataclass
class Space:
    x0: float
    x1: float
    baseline: float
    size: float

    @property
    def xc(self) -> float:
        return (self.x0 + self.x1) / 2


@dataclass
class Word:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    size: float
    bold: bool
    rtl: bool
    script: bool = False
    italic: bool = False
    glyphs: Optional[List["Glyph"]] = field(default=None, repr=False, compare=False)

    def bbox(self) -> Tuple[float, float, float, float]:
        return (self.x0, self.y0, self.x1, self.y1)


@dataclass
class Line:
    glyphs: List[Glyph]
    spaces: List[Space] = field(default_factory=list)
    words: List[Word] = field(default_factory=list)
    rtl: bool = False
    bullet: bool = False  # a vector-drawn bullet precedes the line

    @property
    def x0(self) -> float:
        return min(g.x0 for g in self.glyphs)

    @property
    def x1(self) -> float:
        return max(g.x1 for g in self.glyphs)

    @property
    def y0(self) -> float:
        return min(g.y0 for g in self.glyphs if not g.script) if any(not g.script for g in self.glyphs) else min(g.y0 for g in self.glyphs)

    @property
    def y1(self) -> float:
        return max(g.y1 for g in self.glyphs if not g.script) if any(not g.script for g in self.glyphs) else max(g.y1 for g in self.glyphs)

    @property
    def baseline(self) -> float:
        main = [g.baseline for g in self.glyphs if not g.script] or [g.baseline for g in self.glyphs]
        return statistics.median(main)

    @property
    def size(self) -> float:
        main = [g.size for g in self.glyphs if not g.script] or [g.size for g in self.glyphs]
        return statistics.median(main)

    @property
    def bold(self) -> bool:
        letters = [g for g in self.glyphs if g.text.strip() and not g.script]
        if not letters:
            return False
        return sum(1 for g in letters if g.bold) >= 0.8 * len(letters)

    @property
    def text(self) -> str:
        return " ".join(w.text for w in self.words)


@dataclass
class Block:
    lines: List[Line]
    rtl: bool = False
    kind: str = "paragraph"
    level: int = 0

    @property
    def x0(self) -> float:
        return min(l.x0 for l in self.lines)

    @property
    def x1(self) -> float:
        return max(l.x1 for l in self.lines)

    @property
    def y0(self) -> float:
        return min(l.y0 for l in self.lines)

    @property
    def y1(self) -> float:
        return max(l.y1 for l in self.lines)

    @property
    def size(self) -> float:
        sizes = [l.size for l in self.lines]
        return statistics.median(sizes) if sizes else 0

    @property
    def bold(self) -> bool:
        return all(l.bold for l in self.lines)

    @property
    def text(self) -> str:
        return " ".join(l.text for l in self.lines)


@dataclass
class PageLayout:
    width: float
    height: float
    blocks: List[Block]
    images: List[Tuple[float, float, float, float]]
    rtl: bool
    glyph_count: int
    garbled_ratio: float
    warnings: List[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Glyph collection
# ---------------------------------------------------------------------------

def _is_mark(ch: str) -> bool:
    return unicodedata.combining(ch) != 0 or unicodedata.category(ch) in ("Mn", "Me")


def collect_glyphs(page: pymupdf.Page, textpage=None) -> Tuple[List[Glyph], List[Space], int, List[str]]:
    """Return glyphs (marks attached), real spaces, count of skipped rotated chars."""
    flags = pymupdf.TEXT_PRESERVE_WHITESPACE | pymupdf.TEXT_MEDIABOX_CLIP
    raw = page.get_text("rawdict", flags=flags, textpage=textpage)
    mat = page.rotation_matrix if page.rotation else None
    items: list = []
    rotated = 0
    warnings: List[str] = []
    seq = 0
    for block in raw.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block["lines"]:
            dx, dy = line.get("dir", (1, 0))
            if mat is not None:
                # direction in display space
                d = pymupdf.Point(dx, dy) * mat - pymupdf.Point(0, 0) * mat
                dx, dy = d.x, d.y
            if abs(dy) > 0.08 or dx < 0:
                rotated += sum(len(s["chars"]) for s in line["spans"])
                continue
            for span in line["spans"]:
                size = float(span["size"])
                flags_ = span.get("flags", 0)
                font = span.get("font", "")
                bold = bool(flags_ & 16) or "bold" in font.lower() or "black" in font.lower()
                italic = bool(flags_ & 2) or "italic" in font.lower() or "oblique" in font.lower()
                for ch in span["chars"]:
                    c = ch["c"]
                    x0, y0, x1, y1 = ch["bbox"]
                    ox, oy = ch["origin"]
                    if mat is not None:
                        r = pymupdf.Rect(x0, y0, x1, y1) * mat
                        x0, y0, x1, y1 = r.x0, r.y0, r.x1, r.y1
                        o = pymupdf.Point(ox, oy) * mat
                        ox, oy = o.x, o.y
                    seq += 1
                    if c in _INVISIBLE or c == "" or unicodedata.category(c) == "Cc":
                        continue
                    if c in "ﬀﬁﬂﬃﬄ":
                        c = unicodedata.normalize("NFKC", c)
                    kind = "space" if c.isspace() else ("mark" if _is_mark(c) else "base")
                    items.append((kind, c, x0, y0, x1, y1, ox, oy, size, bold, italic, seq, font))
    glyphs, spaces = _assemble(items)
    if rotated:
        warnings.append(f"{rotated} characters of rotated/vertical text were skipped")
    return glyphs, spaces, rotated, warnings


def _assemble(raw: list) -> Tuple[List[Glyph], List[Space]]:
    """Build glyphs from raw characters.

    Two producer conventions for combining marks are handled:
    * MS Word: base letter first, marks after it, all sharing the base origin.
    * Chrome/Skia: marks first, a zero-width base glyph, then a pseudo "space"
      that carries the cluster's advance width.
    Marks are matched to the base glyph with the same origin x (nearest in
    stream order), which is correct for both.
    """
    n = len(raw)
    consumed = [False] * n
    glyph_of: Dict[int, Glyph] = {}
    glyphs: List[Glyph] = []
    for i, r in enumerate(raw):
        kind, c, x0, y0, x1, y1, ox, oy, size, bold, italic, seq, font = r
        if kind != "base":
            continue
        if x1 - x0 < 0.05 * size:
            # zero-width base whose advance is carried by an adjacent pseudo
            # space glyph (Skia); the space may follow or precede the cluster
            for step in (1, -1):
                j = i + step
                while 0 <= j < n and raw[j][0] == "mark":
                    j += step
                if 0 <= j < n and raw[j][0] == "space" and not consumed[j] and abs(raw[j][7] - oy) < 0.3 * size and (
                        abs(raw[j][4] - ox) < 0.6 or abs(raw[j][2] - ox) < 0.6):
                    x0, x1 = raw[j][2], raw[j][4]
                    consumed[j] = True
                    break
        g = Glyph(c, x0, y0, x1, y1, size, bold, italic, oy, seq, font)
        g._ox = ox  # type: ignore[attr-defined]
        glyph_of[i] = g
        glyphs.append(g)
    for i, r in enumerate(raw):
        if r[0] != "mark":
            continue
        mark, mx0, mx1, mox, moy, msize = r[1], r[2], r[4], r[6], r[7], r[8]
        best = None
        best_key = None
        for j in range(max(0, i - 5), min(n, i + 6)):
            g = glyph_of.get(j)
            if g is None or abs(g.baseline - moy) > 0.5 * max(msize, g.size):
                continue
            d_origin = abs(getattr(g, "_ox", g.x0) - mox)
            inside = g.x0 - 0.3 * msize <= (mx0 + mx1) / 2 <= g.x1 + 0.3 * msize
            if d_origin > 0.6 and not inside:
                continue
            key = (0 if d_origin <= 0.6 else 1, abs(j - i), 0 if j < i else 1)
            if best_key is None or key < best_key:
                best, best_key = g, key
        if best is None:
            xc = (mx0 + mx1) / 2
            bd = 1e9
            for j in range(max(0, i - 40), min(n, i + 40)):
                g = glyph_of.get(j)
                if g is None or abs(g.baseline - moy) > 0.6 * max(msize, g.size):
                    continue
                d = 0 if g.x0 <= xc <= g.x1 else min(abs(g.x0 - xc), abs(g.x1 - xc))
                if d < bd:
                    best, bd = g, d
            if bd > 1.5 * msize:
                best = None
        if best is not None:
            best.text += mark
    spaces = [Space(r[2], r[4], r[7], r[8]) for i, r in enumerate(raw)
              if r[0] == "space" and not consumed[i] and r[4] - r[2] > 0.05 * r[8]]
    return glyphs, spaces


# ---------------------------------------------------------------------------
# Lines
# ---------------------------------------------------------------------------

def _cluster_baselines(glyphs: List[Glyph]) -> List[List[Glyph]]:
    glyphs = sorted(glyphs, key=lambda g: (g.baseline, g.x0))
    clusters: List[List[Glyph]] = []
    cur: List[Glyph] = []
    cur_base = None
    cur_size = 0.0
    for g in glyphs:
        if cur and abs(g.baseline - cur_base) <= 0.3 * max(cur_size, g.size):
            cur.append(g)
            # running baseline of large glyphs dominates
            n = len(cur)
            cur_base = cur_base + (g.baseline - cur_base) / n
            cur_size = max(cur_size, g.size)
        else:
            if cur:
                clusters.append(cur)
            cur = [g]
            cur_base = g.baseline
            cur_size = g.size
    if cur:
        clusters.append(cur)
    return clusters


def _attach_scripts(clusters: List[List[Glyph]]) -> List[List[Glyph]]:
    """Merge tiny clusters of small glyphs (footnote markers, exponents) into the
    neighbouring line whose vertical band they sit in."""
    out: List[List[Glyph]] = []
    small = []
    for c in clusters:
        if len(c) <= 6:
            small.append(c)
        else:
            out.append(c)
    if not out:
        return clusters
    merged_into = {}
    for c in small:
        csize = max(g.size for g in c)
        cx0 = min(g.x0 for g in c)
        cx1 = max(g.x1 for g in c)
        cy0 = min(g.y0 for g in c)
        cy1 = max(g.y1 for g in c)
        cyc = (cy0 + cy1) / 2
        target = None
        for line in out:
            lsize = statistics.median(g.size for g in line)
            if csize > 0.85 * lsize:
                continue
            ly0 = min(g.y0 for g in line)
            ly1 = max(g.y1 for g in line)
            if not (ly0 - 0.35 * lsize <= cyc <= ly1 + 0.15 * lsize):
                continue
            # horizontally adjacent to some glyph of the line
            near = any(g.x0 - 1.5 * lsize <= cx1 and cx0 <= g.x1 + 1.5 * lsize for g in line)
            if near:
                target = line
                break
        if target is not None:
            for g in c:
                g.script = True
            target.extend(c)
            merged_into[id(c)] = True
        else:
            out.append(c)
    return out


def _split_segments(cluster: List[Glyph], gutters: Sequence[Tuple[float, float]]) -> List[List[Glyph]]:
    cluster = sorted(cluster, key=lambda g: (g.xc, g.seq))
    size = statistics.median(g.size for g in cluster)
    gaps = [b.x0 - a.x1 for a, b in zip(cluster, cluster[1:])]
    word_gaps = sorted(g for g in gaps if g > 0.15 * size)
    med_gap = word_gaps[len(word_gaps) // 2] if word_gaps else 0.3 * size
    segs: List[List[Glyph]] = [[cluster[0]]]
    for prev, g, gap in zip(cluster, cluster[1:], gaps):
        split = gap > max(4.5 * size, 3.2 * med_gap, 18.0)
        if not split and gap > 0.4 * size:
            for gx0, gx1 in gutters:
                if prev.x1 <= gx1 + 1 and g.x0 >= gx0 - 1:
                    split = True
                    break
        if split:
            segs.append([g])
        else:
            segs[-1].append(g)
    return segs


def detect_gutters(clusters: List[List[Glyph]], page_x0: float, page_x1: float) -> List[Tuple[float, float]]:
    """Find vertical whitespace channels that separate text columns.

    Coverage counts, for every x position, how many text lines have a glyph
    there.  Word gaps fall at random positions so they never form a channel,
    whereas a column gutter is empty in (nearly) every line -- this works even
    for justified text whose word gaps are as wide as the gutter.
    """
    lines = [c for c in clusters if len(c) >= 6]
    if len(lines) < 8:
        return []
    width = int(page_x1 - page_x0) + 2
    cover = [0] * width
    for c in lines:
        seen = set()
        for g in c:
            for x in range(max(0, int(g.x0 - page_x0)), min(width, int(math.ceil(g.x1 - page_x0)))):
                seen.add(x)
        for x in seen:
            cover[x] += 1
    occupied = [i for i, v in enumerate(cover) if v > 0]
    if not occupied:
        return []
    left, right = occupied[0], occupied[-1]
    span = right - left
    nl = len(lines)
    thresh = max(1, int(0.15 * nl))
    med_size = statistics.median(g.size for c in lines for g in c)
    gutters = []
    i = left
    while i <= right:
        if cover[i] <= thresh:
            j = i
            while j <= right and cover[j] <= thresh:
                j += 1
            w = j - i
            lside = sorted(cover[max(left, i - 40):i] or [0])[-3:]
            rside = sorted(cover[j:min(right, j + 40)] or [0])[-3:]
            if (w >= max(6, 0.6 * med_size) and min(lside) >= 0.35 * nl and min(rside) >= 0.35 * nl
                    and (i - left) > 0.15 * span and (right - j) > 0.15 * span):
                gutters.append((i + page_x0, j + page_x0))
            i = j
        else:
            i += 1
    return gutters


def build_lines(glyphs: List[Glyph], spaces: List[Space], page_rect: pymupdf.Rect) -> List[Line]:
    if not glyphs:
        return []
    clusters = _cluster_baselines(glyphs)
    clusters = _attach_scripts(clusters)
    gutters = detect_gutters(clusters, page_rect.x0, page_rect.x1)
    lines: List[Line] = []
    for c in clusters:
        for seg in _split_segments(c, gutters):
            lines.append(Line(glyphs=seg))
    # assign spaces to lines
    if spaces:
        for sp in spaces:
            best = None
            for ln in lines:
                if abs(ln.baseline - sp.baseline) <= 0.35 * ln.size and ln.x0 - sp.size <= sp.xc <= ln.x1 + sp.size:
                    best = ln
                    break
            if best is not None:
                best.spaces.append(sp)
    return lines


# ---------------------------------------------------------------------------
# Words (visual -> logical)
# ---------------------------------------------------------------------------

def _line_items(line: Line) -> List[Tuple[str, Optional[Glyph]]]:
    """Visual-order items: glyphs plus inserted word-break markers."""
    gs = sorted(line.glyphs, key=lambda g: (g.xc, g.seq))
    sps = sorted(line.spaces, key=lambda s: s.xc)
    items: List[Tuple[str, Optional[Glyph]]] = []
    si = 0
    for i, g in enumerate(gs):
        if i > 0:
            prev = gs[i - 1]
            brk = False
            # real space glyph between the two glyphs
            while si < len(sps) and sps[si].xc < prev.xc:
                si += 1
            if si < len(sps) and prev.xc < sps[si].xc < g.xc:
                # a real (non zero-width) space glyph sits between the two glyph
                # centres.  Glyph boxes may overlap in condensed fonts, so only
                # centres are compared.
                brk = True
            gap = g.x0 - prev.x1
            size = min(prev.size, g.size) if not (prev.script or g.script) else max(prev.size, g.size)
            if prev.script != g.script:
                # superscripts glued to a word are a separate token (footnote ref / exponent)
                brk = brk or gap > 0.05 * size
            if gap > 0.22 * size:
                brk = True
            if brk:
                items.append((" ", None))
        items.append((g.text, g))
    return items


def words_for_line(line: Line, base_rtl: bool, mirror: bool) -> List[Word]:
    items = _line_items(line)
    texts = [t if g is not None else " " for t, g in items]
    order = visual_to_logical(texts, base_rtl)
    words: List[Word] = []
    cur: List[Glyph] = []

    def flush():
        if not cur:
            return
        txt_parts = []
        rtl_word = any(bidi_class(g.text[0]) in ("R", "AL") for g in cur)
        for g in cur:
            t = g.text
            if mirror and rtl_word and len(t) == 1:
                t = mirror_char(t)
            txt_parts.append(t)
        text = unicodedata.normalize("NFC", "".join(txt_parts))
        words.append(Word(
            text=text,
            x0=min(g.x0 for g in cur), y0=min(g.y0 for g in cur),
            x1=max(g.x1 for g in cur), y1=max(g.y1 for g in cur),
            size=statistics.median(g.size for g in cur),
            bold=sum(g.bold for g in cur) * 2 > len(cur),
            italic=sum(g.italic for g in cur) * 2 > len(cur),
            rtl=rtl_word,
            script=all(g.script for g in cur),
            glyphs=list(cur),
        ))
        cur.clear()

    for idx in order:
        t, g = items[idx]
        if g is None:
            flush()
        else:
            cur.append(g)
    flush()
    return words


# ---------------------------------------------------------------------------
# Blocks
# ---------------------------------------------------------------------------

def _overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def _strong_counts(glyphs: Sequence[Glyph]) -> Tuple[int, int]:
    r = l = 0
    for g in glyphs:
        c = bidi_class(g.text[0])
        if c in ("R", "AL"):
            r += 1
        elif c == "L":
            l += 1
    return r, l


def group_blocks(lines: List[Line], page_rtl: bool) -> List[Block]:
    lines = sorted(lines, key=lambda l: (l.y0, -l.x1 if page_rtl else l.x0))
    blocks: List[Block] = []
    open_blocks: List[Block] = []
    for ln in lines:
        best = None
        best_gap = 1e9
        for b in open_blocks:
            last = b.lines[-1]
            size = max(last.size, ln.size)
            gap = ln.y0 - last.y1
            if gap < -0.4 * size or gap > 1.0 * size:
                continue
            if not (0.9 <= ln.size / max(last.size, 0.1) <= 1.11):
                continue
            ov = _overlap(last.x0, last.x1, ln.x0, ln.x1)
            minw = min(last.x1 - last.x0, ln.x1 - ln.x0)
            aligned = (abs(last.x1 - ln.x1) < 2.5 * size) if page_rtl else (abs(last.x0 - ln.x0) < 2.5 * size)
            if ov < 0.3 * minw and not (aligned and ov > 0):
                continue
            # consistent line pitch
            if len(b.lines) >= 2:
                pitch = b.lines[-1].baseline - b.lines[-2].baseline
                newp = ln.baseline - last.baseline
                if abs(newp - pitch) > 0.45 * size:
                    continue
            if ln.bold != last.bold and (ln.bold or b.bold):
                # headings are usually fully bold lines
                if len(ln.glyphs) < 120 or len(last.glyphs) < 120:
                    continue
            if gap < best_gap:
                best, best_gap = b, gap
        if best is None:
            nb = Block(lines=[ln])
            blocks.append(nb)
            open_blocks.append(nb)
        else:
            best.lines.append(ln)
        # close blocks that are far above
        open_blocks = [b for b in open_blocks if ln.y0 - b.lines[-1].y1 < 3 * b.lines[-1].size]
    return blocks


def split_paragraphs(block: Block, typ_w: float = 0.0) -> List[Block]:
    """Split a geometric block into paragraphs/list items."""
    if len(block.lines) <= 1:
        return [block]
    rtl = block.rtl
    bx0, bx1 = block.x0, block.x1
    width = bx1 - bx0
    pitches = [b.baseline - a.baseline for a, b in zip(block.lines, block.lines[1:])]
    med_pitch = statistics.median(pitches) if pitches else 0
    out: List[Block] = []
    cur = [block.lines[0]]
    for a, b in zip(block.lines, block.lines[1:]):
        size = a.size
        brk = False
        a_text = a.text.strip().rstrip('"\'”’״׳)]»')
        b_text = b.text.strip()
        end_edge_gap = (a.x0 - bx0) if rtl else (bx1 - a.x1)
        start_indent = (bx1 - b.x1) if rtl else (b.x0 - bx0)
        prev_start_indent = (bx1 - a.x1) if rtl else (a.x0 - bx0)
        if a_text and a_text[-1] in _SENT_END and end_edge_gap > max(0.12 * width, 3 * size):
            brk = True
        if (b.baseline - a.baseline) > med_pitch + 0.45 * size and med_pitch > 0:
            brk = True
        marker = starts_list_item(b)
        if marker == "enum" or (marker == "bullet" and (
                b.words[0].text not in ("-", "–", "—", "*") or (a_text and a_text[-1] in _SENT_END))):
            brk = True
        if start_indent > 1.2 * size and prev_start_indent < 0.5 * size and a_text and a_text[-1] in _SENT_END:
            brk = True
        if typ_w and a_text and a_text[-1] in _SENT_END and width < 0.8 * typ_w and (a.x1 - a.x0) < 0.8 * typ_w:
            # a block much narrower than the text column whose lines end in
            # full stops: list items rendered without bullet glyphs
            brk = True
        if brk:
            out.append(Block(lines=cur, rtl=rtl))
            cur = [b]
        else:
            cur.append(b)
    out.append(Block(lines=cur, rtl=rtl))
    return out


def starts_list_item(line: Line) -> Optional[str]:
    if not line.words:
        return None
    if line.bullet:
        return "bullet"
    first = line.words[0].text
    if first and all(ch in _BULLETS for ch in first) and len(first) <= 2:
        return "bullet"
    if _ENUM_RE.match(first):
        return "enum"
    if first[:1] in _BULLETS - {"-", "–", "—", "*"} and len(first) > 1:
        return "bullet"
    return None


def xy_cut_order(blocks: List[Block], rtl: bool) -> List[Block]:
    """Recursive XY-cut: horizontal bands top->bottom, columns in script order."""
    if len(blocks) <= 1:
        return list(blocks)

    def hcut(bs: List[Block]) -> List[List[Block]]:
        bs = sorted(bs, key=lambda b: b.y0)
        groups = [[bs[0]]]
        bottom = bs[0].y1
        for b in bs[1:]:
            if b.y0 >= bottom - 0.5:
                groups.append([b])
            else:
                groups[-1].append(b)
            bottom = max(bottom, b.y1)
        return groups

    def vcut(bs: List[Block]) -> List[List[Block]]:
        bs = sorted(bs, key=lambda b: b.x0)
        groups = [[bs[0]]]
        right = bs[0].x1
        for b in bs[1:]:
            if b.x0 >= right - 0.5:
                groups.append([b])
            else:
                groups[-1].append(b)
            right = max(right, b.x1)
        if rtl:
            groups.reverse()
        return groups

    def rec(bs: List[Block], depth: int) -> List[Block]:
        if len(bs) <= 1 or depth > 40:
            return sorted(bs, key=lambda b: (b.y0, -b.x1 if rtl else b.x0))
        hg = hcut(bs)
        if len(hg) > 1:
            return [x for g in hg for x in rec(g, depth + 1)]
        vg = vcut(bs)
        if len(vg) > 1:
            return [x for g in vg for x in rec(g, depth + 1)]
        return sorted(bs, key=lambda b: (b.y0, -b.x1 if rtl else b.x0))

    return rec(list(blocks), 0)


# ---------------------------------------------------------------------------
# Page analysis entry point
# ---------------------------------------------------------------------------

def analyze_page(page: pymupdf.Page, mirror: bool = False, textpage=None) -> PageLayout:
    rect = page.rect  # already rotation-aware display rect
    glyphs, spaces, rotated, warnings = collect_glyphs(page, textpage=textpage)
    garbled = sum(1 for g in glyphs if "�" in g.text)
    garbled_ratio = garbled / max(1, len(glyphs))
    glyphs = [g for g in glyphs if "�" not in g.text]
    r, l = _strong_counts(glyphs)
    page_rtl = r > l
    lines = build_lines(glyphs, spaces, rect)
    raw_blocks = group_blocks(lines, page_rtl)
    bullets = _vector_bullets(page)
    widths = sorted(l.x1 - l.x0 for l in lines if len(l.glyphs) >= 15)
    typ_w = widths[int(0.9 * (len(widths) - 1))] if widths else 0.0
    blocks: List[Block] = []
    for b in raw_blocks:
        rr, ll = _strong_counts([g for ln in b.lines for g in ln.glyphs])
        b.rtl = rr > ll if (rr or ll) else page_rtl
        for ln in b.lines:
            lr, lll = _strong_counts(ln.glyphs)
            # a line's base direction follows its paragraph unless it is
            # unambiguously in the other script
            line_rtl = b.rtl
            if b.rtl and lll > 0 and lr == 0:
                line_rtl = False
            elif not b.rtl and lr > 0 and lll == 0:
                line_rtl = True
            ln.rtl = line_rtl
            ln.words = words_for_line(ln, line_rtl, mirror)
            if bullets:
                ln.bullet = _has_bullet(ln, bullets)
        blocks.extend(split_paragraphs(b, typ_w))
    blocks = [b for b in blocks if any(ln.words for ln in b.lines)]
    if page_rtl and _stream_is_logical(blocks):
        _fix_section_labels(blocks)
    blocks = xy_cut_order(blocks, page_rtl)
    images = []
    try:
        for info in page.get_image_info():
            x0, y0, x1, y1 = info["bbox"]
            if page.rotation:
                rr_ = pymupdf.Rect(x0, y0, x1, y1) * page.rotation_matrix
                x0, y0, x1, y1 = rr_.x0, rr_.y0, rr_.x1, rr_.y1
            x0, y0 = max(x0, rect.x0), max(y0, rect.y0)
            x1, y1 = min(x1, rect.x1), min(y1, rect.y1)
            if x1 - x0 > 4 and y1 - y0 > 4:
                images.append((x0, y0, x1, y1))
    except Exception as exc:  # pragma: no cover - defensive
        warnings.append(f"image scan failed: {exc}")
    return PageLayout(
        width=rect.width, height=rect.height, blocks=blocks, images=images, rtl=page_rtl,
        glyph_count=len(glyphs), garbled_ratio=garbled_ratio, warnings=warnings,
    )


def _vector_bullets(page: pymupdf.Page) -> List[Tuple[float, float, float]]:
    """Small filled shapes (circles/squares) drawn as vector graphics -- how
    browsers and some word processors render list bullets."""
    try:
        drawings = page.get_cdrawings() if hasattr(page, "get_cdrawings") else page.get_drawings()
    except Exception:
        return []
    if len(drawings) > 3000:
        return []
    out = []
    mat = page.rotation_matrix if page.rotation else None
    for d in drawings:
        if not d.get("fill"):
            continue
        r = pymupdf.Rect(d["rect"])
        if mat is not None:
            r = r * mat
        w, h = r.width, r.height
        if 1.2 <= w <= 9 and 1.2 <= h <= 9 and 0.6 <= w / max(h, 1e-3) <= 1.6:
            out.append(((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, max(w, h)))
    return out


def _has_bullet(ln: Line, bullets) -> bool:
    size = ln.size
    yc = (ln.y0 + ln.y1) / 2
    for bx, by, bs in bullets:
        if abs(by - yc) > 0.6 * size:
            continue
        if ln.rtl and ln.x1 <= bx <= ln.x1 + 2.8 * size:
            return True
        if not ln.rtl and ln.x0 - 2.8 * size <= bx <= ln.x0:
            return True
    return False


_LABEL_RE = re.compile(r"^\d+(\.\d+)+\.?$")


def _stream_is_logical(blocks: List[Block]) -> bool:
    """True when RTL words appear in the content stream in logical order
    (true for Word/LibreOffice/browser output, false for 'visual' PDFs)."""
    good = bad = 0
    for b in blocks:
        for ln in b.lines:
            for w in ln.words:
                if not w.rtl or not w.glyphs or len(w.glyphs) < 3:
                    continue
                seqs = [g.seq for g in w.glyphs]
                inc = all(a < c for a, c in zip(seqs, seqs[1:]))
                dec = all(a > c for a, c in zip(seqs, seqs[1:]))
                good += inc
                bad += dec
    return good > 3 * max(bad, 1)


def _fix_section_labels(blocks: List[Block]) -> None:
    """Word renders multi-level numbers in RTL paragraphs reversed ("5.3" is
    displayed as "3.5").  The content stream keeps the author's order, so for a
    numeric label at the start of an RTL line we trust the stream."""
    for b in blocks:
        for ln in b.lines:
            if not ln.rtl or not ln.words:
                continue
            w = ln.words[0]
            if not w.glyphs or not _LABEL_RE.match(w.text):
                continue
            by_seq = "".join(g.text for g in sorted(w.glyphs, key=lambda g: g.seq))
            if by_seq != w.text and _LABEL_RE.match(by_seq):
                w.text = by_seq


def is_leader_line(text: str) -> bool:
    return bool(_LEADER_RE.search(text))
