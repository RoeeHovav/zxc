import { useMemo, useState } from 'react';
import type { Outcome, Question } from '../../domain/types';
import type { XpMode } from '../../domain/xp';
import { useApp } from '../../app/store';
import { Num, Progress } from './common';
import { PracticeQuestion } from './PracticeQuestion';
import { useToast } from '../toast';

export interface SessionSummary { total: number; counts: Record<Outcome, number>; xp: number; wrongIds: string[] }

/** Runs a list of questions in supportive practice mode (hints, retries) and records every outcome separately. */
export function Session({ title, questions, mode, onFinish, finishLabel = 'סיום', backNode, seedPrefix }: {
  title: string; questions: Question[]; mode: XpMode; onFinish?: (s: SessionSummary) => void | Promise<void>; finishLabel?: string; backNode?: React.ReactNode; seedPrefix?: string;
}) {
  const app = useApp();
  const { achieved } = useToast();
  const [i, setI] = useState(0);
  const [done, setDone] = useState<SessionSummary | null>(null);
  const [counts, setCounts] = useState<Record<Outcome, number>>({ first_try: 0, retry: 0, hinted: 0, wrong: 0, revealed: 0 });
  const [xp, setXp] = useState(0);
  const [wrongIds, setWrongIds] = useState<string[]>([]);
  const seed = useMemo(() => `${seedPrefix ?? 'sess'}|${Date.now()}`, [seedPrefix]);

  if (questions.length === 0) return <div className="empty">אין שאלות להצגה.</div>;
  if (done) {
    const ind = done.counts.first_try;
    return (
      <div className="card stack center fade-in" style={{ alignItems: 'center' }} data-testid="session-summary">
        <h2>{title} – סיכום</h2>
        <div className="grid cols-4" style={{ width: '100%' }}>
          <div className="kpi"><span className="v"><Num>{ind}</Num></span><span className="l">נכון בניסיון ראשון</span></div>
          <div className="kpi"><span className="v"><Num>{done.counts.retry}</Num></span><span className="l">נכון בניסיון חוזר</span></div>
          <div className="kpi"><span className="v"><Num>{done.counts.hinted}</Num></span><span className="l">נכון בעזרת רמזים</span></div>
          <div className="kpi"><span className="v"><Num>{done.counts.revealed}</Num></span><span className="l">נחשפו</span></div>
        </div>
        <p className="muted">אלה קטגוריות שונות: רק תשובה נכונה בניסיון ראשון נחשבת ידע עצמאי. נצברו <Num>{done.xp}</Num> נקודות ניסיון.</p>
        {backNode}
      </div>
    );
  }
  const q = questions[i];
  return (
    <div className="stack fade-in">
      <div className="row between"><h2 style={{ margin: 0 }}>{title}</h2><span className="muted">שאלה <Num>{i + 1}</Num> מתוך <Num>{questions.length}</Num></span></div>
      <Progress value={i / questions.length} />
      <div className="card" key={q.id}>
        <PracticeQuestion question={q} seed={`${seed}|${i}`} showLessonTitle
          onResolved={async (outcome) => {
            const r = await app.recordAnswer(q, outcome, mode);
            achieved(r.unlocked);
            setCounts((c) => ({ ...c, [outcome]: c[outcome] + 1 })); setXp((x) => x + r.xp);
            if (outcome === 'revealed' || outcome === 'wrong') setWrongIds((w) => [...w, q.id]);
          }}
          onNext={async () => {
            if (i + 1 < questions.length) { setI(i + 1); window.scrollTo({ top: 0 }); return; }
            const s: SessionSummary = { total: questions.length, counts, xp, wrongIds };
            setDone(s);
            await onFinish?.(s);
          }}
          nextLabel={i + 1 < questions.length ? 'לשאלה הבאה' : finishLabel} />
      </div>
    </div>
  );
}
