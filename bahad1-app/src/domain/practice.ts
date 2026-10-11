import { gradeAnswer } from './grade';
import type { Answer, Outcome, Question } from './types';

/** Supportive practice mode: wrong answer -> hint -> retry -> more specific hint -> reveal (spec 5.2).
 *  The outcome categories are intentionally NOT equivalent. */
export interface PracticeState {
  questionId: string;
  wrongCount: number;
  hintsShown: number;
  manualHints: number;
  eliminated: string[]; // option ids already tried wrongly (choice questions)
  status: 'answering' | 'correct' | 'revealed';
  outcome: Outcome | null;
}

export function startPractice(q: Question): PracticeState {
  return { questionId: q.id, wrongCount: 0, hintsShown: 0, manualHints: 0, eliminated: [], status: 'answering', outcome: null };
}

/** After this many wrong answers the correct answer is revealed. True/false can only be guessed once. */
export function maxWrong(q: Question): number {
  if (q.type === 'tf') return 1;
  return Math.max(1, q.hints.length) + 1;
}

export function currentHints(q: Question, st: PracticeState): string[] {
  return q.hints.slice(0, st.hintsShown);
}

export function canRequestHint(q: Question, st: PracticeState): boolean {
  return st.status === 'answering' && st.hintsShown < q.hints.length;
}

export function requestHint(q: Question, st: PracticeState): PracticeState {
  if (!canRequestHint(q, st)) return st;
  return { ...st, hintsShown: st.hintsShown + 1, manualHints: st.manualHints + 1 };
}

function wrongOptionId(q: Question, a: Answer): string | null {
  if ((q.type === 'mcq' || q.type === 'compare') && a.type === q.type) return (a as { value: string | null }).value;
  return null;
}

export interface SubmitResult { state: PracticeState; correct: boolean; revealed: boolean }

export function submitPractice(q: Question, st: PracticeState, a: Answer): SubmitResult {
  if (st.status !== 'answering') return { state: st, correct: st.status === 'correct', revealed: st.status === 'revealed' };
  if (gradeAnswer(q, a)) {
    const outcome: Outcome =
      st.wrongCount === 0 && st.manualHints === 0 ? 'first_try' : st.wrongCount <= 1 && st.manualHints === 0 ? 'retry' : 'hinted';
    return { state: { ...st, status: 'correct', outcome }, correct: true, revealed: false };
  }
  const wrongCount = st.wrongCount + 1;
  const bad = wrongOptionId(q, a);
  const eliminated = bad ? [...st.eliminated, bad] : st.eliminated;
  if (wrongCount >= maxWrong(q)) {
    return { state: { ...st, wrongCount, eliminated, status: 'revealed', outcome: 'revealed' }, correct: false, revealed: true };
  }
  // automatic next hint after a wrong answer
  const hintsShown = Math.min(q.hints.length, Math.max(st.hintsShown, wrongCount));
  return { state: { ...st, wrongCount, eliminated, hintsShown }, correct: false, revealed: false };
}

export function revealAnswer(_q: Question, st: PracticeState): PracticeState {
  if (st.status !== 'answering') return st;
  return { ...st, status: 'revealed', outcome: 'revealed' };
}

/** Independent knowledge only: correct with no help at all. */
export function isIndependent(outcome: Outcome | null): boolean {
  return outcome === 'first_try';
}
