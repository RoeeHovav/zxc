"""Narration units: the passages the narrator reads as one continuous piece.

A unit is normally one paragraph/heading/list item.  A paragraph that runs over
a page or column break becomes ONE unit containing words from several pages, so
it is synthesised (and sounds) as one uninterrupted passage.
"""
from __future__ import annotations

import threading
from collections import Counter
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from ..pdf.document import PdfDocument, page_block_word_range
from ..text.normalize import build_vocab
from ..text.script import detect_language
from ..text.segment import sentence_type, split_sentences


@dataclass
class Unit:
    id: str
    kind: str
    level: int
    page: int
    words: List[Tuple[int, int]]  # (page, word index)
    texts: List[str]
    flags: List[int]
    rtl: bool
    lang: str = "en"
    sentences: List[Tuple[int, int, str]] = field(default_factory=list)

    def text(self) -> str:
        return " ".join(self.texts)

    def to_json(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "level": self.level,
            "page": self.page,
            "pages": sorted({p for p, _ in self.words}),
            "words": [[p, i] for p, i in self.words],
            "text": self.text(),
            "rtl": self.rtl,
            "lang": self.lang,
            "sentences": [[a, b, t] for a, b, t in self.sentences],
        }


def unit_sort_key(uid: str) -> Tuple[int, int]:
    p, b = uid.split(".")
    return int(p), int(b)


class UnitIndex:
    """Builds and caches units per page for one document."""

    def __init__(self, doc: PdfDocument, default_lang: Optional[str] = None):
        self.doc = doc
        self._cache: Dict[int, List[Unit]] = {}
        self._lock = threading.RLock()
        self._vocab: Optional[Counter] = None
        self._vocab_pages = 0
        self.default_lang = default_lang or ("he" if doc.stats().rtl else "en")

    # ------------------------------------------------------------------ vocab
    def vocab(self) -> Counter:
        """Document vocabulary (used to repair split words).  Rebuilt as more
        pages become available."""
        cached = sum(1 for n in range(self.doc.page_count) if self.doc.is_page_cached(n))
        if self._vocab is None or cached > self._vocab_pages + 20 or (cached == self.doc.page_count and self._vocab_pages != cached):
            lists = []
            for n in range(self.doc.page_count):
                if self.doc.is_page_cached(n):
                    lists.append([w[0] for w in self.doc.page(n)["words"]])
            self._vocab = build_vocab(lists)
            self._vocab_pages = cached
        return self._vocab

    # ------------------------------------------------------------------ units
    def units_on_page(self, n: int) -> List[Unit]:
        with self._lock:
            if n in self._cache:
                return self._cache[n]
            units = self._build(n)
            self._cache[n] = units
            return units

    def invalidate(self) -> None:
        with self._lock:
            self._cache.clear()

    def _build(self, n: int) -> List[Unit]:
        doc = self.doc
        pg = doc.page(n)
        skip_first = doc.continues_from_previous_page(n)
        first_body = doc.first_body_block(n) if skip_first else None
        last_body = doc.last_body_block(n)
        units: List[Unit] = []
        last_body_unit: Optional[Unit] = None
        for bi, b in enumerate(pg["blocks"]):
            if skip_first and bi == first_body:
                continue
            w0, w1 = page_block_word_range(pg, bi)
            if w1 <= w0:
                continue
            refs = [(n, i) for i in range(w0, w1)]
            texts = [pg["words"][i][0] for i in range(w0, w1)]
            flags = [pg["words"][i][5] for i in range(w0, w1)]
            if b.get("cont") and last_body_unit is not None and b["kind"] in ("paragraph", "note"):
                last_body_unit.words += refs
                last_body_unit.texts += texts
                last_body_unit.flags += flags
                unit = last_body_unit
            else:
                unit = Unit(id=f"{n}.{bi}", kind=b["kind"], level=b.get("level", 0), page=n,
                            words=refs, texts=texts, flags=flags, rtl=bool(b.get("rtl")))
                units.append(unit)
            if b["kind"] in ("paragraph", "note", "list_item"):
                last_body_unit = unit
            if bi == last_body:
                self._extend_across_pages(unit, n)
        for u in units:
            self._finish(u)
        return units

    def _extend_across_pages(self, unit: Unit, n: int) -> None:
        doc = self.doc
        cur = n
        while cur + 1 < doc.page_count and doc.continues_from_previous_page(cur + 1):
            nxt = doc.page(cur + 1)
            fb = doc.first_body_block(cur + 1)
            if fb is None:
                break
            w0, w1 = page_block_word_range(nxt, fb)
            unit.words += [(cur + 1, i) for i in range(w0, w1)]
            unit.texts += [nxt["words"][i][0] for i in range(w0, w1)]
            unit.flags += [nxt["words"][i][5] for i in range(w0, w1)]
            # a paragraph can span several pages only if it fills them entirely
            if doc.last_body_block(cur + 1) != fb:
                break
            cur += 1

    def _finish(self, u: Unit) -> None:
        text = u.text()
        u.lang = detect_language(text, self.default_lang)
        sents = split_sentences(u.texts, u.kind)
        u.sentences = [(a, b, sentence_type(" ".join(u.texts[a:b]), u.kind)) for a, b in sents]

    # -------------------------------------------------------------- traversal
    def units_from(self, page: int, count: int, max_pages: int = 12) -> List[Unit]:
        out: List[Unit] = []
        p = page
        scanned = 0
        while p < self.doc.page_count and len(out) < count and scanned < max_pages:
            out.extend(self.units_on_page(p))
            p += 1
            scanned += 1
        return out[:count] if len(out) > count else out

    def find_unit(self, uid: str) -> Optional[Unit]:
        p, _ = unit_sort_key(uid)
        for u in self.units_on_page(p):
            if u.id == uid:
                return u
        return None

    def unit_for_word(self, page: int, idx: int) -> Optional[Unit]:
        """The unit containing a word (which may have started on an earlier page)."""
        for p in range(page, max(-1, page - 4), -1):
            for u in self.units_on_page(p):
                if (page, idx) in u.words:
                    return u
        return None

    def next_unit(self, uid: str) -> Optional[Unit]:
        p, _ = unit_sort_key(uid)
        units = self.units_on_page(p)
        ids = [u.id for u in units]
        if uid in ids:
            i = ids.index(uid)
            if i + 1 < len(units):
                return units[i + 1]
        q = p + 1
        while q < self.doc.page_count and q < p + 30:
            us = self.units_on_page(q)
            if us:
                return us[0]
            q += 1
        return None

    def prev_unit(self, uid: str) -> Optional[Unit]:
        p, _ = unit_sort_key(uid)
        units = self.units_on_page(p)
        ids = [u.id for u in units]
        if uid in ids:
            i = ids.index(uid)
            if i > 0:
                return units[i - 1]
        q = p - 1
        while q >= 0 and q > p - 30:
            us = self.units_on_page(q)
            if us:
                return us[-1]
            q -= 1
        return None
