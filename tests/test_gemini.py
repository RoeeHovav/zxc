"""Gemini provider: request shape, model discovery, audio encoding, retries and errors (simulated service)."""
import asyncio
import base64
import json

import httpx
import pytest

from narrator.tts import gemini as g
from narrator.tts.base import TTSError


def pcm(seconds=0.5, rate=24000):
    return b"\x00\x10" * int(rate * seconds)


def audio_response(data, rate=24000):
    return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"inlineData": {
        "mimeType": f"audio/L16;codec=pcm;rate={rate}", "data": base64.b64encode(data).decode()}}]}}]})


def make(handler, key="K", pref=""):
    p = g.GeminiProvider(transport=httpx.MockTransport(handler))
    p.configure({"gemini_api_key": key, "gemini_model": pref})
    return p


MODELS = {"models": [
    {"name": "models/gemini-2.5-pro-preview-tts", "supportedGenerationMethods": ["generateContent"]},
    {"name": "models/gemini-2.5-flash-preview-tts", "supportedGenerationMethods": ["generateContent"]},
    {"name": "models/gemini-2.0-flash", "supportedGenerationMethods": ["generateContent"]},
]}


def test_voices_only_with_key():
    p = g.GeminiProvider()
    assert asyncio.run(p.list_voices()) == []
    assert p.available()[0] is False
    p.configure({"gemini_api_key": "x"})
    vs = asyncio.run(p.list_voices())
    assert len(vs) >= 20 and all(v.lang == "mul" for v in vs)
    assert {"Kore", "Charon"} <= {v.name for v in vs}


def test_request_shape_and_encoding():
    seen = []

    def handler(req: httpx.Request):
        if req.method == "GET":
            return httpx.Response(200, json=MODELS)
        seen.append((str(req.url), req.headers.get("x-goog-api-key"), json.loads(req.content)))
        return audio_response(pcm(1.0))

    p = make(handler)
    res = asyncio.run(p.synthesize("שלום עולם. ספר טוב.", "gemini:Kore", "he"))
    url, key, body = seen[0]
    assert url.endswith("/models/gemini-2.5-flash-preview-tts:generateContent")  # preferred over the pro model
    assert key == "K" and "key=" not in url  # the key travels in a header, never in the URL
    assert body["generationConfig"]["responseModalities"] == ["AUDIO"]
    assert body["generationConfig"]["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"] == "Kore"
    text = body["contents"][0]["parts"][0]["text"]
    assert text.endswith("שלום עולם. ספר טוב.") and "Hebrew" in text and "context" in text
    assert abs(res.duration - 1.0) < 1e-6
    assert res.boundaries == [] and res.ext in ("mp3", "wav")
    if res.ext == "mp3":
        assert res.audio[:3] == b"ID3" or res.audio[0] == 0xFF
    else:
        assert res.audio[:4] == b"RIFF"


def test_model_preference_and_override():
    def handler(req):
        return httpx.Response(200, json=MODELS) if req.method == "GET" else audio_response(pcm())

    p = make(handler)
    assert asyncio.run(p.model()) == "gemini-2.5-flash-preview-tts"
    p2 = make(handler, pref="my-custom-tts")
    assert asyncio.run(p2.model()) == "my-custom-tts"


def test_no_tts_model_is_reported():
    p = make(lambda req: httpx.Response(200, json={"models": [{"name": "models/gemini-2.0-flash"}]}))
    with pytest.raises(TTSError, match="no text-to-speech model"):
        asyncio.run(p.model())


def test_rate_limit_retry_then_success(monkeypatch):
    calls = {"n": 0}

    async def fast_sleep(_):
        return None

    monkeypatch.setattr(g.asyncio, "sleep", fast_sleep)

    def handler(req):
        if req.method == "GET":
            return httpx.Response(200, json=MODELS)
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(429, json={"error": {"message": "quota", "details": [{"retryDelay": "2s"}]}})
        return audio_response(pcm())

    p = make(handler)
    res = asyncio.run(p.synthesize("Hello there.", "gemini:Puck", "en"))
    assert calls["n"] == 3 and res.duration > 0


def test_quota_exhausted_message(monkeypatch):
    async def fast_sleep(_):
        return None

    monkeypatch.setattr(g.asyncio, "sleep", fast_sleep)

    def handler(req):
        if req.method == "GET":
            return httpx.Response(200, json=MODELS)
        return httpx.Response(429, json={"error": {"message": "You exceeded your current quota", "status": "RESOURCE_EXHAUSTED"}})

    p = make(handler)
    with pytest.raises(TTSError, match="free-tier limit"):
        asyncio.run(p.synthesize("Hello there.", "gemini:Puck", "en"))


def test_bad_key_message():
    def handler(req):
        return httpx.Response(400, json={"error": {"message": "API key not valid. Please pass a valid API key.", "status": "INVALID_ARGUMENT"}})

    p = make(handler)
    with pytest.raises(TTSError, match="rejected the Gemini API key"):
        asyncio.run(p.synthesize("Hello there.", "gemini:Puck", "en"))


def test_no_audio_returned():
    def handler(req):
        if req.method == "GET":
            return httpx.Response(200, json=MODELS)
        return httpx.Response(200, json={"candidates": [{"finishReason": "OTHER", "content": {"parts": [{"text": "hi"}]}}]})

    p = make(handler)
    with pytest.raises(TTSError, match="no audio"):
        asyncio.run(p.synthesize("Hello there.", "gemini:Puck", "en"))


def test_sample_rate_from_mime():
    res = g.GeminiProvider._parse(audio_response(pcm(1.0, 16000), rate=16000).json())
    assert abs(res.duration - 1.0) < 1e-6


def test_service_registers_and_hides_key():
    from narrator.service import NarratorService
    import tempfile
    d = tempfile.mkdtemp()
    svc = NarratorService(data_dir=d, test_mode=True)
    assert "gemini" in svc.providers
    assert svc.providers["gemini"].available()[0] is False
    svc.set_secret("gemini_api_key", "SECRET123")
    assert svc.providers["gemini"].available()[0] is True
    assert "SECRET123" not in json.dumps(svc.settings())
    assert svc.secret_status()["gemini_api_key"] is True
    assert "SECRET123" not in json.dumps(svc.providers_info())
    info = {p["id"]: p for p in svc.providers_info()}["gemini"]
    assert info["cloud"] and info["word_timing"] is False
    vs = asyncio.run(svc.voices("gemini"))
    assert vs and vs[0]["lang"] == "mul"
    asyncio.run(svc.voice_for("he"))  # settings default voice for he is set -> unchanged


def test_gemini_requires_consent_before_first_use():
    from narrator.service import NarratorService, ConsentRequired
    import tempfile
    svc = NarratorService(data_dir=tempfile.mkdtemp(), test_mode=True)
    svc.set_secret("gemini_api_key", "K")
    with pytest.raises(ConsentRequired):
        asyncio.run(svc._speak("Hello there.", "gemini:Kore", "en", 0, [], None))
