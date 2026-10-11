import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { ExplainBlock, Fact, LessonStep, SourceRef } from '../../domain/types';
import { useApp } from '../../app/store';
import { figureUrl } from '../../content/loader';
import { Num, Progress, useChapters } from '../components/common';
import { PracticeQuestion } from '../components/PracticeQuestion';
import { FigureModal, SourceModal } from '../components/SourceModal';
import { useToast } from '../toast';

function Block({ b }: { b: ExplainBlock }) {
  switch (b.kind) {
    case 'p': return <p className="block-p">{b.text}</p>;
    case 'bullets': return <ul>{b.items!.map((x, i) => <li key={i}>{x}</li>)}</ul>;
    case 'key': return <div className="key">{b.text}</div>;
    case 'note': return <div className="note">{b.text}</div>;
    case 'table': return (
      <div style={{ overflowX: 'auto' }}><table className="t"><thead><tr>{b.table!.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{b.table!.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
    );
  }
}

export function LessonPage() {
  const { id = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const app = useApp();
  const { toast: _t, achieved } = useToast();
  void _t;
  const chapterId = id.split('.')[0];
  const { bundles, loading } = useChapters([chapterId]);
  const bundle = bundles[chapterId];
  const lesson = bundle?.lessons.find((l) => l.id === id);
  const [sessionSeed] = useState(() => String(Date.now()));
  const [source, setSource] = useState<SourceRef[] | null>(null);
  const [fig, setFig] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Record<string, boolean>>({});

  const bankIds = useMemo(() => new Set(app.bank.map((q) => q.id)), [app.bank]);
  const qById = useMemo(() => new Map(app.bank.map((q) => [q.id, q])), [app.bank]);
  const factById = useMemo(() => new Map((bundle?.facts ?? []).map((f) => [f.id, f] as const)), [bundle]);
  // only VERIFIED questions are shown inside lessons; unverified checks are skipped, never shown silently
  const steps: LessonStep[] = useMemo(() => (lesson?.steps ?? []).filter((s) => s.type !== 'check' || bankIds.has(s.questionId)), [lesson, bankIds]);
  const step = Math.min(Math.max(0, Number(sp.get('step') ?? 0) || 0), steps.length);
  const status = app.statuses[id];

  useEffect(() => { if (lesson && !loading) app.saveLessonProgress(lesson.id, step, step > 0 ? [step - 1] : []).catch(() => {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [lesson?.id, step, loading]);

  if (loading && !bundle) return <div className="empty">טוען שיעור…</div>;
  if (!lesson) return <div className="card"><h2>השיעור לא נמצא</h2><Link to="/guided" className="btn">חזרה למסלול</Link></div>;
  if (lesson.verification.status !== 'verified' && !['approved', 'corrected'].includes(app.decisions[lesson.id]?.decision ?? '')) {
    return <div className="card stack"><h2>השיעור טרם אומת</h2><p>תוכן שלא עבר אימות מול החוברת אינו מוצג ללימוד. ניתן לבדוק אותו בלוח בקרת המקורות.</p><Link to="/content-review" className="btn">לוח בקרת מקורות</Link></div>;
  }

  const go = (n: number) => { const p = new URLSearchParams(sp); p.set('step', String(n)); setSp(p, { replace: true }); window.scrollTo({ top: 0 }); };
  const refsOf = (factIds: string[]): SourceRef[] => {
    const seen = new Set<string>(); const out: SourceRef[] = [];
    for (const f of factIds) for (const r of (factById.get(f) as Fact | undefined)?.refs ?? []) { const k = `${r.unit}|${r.quote}`; if (!seen.has(k)) { seen.add(k); out.push(r); } }
    return out;
  };
  const cur = steps[step];
  const idx = app.orderedLessonIds.indexOf(id);

  return (
    <div className="narrow stack fade-in">
      <div className="row between">
        <Link to="/guided" className="btn ghost">‹ לכל השיעורים</Link>
        <span className="chip">{status === 'mastered' ? 'נשלט 100%' : status === 'locked' ? 'לימוד חופשי (נעול במסלול)' : 'במסלול המודרך'}</span>
      </div>
      <div>
        <span className="muted small">שיעור <Num>{idx + 1}</Num> · עמודים <Num>{lesson.pages[0]}–{lesson.pages[1]}</Num></span>
        <h1>{lesson.title}</h1>
        <Progress value={steps.length ? step / steps.length : 1} />
        <div className="muted small" style={{ marginTop: 4 }}>שלב <Num>{Math.min(step + 1, steps.length)}</Num> מתוך <Num>{steps.length}</Num></div>
      </div>

      {cur?.type === 'explain' && (
        <div className="card explain stack" data-testid="explain-step" key={`s${step}`}>
          {cur.title && <h2>{cur.title}</h2>}
          {(cur.figures ?? []).map((f) => (
            <figure className="fig" key={f}><img src={figureUrl(f)} alt="איור מקורי מהחוברת" onClick={() => setFig(f)} /><figcaption>איור מקורי מהחוברת (לחצו להגדלה)</figcaption></figure>
          ))}
          {cur.blocks.map((b, i) => <Block b={b} key={i} />)}
          <div className="row between">
            <button className="btn ghost" type="button" onClick={() => setSource(refsOf(cur.factIds))} data-testid="step-source">המקור בחוברת</button>
            <div className="row">
              {step > 0 && <button className="btn" type="button" onClick={() => go(step - 1)}>הקודם</button>}
              <button className="btn primary" type="button" onClick={() => go(step + 1)} data-testid="step-next">המשך</button>
            </div>
          </div>
        </div>
      )}

      {cur?.type === 'figure' && (
        <div className="card stack" key={`s${step}`} data-testid="figure-step">
          <figure className="fig"><img src={figureUrl(cur.figureId)} alt="איור מקורי" onClick={() => setFig(cur.figureId)} /><figcaption>{cur.caption ?? 'איור מקורי מהחוברת'}</figcaption></figure>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {step > 0 && <button className="btn" type="button" onClick={() => go(step - 1)}>הקודם</button>}
            <button className="btn primary" type="button" onClick={() => go(step + 1)}>המשך</button>
          </div>
        </div>
      )}

      {cur?.type === 'check' && (() => {
        const q = qById.get(cur.questionId)!;
        return (
          <div className="card stack" key={`s${step}`} data-testid="check-step">
            <span className="chip accent">שאלת תרגול – אפשר רמזים וניסיון חוזר</span>
            <PracticeQuestion question={q} seed={`${sessionSeed}|${step}`}
              onResolved={async (outcome) => { setResolved((r) => ({ ...r, [q.id]: true })); const r = await app.recordAnswer(q, outcome, 'lesson_check'); achieved(r.unlocked); }}
              onNext={() => go(step + 1)} nextLabel="המשך" />
            {step > 0 && !resolved[q.id] && <div><button className="btn ghost" type="button" onClick={() => go(step - 1)}>חזרה לשלב הקודם</button></div>}
          </div>
        );
      })()}

      {step >= steps.length && (
        <div className="card accent stack" data-testid="lesson-end">
          <h2>סיימת את חומר הלימוד 🎯</h2>
          {lesson.summary && <p>{lesson.summary}</p>}
          <p>עכשיו ניגשים למבחן השליטה: שאלות מייצגות על כל יעדי השיעור. כדי לשלוט בשיעור נדרשות <b>כל</b> התשובות נכונות, ללא רמזים וללא ניסיון שני.</p>
          <div className="row">
            {status !== 'locked' ? <Link to={`/assess/${id}`} className="btn primary big" data-testid="to-assessment">למבחן השליטה</Link>
              : <span className="chip warn">מבחן השליטה ייפתח אחרי שליטה בשיעורים הקודמים במסלול</span>}
            <Link to={`/practice?lesson=${encodeURIComponent(id)}`} className="btn">תרגול חופשי בשיעור</Link>
            <button className="btn ghost" type="button" onClick={() => go(0)}>לחזור על השיעור</button>
            <button className="btn ghost" type="button" onClick={() => nav('/guided')}>למסלול</button>
          </div>
        </div>
      )}
      {source && <SourceModal refs={source} onClose={() => setSource(null)} />}
      {fig && <FigureModal figureId={fig} onClose={() => setFig(null)} />}
    </div>
  );
}
