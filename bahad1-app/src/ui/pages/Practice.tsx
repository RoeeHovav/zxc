import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { buildCustomSession, filterQuestions } from '../../domain/custom';
import type { Difficulty, Question, QuestionType } from '../../domain/types';
import { useApp } from '../../app/store';
import { Num, useChapters } from '../components/common';
import { Session } from '../components/Session';

const TYPE_LABEL: Record<QuestionType, string> = { mcq: 'בחירה יחידה', multi: 'בחירה מרובה', tf: 'נכון/לא נכון', short: 'תשובה קצרה', blank: 'השלמה', match: 'התאמה', order: 'סידור', compare: 'השוואה' };

export function PracticePage() {
  const app = useApp();
  const [sp] = useSearchParams();
  const { manifest, bank, lessonTitle } = app;
  useChapters(null);
  const lessonParam = sp.get('lesson');
  const [chapters, setChapters] = useState<string[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [types, setTypes] = useState<QuestionType[]>([]);
  const [diffs, setDiffs] = useState<Difficulty[]>([]);
  const [count, setCount] = useState(10);
  const [session, setSession] = useState<Question[] | null>(null);

  const lessonIds = useMemo(() => (lessonParam ? [lessonParam] : []), [lessonParam]);
  useEffect(() => { if (lessonParam) setChapters([]); }, [lessonParam]);

  const pageRange: [number, number] | null = from && to ? [Number(from), Number(to)] : from ? [Number(from), 999] : to ? [1, Number(to)] : null;
  const filt = { chapters, topics, lessonIds, pageRange, types, difficulties: diffs, count };
  const matching = useMemo(() => filterQuestions(bank, filt), [bank, chapters, topics, lessonIds, from, to, types, diffs]); // eslint-disable-line react-hooks/exhaustive-deps
  const topicOptions = useMemo(() => [...new Set(bank.filter((q) => !chapters.length || chapters.includes(q.chapter)).map((q) => q.topic))], [bank, chapters]);
  const toggle = <T,>(arr: T[], v: T, set: (x: T[]) => void) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  if (session) {
    return <Session title="תרגול מותאם אישית" questions={session} mode="practice" backNode={<div className="row"><button className="btn primary" type="button" onClick={() => setSession(null)}>תרגול נוסף</button><Link to="/" className="btn">לדף הבית</Link></div>} />;
  }
  return (
    <div className="stack fade-in">
      <div><h1>תרגול מותאם אישית</h1><p className="muted">בחרו מה לתרגל. התרגול תומך: רמזים הדרגתיים, ניסיון חוזר ומקור מדויק בחוברת. הסינון לפי עמודים מתבסס על העמודים שאליהם מפנות השאלות בחוברת המקורית.</p></div>
      {lessonParam && <div className="card flat row between"><span>סינון לפי שיעור: <b>{lessonTitle(lessonParam)}</b></span><Link to="/practice" className="btn ghost">ניקוי</Link></div>}
      <div className="card form-grid">
        <div className="stack tight"><b>פרקים</b>
          {manifest?.chapters.map((c) => <label key={c.id} className="check"><input type="checkbox" checked={chapters.includes(c.id)} onChange={() => toggle(chapters, c.id, setChapters)} />{c.title}</label>)}
          <span className="muted small">ללא בחירה = כל הפרקים</span></div>
        <div className="stack tight"><b>נושאים</b>
          <div style={{ maxHeight: 190, overflow: 'auto' }} className="stack tight">{topicOptions.map((t) => <label key={t} className="check"><input type="checkbox" checked={topics.includes(t)} onChange={() => toggle(topics, t, setTopics)} />{t}</label>)}</div></div>
        <div className="stack tight"><b>טווח עמודים מקוריים</b>
          <div className="row"><label className="field">מעמוד<input className="text-in" inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, ''))} aria-label="מעמוד" data-testid="page-from" /></label>
            <label className="field">עד עמוד<input className="text-in" inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, ''))} aria-label="עד עמוד" data-testid="page-to" /></label></div></div>
        <div className="stack tight"><b>סוג שאלה</b>
          <div className="row">{(Object.keys(TYPE_LABEL) as QuestionType[]).map((t) => <label key={t} className="check"><input type="checkbox" checked={types.includes(t)} onChange={() => toggle(types, t, setTypes)} />{TYPE_LABEL[t]}</label>)}</div></div>
        <div className="stack tight"><b>רמת קושי</b>
          <div className="row">{([1, 2, 3] as Difficulty[]).map((d) => <label key={d} className="check"><input type="checkbox" checked={diffs.includes(d)} onChange={() => toggle(diffs, d, setDiffs)} />{['', 'קל', 'בינוני', 'מאתגר'][d]}</label>)}</div></div>
        <label className="field">מספר שאלות<input className="text-in" type="number" min={1} max={100} value={count} onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} data-testid="count" /></label>
      </div>
      <div className="row"><button className="btn primary big" type="button" disabled={matching.length === 0} onClick={() => setSession(buildCustomSession(bank, filt))} data-testid="start-practice">התחלת תרגול</button>
        <span className="muted" data-testid="match-count">נמצאו <Num>{matching.length}</Num> שאלות מאומתות מתאימות</span></div>
    </div>
  );
}
