# Source verification report — official book (4 PDF parts)

No book text appears in this file. Facts below were measured on the files supplied in this session.

## 1. Files and continuity
| Part | Expected pages | Actual pages | Global pages | Printed numbers match global index |
|---|---|---|---|---|
| 1 | 80 | 80 | 1–80 | yes (all 80) |
| 2 | 80 | 80 | 81–160 | yes (all 80) |
| 3 | 80 | 80 | 161–240 | yes (all 80) |
| 4 | 74 | 74 | 241–314 | yes (all 74) |
| **Total** | **314** | **314** | | **314 / 314** |

* All four files open with PyMuPDF and Poppler, are unencrypted, A4, PDF 1.7, producer PDFium.
* The printed page number (white-on-red corner badge) equals the global PDF position on every page → the four parts form one
  continuous 314-page book. No missing page, no duplicated page (content hash check), no corrupted page.
* Printed numbers and global numbers are identical for this edition, so one numbering is used everywhere.
* 310/314 pages carry a text layer; pages 207, 261, 268, 274 are (almost) image-only and are handled as original figures.
* Files are processed from a git-ignored private directory; the PDFs are never modified or committed.

## 2. Extraction method and validation
* Text is rebuilt from per-glyph positions (PyMuPDF `rawdict`) with a visual→logical bidi reconstruction, because the PDF's raw
  text order scrambles numbers (verified on p.14: "1911-2002" came out as "2002-1911").
* Independent cross-check with Poppler `pdftotext` on all 314 pages:
  * Hebrew letters: 420,817 vs 420,797 → 20 letters differ (0.005%); 0 pages differ by more than 1%.
  * Latin tokens: identical on all 314 pages.
  * Numeric tokens: identical on all pages except 7 pages where Poppler counts superscript footnote-marker digits as ordinary
    text (we store them as footnote references) and big decorative gate numerals — each was inspected, none is a lost/misordered number.
  * 2 real extraction bugs found by the cross-check and fixed: overstruck (double-drawn) text on p.191; 10pt text flagged
    "superscript" on pp.139-152.
* Visual validation against rendered pages: pp. 14, 22, 23, 40, 60, 130, 139, 210, 237 (bold terms, underlines, footnotes, boxes,
  epigraph quotes, tables, vowel-pointed text) — see the roles/bold/footnote behaviour in `pipeline/extract_pages.py`.
* Book-defined formatting: bold = exam focus (preface p.12); footnotes = not exam material (kept, excluded from questions).

## 3. Unified source index (stage 2 output)
2,788 citable units across 314 pages: scope counts are produced by `pipeline/build_units.py` and re-reported in the dashboard.

## Classification overrides (added during content production)
The automatic role detection mislabelled a few framed photo captions / leader-name captions as footnotes (no footnote mark, small framed text under a photo).
`pipeline/unit_overrides.json` lists the unit ids that were corrected after checking the page image (ids and reasons only — no book text); the build also turns lone footnote-mark glyphs (`*`, `**`)
into non-content `footnote_mark` units. The overrides do not change any unit id or text. Footnotes themselves remain excluded from exam content.
