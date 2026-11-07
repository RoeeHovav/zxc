#!/usr/bin/env python3
"""Measure how often the pronunciation assistant picks the right reading of an ambiguous Hebrew word.

Each case is a sentence, the ambiguous word in it, and the accepted vowelled form(s).  The cases are split
into DEV (used while tuning the prompt) and TEST (never used for tuning), so the TEST score is honest.

    python scripts/eval_pronunciation.py --model gemini-3.8-flash [--runs 1] [--only dev|test]
    python scripts/eval_pronunciation.py --engine dicta          # Dicta's Nakdan alone (no key, no allowance)
    python scripts/eval_pronunciation.py --engine both --model gemini-3.1-flash-lite   # what the app does

Uses Google's OpenAI-compatible endpoint with the same system prompt and message format as the app.
The key comes from --key or GEMINI_API_KEY (in the cloud sandbox a proxy injects it, any placeholder works).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import unicodedata
import urllib.error
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from narrator.llm import pronounce as P  # noqa: E402

BASE = "https://generativelanguage.googleapis.com/v1beta/openai"

# (set, sentence, word as written, accepted vowelled readings)
CASES = [
    # ---- שמן
    ("dev", "קניתי בבקבוק שמן זית וקצת חומץ", "שמן", ["שֶׁמֶן"]),
    ("dev", "הילד היה שמן ועליז", "שמן", ["שָׁמֵן"]),
    ("test", "מקראות ישראל הינו שמן של חוברות", "שמן", ["שְׁמָן"]),
    ("test", "אלו הן הסדרות הישנות, שמן נשאר זהה לאורך השנים", "שמן", ["שְׁמָן"]),
    ("dev", "הנשים הציגו את שמן בפני הקהל", "שמן", ["שְׁמָן"]),
    ("dev", "הסדרות האלה פורסמו לפני שנים, וגם שמן השתנה מאז", "שמן", ["שְׁמָן"]),
    # ---- ספר
    ("dev", "קראתי ספר מרתק על ההיסטוריה", "ספר", ["סֵפֶר"]),
    ("dev", "הספר גזז לי את השיער במספרה", "הספר", ["הַסַּפָּר"]),
    ("dev", "הוא ספר את הכסף פעמיים", "ספר", ["סָפַר"]),
    ("test", "ספר לי מה קרה אתמול", "ספר", ["סַפֵּר"]),
    ("test", "אספר לכם סיפור מצחיק", "אספר", ["אֲסַפֵּר"]),
    ("test", "אספר את החיילים לפני היציאה", "אספר", ["אֶסְפֹּר", "אֶסְפּוֹר"]),
    ("test", "הספר שכתב המחבר נמכר היטב", "הספר", ["הַסֵּפֶר"]),
    # ---- שם
    ("dev", "מה השם שלך", "השם", ["הַשֵּׁם"]),
    ("dev", "הוא גר שם כבר שנים", "שם", ["שָׁם"]),
    ("test", "שם המשפחה שלה מוכר בעיר", "שם", ["שֵׁם"]),
    ("test", "שם הוא פגש חברים ותיקים", "שם", ["שָׁם"]),
    # ---- עד
    ("dev", "הוא היה עד לתאונה", "עד", ["עֵד"]),
    ("test", "נשארנו כאן עד הערב", "עד", ["עַד"]),
    # ---- דבר
    ("dev", "הוא דבר בכנס שעה שלמה", "דבר", ["דִּבֵּר"]),
    ("test", "זה דבר חשוב מאוד", "דבר", ["דָּבָר"]),
    # ---- מלך
    ("dev", "המלך נכנס לארמון בשעה שמונה", "המלך", ["הַמֶּלֶךְ"]),
    ("test", "הוא מלך על האי ארבעים שנה", "מלך", ["מָלַךְ"]),
    # ---- עלה
    ("dev", "הוא עלה על ההר בבוקר", "עלה", ["עָלָה"]),
    ("test", "עלה אחד נשר מהעץ", "עלה", ["עָלֶה"]),
    # ---- שבר
    ("dev", "הילד שבר את הכוס", "שבר", ["שָׁבַר"]),
    ("test", "יש לו שבר ברגל אחרי הנפילה", "שבר", ["שֶׁבֶר"]),
    # ---- בנו
    ("dev", "בנו של המלך נולד בלילה", "בנו", ["בְּנוֹ"]),
    ("test", "הם בנו בית גדול על הגבעה", "בנו", ["בָּנוּ"]),
    # ---- שמה
    ("dev", "שמה של העיר הוא חיפה", "שמה", ["שְׁמָהּ", "שְׁמָה"]),
    ("test", "היא שמה את הספר על השולחן", "שמה", ["שָׂמָה"]),
    # ---- ספרו
    ("dev", "ספרו של הסופר זכה בפרס", "ספרו", ["סִפְרוֹ"]),
    ("test", "הם ספרו את הכסף יחד", "ספרו", ["סָפְרוּ"]),
    # ---- מסר
    ("dev", "המסר של הנאום היה ברור", "המסר", ["הַמֶּסֶר"]),
    ("test", "הוא מסר את המכתב לידיה", "מסר", ["מָסַר"]),
    # ---- צבע
    ("dev", "הצבע של הקיר אדום", "הצבע", ["הַצֶּבַע"]),
    ("test", "הוא צבע את הקיר בלבן", "צבע", ["צָבַע"]),
    # ---- נשק
    ("dev", "החיילים החזיקו נשק כבד", "נשק", ["נֶשֶׁק"]),
    ("test", "הוא נשק לה על הלחי", "נשק", ["נָשַׁק"]),
    # ---- כתב
    ("dev", "הכתב דיווח מהזירה בשידור חי", "הכתב", ["הַכַּתָּב"]),
    ("test", "הוא כתב מכתב ארוך לסבתו", "כתב", ["כָּתַב"]),
    # ---- הלכה
    ("dev", "היא הלכה הביתה אחרי העבודה", "הלכה", ["הָלְכָה"]),
    ("test", "ההלכה קובעת כללים ברורים", "ההלכה", ["הַהֲלָכָה"]),
    # ---- other
    ("test", "הוא גדל בעיר קטנה בצפון", "גדל", ["גָּדַל"]),
    ("test", "הקיר לבן ונקי", "לבן", ["לָבָן"]),
    ("dev", "שתיתי כוס חלב קר", "חלב", ["חָלָב"]),
    ("test", "הקפה הזה חזק מדי בשבילי", "הקפה", ["הַקָּפֶה"]),
    ("test", "קראנו את פרק שני בספר", "פרק", ["פֶּרֶק"]),
]

_DROP = set(range(0x0591, 0x05B0)) | {0x05BC, 0x05BD, 0x05BF, 0x05C0, 0x05C3, 0x05C4, 0x05C5, 0x05C6}
_MAP = {0x05B1: 0x05B6, 0x05B2: 0x05B7, 0x05B3: 0x05B8, 0x05C7: 0x05B8}


def skeleton(s: str) -> str:
    """Letters + vowel points (dagesh, cantillation and hataf/qamats-qatan spelling differences ignored)."""
    out = []
    for ch in unicodedata.normalize("NFD", s):
        cp = ord(ch)
        if cp in _DROP:
            continue
        out.append(chr(_MAP.get(cp, cp)))
    return unicodedata.normalize("NFC", "".join(out))


def call(model: str, system: str, user: str, key: str) -> object:
    body = json.dumps({"model": model, "temperature": 0, "response_format": {"type": "json_object"},
                       "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}).encode()
    req = urllib.request.Request(BASE + "/chat/completions", data=body, method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + key})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = json.load(r)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code}: {exc.read().decode('utf-8', 'replace')[:300]}") from None
    txt = data["choices"][0]["message"]["content"]
    return P._parse_json({"candidates": [{"content": {"parts": [{"text": txt}]}}]})


def run_once(model: str, cases, key: str, batch: int = P.BATCH):
    results = []
    for g in range(0, len(cases), batch):
        group = cases[g:g + batch]
        items = [(c[1], P.hebrew_words(c[1])) for c in group]
        for attempt in range(4):
            try:
                reply = call(model, P.SYSTEM, P.build_user_message(items), key)
                break
            except Exception as exc:  # noqa: BLE001
                msg = str(exc)
                if "could not be read" in msg and attempt < 2:  # same retry the app does
                    continue
                if ("HTTP 429" in msg and "per day" not in msg or "HTTP 503" in msg or "HTTP 502" in msg) and attempt < 3:
                    time.sleep(15 * (attempt + 1))
                    continue
                raise
        for j, (kind, sent, word, accepted) in enumerate(group):
            words = items[j][1]
            idx = next((i for i, (_, _, w) in enumerate(words) if w == word), None)
            details = P.validate_details(reply.get(str(j)) if isinstance(reply, dict) else None, words)
            d = details.get(idx) if idx is not None else None
            got = d["c"][0] if d else None
            ok = got is not None and skeleton(got) in {skeleton(a) for a in accepted}
            results.append({"kind": kind, "sentence": sent, "word": word, "accepted": accepted, "got": got, "ok": ok,
                            "candidates": d["c"] if d else [], "why": d["why"] if d else ""})
    return results


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="gemini-3.8-flash")
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--only", choices=["dev", "test"])
    ap.add_argument("--key", default=os.environ.get("GEMINI_API_KEY", "proxy-injected"))
    ap.add_argument("--shuffle", type=int, help="shuffle the cases with this seed (changes which sentences share a request)")
    ap.add_argument("--json", help="write the detailed results here")
    ap.add_argument("--engine", choices=["gemini", "dicta", "both"], default="gemini",
                    help="both = Dicta for every word, the Gemini assistant's reading where it gave one (as the app does)")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()
    cases = [c for c in CASES if not a.only or c[0] == a.only]
    if a.shuffle is not None:
        import random
        random.Random(a.shuffle).shuffle(cases)
    allres = []
    for r in range(a.runs):
        res = run_once(a.model, cases, a.key) if a.engine != "dicta" else [
            {"kind": c[0], "sentence": c[1], "word": c[2], "accepted": c[3], "got": None, "ok": False, "candidates": [], "why": ""} for c in cases]
        if a.engine != "gemini":
            import asyncio
            import tempfile
            from narrator.llm.nakdan import Nakdan
            nk = Nakdan(tempfile.mkdtemp())
            spans = asyncio.run(nk.vowel_many([x["sentence"] for x in res]))
            for x, sp in zip(res, spans):
                d = next((v for s, e, v in sp or [] if x["sentence"][s:e] == x["word"]), None)
                got = x["got"] if (a.engine == "both" and x["got"]) else d
                x.update(got=got, ok=got is not None and skeleton(got) in {skeleton(v) for v in x["accepted"]}, dicta=d)
        allres += res
    label = {"gemini": a.model, "dicta": "dicta", "both": "dicta+" + a.model}[a.engine]
    for kind in ("dev", "test"):
        sub = [x for x in allres if x["kind"] == kind]
        if sub:
            ok = sum(x["ok"] for x in sub)
            print(f"{label}  {kind:4s}: {ok}/{len(sub)} = {100 * ok / len(sub):.0f}%")
    tot = sum(x["ok"] for x in allres)
    print(f"{label}  all : {tot}/{len(allres)} = {100 * tot / len(allres):.0f}%")
    if a.verbose:
        for x in allres:
            if not x["ok"]:
                print(f"  MISS [{x['kind']}] {x['sentence']}\n       word {x['word']}: wanted {x['accepted']}  got {x['got']}  cands {x['candidates']}  why: {x['why']}")
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(allres, fh, ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
