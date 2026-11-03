import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { api, PageLayout } from "../api";
import { useStore } from "../store";

export type Ref2 = [number, number]; // [page, word]

export interface Selection {
  anchor: Ref2;
  focus: Ref2;
}

export interface PageHighlight {
  word?: number;
  sentence?: number[];
  select?: [number, number]; // inclusive word range on this page
  search?: [number, number][];
  bookmarks?: number[];
}

export interface ViewerHandle {
  scrollToPage: (page: number, y?: number, smooth?: boolean) => void;
  scrollToWord: (page: number, word: number, force?: boolean) => void;
  layout: (page: number) => Promise<PageLayout>;
  cachedLayout: (page: number) => PageLayout | undefined;
  isWordVisible: (page: number, word: number) => boolean;
}

interface Props {
  docId: string;
  sizes: [number, number][];
  zoom: number;
  highlights: Map<number, PageHighlight>;
  onPageChange: (page: number) => void;
  onSelectStart: (ref: Ref2) => void;
  onSelectMove: (ref: Ref2) => void;
  onSelectEnd: (ref: Ref2, ev: React.MouseEvent) => void;
  onWordDouble: (ref: Ref2) => void;
  onWordContext: (ref: Ref2, ev: React.MouseEvent) => void;
  onUserScroll: () => void;
  onLayout?: (page: number, layout: PageLayout) => void;
}

function cmp(a: Ref2, b: Ref2) {
  return a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1];
}
export function orderSel(s: Selection): [Ref2, Ref2] {
  return cmp(s.anchor, s.focus) <= 0 ? [s.anchor, s.focus] : [s.focus, s.anchor];
}

/** Merge word boxes that sit on the same text line into one rectangle. */
export function lineRects(layout: PageLayout, words: number[]): [number, number, number, number][] {
  if (!words.length) return [];
  const lineOf = new Map<number, number>();
  layout.lines.forEach(([a, b], li) => {
    for (let w = a; w < b; w++) lineOf.set(w, li);
  });
  const groups = new Map<number, [number, number, number, number]>();
  for (const w of words) {
    const wd = layout.words[w];
    if (!wd) continue;
    const li = lineOf.get(w) ?? -1 - w;
    const r = groups.get(li);
    if (!r) groups.set(li, [wd[1], wd[2], wd[3], wd[4]]);
    else groups.set(li, [Math.min(r[0], wd[1]), Math.min(r[1], wd[2]), Math.max(r[2], wd[3]), Math.max(r[3], wd[4])]);
  }
  return Array.from(groups.values());
}

