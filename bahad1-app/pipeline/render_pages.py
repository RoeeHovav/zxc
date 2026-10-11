"""Stage 3 - render page PNGs (150 dpi) and original-figure crops (220 dpi) for every page.
Output (private, git-ignored):  private/work/img/pages/pNNN.png,  private/work/img/figs/pNNN-fK.png,  private/work/source/figures.json
Figures are CROPS OF THE ORIGINAL PAGE RENDERING (never redrawn or regenerated).  python -I pipeline/render_pages.py"""
import json, os, pymupdf
pymupdf.TOOLS.mupdf_display_errors(False)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'private/source'); PG = os.path.join(ROOT, 'private/work/img/pages'); FG = os.path.join(ROOT, 'private/work/img/figs')
os.makedirs(PG, exist_ok=True); os.makedirs(FG, exist_ok=True)
PARTS = [(1, 1, 80), (2, 81, 160), (3, 161, 240), (4, 241, 314)]
figs = []
for p, a, b in PARTS:
    doc = pymupdf.open(f'{SRC}/part{p}.pdf')
    for i, page in enumerate(doc):
        g = a + i
        page.get_pixmap(matrix=pymupdf.Matrix(150 / 72, 150 / 72)).save(f'{PG}/p{g:03d}.png')
        d = json.load(open(os.path.join(ROOT, f'private/work/pages/p{g:03d}.json'), encoding='utf-8'))
        W, H = d['size']
        for im in d['images']:
            if 'figId' not in im:
                continue                       # icons / bullets
            x0, y0, x1, y1 = im['bbox']
            area = (x1 - x0) * (y1 - y0) / (W * H)
            clip = pymupdf.Rect(max(0, x0 - 2), max(0, y0 - 2), min(W, x1 + 2), min(H, y1 + 2))
            name = im['figId'] + '.png'
            page.get_pixmap(matrix=pymupdf.Matrix(220 / 72, 220 / 72), clip=clip).save(f'{FG}/{name}')
            figs.append({'id': im['figId'], 'page': g, 'bbox': im['bbox'], 'pxW': im['pxW'], 'pxH': im['pxH'], 'pageAreaFraction': round(area, 3), 'file': name})
json.dump(figs, open(os.path.join(ROOT, 'private/work/source/figures.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('pages rendered: 314; figure crops:', len(figs))
