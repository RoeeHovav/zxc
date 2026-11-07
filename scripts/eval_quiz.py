#!/usr/bin/env python3
"""Measure the quality of the comprehension questions on a real document.

For several stretches of narration the question writer is asked for three questions, then:

  * GROUNDED   -- how many of the questions it wrote survive the app's own checks (the quotation is really in the text, the
                  answers do not give themselves away).
  * OPEN BOOK  -- a second request answers the questions WITH the passage.  A good question is answered correctly (this also
                  catches a wrongly keyed answer).
  * CLOSED BOOK-- a third request answers the same questions WITHOUT the passage (pure general knowledge and test-wise
                  guessing).  A good question is NOT answered correctly by someone who did not hear the passage:
                  chance is 25%, so the closed-book score should be low.

    python scripts/eval_quiz.py --pdf tests/private/user.pdf --model gemini-3.1-flash-lite [--pages 14,40,101]

Uses Google's OpenAI-compatible endpoint (the key comes from --key or GEMINI_API_KEY; in the cloud sandbox a proxy injects it).
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import tempfile
import time
import urllib.error
import urllib.request
import warnings

warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from narrator.llm import quiz as Q  # noqa: E402
from narrator.llm import pronounce as P  # noqa: E402

BASE = "https://generativelanguage.googleapis.com/v1beta/openai"


def call(model: str, system: str, user: str, key: str, temperature: float = 0.3) -> object:
    body = json.dumps({"model": model, "temperature": temperature, "response_format": {"type": "json_object"},
                       "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}).encode()
    for attempt in range(4):
        req = urllib.request.Request(BASE + "/chat/completions", data=body, method="POST",
                                     headers={"Content-Type": "application/json", "Authorization": "Bearer " + key})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                data = json.load(r)
            txt = data["choices"][0]["message"]["content"]
            return P._parse_json({"candidates": [{"content": {"parts": [{"text": txt}]}}]})
        except urllib.error.HTTPError as exc:
            msg = exc.read().decode("utf-8", "replace")[:300]
            if (exc.code in (429, 502, 503) and "per day" not in msg.lower() and "perday" not in msg.lower().replace("_", "")) and attempt < 3:
                time.sleep(15 * (attempt + 1))
                continue
            raise RuntimeError(f"HTTP {exc.code}: {msg}") from None
        except P.PronounceError:
            if attempt < 2:
                continue
            raise
    raise RuntimeError("gave up")


def open_book_system() -> str:
    return ("Answer multiple-choice questions about a passage. Use the passage. Reply ONLY with JSON: "
            "{\"answers\": {\"<id>\": {\"pick\": <index of the correct option, starting at 0>, \"sure\": 5}, ...}}.")


def closed_book_system() -> str:
    return ("You are taking a multiple-choice test about a document you have NOT seen. Use general knowledge and your best judgement; "
            "you must pick one option for every question. Reply ONLY with JSON: {\"answers\": {\"<id>\": <index of your choice, starting at 0>, ...}}.")


def pick_segments(pdf: str, pages, mode: str, minutes: float):
    from narrator.narration.checkpoints import plan
    from narrator.narration.units import UnitIndex
    from narrator.pdf.document import PdfDocument
    from narrator.pdf.ocr import OcrEngine
    doc = PdfDocument(pdf, tempfile.mkdtemp(), OcrEngine())
    idx = UnitIndex(doc)
    rk = {"heading": True, "paragraph": True, "list_item": True, "note": True, "caption": True, "footnote": True}
    out = []
    for pg in pages:
        units = idx.units_on_page(pg - 1)
        first = next((u for u in units if u.kind in ("heading", "paragraph")), None)
        if not first:
            continue
        pl = plan(first, lambda uid: idx.next_unit(uid), rk, mode, minutes)
        if not pl or not pl["ask"]:
            continue
        us = [idx.find_unit(x["id"]) for x in pl["units"]]
        out.append((pg, pl, Q.Passage(us), us[0].lang))
    return out


def answer_set(judge: str, key: str, items, closed: bool, title: str = ""):
    """items: [(passage_text or None, question)] -> list of chosen indexes (or None)."""
    out = [(None, 3)] * len(items)
    if closed:
        order = list(range(len(items)))
        random.Random(1).shuffle(order)
        for g in range(0, len(order), 12):
            ids = order[g:g + 12]
            qs = [items[i][1] for i in ids]
            ans = call(judge, Q.CLOSED_BOOK_SYSTEM, Q.closed_book_message(qs), key, 0.0)
            for pos, i in enumerate(ids):
                out[i] = Q.read_guess((ans.get("answers", {}) if isinstance(ans, dict) else {}).get(str(pos)))
    else:
        by_passage = {}
        for i, (ptext, q) in enumerate(items):
            by_passage.setdefault(ptext, []).append(i)
        for ptext, ids in by_passage.items():
            qs = [items[i][1] for i in ids]
            body = "PASSAGE:\n<<<\n" + ptext + "\n>>>\n\n" + Q.closed_book_message(qs).replace("QUESTIONS:", "QUESTIONS:", 1)
            ans = call(judge, open_book_system(), body, key, 0.0)
            for pos, i in enumerate(ids):
                out[i] = Q.read_guess((ans.get("answers", {}) if isinstance(ans, dict) else {}).get(str(pos)))
    return out


def main() -> int:
    import asyncio
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", default="tests/private/user.pdf")
    ap.add_argument("--model", default="gemini-3.1-flash-lite", help="writes the questions (and checks them for guessability, as the app does)")
    ap.add_argument("--judge-model", default="gemini-3.5-flash-lite", help="independent model that takes the open/closed book tests")
    ap.add_argument("--pages", default="14,40,70,101,130,160,200,240,280")
    ap.add_argument("--mode", default="section")
    ap.add_argument("--minutes", type=float, default=6)
    ap.add_argument("--no-verify", action="store_true", help="skip the app's own guessability filter")
    ap.add_argument("--key", default=os.environ.get("GEMINI_API_KEY", "proxy-injected"))
    ap.add_argument("--json", help="write every question and result here")
    a = ap.parse_args()
    segs = pick_segments(a.pdf, [int(x) for x in a.pages.split(",")], a.mode, a.minutes)
    print(f"{len(segs)} passages; questions written by {a.model}; independent judge {a.judge_model}")

    async def ask(system, user, temperature):
        return await asyncio.get_running_loop().run_in_executor(None, call, a.model, system, user, a.key, temperature)

    cand, chosen, recall, rejected, reqs = [], [], [], {}, 0
    for pg, pl, passage, lang in segs:
        t0 = time.time()
        try:
            res = asyncio.run(Q.build(ask, passage, lang, "", "", (), verify=not a.no_verify))
        except Exception as exc:  # noqa: BLE001
            print(f"  page {pg}: failed: {exc}")
            continue
        for k, v in res["rejected"].items():
            rejected[k] = rejected.get(k, 0) + v
        reqs += res["requests"]
        print(f"  page {pg}: {len(passage.text)} chars -> {res['candidates']} grounded candidates, {res['guessable']} guessable by the app's own check, "
              f"{len(res['questions'])} asked ({time.time() - t0:.0f}s) {res['reason'] or ''}")
        for q in res.get("_candidates", []):
            cand.append((passage.text, q, pg))
        for q in res["questions"]:
            if q["kind"] == "recall":
                recall.append((pg, q))
            else:
                chosen.append((passage.text, q, pg))
    if not chosen:
        print("no usable questions")
        return 1
    print()
    print(f"requests used: {reqs}; rejected by the app's checks: {rejected or 'none'}; recall questions kept: {len(recall)}")
    for label, group in (("ALL CANDIDATES (before the guessability filter)", cand), ("QUESTIONS THE LISTENER WOULD GET", chosen)):
        items = [(p, q) for p, q, _ in group]
        op = answer_set(a.judge_model, a.key, items, False)
        cl = answer_set(a.judge_model, a.key, items, True)
        n = len(items)
        ok_o = sum(x[0] == q["answer"] for x, (_, q) in zip(op, items))
        ok_c = sum(x[0] == q["answer"] for x, (_, q) in zip(cl, items))
        sure_c = sum(x[0] == q["answer"] and x[1] >= 4 for x, (_, q) in zip(cl, items))
        print(f"{label}: {n} questions")
        print(f"   open book   (with the passage):    {ok_o}/{n} = {100 * ok_o / n:.0f}%   (want ~100%: one clear answer)")
        print(f"   closed book (without the passage): {ok_c}/{n} = {100 * ok_c / n:.0f}%   (chance is 25%; want it low); right AND sure: {sure_c}/{n}")
        for kind in Q.KINDS:
            idx = [i for i, (_, q) in enumerate(items) if q["kind"] == kind]
            if idx:
                print(f"     {kind:6s}: open {sum(op[i][0] == items[i][1]['answer'] for i in idx)}/{len(idx)}  closed {sum(cl[i][0] == items[i][1]['answer'] for i in idx)}/{len(idx)}")
        if group is chosen and a.json:
            with open(a.json, "w", encoding="utf-8") as fh:
                json.dump([{"page": pg, **q, "open_book_ok": op[i][0] == q["answer"], "closed_book_ok": cl[i][0] == q["answer"], "closed_book_sure": cl[i][1]}
                           for i, (_, q, pg) in enumerate(group)], fh, ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
