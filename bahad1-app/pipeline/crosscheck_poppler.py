"""Cross-check the PyMuPDF glyph reconstruction against Poppler's pdftotext (independent engine).
Compares, per page, (a) Hebrew letter multiset, (b) numeric-token multiset, (c) Latin-token multiset.
Writes private/work/crosscheck_poppler.json and prints a summary.  python -I pipeline/crosscheck_poppler.py"""
import json, os, re, collections, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = os.path.join(ROOT, 'private/work/pages'); SRC = os.path.join(ROOT, 'private/source')
PARTS = [(1, 1, 80), (2, 81, 160), (3, 161, 240), (4, 241, 314)]
BIDI = re.compile('[‎‏‪-‮⁦-⁩]')
HEB = re.compile('[א-ת]')
NUM = re.compile(r'\d+(?:[-–.,:/]\d+)*')
LAT = re.compile(r'[A-Za-z][A-Za-z0-9]*')

def poppler_text(g):
    for p, a, b in PARTS:
        if a <= g <= b:
            out = subprocess.run(['pdftotext', '-f', str(g - a + 1), '-l', str(g - a + 1), f'{SRC}/part{p}.pdf', '-'], capture_output=True, text=True, check=True).stdout
            return BIDI.sub('', out)

def stats(text):
    return (collections.Counter(HEB.findall(text)), collections.Counter(NUM.findall(text)), collections.Counter(LAT.findall(text)))

def diff(a, b):
    d = {}
    for k in set(a) | set(b):
        if a[k] != b[k]:
            d[k] = (a[k], b[k])
    return d

report = {}
for g in range(1, 315):
    mine = json.load(open(f'{PAGES}/p{g:03d}.json', encoding='utf-8'))
    mt = ' '.join(s['text'] for s in mine['segments'] if s['role'] != 'pagenum')
    pt = poppler_text(g)
    # drop poppler's page number line (global page number printed alone)
    pt = re.sub(r'(?m)^\s*%d\s*$' % g, '', pt)
    ma, mn, ml = stats(mt); pa, pn, pl = stats(pt)
    dh, dn, dl = diff(ma, pa), diff(mn, pn), diff(ml, pl)
    report[g] = {'hebDiff': sum(abs(v[0] - v[1]) for v in dh.values()), 'hebTotal': sum(ma.values()),
                 'numDiff': {k: v for k, v in dn.items()}, 'latDiff': {k: v for k, v in dl.items()}}
json.dump(report, open(os.path.join(ROOT, 'private/work/crosscheck_poppler.json'), 'w'), ensure_ascii=False, indent=1)
bad_h = [g for g, r in report.items() if r['hebDiff'] > max(3, 0.01 * r['hebTotal'])]
bad_n = [g for g, r in report.items() if r['numDiff']]
bad_l = [g for g, r in report.items() if r['latDiff']]
print('pages:', len(report), '| Hebrew-letter mismatch >1%:', len(bad_h), bad_h[:30])
print('pages with numeric-token mismatch:', len(bad_n), bad_n[:60])
print('pages with Latin-token mismatch:', len(bad_l), bad_l[:40])
tot = sum(r['hebTotal'] for r in report.values()); dif = sum(r['hebDiff'] for r in report.values())
print(f'total Hebrew letters (mine) {tot}; total letter-count difference vs Poppler {dif} ({100*dif/tot:.3f}%)')
