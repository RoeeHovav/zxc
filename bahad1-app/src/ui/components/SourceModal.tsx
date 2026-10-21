import { useEffect, useState } from 'react';
import { locateQuote } from '../../domain/normalize';
import type { SourceRef } from '../../domain/types';
import { figureUrl, loadSources, pageUrl, type SourceUnit } from '../../content/loader';
import { useApp } from '../../app/store';
import { ReadAloud, textSegments } from '../../app/speech';
import { ImageViewer } from './ImageViewer';
import { Modal } from './Modal';

export { Modal };

/** Shows the EXACT supporting passage (not the whole page) with the cited quote highlighted; the original page is one click away. */
export function SourceModal({ refs, onClose }: { refs: SourceRef[]; onClose: () => void }) {
  const { manifest } = useApp();
  const [units, setUnits] = useState<Record<string, SourceUnit>>({});
  const [view, setView] = useState<{ kind: 'page' | 'figure'; src: string; label: string } | null>(null);

  useEffect(() => {
    let alive = true;
    const chapterOf = (page: number) => manifest?.chapters.find((c) => page >= c.firstPage && page <= c.lastPage)?.id;
    const ids = [...new Set(refs.map((r) => chapterOf(r.page)).filter((x): x is string => !!x))];
    Promise.all(ids.map((id) => loadSources(id).catch(() => [] as SourceUnit[]))).then((all) => {
      if (!alive) return;
      const m: Record<string, SourceUnit> = {};
      all.flat().forEach((u) => { m[u.id] = u; });
      setUnits(m);
    });
    return () => { alive = false; };
  }, [refs, manifest]);

  if (view) {
    return (
      <Modal title={view.label} onClose={() => setView(null)} wide>
        <ImageViewer src={view.src} alt={view.label} />
        <p className="muted small" style={{ marginTop: 8 }}>העתק מדויק של העמוד/האיור המקורי בחוברת. אפשר להגדיל ולגרור.</p>
      </Modal>
    );
  }
  return (
    <Modal title="המקור בחוברת" onClose={onClose}>
      <div className="stack">
        {refs.map((r, i) => {
          const u = units[r.unit];
          const range = u ? locateQuote(u.text, r.quote) : null;
          return (
            <div key={`${r.unit}-${i}`} className="stack tight" data-testid="source-ref">
              <div className="row"><span className="chip accent">עמוד <span className="num">{r.page}</span></span>{r.transcribed && <span className="chip warn">טקסט שנקרא מתוך תמונה</span>}</div>
              <div className="src-text">
                {u && range ? (<>{u.text.slice(0, range[0])}<mark className="q">{u.text.slice(range[0], range[1])}</mark>{u.text.slice(range[1])}</>) : (u?.text ?? r.quote)}
              </div>
              <div className="row">
                {u && <ReadAloud owner={`src:${r.unit}:${i}`} label="הקראת הקטע" build={() => textSegments(u.text, `src:${r.unit}`)} testId="read-source" />}
                <button className="btn" type="button" onClick={() => setView({ kind: 'page', src: pageUrl(r.page), label: `עמוד ${r.page} במקור` })}>הצגת העמוד המקורי</button>
                {r.figure && <button className="btn" type="button" onClick={() => setView({ kind: 'figure', src: figureUrl(r.figure!), label: 'האיור המקורי' })}>הצגת האיור המקורי</button>}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

export function FigureModal({ figureId, onClose }: { figureId: string; onClose: () => void }) {
  return (
    <Modal title="איור מקורי מהחוברת" onClose={onClose} wide>
      <ImageViewer src={figureUrl(figureId)} alt="איור מקורי" />
    </Modal>
  );
}
