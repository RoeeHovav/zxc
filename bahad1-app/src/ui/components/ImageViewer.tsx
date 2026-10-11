import { useCallback, useEffect, useRef, useState } from 'react';

/** Zoom / pan viewer for ORIGINAL book images (pages or figures). Mouse wheel + drag, pinch / touch drag, buttons, keyboard. */
export function ImageViewer({ src, alt }: { src: string; alt: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ x: 0, y: 0, k: 1 });
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const last = useRef<{ d: number; cx: number; cy: number } | null>(null);

  const fit = useCallback((w = nat.w, h = nat.h) => {
    const b = box.current;
    if (!b || !w) return;
    const k = Math.min(b.clientWidth / w, b.clientHeight / h);
    setT({ k, x: (b.clientWidth - w * k) / 2, y: (b.clientHeight - h * k) / 2 });
  }, [nat.h, nat.w]);

  const zoomAt = (cx: number, cy: number, f: number) => setT((p) => {
    const k = Math.min(8, Math.max(0.1, p.k * f));
    const r = k / p.k;
    return { k, x: cx - (cx - p.x) * r, y: cy - (cy - p.y) * r };
  });

  useEffect(() => { setT({ x: 0, y: 0, k: 1 }); }, [src]);

  return (
    <div>
      <div className="viewer-tools">
        <button className="btn" type="button" onClick={() => { const b = box.current!; zoomAt(b.clientWidth / 2, b.clientHeight / 2, 1.3); }} aria-label="הגדלה">＋</button>
        <button className="btn" type="button" onClick={() => { const b = box.current!; zoomAt(b.clientWidth / 2, b.clientHeight / 2, 1 / 1.3); }} aria-label="הקטנה">－</button>
        <button className="btn" type="button" onClick={() => fit()}>התאמה למסך</button>
        <button className="btn" type="button" onClick={() => { const b = box.current!; setT({ k: 1, x: (b.clientWidth - nat.w) / 2, y: 8 }); }}>100%</button>
      </div>
      <div
        ref={box} className="viewer" data-testid="image-viewer"
        onWheel={(e) => { e.preventDefault(); const r = box.current!.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 1 / 1.15); }}
        onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); }}
        onPointerUp={(e) => { pts.current.delete(e.pointerId); last.current = null; }}
        onPointerCancel={(e) => { pts.current.delete(e.pointerId); last.current = null; }}
        onPointerMove={(e) => {
          const p = pts.current.get(e.pointerId);
          if (!p) return;
          const prev = { ...p };
          pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const all = [...pts.current.values()];
          if (all.length === 1) setT((s) => ({ ...s, x: s.x + (e.clientX - prev.x), y: s.y + (e.clientY - prev.y) }));
          else if (all.length === 2) {
            const d = Math.hypot(all[0].x - all[1].x, all[0].y - all[1].y);
            const r = box.current!.getBoundingClientRect();
            const cx = (all[0].x + all[1].x) / 2 - r.left, cy = (all[0].y + all[1].y) / 2 - r.top;
            if (last.current) zoomAt(cx, cy, d / last.current.d);
            last.current = { d, cx, cy };
          }
        }}
        onDoubleClick={(e) => { const r = box.current!.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, 1.8); }}
        tabIndex={0}
        onKeyDown={(e) => {
          const b = box.current!;
          if (e.key === '+' || e.key === '=') zoomAt(b.clientWidth / 2, b.clientHeight / 2, 1.2);
          else if (e.key === '-') zoomAt(b.clientWidth / 2, b.clientHeight / 2, 1 / 1.2);
          else if (e.key === 'ArrowLeft') setT((s) => ({ ...s, x: s.x + 40 })); else if (e.key === 'ArrowRight') setT((s) => ({ ...s, x: s.x - 40 }));
          else if (e.key === 'ArrowUp') setT((s) => ({ ...s, y: s.y + 40 })); else if (e.key === 'ArrowDown') setT((s) => ({ ...s, y: s.y - 40 }));
        }}
      >
        <img src={src} alt={alt} draggable={false} style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})` }}
          onLoad={(e) => { const w = e.currentTarget.naturalWidth, h = e.currentTarget.naturalHeight; setNat({ w, h }); fit(w, h); }} />
      </div>
    </div>
  );
}
