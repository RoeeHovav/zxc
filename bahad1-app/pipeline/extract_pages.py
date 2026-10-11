"""Stage 1 - structured extraction of the official book (4 PDFs -> 314 global pages).

Reads  private/source/part{1..4}.pdf  (never modifies them)
Writes private/work/pages/p{NNN}.json  (private, git-ignored)

For each page we keep glyph-accurate logical text plus style information:
  role      : pagenum | heading1 | heading2 | heading3 | body | epigraph | footnote | caption | small | table | thought | box
  emphasis  : character ranges that are bold (book preface: bold = exam-focus topics)
  underline : character ranges that carry an underline bar
  fnRefs    : footnote reference marks found inside the text (position + label)
  frame     : id of the drawn frame (box) the segment sits in
Usage:  python -I pipeline/extract_pages.py [first_page last_page]
"""
import json, os, sys, collections, unicodedata, re
import pymupdf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # own code only; run with -I
from bidi_visual import visual_to_logical, is_mark

pymupdf.TOOLS.mupdf_display_errors(False)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'private', 'source')
OUT = os.path.join(ROOT, 'private', 'work', 'pages')
PARTS = [(1, 1, 80), (2, 81, 160), (3, 161, 240), (4, 241, 314)]

ROW_TOL = 3.2        # pt, baseline clustering
GAP_SPLIT = 16.0     # pt, horizontal gap that separates two columns/cells in one row
GAP_NEAR_IMAGE = 5.0  # pt, tighter threshold on rows beside a narrow image (caption column vs body column)


def locate(g):
    for p, a, b in PARTS:
        if a <= g <= b:
            return p, g - a
    raise ValueError(g)


def is_decor_image(b, w, h):
    x0, y0, x1, y1 = b
    return y1 < 62 and (x1 < 100 or x0 > 480)       # logos in the page header


def collect_bars(page):
    """thin filled rectangles = underlines and frame sides"""
    bars = []
    for d in page.get_drawings():
        if d.get('fill') is None:
            continue
        r = d['rect']
        t, L = min(r.width, r.height), max(r.width, r.height)
        if t <= 3.0 and L >= 5:
            bars.append({'r': (r.x0, r.y0, r.x1, r.y1), 'thick': t, 'len': L,
                         'horiz': r.width >= r.height, 'fill': tuple(round(c, 2) for c in d['fill'])})
    return bars


def group_frames(bars):
    """Union touching bars into connected groups; a frame is a group that has horizontal AND vertical bars."""
    n = len(bars)
    parent = list(range(n))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def touch(a, b, eps=1.2):
        ax0, ay0, ax1, ay1 = a['r']
        bx0, by0, bx1, by1 = b['r']
        return not (ax1 + eps < bx0 or bx1 + eps < ax0 or ay1 + eps < by0 or by1 + eps < ay0)

    for i in range(n):
        for j in range(i + 1, n):
            if touch(bars[i], bars[j]):
                parent[find(i)] = find(j)
    groups = collections.defaultdict(list)
    for i in range(n):
        groups[find(i)].append(i)
    frames, used = [], set()
    for idxs in groups.values():
        hs = [bars[i] for i in idxs if bars[i]['horiz']]
        vs = [bars[i] for i in idxs if not bars[i]['horiz']]
        if len(hs) >= 2 and len(vs) >= 2:
            x0 = min(b['r'][0] for b in map(lambda i: bars[i], idxs))
            y0 = min(b['r'][1] for b in map(lambda i: bars[i], idxs))
            x1 = max(b['r'][2] for b in map(lambda i: bars[i], idxs))
            y1 = max(b['r'][3] for b in map(lambda i: bars[i], idxs))
            if (x1 - x0) > 25 and (y1 - y0) > 12:
                frames.append({'bbox': (x0, y0, x1, y1), 'color': bars[idxs[0]]['fill'], 'bars': [bars[i] for i in idxs]})
                used.update(idxs)
    frames.sort(key=lambda f: (f['bbox'][1], -f['bbox'][2]))
    for k, f in enumerate(frames):
        f['id'] = f'F{k+1}'
    underlines = [b for i, b in enumerate(bars) if i not in used and b['horiz'] and b['thick'] <= 1.0 and b['len'] <= 400]
    return frames, underlines


