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
| 1. Verify 4 PDFs / 314-page continuity | DONE (see docs/SOURCE_VERIFICATION.md) |
| 2. Glyph-accurate extraction (PyMuPDF) + Poppler cross-check | DONE, validated on representative pages |
| 2b. Source index (units, pages, chapters, figures) | DONE: 2,788 units |
| 2c. Image-borne text (anthem, map, infographics) | TODO: transcribe from original images + double-read |
| 3. App foundation (Vite/React/TS) | TODO |
| 4. Pilot chapter 1 | TODO |
| 5. Remaining chapters | TODO |
| 6. Learning modes | TODO |
| 7. QA / e2e | TODO |
| 8. Final source audit | TODO |
| 9. Delivery docs | TODO |

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

## Known limitations / pending manual review
- Vowel-pointed words (e.g. biblical quotations, p.22-23) can contain stray spaces in the text layer; verify against the image if a question depends on them.
- Pages that are image-only or have text inside images need transcription: p.15 (two infographics), p.23 (anthem), p.207 (map), p.268/274 and other weapon photos. Inventory in `private/work/source/figures.json`.
- Table reconstruction is built from the book's border lines; merged cells appear as blanks (verify against the page image).
- Thought boxes ("שאלות למחשבה") are kept as `supplementary` and never used for questions.

## Next required actions
1. Scaffold `bahad1-app` (Vite + React + TS + idb + vitest + playwright), content schema + validators.
2. Image-text transcription pass for pp. 15, 23 and every figure that carries text; second independent reading.
3. Pilot chapter 1 end-to-end, evaluate, fix; then scale to ch2-ch13 with independent verification waves.
