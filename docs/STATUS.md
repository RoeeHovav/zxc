# Project status

Last updated: 2026-11-04 · version 0.9.0. This is the hand-over record for
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
- **Windows launcher** (`Start PDF Narrator.bat`, `launch.ps1`). It is written
  for Windows 10/11 but was not executed on Windows here.
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
