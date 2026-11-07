"""Dicta Nakdan vowel marks: parsing, validation, caching, batching, failures, and the merge with the Gemini assistant.
The service is simulated; the live accuracy is measured by scripts/eval_pronunciation.py --engine dicta."""
import asyncio
import json

import httpx
import pytest

from narrator.llm import nakdan as N
from narrator.llm import pronounce as P
from narrator.narration.prepare import PreparedChunk

SENT = "מקראות ישראל הינו שמן של חוברות"
VOWELLED = {"מקראות": "מִקְרָאוֹת", "ישראל": "יִשְׂרָאֵל", "הינו": "הִנּוֹ", "שמן": "שֶׁמֶן", "של": "שֶׁל", "חוברות": "חוֹבְרוֹת",
            "כל": "כׇּל", "הספר": "הַ|סֵּפֶר", 'צה"ל': 'צַהַ"ל'}


def dicta_reply(text, table=VOWELLED, bad=()):
    """Split like Dicta does: words and separators, each word with its options."""
    import re
    out = []
    for m in re.finditer(r"[א-ת][א-ת\"']*|[^א-ת]+", text):
        w = m.group(0)
        if re.match("[א-ת]", w):
            core = w.rstrip("\"'") if w.endswith(("\"", "'")) and w.count('"') == 1 and w.endswith('"') else w
            v = table.get(w, "")
            if w in bad:
                v = "שָׁלוֹם"
            out.append({"word": w, "sep": False, "options": [[v, []]] if v else [], "fconfident": False})
        else:
            out.append({"word": w, "sep": True, "options": []})
    return out


def handler_for(calls, table=VOWELLED, status=200, bad=()):
    def h(req):
        body = json.loads(req.content)
        calls.append(body)
        if status != 200:
            return httpx.Response(status, text="busy")
        return httpx.Response(200, json=dicta_reply(body["data"], table, bad))
    return h


def make(tmp_path, handler):
    return N.Nakdan(str(tmp_path / "vowels"), transport=httpx.MockTransport(handler))


def test_clean_writes_o_vowels_as_holam_and_drops_separators():
    assert N.clean("כׇּל") == N.clean("כֹּל")
    assert "|" not in N.clean("הַ|סֵּפֶר") and N.strip_marks(N.clean("הַ|סֵּפֶר")) == "הספר"
    assert N.clean("צׇהֳרַיִם").count("ֹ") == 2


def test_parse_maps_every_word_and_rejects_changed_letters():
    spans = N.parse(dicta_reply(SENT), SENT)
    assert [SENT[a:b] for a, b, _ in spans] == SENT.split()
    assert all(N.same_word(v, SENT[a:b]) for a, b, v in spans)
    assert dict((SENT[a:b], v) for a, b, v in spans)["הינו"] == "הִנּוֹ"  # vowelled spelling without the vowel letter י
    assert N.same_word("סִפּוּרִים", "סיפורים") and not N.same_word("סִפּוּר", "סיפורים") and not N.same_word("שָׁלוֹם", "שמן")
    spans = N.parse(dicta_reply(SENT, bad=("שמן",)), SENT)  # an answer with other letters is ignored
    assert "שמן" not in [SENT[a:b] for a, b, _ in spans] and len(spans) == 5
    assert N.parse(dicta_reply(SENT), SENT + " עוד") is None  # does not match the text: nothing is used
    assert N.parse({"error": 1}, SENT) is None


def test_words_already_marked_keep_their_marks_and_the_rest_is_still_vowelled(tmp_path):
    calls = []
    v = make(tmp_path, handler_for(calls, table={**VOWELLED, "צהל": "צַהַל"}))
    text = "מקראות צַהַל ישראל"  # the app's own expansion of צה"ל already carries marks
    spans = asyncio.run(v.vowel(text))
    assert "ֿ" not in calls[0]["data"] and calls[0]["data"] == "מקראות צהל ישראל"  # Dicta gets plain letters
    got = {text[a:b]: w for a, b, w in spans}
    assert got == {"מקראות": "מִקְרָאוֹת", "ישראל": "יִשְׂרָאֵל"}  # the marked word is left as it was


def test_one_letter_prefixes_and_geresh_words_are_left_to_the_voice(tmp_path):
    reply = [{"word": "ב", "sep": False, "options": [["בִּ", []]]}, {"word": "-2.5% ", "sep": True, "options": []},
             {"word": "הג'ירפה", "sep": False, "options": [["הַגִּ'ירָפָה", []]]}, {"word": " ", "sep": True, "options": []},
             {"word": "גדלה", "sep": False, "options": [["גָּדְלָה", []]]}]
    text = "ב-2.5% הג'ירפה גדלה"
    assert [text[a:b] for a, b, _ in N.parse(reply, text)] == ["גדלה"]


