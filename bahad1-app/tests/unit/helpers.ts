import type { Lesson, McqQuestion, Question, ShortQuestion, TfQuestion, Verification } from '../../src/domain/types';

/** Synthetic fixtures ONLY (no book content). */
export const V: Verification = { status: 'verified', generatedBy: 'test', programmatic: { quotesFound: true, answerKeyValid: true, noExcludedSource: true } };

export function mcq(id: string, o: Partial<McqQuestion> = {}): McqQuestion {
  return {
    id, type: 'mcq', lessonId: 'c1.l1', chapter: 'c1', topic: 'נושא א', factIds: [`${id}.f`], difficulty: 1, pool: 'both', stem: `שאלה ${id}`,
    options: [{ id: 'a', text: 'א' }, { id: 'b', text: 'ב' }, { id: 'c', text: 'ג' }, { id: 'd', text: 'ד' }], correct: 'b',
    hints: ['רמז 1', 'רמז 2'], explanation: 'הסבר', refs: [{ unit: 'p001.u01', page: 5, quote: 'x' }], verification: V, ...o,
  };
}
export function tf(id: string, correct = true, o: Partial<TfQuestion> = {}): TfQuestion {
  return { id, type: 'tf', lessonId: 'c1.l1', chapter: 'c1', topic: 'נושא א', factIds: [`${id}.f`], difficulty: 1, pool: 'both', stem: 'נכון?', correct, hints: ['רמז'], explanation: 'הסבר', refs: [{ unit: 'p001.u01', page: 5, quote: 'x' }], verification: V, ...o };
}
export function short(id: string, accepted: string[], o: Partial<ShortQuestion> = {}): ShortQuestion {
  return { id, type: 'short', lessonId: 'c1.l1', chapter: 'c1', topic: 'נושא א', factIds: [`${id}.f`], difficulty: 2, pool: 'both', stem: 'כתוב', accepted, answerDisplay: accepted[0], hints: ['רמז 1'], explanation: 'הסבר', refs: [{ unit: 'p001.u01', page: 5, quote: 'x' }], verification: V, ...o };
}
export function lesson(o: Partial<Lesson> = {}): Lesson {
  return { id: 'c1.l1', chapter: 'c1', order: 1, title: 'שיעור בדיקה', pages: [1, 2], objectives: [], steps: [], assessmentSize: 4, verification: V, ...o };
}
export function pool(n: number, o: (i: number) => Partial<McqQuestion> = () => ({})): Question[] {
  return Array.from({ length: n }, (_, i) => mcq(`q${i + 1}`, o(i)));
}
