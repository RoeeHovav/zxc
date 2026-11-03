"""OCR for scanned pages.

PyMuPDF ships with Tesseract compiled in, so we only need the language model
files (``*.traineddata``).  No separate Tesseract installation is required:
``scripts/fetch_ocr_models.py`` downloads them into the app data folder, and a
system Tesseract installation is also picked up if present.
"""
from __future__ import annotations

import glob
import logging
import os
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


class OcrEngine:
    def __init__(self, app_data_dir: Optional[str] = None, languages: Tuple[str, ...] = ("heb", "eng"), dpi: int = 300):
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

    def textpage(self, page: pymupdf.Page):
        if not self.available():
            raise RuntimeError("OCR language data not found")
        lang = "+".join(self._langs)
        tp = page.get_textpage_ocr(language=lang, dpi=self.dpi, full=True, tessdata=self._tessdata)
        return tp, {"engine": "tesseract", "languages": lang, "dpi": self.dpi}
