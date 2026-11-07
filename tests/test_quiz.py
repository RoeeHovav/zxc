"""Comprehension checkpoints: where they go, how questions are checked, and the HTTP flow (simulated model)."""
import asyncio
import json
import re
from types import SimpleNamespace

import pytest

from narrator.llm import quiz as Q
from narrator.narration import checkpoints as C

PARA1 = ("הדמוקרטיה הישראלית התפתחה בשלושה שלבים: תחילה הוקמו מוסדות היישוב, אחר כך נחקקו חוקי היסוד, ולבסוף התגבשה "
         "הפרשנות השיפוטית. השופט כהן סבר כי יש למצוא את שורשי הדמוקרטיה ביהדות ובמשפט העברי, ואילו השופט ברק ביקש לפרש "
         "את המושג יהדות פירוש מצמצם.")
PARA2 = ("לפי השופט אלון, היהדות והדמוקרטיה הן שתי מערכות ערכיות מקבילות ושוות במעמדן, והן צריכות להנחות את השופט "
         "בעת שהוא מכריע בשאלות עקרוניות. בשנת 1992 נחקקו חוקי היסוד שבהם הופיעה לראשונה ההגדרה מדינה יהודית ודמוקרטית.")


def U(uid, kind, text, page=1):
    words = text.split()
    return SimpleNamespace(id=uid, kind=kind, texts=words, words=[(page, i) for i in range(len(words))], page=page,
                           lang="he", text=lambda t=text: t)


# --------------------------------------------------------------------------- where a checkpoint goes
def chain(units):
    nxt = {a.id: b for a, b in zip(units, units[1:])}
    return lambda uid: nxt.get(uid)


def body(n, page=1, words=260):
    return U(f"{page}.{n}", "paragraph", " ".join(["מילה"] * words), page)


def test_section_checkpoint_ends_before_the_next_heading_and_not_right_after_a_heading():
    units = [U("1.0", "heading", "פרק ראשון"), body(1), body(2), U("1.3", "heading", "פרק שני"), body(4), body(5)]
    p = C.plan(units[0], chain(units), {}, "section")
    assert [u["id"] for u in p["units"]] == ["1.0", "1.1", "1.2"] and p["end"] == "1.2" and p["ask"] and p["why"] == "section"
    # a section that is too short is merged with the next one
    short = [U("1.0", "heading", "א"), U("1.1", "paragraph", "משפט קצר מאוד כאן."), U("1.2", "heading", "ב"), body(3), body(4)]
    p2 = C.plan(short[0], chain(short), {}, "section")
    assert p2["end"] == "1.4"


def test_page_mode_cuts_at_the_page_break_and_never_after_a_line_that_introduces_a_list():
    units = [body(0, 1), body(1, 1), body(2, 2), body(3, 2)]
    p = C.plan(units[0], chain(units), {}, "page")
    assert p["end"] == "1.1" and p["why"] == "page"
    intro = [body(0, 1), U("1.1", "paragraph", " ".join(["מילה"] * 300) + " כדלקמן:", 1), body(2, 2)]
    p = C.plan(intro[0], chain(intro), {}, "page")
    assert p["end"] == "2.2"  # the page ends with "...as follows:", so the list that follows belongs to the same stretch


def test_minutes_mode_and_unread_kinds():
    units = [body(i, words=300) for i in range(12)]
    p = C.plan(units[0], chain(units), {}, "minutes", minutes=4)
    assert 3.5 <= p["minutes"] <= 6 and p["why"] == "time"
    notes = [U("1.0", "paragraph", " ".join(["מילה"] * 300)), U("1.1", "footnote", " ".join(["הערה"] * 300)), U("1.2", "paragraph", " ".join(["מילה"] * 300))]
    p = C.plan(notes[0], chain(notes), {"footnote": False}, "section")
    assert [u["id"] for u in p["units"]] == ["1.0", "1.2"]
    assert C.plan(notes[0], chain(notes), {}, "off") is None


