import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { answerToText, defaultAnswer } from '../../domain/answers';
import { correctAnswerText, isAnswerComplete } from '../../domain/grade';
import { canTakeAssessment, evaluateAssessment, masteryPool, planAssessment, type AssessmentPlan, type AssessmentResult } from '../../domain/mastery';
import { presentSet, type Presented } from '../../domain/present';
import type { Answer, Question } from '../../domain/types';
import { useApp } from '../../app/store';
import { Num, useChapters } from '../components/common';
import { QuestionView } from '../components/QuestionView';
import { FigureModal, SourceModal } from '../components/SourceModal';
import { useToast } from '../toast';

/** STRICT mastery assessment: no hints, no feedback during the attempt, one locked answer per question, 100% required. */
export function AssessmentPage() {
  const { id = '' } = useParams();
  const app = useApp();
  const { achieved } = useToast();
  const chapterId = id.split('.')[0];
  const { bundles, loading } = useChapters([chapterId]);
  const lesson = bundles[chapterId]?.lessons.find((l) => l.id === id);
  const status = app.statuses[id];

  const [phase, setPhase] = useState<'intro' | 'running' | 'result'>('intro');
  const [plan, setPlan] = useState<AssessmentPlan | null>(null);
  const [presented, setPresented] = useState<Presented[]>([]);
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [cur, setCur] = useState<Answer | null>(null);
  const [result, setResult] = useState<(AssessmentResult & { firstMastery: boolean; xpGained: number }) | null>(null);
  const [src, setSrc] = useState<Question | null>(null);
  const [fig, setFig] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pool = useMemo(() => masteryPool(id, app.bank), [app.bank, id]);

  if (loading && !lesson) return <div className="empty">טוען…</div>;
  if (!lesson) return <div className="card"><h2>השיעור לא נמצא</h2><Link to="/guided" className="btn">חזרה</Link></div>;
  if (!canTakeAssessment(status ?? 'locked')) {
    return (
      <div className="card narrow stack" data-testid="locked-assessment">
        <h2>מבחן השליטה נעול</h2>
        <p>במסלול המודרך ניגשים למבחן השליטה של שיעור רק אחרי ש<b>כל</b> השיעורים שלפניו נשלטו ב-100%. אפשר ללמוד ולתרגל את השיעור הזה בחופשיות.</p>
        <div className="row"><Link to={`/lesson/${id}`} className="btn primary">ללימוד השיעור</Link><Link to={`/practice?lesson=${encodeURIComponent(id)}`} className="btn">תרגול חופשי</Link><Link to="/guided" className="btn ghost">למסלול</Link></div>
      </div>
    );
  }

  const start = () => {
    const ls = app.lessonStates[id];
    const wrongCounts: Record<string, number> = {};
    for (const q of pool) { const s = app.stats[q.id]; if (s) wrongCounts[q.id] = s.wrong + s.revealed; }
    const seed = `${id}|${(ls?.attempts ?? 0) + 1}|${Date.now()}`;
    const p = planAssessment(lesson, pool, { lastQuestionIds: ls?.lastQuestionIds ?? [], wrongCounts }, seed);
    setPlan(p);
    if (p.blocked) return;
    const pres = presentSet(p.questions, seed);
    setPresented(pres); setI(0); setAnswers({}); setCur(defaultAnswer(pres[0])); setResult(null); setPhase('running');
  };

  const confirm = async () => {
    const p = presented[i];
    const a = cur!;
    if (!isAnswerComplete(p.question, a)) return;
    const next = { ...answers, [p.question.id]: a };           // the answer is LOCKED here: no going back, no retry, no hint
    setAnswers(next);
    if (i + 1 < presented.length) { setI(i + 1); setCur(defaultAnswer(presented[i + 1])); window.scrollTo({ top: 0 }); return; }
    setSaving(true);
    const qs = presented.map((x) => x.question);
    const ev = evaluateAssessment(qs, next);
    const saved = await app.completeAssessment(lesson, qs.map((q) => q.id), ev.results, qs);
    achieved(saved.unlocked);
    setResult({ ...ev, firstMastery: saved.firstMastery, xpGained: saved.xpGained });
    setSaving(false); setPhase('result');
  };

  if (phase === 'intro') {
    const ls = app.lessonStates[id];
    return (
      <div className="narrow stack fade-in">
        <Link to={`/lesson/${id}`} className="btn ghost">‹ לשיעור</Link>
        <div className="card stack" data-testid="assessment-intro">
          <h1>מבחן שליטה: {lesson.title}</h1>
          <ul>
            <li>השיעור נחשב נשלט <b>רק ב-100%</b>: כל השאלות נכונות.</li>
            <li><b>ללא רמזים</b>, ללא ניסיון שני וללא משוב בזמן המבחן. כל תשובה ננעלת באישור.</li>
            <li>טעות אחת פירושה שהשליטה לא הושגה – תקבלו הסבר ותרגול מומלץ, ותוכלו לנסות שוב עם שאלות שונות.</li>
            {ls?.attempts ? <li>ניסיונות קודמים: <Num>{ls.attempts}</Num> · הציון הגבוה ביותר: <Num>{Math.round(ls.bestScore * 100)}%</Num>.</li> : null}
          </ul>
          {plan?.blocked && (
            <div className="feedback bad" role="alert" data-testid="blocked">
              <h3>אי אפשר להעריך שליטה בשיעור הזה כרגע</h3>
              <p>במאגר השאלות המאומת חסרות שאלות שמכסות את כל יעדי השיעור. כדי לא להעניק שליטה מדומה, המבחן לא יתחיל. הליקוי דווח בלוח בקרת המקורות.</p>
              <ul>{plan.deficiencies.slice(0, 5).map((d) => <li key={d}>{d}</li>)}</ul>
            </div>
          )}
          {pool.length === 0 && <div className="feedback bad">אין שאלות מאומתות לשיעור זה.</div>}
          <div className="row"><button className="btn primary big" type="button" onClick={start} disabled={pool.length === 0} data-testid="start-assessment">התחלת המבחן</button><Link to={`/practice?lesson=${encodeURIComponent(id)}`} className="btn">קודם נתרגל</Link></div>
        </div>
      </div>
    );
  }

  if (phase === 'running') {
    const p = presented[i];
    return (
      <div className="narrow stack fade-in" data-testid="assessment-running">
        <div className="row between"><span className="chip gold">מבחן שליטה – ללא רמזים</span><span className="muted">שאלה <Num>{i + 1}</Num> מתוך <Num>{presented.length}</Num></span></div>
        <div className="dots" aria-hidden>{presented.map((_, k) => <span key={k} className={`dot ${k < i ? 'done' : k === i ? 'cur' : ''}`} />)}</div>
        <div className="card stack" key={p.question.id}>
          <QuestionView presented={p} answer={cur!} onChange={setCur} onSubmit={confirm} onFigure={setFig} />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn primary big" type="button" onClick={confirm} disabled={!isAnswerComplete(p.question, cur!) || saving} data-testid="confirm-answer">
              {i + 1 < presented.length ? 'אישור ומעבר לשאלה הבאה' : 'אישור וסיום המבחן'}
            </button>
          </div>
          <div className="muted small">אחרי האישור אי אפשר לחזור לתשובה.</div>
        </div>
        {fig && <FigureModal figureId={fig} onClose={() => setFig(null)} />}
      </div>
    );
  }

  const r = result!;
  const pctVal = r.total ? Math.round((r.correct / r.total) * 100) : 0;
  const wrong = presented.filter((p) => !r.results.find((x) => x.questionId === p.question.id)?.correct);
  return (
    <div className="narrow stack fade-in" data-testid="assessment-result">
      <div className="card stack center" style={{ alignItems: 'center' }}>
        <div className="result-ring" style={{ ['--p' as string]: pctVal, ['--ring' as string]: r.mastered ? 'var(--ok)' : 'var(--bad)' }}><span><Num>{pctVal}%</Num></span></div>
        <h1 style={{ margin: 0 }} data-testid="result-title">{r.mastered ? 'שליטה הושגה – 100%!' : 'שליטה עדיין לא הושגה'}</h1>
        <p style={{ margin: 0 }}>ענית נכון על <Num>{r.correct}</Num> מתוך <Num>{r.total}</Num> שאלות.{' '}
          {r.mastered ? (r.firstMastery ? `השיעור נשלט. הרווחת ${r.xpGained} נקודות ניסיון, והשיעור הבא נפתח במסלול.` : 'שליטה כבר נרשמה בעבר; התוצאה נשמרה.') : 'במבחן שליטה נדרשים 100%: טעות אחת פירושה שהשיעור אינו נשלט עדיין. הנה מה שכדאי לחזק.'}</p>
        <div className="row">
          {r.mastered ? <Link to="/guided" className="btn primary" data-testid="continue-guided">להמשך המסלול</Link>
            : <><button className="btn primary" type="button" onClick={() => { setPhase('intro'); setPlan(null); }} data-testid="retry">ניסיון נוסף (שאלות שונות)</button>
              <Link to={`/practice?lesson=${encodeURIComponent(id)}`} className="btn">תרגול מומלץ בשיעור</Link>
              <Link to={`/lesson/${id}`} className="btn">לחזור על החומר</Link></>}
        </div>
        {!r.mastered && <div className="muted small">השאלות שנענו לא נכון נוספו לחזרות היומיות שלכם.</div>}
      </div>

      {wrong.length > 0 && (
        <div className="card stack">
          <h2>מה לחזק</h2>
          {wrong.map((p) => (
            <div key={p.question.id} className="stack tight" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }} data-testid="wrong-item">
              <b>{p.question.stem}</b>
              <div className="muted">התשובה שלכם: {answerToText(p.question, answers[p.question.id]) || '—'}</div>
              <div className="answer-box">התשובה הנכונה: {correctAnswerText(p.question)}</div>
              <div>{p.question.explanation}</div>
              <div><button className="btn" type="button" onClick={() => setSrc(p.question)}>המקור בחוברת</button></div>
            </div>
          ))}
        </div>
      )}
      {r.mastered && <div className="card"><h3>כל התשובות נכונות</h3><p className="muted">השליטה נרשמה על בסיס ביצוע עצמאי, ללא רמזים. הנושאים יחזרו בחזרות היומיות כדי לבדוק שהידע נשמר.</p></div>}
      {src && <SourceModal refs={src.refs} onClose={() => setSrc(null)} />}
    </div>
  );
}
