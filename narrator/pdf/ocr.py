"""OCR for scanned pages.

PyMuPDF ships with Tesseract compiled in, so we only need the language model
files (``*.traineddata``).  No separate Tesseract installation is required:
``scripts/fetch_ocr_models.py`` downloads them into the app data folder, and a
system Tesseract installation is also picked up if present.
"""
from __future__ import annotations

import glob
import logging
import multiprocessing
import os
import threading
from typing import List, Optional, Tuple

import pymupdf

log = logging.getLogger(__name__)


def candidate_tessdata_dirs(app_data_dir: Optional[str]) -> List[str]:
    dirs = []
    env = os.environ.get("TESSDATA_PREFIX")
    if env:
        dirs.append(env)
        dirs.append(os.path.join(env, "tessdata"))
    if app_data_dir:
        dirs.append(os.path.join(app_data_dir, "tessdata"))
    dirs += [
        r"C:\Program Files\Tesseract-OCR\tessdata",
        r"C:\Program Files (x86)\Tesseract-OCR\tessdata",
        os.path.expanduser(r"~\AppData\Local\Programs\Tesseract-OCR\tessdata"),
    ]
    dirs += sorted(glob.glob("/usr/share/tesseract-ocr/*/tessdata"), reverse=True)
    dirs += ["/usr/share/tessdata", "/usr/local/share/tessdata", "/opt/homebrew/share/tessdata"]
    return dirs


def _ocr_worker(conn, pdf_path: str, n: int, tessdata: str, lang: str, dpi: int) -> None:
    """Runs in its own process: OCR holds Python's global lock for seconds, which would freeze the
    whole server (playback, scrolling, every other request) if it ran in the server process."""
    try:
        import pymupdf as mu
        from . import layout as L

        doc = mu.open(pdf_path)
        page = doc[n]
        tp = page.get_textpage_ocr(language=lang, dpi=dpi, full=True, tessdata=tessdata)
        conn.send(("ok", L.analyze_page(page, mirror=False, textpage=tp)))
    except BaseException as exc:  # noqa: BLE001 - report everything to the parent
        try:
            conn.send(("err", f"{type(exc).__name__}: {exc}"))
        except Exception:
            pass
    finally:
        conn.close()


class OcrEngine:
    PAGE_TIMEOUT = 240  # seconds; a page that takes longer is skipped (and flagged) instead of hanging forever

    def __init__(self, app_data_dir: Optional[str] = None, languages: Tuple[str, ...] = ("heb", "eng"), dpi: int = 300):
        self._slots = threading.BoundedSemaphore(2)  # at most two pages recognised at the same time
        self.app_data_dir = app_data_dir
        self.wanted = languages
        self.dpi = dpi
        self._tessdata: Optional[str] = None
        self._langs: List[str] = []
        self._probe()

    def _probe(self) -> None:
        for d in candidate_tessdata_dirs(self.app_data_dir):
            if not os.path.isdir(d):
                continue
            have = [os.path.basename(p)[: -len(".traineddata")] for p in glob.glob(os.path.join(d, "*.traineddata"))]
            langs = [l for l in self.wanted if l in have]
            if langs:
                self._tessdata = d
                self._langs = langs
                return

    def refresh(self) -> None:
        self._tessdata = None
        self._langs = []
        self._probe()

    def available(self) -> bool:
        return self._tessdata is not None and bool(self._langs)

    def status(self) -> dict:
        return {"available": self.available(), "tessdata": self._tessdata, "languages": self._langs}

    def analyze(self, pdf_path: str, n: int, timeout: Optional[float] = None):
        """OCR + layout analysis of page `n` in a separate process -> (PageLayout, info)."""
        if not self.available():
            raise RuntimeError("OCR language data not found")
        lang = "+".join(self._langs)
        ctx = multiprocessing.get_context("spawn")
        with self._slots:
            parent, child = ctx.Pipe(duplex=False)
            proc = ctx.Process(target=_ocr_worker, args=(child, pdf_path, n, self._tessdata, lang, self.dpi), daemon=True)
            proc.start()
            child.close()
            try:
                if not parent.poll(timeout or self.PAGE_TIMEOUT):
                    proc.kill()
                    raise TimeoutError(f"OCR of page {n + 1} took longer than {int(timeout or self.PAGE_TIMEOUT)} s")
                status, payload = parent.recv()
            except EOFError:
                raise RuntimeError("the OCR process stopped unexpectedly") from None
            finally:
                parent.close()
                proc.join(5)
                if proc.is_alive():
                    proc.kill()
        if status != "ok":
            raise RuntimeError(payload)
        return payload, {"engine": "tesseract", "languages": lang, "dpi": self.dpi}

    def textpage(self, page: pymupdf.Page):
        if not self.available():
            raise RuntimeError("OCR language data not found")
        lang = "+".join(self._langs)
        tp = page.get_textpage_ocr(language=lang, dpi=self.dpi, full=True, tessdata=self._tessdata)
        return tp, {"engine": "tesseract", "languages": lang, "dpi": self.dpi}
