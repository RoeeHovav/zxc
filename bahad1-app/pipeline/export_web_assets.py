"""Stage 4 - web-sized original page images for the in-app original-page viewer (private, git-ignored output).
Writes private/work/img/web/pages/pNNN.jpg (A4 at 120 dpi, JPEG q70).  python -I pipeline/export_web_assets.py"""
import os, pymupdf
pymupdf.TOOLS.mupdf_display_errors(False)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'private/work/img/web/pages'); os.makedirs(OUT, exist_ok=True)
for p, a, b in [(1, 1, 80), (2, 81, 160), (3, 161, 240), (4, 241, 314)]:
    doc = pymupdf.open(os.path.join(ROOT, f'private/source/part{p}.pdf'))
    for i, page in enumerate(doc):
        page.get_pixmap(matrix=pymupdf.Matrix(120 / 72, 120 / 72)).save(os.path.join(OUT, f'p{a+i:03d}.jpg'), jpg_quality=70)
print('web pages exported:', len(os.listdir(OUT)))
