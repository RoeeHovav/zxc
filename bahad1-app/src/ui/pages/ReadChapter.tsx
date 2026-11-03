import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ReadAloud } from '../../app/speech';
import { useApp } from '../../app/store';
import { bookSegments, groupBookBlocks, type BookUnit } from '../../domain/bookText';
import { loadSources, pageUrl } from '../../content/loader';
import { OriginalText } from '../components/OriginalText';
import { FigureModal } from '../components/SourceModal';
import { PartialNote } from '../components/Upcoming';
import { Num } from '../components/common';

/** The whole chapter exactly as the book prints it (text or page images), with the narrator; then a test on the chapter. */
export function ReadChapter() {
  const { chapterId = '' } = useParams();
  const { manifest } = useApp();
  const chapter = manifest?.chapters.find((c) => c.id === chapterId);
  const [rows, setRows] = useState<BookUnit[] | null>(null);
  const [view, setView] = useState<'text' | 'pages'>('text');
  const [from, setFrom] = useState<number | null>(null);
  const [fig, setFig] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadSources(chapterId).then((r) => { if (alive) setRows(r as BookUnit[]); }).catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [chapterId]);
  // the chapter's own text units only (not the footnotes/front matter, which are not in the bundle anyway)
  const blocks = useMemo(() => groupBookBlocks(rows ?? [], { pageMarkers: true }), [rows]);
  const pages = useMemo(() => [...new Set((rows ?? []).map((r) => r.page))].sort((a, b) => a - b), [rows]);
  const prefix = `orig:ch:${chapterId}`;
  const startIdx = from === null ? 0 : Math.max(0, blocks.findIndex((b) => b.type === 'page' && b.page === from));

  if (!manifest) return null;
  if (!chapter) return <div className="card stack"><h2>הפרק עדיין אינו זמין</h2><p>הפרק הזה מסומן ״עובדים על זה״.</p><Link to="/library" className="btn">לספרייה</Link></div>;
  const jump = (p: number) => { setFrom(p); document.getElementById(`page-${p}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); };
  return (
    <div className="narrow stack fade-in" data-testid="read-chapter">
      <div className="row between"><Link to={`/library/${chapterId}`} className="btn ghost">‹ לפרק בספרייה</Link><div className="row"><Link to={`/practice?chapter=${chapterId}`} className="btn">תרגול על הפרק</Link><Link to={`/exam?chapter=${chapterId}`} className="btn primary">מבחן על הפרק</Link></div></div>
      <div>
        <h1>{chapter.title}</h1>
        <p className="muted small" style={{ margin: 0 }}>הטקסט כפי שהוא מודפס בחוברת, עמוד אחר עמוד. קוראים (או מאזינים) ואחר כך נבחנים. הערות שוליים אינן מוצגות – לפי החוברת הן אינן חומר למבחן.</p>
      </div>
      <PartialNote chapter={chapter} />
      <div className="row">
        <ReadAloud owner={`chapter:${chapterId}`} icon="🎧" label={from === null ? 'האזנה לפרק' : `האזנה מעמוד ${from}`} testId="listen-chapter" build={() => bookSegments(blocks.slice(startIdx), prefix)} />
        <label className="field" style={{ minWidth: 150 }}>קפיצה לעמוד
          <select className="text-in" value={from ?? ''} onChange={(e) => e.target.value && jump(Number(e.target.value))} data-testid="jump-page">
            <option value="">—</option>
            {pages.map((p) => <option key={p} value={p}>עמוד {p}</option>)}
          </select>
        </label>
        <div className="seg" role="group" aria-label="תצוגה"><button type="button" className={view === 'text' ? 'on' : ''} onClick={() => setView('text')} data-testid="view-text">טקסט</button><button type="button" className={view === 'pages' ? 'on' : ''} onClick={() => setView('pages')} data-testid="view-pages">עמודים מקוריים (תמונה)</button></div>
      </div>
      {rows === null && <div className="empty">טוען…</div>}
      {rows !== null && view === 'text' && <div className="card"><OriginalText blocks={blocks} prefix={prefix} onFigure={setFig} /></div>}
      {rows !== null && view === 'pages' && <div className="stack" data-testid="page-images">{pages.map((p) => <div key={p} className="stack tight"><span className="muted small" id={`page-${p}`}>עמוד <Num>{p}</Num></span><img className="page-img" src={pageUrl(p)} alt={`עמוד ${p} בחוברת`} loading="lazy" /></div>)}</div>}
      <div className="card accent row between">
        <span>סיימתם לקרוא? בדקו את עצמכם.</span>
        <span className="row"><Link to={`/practice?chapter=${chapterId}`} className="btn">תרגול על הפרק</Link><Link to={`/exam?chapter=${chapterId}`} className="btn primary">מבחן על הפרק</Link></span>
      </div>
      {fig && <FigureModal figureId={fig} onClose={() => setFig(null)} />}
    </div>
  );
}
