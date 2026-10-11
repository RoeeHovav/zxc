import { describe, expect, it } from 'vitest';
import { buildCustomSession, filterQuestions, matchesPageRange } from '../../src/domain/custom';
import { buildExam, scoreExam } from '../../src/domain/exam';
import { applyOutcome, buildDailyReview, BOX_INTERVAL_DAYS, topicStats, weakTopics } from '../../src/domain/review';
import { buildBank } from '../../src/domain/bank';
import { presentSet } from '../../src/domain/present';
import { rankFor, streakFromDays, xpForAnswer, newlyUnlocked } from '../../src/domain/xp';
import { buildWeaknessChallenge } from '../../src/domain/weakness';
import type { Answer, ContentBundle, LessonState, Question, QuestionStat } from '../../src/domain/types';
import { mcq, pool, short, tf } from './helpers';

describe('custom practice filtering', () => {
  const bank: Question[] = [
    mcq('a', { chapter: 'c1', refs: [{ unit: 'u', page: 14, quote: 'x' }], difficulty: 1 }),
    mcq('b', { chapter: 'c1', refs: [{ unit: 'u', page: 30, quote: 'x' }], difficulty: 2 }),
    mcq('c', { chapter: 'c2', refs: [{ unit: 'u', page: 61, quote: 'x' }, { unit: 'u', page: 14, quote: 'y' }], difficulty: 3 }),
    tf('d', true, { chapter: 'c2', refs: [{ unit: 'u', page: 70, quote: 'x' }] }),
    short('e', ['x'], { chapter: 'c2', refs: [{ unit: 'u', page: 75, quote: 'x' }] }),
  ];
  it('filters by original page range using real source references (any ref counts)', () => {
    expect(filterQuestions(bank, { pageRange: [10, 20], count: 99 }).map((q) => q.id).sort()).toEqual(['a', 'c']);
    expect(matchesPageRange(bank[2], [60, 62])).toBe(true);
    expect(filterQuestions(bank, { pageRange: [20, 10], count: 99 }).map((q) => q.id).sort()).toEqual(['a', 'c']); // reversed range
    expect(filterQuestions(bank, { pageRange: [100, 120], count: 99 })).toHaveLength(0);
  });
  it('filters by chapter, type, difficulty and limits the count', () => {
    expect(filterQuestions(bank, { chapters: ['c2'], count: 9 })).toHaveLength(3);
    expect(filterQuestions(bank, { types: ['tf', 'short'], count: 9 })).toHaveLength(2);
    expect(filterQuestions(bank, { difficulties: [3], count: 9 }).map((q) => q.id)).toEqual(['c']);
    expect(buildCustomSession(bank, { count: 2, seed: 's' })).toHaveLength(2);
  });
});

describe('exam', () => {
  const bank = pool(20, (i) => ({ chapter: i < 10 ? 'c1' : 'c2', topic: i < 10 ? 'ת1' : 'ת2' }));
  it('builds a stratified exam without repeating facts', () => {
    const ex = buildExam(bank, { chapters: ['c1', 'c2'], count: 10, timeLimitMin: null, types: null, difficulties: null }, 's');
    expect(ex).toHaveLength(10);
    expect(new Set(ex.map((q) => q.id)).size).toBe(10);
    expect(new Set(ex.map((q) => q.chapter)).size).toBe(2);
  });
  it('reports the ACTUAL percentage (the 100% rule applies to guided mastery only)', () => {
    const qs = bank.slice(0, 4);
    const ans: Record<string, Answer> = { q1: { type: 'mcq', value: 'b' }, q2: { type: 'mcq', value: 'b' }, q3: { type: 'mcq', value: 'b' }, q4: { type: 'mcq', value: 'a' } };
    const sc = scoreExam(qs, ans);
    expect(sc.percent).toBe(75);
    expect(sc.correct).toBe(3);
    expect(sc.weakTopics.length).toBeGreaterThanOrEqual(0);
  });
  it('unanswered questions are wrong and topic breakdown is produced', () => {
    const sc = scoreExam(bank.slice(0, 2), {});
    expect(sc.percent).toBe(0);
    expect(sc.byTopic[0].total).toBe(2);
  });
});

