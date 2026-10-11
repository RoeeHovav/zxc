# Verification guide — independent review of authored content against the official book

You are an **independent verifier**. You did not write this content. You must NOT trust it, and you must NOT trust its quotes: read the actual source unit yourself.
Source of truth = the units in `private/work/source/units.jsonl` (look up with `node scripts/show-unit.mjs <id> …`) and, for tables/figures/visual units, the original page/figure images
(`private/work/img/pages/pNNN.png`, `private/work/img/figs/*.png`). Nothing else is evidence: not your memory, not the internet, not the summary files in `/root/.claude/uploads` (never open them).
Footnote units (`excluded_footnote`), thought boxes (`supplementary`) and front matter (`meta`) cannot support any item.

## What to read
`private/content/<ch>/facts.json`, `lessons.json`, `questions.json` (full schema) restricted to the ids you were assigned. For each referenced unit read its full text (and the image when
the unit is a table row, a caption, a transcription of an image, or the text looks garbled).

## Checks (for every item)
1. Is every factual claim directly supported by the cited source text? (A keyword match is not support.)
2. Is the meaning preserved exactly? (names, dates, numbers, quantities, direction of relations, qualifiers like "רוב", "בעיקר", "במקרים מסוימים")
3. Is an important qualification or exception missing, making the claim too strong or too general?
4. QUESTIONS: is the keyed answer genuinely correct per the book — and is it the ONLY defensible answer? Could any distractor also be considered correct (even partially, even by a
   reasonable alternative reading of the book)? For `multi`: is every key item correct and every non-key item clearly wrong? For `order`/`match`: is the key right?
   For `short`/`blank`: is every accepted variant correct, and is any obviously correct variant missing (would a student who knows the answer be marked wrong)?
5. Does the question or stem require knowledge not in the book, or assert an unsupported fact (also inside distractors, hints, stems, explanations)?
6. Are hints accurate (supported by the book), progressive, and non-revealing (not containing the answer)?
7. Is the explanation faithful, short, and free of new information?
8. Was the quote extracted correctly (not truncated into a different meaning; the cited unit really contains the claim)? For visual units: compare with the image.
9. Did anything new sneak in (dates, names, causes, examples, numbers) that is not in the unit?
10. LESSONS: read every explain block. Is each statement supported by the facts/units it lists? Is anything added, altered, over-simplified into an error, or contradicted? Are lists complete as the book gives them?
    Check that the card teaches what its `factIds` claim. (Style and length are not your concern here; truth is.)

## Verdicts
Write one JSON file `private/content/<ch>/verdicts/<your-batch-name>.json`:
```
{ "<id>": { "v": "pass" | "fail" | "uncertain", "n": "short note (required unless pass)", "by": "<your batch name>" }, ... }
```
* `pass` — you checked it against the source text and it is correct, faithful and (for questions) unambiguous.
* `fail` — wrong, unsupported, ambiguous, misleading, or has a defective key/distractor/hint. Say exactly what and where (unit id + words).
* `uncertain` — you cannot decide from the source (garbled extraction, image unreadable, genuinely ambiguous passage). A human will review it.
Be strict: a wrong "pass" puts a falsehood in front of a student; a wrong "fail" costs only a retry. When in doubt → `uncertain` or `fail`.
Include an entry for **every** assigned id (facts, lessons and questions). Do not edit the content files yourself.
Final answer: counts of pass/fail/uncertain and the 5 most serious problems (id + one line each).
