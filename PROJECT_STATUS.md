# PROJECT STATUS — Bahad 1 learning app

_Last updated: 2026-10-11. This file is the resume point for any new session or
context compaction. Keep it truthful; do not mark anything done that is not._

## 0. HARD BLOCKER (read first)

**The official book has NOT been provided to the development environment.**

- Required authoritative source: `אוגדן_הכנה_לקצונה_נחשון_ומעוז_פברואר_2021`
- The owner reports it is at `C:\Users\roeeh\Downloads` on their Windows PC. The
  development session runs in a cloud container and cannot see that path.
- 19 files were uploaded to the session; **none of them is the book**. They are
  student summaries / handwritten-note scans / spreadsheets (non-authoritative).
  They were only identified (metadata + first-page peek). **No facts from them
  were extracted or used.** Do not use them for content (master prompt §1.1).
- **The GitHub repo `RoeeHovav/zxc` is PUBLIC.** The book, extracted text and
  anything derived verbatim from it must not be committed here. `.gitignore`
  already blocks `/source/`, `/content/book/`, `*.pdf`, `*.docx`, `*.xlsx`.
  Recommend the owner make the repo private before any book-derived content is
  versioned.
- Ways to unblock (owner's choice): split the PDF with `tools/split_pdf.py` and
  attach the parts to the chat; or put it in a private repo and attach via
  `add_repo`; or run Claude Code locally on Windows against the folder.

Blocked until the book is available: Phase 1 (examine), 2 (source DB),
4 (pilot chapter), 5 (all chapters), 8 (final source audit).

## 1. Phase checklist

| Phase | Description | Status |
|---|---|---|
| 1 | Examine the official book | **BLOCKED (no book)** |
| 2 | Source database + coverage matrix | **BLOCKED** (tooling can be built meanwhile) |
| 3 | App foundation (nav, dashboard, lesson UI, engine, mastery, storage, source viewer, review dashboard) | IN PROGRESS — book-independent parts only |
| 4 | Pilot chapter | **BLOCKED** |
| 5 | All chapters | **BLOCKED** |
| 6 | Learning modes (daily review, custom practice, exam, weakness, XP...) | Not started (book-independent, will build next) |
| 7 | QA / automated tests | Not started |
| 8 | Final source audit | **BLOCKED** |
| 9 | Final delivery | Not started |

## 2. Decisions already made

- Stack: React 19 + TypeScript 5.9 + Vite 8, Vitest for unit tests, Playwright
  1.56.1 (matches the container's Chromium build) for E2E, IndexedDB via `idb`,
  `zod` for content/backup validation, `react-router-dom` (hash routing so the
  built app also works from a plain static folder).
- No runtime AI, no network calls at runtime; all grading is deterministic.
- Content flows: `content/book/**` (book-derived, git-ignored) → `scripts/prepare-content`
  (verified-only gate + integrity checks) → `public/content/**` (generated) → app.
- Test-only synthetic fixture pack lives in `tests/fixtures/` and is clearly
  marked synthetic; it must never be shipped or shown as study material.
- Previous Flutter scaffold was deleted at the owner's request (still in git history).

## 3. Chapters

Chapters processed: **0**. Chapters remaining: **unknown until the book is examined.**

## 4. Verification results

None yet (no book content has been processed).

## 5. Known bugs

None recorded yet.

## 6. Pending manual reviews

None yet.

## 7. Next required actions

1. Owner: deliver the book (see §0) and say its file format and size.
2. Continue book-independent build: domain types, engine + tests, storage/backup,
   content-pipeline scripts, RTL UI, E2E tests.
3. When the book arrives: Phase 1 analysis (`tools/analyze_book.py`), then Phase 2.
