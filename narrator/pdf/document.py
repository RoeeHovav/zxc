"""Document-level PDF processing.

* Page layouts are computed lazily (on demand, plus a background sweep) and
  cached on disk as compact JSON so a 1000-page document is never re-analysed.
* Document statistics learnt from a spread-out sample of pages drive
  classification: body font size, repeated headers/footers, decorative images.
* Blocks are classified (heading/paragraph/list/caption/footnote/...) and
  paragraphs that continue across a page (or column) break are flagged so the
  narrator can read them as one uninterrupted passage.
"""
from __future__ import annotations

import gzip
import json
import logging
import os
import re
import shutil
import statistics
import threading
from collections import Counter
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import pymupdf

from . import layout as L
from .ocr import OcrEngine

log = logging.getLogger(__name__)

EXTRACTOR_VERSION = 8

# word flags
F_RTL = 1
F_BOLD = 2
F_SCRIPT = 4
F_ITALIC = 8

_PAGE_NUM_RE = re.compile(
    r"^[\s\-–—|•·]*(?:(?:page|p\.|עמוד|עמ['׳]?)\s*)?(\d{1,4}|[ivxlcdm]{1,7})(?:\s*(?:/|of|מתוך)\s*\d{1,4})?[\s\-–—|•·]*$",
    re.IGNORECASE,
)
_CAPTION_RE = re.compile(
    r"^(איור|תמונה|תרשים|טבלה|מפה|גרף|דיאגרמה|figure|fig\.|table|chart|map|image|photo|graph|diagram|plate)\s*[\d.:]",
    re.IGNORECASE,
)
_TERMINAL = set(".!?…:;؟")
_CLOSERS = "\"'”’״׳)]}»"
_HEADING_NUM_RE = re.compile(r"^(\d+(\.\d+){0,4}\.?|[IVX]{1,5}\.|פרק|שער|חלק|chapter|part|section)\b", re.IGNORECASE)

SKIP_KINDS_DEFAULT = {"header", "footer", "page_number", "toc", "figure_text", "artifact"}


