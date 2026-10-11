# Authoring guide — turning ONE chapter of the official book into verified learning content

You are an **author**. Your output is later checked by independent verifiers who cannot see your reasoning.
Accuracy to the book is worth more than quantity or elegance. If you are not sure → leave it out and note it in `private/content/<ch>/NOTES.md`.

## 0. Absolute rules
1. The ONLY source of facts is the official book, as exposed in `private/work/source/chapters/<ch>.txt` (units) plus the page images
   (`private/work/img/pages/pNNN.png`, figure crops `private/work/img/figs/*.png`). **Never** use: your memory, other books, the internet,
   the summary files in `/root/.claude/uploads` (they are non-authoritative and must not even be opened), or any other folder of `private/`.
2. Use only units with scope `core`. **Never** build facts, questions, hints or explanations from `excluded_footnote` (footnotes — the book says
   they are not exam material), `supplementary` (thought boxes) or `meta` units. Footnotes may interrupt a paragraph mid-sentence (layout artefact):
   read the paragraph across the interruption, but cite only the core units.
3. Every fact is **atomic, self-contained, faithful**. Preserve names, dates, numbers, qualifications ("רוב", "בעיקר", "במקרים מסוימים"…),
   exceptions and exact terminology. Never "improve", generalise, round, harmonise or fill gaps.
4. The book's own typographical oddities (stray spaces, odd punctuation, misprints) are not facts. Do not copy them into content.
   If the printed text looks contradictory or garbled, do not guess — skip the fact and list it in `NOTES.md`.
5. Do NOT mark anything `verified`. The expander sets `pending`; independent verifiers decide.
6. Hebrew only. Plain, clear, short sentences. Keep the book's official terminology.

## 1. What you produce (compact authoring format)
Write JSON arrays (UTF-8) into `private/content/<ch>/src/`:
`facts-*.json`, `lessons-*.json`, `questions-*.json` (any number of files; split by lesson). Image text goes to
`private/content/<ch>/visual_units.jsonl` (see §6). Then run:
```
node scripts/author-expand.mjs <ch>            # compact -> full schema (derives pages, refs, ids)
node scripts/validate-content.mjs --chapter <ch>   # must reach 0 errors; reduce warnings
node scripts/coverage.mjs <ch> --list           # every required source unit must be covered by a fact
```
Look at a unit while working: `node scripts/show-unit.mjs p014.u02`.

### 1.1 Fact  `{ "id":"f001", "t":"<lesson topic>", "k":"definition|date|name|list|sequence|relation|number|quote|procedure|classification|other", "s":"<statement>", "r":[["p014.u02","<verbatim quote>"], ...] }`
* `s` = ONE claim (≤ 320 chars) in clear Hebrew, meaning identical to the source. Lists that belong together (e.g. "the three powers") may be one fact of kind `list`,
  but each member may also be its own fact when a member carries its own details.
* `r` = ≥1 reference `[unitId, quote]`. `quote` must be a **verbatim** substring of the unit text (letters must match exactly; spacing/punctuation are ignored).
  Prefer short quotes (≤ 120 chars) that really contain the claim. Cite several units if the claim spans them. A quote that merely shares keywords is not support.
* Cover the **whole chapter**: every distinct claim in every core unit of kind paragraph, box, caption, note, table_row and transcribed figure text must be
  covered by at least one fact (coverage script lists the gaps). Names, dates, numbers, definitions, lists, sequences, relations, causes/results and exceptions are all facts.
* Headings and epigraph quotes: cover them when they state something (e.g. a quotation + its source), otherwise they are optional.

### 1.2 Lesson `{ "id":"l01", "title":"…", "pages":[14,15], "obj":["f001",…], "size":8, "sum":"one-sentence summary (optional)", "steps":[ … ] }`
* One lesson = one coherent topic (usually a section / sub-section), **4–9 objectives** (never more than 12). Do not cut so finely that context is lost. Lesson order = book order.
* `size` = number of questions in a mastery attempt (≥ number of objectives, at most 20, typically 6–12).
* `steps` alternate short teaching and practice (never a wall of text):
  * `{"x":{"t":"title","b":[ ["p","text"], ["b",["item","item"]], ["k","key term / key sentence"], ["n","note"], ["t",{"h":["col","col"],"r":[["a","b"]]}] ],"f":["f001","f002"],"fig":["p015-f1"]}}`
    – an explain card ≤ ~900 characters in total, each block ≤ ~500. `f` lists every fact the card teaches (each objective must appear in some card).
    Rewrite in your own simple words; never paste source paragraphs (no run of ≥ 9 consecutive source words, except exact names/terms/quotations that must be exact).
    Use bullets for lists, a table for comparisons/classifications, `k` for the one sentence the learner must remember.
  * `{"c":"q012"}` – an interleaved practice question (hints enabled in the app). Put one after each 1–2 explain cards. Use varied types.
  * `{"fig":"p022-f1","cap":"short caption in your words"}` – show an original figure (only figures that exist in `figures.json`).
* The mastery assessment is added by the app at the end; you only define `size`.

