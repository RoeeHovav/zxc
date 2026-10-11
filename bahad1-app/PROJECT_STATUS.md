# BAHAD 1 learning app — project status (resume file)

> This file contains **no book content** (counts, decisions, next steps only). The book, its extraction and all
> derived educational content live in `private/` and `public/content/` and are git-ignored on purpose.

Last updated: 2026-10-11 (session 01E5qPhVjffQDtykJ1owxdae)

## Non-negotiable rules (from the master prompt)
1. The ONLY source of facts is the 4-part official book (`אוגדן_הכנה_לקצונה_נחשון_ומעוז_פברואר_2021`, 314 pages, global numbering).
   All other attachments (summaries, .docx, .xlsx) are non-authoritative and were **never opened for content**.
2. Guided lesson mastery = **100%**, independent, no hints, no retries inside the assessment.
3. No runtime AI; deterministic grading; Hebrew-only RTL UI; local-first; the book/derived content is never committed or published.
4. Footnotes are kept in the source index but are **excluded from question generation** (the book's preface, p.12, says they are not exam material).

## Stage checklist
| Stage | State |
|---|---|
| 1. Verify 4 PDFs / 314-page continuity | DONE (docs/SOURCE_VERIFICATION.md) |
| 2. Glyph-accurate extraction (PyMuPDF) + Poppler cross-check; source index (2,806 units) | DONE, validated on representative pages |
| 2c. Image-borne text (anthem, infographics): author reading + blind second reading | ch1 DONE (5 units; 4 agree, 1 adjudicated on 14x zoom); other chapters TODO |
| 3. App foundation: engines, IndexedDB, backup, UI (all modes), review dashboard | DONE; 61 unit tests + 27 Playwright tests (desktop+mobile, synthetic fixtures) pass |
| 3b. Content pipeline: author guide, expander, validator, coverage, verdicts, batches, compiler, release packager | DONE |
| 4. Pilot chapter 1 (13-23) | DONE except 1 pending question (q2425) awaiting round-4 re-check; 229 facts / 34 lessons / 592 questions |
| 5. Remaining chapters ch2..ch13 | IN PROGRESS: wave 1 authors (ch2 pp24-35, ch3 pp53-64) running; map page 207 and image-heavy weapons chapter need visual transcription |
| 6. Learning features | implemented in app; need real content to exercise |
| 7. QA | automated suites exist; real-content smoke test pending |
| 8. Final audit | script ready (scripts/final-audit.mjs); run after content |
| 9. Delivery docs | README written; final numbers pending |

## Chapter map (global pages)
ch0 front matter 1-12 (meta) · ch1 gate 1: 13-23 · ch2 gate 2: 24-52 · ch3 gate 3: 53-81 · ch4 gate 4: 82-96 · ch5 gate 5: 97-117 ·
ch6 gate 6: 118-171 · ch7 gate 7: 172-206 · ch8 blank-map page: 207 · ch9 debriefing: 208-220 · ch10 first aid: 221-242 ·
ch11 topography: 243-247 · ch12 communications: 248-260 · ch13 weapons: 261-314.

## Decisions log
- Extraction uses glyph x-positions + a Unicode-bidi-style visual→logical reconstruction. The raw PDF text layer reorders numbers
  (e.g. years came out reversed); Poppler agrees with the reconstruction on 99.995% of Hebrew letters and on every Latin token.
- Scope tags: `core` | `supplementary` (thought boxes, no questions) | `excluded_footnote` | `meta` (pp.1-12).
- Bold = exam-focus per the book preface; underline is recorded separately. Neither is interpreted as "importance"
  outside the pages where the book actually uses them (history gates carry no bold in this edition).
- Quote validation: every cited quote must be a substring of its source unit after normalisation (whitespace/niqqud/bidi/quote-style).
- Private data: `private/` (PDFs, extraction, images, venv, content work). Committed: code, schemas, tests with synthetic fixtures, docs.

## Throughput constraint discovered (important for planning)
Sub-agent work counts toward the account's usage limit: a burst of ~12 parallel agents (8 verifiers + 4 authors) triggered an API rate limit ("session limit",
HTTP 429) and killed all running agents (no partial edits were left behind). Measured costs: authoring Chapter 1 (11 pages) ≈ 765K tokens / 57 min; one verifier batch
(≈110 items) ≈ 160-200K tokens / 7-9 min; repair pass ≈ 3 fixers. Extrapolated to the whole book at pilot density this is ≈ 20M+ author tokens plus verification, so the remaining chapters
are being produced **in controlled waves of ≤3-4 agents**. Work is resumable: every stage writes files (src/, verdicts/, changed-rN-*.json, batches*.json) and the scripts are idempotent.