def test_paragraph_mode_asks_after_each_paragraph_and_joins_very_short_ones():
    units = [U("1.0", "heading", "פרק"), body(1, words=90), body(2, words=90), U("1.3", "paragraph", "שורה קצרה."), body(4, words=90)]
    p = C.plan(units[0], chain(units), {}, "paragraph")
    assert [u["id"] for u in p["units"]] == ["1.0", "1.1"] and p["ask"] and p["why"] == "paragraph"
    p = C.plan(units[3], chain(units), {}, "paragraph")
    assert [u["id"] for u in p["units"]] == ["1.3", "1.4"]  # a one-line paragraph is asked about with the next one
    assert C.min_chars("paragraph") < C.min_chars("section")


def test_short_stretch_is_not_worth_a_quiz():
    p = C.plan(U("1.0", "paragraph", "משפט אחד קצר."), lambda uid: None, {}, "section")
    assert p["ask"] is False


# --------------------------------------------------------------------------- finding the quotation
def passage():
    return Q.Passage([U("3.0", "heading", "יהדות ודמוקרטיה", 3), U("3.1", "paragraph", PARA1, 3), U("3.2", "paragraph", PARA2, 3)])


def test_quotation_is_found_with_small_differences_and_mapped_to_a_word():
    p = passage()
    loc = p.locate("השופט ברק ביקש לפרש את המושג יהדות פירוש מצמצם")
    assert loc and loc["unit"] == "3.1" and PARA1.split()[loc["word"]] == "השופט"
    # vowel marks, quote style and punctuation do not matter; a different word order or invented text does
    assert p.locate("בשנת 1992 נחקקו חוקי־היסוד שבהם הופיעה לראשונה ההגדרה “מדינה יהודית ודמוקרטית”")["unit"] == "3.2"
    assert p.locate("השופט כהן סבר כי יש למצוא את שורשי הדמוקרטיה ביהדות ובמשפט העברי")["word"] == PARA1.split().index("כהן") - 1
    assert p.locate("השופט ברק טען שיש לבטל את חוקי היסוד לחלוטין ולהקים מדינה חדשה בכל המזרח התיכון") is None
    assert p.locate("קצר מדי") is None


# --------------------------------------------------------------------------- the checks on what the model wrote
def good(**kw):
    q = {"kind": "detail", "q": "לפי הטקסט, מי ביקש לפרש את המושג יהדות פירוש מצמצם?",
         "options": ["השופט ברק", "השופט כהן", "השופט אלון", "השופט לנדוי"],
         "evidence": "השופט ברק ביקש לפרש את המושג יהדות פירוש מצמצם", "why": "כך נאמר בטקסט."}
    q.update(kw)
    return q


def test_a_good_question_is_kept_and_the_answer_is_placed_by_the_app():
    qs, rej = Q.validate({"questions": [good()]}, passage())
    assert len(qs) == 1 and not rej
    q = qs[0]
    assert q["options"][q["answer"]] == "השופט ברק" and q["unit"] == "3.1"
    # deterministic: the same question always gets the same order, and it is not simply "first"
    assert Q.validate({"questions": [good()]}, passage())[0][0]["options"] == q["options"]
    positions = {Q.shuffled(["a", "b", "c", "d"], 0, f"q{i}")[1] for i in range(40)}
    assert positions == {0, 1, 2, 3}


@pytest.mark.parametrize("change,reason", [
    ({"evidence": "השופט ברק אמר שאין לו שום עניין בנושא וכך הוא סיים את דבריו בבית המשפט"}, "evidence-not-in-text"),
    ({"options": ["השופט ברק", "השופט כהן", "כל התשובות נכונות", "השופט לנדוי"]}, "giveaway-option"),
    ({"options": ["השופט ברק", "תמיד השופט כהן", "השופט אלון", "השופט לנדוי"]}, "absolute-word"),
    ({"options": ["השופט ברק", "השופט ברק", "השופט אלון", "השופט לנדוי"]}, "options"),
    ({"options": ["השופט ברק ביקש לפרש את המושג פירוש מצמצם מאוד ובאופן מפורט וארוך במיוחד", "כהן", "אלון", "לנדוי"]}, "correct-answer-stands-out"),
    ({"options": ["א", "ב", "ג"]}, "malformed"),
    ({"q": "קצר"}, "malformed"),
])
def test_questions_that_are_ungrounded_or_give_themselves_away_are_dropped(change, reason):
    qs, rej = Q.validate({"questions": [good(**change)]}, passage())
    assert qs == [] and rej[reason] == 1


