import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Fact, SourceRef } from '../../domain/types';
import { useApp } from '../../app/store';
import { figureUrl } from '../../content/loader';
import { Num, useChapters } from '../components/common';
import { FigureModal, SourceModal } from '../components/SourceModal';

/** Free browsing: every verified lesson is readable at any time (guided locks never block content). */
export function Library() {
  const { chapterId } = useParams();
  const app = useApp();
  const { manifest } = app;
  const { loading } = useChapters(chapterId ? [chapterId] : null);
  const [q, setQ] = useState('');
  const [src, setSrc] = useState<SourceRef[] | null>(null);
  const [fig, setFig] = useState<string | null>(null);

  const chapter = manifest?.chapters.find((c) => c.id === chapterId);
  const bundle = chapterId ? app.bundles[chapterId] : undefined;
  const lessons = chapterId ? app.verifiedLessons(chapterId) : [];
  const facts = useMemo(() => (bundle?.facts ?? []).filter((f) => f.verification.status === 'verified'), [bundle]);
  const results = useMemo(() => (q.trim() ? facts.filter((f) => f.statement.includes(q.trim())) : []), [facts, q]);

  if (!manifest) return null;
  if (!chapterId) {
    return (
      <div className="stack fade-in">
        <div><h1>ספרייה – עיון חופשי</h1><p className="muted">כל החומר המאומת פתוח לעיון בכל עת, ללא קשר למסלול המודרך. לכל קביעה יש מקור מדויק בחוברת.</p></div>
        <div className="grid cols-2">{manifest.chapters.map((c) => (
          <Link key={c.id} to={`/library/${c.id}`} className="card stack tight" style={{ color: 'inherit' }}><h3>{c.title}</h3><span className="muted small">עמודים <Num>{c.firstPage}–{c.lastPage}</Num> · <Num>{c.lessons.length}</Num> שיעורים</span></Link>
        ))}</div>
      </div>
    );
  }
  return (
    <div className="stack fade-in">
      <div className="row between"><Link to="/library" className="btn ghost">‹ לכל הפרקים</Link><Link to={`/practice`} className="btn">לתרגול</Link></div>
      <h1>{chapter?.title}</h1>
      <input className="text-in" placeholder="חיפוש בקביעות המאומתות של הפרק…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="חיפוש" data-testid="lib-search" />
      {loading && !bundle && <div className="empty">טוען…</div>}
      {q.trim() && <div className="card stack"><b>תוצאות (<Num>{results.length}</Num>)</b>{results.map((f) => <FactRow key={f.id} f={f} onSrc={setSrc} />)}</div>}
      {!q.trim() && lessons.map((l) => (
        <details key={l.id} className="card" data-testid={`lib-lesson-${l.id}`}>
          <summary><b>{l.title}</b> <span className="muted small">· עמודים <Num>{l.pages[0]}–{l.pages[1]}</Num></span></summary>
          <div className="stack explain" style={{ marginTop: 12 }}>
            {l.steps.filter((s) => s.type === 'explain').map((s, i) => s.type === 'explain' && (
              <div key={i} className="stack tight" style={{ borderTop: i ? '1px solid var(--border)' : undefined, paddingTop: i ? 10 : 0 }}>
                {s.title && <h3>{s.title}</h3>}
                {(s.figures ?? []).map((f) => <figure className="fig" key={f}><img src={figureUrl(f)} alt="איור מקורי" onClick={() => setFig(f)} /></figure>)}
                {s.blocks.map((b, j) => b.kind === 'p' ? <p key={j}>{b.text}</p> : b.kind === 'bullets' ? <ul key={j}>{b.items!.map((x, k) => <li key={k}>{x}</li>)}</ul> : b.kind === 'key' ? <div key={j} className="key">{b.text}</div> : b.kind === 'note' ? <div key={j} className="note">{b.text}</div> : b.kind === 'table' ? (
                  <div key={j} style={{ overflowX: 'auto' }}><table className="t"><thead><tr>{b.table!.headers.map((h, k) => <th key={k}>{h}</th>)}</tr></thead><tbody>{b.table!.rows.map((r, k) => <tr key={k}>{r.map((c, m) => <td key={m}>{c}</td>)}</tr>)}</tbody></table></div>
                ) : null)}
                <div><button className="btn ghost" type="button" onClick={() => setSrc(s.factIds.flatMap((id) => facts.find((f) => f.id === id)?.refs ?? []))}>המקור בחוברת</button></div>
              </div>
            ))}
            <div className="row"><Link className="btn" to={`/lesson/${l.id}`}>ללמוד עם תרגול</Link><Link className="btn" to={`/practice?lesson=${encodeURIComponent(l.id)}`}>תרגול בשיעור</Link></div>
          </div>
        </details>
      ))}
      {src && <SourceModal refs={src} onClose={() => setSrc(null)} />}
      {fig && <FigureModal figureId={fig} onClose={() => setFig(null)} />}
    </div>
  );
}

function FactRow({ f, onSrc }: { f: Fact; onSrc: (r: SourceRef[]) => void }) {
  return <div className="row between" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}><span style={{ flex: 1 }}>{f.statement}</span><button className="btn ghost" type="button" onClick={() => onSrc(f.refs)}>מקור (עמ׳ <Num>{f.refs[0]?.page}</Num>)</button></div>;
}
