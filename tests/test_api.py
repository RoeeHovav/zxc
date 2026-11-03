"""Service/API level tests using the deterministic test-tone engine."""
import os
import time

import pymupdf
import pytest

from conftest import upload


def first_unit(client, doc_id, page=0, kinds=("paragraph",)):
    units = client.get(f"/api/documents/{doc_id}/units", params={"page": page, "count": 30}).json()["units"]
    return next(u for u in units if u["kind"] in kinds)


def test_upload_open_and_layout(client, he_pdf):
    doc = upload(client, he_pdf)[0]
    assert doc["pages"] == 2
    info = client.get(f"/api/documents/{doc['id']}").json()
    assert info["rtl"] is True and len(info["page_sizes"]) == 2
    lay = client.get(f"/api/documents/{doc['id']}/pages/0/layout").json()
    assert lay["words"] and len(lay["word_unit"]) == len(lay["words"])
    img = client.get(f"/api/documents/{doc['id']}/pages/0/image", params={"scale": 1})
    assert img.status_code == 200 and img.content[:4] == b"\x89PNG"


def test_speech_word_timing_and_cache(client, he_pdf):
    doc = upload(client, he_pdf)[0]["id"]
    u = first_unit(client, doc)
    calls = {"n": 0}
    prov = client.svc.providers["testtone"]
    orig = prov.synthesize

    async def counting(*a, **k):
        calls["n"] += 1
        return await orig(*a, **k)

    prov.synthesize = counting
    r1 = client.post(f"/api/documents/{doc}/speech", json={"unit_id": u["id"], "chunk": 0, "prefetch": False}).json()
    assert r1["timing"] == "word"
    starts = [w[1] for w in r1["words"]]
    assert starts == sorted(starts)
    assert len(r1["words"]) == u["chunks"][0]["words"][1] - u["chunks"][0]["words"][0]
    r2 = client.post(f"/api/documents/{doc}/speech", json={"unit_id": u["id"], "chunk": 0, "prefetch": False}).json()
    assert r2["key"] == r1["key"] and calls["n"] == 1  # second request served from cache
    audio = client.get(r1["audio"])
    assert audio.status_code == 200 and audio.content[:4] == b"RIFF"


def test_lexicon_changes_spoken_text_only_where_needed(client, he_pdf):
    doc = upload(client, he_pdf)[0]["id"]
    u = first_unit(client, doc)
    before = client.post(f"/api/documents/{doc}/speech", json={"unit_id": u["id"], "chunk": 0, "prefetch": False}).json()
    assert "הספר" in before["text"]
    client.post("/api/lexicon", json={"written": "הספר", "spoken": "הַסֵּפֶר", "scope": "document", "doc_id": doc, "lang": "he"})
    after = client.post(f"/api/documents/{doc}/speech", json={"unit_id": u["id"], "chunk": 0, "prefetch": False}).json()
    assert "הַסֵּפֶר" in after["text"] and after["key"] != before["key"]
    # the visual words/timing still map to the same source words
    assert [w[0] for w in after["words"]] == [w[0] for w in before["words"]]


def test_occurrence_correction(client, he_pdf):
    doc = upload(client, he_pdf)[0]["id"]
    u = first_unit(client, doc)
    page, idx = u["words"][0]
    client.post(f"/api/documents/{doc}/occurrence", json={"page": page, "word": idx, "spoken": "בְּדִיקָה"})
    r = client.post(f"/api/documents/{doc}/speech", json={"unit_id": u["id"], "chunk": 0, "prefetch": False}).json()
    assert r["text"].startswith("בְּדִיקָה")


def test_cloud_voice_requires_consent(client, he_pdf):
    doc = upload(client, he_pdf)[0]["id"]
    client.put("/api/settings", json={"voices": {"he": "edge:he-IL-HilaNeural"}})
    u = first_unit(client, doc)
    r = client.post(f"/api/documents/{doc}/speech", json={"unit_id": u["id"], "chunk": 0, "prefetch": False})
    assert r.status_code == 409 and r.json()["error"] == "consent_required" and r.json()["provider"] == "edge"


