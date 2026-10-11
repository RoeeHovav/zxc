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

## Calibration rules (apply identically to every item)
* **Facts / keys / distractors / explanations / lesson cards**: any unsupported claim, changed meaning, dropped qualifier that makes a statement too strong, wrong key, or a distractor that is also defensible → `fail`.
* **Hints**: `fail` if the hint (a) states the keyed answer or a keyed option verbatim, (b) restates a true/false statement so the answer is obvious, (c) contains a claim the source does not support, or (d) contradicts the stem/key.
  A hint that merely narrows the context ("think about who appoints judges") is fine. Note milder leaks in `n` but still `pass`.
* **Short/blank answers**: grading is exact match after normalisation of spacing/punctuation/quote marks/niqqud only (no stemming, no word order, no "ה" prefix tolerance). `fail` if an obviously correct variant that a student who knows the answer would write
  is missing from `accepted` (spelling variants such as תכנית/תוכנית, with/without the definite article or a preposition when the stem allows it, the book's own phrasing) or if the stem's own constraints contradict the key (e.g. "two words" but a three-word key).
* **Structure/labels**: a label or structural claim that the book does not make (e.g. calling printed lines "the first stanza" or "four pairs", "the list has four items" when the book says "ועוד") → `fail`.
* Every `fail` note must say exactly what to change (item field + wording) so a fixer can repair it without guessing.
* **Distractors that name something from elsewhere in the same chapter** (a person, place, term, date) are allowed (the authoring guide recommends them). Confirm that the distractor is clearly WRONG for this question and that the named thing
  really occurs in the book: search the chapter dump `private/work/source/chapters/<ch>.txt` (grep the name). If it occurs there and is clearly wrong here → `pass` for that aspect; if it does not occur anywhere in the chapter, treat it as an invented fact → `fail`.
