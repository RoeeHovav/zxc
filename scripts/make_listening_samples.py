"""Generate real listening samples for human evaluation of narration quality.

Run on a computer with internet access (the free voices are online):

    .venv\\Scripts\\python scripts\\make_listening_samples.py [--pdf "C:\\path\\book.pdf" --pages 14,101,201]

It writes MP3 files plus an index.html (open it in a browser) into
./listening-samples/.  Each test isolates one question, for example:

* Does the Hebrew voice honour niqqud?  The same homograph sentence is rendered
  unvowelled and with explicit niqqud -- if both sound identical the engine
  ignores niqqud and pronunciation fixes must use respellings instead.
* Do the built-in acronym expansions sound better than the raw text?
* How do the different Hebrew / English voices compare on identical passages?
* How does a real passage from your own PDF sound after the full pipeline?

Nothing here is billable: only the free Microsoft voices are used unless you pass
--voices with other provider ids that you have configured yourself.
"""
from __future__ import annotations

import argparse
import asyncio
import html
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from narrator.text.normalize import Lexicon, NormOptions, load_builtin, normalize_words  # noqa: E402
from narrator.tts.edge import EdgeProvider  # noqa: E402

HE_VOICES = ["edge:he-IL-HilaNeural", "edge:he-IL-AvriNeural"]
EN_VOICES = ["edge:en-US-AvaMultilingualNeural", "edge:en-US-AndrewMultilingualNeural", "edge:en-US-EmmaMultilingualNeural",
             "edge:en-US-BrianMultilingualNeural", "edge:en-GB-SoniaNeural", "edge:en-GB-RyanNeural"]

TESTS = [
    # (id, lang, question, [(variant label, text)])
    ("he-niqqud", "he", "Does the voice honour niqqud? (homograph ספר: book / barber / counted / border)", [
        ("unvowelled", "הספר שקניתי מרתק. הספר במספרה ספר את הכסף. מעבר לספר עברו פליטים."),
        ("with niqqud", "הַסֵּפֶר שֶׁקָּנִיתִי מְרַתֵּק. הַסַּפָּר בַּמִּסְפָּרָה סָפַר אֶת הַכֶּסֶף. מֵעֵבֶר לַסְּפָר עָבְרוּ פְּלִיטִים."),
    ]),
    ("he-ambiguous", "he", "Context-dependent readings of unvowelled words", [
        ("unvowelled", "הוא חשב שהחשבון שגוי. היא ביקשה לחשב מחדש את הסכום. המחשב החדש מהיר מאוד."),
        ("unvowelled 2", "הילד אכל את הלחם. הכלב אכל מהקערה. הם דיברו על הדבר החשוב."),
    ]),
    ("he-acronyms", "he", "Military/academic acronyms: raw text vs. built-in lexicon", [
        ("raw", 'המג"ד והמ"פ הגיעו לבה"ד 1. הרמטכ"ל ביקר בבסיס צה"ל, והקמב"ץ דיווח לאג"ם. ד"ר כהן הגיע ע"י הרכב.'),
        ("lexicon", "@NORMALIZE@"),
    ]),
    ("he-numbers", "he", "Numbers, dates, prefixes and percentages", [
        ("raw", "ב-17 בספטמבר 1982 נסוגה ישראל מביירות. כ-2500 עולים הגיעו, ו-35% מהם התיישבו בגליל. 3 ספרים ו-3 מחברות."),
    ]),
    ("he-mixed", "he", "Hebrew with embedded English terms", [
        ("raw", "האלגוריתם משתמש ב-machine learning כדי לשפר את הדיוק. ראו גם את המאמר של Smith משנת 2019 בכתב העת Nature."),
    ]),
    ("en-academic", "en", "English academic prose: questions, definitions, long sentences", [
        ("raw", "Is the effect statistically significant? We define the null hypothesis as the absence of any difference between the groups; therefore, the p-value must be interpreted with caution, particularly when the sample is small."),
    ]),
    ("en-math", "en", "English math: raw vs. verbalized", [
        ("raw", "Let f(x) = x² + 2x − 1, where x ≥ 0 and α ≈ 0.05."),
        ("lexicon", "@NORMALIZE@"),
    ]),
]