def test_one_request_for_many_passages_and_cached(tmp_path):
    calls = []
    v = make(tmp_path, handler_for(calls))
    texts = [SENT, "hello world", 'כל הספר של צה"ל', SENT]
    out = asyncio.run(v.vowel_many(texts))
    assert len(calls) == 1 and calls[0]["keepqq"] is True and calls[0]["data"].count("\n") == 1  # duplicates and English not sent
    assert out[1] == [] and out[0] == out[3]
    third = {texts[2][a:b]: w for a, b, w in out[2]}
    assert third["כל"] == "כֹּל" and N.strip_marks(third["הספר"]) == "הספר" and 'צה"ל' not in third  # left to the voice
    again = asyncio.run(v.vowel_many(texts))
    assert again == out and len(calls) == 1  # remembered on disk


def test_failure_means_plain_reading_and_a_short_pause(tmp_path):
    calls = []
    v = make(tmp_path, handler_for(calls, status=503))
    assert asyncio.run(v.vowel(SENT)) is None and not v.available()
    assert asyncio.run(v.vowel(SENT)) is None and len(calls) == 1  # not asked again at once
    v2 = N.Nakdan(str(tmp_path / "v2"), transport=httpx.MockTransport(lambda r: (_ for _ in ()).throw(httpx.ConnectError("x"))))
    assert asyncio.run(v2.vowel(SENT)) is None and "ConnectError" in v2.last_error or v2.last_error


def _chunk(text):
    words = text.split()
    tokens, pos = [], 0
    for i, w in enumerate(words):
        tokens.append((pos, pos + len(w), i, i))
        pos += len(w) + 1
    return PreparedChunk(index=0, lang="he", text=text, tokens=tokens, word_range=(0, len(words)))


@pytest.fixture
def svc(tmp_path):
    from narrator.service import NarratorService
    s = NarratorService(str(tmp_path / "d"), test_mode=True)
    sent = {}
    real = s.providers["testtone"].synthesize

    async def spy(text, voice, lang, rate=0, pitch=0):
        sent["text"] = text
        return await real(text, voice, lang, rate, pitch)

    s.providers["testtone"].synthesize = spy
    s.sent = sent
    return s


def test_every_word_gets_dicta_marks_and_gemini_decides_the_ambiguous_ones(svc, tmp_path):
    from narrator.service import ConsentRequired
    calls = []
    svc.nakdan = make(tmp_path, handler_for(calls))
    ch = _chunk(SENT)
    with pytest.raises(ConsentRequired) as ei:  # asked first: text goes to Dicta
        asyncio.run(svc._speak_chunk(ch, "testtone:low"))
    assert ei.value.provider == "dicta-nakdan" and "Dicta" in ei.value.info.privacy
    svc.give_consent("dicta-nakdan")
    res = asyncio.run(svc._speak_chunk(ch, "testtone:low"))
    said = svc.sent["text"]
    assert "שֶׁמֶן" in said and "יִשְׂרָאֵל" in said  # every word vowelled
    assert res["assistant"]["engine"] == "dicta" and res["assistant"]["dicta"] == 6
    assert res["words"] and len(res["words"]) == 6  # word timing still lines up
    # with the Gemini assistant too: its reading of the ambiguous word wins, Dicta's marks stay on the others
    svc.vocalizer = P.Vocalizer(str(tmp_path / "pron"), transport=httpx.MockTransport(
        lambda r: httpx.Response(200, json={"models": []}) if r.method == "GET" else
        httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": json.dumps({"0": {"3": "שְׁמָן"}})}]}}]})))
    svc.vocalizer.configure("K")
    svc.give_consent("gemini-text")
    res = asyncio.run(svc._speak_chunk(ch, "testtone:low"))
    said = svc.sent["text"]
    assert "שְׁמָן" in said and "שֶׁמֶן" not in said and "יִשְׂרָאֵל" in said and "הִנּוֹ" in said
    a = res["assistant"]
    assert a["engine"] == "dicta+gemini" and a["changed"][0]["chosen"] == "שְׁמָן" and a["vowelled"] == 6


def test_dicta_off_or_declined_reads_as_before(svc, tmp_path):
    calls = []
    svc.nakdan = make(tmp_path, handler_for(calls))
    ch = _chunk(SENT)
    assert svc.decline_consent("dicta-nakdan") is True  # saying no switches it off; narration carries on
    res = asyncio.run(svc._speak_chunk(ch, "testtone:low"))
    assert svc.sent["text"] == SENT and not calls and res["assistant"]["state"] == "no-key"
    assert svc.decline_consent("edge") is False  # a voice itself cannot be "declined" into silence


def test_dicta_down_still_reads(svc, tmp_path):
    svc.nakdan = make(tmp_path, handler_for([], status=500))
    svc.give_consent("dicta-nakdan")
    res = asyncio.run(svc._speak_chunk(_chunk(SENT), "testtone:low"))
    assert svc.sent["text"] == SENT and res["assistant"]["dicta_error"]


def test_offline_test_mode_never_calls_dicta(svc):
    assert svc.nakdan.transport is None
    res = asyncio.run(svc._speak_chunk(_chunk(SENT), "testtone:low"))
    assert svc.sent["text"] == SENT and "engine" not in res["assistant"]


def test_decline_endpoint(client):
    r = client.post("/api/consent", json={"provider": "dicta-nakdan", "decline": True})
    assert r.status_code == 200 and r.json()["settings"]["nakdan"] is False
    assert client.post("/api/consent", json={"provider": "edge", "decline": True}).status_code == 400
