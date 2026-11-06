"""Narrating ahead of playback, quota-patient background narration, and a slow OCR page not freezing the rest."""
import asyncio
import threading
import time

import pymupdf
import pytest

from conftest import upload
from narrator import service as service_mod
from narrator.tts.base import SynthResult, TTSError, TTSProvider
from narrator.tts.base import ProviderInfo
from narrator.tts.testtone import TestToneProvider


def first_unit_id(client, doc):
    units = client.get(f"/api/documents/{doc}/units", params={"page": 0, "count": 30}).json()["units"]
    return units[0]["id"]


def wait_job(client, doc, states=("done", "error", "cancelled"), timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        j = client.get(f"/api/documents/{doc}/prepare").json()
        if j["state"] in states:
            return j
        time.sleep(0.1)
    raise AssertionError(f"job did not finish: {j}")


def test_prepare_narrates_whole_document_then_playback_is_instant(client, he_pdf):
    doc = upload(client, he_pdf)[0]["id"]
    uid = first_unit_id(client, doc)
    assert client.get(f"/api/documents/{doc}/prepare").json()["state"] == "none"
    start = client.post(f"/api/documents/{doc}/prepare", json={"unit_id": uid}).json()
    assert start["state"] in ("running", "done") and start["pages"] == 2
    j = wait_job(client, doc)
    assert j["state"] == "done" and j["percent"] == 100 and j["chunks_done"] >= 2 and not j["error"]
    # everything is cached: asking for speech again calls the engine zero more times
    calls = {"n": 0}
    real = client.svc.providers["testtone"].synthesize

    async def counting(*a, **k):
        calls["n"] += 1
        return await real(*a, **k)

    client.svc.providers["testtone"].synthesize = counting
    para = next(u for u in client.get(f"/api/documents/{doc}/units", params={"page": 0, "count": 30}).json()["units"]
                if u["kind"] == "paragraph" and u["chunks"])
    r = client.post(f"/api/documents/{doc}/speech", json={"unit_id": para["id"], "chunk": 0})
    assert r.status_code == 200 and calls["n"] == 0


def test_prepare_can_be_cancelled(client, he_pdf):
    doc = upload(client, he_pdf)[0]["id"]
    uid = first_unit_id(client, doc)

    async def slow(*a, **k):
        await asyncio.sleep(0.5)
        raise TTSError("stop", retryable=False)

    client.svc.providers["testtone"].synthesize = slow
    client.post(f"/api/documents/{doc}/prepare", json={"unit_id": uid})
    j = client.delete(f"/api/documents/{doc}/prepare").json()
    assert j["state"] in ("running", "cancelled", "error")
    assert wait_job(client, doc)["state"] in ("cancelled", "error")


class Quota(TTSProvider):
    """A premium voice that refuses the first calls, like a free tier that is used up."""
    info = ProviderInfo(id="gemini", name="Fake premium (limited)", free=True, cloud=False, requires_key=False,
                        word_timing=False, privacy="", verified="")

    def __init__(self):
        self.refuse = 3
        self.calls = 0
        self.inner = TestToneProvider()

    def cooling(self):
        return 0.0

    async def list_voices(self):
        return await self.inner.list_voices()

    async def synthesize(self, text, voice, lang, rate=0, pitch=0):
        self.calls += 1
        if self.refuse > 0:
            self.refuse -= 1
            raise TTSError("used up", retryable=False, quota=True)
        return await self.inner.synthesize(text, "testtone:low", lang)


def test_patient_background_narration_waits_for_quota_instead_of_using_free_voice(client, he_pdf, monkeypatch):
    monkeypatch.setattr(service_mod, "PATIENT_MIN_WAIT", 0.05)
    svc = client.svc
    fake = Quota()
    svc.providers["gemini"] = fake
    svc.update_settings({"voices": {"he": "gemini:Kore", "en": "gemini:Kore"}})
    doc = upload(client, he_pdf)[0]["id"]
    uid = first_unit_id(client, doc)
    client.post(f"/api/documents/{doc}/prepare", json={"unit_id": uid, "patient": True})
    j = wait_job(client, doc, timeout=60)
    assert j["state"] == "done" and j["patient"] is True and not j["error"]
    assert fake.calls >= 4  # three refusals were waited out, then every chunk was narrated by the premium voice
    # nothing was narrated by the fallback voice: the cache holds only premium-voice entries
    metas = [m for m in svc.cache.all_meta()] if hasattr(svc.cache, "all_meta") else []
    assert all(not str(m.get("voice", "")).startswith("edge:") for m in metas)


def test_non_patient_playback_uses_free_voice_when_premium_is_used_up(client, he_pdf):
    svc = client.svc
    fake = Quota()
    fake.refuse = 10 ** 6
    svc.providers["gemini"] = fake
    svc.update_settings({"voices": {"he": "gemini:Kore", "en": "gemini:Kore"}})

    async def free(lang):
        return "testtone:high"

    svc.free_voice = free
    svc.providers["edge"] = TestToneProvider()
    svc.give_consent("edge")
    doc = upload(client, he_pdf)[0]["id"]
    uid = first_unit_id(client, doc)
    r = client.post(f"/api/documents/{doc}/speech", json={"unit_id": uid, "chunk": 0})
    assert r.status_code == 200
    j = r.json()
    assert j["voice"] == "testtone:high" and "free" in j["notice"]


def test_slow_ocr_page_does_not_freeze_other_pages(tmp_path):
    """One scanned page being OCR'd (slow) must not block text pages of the same document."""
    from narrator.pdf.document import PdfDocument

    doc = pymupdf.open()
    for _ in range(3):
        p = doc.new_page()
        p.insert_text((72, 100), "A normal text page with enough words to be recognised as real text. " * 4, fontsize=11)
    scan = doc.new_page()
    import os
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 600, 800), False)
    pix.set_rect(pix.irect, (200, 200, 200))
    scan.insert_image(scan.rect, pixmap=pix)
    path = str(tmp_path / "mixed.pdf")
    doc.save(path)

    class SlowOcr:
        def available(self):
            return True

        def analyze(self, path, n):
            time.sleep(2.0)
            raise RuntimeError("no text")

    pdf = PdfDocument(path, str(tmp_path / "cache"), SlowOcr())
    done = {}

    def ocr_page():
        t = time.time()
        pdf.page(3)
        done["ocr"] = time.time() - t

    th = threading.Thread(target=ocr_page)
    th.start()
    time.sleep(0.4)  # the OCR page is now running
    t = time.time()
    pdf.page(1)
    other = time.time() - t
    th.join()
    assert done["ocr"] >= 1.8
    assert other < 1.0, f"a text page waited {other:.1f}s behind OCR"