def cluster_positions(vals, tol=2.2):
    vals = sorted(vals)
    out = []
    for v in vals:
        if out and v - out[-1][-1] <= tol:
            out[-1].append(v)
        else:
            out.append([v])
    return [sum(c) / len(c) for c in out]


def frame_grid(f):
    """Grid lines of a bordered frame: returns (ys, xs) sorted ascending, or None for a single-cell frame."""
    x0, y0, x1, y1 = f['bbox']
    hy = [((b['r'][1] + b['r'][3]) / 2) for b in f['bars'] if b['horiz'] and b['len'] >= 15]
    vx = [((b['r'][0] + b['r'][2]) / 2) for b in f['bars'] if not b['horiz'] and b['len'] >= 15]
    ys, xs = cluster_positions(hy), cluster_positions(vx)
    if len(ys) >= 2 and len(xs) >= 2 and (len(ys) > 2 or len(xs) > 2):
        return ys, xs
    return None


def extract_chars(page):
    raw = page.get_text('rawdict')
    chars = []
    for b in raw['blocks']:
        if b['type'] != 0:
            continue
        for l in b['lines']:
            dx, dy = l['dir']
            for s in l['spans']:
                bold = bool(s['flags'] & 16) or 'Bold' in s['font']
                ital = bool(s['flags'] & 2)
                sup = bool(s['flags'] & 1)
                for c in s['chars']:
                    ch = c['c']
                    x0, y0, x1, y1 = c['bbox']
                    if ch.isspace() and (x1 - x0) < 0.5:
                        continue                      # spurious zero-width spaces around vowel marks
                    if ch in '​‌‍‎‏‪‫‬‭‮﻿':
                        continue
                    chars.append({'c': ch, 'x0': x0, 'x1': x1, 'y0': y0, 'y1': y1, 'oy': c['origin'][1],
                                  'size': s['size'], 'bold': bold, 'ital': ital, 'sup': sup,
                                  'color': s['color'], 'font': s['font'], 'vertical': abs(dy) > 0.01})
    return chars


def dedupe_overstrike(chars):
    """Some lines are drawn twice with a sub-point offset (fake bold). Keep one copy of identical glyphs."""
    kept, dropped = [], 0
    last = {}
    for c in sorted(chars, key=lambda c: (c['c'], round(c['oy']), c['x0'])):
        key = (c['c'], round(c['oy']))
        prev = last.get(key)
        if prev is not None and abs(prev['x0'] - c['x0']) < 0.8 and abs(prev['size'] - c['size']) < 0.3 and not c['c'].isspace():
            prev['bold'] = prev['bold'] or c['bold']
            dropped += 1
            continue
        last[key] = c
        kept.append(c)
    return kept, dropped


def is_small(c):
    """footnote-reference / label glyphs. The PDF 'superscript' flag is unreliable for 10pt text, so require a small size."""
    return c['size'] < 6.6 or (c['sup'] and c['size'] < 8.0)


def cluster_marks(chars):
    """attach zero-width combining marks to the base glyph with the nearest left edge"""
    bases = [c for c in chars if not is_mark(c['c'])]
    marks = [c for c in chars if is_mark(c['c'])]
    for b in bases:
        b['marks'] = ''
    for m in marks:
        best, bd = None, 1e9
        for b in bases:
            if abs(b['oy'] - m['oy']) > 4:
                continue
            d = abs(b['x0'] - m['x0'])
            if d < bd:
                best, bd = b, d
        if best is not None and bd < 2.0:
            best['marks'] += m['c']
        # unattached marks are dropped silently but counted by caller if needed
    return bases


def split_rows(bases):
    rows = []
    for c in sorted(bases, key=lambda c: c['oy']):
        small_sup = is_small(c)
        placed = False
        for r in rows:
            if abs(r['oy'] - c['oy']) <= ROW_TOL or (small_sup and abs(r['oy'] - c['oy']) <= 8 and r['x0'] - 3 <= c['x0'] <= r['x1'] + 3):
                r['chars'].append(c)
                if not small_sup:
                    r['n'] += 1
                    r['oy'] += (c['oy'] - r['oy']) / r['n']
                r['x0'] = min(r['x0'], c['x0']); r['x1'] = max(r['x1'], c['x1'])
                placed = True
                break
        if not placed:
            rows.append({'oy': c['oy'], 'n': 1, 'chars': [c], 'x0': c['x0'], 'x1': c['x1']})
    return rows


