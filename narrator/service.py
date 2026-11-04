"""Application service: ties documents, narration preparation, speech
providers, cache and persistence together.  The HTTP layer (app.py) is a thin
wrapper around this class, which keeps the logic testable."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import shutil
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

import pymupdf

from . import config
from .db import Database
from .narration.align import Boundary, align
from .narration.cache import AudioCache, cache_key
from .narration.prepare import PreparedChunk, PrepOptions, delivery_for, prepare_unit
from .narration.units import Unit, UnitIndex, unit_sort_key
from .pdf.document import PdfDocument, page_block_text, page_block_word_range
from .pdf.ocr import OcrEngine
from .text.normalize import LexEntry, Lexicon, load_builtin, strip_niqqud, unify_quotes
from .tts.azure import AzureProvider
from .tts.base import TTSError, TTSProvider, Voice
from .tts.edge import EdgeProvider
from .tts.testtone import TestToneProvider
from .llm.client import LLMClient, is_local
from .llm.teacher import ExplanationCache, explain as llm_explain

log = logging.getLogger(__name__)


class ConsentRequired(Exception):
    def __init__(self, provider: str, info):
        super().__init__(provider)
        self.provider = provider
        self.info = info


class DocState:
    def __init__(self, doc_id: str, pdf: PdfDocument):
        self.id = doc_id
        self.pdf = pdf
        self.units = UnitIndex(pdf)
        self.prepared: Dict[Tuple[str, str], List[PreparedChunk]] = {}
        self.lock = threading.RLock()
        self.processed = 0
        self.processing = False
        self.cancel = False
        self.error: Optional[str] = None


class NarratorService:
    def __init__(self, data_dir: Optional[str] = None, test_mode: Optional[bool] = None):
        self.data_dir = data_dir or config.data_dir()
        self.test_mode = config.test_mode() if test_mode is None else test_mode
        os.makedirs(os.path.join(self.data_dir, "library"), exist_ok=True)
        os.makedirs(os.path.join(self.data_dir, "doc_cache"), exist_ok=True)
        self.db = Database(os.path.join(self.data_dir, "narrator.sqlite3"))
        self.cache = AudioCache(os.path.join(self.data_dir, "audio_cache"))
        self.ocr = OcrEngine(self.data_dir)
        self.providers: Dict[str, TTSProvider] = {
            "edge": EdgeProvider(cache_dir=self.data_dir),
            "azure": AzureProvider(),
        }
        if self.test_mode:
            self.providers["testtone"] = TestToneProvider()
        self.docs: Dict[str, DocState] = {}
        self._docs_lock = threading.RLock()
        self._inflight: Dict[str, asyncio.Future] = {}
        self._prefetch_sem: Optional[asyncio.Semaphore] = None
        self._lexicon_version = 0
        self._builtin = load_builtin("he") + load_builtin("en")
        self._secrets_path = os.path.join(self.data_dir, "secrets.json")
        self.explanations = ExplanationCache(os.path.join(self.data_dir, "explanations"))
        self._apply_provider_settings()

    # ============================================================ settings
    def settings(self) -> dict:
        s = config.default_settings()
        stored = self.db.get_settings()
        for k, v in stored.items():
            if isinstance(v, dict) and isinstance(s.get(k), dict):
                s[k].update(v)
            else:
                s[k] = v
        if self.test_mode and "voices_overridden" not in stored:
            s["voices"] = {"he": "testtone:low", "en": "testtone:high"}
            s["provider"] = "testtone"
        return s

    def update_settings(self, patch: dict) -> dict:
        cur = self.settings()
        for k, v in patch.items():
            if k in config.SECRET_KEYS:
                continue
            if isinstance(v, dict) and isinstance(cur.get(k), dict):
                merged = dict(cur[k])
                merged.update(v)
                self.db.set_setting(k, merged)
            else:
                self.db.set_setting(k, v)
            if k == "voices" and self.test_mode:
                self.db.set_setting("voices_overridden", True)
        prep_keys = {"max_chunk_chars", "skip_citations", "skip_footnote_marks", "verbalize_math", "switch_voice_for_foreign"}
        if prep_keys & set(patch):
            self._invalidate_prepared()
        self._apply_provider_settings()
        return self.settings()

    def _secrets(self) -> dict:
        if os.path.exists(self._secrets_path):
            try:
                with open(self._secrets_path, encoding="utf-8") as fh:
                    return json.load(fh)
            except Exception:
                return {}
        return {}

    def set_secret(self, key: str, value: str) -> None:
        if key not in config.SECRET_KEYS:
            raise ValueError("unknown secret")
        s = self._secrets()
        if value:
            s[key] = value
        else:
            s.pop(key, None)
        tmp = self._secrets_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(s, fh)
        os.replace(tmp, self._secrets_path)
        try:
            os.chmod(self._secrets_path, 0o600)
        except OSError:
            pass
        self._apply_provider_settings()

    def secret_status(self) -> dict:
        s = self._secrets()
        return {k: bool(s.get(k)) for k in config.SECRET_KEYS}

    def _apply_provider_settings(self) -> None:
        merged = dict(self.settings()) if hasattr(self, "db") else {}
        merged.update(self._secrets())
        for p in self.providers.values():
            p.configure(merged)

    def providers_info(self) -> List[dict]:
        out = []
        for pid, p in self.providers.items():
            i = p.info
            st = p.status()
            out.append({"id": i.id, "name": i.name, "free": i.free, "cloud": i.cloud, "requires_key": i.requires_key,
                        "word_timing": i.word_timing, "privacy": i.privacy, "verified": i.verified, **st})
        return out

    def give_consent(self, provider: str) -> None:
        consent = self.settings().get("cloud_consent", {})
        consent[provider] = time.time()
        self.db.set_setting("cloud_consent", consent)

    def _check_consent(self, provider: str) -> None:
        p = self.providers.get(provider)
        if p is None:
            raise TTSError(f"Unknown speech provider '{provider}'", retryable=False)
        if p.info.cloud and provider not in self.settings().get("cloud_consent", {}):
            raise ConsentRequired(provider, p.info)

    # ============================================================== voices
    async def voices(self, provider: Optional[str] = None) -> List[dict]:
        out: List[dict] = []
        for pid, p in self.providers.items():
            if provider and pid != provider:
                continue
            try:
                out += [v.to_json() for v in await p.list_voices()]
            except Exception as exc:
                log.warning("voices for %s failed: %s", pid, exc)
        return out

    async def voice_for(self, lang: str, doc_id: Optional[str] = None) -> str:
        s = self.settings()
        voices = dict(s.get("voices", {}))
        if doc_id:
            ds = self.db.doc_settings(doc_id)
            voices.update(ds.get("voices", {}) or {})
        if lang in voices and voices[lang]:
            return voices[lang]
        provider = s.get("provider", "edge")
        p = self.providers.get(provider) or self.providers["edge"]
        try:
            vs = await p.list_voices()
        except Exception:
            vs = []
        cands = [v for v in vs if v.lang == lang]
        if cands:
            multi = [v for v in cands if "Multilingual" in v.id]
            return (multi or cands)[0].id
        return voices.get("en") or "edge:en-US-AvaMultilingualNeural"

    # =========================================================== documents
    def _doc_cache_dir(self, doc_id: str) -> str:
        return os.path.join(self.data_dir, "doc_cache", doc_id)

    def import_pdf(self, src_path: str, filename: str, title: Optional[str] = None) -> dict:
        """Import a PDF file already written to disk (moved into the library)."""
        h = hashlib.sha256()
        size = 0
        with open(src_path, "rb") as fh:
            while True:
                b = fh.read(1 << 20)
                if not b:
                    break
                h.update(b)
                size += len(b)
        doc_id = h.hexdigest()[:20]
        dest = os.path.join(self.data_dir, "library", f"{doc_id}.pdf")
        existing = self.db.document(doc_id)
        try:
            pdf = pymupdf.open(src_path)
        except Exception as exc:
            raise ValueError(f"Not a readable PDF: {exc}") from exc
        if pdf.needs_pass:
            pdf.close()
            raise ValueError("This PDF is password-protected.")
        pages = pdf.page_count
        meta_title = (pdf.metadata or {}).get("title") or ""
        pdf.close()
        if not os.path.exists(dest):
            shutil.move(src_path, dest)
        else:
            try:
                os.remove(src_path)
            except OSError:
                pass
        if existing:
            self.db.touch_document(doc_id)
            return self.document_info(doc_id)
        base = os.path.splitext(os.path.basename(filename))[0]
        good_meta = meta_title and not re.match(r"^(untitled|microsoft word|document\d*|\s*)$", meta_title, re.I) and len(meta_title) > 3
        self.db.add_document({
            "id": doc_id, "title": title or (meta_title if good_meta else base) or base, "filename": filename,
            "path": dest, "pages": pages, "size": size, "added_at": time.time(), "opened_at": time.time(),
        })
        return self.document_info(doc_id)

    def combine_pdfs(self, paths: List[str], out_path: str) -> None:
        out = pymupdf.open()
        for p in paths:
            d = pymupdf.open(p)
            out.insert_pdf(d)
            d.close()
        out.save(out_path, garbage=3, deflate=True)
        out.close()

    def document_info(self, doc_id: str) -> dict:
        d = self.db.document(doc_id)
        if not d:
            raise KeyError(doc_id)
        st = self.docs.get(doc_id)
        info = {k: d[k] for k in ("id", "title", "filename", "pages", "size", "added_at", "opened_at")}
        info["position"] = self.db.position(doc_id)
        if st:
            info["processed"] = st.processed
            info["rtl"] = st.pdf.stats().rtl
        return info

    def library(self) -> List[dict]:
        out = []
        for d in self.db.documents():
            out.append({k: d.get(k) for k in ("id", "title", "filename", "pages", "size", "added_at", "opened_at", "progress", "last_page", "position_at")})
        return out

    def delete_document(self, doc_id: str) -> None:
        with self._docs_lock:
            st = self.docs.pop(doc_id, None)
        if st:
            st.cancel = True
            try:
                st.pdf.close()
            except Exception:
                pass
        d = self.db.document(doc_id)
        if d:
            try:
                os.remove(d["path"])
            except OSError:
                pass
        shutil.rmtree(self._doc_cache_dir(doc_id), ignore_errors=True)
        self.db.delete_document(doc_id)

    def open(self, doc_id: str) -> DocState:
        with self._docs_lock:
            st = self.docs.get(doc_id)
            if st:
                return st
            d = self.db.document(doc_id)
            if not d:
                raise KeyError(doc_id)
            pdf = PdfDocument(d["path"], self._doc_cache_dir(doc_id), self.ocr)
            st = DocState(doc_id, pdf)
            self.docs[doc_id] = st
            self.db.touch_document(doc_id)
            self._start_processing(st)
            return st

    def _start_processing(self, st: DocState) -> None:
        def run():
            st.processing = True
            try:
                st.pdf.stats()
                for n in range(st.pdf.page_count):
                    if st.cancel:
                        return
                    try:
                        st.pdf.page(n)
                    except Exception as exc:  # keep going; the page shows a warning
                        log.exception("page %s failed: %s", n, exc)
                    st.processed = n + 1
                    time.sleep(0.001)
            except Exception as exc:
                st.error = str(exc)
                log.exception("processing failed")
            finally:
                st.processing = False

        threading.Thread(target=run, name=f"process-{st.id}", daemon=True).start()

    def progress(self, doc_id: str) -> dict:
        st = self.open(doc_id)
        cached = st.processed
        return {"processed": cached, "pages": st.pdf.page_count, "processing": st.processing, "error": st.error,
                "ocr": self.ocr.status()}

    # ---------------------------------------------------------------- pages
    def page_layout(self, doc_id: str, n: int) -> dict:
        st = self.open(doc_id)
        pg = st.pdf.page(n)
        # map words to units/sentences for click-to-play and highlighting
        nwords = len(pg["words"])
        word_unit = [-1] * nwords
        word_pos = [-1] * nwords
        word_sent = [-1] * nwords
        unit_ids: List[str] = []
        unit_kinds: List[str] = []
        units = list(st.units.units_on_page(n))
        if n > 0 and st.pdf.continues_from_previous_page(n):
            fb = st.pdf.first_body_block(n)
            if fb is not None:
                w0, _ = page_block_word_range(pg, fb)
                u = st.units.unit_for_word(n, w0)
                if u is not None and u not in units:
                    units.insert(0, u)
        for u in units:
            ui = len(unit_ids)
            unit_ids.append(u.id)
            unit_kinds.append(u.kind)
            sent_of = {}
            for si, (a, b, _t) in enumerate(u.sentences):
                for w in range(a, b):
                    sent_of[w] = si
            for wi, (p, idx) in enumerate(u.words):
                if p == n and 0 <= idx < nwords:
                    word_unit[idx] = ui
                    word_pos[idx] = wi
                    word_sent[idx] = sent_of.get(wi, 0)
        out = dict(pg)
        out["word_unit"] = word_unit
        out["word_pos"] = word_pos
        out["word_sent"] = word_sent
        out["units"] = unit_ids
        out["unit_kinds"] = unit_kinds
        return out

    def render(self, doc_id: str, n: int, scale: float) -> bytes:
        st = self.open(doc_id)
        return st.pdf.render_page(n, scale, "png")

    def outline(self, doc_id: str) -> dict:
        st = self.open(doc_id)
        pdf_outline = st.pdf.outline()
        detected = []
        for n in range(st.pdf.page_count):
            if not st.pdf.is_page_cached(n):
                continue
            pg = st.pdf.page(n)
            for bi, b in enumerate(pg["blocks"]):
                if b["kind"] == "heading":
                    title = page_block_text(pg, bi)
                    if len(title) > 120:
                        title = title[:117] + "…"
                    detected.append({"level": b.get("level", 3), "title": title, "page": n, "unit_id": f"{n}.{bi}", "y": b["bbox"][1]})
        return {"pdf": pdf_outline, "detected": detected, "complete": st.processed >= st.pdf.page_count}

    def search(self, doc_id: str, query: str, limit: int = 200) -> dict:
        st = self.open(doc_id)
        q = _search_norm(query).strip()
        results = []
        if not q:
            return {"results": [], "indexed": st.processed, "pages": st.pdf.page_count}
        for n in range(st.pdf.page_count):
            if not st.pdf.is_page_cached(n):
                continue
            pg = st.pdf.page(n)
            words = [_search_norm(w[0]) for w in pg["words"]]
            starts = []
            pos = 0
            for w in words:
                starts.append(pos)
                pos += len(w) + 1
            text = " ".join(words)
            i = text.find(q)
            while i >= 0 and len(results) < limit:
                w0 = _bisect(starts, i)
                w1 = _bisect(starts, i + len(q) - 1)
                snippet = " ".join(x[0] for x in pg["words"][max(0, w0 - 6): w1 + 7])
                results.append({"page": n, "w0": w0, "w1": w1, "snippet": snippet})
                i = text.find(q, i + len(q))
            if len(results) >= limit:
                break
        return {"results": results, "indexed": st.processed, "pages": st.pdf.page_count}

    # ================================================================ units
    def _prep_options(self) -> Tuple[PrepOptions, str]:
        s = self.settings()
        o = PrepOptions(max_chars=int(s.get("max_chunk_chars", 900)),
                        switch_voice_min_words=4 if s.get("switch_voice_for_foreign", True) else 10 ** 6,
                        skip_citations=bool(s.get("skip_citations", True)),
                        skip_footnote_marks=bool(s.get("skip_footnote_marks", True)),
                        verbalize_math=bool(s.get("verbalize_math", True)))
        sig = json.dumps([o.max_chars, o.switch_voice_min_words, o.skip_citations, o.skip_footnote_marks, o.verbalize_math, self._lexicon_version])
        return o, sig

    def _invalidate_prepared(self) -> None:
        self._lexicon_version += 1
        for st in self.docs.values():
            with st.lock:
                st.prepared.clear()

    def lexicon_for(self, doc_id: str) -> Lexicon:
        entries = []
        for r in self.db.lexicon(doc_id):
            if not r["enabled"]:
                continue
            entries.append(LexEntry(written=r["written"], spoken=r["spoken"], lang=r["lang"], context=r["context"] or "any",
                                    scope=r["scope"], id=r["id"]))
        return Lexicon(entries + self._builtin)

    def prepared(self, st: DocState, unit: Unit) -> List[PreparedChunk]:
        opts, sig = self._prep_options()
        key = (unit.id, sig)
        with st.lock:
            if key in st.prepared:
                return st.prepared[key]
        occ = {(r["page"], r["word"]): r["spoken"] for r in self.db.occurrences(st.id)}
        chunks = prepare_unit(unit, self.lexicon_for(st.id), opts, vocab=st.units.vocab(), occurrences=occ)
        with st.lock:
            if len(st.prepared) > 4000:
                st.prepared.clear()
            st.prepared[key] = chunks
        return chunks

    def unit_json(self, st: DocState, u: Unit) -> dict:
        j = u.to_json()
        chunks = self.prepared(st, u)
        j["chunks"] = [c.to_json() for c in chunks]
        d = delivery_for(u.kind)
        j["pause_before"] = d["before"]
        j["pause_after"] = d["after"]
        return j

    def units(self, doc_id: str, page: int, count: int = 20) -> dict:
        st = self.open(doc_id)
        us = st.units.units_from(page, count)
        return {"units": [self.unit_json(st, u) for u in us]}

    def unit(self, doc_id: str, unit_id: str) -> dict:
        st = self.open(doc_id)
        u = st.units.find_unit(unit_id)
        if u is None:
            raise KeyError(unit_id)
        return self.unit_json(st, u)

    def neighbour(self, doc_id: str, unit_id: str, direction: int) -> Optional[dict]:
        st = self.open(doc_id)
        u = st.units.next_unit(unit_id) if direction > 0 else st.units.prev_unit(unit_id)
        return self.unit_json(st, u) if u else None

    def unit_at(self, doc_id: str, page: int, word: int) -> Optional[dict]:
        st = self.open(doc_id)
        u = st.units.unit_for_word(page, word)
        if u is None:
            return None
        pos = u.words.index((page, word))
        return {"unit": self.unit_json(st, u), "word": pos}

    # =============================================================== speech
    async def speech(self, doc_id: str, unit_id: str, chunk: int, prefetch: bool = True) -> dict:
        st = self.open(doc_id)
        u = await asyncio.get_running_loop().run_in_executor(None, st.units.find_unit, unit_id)
        if u is None:
            raise KeyError(unit_id)
        chunks = await asyncio.get_running_loop().run_in_executor(None, self.prepared, st, u)
        if not 0 <= chunk < len(chunks):
            raise KeyError(f"chunk {chunk}")
        ch = chunks[chunk]
        voice = await self.voice_for(ch.lang, doc_id)
        result = await self._speak(ch.text, voice, ch.lang, ch.rate, ch.tokens, ch.word_range)
        if prefetch:
            self._schedule_prefetch(doc_id, unit_id, chunk)
        return result

    async def _speak(self, text: str, voice: str, lang: str, rate: int, tokens, word_range) -> dict:
        provider_id = voice.split(":", 1)[0]
        self._check_consent(provider_id)
        provider = self.providers[provider_id]
        ok, reason = provider.available()
        if not ok:
            raise TTSError(reason, retryable=False)
        key = cache_key(provider_id, provider.version, voice, rate, 0, text)
        meta = self.cache.get(key)
        if meta is None:
            meta = await self._synth_dedup(key, provider, text, voice, lang, rate)
        bounds = [Boundary(b[0], b[1], b[2], b[3]) for b in meta.get("boundaries", [])]
        words, quality = align(text, tokens, bounds, meta["duration"], word_range)
        if not provider.info.word_timing:
            quality = "estimated"
        return {"audio": f"/api/audio/{key}.{meta['ext']}", "key": key, "duration": meta["duration"], "words": words,
                "timing": quality, "voice": voice, "lang": lang, "text": text}

    async def _synth_dedup(self, key: str, provider: TTSProvider, text: str, voice: str, lang: str, rate: int) -> dict:
        fut = self._inflight.get(key)
        if fut is not None:
            return await asyncio.shield(fut)
        loop = asyncio.get_running_loop()
        fut = loop.create_future()
        self._inflight[key] = fut
        try:
            res = await provider.synthesize(text, voice, lang, rate=rate)
            meta = self.cache.put(key, res.audio, res.ext, {
                "duration": res.duration, "mime": res.mime, "voice": voice, "lang": lang, "text": text,
                "boundaries": [[b.start, b.duration, b.text, b.char_offset] for b in res.boundaries],
            })
            fut.set_result(meta)
            return meta
        except Exception as exc:
            fut.set_exception(exc)
            # avoid "exception never retrieved" warnings when nobody else waits
            fut.exception()
            raise
        finally:
            self._inflight.pop(key, None)

    def _schedule_prefetch(self, doc_id: str, unit_id: str, chunk: int) -> None:
        if self._prefetch_sem is None:
            self._prefetch_sem = asyncio.Semaphore(2)
        asyncio.get_running_loop().create_task(self._prefetch(doc_id, unit_id, chunk))

    async def _prefetch(self, doc_id: str, unit_id: str, chunk: int) -> None:
        try:
            st = self.open(doc_id)
            s = self.settings()
            ahead = int(s.get("prefetch_chunks", 3))
            read = s.get("read_kinds", {})
            loop = asyncio.get_running_loop()
            u = await loop.run_in_executor(None, st.units.find_unit, unit_id)
            todo = []
            c = chunk + 1
            guard = 0
            while u is not None and len(todo) < ahead and guard < 40:
                guard += 1
                chunks = await loop.run_in_executor(None, self.prepared, st, u)
                if read.get(u.kind, True):
                    while c < len(chunks) and len(todo) < ahead:
                        todo.append((u, chunks[c]))
                        c += 1
                u = await loop.run_in_executor(None, st.units.next_unit, u.id)
                c = 0
            for u, ch in todo:
                voice = await self.voice_for(ch.lang, doc_id)
                async with self._prefetch_sem:
                    try:
                        await self._speak(ch.text, voice, ch.lang, ch.rate, ch.tokens, ch.word_range)
                    except ConsentRequired:
                        return
                    except Exception as exc:
                        log.info("prefetch failed: %s", exc)
                        return
        except Exception as exc:  # pragma: no cover - background best effort
            log.info("prefetch error: %s", exc)

    async def preview(self, text: str, voice: str, lang: str) -> dict:
        """Voice Lab: synthesize arbitrary text (not tied to a document)."""
        words = text.split()
        tokens = []
        pos = 0
        for i, w in enumerate(words):
            tokens.append((pos, pos + len(w), i, i))
            pos += len(w) + 1
        return await self._speak(" ".join(words), voice, lang, 0, tokens, (0, len(words)))

    # ============================================================ teacher
    def llm_client(self) -> LLMClient:
        s = self.settings()
        return LLMClient(s.get("llm_base_url") or "", s.get("llm_model") or "", self._secrets().get("llm_api_key"))

    async def llm_status(self) -> dict:
        c = self.llm_client()
        try:
            models = await c.models()
            return {"ok": True, "models": models, "local": is_local(c.base_url)}
        except Exception as exc:
            return {"ok": False, "error": str(exc), "local": is_local(c.base_url)}

    async def explain(self, doc_id: str, unit_id: str, scope: str = "paragraph") -> dict:
        st = self.open(doc_id)
        loop = asyncio.get_running_loop()
        u = await loop.run_in_executor(None, st.units.find_unit, unit_id)
        if u is None:
            raise KeyError(unit_id)
        client = self.llm_client()
        if not is_local(client.base_url) and "llm" not in self.settings().get("cloud_consent", {}):
            raise ConsentRequired("llm", _LLMInfo())
        # walk back to the section heading, collecting the section's text
        passage_units = [u]
        heading = ""
        cur = u
        for _ in range(80):
            cur = await loop.run_in_executor(None, st.units.prev_unit, cur.id)
            if cur is None:
                break
            if cur.kind == "heading":
                heading = cur.text()
                break
            if scope == "section" and cur.kind in ("paragraph", "list_item", "note"):
                passage_units.insert(0, cur)
        if scope != "section":
            passage_units = [u]
        passage = "\n".join(x.text() for x in passage_units)
        if len(passage) > 4000:
            passage = passage[-4000:]
        prev = await loop.run_in_executor(None, st.units.prev_unit, passage_units[0].id)
        previous = prev.text() if prev is not None and prev.kind in ("paragraph", "note", "list_item") else ""
        title = (self.db.document(doc_id) or {}).get("title", "")
        text = await llm_explain(client, self.explanations, u.lang, title, heading, previous, passage)
        return {"text": text, "lang": u.lang, "model": client.model, "heading": heading, "unit_id": u.id, "scope": scope}

    # ============================================================ lexicon
    def lexicon_changed(self) -> None:
        self._invalidate_prepared()

    def set_occurrence(self, doc_id: str, page: int, word: int, spoken: Optional[str]) -> None:
        self.db.set_occurrence(doc_id, page, word, spoken)
        self._invalidate_prepared()


class _LLMInfo:
    name = "Language model for Teacher Mode"
    privacy = "The passage being explained (and its section heading) is sent to the configured language-model service."


def _search_norm(s: str) -> str:
    return unify_quotes(strip_niqqud(s)).lower()


def _bisect(starts: List[int], pos: int) -> int:
    lo, hi = 0, len(starts) - 1
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if starts[mid] <= pos:
            lo = mid
        else:
            hi = mid - 1
    return lo
