import { normalizeAnswer } from './normalize';
import type { Answer, Question } from './types';

/** Deterministic, all-or-nothing grading. No partial credit, no semantic matching, no runtime AI. */
export function isAnswerComplete(q: Question, a: Answer | undefined): boolean {
  if (!a || a.type !== q.type) return false;
  switch (q.type) {
    case 'mcq':
    case 'compare':
      return (a as Extract<Answer, { value: string | null }>).value != null;
    case 'tf':
      return (a as Extract<Answer, { type: 'tf' }>).value != null;
    case 'multi':
      return (a as Extract<Answer, { type: 'multi' }>).value.length > 0;
    case 'short':
    case 'blank':
      return normalizeAnswer((a as Extract<Answer, { type: 'short' | 'blank' }>).value).length > 0;
    case 'match':
      return Object.keys((a as Extract<Answer, { type: 'match' }>).value).length === q.left.length;
    case 'order':
      return (a as Extract<Answer, { type: 'order' }>).value.length === q.items.length;
  }
}

export function gradeAnswer(q: Question, a: Answer): boolean {
  if (a.type !== q.type) return false;
  switch (q.type) {
    case 'mcq':
    case 'compare':
      return (a as { value: string | null }).value === q.correct;
    case 'tf':
      return (a as { value: boolean | null }).value === q.correct;
    case 'multi': {
      const given = new Set((a as { value: string[] }).value);
      const want = new Set(q.correct);
      return given.size === want.size && [...want].every((id) => given.has(id));
    }
    case 'short':
    case 'blank': {
      const v = normalizeAnswer((a as { value: string }).value);
      return v.length > 0 && q.accepted.some((acc) => normalizeAnswer(acc) === v);
    }
    case 'match': {
      const given = (a as { value: Record<string, string> }).value;
      return q.left.every((l) => given[l.id] === q.correct[l.id]) && Object.keys(given).length === q.left.length;
    }
    case 'order': {
      const given = (a as { value: string[] }).value;
      return given.length === q.correct.length && given.every((id, i) => id === q.correct[i]);
    }
  }
}

/** Human readable correct answer (used only after the attempt is over). */
export function correctAnswerText(q: Question): string {
  switch (q.type) {
    case 'mcq':
    case 'compare':
      return q.options.find((o) => o.id === q.correct)?.text ?? '';
    case 'tf':
      return q.correct ? 'נכון' : 'לא נכון';
    case 'multi':
      return q.options.filter((o) => q.correct.includes(o.id)).map((o) => o.text).join(' · ');
    case 'short':
    case 'blank':
      return q.answerDisplay;
    case 'match':
      return q.left.map((l) => `${l.text} ← ${q.right.find((r) => r.id === q.correct[l.id])?.text ?? ''}`).join(' | ');
    case 'order':
      return q.correct.map((id, i) => `${i + 1}. ${q.items.find((x) => x.id === id)?.text ?? ''}`).join(' | ');
  }
}
