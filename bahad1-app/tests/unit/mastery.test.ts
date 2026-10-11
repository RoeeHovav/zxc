import { describe, expect, it } from 'vitest';
import { canStudy, canTakeAssessment, evaluateAssessment, guidedStatuses, masteryPool, nextGuidedLesson, planAssessment } from '../../src/domain/mastery';
import type { Answer, LessonState, Question } from '../../src/domain/types';
import { lesson, mcq, pool } from './helpers';

const correct = (qs: Question[]): Record<string, Answer> => Object.fromEntries(qs.map((q) => [q.id, { type: 'mcq', value: 'b' } as Answer]));

describe('100% mastery rule', () => {
  it('all correct => mastered', () => {
    const qs = pool(5);
    const r = evaluateAssessment(qs, correct(qs));
    expect(r.mastered).toBe(true);
    expect(r.correct).toBe(5);
  });
  it('ONE wrong answer => not mastered (even 9/10)', () => {
    const qs = pool(10);
    const ans = correct(qs);
    ans['q4'] = { type: 'mcq', value: 'a' };
    const r = evaluateAssessment(qs, ans);
    expect(r.mastered).toBe(false);
    expect(r.correct).toBe(9);
  });
  it('an unanswered question counts as wrong', () => {
    const qs = pool(3);
    const ans = correct(qs);
    delete ans['q2'];
    expect(evaluateAssessment(qs, ans).mastered).toBe(false);
  });
  it('an empty assessment can never be mastered', () => {
    expect(evaluateAssessment([], {}).mastered).toBe(false);
  });
  it('a corrected answer after a first wrong one does not exist in the engine: only the final locked answer is graded', () => {
    // assessments take ONE answer per question; there is no retry/hint API in mastery.ts
    const qs = pool(2);
    const r = evaluateAssessment(qs, { q1: { type: 'mcq', value: 'a' }, q2: { type: 'mcq', value: 'b' } });
    expect(r.mastered).toBe(false);
  });
});

describe('assessment planning', () => {
  it('covers every lesson objective', () => {
    const qs = pool(12, (i) => ({ factIds: [`f${(i % 6) + 1}`] }));
    const l = lesson({ objectives: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'], assessmentSize: 6 });
    const plan = planAssessment(l, masteryPool(l.id, qs), { lastQuestionIds: [], wrongCounts: {} }, 'a1');
    expect(plan.blocked).toBe(false);
    const covered = new Set(plan.questions.flatMap((q) => q.factIds));
    ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].forEach((f) => expect(covered.has(f)).toBe(true));
  });
  it('prefers different questions on a retry', () => {
    const qs = pool(12, (i) => ({ factIds: [`f${(i % 4) + 1}`] }));
    const l = lesson({ objectives: ['f1', 'f2', 'f3', 'f4'], assessmentSize: 4 });
    const first = planAssessment(l, qs, { lastQuestionIds: [], wrongCounts: {} }, 's1');
    const second = planAssessment(l, qs, { lastQuestionIds: first.questions.map((q) => q.id), wrongCounts: {} }, 's2');
    const overlap = second.questions.filter((q) => first.questions.some((x) => x.id === q.id));
    expect(overlap).toHaveLength(0);
  });
  it('flags a content deficiency (blocked) instead of pretending mastery when an objective has no question', () => {
    const qs = pool(4, (i) => ({ factIds: [`f${i + 1}`] }));
    const l = lesson({ objectives: ['f1', 'f2', 'f9'], assessmentSize: 3 });
    const plan = planAssessment(l, qs, { lastQuestionIds: [], wrongCounts: {} }, 'x');
    expect(plan.blocked).toBe(true);
    expect(plan.deficiencies.some((d) => d.includes('f9'))).toBe(true);
  });
  it('warns when a retry would necessarily repeat the same question', () => {
    const qs = [mcq('q1', { factIds: ['f1'] }), mcq('q2', { factIds: ['f2'] })];
    const plan = planAssessment(lesson({ objectives: ['f1', 'f2'], assessmentSize: 2 }), qs, { lastQuestionIds: [], wrongCounts: {} }, 'x');
    expect(plan.deficiencies.some((d) => d.includes('only one question'))).toBe(true);
  });
  it('is deterministic for the same seed', () => {
    const qs = pool(10, (i) => ({ factIds: [`f${(i % 5) + 1}`] }));
    const l = lesson({ objectives: ['f1', 'f2', 'f3', 'f4', 'f5'], assessmentSize: 5 });
    const a = planAssessment(l, qs, { lastQuestionIds: [], wrongCounts: {} }, 'same').questions.map((q) => q.id);
    const b = planAssessment(l, qs, { lastQuestionIds: [], wrongCounts: {} }, 'same').questions.map((q) => q.id);
    expect(a).toEqual(b);
  });
  it('only mastery-pool questions of the lesson are used', () => {
    const qs: Question[] = [mcq('a', { pool: 'practice' }), mcq('b', { pool: 'mastery' }), mcq('c', { lessonId: 'other', pool: 'both' }), mcq('d', { pool: 'both' })];
    expect(masteryPool('c1.l1', qs).map((q) => q.id).sort()).toEqual(['b', 'd']);
  });
});

describe('guided progression vs free browsing', () => {
  const ids = ['l1', 'l2', 'l3'];
  const ls = (m: string[]): Record<string, LessonState> => Object.fromEntries(m.map((id) => [id, { lessonId: id, masteredAt: 1 } as LessonState]));
  it('unlocks the next lesson only after the previous one is mastered', () => {
    expect(guidedStatuses(ids, {})).toEqual({ l1: 'available', l2: 'locked', l3: 'locked' });
    expect(guidedStatuses(ids, ls(['l1']))).toEqual({ l1: 'mastered', l2: 'available', l3: 'locked' });
    expect(nextGuidedLesson(ids, guidedStatuses(ids, ls(['l1'])))).toBe('l2');
  });
  it('does not unlock l3 if l2 is not mastered even when l1 is', () => {
    expect(guidedStatuses(ids, ls(['l1', 'l3']))).toEqual({ l1: 'mastered', l2: 'available', l3: 'mastered' });
    expect(canTakeAssessment('locked')).toBe(false);
  });
  it('locked lessons are still open for study and practice', () => {
    expect(canStudy('locked')).toBe(true);
  });
});
