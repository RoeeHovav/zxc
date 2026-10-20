import { useEffect, useMemo, useState } from 'react';
import { locateQuote } from '../../domain/normalize';
import type { Question, ReviewDecision, SourceRef } from '../../domain/types';
import { useApp } from '../../app/store';
import { figureUrl, loadCoverage, loadReview, loadSources, pageUrl, type CoverageRow, type ReviewData, type SourceUnit } from '../../content/loader';
import { Num } from '../components/common';
import { Modal } from '../components/SourceModal';
import { ImageViewer } from '../components/ImageViewer';

type Tab = 'overview' | 'items' | 'visual' | 'coverage';
const STATUS_LABEL: Record<string, string> = { verified: 'מאומת', pending: 'ממתין לאימות', flagged: 'לבדיקה', rejected: 'נדחה' };
const KIND_LABEL: Record<string, string> = { question: 'שאלה', lesson: 'שיעור', fact: 'עובדה' };

export function ContentReview() {
  const app = useApp();
  const [data, setData] = useState<ReviewData | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  useEffect(() => { loadReview().then(setData).catch((e) => setErr(String(e))); }, []);
  if (err) return <div className="card"><h2>אין נתוני בקרה</h2><p>{err}</p></div>;
  if (!data) return <div className="empty">טוען…</div>;
  return (
    <div className="stack fade-in" data-testid="content-review">
      <div><h1>לוח בקרת מקורות</h1><p className="muted">ממשק פנימי לבדיקת תוכן הלימוד מול החוברת הרשמית. תוכן שאינו מאומת אינו נכנס למאגר השאלות או לשיעורי המסלול ללא אישור מפורש שלכם כאן.</p></div>
      <div className="tabs">{([['overview', 'סקירה'], ['items', 'פריטים לבדיקה'], ['coverage', 'כיסוי'], ['visual', 'טקסט מתוך תמונות']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'overview' && <Overview d={data} />}
      {tab === 'coverage' && <Coverage d={data} />}
      {tab === 'items' && <Items d={data} app={app} />}
      {tab === 'visual' && <Visual d={data} />}
    </div>
  );
}

const sum = (o: Record<string, number> | undefined) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);

function Overview({ d }: { d: ReviewData }) {
  const ex = d.extraction;
  const chs = Object.entries(d.chapters);
  const tot = (k: 'facts' | 'lessons' | 'questions', s: string) => chs.reduce((a, [, c]) => a + (c[k][s] ?? 0), 0);
  return (
    <div className="stack">
      <div className="grid cols-4">
        <div className="card kpi"><span className="v"><Num>{ex.pagesProcessed}/{ex.totalPages}</Num></span><span className="l">עמודי מקור שעובדו</span></div>
        <div className="card kpi"><span className="v"><Num>{Object.values(ex.unitsByScope).reduce((a, b) => a + b, 0)}</Num></span><span className="l">יחידות מקור באינדקס</span></div>
        <div className="card kpi"><span className="v"><Num>{ex.unitsByScope.excluded_footnote ?? 0}</Num></span><span className="l">הערות שוליים (לא חומר למבחן – לא נעשה בהן שימוש)</span></div>
        <div className="card kpi"><span className="v"><Num>{ex.unitsByScope.supplementary ?? 0}</Num></span><span className="l">תיבות ״שאלות למחשבה״ (לא נעשה בהן שימוש)</span></div>
      </div>
      <div className="card stack"><h2>תוכן שנוצר ואומת</h2>
        <div className="scroll-x"><table className="t"><thead><tr><th></th><th>סה״כ</th><th>מאומת</th><th>ממתין</th><th>לבדיקה</th><th>נדחה</th></tr></thead><tbody>
          {(['facts', 'lessons', 'questions'] as const).map((k) => <tr key={k}><td>{{ facts: 'עובדות שחולצו', lessons: 'שיעורים', questions: 'שאלות' }[k]}</td><td><Num>{chs.reduce((a, [, c]) => a + sum(c[k]), 0)}</Num></td><td><Num>{tot(k, 'verified')}</Num></td><td><Num>{tot(k, 'pending')}</Num></td><td><Num>{tot(k, 'flagged')}</Num></td><td><Num>{tot(k, 'rejected')}</Num></td></tr>)}
        </tbody></table></div>
      </div>
      <div className="card stack"><h2>פרקי החוברת</h2>
        <div className="scroll-x"><table className="t"><thead><tr><th>פרק</th><th>עמודים</th><th>מצב</th><th>שגיאות ולידציה</th></tr></thead><tbody>
          {ex.allChapters.filter((c) => c.id !== 'ch0').map((c) => <tr key={c.id}><td>{c.title}</td><td><Num>{c.firstPage}–{c.lastPage}</Num></td><td>{c.built ? <span className="chip ok">נבנה</span> : <span className="chip warn">טרם נבנה – אין כיסוי</span>}</td><td>{d.chapters[c.id]?.validation ? <Num>{d.chapters[c.id].validation!.errors}</Num> : '—'}</td></tr>)}
        </tbody></table></div>
        <p className="muted small">אין לטעון לכיסוי של 100% כל עוד יש פרקים שלא נבנו או יחידות מקור ללא כיסוי (ראו לשונית ״כיסוי״).</p>
      </div>
      <div className="card stack"><h2>עמודים הדורשים בדיקה חזותית ידנית</h2>
        {ex.visualReviewPages.length === 0 ? <span className="muted">אין.</span> : <div>{ex.visualReviewPages.map((p) => <span key={p} className="chip warn" style={{ marginInlineEnd: 6 }}>עמ׳ <Num>{p}</Num></span>)}<p className="muted small">אי-התאמות בין שני מנועי החילוץ במספרים בעמודים אלה (טפסים/טבלאות מספריות): יש לאמת מול העמוד המקורי.</p></div>}
      </div>
    </div>
  );
}

function Coverage({ d }: { d: ReviewData }) {
  return (
    <div className="stack">
      {Object.entries(d.chapters).map(([id, c]) => (
        <div key={id} className="card stack"><h3>{c.title}</h3>
          {!c.coverage ? <span className="muted">אין נתוני כיסוי.</span> : (
            <>
              <div className="row"><span className="chip">יחידות נדרשות <Num>{c.coverage.requiredUnits}</Num></span>
                <span className={`chip ${c.coverage.unitsWithoutFact.length ? 'bad' : 'ok'}`}>ללא עובדה: <Num>{c.coverage.unitsWithoutFact.length}</Num></span>
                <span className={`chip ${c.coverage.unitsWithoutLesson.length ? 'warn' : 'ok'}`}>ללא שיעור: <Num>{c.coverage.unitsWithoutLesson.length}</Num></span>
                <span className={`chip ${c.coverage.unitsWithoutQuestion.length ? 'warn' : 'ok'}`}>ללא שאלה: <Num>{c.coverage.unitsWithoutQuestion.length}</Num></span>
                <span className="chip">עובדות ללא שאלה: <Num>{c.coverage.factsWithoutQuestion.length}</Num></span></div>
              {c.coverage.unitsWithoutFact.length > 0 && <details><summary>יחידות שאינן מכוסות (חסר כיסוי)</summary><div className="muted small ltr">{c.coverage.unitsWithoutFact.join(', ')}</div></details>}
              <Matrix chapterId={id} />
            </>
          )}
          {c.validation && c.validation.warnings.length > 0 && <details><summary>אזהרות ולידציה (<Num>{c.validation.warnings.length}</Num>)</summary><ul>{c.validation.warnings.slice(0, 30).map((w) => <li key={w} className="small">{w}</li>)}</ul></details>}
        </div>
      ))}
    </div>
  );
}

/** Auditable coverage matrix: source passage -> facts -> lessons -> questions -> verification, one row per source unit. */
function Matrix({ chapterId }: { chapterId: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CoverageRow[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'gap' | 'unverified' | 'excluded'>('all');
  useEffect(() => { if (open && !rows) loadCoverage(chapterId).then(setRows).catch(() => setRows([])); }, [open, rows, chapterId]);
  const REQ = new Set(['paragraph', 'box', 'caption', 'table_row', 'note', 'figure_text']);
  const shown = useMemo(() => (rows ?? []).filter((r) => {
    const required = r.s === 'core' && REQ.has(r.k);
    if (filter === 'excluded') return r.s !== 'core';
    if (filter === 'gap') return required && (!r.f.length || !r.l.length || !r.q);
    if (filter === 'unverified') return required && r.f.length > 0 && (r.fv < r.f.length || r.qv < r.q);
    return true;
  }), [rows, filter]);
  const KIND: Record<string, string> = { paragraph: 'פסקה', heading: 'כותרת', caption: 'כיתוב', box: 'תיבה', note: 'הערה', table_row: 'שורת טבלה', epigraph: 'מוטו', figure_text: 'טקסט מתמונה', footnote: 'הערת שוליים', thought_box: 'שאלות למחשבה' };
  return (
    <div className="stack tight">
      <button className="btn ghost" type="button" data-testid={`matrix-toggle-${chapterId}`} onClick={() => setOpen((o) => !o)}>{open ? 'הסתרת מטריצת הכיסוי' : 'מטריצת כיסוי מלאה: קטע מקור ← עובדות ← שיעורים ← שאלות ← אימות'}</button>
      {open && (rows === null ? <span className="muted">טוען…</span> : (
        <>
          <div className="row">{([['all', 'הכול'], ['gap', 'פערי כיסוי'], ['unverified', 'ממתין לאימות'], ['excluded', 'מחוץ לחומר המבחן']] as const).map(([k, l]) => <button key={k} type="button" className={`chip ${filter === k ? 'accent' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}<span className="muted small"><Num>{shown.length}</Num> שורות</span></div>
          <div className="scroll-x"><table className="t" data-testid={`matrix-${chapterId}`}><thead><tr><th>עמ׳</th><th>יחידה</th><th>סוג</th><th>קטע מקור</th><th>עובדות (מאומתות)</th><th>שיעורים</th><th>שאלות (מאומתות)</th></tr></thead>
            <tbody>{shown.slice(0, 600).map((r) => {
              const required = r.s === 'core' && REQ.has(r.k);
              const cls = r.s !== 'core' ? 'muted' : required && !r.f.length ? 'bad' : '';
              return <tr key={r.u} className={cls}><td><Num>{r.p}</Num></td><td className="ltr">{r.u}</td><td>{KIND[r.k] ?? r.k}{r.s === 'excluded_footnote' ? ' (לא חומר למבחן)' : r.s === 'supplementary' ? ' (לא חומר למבחן)' : ''}</td><td className="small">{r.t}</td>
                <td><Num>{r.f.length}</Num>{r.f.length > 0 && <span className="muted"> (<Num>{r.fv}</Num>)</span>}</td><td className="small ltr">{r.l.join(', ')}</td><td><Num>{r.q}</Num>{r.q > 0 && <span className="muted"> (<Num>{r.qv}</Num>)</span>}</td></tr>;
            })}</tbody></table></div>
          {shown.length > 600 && <span className="muted small">מוצגות 600 השורות הראשונות — סננו כדי לצמצם.</span>}
        </>
      ))}
    </div>
  );
}

function Visual({ d }: { d: ReviewData }) {
  const [view, setView] = useState<string | null>(null);
  if (!d.visual.length) return <div className="card muted">אין טקסט שתומלל מתמונות.</div>;
  return (
    <div className="stack">
      <p className="muted">טקסט שמופיע בתוך תמונות (כמו מילות ההמנון) נקרא מהתמונה המקורית, פעמיים באופן בלתי תלוי. אי-התאמה מסומנת לבדיקה ידנית.</p>
      {d.visual.map((v) => (
        <div key={v.id} className="card stack"><div className="row between"><b className="ltr">{v.id}</b><span className="row"><span className="chip">עמ׳ <Num>{v.page}</Num></span><span className={`chip ${v.status === 'double_read_agree' ? 'ok' : v.status === 'adjudicated' ? 'accent' : 'bad'}`}>{{ double_read_agree: 'שתי קריאות זהות', adjudicated: 'אי-התאמה הוכרעה מול התמונה', disagree: 'אי-התאמה – לבדיקה', single_read: 'קריאה אחת' }[v.status] ?? v.status}</span></span></div>
          <div className="src-text">{v.text}</div>
          {v.figure && <div><button className="btn" type="button" onClick={() => setView(v.figure!)}>הצגת האיור המקורי</button></div>}
        </div>
      ))}
      {view && <Modal title="האיור המקורי" onClose={() => setView(null)} wide><ImageViewer src={figureUrl(view)} alt="איור מקורי" /></Modal>}
    </div>
  );
}

function RefsInline({ refs, chapter }: { refs: SourceRef[]; chapter: string }) {
  const [units, setUnits] = useState<Record<string, SourceUnit>>({});
  const [page, setPage] = useState<number | null>(null);
  useEffect(() => { loadSources(chapter).then((a) => setUnits(Object.fromEntries(a.map((u) => [u.id, u])))).catch(() => {}); }, [chapter]);
  return (
    <div className="stack tight">
      {refs.map((r, i) => {
        const u = units[r.unit];
        const range = u ? locateQuote(u.text, r.quote) : null;
        return (
          <div key={i} className="stack tight">
            <div className="row"><span className="chip accent">עמוד <Num>{r.page}</Num></span><span className="chip ltr">{r.unit}</span>{!range && u && <span className="chip bad">הציטוט לא נמצא ביחידה!</span>}</div>
            <div className="src-text">{u && range ? (<>{u.text.slice(0, range[0])}<mark className="q">{u.text.slice(range[0], range[1])}</mark>{u.text.slice(range[1])}</>) : (u?.text ?? r.quote)}</div>
            <div><button className="btn ghost" type="button" onClick={() => setPage(r.page)}>העמוד המקורי</button></div>
          </div>
        );
      })}
      {page !== null && <Modal title={`עמוד ${page} במקור`} onClose={() => setPage(null)} wide><ImageViewer src={pageUrl(page)} alt="עמוד מקורי" /></Modal>}
    </div>
  );
}

type Flagged = ReviewData['flagged'][number];

function describe(f: Flagged): React.ReactNode {
  const it = f.item;
  if (f.kind === 'question') {
    const q = it as Question;
    return (
      <div className="stack tight">
        <div><span className="muted small">שאלה ({q.type}):</span> <b>{q.stem}</b></div>
        {'options' in q && <ul className="list-plain">{q.options.map((o) => { const ok = q.type === 'multi' ? q.correct.includes(o.id) : q.correct === o.id; return <li key={o.id} className={ok ? 'chip ok' : ''} style={ok ? undefined : { padding: '2px 10px' }}>{ok ? '✓ ' : ''}{o.text}</li>; })}</ul>}
        {q.type === 'tf' && <div className="chip ok">התשובה לפי המפתח: {q.correct ? 'נכון' : 'לא נכון'}</div>}
        {(q.type === 'short' || q.type === 'blank') && <div className="chip ok">תשובות מתקבלות: {q.accepted.join(' | ')}</div>}
        {q.type === 'match' && <ul className="list-plain">{q.left.map((l) => <li key={l.id}>{l.text} ← {q.right.find((r) => r.id === q.correct[l.id])?.text}</li>)}</ul>}
        {q.type === 'order' && <ol>{q.correct.map((id) => <li key={id}>{q.items.find((i) => i.id === id)?.text}</li>)}</ol>}
        <div><span className="muted small">רמזים:</span> {q.hints.join(' ‖ ')}</div>
        <div><span className="muted small">הסבר:</span> {q.explanation}</div>
      </div>
    );
  }
  if (f.kind === 'lesson') {
    return <div className="stack tight"><b>{it.title}</b><div className="muted small">עמודים {it.pages?.join('–')} · {it.steps?.length} שלבים</div>
      {(it.steps ?? []).filter((s: any) => s.type === 'explain').slice(0, 4).map((s: any, i: number) => <div key={i} className="note">{s.title && <b>{s.title}: </b>}{(s.blocks ?? []).map((b: any) => b.text ?? (b.items ?? []).join('; ')).join(' ')}</div>)}</div>;
  }
  return <div><span className="muted small">עובדה:</span> <b>{it.statement}</b></div>;
}

function Items({ d, app }: { d: ReviewData; app: ReturnType<typeof useApp> }) {
  const [kind, setKind] = useState<'all' | 'question' | 'lesson' | 'fact'>('all');
  const [status, setStatus] = useState<'all' | 'flagged' | 'rejected' | 'pending'>('all');
  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const list = useMemo(() => d.flagged.filter((f) => (kind === 'all' || f.kind === kind) && (status === 'all' || f.status === status)), [d, kind, status]);
  const cur = list.find((f) => f.id === sel) ?? null;
  const dec = cur ? app.decisions[cur.id] : undefined;

  const decide = async (f: Flagged, decision: ReviewDecision['decision'], override?: ReviewDecision['override']) => {
    const note = window.prompt('הערה להחלטה (אופציונלי)') ?? '';
    await app.setDecision({ itemId: f.id, itemKind: f.kind, decision, note, ts: Date.now(), override });
    setEditing(false);
  };

  return (
    <div className="split">
      <div className="card stack tight" style={{ maxHeight: '75vh', overflow: 'auto' }}>
        <div className="row">
          <select className="text-in" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="סוג פריט"><option value="all">הכול</option><option value="question">שאלות</option><option value="lesson">שיעורים</option><option value="fact">עובדות</option></select>
          <select className="text-in" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="מצב"><option value="all">כל המצבים</option><option value="flagged">לבדיקה</option><option value="rejected">נדחו</option><option value="pending">ממתינים</option></select>
        </div>
        <div className="muted small"><Num>{list.length}</Num> פריטים</div>
        {list.length === 0 && <div className="empty">אין פריטים התואמים.</div>}
        {list.slice(0, 300).map((f) => {
          const dd = app.decisions[f.id];
          return <button key={f.id} type="button" className="lesson-row" style={{ textAlign: 'right', cursor: 'pointer', outline: sel === f.id ? '2px solid var(--accent)' : undefined }} onClick={() => { setSel(f.id); setEditing(false); }}>
            <div className="t"><b className="ltr">{f.id}</b><span className="muted small">{KIND_LABEL[f.kind]} · {STATUS_LABEL[f.status] ?? f.status}{dd ? ` · החלטה: ${dd.decision === 'approved' ? 'אושר' : dd.decision === 'rejected' ? 'נדחה' : 'תוקן'}` : ''}</span></div></button>;
        })}
      </div>
      <div className="card stack" data-testid="item-detail">
        {!cur ? <div className="empty">בחרו פריט מהרשימה.</div> : (
          <>
            <div className="row between"><h3 style={{ margin: 0 }}><span className="ltr">{cur.id}</span> – {KIND_LABEL[cur.kind]}</h3><span className="chip warn">{STATUS_LABEL[cur.status] ?? cur.status}</span></div>
            <h3>1–2. התוכן שנוצר והתשובה שלפי המפתח</h3>
            {describe(cur)}
            <h3>3–4. הקטע המקורי המדויק והעמוד</h3>
            <RefsInline refs={cur.kind === 'lesson' ? [] : cur.item.refs ?? []} chapter={cur.chapter} />
            {cur.kind === 'lesson' && <div className="muted small">מקורות השיעור מופיעים בעובדות שהוא מלמד (ראו לשונית עובדות).</div>}
            <h3>5. החשש לאימות</h3>
            <div className="feedback bad" style={{ background: 'var(--warn-soft)', borderColor: 'var(--warn)' }}>
              {cur.item.verification?.independent ? <div>מאמת בלתי תלוי: <b>{cur.item.verification.independent.verdict}</b> — {cur.item.verification.independent.notes || 'ללא הערה'}</div> : <div>טרם נבדק על ידי מאמת בלתי תלוי.</div>}
              <div className="small muted">בדיקות אוטומטיות: ציטוטים נמצאו {String(cur.item.verification?.programmatic?.quotesFound)} · מפתח תקין {String(cur.item.verification?.programmatic?.answerKeyValid)} · ללא מקור מוחרג {String(cur.item.verification?.programmatic?.noExcludedSource)}</div>
            </div>
            <h3>6. החלטה</h3>
            {dec && <div className="chip accent">החלטה קיימת: {dec.decision} {dec.note && `— ${dec.note}`}</div>}
            <div className="row">
              <button className="btn primary" type="button" onClick={() => decide(cur, 'approved')} data-testid="approve">אישור (הצהרה שנבדק מול המקור)</button>
              <button className="btn danger" type="button" onClick={() => decide(cur, 'rejected')} data-testid="reject">דחייה</button>
              {cur.kind === 'question' && <button className="btn" type="button" onClick={() => setEditing(!editing)}>תיקון…</button>}
            </div>
            {editing && cur.kind === 'question' && <Corrector q={cur.item as Question} onSave={(o) => decide(cur, 'corrected', o)} />}
            <p className="muted small">אישור מכניס את הפריט למאגר רק בדפדפן הזה. מפתחות התשובה המקוריים אינם משתנים בשקט – כל תיקון נשמר כהחלטה גלויה.</p>
          </>
        )}
      </div>
    </div>
  );
}

function Corrector({ q, onSave }: { q: Question; onSave: (o: Partial<Question>) => void }) {
  const [stem, setStem] = useState(q.stem);
  const [expl, setExpl] = useState(q.explanation);
  const [hints, setHints] = useState(q.hints.join('\n'));
  const [correct, setCorrect] = useState<string>(q.type === 'mcq' || q.type === 'compare' ? q.correct : q.type === 'tf' ? String(q.correct) : '');
  const [acc, setAcc] = useState(q.type === 'short' || q.type === 'blank' ? q.accepted.join('\n') : '');
  return (
    <div className="card flat stack">
      <label className="field">נוסח השאלה<textarea className="text-in" value={stem} onChange={(e) => setStem(e.target.value)} /></label>
      {(q.type === 'mcq' || q.type === 'compare') && <label className="field">התשובה הנכונה<select className="text-in" value={correct} onChange={(e) => setCorrect(e.target.value)}>{q.options.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}</select></label>}
      {q.type === 'tf' && <label className="field">התשובה הנכונה<select className="text-in" value={correct} onChange={(e) => setCorrect(e.target.value)}><option value="true">נכון</option><option value="false">לא נכון</option></select></label>}
      {(q.type === 'short' || q.type === 'blank') && <label className="field">תשובות מתקבלות (אחת בכל שורה)<textarea className="text-in" value={acc} onChange={(e) => setAcc(e.target.value)} /></label>}
      <label className="field">רמזים (אחד בכל שורה)<textarea className="text-in" value={hints} onChange={(e) => setHints(e.target.value)} /></label>
      <label className="field">הסבר<textarea className="text-in" value={expl} onChange={(e) => setExpl(e.target.value)} /></label>
      <button className="btn primary" type="button" onClick={() => {
        const o: Record<string, unknown> = { stem, explanation: expl, hints: hints.split('\n').map((s) => s.trim()).filter(Boolean) };
        if (q.type === 'mcq' || q.type === 'compare') o.correct = correct;
        if (q.type === 'tf') o.correct = correct === 'true';
        if (q.type === 'short' || q.type === 'blank') { const a = acc.split('\n').map((s) => s.trim()).filter(Boolean); o.accepted = a; o.answerDisplay = a[0]; }
        onSave(o as Partial<Question>);
      }}>שמירת התיקון</button>
    </div>
  );
}