def test_duplicate_questions_are_dropped_and_recall_needs_key_points_and_a_real_quotation():
    qs, rej = Q.validate({"questions": [good(), good(), good(q="מי ביקש לפרש את המושג יהדות פירוש מצמצם לפי הטקסט?")]}, passage())
    assert len(qs) == 1 and rej["duplicate"] == 2
    r, rej = Q.validate_recall({"recall": [
        {"q": "מה ההבדל בין עמדת השופט כהן לעמדת השופט ברק?", "key_points": ["כהן: שורשי הדמוקרטיה ביהדות", "ברק: פירוש מצמצם"],
         "evidence": "השופט כהן סבר כי יש למצוא את שורשי הדמוקרטיה ביהדות ובמשפט העברי"},
        {"q": "שאלה בלי נקודות עיקריות כלל?", "key_points": ["אחת"], "evidence": "השופט כהן סבר כי יש למצוא את שורשי הדמוקרטיה"},
        {"q": "שאלה עם ציטוט שהומצא לגמרי?", "key_points": ["א ב ג", "ד ה ו"], "evidence": "משפט שלא מופיע בשום מקום בטקסט הזה בכלל"},
    ]}, passage())
    assert len(r) == 1 and r[0]["kind"] == "recall" and r[0]["unit"] == "3.1" and rej["recall-malformed"] == 1 and rej["recall-evidence-not-in-text"] == 1


def test_select_prefers_what_a_listener_who_did_not_listen_gets_wrong_and_mixes_kinds():
    cands = [dict(kind="detail", q="a"), dict(kind="detail", q="b"), dict(kind="link", q="c"), dict(kind="apply", q="d")]
    guesses = [(True, 5), (False, 4), (True, 2), (True, 5)]
    out = Q.select(cands, guesses)
    assert [c["q"] for c in out] == ["b", "c", "d"]  # the wrong guess, then the unsure one, then the rest: three different kinds
    assert [c["q"] for c in Q.select(cands, [(True, 5)] * 4)] == ["a", "c", "d"]  # nothing hard: still different kinds


def test_styles_decide_how_the_questions_are_mixed():
    r = {"choice": [dict(kind="apply", q="a"), dict(kind="detail", q="b"), dict(kind="link", q="c")],
         "recall": [dict(kind="recall", q="r1"), dict(kind="recall", q="r2"), dict(kind="recall", q="r3")]}
    assert [q["q"] for q in Q.assemble(r, "mixed")] == ["b", "a", "r1"]       # two multiple choice (in kind order), then one open
    assert [q["q"] for q in Q.assemble(r, "recall")] == ["r1", "r2", "r3"]    # open questions only: these cannot be guessed
    assert [q["q"] for q in Q.assemble(r, "choice")] == ["b", "c", "a"]
    assert [q["q"] for q in Q.assemble(dict(r, recall=[]), "recall")] == ["b", "a"]  # nothing open was usable: fall back


# --------------------------------------------------------------------------- the recipe, with a pretend model
def fake_ask(replies):
    calls = []

    async def ask(system, user, temperature):
        calls.append((system[:30], user))
        r = replies.pop(0)
        if isinstance(r, Exception):
            raise r
        return r
    ask.calls = calls
    return ask


