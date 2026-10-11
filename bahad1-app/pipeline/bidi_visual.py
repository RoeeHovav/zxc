"""Visual-order -> logical-order reconstruction for Hebrew (RTL paragraph) text.

The source PDFs were produced by a renderer that stores each glyph with its *logical*
Unicode code point but emits glyph runs in an order that does not match logical reading
order (numbers such as "1911-2002" come out as "2002-1911" in the raw text layer).
The reliable ground truth is the x-position of every glyph.  We therefore:

  1. sort glyph clusters left->right (visual order),
  2. classify them (R / L / EN / separators / neutrals),
  3. group number runs and Latin runs, which are displayed left-to-right,
  4. reverse the whole line (RTL paragraph) while keeping those runs intact.

Brackets need no mirroring: the stored code points are the logical ones (verified on p.14).
"""
import unicodedata

R, L, EN, ES, CS, ET, WS, ON = 'R', 'L', 'EN', 'ES', 'CS', 'ET', 'WS', 'ON'


def char_class(ch: str) -> str:
    o = ord(ch)
    if 0x0590 <= o <= 0x05FF or 0xFB1D <= o <= 0xFB4F or 0x0600 <= o <= 0x06FF:
        return R
    if '0' <= ch <= '9':
        return EN
    if ch in '+-−‐‑':
        return ES
    if ch in ',.:/ ':
        # NBSP is WS-like but behaves as CS in numbers; treat as WS below when not between digits
        return CS if ch != ' ' else WS
    if ch in '#$%¢£¥°±‰₪':
        return ET
    if ch.isspace():
        return WS
    if ch.isalpha():
        return L
    return ON


def visual_to_logical(units):
    """units: list of (text, key) in VISUAL left->right order. Each unit is one glyph cluster
    (base char + combining marks). Returns list of (text, key) in LOGICAL order."""
    n = len(units)
    if n == 0:
        return []
    cls = [char_class(u[0][0]) for u in units]

    # --- number runs: EN (+ ES/CS between ENs) (+ ET adjacent) ---------------------------
    num = [False] * n
    for i in range(n):
        if cls[i] == EN:
            num[i] = True
    for i in range(1, n - 1):
        if cls[i] in (ES, CS) and cls[i - 1] == EN and cls[i + 1] == EN:
            num[i] = True
    for i in range(n):
        if cls[i] == ET:
            if (i > 0 and num[i - 1] and cls[i - 1] == EN) or (i + 1 < n and cls[i + 1] == EN):
                num[i] = True
    # --- LTR (Latin) runs ---------------------------------------------------------------
    ltr = [False] * n
    for i in range(n):
        if cls[i] == L:
            ltr[i] = True
    # digits glued to Latin letters (M16, A2) join the Latin run
    changed = True
    while changed:
        changed = False
        for i in range(n):
            if num[i] and not ltr[i]:
                if (i > 0 and ltr[i - 1] and cls[i - 1] == L) or (i + 1 < n and ltr[i + 1] and cls[i + 1] == L):
                    ltr[i] = True
                    changed = True
    # separators / spaces between two Latin items join the run (e.g. "M16 A2", "e-mail")
    for _ in range(3):
        for i in range(1, n - 1):
            if not ltr[i] and not num[i] and cls[i] in (WS, ES, CS, ON) and ltr[i - 1] and ltr[i + 1]:
                # do not glue across an ON that is a quote/bracket-like char at run boundary
                if cls[i] == ON and units[i][0][0] in '()[]{}"\'“”״':
                    continue
                ltr[i] = True
    inrun = [num[i] or ltr[i] for i in range(n)]

    # --- build items in visual order: either single RTL-level char or an LTR run ----------
    items = []
    i = 0
    while i < n:
        if inrun[i]:
            j = i
            while j < n and inrun[j]:
                j += 1
            # numbers separated by whitespace are *separate* runs unless Latin joined them:
            # split the span at WS between two non-Latin number runs
            seg_start = i
            k = i
            while k < j:
                if cls[k] == WS and not ltr[k]:
                    items.append(('run', units[seg_start:k]))
                    items.append(('one', units[k]))
                    seg_start = k + 1
                k += 1
            if seg_start < j:
                items.append(('run', units[seg_start:j]))
            i = j
        else:
            items.append(('one', units[i]))
            i += 1
    # --- reverse for RTL paragraph -------------------------------------------------------
    out = []
    for kind, payload in reversed(items):
        if kind == 'run':
            out.extend(payload)
        else:
            out.append(payload)
    return out


def is_mark(ch: str) -> bool:
    return unicodedata.category(ch) in ('Mn', 'Me')
