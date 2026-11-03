import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
FIXTURES = os.path.join(ROOT, "tests", "fixtures")


@pytest.fixture(scope="session")
def he_pdf():
    return os.path.join(FIXTURES, "he_mixed.pdf")


@pytest.fixture(scope="session")
def en_pdf():
    return os.path.join(FIXTURES, "en_academic.pdf")


@pytest.fixture
def make_doc(tmp_path):
    from narrator.pdf.document import PdfDocument
    from narrator.pdf.ocr import OcrEngine

    docs = []

    def _make(path, ocr=True):
        d = PdfDocument(path, str(tmp_path / f"cache{len(docs)}"), OcrEngine() if ocr else None)
        docs.append(d)
        return d

    yield _make
    for d in docs:
        d.close()


def block_texts(page):
    from narrator.pdf.document import page_block_text
    return [(b["kind"], page_block_text(page, i)) for i, b in enumerate(page["blocks"])]


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("NARRATOR_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("NARRATOR_TEST_MODE", "1")
    from fastapi.testclient import TestClient
    from narrator.app import create_app
    from narrator.service import NarratorService

    svc = NarratorService(str(tmp_path / "data"), test_mode=True)
    app = create_app(svc)
    with TestClient(app) as c:
        c.svc = svc
        yield c


def upload(client, *paths, combine=False):
    files = [("files", (os.path.basename(p), open(p, "rb"), "application/pdf")) for p in paths]
    r = client.post("/api/documents", files=files, data={"combine": "true" if combine else "false"})
    assert r.status_code == 200, r.text
    return r.json()["documents"]
