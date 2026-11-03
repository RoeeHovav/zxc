import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { ExplainBlock, Fact, LessonStep, SourceRef } from '../../domain/types';
import { useApp } from '../../app/store';
import { figureUrl, loadSources, pageUrl } from '../../content/loader';
import { bookSegments, groupBookBlocks, type BookUnit } from '../../domain/bookText';
import { OriginalText } from '../components/OriginalText';
import { Num, Progress, useChapters } from '../components/common';
import { ReadAloud, Speakable, useSpeech } from '../../app/speech';
import { explainSegments, PAUSE, segmentsFromText, type SpeechSegment } from '../../domain/speech';
import { PracticeQuestion } from '../components/PracticeQuestion';
import { FigureModal, SourceModal } from '../components/SourceModal';
import { useToast } from '../toast';

function Block({ b, id }: { b: ExplainBlock; id: string }) {
  switch (b.kind) {
    case 'p': return <Speakable as="p" id={id} className="block-p">{b.text}</Speakable>;
    case 'bullets': return <ul>{b.items!.map((x, i) => <Speakable as="li" id={id} key={i}>{x}</Speakable>)}</ul>;
    case 'key': return <Speakable as="div" id={id} className="key">{b.text}</Speakable>;
    case 'note': return <Speakable as="div" id={id} className="note">{b.text}</Speakable>;
    case 'table': return (
      <Speakable as="div" id={id} style={{ overflowX: 'auto' }}><table className="t"><thead><tr>{b.table!.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{b.table!.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></Speakable>
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
  // 'original' (default): the book's own text of the lesson, then the test; 'summary': rewritten cards on one page; 'steps': card by card with practice questions in between
  // (?flow=… overrides the setting; a stored legacy value 'read' means the old default and is treated as 'original')
  const flowParam = sp.get('flow');
  const flow: 'original' | 'summary' | 'steps' = flowParam === 'steps' || flowParam === 'summary' || flowParam === 'original' ? flowParam : app.prefs.lessonFlow === 'steps' || app.prefs.lessonFlow === 'summary' ? app.prefs.lessonFlow : 'original';
  const [rows, setRows] = useState<BookUnit[] | null>(null);
  const [view, setView] = useState<'text' | 'pages'>('text');
  useEffect(() => {
    let alive = true;
    loadSources(chapterId).then((r) => { if (alive) setRows(r as BookUnit[]); }).catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [chapterId]);
  const units = useMemo(() => {
    const by = new Map((rows ?? []).map((r) => [r.id, r] as const));
    return (lesson?.readingUnits ?? []).map((u) => by.get(u)).filter((u): u is BookUnit => !!u);
  }, [rows, lesson]);
  const lessonPages = useMemo(() => [...new Set(units.map((u) => u.page))].sort((a, b) => a - b), [units]);
  const blocks = useMemo(() => groupBookBlocks(units, { pageMarkers: lessonPages.length > 1 }), [units, lessonPages.length]);
  // the original text needs the lesson's reading range and the chapter's source file; otherwise the rewritten summary page is shown
  const effFlow: 'original' | 'summary' | 'steps' = flow === 'original' && rows !== null && units.length === 0 ? 'summary' : flow;

  useEffect(() => { if (lesson && !loading) app.saveLessonProgress(lesson.id, step, step > 0 ? [step - 1] : []).catch(() => {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [lesson?.id, step, loading]);

  // ---- listen to the whole lesson (hands-free): reads every card from the current one on, moving the screen along ----
  const speech = useSpeech();
  const sp0 = sp;
  const listenOwner = `lessonall:${id}`;
  const listening = speech.ownerId === listenOwner && speech.status !== 'idle';
  useEffect(() => {
    if (flow !== 'steps') { if (speech.finishedOwner === listenOwner) document.querySelector('[data-testid="lesson-end"]')?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); return; }
    const b = speech.activeBlockId;
    if (listening && b) {
      const m = /^lesson:[^:]+:(\d+):/.exec(b);
      if (m && Number(m[1]) !== step) { const p = new URLSearchParams(sp0.toString()); p.set('step', m[1]); setSp(p, { replace: true }); window.scrollTo({ top: 0 }); }
    }
    // the whole lesson was heard to the end → show the "ready for the mastery test" screen (a manual stop leaves the learner where they are)
    if (speech.finishedOwner === listenOwner) { const p = new URLSearchParams(sp0.toString()); p.set('step', String(steps.length)); setSp(p, { replace: true }); window.scrollTo({ top: 0 }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, speech.activeBlockId, speech.finishedOwner]);

  const endRef = useRef<HTMLDivElement>(null);
  const markedRead = useRef(false);
  // reading view: reaching the end of the page counts as having read the lesson
  useEffect(() => {
    markedRead.current = false;
    const el = endRef.current;
    if (effFlow === 'steps' || !lesson || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting) && !markedRead.current) {
        markedRead.current = true;
        app.saveLessonProgress(lesson.id, steps.length, steps.map((_, i) => i)).catch(() => {});
      }
    });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effFlow, lesson?.id, steps.length, loading, rows]);

  if (loading && !bundle) return <div className="empty">טוען שיעור…</div>;
  if (flow === 'original' && rows === null) return <div className="empty">טוען את הטקסט המקורי…</div>;
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

  const buildAll = () => {
    const segs: SpeechSegment[] = [];
    steps.forEach((s, i) => {
      if (s.type === 'explain') { const c = explainSegments(s.title, s.blocks, `lesson:${id}:${i}`); if (c.length) c[c.length - 1] = { ...c[c.length - 1], pauseAfterMs: PAUSE.block + 450 }; segs.push(...c); }
      else if (s.type === 'figure' && s.caption) segs.push(...segmentsFromText(s.caption, { blockId: `lesson:${id}:${i}:fig`, after: PAUSE.block + 450 }));
    });
    return segs;
  };

  if (effFlow !== 'steps') {
    const original = effFlow === 'original';
    return (
      <div className="narrow stack fade-in" data-testid="lesson-reading" data-flow={effFlow}>
        <div className="row between">
          <Link to="/guided" className="btn ghost">‹ לכל השיעורים</Link>
          <span className="chip">{status === 'mastered' ? 'נשלט 100%' : status === 'locked' ? 'לימוד חופשי (נעול במסלול)' : 'במסלול המודרך'}</span>
        </div>
        <div>
          <span className="muted small">שיעור <Num>{idx + 1}</Num> · עמודים <Num>{lesson.pages[0]}–{lesson.pages[1]}</Num></span>
          <h1>{lesson.title}</h1>
          <p className="muted small" style={{ margin: 0 }}>{original ? 'הטקסט המקורי מהחוברת: קוראים (או מאזינים) ואחר כך ניגשים למבחן עליו.' : 'סיכום השיעור בניסוח מחדש: קוראים ואחר כך ניגשים למבחן עליו.'}</p>
        </div>
        <div className="row">
          {speech.supported && <ReadAloud owner={listenOwner} icon="🎧" label="האזנה לכל השיעור" testId="listen-all" build={original ? () => bookSegments(blocks, `orig:${id}`) : buildAll} />}
          {original && <div className="seg" role="group" aria-label="תצוגה"><button type="button" className={view === 'text' ? 'on' : ''} onClick={() => setView('text')} data-testid="view-text">טקסט</button><button type="button" className={view === 'pages' ? 'on' : ''} onClick={() => setView('pages')} data-testid="view-pages">עמוד מקורי (תמונה)</button></div>}
          {status !== 'locked' && <Link to={`/assess/${id}`} className="btn ghost" data-testid="skip-to-test">ישר למבחן</Link>}
        </div>
        {original && view === 'text' && <div className="card"><OriginalText blocks={blocks} prefix={`orig:${id}`} onFigure={setFig} /></div>}
        {original && view === 'pages' && <div className="stack" data-testid="page-images">{lessonPages.map((p) => <img key={p} className="page-img" src={pageUrl(p)} alt={`עמוד ${p} בחוברת`} loading="lazy" />)}<p className="muted small" style={{ margin: 0 }}>זהו הצילום המקורי של העמוד/ים. הקראה בקול זמינה בתצוגת הטקסט.</p></div>}
        {!original && steps.map((s, i) => {
          if (s.type === 'explain') return (
            <section className="card explain stack" key={i} data-testid="explain-card" aria-label={s.title ?? `חלק ${i + 1}`}>
              <div className="row between card-head">
                {s.title ? <Speakable as="h2" id={`lesson:${id}:${i}:title`}>{s.title}</Speakable> : <span />}
                <ReadAloud owner={`lesson:${id}:${i}`} label="הקראת הכרטיס" build={() => explainSegments(s.title, s.blocks, `lesson:${id}:${i}`)} testId={`read-card-${i}`} />
              </div>
              {(s.figures ?? []).map((f) => (
                <figure className="fig" key={f}><img src={figureUrl(f)} alt="איור מקורי מהחוברת" onClick={() => setFig(f)} /><figcaption>איור מקורי מהחוברת (לחצו להגדלה)</figcaption></figure>
              ))}
              {s.blocks.map((b, j) => <Block b={b} id={`lesson:${id}:${i}:${j}`} key={j} />)}
              <div><button className="btn ghost" type="button" onClick={() => setSource(refsOf(s.factIds))} data-testid="step-source">המקור בחוברת</button></div>
            </section>
          );
          if (s.type === 'figure') return (
            <div className="card stack" key={i} data-testid="figure-step">
              <figure className="fig"><img src={figureUrl(s.figureId)} alt="איור מקורי" onClick={() => setFig(s.figureId)} /><figcaption>{s.caption ?? 'איור מקורי מהחוברת'}</figcaption></figure>
            </div>
          );
          return null; // practice questions are not shown while reading
        })}
        <div className="card accent stack" data-testid="lesson-end" ref={endRef}>
          <h2>סיימת לקרוא 🎯</h2>
          {!original && lesson.summary && <p>{lesson.summary}</p>}
          <p>עכשיו ניגשים למבחן השליטה: שאלות מייצגות על כל יעדי השיעור. כדי לשלוט בשיעור נדרשות <b>כל</b> התשובות נכונות, ללא רמזים וללא ניסיון שני.</p>
          <div className="row">
            {status !== 'locked' ? <Link to={`/assess/${id}`} className="btn primary big" data-testid="to-assessment">למבחן השליטה</Link>
              : <span className="chip warn">מבחן השליטה ייפתח אחרי שליטה בשיעורים הקודמים במסלול</span>}
            <Link to={`/practice?lesson=${encodeURIComponent(id)}`} className="btn">תרגול חופשי בשיעור</Link>
            <button className="btn ghost" type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>לחזור לתחילת השיעור</button>
            <button className="btn ghost" type="button" onClick={() => nav('/guided')}>למסלול</button>
          </div>
        </div>
        {source && <SourceModal refs={source} onClose={() => setSource(null)} />}
        {fig && <FigureModal figureId={fig} onClose={() => setFig(null)} />}
      </div>
    );
  }


  return (
    <div className="narrow stack fade-in">
      <div className="row between">
        <Link to="/guided" className="btn ghost">‹ לכל השיעורים</Link>
        <span className="chip">{status === 'mastered' ? 'נשלט 100%' : status === 'locked' ? 'לימוד חופשי (נעול במסלול)' : 'במסלול המודרך'}</span>
      </div>
      {speech.supported && step < steps.length && steps[step]?.type !== 'check' && (
        <div className="row"><ReadAloud owner={listenOwner} icon="🎧" label="האזנה לכל השיעור" testId="listen-all" build={() => {
          const segs: SpeechSegment[] = [];
          steps.forEach((s, i) => {
            if (i < step) return;
            if (s.type === 'explain') { const c = explainSegments(s.title, s.blocks, `lesson:${id}:${i}`); if (c.length) c[c.length - 1] = { ...c[c.length - 1], pauseAfterMs: PAUSE.block + 450 }; segs.push(...c); }
            else if (s.type === 'figure' && s.caption) segs.push(...segmentsFromText(s.caption, { blockId: `lesson:${id}:${i}:fig`, after: PAUSE.block + 450 }));
          });
          return segs;
        }} /></div>
      )}
      <div>
        <span className="muted small">שיעור <Num>{idx + 1}</Num> · עמודים <Num>{lesson.pages[0]}–{lesson.pages[1]}</Num></span>
        <h1>{lesson.title}</h1>
        <Progress value={steps.length ? step / steps.length : 1} />
        <div className="muted small" style={{ marginTop: 4 }}>שלב <Num>{Math.min(step + 1, steps.length)}</Num> מתוך <Num>{steps.length}</Num></div>
      </div>

      {cur?.type === 'explain' && (
        <div className="card explain stack" data-testid="explain-step" key={`s${step}`}>
          <div className="row between card-head">
            {cur.title ? <Speakable as="h2" id={`lesson:${id}:${step}:title`}>{cur.title}</Speakable> : <span />}
            <ReadAloud owner={`lesson:${id}:${step}`} auto label="הקראת הכרטיס" build={() => explainSegments(cur.title, cur.blocks, `lesson:${id}:${step}`)} testId="read-card" />
          </div>
          {(cur.figures ?? []).map((f) => (
            <figure className="fig" key={f}><img src={figureUrl(f)} alt="איור מקורי מהחוברת" onClick={() => setFig(f)} /><figcaption>איור מקורי מהחוברת (לחצו להגדלה)</figcaption></figure>
          ))}
          {cur.blocks.map((b, i) => <Block b={b} id={`lesson:${id}:${step}:${i}`} key={i} />)}
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
