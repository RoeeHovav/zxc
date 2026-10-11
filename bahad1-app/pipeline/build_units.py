"""Stage 2 - build the unified source index from the per-page extraction.

Reads  private/work/pages/p*.json
Writes private/work/source/units.jsonl          one record per citable source unit
       private/work/source/pages_index.json     one record per global page (1..314)
       private/work/source/manifest.json        the four PDF parts (sha256, pages) + chapter map
       private/work/source/chapters/chNN.txt    human/agent readable chapter dumps

Scope policy (from the book's own preface, p.12):
  core                 main text, headings, bold/underlined terms, captions, tables, epigraph quotes
  supplementary        'questions for thought' boxes (kept; no questions are generated from them)
  excluded_footnote    footnotes - the book states they are NOT exam material (kept in the index)
  meta                 front matter pp.1-12 (cover, TOC, preface, copyright)
Usage: python -I pipeline/build_units.py
"""
import json, os, re, hashlib, statistics, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = os.path.join(ROOT, 'private/work/pages')
OUT = os.path.join(ROOT, 'private/work/source')
CH_DIR = os.path.join(OUT, 'chapters')
PARTS = [(1, 1, 80), (2, 81, 160), (3, 161, 240), (4, 241, 314)]

CHAPTERS = [(c['id'], c['title'], c['firstPage'], c['lastPage'])
            for c in json.load(open(os.path.join(ROOT, 'private/chapters.json'), encoding='utf-8'))]   # private: chapter map


def chapter_of(g):
    for cid, title, a, b in CHAPTERS:
        if a <= g <= b:
            return cid
    raise ValueError(g)


def norm_ws(t):
    return re.sub(r'\s+', ' ', t).strip()


def strip_ranges(text, ranges):
    return [norm_ws(text[a:b]) for a, b in ranges if norm_ws(text[a:b])]


def merge_adjacent(spans):
    """merge adjacent bold/underline spans that are only separated by whitespace"""
    out = []
    for s in spans:
        if out and s.strip() and out[-1][-1] == ' ':
            pass
        out.append(s)
    return out