const Page = memo(function Page(props: {
  docId: string;
  n: number;
  w: number;
  h: number;
  zoom: number;
  visible: boolean;
  layout?: PageLayout;
  hl?: PageHighlight;
  ensureLayout: (n: number) => void;
  setRef: (n: number, el: HTMLDivElement | null) => void;
}) {
  const { docId, n, w, h, zoom, visible, layout, hl, ensureLayout, setRef } = props;
  const t = useStore((s) => s.t);
  const [imgLoaded, setImgLoaded] = useState(false);
  useEffect(() => {
    if (visible) ensureLayout(n);
  }, [visible, n]);
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const scale = Math.min(4, Math.max(0.5, Math.round(zoom * dpr * 4) / 4));
  const W = w * zoom;
  const H = h * zoom;
  const rect = (r: [number, number, number, number], cls: string, key: string | number, pad = 1) => (
    <div key={key} className={`hl ${cls}`} style={{ left: r[0] * zoom - pad, top: r[1] * zoom - pad, width: (r[2] - r[0]) * zoom + 2 * pad, height: (r[3] - r[1]) * zoom + 2 * pad }} />
  );
  return (
    <div className="page" ref={(el) => setRef(n, el)} data-page={n} style={{ width: W, height: H }}>
      {visible && (
        <>
          <img src={api.pageImageUrl(docId, n, scale)} alt={`${t.page} ${n + 1}`} draggable={false} onLoad={() => setImgLoaded(true)} />
          {!imgLoaded && <div className="page-loading">{n + 1}</div>}
          {layout && (
            <div className="overlay">
              {layout.images
                .filter((im) => im[4] === "figure")
                .map((im, i) => (
                  <div key={`f${i}`} className="figure-mark" style={{ left: im[0] * zoom, top: im[1] * zoom, width: (im[2] - im[0]) * zoom, height: (im[3] - im[1]) * zoom }} title="Figure — not narrated">
                    <span>Figure</span>
                  </div>
                ))}
              {hl?.search?.map(([a, b], i) => lineRects(layout, range(a, b)).map((r, j) => rect(r, "search", `s${i}-${j}`)))}
              {hl?.sentence && lineRects(layout, hl.sentence).map((r, i) => rect(r, "sentence", `se${i}`, 2))}
              {hl?.select && lineRects(layout, range(hl.select[0], hl.select[1])).map((r, i) => rect(r, "select", `sl${i}`))}
              {hl?.word != null && layout.words[hl.word] && rect([layout.words[hl.word][1], layout.words[hl.word][2], layout.words[hl.word][3], layout.words[hl.word][4]], "word", "w", 1.5)}
              {layout.words.map((wd, i) => (
                <div key={i} className="w" data-p={n} data-w={i} style={{ left: wd[1] * zoom, top: wd[2] * zoom, width: Math.max(2, (wd[3] - wd[1]) * zoom), height: Math.max(2, (wd[4] - wd[2]) * zoom) }} />
              ))}
            </div>
          )}
          {layout?.source === "ocr" && <div className="page-badge" title={t.ocrPage}>OCR</div>}
          {layout?.source === "needs_ocr" && <div className="page-badge" title={t.needsOcr}>⚠ {t.needsOcr}</div>}
        </>
      )}
      <div className="pnum">{n + 1}</div>
    </div>
  );
});

function range(a: number, b: number) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