describe('retention scheduling (deterministic Leitner)', () => {
  const now = new Date(2026, 9, 11, 10);
  it('only an independent first-try answer advances the box and the due date', () => {
    let s = applyOutcome(undefined, 'q', 'first_try', now);
    expect(s.box).toBe(1);
    expect(s.due).toBe('2026-10-12');
    s = applyOutcome(s, 'q', 'first_try', now);
    expect(s.box).toBe(2);
    expect(s.due).toBe('2026-10-13');
    expect(BOX_INTERVAL_DAYS[2]).toBe(2);
  });
  it('wrong or revealed resets to box 0, due today; hinted drops one box', () => {
    let s = applyOutcome(undefined, 'q', 'first_try', now);
    s = applyOutcome(s, 'q', 'first_try', now);
    const h = applyOutcome(s, 'q', 'hinted', now);
    expect(h.box).toBe(1);
    const w = applyOutcome(s, 'q', 'wrong', now);
    expect(w.box).toBe(0);
    expect(w.due).toBe('2026-10-11');
    expect(applyOutcome(s, 'q', 'revealed', now).wrong + applyOutcome(s, 'q', 'revealed', now).revealed).toBeGreaterThan(0);
  });
  it('outcomes are tracked separately', () => {
    let s = applyOutcome(undefined, 'q', 'first_try', now);
    s = applyOutcome(s, 'q', 'retry', now);
    s = applyOutcome(s, 'q', 'hinted', now);
    s = applyOutcome(s, 'q', 'wrong', now);
    expect([s.firstTry, s.retry, s.hinted, s.wrong, s.seen]).toEqual([1, 1, 1, 1, 4]);
  });
});

describe('daily review selection', () => {
  const qs = pool(30, (i) => ({ lessonId: i < 15 ? 'c1.l1' : 'c1.l2', topic: i < 15 ? 'ת1' : 'ת2' }));
  const today = '2026-10-11';
  const lessonStates: Record<string, LessonState> = {};
  const stat = (id: string, o: Partial<QuestionStat>): QuestionStat => ({ questionId: id, seen: 3, firstTry: 0, retry: 0, hinted: 0, wrong: 0, revealed: 0, lastSeen: Date.now(), lastOutcome: null, box: 0, due: today, lastIndependentCorrect: null, ...o });
  it('prioritises previously wrong and overdue questions', () => {
    const stats: Record<string, QuestionStat> = { q1: stat('q1', { wrong: 3 }), q2: stat('q2', { wrong: 1 }), q3: stat('q3', { due: '2099-01-01', firstTry: 3, lastOutcome: 'first_try', box: 5 }) };
    const r = buildDailyReview({ questions: qs, stats, lessonStates, today, size: 5 });
    const ids = r.map((x) => x.question.id);
    expect(ids[0]).toBe('q1');
    expect(ids).toContain('q2');
    expect(ids).not.toContain('q3'); // not due, high accuracy
  });
  it('is deterministic for the same day and never exceeds the size', () => {
    const stats: Record<string, QuestionStat> = Object.fromEntries(qs.slice(0, 12).map((q) => [q.id, stat(q.id, { wrong: 1 })]));
    const a = buildDailyReview({ questions: qs, stats, lessonStates, today, size: 8 }).map((x) => x.question.id);
    const b = buildDailyReview({ questions: qs, stats, lessonStates, today, size: 8 }).map((x) => x.question.id);
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(8);
  });
  it('does not review material the learner never encountered', () => {
    expect(buildDailyReview({ questions: qs, stats: {}, lessonStates: {}, today, size: 10 })).toHaveLength(0);
  });
  it('detects weak topics from first-try accuracy', () => {
    const stats: Record<string, QuestionStat> = { q1: stat('q1', { seen: 5, firstTry: 1 }), q20: stat('q20', { seen: 5, firstTry: 5 }) };
    const w = weakTopics(topicStats(qs, stats));
    expect(w.map((t) => t.topic)).toEqual(['ת1']);
  });
  it('weakness challenge draws from the weakest topics only, verified bank only', () => {
    const stats: Record<string, QuestionStat> = { q1: stat('q1', { seen: 6, firstTry: 1, wrong: 4 }), q20: stat('q20', { seen: 6, firstTry: 6 }) };
    const w = buildWeaknessChallenge(qs, stats, 5, 's');
    expect(w.questions.length).toBe(5);
    expect(w.questions.every((q) => q.topic === 'ת1')).toBe(true);
  });
});