def units_for_page(d):
    g = d['page']
    segs = [s for s in d['segments'] if s['role'] != 'pagenum']
    ch = chapter_of(g)
    meta = g <= 12
    # --- partition: frames / table cells / main flow ------------------------------------
    parts = collections.OrderedDict()
    for s in segs:
        if s.get('table'):
            key = ('table', s['table']['id'])
        elif s['frame']:
            key = ('frame', s['frame'])
        elif s['role'] == 'caption' and s.get('zone') is not None:
            key = ('zone', s['zone'])
        elif s['role'] == 'footnote':
            key = ('footnote', None)
        else:
            key = ('main', None)
        parts.setdefault(key, []).append(s)
    body_ys = sorted(s['bbox'][1] for s in segs if s['role'] == 'body')
    gaps = [b - a for a, b in zip(body_ys, body_ys[1:]) if 8 < b - a < 60]
    pitch = statistics.median(gaps) if gaps else 24.0

    out = []

    def mk(kind, scope, ss, label=None, extra=None):
        ss = sorted(ss, key=lambda s: (round(s['bbox'][1] / 4), -s['bbox'][2]))
        text = norm_ws(' '.join(s['text'] for s in ss))
        if not text:
            return
        bold, ul = [], []
        for s in ss:
            if s['role'] not in ('heading1', 'heading2', 'heading3'):
                bold += strip_ranges(s['text'], s['emphasis'])
            ul += strip_ranges(s['text'], s['underline'])
        u = {
            'kind': kind, 'scope': scope, 'page': g, 'chapter': ch,
            'text': text, 'segments': [s['id'] for s in ss],
            'bbox': [min(s['bbox'][0] for s in ss), min(s['bbox'][1] for s in ss), max(s['bbox'][2] for s in ss), max(s['bbox'][3] for s in ss)],
            'boldTerms': bold, 'underlinedTerms': ul,
            'fnRefs': [r['label'] for s in ss for r in s['fnRefs'] if r['label'].strip()],
            'y': min(s['bbox'][1] for s in ss),
        }
        if label:
            u['label'] = label
        if extra:
            u.update(extra)
        out.append(u)

    core = 'meta' if meta else 'core'
    for key, ss in parts.items():
        ss = sorted(ss, key=lambda s: (round(s['bbox'][1] / 4), -s['bbox'][2]))
        kind0 = key[0]
        if kind0 == 'table':
            tbl = next(t for t in d['tables'] if t['id'] == key[1])
            for ri, row in enumerate(tbl['cells']):
                rowsegs = [s for s in ss if s['table']['r'] == ri]
                if not any(c for c in row):
                    continue
                mk('table_row', core, rowsegs, extra={'table': key[1], 'row': ri, 'cells': row, 'rtlColumns': True})
            continue
        if kind0 == 'frame':
            roles = {s['role'] for s in ss}
            if 'thought' in roles:
                mk('thought_box', 'meta' if meta else 'supplementary', ss, label='למחשבה', extra={'frame': key[1]})
            elif roles <= {'caption', 'small'}:
                mk('caption', core, ss, extra={'frame': key[1]})
            else:
                mk('box', core, ss, extra={'frame': key[1]})
            continue
        if kind0 == 'zone':
            mk('caption', core, ss, extra={'zone': key[1]})
            continue
        if kind0 == 'footnote':
            cur = []
            for s in ss:
                starts = any(r['pos'] == 0 and r['label'].strip() for r in s['fnRefs'])
                if starts and cur:
                    mk('footnote', 'meta' if meta else 'excluded_footnote', cur)
                    cur = []
                cur.append(s)
            if cur:
                mk('footnote', 'meta' if meta else 'excluded_footnote', cur)
            continue
        # ---- main flow: split into paragraph-like units ----------------------------------------
        cur, cur_role, prev = [], None, None
        lefts = [s['bbox'][0] for s in ss if s['role'] == 'body'] or [60]

        def flush():
            nonlocal cur, cur_role
            if cur:
                role = cur_role
                kind = {'heading1': 'heading', 'heading2': 'heading', 'heading3': 'heading', 'epigraph': 'epigraph',
                        'small': 'note', 'body': 'paragraph', 'box': 'box', 'caption': 'caption'}.get(role, 'paragraph')
                mk(kind, core, cur, extra={'headingLevel': int(role[-1]) if role.startswith('heading') else None})
            cur, cur_role = [], None

        for i, s in enumerate(ss):
            role = s['role']
            brk = False
            if cur:
                if role != cur_role and not (cur_role == 'epigraph' and role == 'small') and not (cur_role == 'body' and role == 'small' and False):
                    brk = True
                elif role.startswith('heading'):
                    # wrapped heading / multi-line gate quote: same size and tight leading stay together
                    brk = not (abs(s['size'] - prev['size']) < 0.6 and (s['bbox'][1] - prev['bbox'][1]) <= 1.7 * s['size'])
                else:
                    gap = s['bbox'][1] - prev['bbox'][1]
                    col_left = min(lefts)
                    width_prev = prev['bbox'][2] - prev['bbox'][0]
                    short_prev = (prev['bbox'][0] - col_left) > 0.35 * (prev['bbox'][2] - col_left)
                    ends = re.search(r'[.:?!"״”)]\s*$', prev['text']) is not None
                    clen = sum(len(x['text']) for x in cur)
                    if gap > 1.4 * pitch:
                        brk = True
                    elif short_prev and ends:
                        brk = True
                    elif clen > 1100 and ends:
                        brk = True
            if brk:
                flush()
            cur.append(s)
            cur_role = cur_role or role
            prev = s
        flush()
    out.sort(key=lambda u: (round(u['y'] / 3), -u['bbox'][2]))
    for i, u in enumerate(out):
        u['id'] = f'p{g:03d}.u{i+1:02d}'
        del u['y']
    return out


