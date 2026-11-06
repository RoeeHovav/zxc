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
        return reply({"0": {"3": "שְׁמָן"}})

    v = make(tmp_path, handler)
    words, chosen, cached = asyncio.run(v.vocalize(SENT))
    assert chosen == {3: "שְׁמָן"} and cached is False and len(seen) == 1
    body = seen[0]
    assert body["generationConfig"]["responseMimeType"] == "application/json"
    msg = body["contents"][0]["parts"][0]["text"]
    assert SENT in msg and '"3": "שמן"' in msg and "Real input" in msg
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
        lambda r: httpx.Response(200, json={"models": []}) if r.method == "GET" else reply({"0": {"3": "שְׁמָן"}})))
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


def test_many_passages_in_one_request(tmp_path):
    calls = []
    texts = [f"הספר במספרה ספר את הכסף {i}" for i in range(5)] + ["hello world", SENT]

    def handler(req):
        if req.method == "GET":
            return httpx.Response(200, json={"models": [{"name": "models/gemini-2.5-flash", "supportedGenerationMethods": ["generateContent"]}]})
        calls.append(str(req.url))
        body = json.loads(req.content)["contents"][0]["parts"][0]["text"]
        real = json.loads(body.split("Real input:\n")[1].split("\nAnswer:")[0])
        ans = {}
        for k, item in real.items():
            w = item["words"]
            ans[k] = {i: "הַסַּפָּר" for i, x in w.items() if x == "הספר"}
            if "שמן" in w.values():
                ans[k][[i for i, x in w.items() if x == "שמן"][0]] = "שְׁמָן"
        return reply(ans)

    v = make(tmp_path, handler)
    res = asyncio.run(v.vocalize_many(texts))
    assert len(calls) == 1 and "gemini-2.5-flash:generateContent" in calls[0]  # seven passages, one request, the accurate model
    assert all(chosen == {0: "הַסַּפָּר"} for (_, chosen, _) in res[:5])
    assert res[5][1] == {} and res[6][1] == {3: "שְׁמָן"}
    assert asyncio.run(v.vocalize_many(texts))[0][2] is True and len(calls) == 1


def test_assistant_reports_what_it_did(tmp_path):
    from narrator.service import NarratorService
    svc = NarratorService(str(tmp_path / "d"), test_mode=True)
    svc.give_consent("gemini-text")
    words = SENT.split()
    tokens, pos = [], 0
    for i, w in enumerate(words):
        tokens.append((pos, pos + len(w), i, i))
        pos += len(w) + 1
    ch = PreparedChunk(index=0, lang="he", text=SENT, tokens=tokens, word_range=(0, len(words)))
    res = asyncio.run(svc._speak_chunk(ch, "testtone:low"))
    assert res["assistant"]["state"] == "no-key"
    svc.vocalizer = P.Vocalizer(str(tmp_path / "pron"), transport=httpx.MockTransport(
        lambda r: httpx.Response(200, json={"models": []}) if r.method == "GET" else reply({"0": {"3": "שְׁמָן"}})))
    svc.vocalizer.configure("K")
    res = asyncio.run(svc._speak_chunk(ch, "testtone:low"))
    assert res["assistant"] == {"state": "ok", "changed": [["שמן", "שְׁמָן"]]}
    svc.update_settings({"ai_pronunciation": False})
    assert asyncio.run(svc._speak_chunk(ch, "testtone:low"))["assistant"]["state"] == "off"


def test_playing_asks_for_the_next_passages_in_one_request(client, he_pdf):
    from conftest import upload
    svc = client.svc
    posts = []

    def handler(req):
        if req.method == "GET":
            return httpx.Response(200, json={"models": []})
        body = json.loads(req.content)["contents"][0]["parts"][0]["text"]
        real = json.loads(body.split("Real input:\n")[1].split("\nAnswer:")[0])
        posts.append(len(real))
        return reply({k: {} for k in real})

    svc.vocalizer = P.Vocalizer(str(svc.data_dir) + "/pron", transport=httpx.MockTransport(handler))
    svc.vocalizer.configure("K")
    svc.give_consent("gemini-text")
    doc = upload(client, he_pdf)[0]["id"]
    units = client.get(f"/api/documents/{doc}/units", params={"page": 0, "count": 30}).json()["units"]
    para = next(u for u in units if u["kind"] == "paragraph" and u["chunks"])
    r = client.post(f"/api/documents/{doc}/speech", json={"unit_id": para["id"], "chunk": 0})
    assert r.status_code == 200 and r.json()["assistant"]["state"] in ("none-needed", "ok")
    assert len(posts) == 1 and posts[0] >= 2  # this passage and the ones after it, together


def test_model_ranking_prefers_current_flash_and_never_hard_codes_old_names():
    names = ["gemini-2.5-flash", "gemini-3.8-flash", "gemini-3.8-flash-lite", "gemini-2.5-pro", "gemini-flash-latest",
             "gemini-2.5-flash-lite", "gemini-3.8-pro"]
    order = sorted(names, key=P.Vocalizer.rank_model)
    assert order[:3] == ["gemini-flash-latest", "gemini-3.8-flash", "gemini-2.5-flash"]
    assert order.index("gemini-3.8-flash-lite") < order.index("gemini-2.5-pro")


def test_retired_model_follows_googles_suggestion(tmp_path):
    """Reported by the user: 'models/gemini-2.5-flash is no longer available to new users ... use gemini-3.8-flash'."""
    asked = []

    def handler(req):
        if req.method == "GET":  # the model list only knows the retired name
            return httpx.Response(200, json={"models": [{"name": "models/gemini-2.5-flash", "supportedGenerationMethods": ["generateContent"]}]})
        model = str(req.url).split("/models/")[1].split(":")[0]
        asked.append(model)
        if model == "gemini-2.5-flash":
            return httpx.Response(404, json={"error": {"code": 404, "message":
                "This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash for the latest features and improvements.",
                "status": "NOT_FOUND"}})
        return reply({"0": {"3": "שְׁמָן"}})

    v = make(tmp_path, handler)
    words, chosen, _ = asyncio.run(v.vocalize(SENT))
    assert chosen == {3: "שְׁמָן"} and asked[:2] == ["gemini-2.5-flash", "gemini-3.8-flash"]
    asked.clear()
    asyncio.run(v.vocalize(SENT + " עוד"))
    assert asked == ["gemini-3.8-flash"]  # the retired model is not tried again


def test_all_models_refused_is_reported_not_silent(tmp_path):
    def handler(req):
        if req.method == "GET":
            return httpx.Response(200, json={"models": []})
        return httpx.Response(404, json={"error": {"message": "model not found"}})

    v = make(tmp_path, handler)
    with pytest.raises(P.PronounceError, match="not available"):
        asyncio.run(v.vocalize(SENT))
