"""Context-aware Hebrew pronunciation: vowel marks for ambiguous words, validated and cached."""
import asyncio
import json

import httpx
import pytest

from narrator.llm import pronounce as P
from narrator.narration.prepare import PreparedChunk

SENT = "מקראות ישראל הינו שמן של חוברות"


def reply(mapping):
    return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(mapping, ensure_ascii=False)}]}}]})


def make(tmp_path, handler, key="K"):
    v = P.Vocalizer(str(tmp_path / "pron"), transport=httpx.MockTransport(handler))
    v.configure(key)
    return v


def test_words_and_validation():
    words = P.hebrew_words(SENT + " 5 ok וְכֵן")
    assert [w for _, _, w in words] == SENT.split()  # numbers, Latin and already-vowelled words are not sent
    chosen = P.validate({"3": "שְׁמָן", "0": "משהו", "1": "יִשְׂרָאֵל!", "9": "x", "x": "y", "2": "הִינוֹ"}, words)
    assert chosen == {3: "שְׁמָן", 2: "הִינוֹ"}  # changed letters / punctuation / bad keys are ignored


def test_apply_keeps_tokens_aligned():
    words = P.hebrew_words(SENT)
    chosen = {3: "שְׁמָן", 5: "חוּבְרוֹת"}
    tokens = []
    pos = 0
    for i, w in enumerate(SENT.split()):
        tokens.append((pos, pos + len(w), i, i))
        pos += len(w) + 1
    text, new = P.apply(SENT, words, chosen, tokens)
    assert P.strip_marks(text) == SENT and "שְׁמָן" in text
    for (s, e, a, b), w in zip(new, text.split()):
        assert text[s:e] == w


def test_asks_model_once_and_caches(tmp_path):
    seen = []

    def handler(req):
        if req.method == "GET":
            return httpx.Response(200, json={"models": [{"name": "models/gemini-2.5-flash-lite", "supportedGenerationMethods": ["generateContent"]}]})
        seen.append(json.loads(req.content))
        assert req.headers["x-goog-api-key"] == "K" and "key=" not in str(req.url)
        return reply({"3": "שְׁמָן"})

    v = make(tmp_path, handler)
    words, chosen, cached = asyncio.run(v.vocalize(SENT))
    assert chosen == {3: "שְׁמָן"} and cached is False and len(seen) == 1
    body = seen[0]
    assert body["generationConfig"]["responseMimeType"] == "application/json"
    msg = body["contents"][0]["parts"][0]["text"]
    assert SENT in msg and '"3": "שמן"' in msg
    words, chosen, cached = asyncio.run(v.vocalize(SENT))
    assert chosen == {3: "שְׁמָן"} and cached is True and len(seen) == 1  # second time: from disk, no request
    # a new assistant object (e.g. after restart) also reads the disk cache
    v2 = make(tmp_path, lambda r: pytest.fail("should not call the service"))
    assert asyncio.run(v2.vocalize(SENT))[1] == {3: "שְׁמָן"}


def test_garbage_and_quota_never_break_reading(tmp_path):
    v = make(tmp_path, lambda r: httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "not json at all"}]}}]}))
    with pytest.raises(P.PronounceError):
        asyncio.run(v.vocalize(SENT))

    def quota(req):
        if req.method == "GET":
            return httpx.Response(200, json={"models": []})
        return httpx.Response(429, json={"error": {"message": "quota", "details": [{"violations": [{"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]}})

    v = make(tmp_path / "q", quota)
    with pytest.raises(P.PronounceError) as ei:
        asyncio.run(v.vocalize(SENT))
    assert ei.value.quota and not v.available()


def test_service_sends_vowelled_text_to_the_voice(tmp_path):
    from narrator.service import ConsentRequired, NarratorService
    svc = NarratorService(str(tmp_path / "d"), test_mode=True)
    sent = {}
    real = svc.providers["testtone"].synthesize

    async def spy(text, voice, lang, rate=0, pitch=0):
        sent["text"] = text
        return await real(text, voice, lang, rate, pitch)

    svc.providers["testtone"].synthesize = spy
    svc.vocalizer = P.Vocalizer(str(tmp_path / "pron"), transport=httpx.MockTransport(
        lambda r: httpx.Response(200, json={"models": []}) if r.method == "GET" else reply({"3": "שְׁמָן"})))
    svc.set_secret("gemini_api_key", "K")
    svc.vocalizer.configure("K")
    words = SENT.split()
    tokens, pos = [], 0
    for i, w in enumerate(words):
        tokens.append((pos, pos + len(w), i, i))
        pos += len(w) + 1
    ch = PreparedChunk(index=0, lang="he", text=SENT, tokens=tokens, word_range=(0, len(words)))
    # the question about sending text to Google is asked first
    with pytest.raises(ConsentRequired) as ei:
        asyncio.run(svc._speak_chunk(ch, "testtone:low"))
    assert ei.value.provider == "gemini-text" and "Google" in ei.value.info.privacy
    svc.give_consent("gemini-text")
    res = asyncio.run(svc._speak_chunk(ch, "testtone:low"))
    assert "שְׁמָן" in sent["text"] and P.strip_marks(sent["text"]) == SENT
    assert res["words"] and len(res["words"]) == len(words)  # word timing still lines up
    # off switch: text goes to the voice untouched
    svc.update_settings({"ai_pronunciation": False})
    asyncio.run(svc._speak_chunk(ch, "testtone:low"))
    assert sent["text"] == SENT
    # English passages and Gemini's own voices are never sent for vowelling
    svc.update_settings({"ai_pronunciation": True})
    en = PreparedChunk(index=0, lang="en", text="Hello world", tokens=[(0, 5, 0, 0), (6, 11, 1, 1)], word_range=(0, 2))
    asyncio.run(svc._speak_chunk(en, "testtone:high"))
    assert sent["text"] == "Hello world"