def normalized(text: str, lang: str) -> str:
    lex = Lexicon(load_builtin("he") + load_builtin("en"))
    ws = text.split()
    return " ".join(t.text for t in normalize_words(ws, [0] * len(ws), NormOptions(lang=lang), lex))


def pdf_passages(pdf: str, pages):
    from narrator.narration.units import UnitIndex
    from narrator.narration.prepare import PrepOptions, prepare_unit
    from narrator.pdf.document import PdfDocument
    import tempfile
    d = PdfDocument(pdf, tempfile.mkdtemp(prefix="narrator-samples-"))
    idx = UnitIndex(d)
    lex = Lexicon(load_builtin("he") + load_builtin("en"))
    out = []
    for p in pages:
        units = [u for u in idx.units_on_page(p - 1) if u.kind == "paragraph" and len(u.words) > 25]
        if units:
            u = units[0]
            chunks = prepare_unit(u, lex, PrepOptions(), vocab=idx.vocab())
            out.append((f"pdf-p{p}", u.lang, f"Your PDF, page {p} (full pipeline)", [("prepared", chunks[0].text)]))
    d.close()
    return out


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "listening-samples"))
    ap.add_argument("--pdf")
    ap.add_argument("--pages", default="14,101,201")
    ap.add_argument("--dry-run", action="store_true", help="print the texts that would be synthesised")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    tests = list(TESTS)
    if args.pdf:
        tests += pdf_passages(args.pdf, [int(x) for x in args.pages.split(",")])
    prov = EdgeProvider()
    if args.dry_run:
        for tid, lang, question, variants in tests:
            print(f"== {tid}: {question}")
            for label, text in variants:
                print(f"   [{label}] {normalized(variants[0][1], lang) if text == '@NORMALIZE@' else text}")
        return
    try:
        await asyncio.wait_for(prov._once(__import__("edge_tts"), "בדיקה", "he-IL-HilaNeural", "+0%", "+0Hz"), timeout=20)
    except Exception as exc:
        print("Cannot reach Microsoft's free speech service:", exc)
        print("Check the internet connection (or firewall/proxy) and try again.")
        return
    rows = []
    for tid, lang, question, variants in tests:
        voices = HE_VOICES if lang == "he" else EN_VOICES
        for label, text in variants:
            if text == "@NORMALIZE@":
                text = normalized(variants[0][1], lang)
            for v in voices:
                name = f"{tid}__{label.replace(' ', '-')}__{v.split(':')[1]}.mp3"
                path = os.path.join(args.out, name)
                if not os.path.exists(path):
                    try:
                        res = await prov.synthesize(text, v, lang)
                        with open(path, "wb") as fh:
                            fh.write(res.audio)
                        print("wrote", name)
                    except Exception as exc:
                        print("FAILED", name, exc)
                        continue
                rows.append((tid, question, label, v, text, name))
    with open(os.path.join(args.out, "index.html"), "w", encoding="utf-8") as fh:
        fh.write("<!doctype html><meta charset='utf-8'><title>Listening samples</title>"
                 "<style>body{font-family:Segoe UI,sans-serif;max-width:1000px;margin:20px auto;padding:0 16px}"
                 "td{padding:6px;border-bottom:1px solid #ddd;vertical-align:top}.t{font-size:13px;color:#444}</style>"
                 "<h1>PDF Narrator — listening samples</h1><p>Rate each clip for pronunciation, naturalness, pacing and intonation.</p><table>")
        last = None
        for tid, question, label, v, text, name in rows:
            if tid != last:
                fh.write(f"<tr><td colspan=3><h3>{html.escape(question)}</h3></td></tr>")
                last = tid
            fh.write(f"<tr><td>{html.escape(label)}<br><b>{html.escape(v.split(':')[1])}</b></td>"
                     f"<td><audio controls preload=none src='{name}'></audio></td>"
                     f"<td class=t dir=auto>{html.escape(text)}</td></tr>")
        fh.write("</table>")
    print("Open", os.path.join(args.out, "index.html"))


if __name__ == "__main__":
    asyncio.run(main())