def _norm_sig_text(t: str) -> str:
    t = re.sub(r"\d+", "#", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t[:48]


def ends_terminal(text: str) -> bool:
    t = text.rstrip().rstrip(_CLOSERS).rstrip()
    return bool(t) and t[-1] in _TERMINAL


@dataclass
class DocStats:
    body_size: float
    header_sigs: Dict[Tuple[int, str], int]
    deco_images: Dict[Tuple[int, int, int, int], int]
    heading_sizes: List[float]
    sample_pages: int
    mirror: bool
    rtl: bool

    def to_json(self) -> dict:
        return {
            "body_size": self.body_size,
            "header_sigs": [[k[0], k[1], v] for k, v in self.header_sigs.items()],
            "deco_images": [[*k, v] for k, v in self.deco_images.items()],
            "heading_sizes": self.heading_sizes,
            "sample_pages": self.sample_pages,
            "mirror": self.mirror,
            "rtl": self.rtl,
        }

    @staticmethod
    def from_json(d: dict) -> "DocStats":
        return DocStats(
            body_size=d["body_size"],
            header_sigs={(a, b): c for a, b, c in d["header_sigs"]},
            deco_images={(a, b, c, e): f for a, b, c, e, f in d["deco_images"]},
            heading_sizes=d["heading_sizes"],
            sample_pages=d["sample_pages"],
            mirror=d["mirror"],
            rtl=d["rtl"],
        )


class PdfDocument:
    """Thread-safe wrapper around a PDF with cached per-page analysis."""

    def __init__(self, pdf_path: str, cache_dir: str, ocr: Optional[OcrEngine] = None):
        self.path = pdf_path
        self.cache_dir = cache_dir
        os.makedirs(os.path.join(cache_dir, "pages"), exist_ok=True)
        self._lock = threading.RLock()
        self._render_lock = threading.Lock()
        self._doc = pymupdf.open(pdf_path)
        self._render_doc = pymupdf.open(pdf_path)
        self.page_count = self._doc.page_count
        self.ocr = ocr
        self._stats: Optional[DocStats] = None
        self._mem: Dict[int, dict] = {}
        self._mem_order: List[int] = []
        self._validate_cache()

    # ------------------------------------------------------------------ meta
    def _validate_cache(self) -> None:
        meta_path = os.path.join(self.cache_dir, "meta.json")
        meta = None
        if os.path.exists(meta_path):
            try:
                with open(meta_path, encoding="utf-8") as fh:
                    meta = json.load(fh)
            except Exception:
                meta = None
        if not meta or meta.get("v") != EXTRACTOR_VERSION:
            shutil.rmtree(os.path.join(self.cache_dir, "pages"), ignore_errors=True)
            os.makedirs(os.path.join(self.cache_dir, "pages"), exist_ok=True)
            for f in ("stats.json",):
                try:
                    os.remove(os.path.join(self.cache_dir, f))
                except FileNotFoundError:
                    pass
            with open(meta_path, "w", encoding="utf-8") as fh:
                json.dump({"v": EXTRACTOR_VERSION}, fh)

    def close(self) -> None:
        with self._lock:
            self._doc.close()
        with self._render_lock:
            self._render_doc.close()

    def metadata(self) -> dict:
        with self._lock:
            md = self._doc.metadata or {}
            sizes = []
            for i in range(self.page_count):
                r = self._doc[i].rect
                sizes.append([round(r.width, 2), round(r.height, 2)])
            return {"title": md.get("title") or "", "author": md.get("author") or "", "page_sizes": sizes}

    def outline(self) -> List[dict]:
        """Embedded PDF bookmarks (if the document has them)."""
        with self._lock:
            toc = self._doc.get_toc(simple=False)
        out = []
        for entry in toc:
            level, title, page = entry[0], entry[1], entry[2]
            y = None
            if len(entry) > 3 and isinstance(entry[3], dict):
                to = entry[3].get("to")
                if to is not None:
                    try:
                        y = float(to.y)
                    except Exception:
                        y = None
            if page >= 1:
                out.append({"level": level, "title": title.strip(), "page": page - 1, "y": y, "source": "pdf"})
        return out

    # ----------------------------------------------------------------- render
    def render_page(self, n: int, scale: float, fmt: str = "png") -> bytes:
        scale = max(0.25, min(scale, 6.0))
        with self._render_lock:
            page = self._render_doc[n]
            pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False, annots=True)
            if fmt == "jpg":
                return pix.tobytes("jpg", jpg_quality=88)
            return pix.tobytes("png")

    # ------------------------------------------------------------------ stats
    def stats(self) -> DocStats:
        if self._stats is not None:
            return self._stats
        path = os.path.join(self.cache_dir, "stats.json")
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as fh:
                    self._stats = DocStats.from_json(json.load(fh))
                    return self._stats
            except Exception:
                pass
        self._stats = self._compute_stats()
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(self._stats.to_json(), fh)
        return self._stats

    def _sample_indices(self, k: int = 30) -> List[int]:
        n = self.page_count
        if n <= k:
            return list(range(n))
        step = n / k
        return sorted({int(i * step) for i in range(k)})

    def _compute_stats(self) -> DocStats:
        idx = self._sample_indices()
        size_counter: Counter = Counter()
        sigs: Counter = Counter()
        imgs: Counter = Counter()
        rtl_votes = 0
        layouts = []
        with self._lock:
            for i in idx:
                page = self._doc[i]
                try:
                    lay = L.analyze_page(page, mirror=False)
                except Exception as exc:  # pragma: no cover - defensive
                    log.warning("stats: page %s failed: %s", i, exc)
                    continue
                layouts.append((i, lay))
        for i, lay in layouts:
            rtl_votes += 1 if lay.rtl else -1
            seen = set()
            for b in lay.blocks:
                for ln in b.lines:
                    size_counter[round(ln.size * 2) / 2] += len(ln.glyphs)
                band = self._band(b, lay.height)
                if band:
                    seen.add((int(b.y0 // 6), _norm_sig_text(b.text)))
            for s in seen:
                sigs[s] += 1
            seen_img = set()
            for (x0, y0, x1, y1) in lay.images:
                seen_img.add((int(x0 // 8), int(y0 // 8), int(x1 // 8), int(y1 // 8)))
            for s in seen_img:
                imgs[s] += 1
        n = max(1, len(layouts))
        body = size_counter.most_common(1)[0][0] if size_counter else 11.0
        threshold = max(3, int(0.2 * n))
        header_sigs = {k: v for k, v in sigs.items() if v >= threshold}
        deco = {k: v for k, v in imgs.items() if v >= max(3, int(0.25 * n))}
        heading_sizes = sorted({s for s, c in size_counter.items() if s >= body * 1.15}, reverse=True)
        mirror = self._detect_mirroring(layouts)
        return DocStats(body, header_sigs, deco, heading_sizes, n, mirror, rtl_votes > 0)

    @staticmethod
    def _band(b: L.Block, height: float) -> Optional[str]:
        if b.y1 <= 0.12 * height:
            return "top"
        if b.y0 >= 0.88 * height:
            return "bottom"
        return None

    @staticmethod
    def _detect_mirroring(layouts) -> bool:
        """Decide whether bracket glyphs in RTL words carry their *visual* shape
        (needs mirroring) or their logical identity.  We test which choice gives
        well-formed '(' ... ')' pairs in logical text."""
        plain = mirrored = 0
        for _, lay in layouts:
            for b in lay.blocks:
                for ln in b.lines:
                    if not ln.rtl:
                        continue
                    text = " ".join(w.text for w in ln.words if w.rtl or not any(c.isalpha() for c in w.text))
                    plain += _bracket_score(text)
                    mirrored += _bracket_score(text.translate(str.maketrans("()[]", ")(][")))
        return mirrored > plain + 2

    # ------------------------------------------------------------------ pages
    def _cache_path(self, n: int) -> str:
        return os.path.join(self.cache_dir, "pages", f"{n}.json.gz")

    def is_page_cached(self, n: int) -> bool:
        return n in self._mem or os.path.exists(self._cache_path(n))

    def page(self, n: int) -> dict:
        if not 0 <= n < self.page_count:
            raise IndexError(n)
        if n in self._mem:
            return self._mem[n]
        path = self._cache_path(n)
        data = None
        if os.path.exists(path):
            try:
                with gzip.open(path, "rt", encoding="utf-8") as fh:
                    data = json.load(fh)
                if data.get("v") != EXTRACTOR_VERSION:
                    data = None
            except Exception:
                data = None
        if data is None:
            data = self._analyze(n)
            tmp = path + ".tmp"
            with gzip.open(tmp, "wt", encoding="utf-8") as fh:
                json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
            os.replace(tmp, path)
        self._remember(n, data)
        return data

    def _remember(self, n: int, data: dict) -> None:
        self._mem[n] = data
        self._mem_order.append(n)
        if len(self._mem_order) > 64:
            old = self._mem_order.pop(0)
            if old not in self._mem_order:
                self._mem.pop(old, None)

    def _analyze(self, n: int) -> dict:
        stats = self.stats()
        with self._lock:
            page = self._doc[n]
            lay = L.analyze_page(page, mirror=stats.mirror)
            source = "text"
            ocr_info = None
            image_cover = _coverage(lay.images, lay.width, lay.height)
            needs_ocr = (lay.glyph_count < 25 and image_cover > 0.3) or lay.garbled_ratio > 0.3
            if needs_ocr:
                if self.ocr is not None and self.ocr.available():
                    try:
                        tp, ocr_info = self.ocr.textpage(page)
                        lay2 = L.analyze_page(page, mirror=False, textpage=tp)
                        if lay2.glyph_count > lay.glyph_count:
                            lay = lay2
                            source = "ocr"
                    except Exception as exc:
                        lay.warnings.append(f"OCR failed: {exc}")
                        source = "ocr_failed"
                else:
                    source = "needs_ocr"
                    lay.warnings.append("This page looks scanned but OCR (Tesseract) is not installed.")
        return self._serialize(n, lay, source, ocr_info, stats)

    # ------------------------------------------------------------ classifying
    def _classify(self, lay: L.PageLayout, stats: DocStats) -> List[Tuple[str, int]]:
        body = stats.body_size
        out: List[Tuple[str, int]] = []
        figures = [im for im in lay.images if not self._is_deco(im, stats)
                   and (im[2] - im[0]) * (im[3] - im[1]) > 0.015 * lay.width * lay.height]
        heading_sizes = stats.heading_sizes
        for b in lay.blocks:
            text = b.text.strip()
            band = self._band(b, lay.height)
            kind, level = "paragraph", 0
            nwords = sum(len(l.words) for l in b.lines)
            if not any(ch.isalnum() for ch in text):
                kind = "artifact"
            elif band and _PAGE_NUM_RE.match(text):
                kind = "page_number"
            elif band and (int(b.y0 // 6), _norm_sig_text(text)) in stats.header_sigs or (
                    band and any((int(b.y0 // 6) + d, _norm_sig_text(text)) in stats.header_sigs for d in (-1, 1))):
                kind = "header" if band == "top" else "footer"
            elif sum(1 for l in b.lines if L.is_leader_line(l.text)) >= max(1, len(b.lines) // 2):
                kind = "toc"
            elif figures and _inside_any(b, figures) and b.size <= body * 1.05:
                kind = "figure_text"
            elif _CAPTION_RE.match(text) and len(b.lines) <= 4:
                kind = "caption"
            elif figures and len(b.lines) <= 2 and nwords <= 16 and _adjacent_caption(b, figures) and not ends_terminal(text):
                kind = "caption"
            elif figures and b.size < body * 0.85 and len(b.lines) <= 4 and _adjacent_caption(b, figures, gap=45):
                kind = "caption"
            elif self._is_heading(b, body, nwords, text):
                kind = "heading"
                level = self._heading_level(b, heading_sizes, body, text)
            elif b.lines and L.starts_list_item(b.lines[0]) is not None and not (
                    b.lines[0].words[0].text in ("-", "–", "—") and len(b.lines) > 3):
                kind = "list_item"
            elif b.size < body * 0.9 and (b.y0 > 0.7 * lay.height) and re.match(r"^[\d*†‡§¹²³⁴⁵⁶⁷⁸⁹]", text):
                kind = "footnote"
            elif b.size < body * 0.9 and text[:1] in "*†‡":
                kind = "footnote"
            elif b.size < body * 0.92:
                kind = "note"
            out.append((kind, level))
        return out

    @staticmethod
    def _is_deco(im, stats: DocStats) -> bool:
        x0, y0, x1, y1 = im
        key = (int(x0 // 8), int(y0 // 8), int(x1 // 8), int(y1 // 8))
        if key in stats.deco_images:
            return True
        for (a, b, c, d) in stats.deco_images:
            if abs(a - key[0]) <= 1 and abs(b - key[1]) <= 1 and abs(c - key[2]) <= 1 and abs(d - key[3]) <= 1:
                return True
        return False

    @staticmethod
    def _is_heading(b: L.Block, body: float, nwords: int, text: str) -> bool:
        if nwords == 0 or nwords > 24 or len(b.lines) > 3:
            return False
        if text.rstrip(_CLOSERS)[-1:] in ".;,":
            # sentences are not headings (but "Introduction:" may be)
            if not (b.size >= body * 1.3):
                return False
        if b.size >= body * 1.15:
            return True
        if b.bold and b.size >= body * 0.95 and nwords <= 14:
            return True
        if _HEADING_NUM_RE.match(text) and b.bold:
            return True
        return False

    @staticmethod
    def _heading_level(b: L.Block, heading_sizes: List[float], body: float, text: str) -> int:
        """Numbered headings ("5.3.1 ...") take their numbering depth; otherwise
        the level follows the font-size ratio to body text."""
        m = re.match(r"^(\d+(?:\.\d+){0,4})\.?\s", text)
        if m and "." in m.group(1):
            return max(1, min(m.group(1).count(".") + 1, 4))
        ratio = b.size / max(body, 1e-3)
        if ratio >= 1.9:
            return 1
        if ratio >= 1.4:
            return 2
        if ratio >= 1.15:
            return 3
        return 4

    # ---------------------------------------------------------------- output
    def _serialize(self, n: int, lay: L.PageLayout, source: str, ocr_info, stats: DocStats) -> dict:
        kinds = self._classify(lay, stats)
        words = []
        lines = []
        blocks = []
        for b, (kind, level) in zip(lay.blocks, kinds):
            l_start = len(lines)
            for ln in b.lines:
                w_start = len(words)
                for w in ln.words:
                    flags = (F_RTL if w.rtl else 0) | (F_BOLD if w.bold else 0) | (F_SCRIPT if w.script else 0) | (F_ITALIC if w.italic else 0)
                    words.append([w.text, round(w.x0, 2), round(w.y0, 2), round(w.x1, 2), round(w.y1, 2), flags, round(w.size, 1)])
                lines.append([w_start, len(words), 1 if ln.rtl else 0])
            blocks.append({
                "l": [l_start, len(lines)],
                "kind": kind,
                "level": level,
                "size": round(b.size, 1),
                "rtl": b.rtl,
                "bbox": [round(b.x0, 2), round(b.y0, 2), round(b.x1, 2), round(b.y1, 2)],
                "cont": False,
            })
        images = []
        for im in lay.images:
            deco = self._is_deco(im, stats)
            area = (im[2] - im[0]) * (im[3] - im[1])
            kind = "decoration" if deco or area < 0.015 * lay.width * lay.height else "figure"
            images.append([round(v, 2) for v in im] + [kind])
        self._mark_internal_continuations(blocks, words, lines)
        return {
            "v": EXTRACTOR_VERSION,
            "n": n,
            "w": round(lay.width, 2),
            "h": round(lay.height, 2),
            "rtl": lay.rtl,
            "source": source,
            "ocr": ocr_info,
            "words": words,
            "lines": lines,
            "blocks": blocks,
            "images": images,
            "warnings": lay.warnings,
        }

    @staticmethod
    def _mark_internal_continuations(blocks: List[dict], words: List[list], lines: List[list]) -> None:
        """A paragraph that runs from the bottom of one column to the top of the
        next is one passage."""
        body_kinds = ("paragraph", "note")
        prev = None
        for b in blocks:
            if b["kind"] not in body_kinds:
                if b["kind"] in ("paragraph", "list_item", "heading", "caption"):
                    prev = None
                continue
            if prev is not None:
                ptxt = page_block_text({"blocks": [prev], "lines": lines, "words": words}, 0)
                jumped_up = b["bbox"][1] < prev["bbox"][1] - 20
                if jumped_up and not ends_terminal(ptxt) and abs(b["size"] - prev["size"]) < 0.6 and b["kind"] == prev["kind"]:
                    b["cont"] = True
            prev = b

    # -------------------------------------------------------- cross-page flow
    def first_body_block(self, n: int) -> Optional[int]:
        pg = self.page(n)
        for i, b in enumerate(pg["blocks"]):
            if b["kind"] in ("header", "page_number", "figure_text", "footer"):
                continue
            return i if b["kind"] in ("paragraph", "note") else None
        return None

    def last_body_block(self, n: int) -> Optional[int]:
        pg = self.page(n)
        for i in range(len(pg["blocks"]) - 1, -1, -1):
            b = pg["blocks"][i]
            if b["kind"] in ("footer", "page_number", "footnote", "header", "figure_text", "caption", "toc"):
                continue
            return i if b["kind"] in ("paragraph", "note", "list_item") else None
        return None

    def continues_from_previous_page(self, n: int) -> bool:
        if n == 0:
            return False
        first = self.first_body_block(n)
        if first is None:
            return False
        prev_last = self.last_body_block(n - 1)
        if prev_last is None:
            return False
        prev = self.page(n - 1)
        cur = self.page(n)
        pb = prev["blocks"][prev_last]
        cb = cur["blocks"][first]
        ptxt = page_block_text(prev, prev_last)
        if ends_terminal(ptxt):
            return False
        if abs(pb["size"] - cb["size"]) > 0.6:
            return False
        return True


def _bracket_score(text: str) -> int:
    score = 0
    depth = 0
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")":
            if depth > 0:
                depth -= 1
                score += 1
            else:
                score -= 1
    score -= depth
    return score


def _coverage(images, w: float, h: float) -> float:
    if not images or w <= 0 or h <= 0:
        return 0.0
    area = sum(max(0, x1 - x0) * max(0, y1 - y0) for x0, y0, x1, y1 in images)
    return min(1.0, area / (w * h))


def _inside_any(b: L.Block, figs) -> bool:
    bw = max(1e-3, (b.x1 - b.x0) * (b.y1 - b.y0))
    for x0, y0, x1, y1 in figs:
        ix = max(0, min(b.x1, x1) - max(b.x0, x0))
        iy = max(0, min(b.y1, y1) - max(b.y0, y0))
        if ix * iy >= 0.7 * bw:
            return True
    return False


def _adjacent_caption(b: L.Block, figs, gap: float = 18) -> bool:
    for x0, y0, x1, y1 in figs:
        horizontal = min(b.x1, x1) - max(b.x0, x0) > 0.5 * (b.x1 - b.x0)
        below = -2 <= b.y0 - y1 <= gap
        above = -2 <= y0 - b.y1 <= gap
        if horizontal and (below or above):
            return True
    return False


def page_block_text(page: dict, bi: int) -> str:
    b = page["blocks"][bi]
    l0, l1 = b["l"]
    if l1 <= l0:
        return ""
    w0 = page["lines"][l0][0]
    w1 = page["lines"][l1 - 1][1]
    return " ".join(w[0] for w in page["words"][w0:w1])


def page_block_word_range(page: dict, bi: int) -> Tuple[int, int]:
    b = page["blocks"][bi]
    l0, l1 = b["l"]
    if l1 <= l0:
        return (0, 0)
    return page["lines"][l0][0], page["lines"][l1 - 1][1]