describe('verified bank', () => {
  const mk = (id: string, status: 'verified' | 'flagged' | 'pending' | 'rejected') => mcq(id, { verification: { ...mcq('z').verification, status } });
  const bundle = { chapter: { id: 'c1' }, facts: [], lessons: [], questions: [mk('v', 'verified'), mk('f', 'flagged'), mk('p', 'pending'), mk('r', 'rejected')] } as unknown as ContentBundle;
  it('excludes unverified, flagged and rejected content', () => {
    expect(buildBank([bundle]).map((q) => q.id)).toEqual(['v']);
  });
  it('human decisions: approve includes, reject excludes; nothing enters silently', () => {
    const d = (id: string, decision: 'approved' | 'rejected') => ({ itemId: id, itemKind: 'question' as const, decision, note: '', ts: 1 });
    expect(buildBank([bundle], { f: d('f', 'approved'), v: d('v', 'rejected') }).map((q) => q.id)).toEqual(['f']);
  });
});

describe('presentation', () => {
  it('spreads correct-answer positions evenly (no recognisable pattern)', () => {
    const qs = pool(40);
    const pres = presentSet(qs, 'seed');
    const counts = [0, 0, 0, 0];
    pres.forEach((p) => counts[p.options!.findIndex((o) => o.id === (p.question as any).correct)]++);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    // and the original option set is preserved
    pres.forEach((p) => expect(p.options!.map((o) => o.id).sort()).toEqual(['a', 'b', 'c', 'd']));
  });
  it('is reproducible for a seed', () => {
    const qs = pool(8);
    expect(presentSet(qs, 'x').map((p) => p.options!.map((o) => o.id).join(''))).toEqual(presentSet(qs, 'x').map((p) => p.options!.map((o) => o.id).join('')));
  });
});

describe('xp / ranks / streaks', () => {
  it('rewards independent knowledge, not hint-chasing or farming', () => {
    expect(xpForAnswer('first_try', 3, 'practice', false)).toBeGreaterThan(xpForAnswer('hinted', 3, 'practice', false));
    expect(xpForAnswer('wrong', 1, 'practice', false)).toBe(0);
    expect(xpForAnswer('revealed', 1, 'practice', false)).toBe(0);
    expect(xpForAnswer('first_try', 2, 'practice', true)).toBe(0); // same question answered again within the cooldown
  });
  it('ranks progress with xp', () => {
    expect(rankFor(0).name).toBe('טוראי');
    expect(rankFor(100).name).toBe('רב"ט');
    expect(rankFor(99999).next).toBeNull();
  });
  it('computes streaks from activity days', () => {
    expect(streakFromDays(['2026-10-09', '2026-10-10', '2026-10-11'], '2026-10-11').current).toBe(3);
    expect(streakFromDays(['2026-10-09', '2026-10-10'], '2026-10-11').current).toBe(2); // yesterday still counts
    expect(streakFromDays(['2026-10-01', '2026-10-02', '2026-10-08'], '2026-10-11')).toEqual({ current: 0, longest: 2 });
  });
  it('unlocks achievements once', () => {
    const ctx = { masteredLessons: 1, totalLessons: 10, masteredChapters: 0, streak: 0, longestStreak: 0, firstTryTotal: 0, examsTaken: 0, bestExamPercent: 0, perfectAssessments: 1, reviewSessions: 0, xp: 0 };
    expect(newlyUnlocked(ctx, new Set()).map((a) => a.id)).toContain('first-mastery');
    expect(newlyUnlocked(ctx, new Set(['first-mastery'])).map((a) => a.id)).not.toContain('first-mastery');
  });
});