def split_segments(row, vlines=(), near_image=False):
    """vlines: (x, y0, y1) vertical table borders; text on opposite sides of one is never merged."""
    cs = sorted(row['chars'], key=lambda c: (c['x0'] + c['x1']) / 2)
    segs, cur = [], [cs[0]]
    oy = row['oy']

    def crosses(a, b):
        ma, mb = (a['x0'] + a['x1']) / 2, (b['x0'] + b['x1']) / 2
        return any(ma < x < mb and y0 - 2 <= oy <= y1 + 2 for x, y0, y1 in vlines)
    for c in cs[1:]:
        gap_limit = GAP_NEAR_IMAGE if near_image else GAP_SPLIT
        if crosses(cur[-1], c) or (c['x0'] - cur[-1]['x1'] > gap_limit and not c['c'].isspace() and not cur[-1]['c'].isspace()):
            segs.append(cur); cur = [c]
        else:
            cur.append(c)
    segs.append(cur)
    return segs


def build_segment(chs):
    """chs: base chars (with .marks) in visual order. returns text + per-char style arrays in logical order"""
    units = []
    for c in chs:
        units.append((c['c'] + c['marks'], c))
    logical = visual_to_logical(units)
    # drop leading/trailing whitespace
    while logical and logical[0][0].isspace():
        logical.pop(0)
    while logical and logical[-1][0].isspace():
        logical.pop()
    text_parts, style = [], []
    fn_refs = []
    pos = 0
    for t, c in logical:
        small = is_small(c)
        if small:                                  # superscript / tiny glyph = footnote reference mark or label
            fn_refs.append({'pos': pos, 'label': t})
            continue
        text_parts.append(t)
        for _ in t:
            style.append((c['bold'], c['ital'], c['size'], c['color']))
        pos += len(t)
    return ''.join(text_parts), style, fn_refs, [c for _, c in logical]


def ranges(flags):
    out, s = [], None
    for i, f in enumerate(flags + [False]):
        if f and s is None:
            s = i
        elif not f and s is not None:
            out.append([s, i]); s = None
    return out


def dominant_size(chars):
    cnt = collections.Counter()
    for c in chars:
        if c['c'].isalnum():
            cnt[round(c['size'], 1)] += 1
    if not cnt:
        for c in chars:
            cnt[round(c['size'], 1)] += 1
    return cnt.most_common(1)[0][0] if cnt else 0


def point_in(b, f, pad=2.0):
    return f[0] - pad <= (b[0] + b[2]) / 2 <= f[2] + pad and f[1] - pad <= (b[1] + b[3]) / 2 <= f[3] + pad


_DOCS = {}


