"""Regression checks on the user's real 314-page Hebrew study booklet.

The PDF is private and not committed.  Point NARRATOR_USER_PDF at it (or put it
in tests/private/user.pdf) to run these checks.
"""
import os
import time

import pytest

from conftest import ROOT, block_texts

PATH = os.environ.get("NARRATOR_USER_PDF") or os.path.join(ROOT, "tests", "private", "user.pdf")
pytestmark = pytest.mark.skipif(not os.path.exists(PATH), reason="user PDF not available")


@pytest.fixture(scope="module")
def doc(tmp_path_factory):
    from narrator.pdf.document import PdfDocument
    from narrator.pdf.ocr import OcrEngine
    d = PdfDocument(PATH, str(tmp_path_factory.mktemp("u")), OcrEngine())
    yield d
    d.close()


def texts(doc, n):
    return block_texts(doc.page(n - 1))


def test_page_count_and_direction(doc):
    assert doc.page_count == 314
    assert doc.stats().rtl


def test_word_rtl_artifacts_repaired(doc):
    p14 = " ".join(t for _, t in texts(doc, 14))
    assert "השופט חיים כהן (1911-2002) סבר" in p14
    assert "בשנת 1992," in p14  # missing space at direction change restored
    kinds = [k for k, _ in texts(doc, 14)]
    assert kinds.count("paragraph") >= 4  # the three judges are separate passages


def test_section_numbers_follow_author_order(doc):
    assert ("heading", "5.3 העלייה השנייה") in texts(doc, 101)


def test_niqqud_verse(doc):
    p101 = " ".join(t for _, t in texts(doc, 101))
    assert "בֵּית" in p101 and "יעֲקֹב" in p101


def test_caption_spacing_and_lists(doc):
    t301 = texts(doc, 301)
    assert ("caption", "עמידה אינסטינקטיבית ללא ידית הסתערות - M-4") in t301
    assert sum(1 for k, _ in t301 if k == "list_item") >= 3


def test_page_201_continues_previous_page(doc):
    assert doc.continues_from_previous_page(200)


def test_full_document_processing_time(doc):
    t0 = time.time()
    for n in range(doc.page_count):
        doc.page(n)
    assert time.time() - t0 < 240  # includes OCR of image-only pages
