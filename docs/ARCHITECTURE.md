# Architecture

```
Browser UI (React/TS, narrator/static)          Python service (FastAPI, 127.0.0.1 only)
┌──────────────────────────────┐   HTTP/JSON    ┌────────────────────────────────────────┐
│ Library · Reader · Settings  │ ─────────────▶ │ app.py        routes, local-only guard  │
│ Viewer: page PNG + word layer│                │ service.py    orchestration             │
│ Narrator.ts playback engine  │ ◀── audio ──── │  ├─ pdf/      layout + document model   │
│  - chunk sequencing, gaps    │                │  ├─ text/     normalise, lexicon, math  │
│  - word timing → highlight   │                │  ├─ narration units/prepare/align/cache │
│  - position saving           │                │  ├─ tts/      edge, azure, testtone     │
└──────────────────────────────┘                │  ├─ llm/      Teacher Mode (optional)   │
                                                │  └─ db.py     SQLite                    │
                                                └────────────────────────────────────────┘
Data folder (%LOCALAPPDATA%\PDFNarrator): library/*.pdf, doc_cache/<id>/pages/*.json.gz,
audio_cache/, explanations/, narrator.sqlite3, secrets.json, tessdata/
```

## PDF pipeline (`narrator/pdf`)

1. **Glyphs** (`layout.collect_glyphs`)
   - Characters are read with their boxes from PyMuPDF `rawdict`, transformed
     to the displayed (rotated) page space.
   - Combining marks (niqqud) are attached to the base glyph with the same
     origin. This handles both Word (mark after base) and Skia (mark before a
     zero-width base, plus an advance-carrying pseudo-space).
   - Zero-width spaces are ignored.
2. **Lines.**
   - Glyphs are clustered by baseline, and small superscript clusters are
     attached to their line.
   - Column gutters are found from per-x glyph coverage across all lines.
   - Clusters are split at gutters or at gap outliers.
3. **Words and logical order.**
   - In each line, glyphs are sorted by x, with word breaks at real spaces and
     geometric gaps.
   - The **Unicode Bidirectional Algorithm** (`bidi.py`, our own implementation
     so glyph boxes survive) recovers logical order.
   - Content-stream order is used only for numeric section labels, where Word
     renders "5.3" as "3.5", and only when the page's stream is verified to be
     logical.
   - Bracket mirroring is decided per document by bracket balance.
4. **Blocks.**
   - Lines are grouped into blocks by geometry, size, pitch and bold.
   - Blocks are split into paragraphs at short sentence-final lines, indents,
     spacing, bullets, and vector-drawn bullets.
   - Reading order comes from recursive **XY-cut**, with columns right-to-left
     on RTL pages.
5. **Document model** (`document.py`)
   - Statistics from 30 sample pages: body size, repeated header/footer
     signatures, decorative images, RTL, mirroring.
   - Classification: heading (with level), paragraph, list_item, note, caption,
     footnote, header, footer, page_number, toc, figure_text, artifact.
   - Cross-page and cross-column paragraph continuation.
   - Each page is cached as gzip JSON, keyed by `EXTRACTOR_VERSION`.
   - Image-only or garbled pages are OCR'd through PyMuPDF's built-in Tesseract.

## Narration pipeline (`narrator/narration`, `narrator/text`)

- **Units** (`units.py`): one per block. A paragraph spanning pages or columns
  is one unit. Each unit gets:
  - its language (script-based; Latin/Cyrillic languages by function-word counts, no model download);
  - its sentences (abbreviation-aware), each typed as question / definition /
    warning / conclusion / example / quotation / statement.
- **Prepare** (`prepare.py`)
  - Words are normalised into *spoken tokens* that keep their source word range.
  - Normalisation (`normalize.py`) runs these stages in order:
    1. footnote marks and exponents;
    2. leaders;
    3. detached punctuation;
    3b. speech-only tidy-ups (`_tidy_for_speech`: list bullets and asterisks dropped, reversed year ranges put
        in order on Hebrew pages, call-out labels get a colon, stuck brackets separated); the same tokens keep
        their source word range, so highlighting is unaffected;
    4. Hebrew prefix-hyphen joins;
    5. vocabulary-based split-word repair;
    6. English de-hyphenation;
    7. citations and URLs;
    8. per-occurrence fixes;
    9. lexicon (user phrase rules, then the built-in TSV, with Hebrew prefixes
       and `after_number` / `not_after_number` / `before_number` context);
    10. math verbalisation;
    11. headings, list items and side notes without final punctuation get a full stop (`_close_the_sentence`).
  - Sentences are grouped into chunks of ≤ 900 characters per language, so a
    whole English sentence inside Hebrew gets the English voice.
  - Pauses and pacing per block kind (`DELIVERY`) are applied by the player.
