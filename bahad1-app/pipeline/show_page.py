"""Debug: print extracted segments of one page. python -I pipeline/show_page.py <page>"""
import json, sys, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = json.load(open(os.path.join(ROOT, 'private/work/pages', f'p{int(sys.argv[1]):03d}.json'), encoding='utf-8'))
print('page', d['page'], 'printed', d['printedPage'], 'frames', [(f['id'], f['bbox']) for f in d['frames']], 'images', len(d['images']), 'tables', d['tables'])
for s in d['segments']:
    flags = ''
    if s['emphasis']: flags += f" EMPH{s['emphasis']}"
    if s['underline']: flags += f" UL{s['underline']}"
    if s['fnRefs']: flags += f" FN{[(r['pos'], r['label']) for r in s['fnRefs']]}"
    print(f"{s['id']} {s['role']:<9} sz{s['size']:<5} y{s['bbox'][1]:>5.0f} x{s['bbox'][0]:>4.0f}-{s['bbox'][2]:<4.0f} fr={s['frame']}{flags} | {s['text']}")
