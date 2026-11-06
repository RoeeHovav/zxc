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


def quota_error(kind, retry="0.05s", limit="3"):
    return httpx.Response(429, json={"error": {"code": 429, "message": "You exceeded your current quota, please check your plan",
        "status": "RESOURCE_EXHAUSTED", "details": [
            {"@type": "type.googleapis.com/google.rpc.QuotaFailure", "violations": [
                {"quotaMetric": "generativelanguage.googleapis.com/generate_content_free_tier_requests",
                 "quotaId": f"GenerateRequestsPer{kind}PerProjectPerModel-FreeTier", "quotaValue": limit}]},
            {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": retry}]}})


def test_per_minute_limit_waits_and_succeeds():
    calls = {"n": 0}

    def handler(req):
        if req.method == "GET":
            return httpx.Response(200, json=MODELS)
        calls["n"] += 1
        return quota_error("Minute") if calls["n"] < 3 else audio_response(pcm())

    p = make(handler)
    res = asyncio.run(p.synthesize("Hello there.", "gemini:Puck", "en"))
    assert calls["n"] == 3 and res.duration > 0 and p.cooling() == 0


def test_daily_limit_rotates_to_next_model_then_remembers():
    seen = []

    def handler(req):
        if req.method == "GET":
            return httpx.Response(200, json=MODELS)
        model = str(req.url).split("/models/")[1].split(":")[0]
        seen.append(model)
        return quota_error("Day", limit="10") if model == "gemini-2.5-flash-preview-tts" else audio_response(pcm())

    p = make(handler)
    asyncio.run(p.synthesize("Hello there.", "gemini:Puck", "en"))
    assert seen == ["gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts"]
    seen.clear()
    asyncio.run(p.synthesize("Another one.", "gemini:Puck", "en"))
    assert seen == ["gemini-2.5-pro-preview-tts"]  # the used-up model is left alone for a while


def test_all_models_used_up_reports_quota_and_cools_down():
    def handler(req):
        return httpx.Response(200, json=MODELS) if req.method == "GET" else quota_error("Day", limit="10")

    p = make(handler)
    with pytest.raises(TTSError, match="allowance for speech is used up") as ei:
        asyncio.run(p.synthesize("Hello there.", "gemini:Puck", "en"))
    assert ei.value.quota is True and ei.value.retryable is False
    assert p.cooling() > 0 and p.available()[0] is False
    # while cooling down no request is sent at all
    with pytest.raises(TTSError) as ei2:
        asyncio.run(p.synthesize("Hello there.", "gemini:Puck", "en"))
    assert ei2.value.quota is True


def test_quota_without_details_is_treated_as_used_up():
    def handler(req):
        if req.method == "GET":
            return httpx.Response(200, json=MODELS)
        return httpx.Response(429, json={"error": {"message": "You exceeded your current quota", "status": "RESOURCE_EXHAUSTED"}})

    p = make(handler)
    with pytest.raises(TTSError) as ei:
        asyncio.run(p.synthesize("Hello there.", "gemini:Puck", "en"))
    assert ei.value.quota


def test_service_falls_back_to_free_voice_when_allowance_used_up(tmp_path):
    from narrator.service import NarratorService
    from narrator.tts.testtone import TestToneProvider

    def handler(req):
        return httpx.Response(200, json=MODELS) if req.method == "GET" else quota_error("Day", limit="10")

    svc = NarratorService(str(tmp_path), test_mode=True)
    svc.providers["gemini"] = make(handler)
    svc.providers["edge"] = TestToneProvider()  # stands in for the free Microsoft voice
    svc.give_consent("gemini")
    svc.give_consent("edge")

    async def free(lang):
        return "edge:low"

    svc.free_voice = free
    res = asyncio.run(svc._speak("Hello there world.", "gemini:Kore", "en", 0, [], (0, 3)))
    assert res["voice"] == "edge:low" and "allowance" in res["notice"] and res["duration"] > 0
    svc.update_settings({"free_fallback": False})
    with pytest.raises(TTSError):
        asyncio.run(svc._speak("Hello there world two.", "gemini:Kore", "en", 0, [], (0, 4)))


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