def main():
    os.makedirs(CH_DIR, exist_ok=True)
    allunits, pages_index = [], []
    for g in range(1, 315):
        d = json.load(open(os.path.join(PAGES, f'p{g:03d}.json'), encoding='utf-8'))
        us = units_for_page(d)
        allunits.extend(us)
        part = next(p for p, a, b in PARTS if a <= g <= b)
        start = next(a for p, a, b in PARTS if p == part)
        pages_index.append({
            'page': g, 'part': part, 'partFile': f'part{part}.pdf', 'partIndex': g - start + 1, 'printedPage': d['printedPage'],
            'chapter': chapter_of(g), 'chars': d['charCount'], 'units': len(us),
            'coreUnits': sum(1 for u in us if u['scope'] == 'core'),
            'footnoteUnits': sum(1 for u in us if u['scope'] == 'excluded_footnote'),
            'images': d['images'], 'frames': len(d['frames']), 'tables': len([t for t in d['tables'] if 'cells' in t]),
        })
    with open(os.path.join(OUT, 'units.jsonl'), 'w', encoding='utf-8') as f:
        for u in allunits:
            f.write(json.dumps(u, ensure_ascii=False) + '\n')
    json.dump(pages_index, open(os.path.join(OUT, 'pages_index.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    manifest = {'book': 'אוגדן_הכנה_לקצונה_נחשון_ומעוז_פברואר_2021', 'totalPages': 314, 'parts': [], 'chapters': [
        {'id': c, 'title': t, 'firstPage': a, 'lastPage': b} for c, t, a, b in CHAPTERS]}
    for p, a, b in PARTS:
        fp = os.path.join(ROOT, 'private/source', f'part{p}.pdf')
        manifest['parts'].append({'file': f'part{p}.pdf', 'sha256': hashlib.sha256(open(fp, 'rb').read()).hexdigest(),
                                  'firstGlobalPage': a, 'lastGlobalPage': b, 'pages': b - a + 1})
    json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    # --- chapter dumps -------------------------------------------------------------------------
    byp = collections.defaultdict(list)
    for u in allunits:
        byp[u['page']].append(u)
    for cid, title, a, b in CHAPTERS:
        lines = [f'# {cid} — {title} — pages {a}-{b}  (global numbering of the 314-page book)\n']
        for g in range(a, b + 1):
            pi = pages_index[g - 1]
            lines.append(f'\n===== PAGE {g}  (part{pi["part"]} p.{pi["partIndex"]}, printed {pi["printedPage"]}) =====')
            for im in pi['images']:
                if im.get('figId'):
                    lines.append(f'[FIGURE {im["figId"]} bbox={im["bbox"]} px={im["pxW"]}x{im["pxH"]} -> private/work/img/figs/{im["figId"]}.png]')
            # footnotes are placed mid-page by the layout and interrupt paragraphs; list them after the main text
            ordered = [u for u in byp[g] if u['scope'] != 'excluded_footnote'] + [u for u in byp[g] if u['scope'] == 'excluded_footnote']
            for u in ordered:
                tag = f'{u["id"]} | {u["kind"]} | {u["scope"]}'
                if u['boldTerms']:
                    tag += ' | BOLD: ' + ' ; '.join(u['boldTerms'])[:200]
                if u['underlinedTerms']:
                    tag += ' | UNDERLINE: ' + ' ; '.join(u['underlinedTerms'])[:200]
                if u['kind'] == 'table_row':
                    lines.append(f'[{tag} | row {u["row"]} of {u["table"]} (cells right-to-left)] ' + ' || '.join(u['cells']))
                else:
                    lines.append(f'[{tag}] {u["text"]}')
        open(os.path.join(CH_DIR, f'{cid}.txt'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    cnt = collections.Counter((u['scope'], u['kind']) for u in allunits)
    print('units:', len(allunits)); print(dict(cnt))


if __name__ == '__main__':
    main()
