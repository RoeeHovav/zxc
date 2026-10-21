# בה״ד 1 – מרכז הלמידה (Bahad 1 learning app)

A Hebrew, RTL, local-first learning platform for the official Bahad 1 officer-preparation book. It turns the book into short interactive
lessons, original questions, strict 100%-mastery assessments, daily review and exam simulation — **with no runtime AI**.

> **Privacy.** The book, its extraction and everything derived from it (lessons, questions, page images) live only in `private/`, `public/content/`,
> `dist/` and `release/`, all git-ignored. Never commit or publish them. This repository contains code, schemas, tests (synthetic fixtures only) and docs.

## Rules the system enforces
* The only source of facts is the 314-page official book (4 PDFs, one global page numbering). Other documents are never used.
* Every lesson/question/answer/hint cites a precise passage (`unit` + verbatim quote + page). `npm run content:validate` rejects any quote that is not
  verbatim in a *core* source unit. Footnotes are kept in the source index but are **not** used for questions (the book says they are not exam material).
* An item enters the question bank only when (a) its programmatic checks pass **and** (b) an independent verifier said `pass`, or (c) you approve it explicitly in the review dashboard.
* **Guided mastery = 100%**: every question of a representative assessment correct, no hints, no second attempt, unanswered = wrong. Practice is supportive (progressive hints).
* Deterministic grading: exact match after harmless normalisation (spacing/punctuation/quote marks/niqqud). No fuzzy matching, no AI.

## Quick start (development machine)
Requirements: Node.js ≥ 22.18 (or 24), Python 3.11+ (only for the extraction pipeline).
```bash
cd bahad1-app
npm install
npm run test                 # 61 unit tests (domain engines, storage, backup)
npm run typecheck
# --- browser tests on SYNTHETIC content (no book needed) ---
npx playwright test          # desktop + mobile (uses PLAYWRIGHT_BROWSERS_PATH; do not run `playwright install`)
```

## Building the real app (needs the private book content)
1. Extraction (one-time; PDFs in `private/source/part1..4.pdf`):
   ```bash
   python3 -m venv private/.venv && private/.venv/bin/pip install pymupdf
   private/.venv/bin/python -I pipeline/extract_pages.py 1 314
   private/.venv/bin/python -I pipeline/build_units.py
   private/.venv/bin/python -I pipeline/render_pages.py
   private/.venv/bin/python -I pipeline/export_web_assets.py
   private/.venv/bin/python -I pipeline/crosscheck_poppler.py      # independent Poppler cross-check
   ```
2. Content (per chapter): author → `node scripts/author-expand.mjs chN` → `node scripts/validate-content.mjs` → independent verification →
   `node scripts/apply-verdicts.mjs chN` → `node scripts/coverage.mjs`. See `docs/AUTHORING_GUIDE.md` and `docs/VERIFICATION_GUIDE.md`.
3. Compile + build + package:
   ```bash
   npm run content:build        # private/content -> public/content (git-ignored)
   npm run build                # -> dist/
   node scripts/package-release.mjs   # -> release/bahad1-app-release.zip (private!)
   ```

## Running locally on Windows (from the release zip)
1. Install Node.js (LTS) once. 2. Unzip. 3. Double-click `start.bat`. 4. The browser opens `http://localhost:4173`.
(Any static server works; the app is plain static files. For a future private online deployment put the `app/` folder behind authentication — never public.)

## Read aloud (Hebrew text-to-speech)
Lesson cards, questions, answer explanations and the cited source passages have a 🔊 button; a small player (previous / pause / next sentence / stop / speed) appears while reading,
the sentence being read is highlighted, and *Settings → Read aloud* lets you choose the voice, speed and pitch, test the voice and turn on auto-read.
- It uses the voices of your own device/browser (Web Speech API) — no AI and no cloud service of the app. The best **local** Hebrew voice is chosen automatically.
- Natural/neural voices (e.g. Microsoft *Natural* voices in Edge/Windows, Google voices on Android) are usually *online* voices: the browser then sends the read text to its provider.
  That is **off by default**; enable *Allow online voices* in the settings (or in the dialog that offers it) if you accept that.
- To make the voice sound as human as possible the text is cut into short sentences with natural pauses; vowel points, quotation marks and brackets are removed; Hebrew-letter numerals and years (ט״ו, תש״ח),
  ranges (1936-1939), percentages and a few abbreviations are spelled out. This only changes how text is *spoken*, never what is displayed or graded.
- If the device has no Hebrew voice, the button explains how to install one (Windows, Android, iPhone/iPad, Mac). Pause/resume restart at the current sentence, which works in every browser.

## Progress, backup and restore
* Progress (lessons, assessments, answers, XP, streaks, preferences) is saved automatically in the browser's IndexedDB — **per browser/device; there is no sync**.
* Settings → **ייצוא גיבוי** downloads a JSON file with a SHA-256 checksum. Settings → **ייבוא מקובץ** validates the file (format, schema version, checksum,
  content version) and shows a summary **before** anything is written; restoring first stores a safety snapshot of the current progress. A daily automatic snapshot (last 5) is kept in the browser.
* Content updates: question/lesson ids are stable. Records of removed questions are kept but not shown; the backup warns when the content version differs.

## Reviewing flagged content
Open **לוח בקרת מקורות** (`/#/content-review`): coverage and extraction statistics, flagged/pending/rejected items with the generated content, the keyed answer,
the exact source passage (highlighted quote), the page (and the original page image), the verifier's concern, and **approve / reject / correct** buttons.
Decisions are stored locally and exported with the backup; official answer keys are never changed silently.

## Updating the question bank
Edit the compact sources in `private/content/<chapter>/src/`, re-run the expander + validator, obtain independent verdicts, apply them, rebuild (`npm run content:build && npm run build`).

## Limitations (honest list)
See `PROJECT_STATUS.md` (updated with real counts) and `docs/FINAL_AUDIT.md`.
