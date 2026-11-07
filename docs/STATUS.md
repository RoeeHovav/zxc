# Project status

Last updated: 2026-11-07 · version 0.10.0. This is the hand-over record for
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
- **Pronunciation accuracy, measured (0.9.9).** `scripts/eval_pronunciation.py` asks the assistant about 48
  sentences with ambiguous Hebrew words (answer key written by the assistant author, NOT checked by a native
  speaker; 25 sentences held out from tuning; one batch grouping per run, temperature 0). Prompt p7:
  gemini-3.1-flash-lite 96% held-out / 94% all (45/48), gemini-3.5-flash-lite 84% / 88%,
  gemini-flash-lite-latest 80% / 90% (and wrong on the user's שמן sentence). Earlier prompts: p4 got the user's
  sentence wrong; p5 (candidates) about 88-91%; p6 (meanings first, "include every word") 96% held-out on 3.1-lite
  but the user's sentence was flaky (2 of 3 runs right); p7 (possessive suffixes, pick must match the analysis)
  right in all later runs on 3.1-lite and 3.5-lite. Most remaining misses are words the model did not flag as
  ambiguous (e.g. עד) which may well be read right by default. Models with more capacity (flash/pro) were out of
  free quota and are unmeasured. Free tier: 20 requests per day PER MODEL (Google's error text), 12 passages per
  request, the app rotates models. This measures the TEXT step only; whether a voice obeys vowel marks is separate.
- **Pronunciation: reasoning, context and corrections (0.9.8).** The user's Voice-lab test showed the assistant
  picking a wrong reading for שמן (shown as the word it gave the voice). 0.9.8: the prompt asks for grammatical
  reasoning and 2-3 ranked candidates with glosses, passages carry the neighbouring text, and the user's own
  test sentence was removed from the prompt examples (so tests of it are honest). Corrections that stick: in
  the Voice lab "Wrong? Pick the right reading" (or type one) saves a global rule naming the neighbouring words
  (so oil is untouched elsewhere) and replays; in the reader, Fix pronunciation > "Suggest readings" asks Gemini
  for all readings of the clicked word (defaults to "only this occurrence"). Saved rules always beat the assistant.
  Accuracy on real text and whether voices follow vowel marks remain unverified; no way to guarantee a model is
  right every time, which is why corrections are one click.
- **Why "Preparing narration" is slow (0.9.7):** measured on a 314-page booklet: text preparation is fast
  (about 680 chunks/s) but the booklet yields about 8 chunks per page (many short items) and every chunk is one
  request to the voice service, so 50% of a long document is thousands of requests. The wait now also stops after
  about 10 minutes of narration (setting `buffer_minutes`), and 5 chunks are prepared at once instead of 3. Real
  voice-service speed was not measurable here (service blocked); the test-tone engine itself is slow (pure Python).
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
- **Comprehension checkpoints** (`narrator/llm/quiz.py`, `narrator/narration/checkpoints.py`, `Quiz.tsx`, 0.10.0).
  Tested with a pretend question writer (unit tests of planning, grounding checks, caching, styles, consent, answers,
  missed questions returning; a browser run `tests/e2e/quiz.cjs` of the whole flow in English and Hebrew UI).
  Measured on the user's 314-page booklet with `scripts/eval_quiz.py` (6 passages from pages 14-200, writer
  gemini-3.5-flash-lite, an INDEPENDENT stronger model, gemini-3.5-flash, answering): every question that reached the
  listener had a quotation found in the text (the app rejected 12 of 42 written for an absolute word or a quotation
  that was not in the text); answered WITH the passage 30/30 candidates and 12/12 chosen were right (the keyed answer
  is the unambiguous one). Answered WITHOUT the passage (title only) the same model got 27/30 candidates right, almost
  all with top confidence, and 10/12 of the questions the app chose after its own guessability check (earlier prompt,
  with generic wrong answers: 94%). In other words **multiple-choice questions about familiar material are largely
  guessable by a knowledgeable reader; the prompt and the check reduce that but cannot remove it.** A person who does
  not know the subject will do much worse than this model, so the figure is a pessimistic bound, not a human score.
  The open questions cannot be guessed; their quality is only checked for grounding (quotation present), the key points
  are model-written and the listener grades themselves. NOT verified: whether native Hebrew readers find the questions
  fair and well phrased (no one has read them but the developer), the native Gemini endpoint (the sandbox can only
  use the OpenAI-compatible one), real latency with the prefetch, and how the free allowance holds up (each checkpoint
  = 2 requests; models were intermittently "high demand" 503 during the measurement).
- **Spoken-text punctuation (0.10.0).** Scanning every 4th page of the booklet (75 pages, 780 passages as the voice
  receives them) found: 46 list items starting with a bullet/asterisk, 15 year ranges back to front (the PDF stores
  the digits in visual order on a right-to-left page; checked against word coordinates), 7 call-out labels glued to
  their sentence ("למחשבה כפי שציינו"), 117 headings/list items with no final punctuation, 41 brackets with a stray
  space. After the clean-ups the same scan finds 0 / 0 / 0 / 0 / 1. NOT verified: that the voices sound better for it
  (nobody has listened), and remaining artefacts the scan does not look for (misplaced quote marks such as
  `"יהדות "שלוש "פנים"` come from bidi extraction and are not repaired).
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