const Viewer = forwardRef<ViewerHandle, Props>(function Viewer(props, ref) {
  const { docId, sizes, zoom, highlights } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const pageEls = useRef<(HTMLDivElement | null)[]>([]);
  const [visible, setVisible] = useState<Set<number>>(new Set([0, 1]));
  const layouts = useRef(new Map<number, PageLayout>());
  const pending = useRef(new Map<number, Promise<PageLayout>>());
  const [, setLayoutVersion] = useState(0);
  const selecting = useRef(false);
  const programmatic = useRef(0);

  const loadLayout = useCallback(
    (n: number): Promise<PageLayout> => {
      const c = layouts.current.get(n);
      if (c) return Promise.resolve(c);
      let p = pending.current.get(n);
      if (!p) {
        p = api.layout(docId, n).then((l) => {
          layouts.current.set(n, l);
          pending.current.delete(n);
          setLayoutVersion((v) => v + 1);
          props.onLayout?.(n, l);
          return l;
        });
        p.catch(() => pending.current.delete(n));
        pending.current.set(n, p);
      }
      return p;
    },
    [docId]
  );
  const ensureLayout = useCallback((n: number) => void loadLayout(n).catch(() => undefined), [loadLayout]);
  const setRef = useCallback((n: number, el: HTMLDivElement | null) => {
    pageEls.current[n] = el;
  }, []);

  // visibility tracking (virtualization)
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const n = Number((e.target as HTMLElement).dataset.page);
            if (e.isIntersecting) next.add(n);
            else next.delete(n);
          }
          return next;
        });
      },
      { root, rootMargin: "1400px 0px" }
    );
    pageEls.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [sizes.length, zoom]);

  // current page = page under the viewport's upper third
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const mid = root.scrollTop + root.clientHeight * 0.33;
        let lo = 0,
          hi = pageEls.current.length - 1,
          best = 0;
        while (lo <= hi) {
          const m = (lo + hi) >> 1;
          const el = pageEls.current[m];
          if (!el) break;
          if (el.offsetTop <= mid) {
            best = m;
            lo = m + 1;
          } else hi = m - 1;
        }
        props.onPageChange(best);
      });
    };
    root.addEventListener("scroll", on, { passive: true });
    const user = () => {
      if (Date.now() - programmatic.current > 400) props.onUserScroll();
    };
    root.addEventListener("wheel", user, { passive: true });
    root.addEventListener("touchmove", user, { passive: true });
    on();
    return () => {
      root.removeEventListener("scroll", on);
      root.removeEventListener("wheel", user);
      root.removeEventListener("touchmove", user);
    };
  }, [props.onPageChange, props.onUserScroll]);

  // keep the same page in view when zoom changes
  const prevZoom = useRef(zoom);
  useEffect(() => {
    const root = scroller.current;
    if (!root || prevZoom.current === zoom) return;
    const ratio = zoom / prevZoom.current;
    root.scrollTop = root.scrollTop * ratio;
    prevZoom.current = zoom;
  }, [zoom]);

  const scrollTo = (top: number, smooth: boolean) => {
    const root = scroller.current;
    if (!root) return;
    programmatic.current = Date.now();
    root.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
  };

  useImperativeHandle(ref, () => ({
    scrollToPage(page, y, smooth = false) {
      const el = pageEls.current[page];
      if (!el) return;
      scrollTo(el.offsetTop - 12 + (y != null ? y * zoom - 60 : 0), smooth);
    },
    scrollToWord(page, word, force = false) {
      const root = scroller.current;
      const el = pageEls.current[page];
      if (!root || !el) return;
      const l = layouts.current.get(page);
      const y = l?.words[word] ? l.words[word][2] * zoom : 0;
      const top = el.offsetTop + y;
      const viewTop = root.scrollTop;
      const vh = root.clientHeight;
      if (force || top < viewTop + vh * 0.12 || top > viewTop + vh * 0.72) scrollTo(top - vh * 0.3, Math.abs(top - viewTop) < vh * 3);
    },
    layout: loadLayout,
    cachedLayout: (p) => layouts.current.get(p),
    isWordVisible(page, word) {
      const root = scroller.current;
      const el = pageEls.current[page];
      const l = layouts.current.get(page);
      if (!root || !el || !l?.words[word]) return true;
      const top = el.offsetTop + l.words[word][2] * zoom;
      return top >= root.scrollTop && top <= root.scrollTop + root.clientHeight;
    },
  }));

  const refFromEvent = (e: React.MouseEvent): Ref2 | null => {
    const el = (e.target as HTMLElement).closest(".w") as HTMLElement | null;
    if (!el) return null;
    return [Number(el.dataset.p), Number(el.dataset.w)];
  };

  return (
    <div
      className="viewer"
      ref={scroller}
      data-testid="viewer"
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        const r = refFromEvent(e);
        if (r) {
          selecting.current = true;
          props.onSelectStart(r);
          e.preventDefault();
        }
      }}
      onMouseMove={(e) => {
        if (!selecting.current || !(e.buttons & 1)) return;
        const r = refFromEvent(e);
        if (r) props.onSelectMove(r);
      }}
      onMouseUp={(e) => {
        if (!selecting.current) return;
        selecting.current = false;
        const r = refFromEvent(e);
        props.onSelectEnd(r || [-1, -1], e);
      }}
      onDoubleClick={(e) => {
        const r = refFromEvent(e);
        if (r) props.onWordDouble(r);
      }}
      onContextMenu={(e) => {
        const r = refFromEvent(e);
        if (r) {
          e.preventDefault();
          props.onWordContext(r, e);
        }
      }}
    >
      <div className="pages">
        {sizes.map(([w, h], n) => (
          <Page
            key={n}
            docId={docId}
            n={n}
            w={w}
            h={h}
            zoom={zoom}
            visible={visible.has(n)}
            layout={visible.has(n) ? layouts.current.get(n) : undefined}
            hl={highlights.get(n)}
            ensureLayout={ensureLayout}
            setRef={setRef}
          />
        ))}
      </div>
    </div>
  );
});

export default Viewer;
