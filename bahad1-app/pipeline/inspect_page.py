"""Debug helper: print per-line style info for one global page (1..314).
Usage: python -I pipeline/inspect_page.py <global_page> [source_dir]
Reads PDFs from private/source (never modifies them)."""
import sys, pymupdf
pymupdf.TOOLS.mupdf_display_errors(False)
PARTS = [(1, 1, 80), (2, 81, 160), (3, 161, 240), (4, 241, 314)]
def locate(g):
    for p, a, b in PARTS:
        if a <= g <= b:
            return p, g - a
    raise SystemExit('page out of range')
def main():
    g = int(sys.argv[1]); src = sys.argv[2] if len(sys.argv) > 2 else 'private/source'
    p, idx = locate(g)
    page = pymupdf.open(f'{src}/part{p}.pdf')[idx]
    d = page.get_text('dict')
    print(f'global page {g} = part{p} idx{idx+1}; size {page.rect}')
    for bi, b in enumerate(d['blocks']):
        if b['type'] == 1:
            print(f'[{bi}] IMAGE bbox={tuple(round(x) for x in b["bbox"])} {b.get("width")}x{b.get("height")}'); continue
        for l in b['lines']:
            sp = l['spans']
            txt = ''.join(s['text'] for s in sp).strip()
            if not txt: continue
            st = {(s['font'].replace('Assistant-', 'A-'), round(s['size'], 1), 'B' if s['flags'] & 16 else '', f"{s['color']:06x}") for s in sp}
            x0, y0, x1, y1 = (round(v) for v in l['bbox'])
            print(f'[{bi}] y{y0:>3}-{y1:<3} x{x0:>3}-{x1:<3} {sorted(st)} | {txt[:90]}')
main()