def written():
    return {"points": ["x"], "questions": [good(), good(kind="link", q="מה אמר השופט אלון על היחס בין היהדות לדמוקרטיה לפי הטקסט?",
                                                    options=["שתי מערכות ערכיות מקבילות ושוות במעמדן", "מערכת אחת שמקורה במשפט העברי", "מערכת שנייה שצריכה להכפיף את הראשונה", "שתי מערכות סותרות במהותן"],
                                                    evidence="היהדות והדמוקרטיה הן שתי מערכות ערכיות מקבילות ושוות במעמדן")],
            "recall": [{"q": "מה ההבדל בין עמדת השופט כהן לעמדת השופט ברק?", "key_points": ["כהן: שורשי הדמוקרטיה ביהדות", "ברק: פירוש מצמצם"],
                        "evidence": "השופט כהן סבר כי יש למצוא את שורשי הדמוקרטיה ביהדות ובמשפט העברי"}]}


def test_recipe_asks_the_hardest_two_then_one_open_question():
    ask = fake_ask([written(), {"answers": {"0": {"pick": 0, "sure": 5}, "1": {"pick": 3, "sure": 2}}}])
    res = asyncio.run(Q.build(ask, passage(), "he", "מסמך", "יהדות ודמוקרטיה"))
    assert res["verified"] and res["requests"] == 2
    kinds = [q["kind"] for q in res["questions"]]
    assert kinds == ["detail", "link", "recall"]
    assert len(res["choice"]) == 2 and len(res["recall"]) == 1
    assert "PASSAGE" in ask.calls[0][1] and "QUESTIONS" in ask.calls[1][1] and "PASSAGE" not in ask.calls[1][1]  # the check never sees the text


def test_if_the_check_cannot_run_the_questions_are_still_asked():
    from narrator.llm.pronounce import PronounceError
    ask = fake_ask([written(), PronounceError("free allowance used up", quota=True)])
    res = asyncio.run(Q.build(ask, passage(), "he"))
    assert not res["verified"] and [q["kind"] for q in res["questions"]] == ["detail", "link", "recall"]


def test_nothing_worth_asking_and_unusable_answers():
    res = asyncio.run(Q.build(fake_ask([{"points": [], "questions": [], "recall": [], "reason": "table of contents"}]), passage(), "he"))
    assert res["questions"] == [] and res["reason"] == "table of contents"
    bad = {"questions": [good(evidence="ציטוט שלא קיים בטקסט הזה בשום מקום ובשום צורה שהיא")], "recall": []}
    with pytest.raises(Q.QuizError):
        asyncio.run(Q.build(fake_ask([bad, bad]), passage(), "he"))


def test_maker_caches_and_joins_identical_requests(tmp_path):
    n = {"asked": 0}

    class Asker:
        key, cooldown_until, working_model = "K", 0.0, "m"

        async def ask_json(self, system, user, budget, temperature):
            n["asked"] += 1
            await asyncio.sleep(0.05)
            return written() if "QUESTIONS" not in user else {"answers": {}}

    async def go():
        m = Q.QuizMaker(Asker(), str(tmp_path))
        a, b = await asyncio.gather(m.make(passage(), "he"), m.make(passage(), "he"))
        c = await m.make(passage(), "he")
        return a, b, c

    a, b, c = asyncio.run(go())
    assert Q.assemble(a) == Q.assemble(b) == Q.assemble(c) and Q.assemble(a)
    assert n["asked"] == 2  # one request to write, one to check: for three callers


# --------------------------------------------------------------------------- over HTTP
from narrator.llm.testquiz import TestQuizModel as FakeModel  # noqa: E402


