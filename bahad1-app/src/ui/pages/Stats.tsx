import { useMemo } from 'react';
import { topicStats } from '../../domain/review';
import { useApp } from '../../app/store';
import { addDays, todayStr } from '../../domain/dates';
import { Num, Progress, pct, useChapters } from '../components/common';

export function Stats() {
  const app = useApp();
  const { stats, bank, lessonStates, assessments, exams, manifest, activityDays, lessonTitle, xp, rank } = app;
  useChapters(null);
  const topics = useMemo(() => topicStats(bank, stats).sort((a, b) => a.accuracy - b.accuracy), [bank, stats]);
  const tot = Object.values(stats).reduce((a, s) => ({ seen: a.seen + s.seen, f: a.f + s.firstTry, r: a.r + s.retry, h: a.h + s.hinted, w: a.w + s.wrong, v: a.v + s.revealed }), { seen: 0, f: 0, r: 0, h: 0, w: 0, v: 0 });
  const repeated = bank.filter((q) => (stats[q.id]?.wrong ?? 0) + (stats[q.id]?.revealed ?? 0) >= 2).slice(0, 8);
  const last14 = Array.from({ length: 14 }, (_, k) => addDays(todayStr(), -13 + k));
  const lessonsAttempted = Object.values(lessonStates).filter((l) => l.attempts > 0);
  return (
    <div className="stack fade-in">
      <h1>סטטיסטיקה והתקדמות</h1>
      <p className="muted">כל הנתונים נשמרים מקומית בדפדפן הזה בלבד ומשקפים את התרגול האמיתי שלכם.</p>
      <div className="grid cols-4">
        <div className="card kpi"><span className="v"><Num>{tot.seen}</Num></span><span className="l">תשובות שנרשמו</span></div>
        <div className="card kpi"><span className="v"><Num>{tot.seen ? pct(tot.f / tot.seen) : '—'}</Num></span><span className="l">דיוק בניסיון ראשון</span></div>
        <div className="card kpi"><span className="v"><Num>{xp}</Num></span><span className="l">נקודות · {rank.name}</span></div>
        <div className="card kpi"><span className="v"><Num>{activityDays.length}</Num></span><span className="l">ימי למידה</span></div>
      </div>
      <div className="card stack"><h2>סוגי התשובות (לא שקולים)</h2>
        {tot.seen === 0 ? <span className="muted">עדיין אין נתונים.</span> : (
          [['נכון בניסיון ראשון (עצמאי)', tot.f, 'var(--ok)'], ['נכון בניסיון חוזר', tot.r, 'var(--accent)'], ['נכון בעזרת רמזים', tot.h, 'var(--warn)'], ['לא נכון', tot.w, 'var(--bad)'], ['נחשף', tot.v, 'var(--muted)']] as const
        ).map(([l, v, c]) => <div key={l} className="bar-row"><span>{l}</span><div className="progress"><i style={{ width: pct(v / tot.seen), background: c }} /></div><Num>{v}</Num></div>)}
      </div>
      <div className="card stack"><h2>פעילות ב-14 הימים האחרונים</h2>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 70 }}>{last14.map((d) => { const on = activityDays.includes(d); return <div key={d} title={d} style={{ flex: 1, height: on ? '100%' : '12%', background: on ? 'var(--accent)' : 'var(--surface-2)', borderRadius: 4 }} />; })}</div>
        <span className="muted small">יום נספר כשהושלמה פעילות משמעותית (5 שאלות לפחות).</span></div>
      <div className="card stack"><h2>ביצועים לפי נושא</h2>
        {topics.length === 0 ? <span className="muted">עדיין אין נתונים.</span> : topics.map((t) => <div key={t.key} className="bar-row"><span>{t.topic}</span><div className="progress"><i style={{ width: pct(t.accuracy), background: t.accuracy < 0.7 ? 'var(--bad)' : undefined }} /></div><span><Num>{pct(t.accuracy)}</Num> <span className="muted small">(<Num>{t.attempts}</Num>)</span></span></div>)}
      </div>
      <div className="card stack"><h2>שליטה בשיעורים</h2>
        {lessonsAttempted.length === 0 ? <span className="muted">טרם בוצעו מבחני שליטה.</span> : <table className="t"><thead><tr><th>שיעור</th><th>ניסיונות</th><th>שיא</th><th>מצב</th></tr></thead><tbody>
          {lessonsAttempted.map((l) => <tr key={l.lessonId}><td>{lessonTitle(l.lessonId)}</td><td><Num>{l.attempts}</Num></td><td><Num>{Math.round(l.bestScore * 100)}%</Num></td><td>{l.masteredAt ? <span className="chip ok">נשלט 100%</span> : <span className="chip warn">לא נשלט</span>}</td></tr>)}</tbody></table>}
        <span className="muted small">מבחני שליטה שבוצעו: <Num>{assessments.length}</Num></span>
      </div>
      <div className="card stack"><h2>טעויות חוזרות</h2>{repeated.length === 0 ? <span className="muted">אין שאלות שנכשלו פעמיים או יותר.</span> : <ul className="list-plain">{repeated.map((q) => <li key={q.id}>{q.stem} <span className="chip bad">× <Num>{(stats[q.id]?.wrong ?? 0) + (stats[q.id]?.revealed ?? 0)}</Num></span></li>)}</ul>}</div>
      <div className="card stack"><h2>כיסוי לפי פרק</h2>
        {manifest?.chapters.map((c) => { const ids = c.lessons.map((l) => l.id); const m = ids.filter((id) => lessonStates[id]?.masteredAt).length; return <div key={c.id} className="stack tight"><div className="row between"><span>{c.title}</span><Num>{m}/{ids.length}</Num></div><Progress value={ids.length ? m / ids.length : 0} gold /></div>; })}
      </div>
      <div className="card stack"><h2>מבחנים</h2>
        {exams.length === 0 ? <span className="muted">טרם בוצעו מבחנים.</span> : <ul className="list-plain">{[...exams].reverse().map((e) => <li key={e.id} className="row between"><span>{new Date(e.ts).toLocaleString('he-IL')}</span><span className="chip accent"><Num>{e.percent}%</Num> · <Num>{e.correct}/{e.total}</Num></span></li>)}</ul>}
      </div>
    </div>
  );
}