def test_position_persistence_and_resume(client, he_pdf):
    doc = upload(client, he_pdf)[0]["id"]
    u = first_unit(client, doc)
    client.put(f"/api/documents/{doc}/position", json={"unit_id": u["id"], "word": 7, "page": 0, "chunk": 0, "offset": 2.5, "progress": 0.3, "event": "pause"})
    # simulate an application restart: a brand new service on the same data dir
    from narrator.service import NarratorService
    svc2 = NarratorService(client.svc.data_dir, test_mode=True)
    pos = svc2.db.position(doc)
    assert pos["unit_id"] == u["id"] and pos["word"] == 7 and pos["offset"] == 2.5
    lib = client.get("/api/documents").json()["documents"]
    assert lib[0]["progress"] == pytest.approx(0.3)
    hist = client.get("/api/history").json()["history"]
    assert hist[0]["event"] == "pause"


def test_bookmarks_crud(client, he_pdf):
    doc = upload(client, he_pdf)[0]["id"]
    r = client.post(f"/api/documents/{doc}/bookmarks", json={"page": 1, "word": 3, "label": "פרק 3"}).json()
    bid = r["id"]
    client.put(f"/api/documents/{doc}/bookmarks/{bid}", json={"label": "פרק 3", "note": "לחזור לכאן"})
    bms = client.get(f"/api/documents/{doc}/bookmarks").json()["bookmarks"]
    assert bms[0]["note"] == "לחזור לכאן"
    client.delete(f"/api/documents/{doc}/bookmarks/{bid}")
    assert client.get(f"/api/documents/{doc}/bookmarks").json()["bookmarks"] == []


def test_search_is_niqqud_insensitive(client, he_pdf):
    doc = upload(client, he_pdf)[0]["id"]
    client.get(f"/api/documents/{doc}/pages/0/layout")
    res = client.get(f"/api/documents/{doc}/search", params={"q": "הספר הזה"}).json()["results"]
    assert res and res[0]["page"] == 0  # matches the vowelised "הַסֵּפֶר הַזֶּה"


def test_unit_at_and_neighbours(client, he_pdf):
    doc = upload(client, he_pdf)[0]["id"]
    lay = client.get(f"/api/documents/{doc}/pages/1/layout").json()
    # the first body word of page 2 belongs to the unit that started on page 1
    wi = next(i for i, u in enumerate(lay["word_unit"]) if u >= 0 and lay["unit_kinds"][u] == "paragraph")
    r = client.get(f"/api/documents/{doc}/unit_at", params={"page": 1, "word": wi}).json()
    assert r["unit"]["page"] == 0 and 1 in r["unit"]["pages"]
    nxt = client.get(f"/api/documents/{doc}/units/{r['unit']['id']}/next").json()["unit"]
    assert nxt and nxt["id"] != r["unit"]["id"]


def test_combine_multiple_files(client, he_pdf, en_pdf):
    docs = upload(client, he_pdf, en_pdf, combine=True)
    assert len(docs) == 1 and docs[0]["pages"] == 5


def test_rejects_non_pdf(client, tmp_path):
    p = tmp_path / "x.pdf"
    p.write_text("not a pdf")
    r = client.post("/api/documents", files=[("files", ("x.pdf", open(p, "rb"), "application/pdf"))])
    assert r.status_code == 400


def test_large_document_is_usable_without_full_processing(client, en_pdf, tmp_path):
    """A 600-page PDF opens quickly and any page is available on demand."""
    src = pymupdf.open(en_pdf)
    big = pymupdf.open()
    while big.page_count < 600:
        big.insert_pdf(src)
    path = str(tmp_path / "big.pdf")
    big.save(path)
    t0 = time.time()
    doc = upload(client, path)[0]["id"]
    info = client.get(f"/api/documents/{doc}").json()
    assert info["pages"] == 600
    lay = client.get(f"/api/documents/{doc}/pages/580/layout").json()
    assert lay["words"]
    units = client.get(f"/api/documents/{doc}/units", params={"page": 580, "count": 5}).json()["units"]
    assert units
    assert time.time() - t0 < 30