def test_http_flow_plan_questions_answers_and_revisit(client, he_pdf):
    from conftest import upload
    svc = client.svc
    svc.vocalizer.key = "K"
    fake = FakeModel()
    svc.quiz = Q.QuizMaker(fake, str(svc.data_dir) + "/quizcache")
    doc = upload(client, he_pdf)[0]["id"]

    # off by default: no plan
    first = next(u["id"] for u in client.get(f"/api/documents/{doc}/units", params={"page": 0, "count": 30}).json()["units"]
                 if u["kind"] in ("heading", "paragraph"))
    assert client.post(f"/api/documents/{doc}/quiz/plan", json={"unit_id": first}).json() == {"plan": None}
    client.put("/api/settings", json={"quiz_mode": "page", "quiz_minutes": 2, "quiz_style": "mixed"})
    svc.vocalizer.key = "K"  # (saving settings re-reads the stored key, which this test does not have)
    plan = client.post(f"/api/documents/{doc}/quiz/plan", json={"unit_id": first}).json()["plan"]
    assert plan and plan["units"][0]["id"] == first and plan["end"]
    ids = [u["id"] for u in plan["units"]]

    # nothing leaves the computer before consent
    r = client.post(f"/api/documents/{doc}/quiz", json={"units": ids})
    assert r.status_code == 409 and r.json()["provider"] == "gemini-quiz"
    client.post("/api/consent", json={"provider": "gemini-quiz"})

    # prefetch starts the work, the real request then finds it ready
    r = client.post(f"/api/documents/{doc}/quiz", json={"units": ids, "prefetch": True}).json()
    assert r["status"] in ("started", "ready-cached")
    r = client.post(f"/api/documents/{doc}/quiz", json={"units": ids}).json()
    if r["status"] == "too-short":  # the tiny fixture page: use the whole document's text
        pytest.skip("fixture page too short for a checkpoint")
    assert r["status"] == "ready" and [q["kind"] for q in r["questions"]][-1] == "recall"
    calls_after_first = fake.calls
    q1 = r["questions"][0]
    assert q1["options"][q1["answer"]] and q1["unit"]

    client.put("/api/settings", json={"quiz_style": "recall"})
    svc.vocalizer.key = "K"
    only_open = client.post(f"/api/documents/{doc}/quiz", json={"units": ids}).json()["questions"]
    assert [q["kind"] for q in only_open] == ["recall"] * 3 and fake.calls == calls_after_first  # same cached questions, other style
    client.put("/api/settings", json={"quiz_style": "mixed"})
    svc.vocalizer.key = "K"

    # answers are stored locally; a miss comes back first at the next checkpoint with the options in another order
    s = client.post(f"/api/documents/{doc}/quiz/answer", json={"question": q1, "score": 0, "picked": (q1["answer"] + 1) % 4}).json()
    assert s["asked"] == 1 and s["points"] == 0 and s["pending"][0]["qid"] == q1["qid"]
    assert client.post(f"/api/documents/{doc}/quiz", json={"units": ids}).json()["status"] == "ready"
    assert fake.calls == calls_after_first  # the same stretch again: cached, costs nothing
    again = client.post(f"/api/documents/{doc}/quiz", json={"units": ids[:-1]}).json()  # the next checkpoint
    assert again["questions"][0]["qid"] == q1["qid"] and again["questions"][0]["revisit"] is True
    assert again["questions"][0]["options"][again["questions"][0]["answer"]] == q1["options"][q1["answer"]]
    s = client.post(f"/api/documents/{doc}/quiz/answer", json={"question": q1, "score": 1, "revisit": True}).json()
    assert s["pending"] == [] and s["asked"] == 2 and s["percent"] == 50
    assert client.delete(f"/api/documents/{doc}/quiz/summary").json()["asked"] == 0


def test_without_a_key_or_with_too_little_text_nothing_is_sent(client, he_pdf):
    from conftest import upload
    client.svc.test_mode = False  # (test mode pretends to have a key)
    doc = upload(client, he_pdf)[0]["id"]
    first = client.get(f"/api/documents/{doc}/units", params={"page": 0, "count": 30}).json()["units"][0]["id"]
    assert client.post(f"/api/documents/{doc}/quiz", json={"units": [first]}).json()["status"] == "no-key"
    client.svc.vocalizer.key = "K"
    client.post("/api/consent", json={"provider": "gemini-quiz"})
    assert client.post(f"/api/documents/{doc}/quiz", json={"units": [first]}).json()["status"] == "too-short"