def process_page(g):
    p, idx = locate(g)
    if p not in _DOCS:
        _DOCS[p] = pymupdf.open(os.path.join(SRC, f'part{p}.pdf'))
    page = _DOCS[p][idx]
    W, H = page.rect.width, page.rect.height
    chars = extract_chars(page)
    chars, n_dup = dedupe_overstrike(chars)
    bases = cluster_marks(chars)
    rows = split_rows(bases)
    bars = collect_bars(page)
    frames, underline_bars = group_frames(bars)

    vlines = []
    for f in frames:
        g_ = frame_grid(f)
        if g_:
            vlines += [(x, f['bbox'][1], f['bbox'][3]) for x in g_[1]]
        else:
            # single-cell frame (photo caption / box): text on opposite sides of its border must never merge into one line
            vlines += [(f['bbox'][0], f['bbox'][1], f['bbox'][3]), (f['bbox'][2], f['bbox'][1], f['bbox'][3])]
    # narrow (side) images: text directly under them is their caption - never merge it into the paragraph beside the image
    img_pre = []
    for info in page.get_image_info(xrefs=True):
        b = info['bbox']
        if is_decor_image(b, info['width'], info['height']) or (b[2] - b[0]) < 6:
            continue
        a_ = (b[2] - b[0]) * (b[3] - b[1]) / (W * H)
        if (a_ >= 0.02 or info['width'] * info['height'] >= 30000) and (b[2] - b[0]) <= 260:
            img_pre.append(b)
    zones = [(b[0] - 6, b[1] - 2, b[2] + 6, b[3] + 62) for b in img_pre]
    segments = []
    for row in rows:
        near = any(z[1] <= row['oy'] <= z[3] for z in zones)
        row_segs = split_segments(row, vlines, near)
        for chs in row_segs:
            text, style, fn_refs, ordered = build_segment(chs)
            if not text.strip() and not fn_refs:
                continue
            real = [c for c in chs if not is_small(c)] or chs
            bb = (min(c['x0'] for c in real), min(c['y0'] for c in real), max(c['x1'] for c in real), max(c['y1'] for c in real))
            dom = dominant_size(real)
            colors = collections.Counter(c['color'] for c in real if c['c'].isalnum())
            color = colors.most_common(1)[0][0] if colors else 0
            bold_flags = [s[0] for s in style]
            # underline detection: a thin bar just below the glyph row, overlapping the glyph x-range
            ul_flags = [False] * len(style)
            uchars = []   # (char index in text, base char)
            ti = 0
            for c in ordered:
                if is_small(c):
                    continue
                uchars.append((ti, c))
                ti += len(c['c'] + c['marks'])
            for bar in underline_bars:
                bx0, by0, bx1, by1 = bar['r']
                for ti2, c in uchars:
                    if c['y1'] - 2.5 <= by0 <= c['y1'] + 3.0 and bx0 - 1 <= (c['x0'] + c['x1']) / 2 <= bx1 + 1 and not c['c'].isspace():
                        for k in range(len(c['c'] + c['marks'])):
                            if ti2 + k < len(ul_flags):
                                ul_flags[ti2 + k] = True
            seg = {
                '_multi': len(row_segs) >= 2,
                'bbox': [round(v, 1) for v in bb],
                'text': text,
                'size': dom,
                'color': f'{color:06x}',
                'boldShare': round(sum(bold_flags) / max(1, sum(1 for ch in text if not ch.isspace())), 2) if text else 0,
                'emphasis': ranges(bold_flags),
                'underline': ranges(ul_flags),
                'fnRefs': fn_refs,
                'allBold': bool(bold_flags) and all(bold_flags),
                'table': None,
                'fonts': sorted({c['font'] for c in real}),
            }
            segments.append(seg)

    # --- caption zones (text hugging a narrow image) ------------------------------------------
    for sg in segments:
        sg['zone'] = None
        if not sg.pop('_multi', False):
            continue                      # one continuous line: body text, never a caption
        for zi, z in enumerate(zones):
            bb = sg['bbox']
            if bb[0] >= z[0] - 1 and bb[2] <= z[2] + 1 and bb[1] >= z[1] and bb[3] <= z[3] + 2 and sg['size'] <= 12.5:
                sg['zone'] = zi
                break
    # --- assign frames -----------------------------------------------------------------
    for s in segments:
        s['frame'] = None
        for f in frames:
            if point_in(s['bbox'], f['bbox']):
                s['frame'] = f['id']
                break
    frame_text = collections.defaultdict(str)
    for s in segments:
        if s['frame']:
            frame_text[s['frame']] += ' ' + s['text']
    # --- images ----------------------------------------------------------------------------
    images = []
    for info in page.get_image_info(xrefs=True):
        b = info['bbox']
        if is_decor_image(b, info['width'], info['height']):
            continue
        if (b[2] - b[0]) < 6 or (b[3] - b[1]) < 6:
            continue
        images.append({'bbox': [round(v, 1) for v in b], 'pxW': info['width'], 'pxH': info['height'], 'xref': info.get('xref')})
    k_ = 0
    for im in images:
        a_ = (im['bbox'][2] - im['bbox'][0]) * (im['bbox'][3] - im['bbox'][1]) / (W * H)
        if a_ >= 0.02 or im['pxW'] * im['pxH'] >= 30000:
            k_ += 1
            im['figId'] = f'p{g:03d}-f{k_}'
    # --- roles ----------------------------------------------------------------------------
    for s in segments:
        sz, col = s['size'], s['color']
        if col == 'ffffff' and s['bbox'][1] > 800:
            s['role'] = 'pagenum'
        elif s['frame'] and 'למחשבה' in frame_text[s['frame']] and sz <= 10.6:
            s['role'] = 'thought'
        elif sz >= 17:
            s['role'] = 'heading1'
        elif 15.5 <= sz < 17:
            s['role'] = 'heading2'
        elif 13.5 <= sz < 15.5:
            s['role'] = 'heading3'
        elif col in ('800000', '983634') and 10 <= sz <= 11.2 and not s['frame']:
            s['role'] = 'epigraph'
        elif s['frame'] and sz <= 8.4:
            s['role'] = 'caption'
        elif sz <= 8.4:
            s['role'] = 'caption' if s['frame'] else 'small'
        elif s.get('zone') is not None and sz <= 12.5 and not s.get('table'):
            s['role'] = 'caption'
        elif s['frame'] and sz <= 9.6:
            s['role'] = 'caption'          # real footnotes are never framed; framed small text is a photo caption
        elif sz <= 9.6:
            s['role'] = 'footnote'
        elif s['frame']:
            s['role'] = 'box'
        elif sz <= 10.6:
            s['role'] = 'small'
        else:
            s['role'] = 'body'
        if s['role'] == 'body' and len(s['text']) < 90 and re.match(r'^\d+(\.\d+){1,4}\s', s['text']):
            s['role'] = 'heading3'      # numbered sub-heading printed at body size (e.g. president/PM names)
    for sg in segments:
        if sg.get('table'):
            sg['role'] = 'table'
    # the bold box label sits mid-line inside the frame: detach it so it does not splice into the sentence
    for s in segments:
        s['label'] = None
        if s['role'] == 'thought':
            for a, b in s['emphasis']:
                if s['text'][a:b].strip() == 'למחשבה':
                    s['label'] = 'למחשבה'
                    left, right = s['text'][:a].rstrip(), s['text'][b:].lstrip()
                    s['text'] = (left + ' ' + right).strip()
                    s['emphasis'] = []
                    s['underline'] = []   # offsets no longer valid; thought boxes are not exam text
                    break
    # reading order: top-to-bottom; within a row right-to-left
    segments.sort(key=lambda s: (round(s['bbox'][1] / 6), -s['bbox'][2]))
    for i, s in enumerate(segments):
        s['id'] = f'p{g:03d}.s{i+1:03d}'
    printed = None
    for s in segments:
        if s['role'] == 'pagenum':
            m = re.fullmatch(r'\d+', s['text'].strip())
            if m:
                printed = int(s['text'].strip())
    # tables from the book's own border lines: cells ordered right-to-left (Hebrew reading order)
    tables = []
    tid = 0
    for f in frames:
        grid = frame_grid(f)
        if not grid:
            continue
        ys, xs = grid
        tid += 1
        nrows, ncols = len(ys) - 1, len(xs) - 1
        cells = [[[] for _ in range(ncols)] for _ in range(nrows)]
        for sg in segments:
            if sg['frame'] != f['id']:
                continue
            cx, cy = (sg['bbox'][0] + sg['bbox'][2]) / 2, (sg['bbox'][1] + sg['bbox'][3]) / 2
            ri = next((i for i in range(nrows) if ys[i] - 1.5 <= cy < ys[i + 1] + 1.5), None)
            cj = next((j for j in range(ncols) if xs[j] - 1.5 <= cx < xs[j + 1] + 1.5), None)
            if ri is None or cj is None:
                continue
            lc = ncols - 1 - cj                      # logical (right-to-left) column index
            sg['table'] = {'id': f'T{tid}', 'r': ri, 'c': lc}
            cells[ri][lc].append(sg)
        txt = []
        for r in cells:
            txt.append([' '.join(x['text'] for x in sorted(cell, key=lambda x: (round(x['bbox'][1] / 4), -x['bbox'][2]))).strip() for cell in r])
        tables.append({'id': f'T{tid}', 'frame': f['id'], 'bbox': [round(v, 1) for v in f['bbox']], 'rows': nrows, 'cols': ncols, 'cells': txt})
        f['isTable'] = True
    return {
        'page': g, 'part': p, 'partIndex': idx + 1, 'printedPage': printed,
        'size': [round(W, 1), round(H, 1)],
        'segments': segments,
        'frames': [{'id': f['id'], 'bbox': [round(v, 1) for v in f['bbox']], 'color': f['color'], 'isTable': bool(f.get('isTable'))} for f in frames],
        'images': images,
        'tables': tables,
        'charCount': sum(len(s['text']) for s in segments),
        'overstrikeDuplicatesDropped': n_dup,
    }


def main():
    a = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    b = int(sys.argv[2]) if len(sys.argv) > 2 else 314
    os.makedirs(OUT, exist_ok=True)
    for g in range(a, b + 1):
        data = process_page(g)
        with open(os.path.join(OUT, f'p{g:03d}.json'), 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
    print(f'extracted pages {a}-{b} -> {OUT}')


if __name__ == '__main__':
    main()