- **Synthesis**
  - The cache key is (provider, version, voice, rate, pitch, spoken text).
    Speed is applied in the browser, so changing speed or replaying never
    re-synthesises.
  - Identical concurrent requests are de-duplicated.
  - The next 3 chunks are prefetched in the background.
- **Alignment** (`align.py`)
  - Engine word boundaries are matched to spoken tokens by offset or by text
    (niqqud/punctuation-insensitive), then mapped back to page words.
  - Words without timing are interpolated.
  - The quality is reported honestly as `word` or `estimated`.

## Comprehension checkpoints

- `narration/checkpoints.py` plans a *stretch* from the unit where listening starts (end of section / page /
  after N minutes; never right after a heading or a line ending in a colon). The player asks for the plan
  (`POST /quiz/plan`), notes which units were heard to their end, and when the last unit of the stretch ends it
  pauses and runs the checkpoint handler (`Quiz.tsx`). Half way through a stretch the questions are started in
  the background (`prefetch`), so they are normally ready.
- `llm/quiz.py` builds the questions from exactly the heard text: one request writes 6 multiple-choice and 3 open
  candidates (prompt requires passage-sourced wrong answers, a verbatim quotation per question, no absolute words),
  the app verifies each quotation against the text (`Passage.locate`), rejects self-answering options, places the
  right answer itself, then asks the same model *without the text* which questions it could answer and keeps the
  ones it could not (`guess_without_passage`, `select`). The result (both lists) is cached on disk per passage;
  `assemble` picks the mix by the `quiz_style` setting. It shares the Gemini key, model list, pacing and
  free-allowance state with the pronunciation assistant (`Vocalizer.ask_json`).
- Answers are stored in SQLite (`quiz_answers`); a missed question comes back first at the next checkpoint with
  its options in another order (`reshuffle`). "Hear that part again" plays the sentence holding the quotation
  (`stopAt`) and then resumes where the reading had got to.
- Test mode uses `llm/testquiz.py`, a pretend writer, so the whole flow runs without a network.

## Player (`web/src/player/Narrator.ts`)

- An HTMLAudioElement with `preservesPitch`.
- Chunks are sequenced with block-kind pauses, scaled by speed and the pause
  setting.
- Skips cross chunk and unit boundaries.
- Sentence and paragraph navigation, and stop-at for selections and page ranges.
- A rAF loop does a binary search over word start times and emits the position
  to the viewer. The viewer draws sentence/word rectangles from the page layout
  in PDF coordinates × zoom.
- Position is saved every 5 s, on pause, and on unload (keepalive).
- The Media Session API handles hardware media keys.

## Persistence (`narrator/db.py`)

SQLite tables: documents, positions, bookmarks, history, lexicon (global and
per document), occurrences, settings, doc_settings, ratings. Secrets (API keys)
live in `secrets.json`. They are never returned to the UI; only "saved" flags
are.

## Security

- The server binds to 127.0.0.1.
- Requests with a foreign `Host` are refused (DNS rebinding), as are
  state-changing requests from other origins (CSRF).
- Online services are used only after explicit consent.

## Extending

- **New speech engine:** subclass `TTSProvider` (`tts/base.py`) and register it
  in `NarratorService.providers`. Voices are addressed as `provider:voice`.
- **New language:** usually nothing to do (script / function-word detection plus a voice
  mapping). Optionally add `narrator/data/lexicon_<lang>.tsv` and load it in
  `service.py`.
- **Better Hebrew vocalisation:** hook a diacritiser (e.g. Phonikud or
  DictaBERT) into `prepare_unit` before normalisation. Apply niqqud only to
  words the user marks or the model is uncertain about, and verify against
  listening tests.
