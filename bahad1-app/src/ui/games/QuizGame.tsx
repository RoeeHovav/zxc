import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { defaultAnswer } from '../../domain/answers';
import { comboMultiplier, isTapQuestion, nextSurvivalQuestion, pointsFor } from '../../domain/games';
import { correctAnswerText, gradeAnswer, isAnswerComplete } from '../../domain/grade';
import { presentQuestion } from '../../domain/present';
import type { Answer, Question } from '../../domain/types';
import { useApp } from '../../app/store';
import { Num, fmtTime } from '../components/common';
import { QuestionView } from '../components/QuestionView';
import { SourceModal } from '../components/SourceModal';
import { useToast } from '../toast';

export type QuizMode = 'blitz' | 'survival' | 'daily';
export interface QuizResult { mode: QuizMode; score: number; correct: number; asked: number; bestCombo: number; wrong: Question[]; xp: number; timedOut?: boolean }

interface Props {
  mode: QuizMode;
  deck: Question[];
  seed: string;
  seconds?: number; // blitz
  lives?: number; // survival
  onEnd: (r: QuizResult) => void;
  onQuit: () => void;
}

/** One engine for the question games. Strict grading (one attempt, no hints), results feed the normal review statistics.
 *  blitz: tap an answer, the clock only runs while a question is open; survival: lives, difficulty rises with the streak; daily: fixed set with explanations. */