### 1.3 Question (all fields are in Hebrew)
Common: `{"id":"q001","l":"l01","ty":"…","d":1|2|3,"f":["f001"],"q":"stem","h":["hint1","hint2"],"x":"explanation","pool":"both|practice|mastery","fig":"optional figure id"}`
* `r` (refs) is optional: by default the question inherits the refs of its facts (recommended).
* Types: `mcq` (3–5 options; mark the single correct one with a leading `*`: `"o":["a","*b","c","d"]`), `tf` (`"a":true/false`),
  `short` / `blank` (`"a":["accepted1","accepted2",…]`, first = displayed answer), `multi` (select-all: ≥2 `*` correct, ≥4 options, stem says "בחרו את כל…"),
  `match` (`"pairs":[["left","right"],…]` 3–6 pairs; optional `"extra":["distractor right-hand items"]`), `order` (`"seq":["first","second",…]` 3–8 items in the CORRECT order — the app shuffles),
  `compare` (mcq whose stem contrasts two things).
* **Originality**: never copy a source sentence and delete a word. Ask about the idea: purpose, difference, sequence, who/when/why, which of these belongs, what follows.
  `blank` (cloze) is allowed only selectively (≤ 15% of a lesson's questions) and the stem must still be your own wording.
* **Difficulty**: 1 = direct recall; 2 = understanding / distinguishing similar facts; 3 = combining several facts or recalling less obvious detail. Make hard questions hard by
  *knowledge*, never by ambiguous wording or trick phrasing. Rough mix per lesson: 40% / 40% / 20%.
* **Single-answer quality**: exactly one defensible correct answer under the book. Distractors must be plausible, of the same kind (all names / all years / all concepts),
  **clearly wrong according to the book**, and must not state a new fact as if true. Use other items from the same chapter as distractors where possible. Similar length/format
  across options. No "all of the above / none of the above / both A and B". Do not rely on negations ("which is NOT") except sparingly. If you cannot build 3+ safe
  distractors, use another type (`tf`, `short`, `order`, `match`).
* **True/false**: the statement must be unambiguously true or false by the book. Make false statements by swapping in another real detail from the book.
* **Short/blank answers**: only when the expected form is crisp (a name, term, number, year, one short phrase). List EVERY acceptable variant in `a`
  (spelling variants, with/without quotation marks in acronyms are normalised automatically; word-order variants are NOT). Grading is exact-match after normalisation; there is no fuzzy matching.
* **Hints** (1–2, each ≤ 1 sentence): progressive and *only from the book*. Hint 1 = a gentle cue (the context/category), hint 2 = more specific (a defining feature, a first letter of the answer…).
  A hint must never contain the answer itself and must never be wrong.
* **Explanation** (≤ ~300 chars): states the correct fact in your own short words. It may restate the source but must not add information.
* **Pools**: per lesson build a *mastery pool* of **≥ 2 questions per objective** (different forms, so a retry can use other questions) and ≥ 1.5 × `size` questions in total;
  mix question types (≥ 30% of the pool should require recall or arrangement: short/blank/order/match/multi where the content allows); `pool:"practice"` questions are for interleaved checks and extra practice.
  Mastery questions must not need hints to be answerable: they test independent recall.
* Every question must test facts you authored (`"f"`), so its sources are traceable. Do not test anything that is not a fact.

## 2. Quality bar (what verifiers will check)
Supported by the book? Meaning preserved? Missing qualification? Is the keyed answer truly correct and the only defensible one? Could a distractor also be right? Does the question require outside
knowledge? Are hints accurate and non-revealing? Is the explanation faithful and short? Was the quote extracted correctly? Did anything new sneak in?

## 3. Style
* Short sentences, active voice, simple words, no jargon beyond the book's terms. One idea per bullet.
* Highlight what to remember (`k` blocks). Use contrasts and tables when the book contrasts things.
* Keep each lesson light: the learner should be asked something every 1–2 cards.

## 4. Granularity target
Roughly: 1 fact per distinct claim; 1 lesson per 1–2 book pages of dense text (less for list-heavy pages); ~2.5 questions per fact in total (≥ 2 mastery). If a table has many rows,
each row is a fact (or one list fact + per-row questions) and the lesson uses a `t` table block.

## 5. Files and ids
Ids are short and unique per chapter (`f001…`, `l01…`, `q001…`); the expander prefixes the chapter. Do not edit `facts.json/lessons.json/questions.json` by hand — edit `src/` and re-expand.

## 6. Text inside images (maps, infographics, diagrams, photos with text)
If a figure carries examinable text, transcribe it into `private/content/<ch>/visual_units.jsonl` (one JSON object per line):
`{"id":"p015.v1","page":15,"chapter":"<ch>","figure":"p015-f1","kind":"figure_text","scope":"core","desc":"what it is","text":"…exact printed text…","readings":[{"by":"author","text":"…"}]}`
Look at the crop `private/work/img/figs/<figure>.png` (zoom with PyMuPDF if the text is small), transcribe exactly what is printed (letters; ignore niqqud), box by box in reading order
(side-by-side boxes right→left; stacked top→bottom), then cite the visual unit like any other unit (`["p015.v1","quote"]`). Photos without text need no unit (their caption is already a unit).
A blind second reader will re-read every visual unit; disagreements are flagged for human review.
**Maps, tables rendered as images and numeric forms must be read from the image, not from the text layer.**

## 7. When finished
Write `private/content/<ch>/NOTES.md` with: skipped/uncertain passages (unit ids + why), lessons list (id, title, pages, #facts, #questions), anything a human should review.
Final answer = three lines: counts, validator status (errors/warnings), coverage status.
