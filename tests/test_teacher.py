import asyncio
import json

import httpx
import pytest

from conftest import upload
from narrator.llm.client import LLMClient, LLMError
from narrator.llm.teacher import ExplanationCache, build_messages, explain


def test_client_speaks_openai_protocol():
    seen = {}

    def handler(request: httpx.Request):
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": "  הסבר קצר.  "}}]})

    c = LLMClient("http://127.0.0.1:11434/v1", "gemma3:12b", transport=httpx.MockTransport(handler))
    out = asyncio.run(c.chat([{"role": "user", "content": "x"}]))
    assert out == "הסבר קצר."
    assert seen["url"].endswith("/v1/chat/completions") and seen["body"]["model"] == "gemma3:12b"


def test_client_errors_are_reported():
    c = LLMClient("http://127.0.0.1:11434/v1", "m", transport=httpx.MockTransport(lambda r: httpx.Response(404, text="model not found")))
    with pytest.raises(LLMError):
        asyncio.run(c.chat([{"role": "user", "content": "x"}]))
    with pytest.raises(LLMError):
        asyncio.run(LLMClient("http://127.0.0.1:1/v1", "").chat([]))


def test_prompt_contains_context_and_caches(tmp_path):
    calls = []

    def handler(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "explanation"}}]})

    c = LLMClient("http://127.0.0.1:11434/v1", "m", transport=httpx.MockTransport(handler))
    cache = ExplanationCache(str(tmp_path))
    a = asyncio.run(explain(c, cache, "he", "חוברת", "5.3 העלייה השנייה", "קטע קודם", "גל העלייה הלך ונחלש"))
    b = asyncio.run(explain(c, cache, "he", "חוברת", "5.3 העלייה השנייה", "קטע קודם", "גל העלייה הלך ונחלש"))
    assert a == b == "explanation" and len(calls) == 1
    user = calls[0]["messages"][1]["content"]
    assert "5.3 העלייה השנייה" in user and "גל העלייה הלך ונחלש" in user
    assert "אל תמציא" in calls[0]["messages"][0]["content"]


def test_explain_endpoint_and_remote_consent(client, he_pdf, monkeypatch):
    doc = upload(client, he_pdf)[0]["id"]
    units = client.get(f"/api/documents/{doc}/units", params={"page": 0, "count": 30}).json()["units"]
    para = [u for u in units if u["kind"] == "paragraph"][1]

    async def fake_chat(self, messages, **kw):
        return "זה ההסבר."

    monkeypatch.setattr(LLMClient, "chat", fake_chat)
    client.put("/api/settings", json={"llm_model": "gemma3:12b"})
    r = client.post(f"/api/documents/{doc}/explain", json={"unit_id": para["id"], "scope": "section"}).json()
    assert r["text"] == "זה ההסבר." and r["lang"] == "he" and r["heading"] == "פרק 1: רקע תיאורטי"
    client.put("/api/settings", json={"llm_base_url": "https://api.example.com/v1"})
    r = client.post(f"/api/documents/{doc}/explain", json={"unit_id": para["id"]})
    assert r.status_code == 409 and r.json()["provider"] == "llm"
