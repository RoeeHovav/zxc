import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { defaultAnswer } from '../../domain/answers';
import { todayStr } from '../../domain/dates';
import { correctAnswerText, gradeAnswer, isAnswerComplete } from '../../domain/grade';
import { presentQuestion } from '../../domain/present';
import { buildDailyReview, dueCount, topicStats, weakTopics } from '../../domain/review';
import { buildWeaknessChallenge } from '../../domain/weakness';
import { hashString, mulberry32, shuffled } from '../../domain/rng';
import type { Answer, Difficulty, Question } from '../../domain/types';
import { useApp } from '../../app/store';
import { Num, fmtTime, pct, useChapters } from '../components/common';
import { QuestionView } from '../components/QuestionView';
import { Session } from '../components/Session';
import { useToast } from '../toast';

type Tab = 'daily' | 'weak' | 'timed';

export function ReviewHub() {
  const app = useApp();
  const { bank, stats, lessonStates, prefs } = app;
  useChapters(null);
  const [tab, setTab] = useState<Tab>('daily');
  const [run, setRun] = useState<{ kind: Tab; qs: Question[]; label: string } | null>(null);
  const today = todayStr();
  const due = dueCount(stats, today);
  const weak = useMemo(() => weakTopics(topicStats(bank, stats)), [bank, stats]);

  if (run && run.kind !== 'timed') {
    return <Session title={run.label} questions={run.qs} mode={run.kind === 'daily' ? 'review' : 'challenge'} seedPrefix={run.kind}
      onFinish={async () => { if (run.kind === 'daily') { const r = await app.noteReviewSession(); void r; } }}
      backNode={<div className="row"><button className="btn primary" type="button" onClick={() => setRun(null)}>חזרה</button><Link to="/" className="btn">לדף הבית</Link></div>} />;
  }
  return (
    <div className="stack fade-in">
      <div><h1>חזרה ואתגרים</h1><p className="muted">חזרה יומית מתעדפת שאלות שטעיתם בהן, נושאים חלשים, שיעורים אחרונים וחומר שלא נראה זמן רב. כל השאלות מאומתות מול החוברת.</p></div>
      <div className="tabs" role="tablist">
        {([['daily', 'חזרה יומית'], ['weak', 'אתגר חולשות'], ['timed', 'אתגרי זמן ושיאים']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'daily' && (
        <div className="card stack" data-testid="daily-card">
          <h2>חזרה יומית</h2>
          <p>שאלות הממתינות לחזרה: <b><Num>{due}</Num></b>. גודל הסשן: <Num>{prefs.dailyReviewSize}</Num> שאלות (אפשר לשנות בהגדרות).</p>
          <div><button className="btn primary big" type="button" data-testid="start-daily" onClick={() => {
            const items = buildDailyReview({ questions: bank, stats, lessonStates, today, size: prefs.dailyReviewSize });
            setRun({ kind: 'daily', qs: items.map((x) => x.question), label: 'חזרה יומית' });
          }} disabled={bank.length === 0}>התחלת חזרה יומית</button></div>
          <DailyEmpty bank={bank.length} stats={stats} lessonStates={lessonStates} />
        </div>
      )}
      {tab === 'weak' && (
        <div className="card stack">
          <h2>אתגר חולשות</h2>
          {weak.length === 0 ? <p className="muted">עדיין אין מספיק נתוני תרגול כדי לזהות נושאים חלשים (נדרשות לפחות 3 תשובות בנושא).</p> : (
            <ul className="list-plain">{weak.slice(0, 6).map((t) => <li key={t.key} className="bar-row"><span>{t.topic}</span><div className="progress"><i style={{ width: pct(t.accuracy), background: 'var(--bad)' }} /></div><Num>{pct(t.accuracy)}</Num></li>)}</ul>
          )}
          <div><button className="btn primary big" type="button" onClick={() => { const w = buildWeaknessChallenge(bank, stats, 15, `${Date.now()}`); if (w.questions.length) setRun({ kind: 'weak', qs: w.questions, label: 'אתגר חולשות' }); }} disabled={weak.length === 0}>התחלת האתגר</button></div>
        </div>
      )}
      {tab === 'timed' && <TimedChallenge bank={bank} />}
    </div>
  );
}

function DailyEmpty({ bank, stats, lessonStates }: { bank: number; stats: Record<string, unknown>; lessonStates: Record<string, unknown> }) {
  if (bank === 0) return <p className="muted">אין עדיין שאלות מאומתות.</p>;
  if (Object.keys(stats).length === 0 && Object.keys(lessonStates).length === 0) return <p className="muted">החזרה היומית תתמלא כשתתחילו ללמוד: היא מבוססת על חומר שכבר נתקלתם בו.</p>;
  return null;
}

/** Timed quiz with an increasing-difficulty ladder and personal records. Single attempt per question; no hints. */
function TimedChallenge({ bank }: { bank: Question[] }) {
  const app = useApp();
  const { achieved } = useToast();
  const [secs, setSecs] = useState(180);
  const [phase, setPhase] = useState<'setup' | 'run' | 'end'>('setup');
  const [level, setLevel] = useState<Difficulty>(1);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [score, setScore] = useState(0);
  const [asked, setAsked] = useState(0);
  const [q, setQ] = useState<Question | null>(null);
  const [ans, setAns] = useState<Answer | null>(null);
  const [verdict, setVerdict] = useState<null | boolean>(null);
  const [left, setLeft] = useState(0);
  const [records, setRecords] = useState<Record<string, number>>({});
  const [newRecord, setNewRecord] = useState(false);
  const used = useRef(new Set<string>());
  const endAt = useRef(0);
  const [seed] = useState(() => `${Date.now()}`);

  useEffect(() => { app.store?.allRecords().then((r) => setRecords(Object.fromEntries(r.map((x) => [x.id, x.value])))); }, [app.store, phase]);
  const gradable = useMemo(() => bank.filter((x) => ['mcq', 'tf', 'multi', 'compare', 'short', 'blank'].includes(x.type)), [bank]);

  const nextQ = (lv: Difficulty) => {
    const rnd = mulberry32(hashString(`${seed}|${used.current.size}`));
    let pool = gradable.filter((x) => x.difficulty === lv && !used.current.has(x.id));
    if (!pool.length) pool = gradable.filter((x) => !used.current.has(x.id));
    if (!pool.length) { used.current.clear(); pool = gradable; }
    const pick = shuffled(pool, rnd)[0];
    used.current.add(pick.id);
    setQ(pick); setAns(defaultAnswer(presentQuestion(pick, seed))); setVerdict(null);
  };
  const begin = () => { used.current = new Set(); setScore(0); setAsked(0); setStreak(0); setBest(0); setLevel(1); endAt.current = Date.now() + secs * 1000; setLeft(secs * 1000); setNewRecord(false); setPhase('run'); nextQ(1); };

  useEffect(() => {
    if (phase !== 'run') return;
    const id = setInterval(async () => {
      const l = endAt.current - Date.now();
      setLeft(l);
      if (l <= 0) {
        clearInterval(id); setPhase('end');
        const key = `timed-${secs}s-score`;
        const isNew = await app.store!.setRecord(key, score);
        await app.store!.setRecord('timed-best-streak', best);
        setNewRecord(isNew && score > 0);
      }
    }, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, score, best, secs]);

  const pres = useMemo(() => (q ? presentQuestion(q, seed) : null), [q, seed]);
  const submit = async () => {
    if (!q || !ans || verdict !== null || !isAnswerComplete(q, ans)) return;
    const ok = gradeAnswer(q, ans);
    setVerdict(ok); setAsked((n) => n + 1);
    const r = await app.recordAnswer(q, ok ? 'first_try' : 'wrong', 'challenge');
    achieved(r.unlocked);
    if (ok) { setScore((s) => s + 1); const st = streak + 1; setStreak(st); setBest((b) => Math.max(b, st)); if (st % 3 === 0 && level < 3) setLevel((level + 1) as Difficulty); }
    else { setStreak(0); if (level > 1) setLevel((level - 1) as Difficulty); }
  };

  if (phase === 'setup') {
    return (
      <div className="card stack" data-testid="timed-setup">
        <h2>אתגר זמן</h2>
        <p>עונים על כמה שיותר שאלות נכון לפני שהזמן נגמר. הקושי עולה אחרי שלוש תשובות נכונות ברצף ויורד אחרי טעות. ניסיון אחד לכל שאלה, ללא רמזים. אין ניקוד על ניחושים שגויים.</p>
        <label className="field" style={{ maxWidth: 260 }}>משך<select className="text-in" value={secs} onChange={(e) => setSecs(Number(e.target.value))}><option value={60}>דקה</option><option value={180}>3 דקות</option><option value={300}>5 דקות</option></select></label>
        <div className="muted small">שיאים אישיים: {Object.keys(records).length === 0 ? 'עדיין אין' : Object.entries(records).filter(([k]) => k.startsWith('timed')).map(([k, v]) => `${k.includes('streak') ? 'רצף תשובות' : `ניקוד (${k.match(/\d+/)?.[0]} שנ׳)`}: ${v}`).join(' · ')}</div>
        <div><button className="btn primary big" type="button" onClick={begin} disabled={gradable.length === 0}>התחלה</button></div>
      </div>
    );
  }
  if (phase === 'end') {
    return (
      <div className="card stack center" style={{ alignItems: 'center' }} data-testid="timed-end">
        <h2>הזמן נגמר!</h2>
        <div className="kpi"><span className="v"><Num>{score}</Num></span><span className="l">תשובות נכונות מתוך <Num>{asked}</Num></span></div>
        <div className="muted">רצף ארוך ביותר: <Num>{best}</Num></div>
        {newRecord && <span className="chip gold">🏆 שיא אישי חדש!</span>}
        <button className="btn primary" type="button" onClick={() => setPhase('setup')}>עוד סיבוב</button>
      </div>
    );
  }
  return (
    <div className="card stack fade-in">
      <div className="row between"><span className="timer chip gold">{fmtTime(left)}</span><span>ניקוד: <b><Num>{score}</Num></b></span><span className="chip">רמה {['', 'קלה', 'בינונית', 'מאתגרת'][level]}</span><span className="muted">רצף: <Num>{streak}</Num></span></div>
      {pres && ans && <QuestionView presented={pres} answer={ans} onChange={setAns} onSubmit={submit} disabled={verdict !== null} reveal={verdict !== null} />}
      {verdict === null ? <div><button className="btn primary" type="button" onClick={submit} disabled={!ans || !q || !isAnswerComplete(q, ans)}>בדיקה</button></div> : (
        <div className={`feedback ${verdict ? 'ok' : 'bad'}`}><b>{verdict ? '✓ נכון' : '✗ לא נכון'}</b>{!verdict && q && <div className="answer-box">{correctAnswerText(q)}</div>}
          <div style={{ marginTop: 8 }}><button className="btn primary" type="button" onClick={() => nextQ(level)}>הבאה</button></div></div>
      )}
    </div>
  );
}