export function QuizGame({ mode, deck, seed, seconds = 60, lives = 3, onEnd, onQuit }: Props) {
  const app = useApp();
  const { achieved } = useToast();
  const tapMode = mode !== 'daily';
  // the first question is derived without side effects (React may run initialisers twice in development)
  const [q, setQ] = useState<Question | null>(() => (mode === 'survival' ? nextSurvivalQuestion(deck, new Set(), 0) : deck[0] ?? null));
  const used = useRef(new Set<string>(mode === 'survival' && q ? [q.id] : []));
  const index = useRef(1);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const xp = useRef(0);
  const finished = useRef(false);

  const pick = useCallback((streak: number): Question | null => {
    if (mode === 'daily') { const q = deck[index.current] ?? null; index.current++; return q; }
    if (mode === 'survival') { const q = nextSurvivalQuestion(deck, used.current, streak); if (q) used.current.add(q.id); return q; }
    // blitz: walk through the shuffled deck, start over when it is exhausted
    if (!deck.length) return null;
    const q = deck[index.current % deck.length]; index.current++; return q;
  }, [deck, mode]);

  const [ans, setAns] = useState<Answer | null>(null);
  const [verdict, setVerdict] = useState<null | boolean>(null);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [asked, setAsked] = useState(0);
  const [wrong, setWrong] = useState<Question[]>([]);
  const [lastPoints, setLastPoints] = useState(0);
  const [livesLeft, setLivesLeft] = useState(lives);
  const [left, setLeft] = useState(seconds * 1000);
  const [src, setSrc] = useState<Question | null>(null);
  const [round, setRound] = useState(0);
  const verdictRef = useRef<null | boolean>(null);
  verdictRef.current = verdict;

  const pres = useMemo(() => (q ? presentQuestion(q, `${seed}|${round}`) : null), [q, seed, round]);
  useEffect(() => { if (pres) setAns(defaultAnswer(pres)); }, [pres]);

  const finish = useCallback(async (timedOut = false) => {
    if (finished.current) return;
    finished.current = true;
    await chain.current; // let the last answer be stored before the result screen reads the statistics
    onEnd({ mode, score, correct, asked, bestCombo, wrong, xp: xp.current, timedOut });
  }, [asked, bestCombo, correct, mode, onEnd, score, wrong]);

  // nothing to play (empty deck)
  useEffect(() => { if (!q && !finished.current) void finish(); }, [q, finish]);

  // blitz clock: runs only while a question is open (reading the explanation of a mistake is free)
  useEffect(() => {
    if (mode !== 'blitz') return;
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now(); const dt = now - last; last = now;
      if (verdictRef.current !== null) return;
      setLeft((l) => Math.max(0, l - dt));
    }, 200);
    return () => clearInterval(id);
  }, [mode]);
  useEffect(() => { if (mode === 'blitz' && left <= 0 && verdict === null) void finish(true); }, [left, mode, verdict, finish]);

  const advance = useCallback((streak: number) => {
    const next = pick(streak);
    setVerdict(null); setRound((r) => r + 1);
    if (!next) { setQ(null); return; }
    setQ(next);
  }, [pick]);

  const submit = (a: Answer) => {
    if (!q || verdict !== null || !isAnswerComplete(q, a)) return;
    const ok = gradeAnswer(q, a);
    setVerdict(ok); setAsked((n) => n + 1);
    chain.current = chain.current
      .then(() => app.recordAnswer(q, ok ? 'first_try' : 'wrong', 'challenge'))
      .then((r) => { xp.current += r.xp; achieved(r.unlocked); })
      .catch(() => { /* a storage hiccup must never break the game */ });
    if (ok) {
      const c = combo + 1; const pts = pointsFor(q.difficulty, c);
      setCombo(c); setBestCombo((b) => Math.max(b, c)); setCorrect((n) => n + 1); setScore((s) => s + pts); setLastPoints(pts);
      if (tapMode) setTimeout(() => { if (!finished.current) advance(c); }, 650);
    } else {
      setCombo(0); setLastPoints(0); setWrong((w) => (w.some((x) => x.id === q.id) ? w : [...w, q]));
      if (mode === 'survival') setLivesLeft((l) => l - 1);
    }
  };

  const onChange = (a: Answer) => {
    setAns(a);
    if (tapMode && q && isTapQuestion(q)) submit(a);
  };

  const proceed = () => {
    if (mode === 'survival' && livesLeft <= 0) { void finish(); return; }
    if (mode === 'daily' && asked >= deck.length) { void finish(); return; }
    advance(combo);
  };

  const doneKey = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (verdict === false) doneKey.current?.focus(); }, [verdict]);

  if (!q || !pres || !ans) return <div className="empty">אין שאלות מתאימות למשחק הזה.</div>;
  const mult = comboMultiplier(combo);
  return (
    <div className="card stack fade-in game-run" data-testid={`game-${mode}`}>
      <div className="game-hud row between" aria-live="polite">
        {mode === 'blitz' && <span className="chip gold timer" data-testid="game-timer">⏱ <Num>{fmtTime(left)}</Num></span>}
        {mode === 'survival' && <span className="lives" data-testid="game-lives" aria-label={`נותרו ${livesLeft} חיים`}>{Array.from({ length: lives }, (_, i) => <span key={i} aria-hidden style={{ opacity: i < livesLeft ? 1 : 0.2 }}>❤️</span>)}</span>}
        {mode === 'daily' && <span className="chip">שאלה <Num>{Math.min(asked + (verdict === null ? 1 : 0), deck.length)}</Num> מתוך <Num>{deck.length}</Num></span>}
        <span>ניקוד: <b data-testid="game-score"><Num>{score}</Num></b></span>
        {mode !== 'daily' && <span className={`chip ${combo >= 3 ? 'accent' : ''}`} data-testid="game-combo">רצף <Num>{combo}</Num>{mult > 1 ? <> · ×<Num>{mult}</Num></> : null}</span>}
        <button className="btn ghost" type="button" onClick={onQuit}>יציאה</button>
      </div>
      <QuestionView presented={pres} answer={ans} onChange={onChange} onSubmit={() => submit(ans)} disabled={verdict !== null} reveal={verdict !== null} />
      {verdict === null && !(tapMode && isTapQuestion(q)) && (
        <div><button className="btn primary" type="button" onClick={() => submit(ans)} disabled={!isAnswerComplete(q, ans)} data-testid="game-check">בדיקה</button></div>
      )}
      {verdict === true && <div className="feedback ok" data-testid="game-feedback"><b>✓ נכון</b>{lastPoints > 0 && <span className="chip gold" style={{ marginInlineStart: 8 }}>+<Num>{lastPoints}</Num></span>}
        {mode === 'daily' && <><div className="muted" style={{ marginTop: 6 }}>{q.explanation}</div><div className="row" style={{ marginTop: 8 }}><button className="btn primary" type="button" onClick={proceed} data-testid="game-next">{asked >= deck.length ? 'לסיכום' : 'הבאה'}</button><button className="btn ghost" type="button" onClick={() => setSrc(q)}>המקור בחוברת</button></div></>}
      </div>}
      {verdict === false && (
        <div className="feedback bad" data-testid="game-feedback">
          <b>✗ לא נכון</b>
          <div className="answer-box">{correctAnswerText(q)}</div>
          <div className="muted">{q.explanation}</div>
          <div className="row" style={{ marginTop: 8 }}>
            <button ref={doneKey} className="btn primary" type="button" onClick={proceed} data-testid="game-next">{(mode === 'survival' && livesLeft <= 0) || (mode === 'daily' && asked >= deck.length) ? 'לסיכום' : 'המשך'}</button>
            <button className="btn ghost" type="button" onClick={() => setSrc(q)}>המקור בחוברת</button>
          </div>
        </div>
      )}
      {src && <SourceModal refs={src.refs} onClose={() => setSrc(null)} />}
    </div>
  );
}
