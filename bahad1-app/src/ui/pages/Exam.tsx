import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { answerToText, defaultAnswer } from '../../domain/answers';
import { buildExam, scoreExam, type ExamScore } from '../../domain/exam';
import { correctAnswerText, isAnswerComplete } from '../../domain/grade';
import { presentSet, type Presented } from '../../domain/present';
import type { Answer, ExamConfig, QuestionType } from '../../domain/types';
import { useApp } from '../../app/store';
import { Num, fmtTime, pct, useChapters } from '../components/common';
import { QuestionView } from '../components/QuestionView';
import { SourceModal } from '../components/SourceModal';
import { useToast } from '../toast';

const DEFAULT_TYPES: QuestionType[] = ['mcq', 'tf', 'multi', 'compare'];

export function ExamPage() {
  const app = useApp();
  const { achieved } = useToast();
  const { manifest, bank } = app;
  useChapters(null);
  const [chapters, setChapters] = useState<string[]>([]);
  const [count, setCount] = useState(20);
  const [limit, setLimit] = useState<number>(0);
  const [allTypes, setAllTypes] = useState(false);
  const [phase, setPhase] = useState<'setup' | 'running' | 'result'>('setup');
  const [pres, setPres] = useState<Presented[]>([]);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [i, setI] = useState(0);
  const [started, setStarted] = useState(0);
  const [now, setNow] = useState(0);
  const [score, setScore] = useState<ExamScore | null>(null);
  const [cfg, setCfg] = useState<ExamConfig | null>(null);
  const [src, setSrc] = useState<number | null>(null);
  const submitted = useRef(false);

  const types = allTypes ? null : DEFAULT_TYPES;
  const available = useMemo(() => bank.filter((q) => (!chapters.length || chapters.includes(q.chapter)) && (!types || types.includes(q.type))).length, [bank, chapters, types]);

  const finish = async (auto = false) => {
    if (submitted.current) return;
    if (!auto && !window.confirm('להגיש את המבחן? לא ניתן יהיה לשנות תשובות אחרי ההגשה.')) return;
    submitted.current = true;
    const qs = pres.map((p) => p.question);
    const sc = scoreExam(qs, answers);
    const duration = Date.now() - started;
    const r = await app.recordExam({ ts: Date.now(), config: cfg!, total: sc.total, correct: sc.correct, percent: sc.percent, durationMs: duration, results: sc.results, contentVersion: manifest?.contentVersion ?? '' });
    achieved(r.unlocked);
    setScore(sc); setPhase('result');
  };

  // timer / auto-submit
  useEffect(() => {
    if (phase !== 'running') return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (cfg?.timeLimitMin && t - started >= cfg.timeLimitMin * 60000) finish(true);
    }, 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, cfg, started, pres, answers]);

  const start = () => {
    const c: ExamConfig = { chapters, count, timeLimitMin: limit || null, types, difficulties: null };
    const seed = `${Date.now()}`;
    const qs = buildExam(bank, c, seed);
    if (!qs.length) return;
    const p = presentSet(qs, seed);
    submitted.current = false;
    setCfg(c); setPres(p); setAnswers({}); setFlags({}); setI(0); setStarted(Date.now()); setNow(Date.now()); setScore(null); setPhase('running');
  };

  if (phase === 'setup') {
    return (
      <div className="stack fade-in narrow">
        <div><h1>סימולציית מבחן</h1>
          <p className="muted">מבחן מורכב משאלות מאומתות מהחוברת. בזמן המבחן: אין רמזים, אין משוב על נכונות, אין חשיפת תשובות לפני ההגשה, ואחרי ההגשה לא ניתן לשנות. אפשר לדלג ולחזור בין שאלות לפני ההגשה.</p>
          <p className="muted small">שימו לב: זו סימולציה בלבד. החוברת מתארת (בעמ׳ 12) את מבנה המבחן — כתיבת מילות ההמנון, השלמת מפה אילמת ושאלות אמריקאיות — אך אין בה מפרט מדויק, ולכן המבחן כאן אינו משחזר בהכרח את המבחן האמיתי. ציון המבחן מוצג כאחוז אמיתי.</p></div>
        <div className="card form-grid">
          <div className="stack tight"><b>פרקים</b>{manifest?.chapters.map((c) => <label key={c.id} className="check"><input type="checkbox" checked={chapters.includes(c.id)} onChange={() => setChapters(chapters.includes(c.id) ? chapters.filter((x) => x !== c.id) : [...chapters, c.id])} />{c.title}</label>)}<span className="muted small">ללא בחירה = כל הפרקים</span></div>
          <div className="stack">
            <label className="field">מספר שאלות<input className="text-in" type="number" min={1} max={100} value={count} onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} data-testid="exam-count" /></label>
            <label className="field">מגבלת זמן<select className="text-in" value={limit} onChange={(e) => setLimit(Number(e.target.value))} data-testid="exam-limit"><option value={0}>ללא הגבלת זמן</option><option value={15}>15 דקות</option><option value={30}>30 דקות</option><option value={45}>45 דקות</option><option value={60}>60 דקות</option><option value={90}>90 דקות</option></select></label>
            <label className="check"><input type="checkbox" checked={allTypes} onChange={(e) => setAllTypes(e.target.checked)} />לכלול גם שאלות כתובות, התאמה וסידור</label>
          </div>
        </div>
        <div className="row"><button className="btn primary big" type="button" disabled={available === 0} onClick={start} data-testid="start-exam">התחלת מבחן</button><span className="muted">זמינות <Num>{available}</Num> שאלות מתאימות</span></div>
      </div>
    );
  }

  if (phase === 'running') {
    const p = pres[i];
    const a = answers[p.question.id] ?? defaultAnswer(p);
    const remaining = cfg?.timeLimitMin ? cfg.timeLimitMin * 60000 - (now - started) : null;
    const answered = pres.filter((x) => answers[x.question.id] && isAnswerComplete(x.question, answers[x.question.id])).length;
    return (
      <div className="stack fade-in" data-testid="exam-running">
        <div className="row between">
          <span className="chip gold">מבחן – ללא רמזים וללא משוב</span>
          <span className="timer" data-testid="timer">{remaining !== null ? `נותר ${fmtTime(remaining)}` : `זמן ${fmtTime(now - started)}`}</span>
          <span className="muted">נענו <Num>{answered}</Num>/<Num>{pres.length}</Num></span>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(40px, 1fr))', gap: 6 }} role="navigation" aria-label="ניווט בין שאלות">
          {pres.map((x, k) => {
            const done = answers[x.question.id] && isAnswerComplete(x.question, answers[x.question.id]);
            return <button key={x.question.id} type="button" className="btn" style={{ minHeight: 38, padding: 0, background: k === i ? 'var(--accent)' : done ? 'var(--accent-soft)' : undefined, color: k === i ? 'var(--accent-contrast)' : undefined, outline: flags[x.question.id] ? '2px solid var(--gold)' : undefined }} onClick={() => setI(k)} aria-label={`שאלה ${k + 1}`}><Num>{k + 1}</Num></button>;
          })}
        </div>
        <div className="card stack" key={p.question.id}>
          <QuestionView presented={p} answer={a} onChange={(v) => setAnswers((m) => ({ ...m, [p.question.id]: v }))} />
          <div className="row between">
            <label className="check"><input type="checkbox" checked={!!flags[p.question.id]} onChange={(e) => setFlags({ ...flags, [p.question.id]: e.target.checked })} />סימון לחזרה</label>
            <div className="row">
              <button className="btn" type="button" disabled={i === 0} onClick={() => setI(i - 1)}>הקודמת</button>
              {i + 1 < pres.length ? <button className="btn primary" type="button" onClick={() => setI(i + 1)} data-testid="exam-next">הבאה</button> : <button className="btn primary" type="button" onClick={() => finish(false)} data-testid="exam-submit">הגשת המבחן</button>}
            </div>
          </div>
        </div>
        <div><button className="btn danger" type="button" onClick={() => finish(false)} data-testid="exam-submit-any">הגשת המבחן עכשיו</button></div>
      </div>
    );
  }

  const sc = score!;
  return (
    <div className="stack fade-in" data-testid="exam-result">
      <div className="card stack center" style={{ alignItems: 'center' }}>
        <div className="result-ring" style={{ ['--p' as string]: sc.percent }}><span><Num>{sc.percent}%</Num></span></div>
        <h1 style={{ margin: 0 }}>ציון המבחן: <Num>{sc.percent}%</Num></h1>
        <p style={{ margin: 0 }}><Num>{sc.correct}</Num> תשובות נכונות מתוך <Num>{sc.total}</Num>. זהו הציון בפועל — דרישת ה-100% חלה רק על שליטה בשיעורי המסלול המודרך.</p>
        <div className="row"><button className="btn primary" type="button" onClick={() => setPhase('setup')}>מבחן חדש</button><Link to="/review" className="btn">לחזרה ולאתגרים</Link></div>
      </div>
      <div className="card stack"><h2>ביצועים לפי נושא</h2>
        {sc.byTopic.map((t) => <div key={`${t.chapter}|${t.topic}`} className="bar-row"><span>{t.topic}</span><div className="progress"><i style={{ width: pct(t.correct / t.total), background: t.correct / t.total < 0.6 ? 'var(--bad)' : undefined }} /></div><Num>{t.correct}/{t.total}</Num></div>)}
        {sc.weakTopics.length > 0 && <div className="feedback bad"><b>מומלץ לחזור על:</b> {sc.weakTopics.map((w) => w.topic).join(' · ')}<div style={{ marginTop: 8 }}><Link to="/practice" className="btn">לתרגול ממוקד</Link></div></div>}
      </div>
      <div className="card stack"><h2>סקירת התשובות</h2>
        {pres.map((p, k) => {
          const r = sc.results.find((x) => x.questionId === p.question.id)!;
          return (
            <details key={p.question.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              <summary><span className={`chip ${r.correct ? 'ok' : 'bad'}`}>{r.correct ? 'נכון' : 'שגוי'}</span> <Num>{k + 1}</Num>. {p.question.stem}</summary>
              <div className="stack tight" style={{ marginTop: 8 }}>
                <div className="muted">התשובה שלכם: {answerToText(p.question, answers[p.question.id]) || '— (לא נענתה)'}</div>
                <div className="answer-box">התשובה הנכונה: {correctAnswerText(p.question)}</div>
                <div>{p.question.explanation}</div>
                <div><button className="btn" type="button" onClick={() => setSrc(k)}>המקור בחוברת</button></div>
              </div>
            </details>
          );
        })}
      </div>
      {src !== null && <SourceModal refs={pres[src].question.refs} onClose={() => setSrc(null)} />}
    </div>
  );
}