## Pilot (chapter 1) verification numbers
Round 1 (independent verification of the first full authoring): facts 220/228, lessons 23/34, questions 465/588 verified; 142 items went to a repair round (3 fixers).
Round 2 (re-check of the repaired items): facts 227/228, lessons 33/34, questions 574/588 verified. The 16 remaining items were repaired by the orchestrator (one fact was split in two,
four new questions added for it) and re-checked in round 3 (28 items: 27 pass, 1 fail). **Current chapter-1 state: facts 229/229, lessons 34/34, questions 591/592 verified**;
the one remaining question (q2425, hint rewritten after the round-3 failure) is `pending` until a round-4 re-check. Nothing counts as verified without an independent `pass` verdict.
Typical defects found by independent verifiers: hints that reveal the answer, missing natural accepted variants for short answers, open lists presented as complete, invented labels (e.g. "first stanza"), unsupported hints/attributions, dangling antecedents in stems. Guides and validator lints were tightened accordingly.

## Data durability
`private/` lives only in this container (never in git, by design). Milestone archives of the authored content are delivered to the user directly as files (not via GitHub). The extraction is reproducible from the PDFs in ~25 s.

## Known limitations / pending manual review
- Vowel-pointed words (e.g. biblical quotations, p.22-23) can contain stray spaces in the text layer; verify against the image if a question depends on them.
- Pages that are image-only or have text inside images need transcription: p.15 (two infographics), p.23 (anthem), p.207 (map), p.268/274 and other weapon photos. Inventory in `private/work/source/figures.json`.
- Table reconstruction is built from the book's border lines; merged cells appear as blanks (verify against the page image).
- Thought boxes ("שאלות למחשבה") are kept as `supplementary` and never used for questions.

## Next required actions
1. Scaffold `bahad1-app` (Vite + React + TS + idb + vitest + playwright), content schema + validators.
2. Image-text transcription pass for pp. 15, 23 and every figure that carries text; second independent reading.
3. Pilot chapter 1 end-to-end, evaluate, fix; then scale to ch2-ch13 with independent verification waves.

## How to resume (usage-limit pause — no automatic resumption is scheduled; the user restarts the session manually)
1. Check for container state: `ls private/content/*/src` (if `private/` is gone, re-run `pipeline/*` on the PDFs, then restore the content archive the user received from the session).
2. Wave-1 authors (ch2 seg a pp24-35, ch3 seg a pp53-64) may or may not have finished: look for `private/content/ch2/src/*-a-*.json`, `NOTES-a.md`, `_seg-a/`. If output is partial, re-run the author with the same assignment (the guide + scripts are idempotent).
3. Remaining segments (suggested): ch2 B 36-46, C 47-52; ch3 B 65-75, C 76-81; ch4 82-89/90-96; ch5 97-107, 108-117; ch6 118-133, 134-143, 144-157, 158-171; ch7 172-185, 186-195, 196-206; ch8 map p207; ch9 208-220; ch10 221-231, 232-242; ch11 243-247; ch12 248-260; ch13 261-272 … 308-314. Keep concurrency at 3-4 agents.
4. After each chapter: `author-expand` (all segments) -> `validate-content` -> `coverage` -> `make-batches` -> independent verifiers -> `apply-verdicts` -> `export-fixlist` -> repair rounds (`make-repair-batches`) -> `final-audit`.
