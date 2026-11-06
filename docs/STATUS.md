# Project status

Last updated: 2026-11-04 · version 0.9.6. This is the hand-over record for
continuing development across sessions.

## Verified (automated)

`pytest` runs 70 tests, all passing:
- bidi round-trips;
- extraction on Chrome-generated fixtures: Hebrew RTL and niqqud, numbers,
  embedded English, two-column English, headings, vector bullets,
  headers/footers, captions, cross-page continuation;
- OCR of a rasterised Hebrew page;
- normalisation, lexicon context rules and prefixes, math, segmentation,
  language detection;
- alignment;
- the Edge provider against a fake service (boundary parsing, retries,
  failures, offline voice list);
- cache keys and eviction;
- API flows: upload, layout, speech, cache hits, lexicon and occurrence fixes,
  consent, position persistence across a service restart, bookmarks,
  niqqud-insensitive search, combine upload, rejecting non-PDFs, local-only
  guard;
- a 600-page document usable on demand;
- concurrent page requests;
- Teacher Mode client, prompt and cache.

`tests/test_user_document.py` runs 7 regression checks on the user's
314-page booklet. It is kept out of git (`tests/private/user.pdf`). It checks:
- `(1911-2002)` and `בשנת 1992,` (Word RTL artefacts repaired);
- `5.3 העלייה השנייה` (author's section numbering);
- the niqqud verse on p. 101;
- the caption on p. 301;
- the p. 200→201 continuation;
- full processing in about 30 s.

`node tests/e2e/acceptance.cjs` runs the essential acceptance scenario in
Chromium. It uses the test-tone engine for audio and passes:
- open a 520-page PDF and go to page 201;
- drag-select a paragraph and read it;
- the word highlight lies on the spoken word, sentence highlighting works, and
  word-sync is reported;
- 1.5× speed;
- skip back and forward, next sentence;
- pause, kill the server and browser, restart, and resume at the same word;
- an English document is routed to English;
- no JavaScript errors.

## Not verified (honest list)

- **Real speech output.** Edge voices, Azure, the Voice lab and listening
  samples could not reach the network from the dev environment. Hebrew
  naturalness, whether niqqud is honoured, and acronym expansions all need the
  listening test (`scripts/make_listening_samples.py`).
- **Windows launcher** (`Start PDF Narrator.py`; the former `.bat`/`.ps1` were
  replaced because SmartScreen / Smart App Control block scripts). The launcher
  logic (venv, wheel-only pinned install, per-library load check, OCR download
  with SHA-256, detached start, failure diagnosis) was run end-to-end on Linux
  only. It was **never run on Windows**, and **Smart App Control may still block
  compiled libraries (PyMuPDF, pydantic-core, ...)**: that cannot be fixed
  without a code-signing certificate and the only workaround is turning Smart
  App Control off. The launcher reports the blocked module by name.
- **Narrate ahead / Prepare all** (`prepare_start` in `service.py`, player bar). Tested with the
  test-tone engine (completion, cancel, patient mode waiting out a quota, instant replay) and in the browser
  acceptance run; never run against real Edge/Gemini audio. The default of 50% before the first play can mean
  a long wait on a very long document with a real engine; "Start now" skips it.
- **Pronunciation assistant** (`narrator/llm/pronounce.py`, `_vocalize_chunk` in `service.py`). Tested
  against a simulated Gemini service (validation, token alignment, caching, consent, quota). Unverified:
  (1) whether the Microsoft voices (Hila/Avri/Multilingual "William", "Andrew") actually follow vowel marks,
  (2) how accurate Gemini's choices are on real text, (3) the free text-model allowance in practice.
  Reported by the user: the multilingual voices sound very good but misread homographs (שמן as "oil").
- **Pronunciation assistant, batching and status.** Passages are asked in groups of up to 12 per request
  (one request covers the current passage and the next ones; the free request allowance may be only a few per
  day), with the more accurate `gemini-2.5-flash` first. The Voice lab shows what the voice was given and a
  status line (added N words / no key / nothing ambiguous / resting / error). The user's first live test with
  William (Multilingual) still read שמן as "fat"; at that time the status line did not exist, so it is unknown
  whether the assistant ran or the voice ignores vowel marks. The hand-typed vowel-mark sample in the Voice lab
  separates the two cases.
- **Live finding (user's Voice lab, 0.9.4):** Gemini answered 404 "models/gemini-2.5-flash is no longer
  available to new users ... use models/gemini-3.8-flash", so the assistant had changed nothing. Fixed in 0.9.5:
  models are ranked from the key's own model list (current flash alias, newest flash, flash-lite, ...), a
  retired/refused model is skipped for hours and Google's suggested replacement is tried next, the model that
  worked is remembered. Still unverified live: that the answers are accurate and that the voices follow vowel marks.
- **Live finding (0.9.5):** both Voice-lab Play buttons stayed grey (request never returned) because the
  assistant worked through every model of the key, one slow attempt after another. 0.9.6: at most 4 models and
  25 s per request, per-model pacing, a model that is over its limit is skipped instead of waited for, a failure
  rests the assistant for 1-5 min so later passages do not wait again, and the Voice lab button says "Working…".
- **Large documents**: the document vocabulary used to be rebuilt from every analysed page on every request,
  stalling playback 10-18 s at a time during the first minutes of a 1,256-page document; it is now incremental
  (worst request 0.7 s in the same test).
- **OCR in a separate process** (`OcrEngine.analyze`). In-process OCR held Python's global lock for seconds
  per page, freezing the whole server (found with a thread dump; it made the acceptance run flaky). Measured on
  real pages here: 3-4.5 s each. Windows start-up of the worker (spawn) was not run on Windows.
- **Gemini voices** (`narrator/tts/gemini.py`). Request/response shapes, model
  discovery, retry and error handling are tested against a simulated service.
  Live synthesis was not reachable from the development environment, so
  Hebrew quality, real rate limits of the free tier and the current model names
  are unverified. No word timing (sentence-level highlight only). The user reported the quality as very good
  but the free allowance (a few requests) as far too small; mitigations (quota-kind detection, pacing, model
  rotation, 2000-character requests, automatic fall-back to the free voice, slow "patient" background narration)
  are tested against a simulated service only and cannot lift Google's limit.
- **Teacher Mode** with a real model. The protocol was tested with a mock;
  explanation quality, especially in Hebrew with small local models, is
  unknown.
- **Languages other than Hebrew and English.** Detection and voice routing are
  implemented; narration quality is untested.
- **Word timing on real Edge audio.** The alignment logic is tested; real
  boundary texts for Hebrew numbers and acronyms may differ. The fallback is
  interpolation, flagged as estimated.

## Known limitations

- Tables are read row by row as text lines. There is no cell-aware narration.
- Display math rendered as vector graphics or images is not spoken. It shows as
  a figure. Linear Unicode math is spoken.
- Figure descriptions: figures are marked, but AI image description is not
  implemented.
- Word's reversed multi-level list numbers are fixed only when the content
  stream is logical (true for Word, LibreOffice and browsers).
- The free Edge endpoint accepts no SSML, so pause control between sentences
  inside a chunk is left to the voice. Pauses between blocks come from the
  player.
- Hebrew numbers (gender agreement) are left to the voice's own normaliser.
- The outline from detected headings can include cover-page large text when the
  PDF has no bookmarks.

## Next steps (priority order)

1. Run the listening samples on the user's machine. Adjust the lexicon and
   default voices based on the results.
2. If Hebrew needs better contextual vocalisation: integrate an offline
   diacritiser (Phonikud ONNX or DictaBERT-char-menaked, both free). Apply it
   only to uncertain or ambiguous words, A/B tested in the Voice lab.
3. Evaluate Google Chirp 3 HD he-IL (free monthly tier) as an alternative
   Hebrew provider.
4. Offline voices (Piper with Phonikud for Hebrew, Kokoro for English) for
   no-internet use.
5. Table-aware narration; MathML/LaTeX-aware math; AI figure descriptions.
6. Audio export of a chapter, where the provider licence permits.

## Repository notes

- The Flutter template files at the repository root (`pubspec.yaml`,
  `.metadata`, etc.) pre-date this project and are unused by it.
- The UI build in `narrator/static/` is committed; rebuild it after changing
  `web/src`.
