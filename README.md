# PDF Narrator

A local-first PDF reader that reads documents aloud with natural neural voices.
Hebrew and English get the most attention, and other languages work where the
voice service supports them. While the voice reads, the matching word and
sentence are highlighted on the original PDF page.

It is built for long study sessions with academic and technical documents of
hundreds of pages.

## Start on Windows

1. Download or clone this repository, e.g. to `C:\PDF Narrator`.
2. Double-click **`Start PDF Narrator.bat`**.

The first start does the setup for you, which takes a few minutes:
- It finds Python 3.10+, or offers to install it with `winget`.
- It creates a private environment in `.venv` and installs the dependencies.
- It downloads the Hebrew and English OCR data (about 5 MB).
- It creates a **PDF Narrator** desktop shortcut.

The app opens in its own window (Edge/Chrome app mode). Later starts take a few
seconds. To stop it, use **Quit** on the library screen.

Advanced options:
- `scripts\windows\launch.ps1 -Console` runs with a visible log.
- `-Reinstall` rebuilds the environment.
- `-Port 9000` uses a different port.

Other systems (or manual start):

```bash
python -m venv .venv
```

```bash
.venv/bin/pip install -r requirements.txt
```

```bash
.venv/bin/python -m narrator
```

## What it does

- **Open any size PDF.** Uploads stream to disk and are never size-limited, so a
  1,000-page book is fine. You can also select several PDFs and combine them into
  one document in the order you choose. Pages are analysed on demand plus in the
  background, and the results are cached.
- **Correct reading order.** Text is rebuilt from glyph geometry with the Unicode
  bidirectional algorithm. This handles:
  - Hebrew RTL, mixed Hebrew/English lines, numbers and niqqud;
  - multi-column layouts;
  - Word's RTL artefacts: detached punctuation, missing spaces, reversed section numbers.
- **Document structure.** Each block is classified as one of:
  - headings, paragraphs and list items;
  - boxed notes, captions and footnotes;
  - running headers/footers, page numbers, the table of contents, and text inside figures.

  Paragraphs that continue across a page or column break are read as **one
  uninterrupted passage**.
- **Scanned pages.** These are OCR'd (Tesseract, Hebrew and English) and marked
  with an OCR badge. Figures are outlined and labelled rather than guessed at.
- **Narration preparation.** Before speaking, the text is prepared:
  - extraction artefacts are repaired;
  - Hebrew acronyms and military abbreviations are expanded using context
    (5 מ"מ → millimetres, but מ"מ alone → "mem-mem");
  - Hebrew prefixes are handled (בצה"ל, והרמטכ"ל);
  - math is spoken as words (`x² + y² = z²` → "x squared plus y squared equals z squared");
  - citations and footnote markers are skipped;
  - whole sentences in another language get a matching voice.

  The original text is never rewritten. Only how it is spoken changes.
- **Your pronunciation fixes.** Right-click a word, then choose **Fix
  pronunciation…** and enter niqqud or a respelling. The fix can apply to that
  occurrence, to the whole document, or to all documents. Multi-word entries act
  as context rules (e.g. "ספר תורה" → "סֵפֶר תּוֹרָה").
- **Player.** It has:
  - play/pause/stop/restart;
  - skip ±N seconds;
  - previous/next sentence and paragraph, and repeat sentence;
  - speed 0.5–3× with pitch preserved;
  - a sleep timer;
  - media keys;
  - read a selection, a sentence, a paragraph, or a page range;
  - double-click any word to start there.
- **Synchronized highlighting.** The current sentence and spoken word are
  highlighted on the PDF page, and the view auto-scrolls to follow them (toggle
  with **A**). When an engine gives no word timings, the player says so and
  highlights sentences only.
- **Resume anywhere.** The exact position is saved continuously. Reopen a
  document, even after closing the app, to continue from the same word.
- **Reader features.** Contents (from PDF bookmarks or detected headings),
  niqqud-insensitive search, bookmarks with notes, reading history, zoom, and
  light/dark themes. The interface is available in English and Hebrew (RTL).
- **Voice lab.** Compare voices A/B on Hebrew and English test passages and rate
  them.
- **Teacher Mode (optional).** At the end of each section, or on request from the
  right-click menu, a language model explains the material in plain words. It is
  clearly marked as AI and never changes the document. The free option is a local
  [Ollama](https://ollama.com) model, e.g. `gemma3:12b` or `aya-expanse:8b`.

## Voices and costs

| Engine | Cost | Notes |
|---|---|---|
| **Microsoft neural voices via Edge "Read Aloud"** (default) | Free, no account | Hebrew: Hila, Avri. English: Ava, Andrew, Emma, Brian, Sonia, Ryan, and 100+ locales. Exact per-word timing. Unofficial endpoint, so it could change. Text being read is sent to Microsoft. |
| Azure AI Speech (same voices, official) | Free tier of 0.5 M characters/month (≈ 9 hours), then pay-as-you-go | Needs your key + `pip install -r requirements-optional.txt`. Not tested live yet. |

An hour of narration is roughly 50–60 k characters. Details and the engine
comparison are in [docs/SPEECH_ENGINES.md](docs/SPEECH_ENGINES.md).

**Privacy.** Documents stay on your computer. Before an online voice or language
model is used for the first time, the app asks for permission and explains what
is sent: only the passages being read or explained, never the PDF file.
Consent can be revoked in Settings. There is no telemetry.

## Keyboard shortcuts

| Key | Action | Key | Action |
|---|---|---|---|
| Space | play / pause | ← / → | skip back / forward |
| Shift+← / → | previous / next sentence | [ / ] | previous / next paragraph |
| R | repeat sentence | , / . | slower / faster |
| Ctrl+F | search | Ctrl+B | bookmark |
| Ctrl + / − | zoom | A | follow narration on/off |
| Esc | stop | ? | all shortcuts |

## Listening tests

Automated tests cannot judge whether narration sounds natural. To produce real
samples on your machine:

```bash
.venv\Scripts\python scripts\make_listening_samples.py --pdf "C:\path\to\your.pdf" --pages 14,101,201
```

Then open `listening-samples\index.html`. It includes a test of whether the
Hebrew voice honours niqqud, which decides how pronunciation fixes should be
written.

## Development

- The backend is the Python package `narrator/`.
- The UI source is `web/` (React + TypeScript + Vite), built into
  `narrator/static/`. The build is committed so users need no Node.js.
- Tests:
  - `pytest` runs 70 tests.
  - `node tests/e2e/acceptance.cjs` runs the full user scenario in Chromium.
  - Fixtures: `node tests/fixtures/make_fixtures.cjs`.
- See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/STATUS.md](docs/STATUS.md).

Rebuild the UI after changing `web/src`:

```bash
cd web && npm install && npm run build
```
