import pymupdf
import pytest


def _scanned(src, dst):
    s = pymupdf.open(src)
    out = pymupdf.open()
    pix = s[0].get_pixmap(dpi=200)
    pg = out.new_page(width=s[0].rect.width, height=s[0].rect.height)
    pg.insert_image(pg.rect, pixmap=pix)
    out.save(dst)


def test_scanned_page_is_ocred_or_flagged(make_doc, he_pdf, tmp_path):
    from narrator.pdf.ocr import OcrEngine
    path = str(tmp_path / "scan.pdf")
    _scanned(he_pdf, path)
    d = make_doc(path)
    pg = d.page(0)
    if OcrEngine().available():
        assert pg["source"] == "ocr"
        text = " ".join(w[0] for w in pg["words"])
        assert "למידה" in text or "הלמידה" in text
        assert "machine" in text
    else:
        assert pg["source"] == "needs_ocr"
        assert pg["warnings"]


def test_no_ocr_engine_flags_page(make_doc, he_pdf, tmp_path):
    path = str(tmp_path / "scan2.pdf")
    _scanned(he_pdf, path)
    d = make_doc(path, ocr=False)
    assert d.page(0)["source"] == "needs_ocr"


def test_ocr_runs_in_a_separate_process_and_can_time_out(he_pdf, tmp_path):
    import pytest
    from narrator.pdf.ocr import OcrEngine
    eng = OcrEngine()
    if not eng.available():
        pytest.skip("no OCR language data on this machine")
    path = str(tmp_path / "scan.pdf")
    _scanned(he_pdf, path)
    import time
    t = time.time()
    with pytest.raises(TimeoutError):
        eng.analyze(path, 0, timeout=0.05)
    assert time.time() - t < 10  # the worker was killed, nothing hangs
    lay, info = eng.analyze(path, 0)
    assert lay.glyph_count > 20 and info["engine"] == "tesseract"
