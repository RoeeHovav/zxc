import { useEffect, useMemo, useRef, useState } from 'react';
import { answerToText, defaultAnswer } from '../../domain/answers';
import { correctAnswerText, isAnswerComplete } from '../../domain/grade';
import { canRequestHint, currentHints, requestHint, revealAnswer, startPractice, submitPractice, type PracticeState } from '../../domain/practice';
import { presentQuestion } from '../../domain/present';
import type { Answer, Outcome, Question } from '../../domain/types';
import { useApp } from '../../app/store';
import { FigureModal, SourceModal } from './SourceModal';
import { QuestionView } from './QuestionView';

export interface PracticeQuestionProps {
  question: Question;
  seed: string;
  /** called once, when the attempt is finished (correct or revealed) */
  onResolved: (outcome: Outcome, st: PracticeState) => void;
  onNext?: () => void;
  nextLabel?: string;
  showLessonTitle?: boolean;
}

const OUTCOME_LABEL: Record<Outcome, string> = {
  first_try: 'נכון בניסיון הראשון – ידע עצמאי',
  retry: 'נכון בניסיון חוזר',
  hinted: 'נכון בעזרת רמזים',
  wrong: 'לא נכון',
  revealed: 'התשובה נחשפה',
};

/** Supportive practice: progressive hints, retry, reveal, short explanation, one-click exact source. */
export function PracticeQuestion({ question: q, seed, onResolved, onNext, nextLabel = 'המשך', showLessonTitle }: PracticeQuestionProps) {
  const { store, lessonTitle } = useApp();
  const presented = useMemo(() => presentQuestion(q, seed), [q, seed]);
  const [st, setSt] = useState<PracticeState>(() => startPractice(q));
  const [answer, setAnswer] = useState<Answer>(() => defaultAnswer(presented));
  const [lastWrong, setLastWrong] = useState(false);
  const [source, setSource] = useState(false);
  const [fig, setFig] = useState<string | null>(null);
  const [flagged, setFlagged] = useState(false);
  const resolved = useRef(false);

  useEffect(() => { setSt(startPractice(q)); setAnswer(defaultAnswer(presented)); setLastWrong(false); setFlagged(false); resolved.current = false; }, [q, presented]);

  const done = st.status !== 'answering';
  const hints = currentHints(q, st);

  const submit = () => {
    if (done || !isAnswerComplete(q, answer)) return;
    const r = submitPractice(q, st, answer);
    setSt(r.state);
    setLastWrong(!r.correct && !r.revealed);
    if ((r.correct || r.revealed) && !resolved.current) { resolved.current = true; onResolved(r.state.outcome ?? 'wrong', r.state); }
    else if (!r.correct && !r.revealed) {
      // keep free-text/multi answers editable; choice answers are cleared so the learner re-decides
      if (answer.type === 'mcq' || answer.type === 'compare') setAnswer({ type: answer.type, value: null });
    }
  };

  const reveal = () => {
    if (done) return;
    const s2 = revealAnswer(q, st);
    setSt(s2);
    if (!resolved.current) { resolved.current = true; onResolved('revealed', s2); }
  };

  const flag = async () => {
    const note = window.prompt('מה לדעתכם לא תקין בבדיקת התשובה? (אופציונלי)') ?? '';
    await store?.addFlag({ questionId: q.id, ts: Date.now(), note, givenAnswer: answerToText(q, answer) });
    setFlagged(true);
  };

  return (
    <div className="stack fade-in" data-testid="practice-question">
      <div className="meta">
        {showLessonTitle && <span className="chip">{lessonTitle(q.lessonId)}</span>}
        <span className="chip">{['', 'קל', 'בינוני', 'מאתגר'][q.difficulty]}</span>
      </div>
      <QuestionView presented={presented} answer={answer} onChange={setAnswer} onSubmit={submit} disabled={done} eliminated={st.eliminated} reveal={done} onFigure={setFig} />

      {!done && lastWrong && (
        <div className="feedback bad" role="alert" data-testid="wrong-feedback">
          <h3>לא נכון – נסו שוב</h3>
          <div>לא נורא. הנה רמז שיעזור להיזכר.</div>
        </div>
      )}
      {hints.map((h, i) => (
        <div className="hint" key={i} data-testid="hint"><b>רמז {i + 1}:</b> {h}</div>
      ))}

      {!done && (
        <div className="row">
          <button className="btn primary" type="button" onClick={submit} disabled={!isAnswerComplete(q, answer)} data-testid="submit">בדיקה</button>
          <button className="btn" type="button" onClick={() => setSt(requestHint(q, st))} disabled={!canRequestHint(q, st)} data-testid="hint-btn">רמז</button>
          <button className="btn ghost" type="button" onClick={reveal} data-testid="reveal-btn">הצגת התשובה</button>
        </div>
      )}

      {done && (
        <div className={`feedback ${st.status === 'correct' ? 'ok' : 'bad'} fade-in`} data-testid="feedback" data-outcome={st.outcome}>
          <h3>{st.status === 'correct' ? '✓ נכון' : 'התשובה הנכונה'}</h3>
          <div className="chip" style={{ marginBottom: 8 }}>{OUTCOME_LABEL[st.outcome ?? 'wrong']}</div>
          {st.status === 'revealed' && <div className="answer-box" data-testid="correct-answer">{correctAnswerText(q)}</div>}
          <p style={{ margin: '6px 0' }}>{q.explanation}</p>
          <div className="row">
            <button className="btn" type="button" onClick={() => setSource(true)} data-testid="source-btn">המקור בחוברת</button>
            <button className="btn ghost" type="button" onClick={flag} disabled={flagged}>{flagged ? 'הדיווח נשמר' : 'דיווח על שגיאה בבדיקה'}</button>
            {onNext && <button className="btn primary" type="button" onClick={onNext} data-testid="next">{nextLabel}</button>}
          </div>
        </div>
      )}
      {source && <SourceModal refs={q.refs} onClose={() => setSource(false)} />}
      {fig && <FigureModal figureId={fig} onClose={() => setFig(null)} />}
    </div>
  );
}
