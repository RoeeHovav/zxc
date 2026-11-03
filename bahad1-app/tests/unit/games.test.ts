import { describe, expect, it } from 'vitest';
import { addDays } from '../../src/domain/dates';
import { advanceFlashQueue, buildMemoryRound, comboMultiplier, dailyDeck, dailyStreak, flashDeck, nextSurvivalQuestion, pointsFor, tapDeck } from '../../src/domain/games';
import type { MatchQuestion, Question } from '../../src/domain/types';
import { V, mcq, pool, short, tf } from './helpers';

function match(id: string, pairs: [string, string][], o: Partial<MatchQuestion> = {}): MatchQuestion {
  return {
    id, type: 'match', lessonId: 'c1.l1', chapter: 'c1', topic: 'נושא א', factIds: [`${id}.f`], difficulty: 2, pool: 'both', stem: 'התאימו', hints: ['רמז'], explanation: 'הסבר',
    refs: [{ unit: 'p001.u01', page: 5, quote: 'x' }], verification: V,
    left: pairs.map(([l], i) => ({ id: `l${i}`, text: l })), right: pairs.map(([, r], i) => ({ id: `r${i}`, text: r })),
    correct: Object.fromEntries(pairs.map((_, i) => [`l${i}`, `r${i}`])), ...o,
  };
}

describe('scoring', () => {
  it('combo multiplier grows every 3 answers and is capped', () => {
    expect([0, 2, 3, 5, 6, 9, 18, 40].map(comboMultiplier)).toEqual([1, 1, 1.5, 1.5, 2, 2.5, 4, 4]);
  });
  it('points depend on difficulty and on the combo including the current answer', () => {
    expect(pointsFor(1, 1)).toBe(10);
    expect(pointsFor(2, 1)).toBe(15);
    expect(pointsFor(3, 1)).toBe(20);
    expect(pointsFor(1, 4)).toBe(15); // combo 3 before this answer -> x1.5
    expect(pointsFor(3, 7)).toBe(40); // combo 6 before -> x2
  });
});

describe('tap decks (blitz / survival)', () => {
  const bank: Question[] = [...pool(6), tf('t1'), tf('t2', false), short('s1', ['תשובה']), match('m1', [['א', 'ב'], ['ג', 'ד'], ['ה', 'ו']])];
  it('contain only single-tap question types, never short/match', () => {
    const d = tapDeck(bank, { seed: 'x' });
    expect(d.length).toBe(8);
    expect(d.every((q) => q.type === 'mcq' || q.type === 'tf')).toBe(true);
  });
  it('are deterministic per seed, different across seeds', () => {
    const a = tapDeck(bank, { seed: 'a' }).map((q) => q.id);
    expect(tapDeck(bank, { seed: 'a' }).map((q) => q.id)).toEqual(a);
    expect(tapDeck(bank, { seed: 'b' }).map((q) => q.id)).not.toEqual(a);
  });
  it('filter by category and chapter', () => {
    expect(tapDeck(bank, { seed: 'x', category: 'tf' }).map((q) => q.id).sort()).toEqual(['t1', 't2']);
    expect(tapDeck(bank, { seed: 'x', category: 'mcq' }).length).toBe(6);
    expect(tapDeck(bank, { seed: 'x', chapters: ['nope'] })).toEqual([]);
  });
  it('survival raises the difficulty with the streak and falls back when a tier is empty', () => {
    const deck = [mcq('a', { difficulty: 1 }), mcq('b', { difficulty: 2 }), mcq('c', { difficulty: 3 })];
    expect(nextSurvivalQuestion(deck, new Set(), 0)!.id).toBe('a');
    expect(nextSurvivalQuestion(deck, new Set(), 4)!.id).toBe('b');
    expect(nextSurvivalQuestion(deck, new Set(), 9)!.id).toBe('c');
    expect(nextSurvivalQuestion(deck, new Set(['a']), 0)!.id).toBe('b'); // nearest tier
    expect(nextSurvivalQuestion(deck, new Set(['a', 'b', 'c']), 0)).toBeNull();
  });
});

describe('daily challenge', () => {
  const bank = pool(40, (i) => ({ lessonId: `c1.l${(i % 10) + 1}` }));
  it('is identical for a date regardless of bank order, and differs between dates', () => {
    const a = dailyDeck(bank, '2026-11-03').map((q) => q.id);
    expect(a.length).toBe(10);
    expect(dailyDeck([...bank].reverse(), '2026-11-03').map((q) => q.id)).toEqual(a);
    expect(dailyDeck(bank, '2026-11-04').map((q) => q.id)).not.toEqual(a);
  });
  it('spreads over lessons (at most 2 per lesson while other lessons are available) and has no duplicates', () => {
    const d = dailyDeck(bank, '2026-11-03');
    expect(new Set(d.map((q) => q.id)).size).toBe(10);
    const per = new Map<string, number>();
    d.forEach((q) => per.set(q.lessonId, (per.get(q.lessonId) ?? 0) + 1));
    expect(Math.max(...per.values())).toBeLessThanOrEqual(2);
  });
  it('works with a small bank', () => {
    expect(dailyDeck(pool(3), '2026-11-03').length).toBe(3);
    expect(dailyDeck([], '2026-11-03')).toEqual([]);
  });
  it('streak counts consecutive days ending today or yesterday', () => {
    const today = '2026-11-03';
    expect(dailyStreak([], today, (d) => addDays(d, -1))).toBe(0);
    expect(dailyStreak(['2026-11-03', '2026-11-02', '2026-11-01'], today, (d) => addDays(d, -1))).toBe(3);
    expect(dailyStreak(['2026-11-02', '2026-11-01'], today, (d) => addDays(d, -1))).toBe(2); // today not played yet: streak is alive
    expect(dailyStreak(['2026-10-30'], today, (d) => addDays(d, -1))).toBe(0);
  });
});

describe('memory round', () => {
  it('builds unique, unambiguous pairs from verified match questions only', () => {
    const bank: Question[] = [
      match('m1', [['הבירה', 'ירושלים'], ['העיר הגדולה', 'תל אביב'], ['עיר הנמל', 'חיפה']]),
      match('m2', [['הים', 'המלח'], ['הנהר', 'הירדן'], ['האגם', 'הכנרת']]),
      mcq('x1'),
    ];
    const r = buildMemoryRound(bank, { seed: 's', pairs: 6 })!;
    expect(r.pairs.length).toBe(4); // at most 2 pairs per match question for variety
    expect(r.cards.length).toBe(8);
    const texts = r.cards.map((c) => c.text);
    expect(new Set(texts).size).toBe(texts.length);
    for (const p of r.pairs) { // every pair is a real correct mapping
      const q = bank.find((b) => b.id === p.questionId) as MatchQuestion;
      const l = q.left.find((x) => x.text === p.left)!;
      expect(q.right.find((x) => x.id === q.correct[l.id])!.text).toBe(p.right);
    }
  });
  it('is deterministic per seed', () => {
    const bank: Question[] = [match('m1', [['א1', 'ב1'], ['א2', 'ב2'], ['א3', 'ב3']]), match('m2', [['ג1', 'ד1'], ['ג2', 'ד2'], ['ג3', 'ד3']])];
    expect(buildMemoryRound(bank, { seed: 'k', pairs: 4 })!.cards.map((c) => c.id)).toEqual(buildMemoryRound(bank, { seed: 'k', pairs: 4 })!.cards.map((c) => c.id));
  });
  it('skips long and duplicate texts and returns null when fewer than 3 pairs exist', () => {
    const long = 'ט'.repeat(60);
    expect(buildMemoryRound([match('m1', [[long, 'א'], ['ב', 'ג'], ['ד', 'ה']])], { seed: 's' })).toBeNull(); // only 2 usable pairs
    expect(buildMemoryRound([match('m1', [['א', 'ב'], ['א', 'ג'], ['ד', 'ה']])], { seed: 's' })).toBeNull(); // duplicate left text
    expect(buildMemoryRound([mcq('x')], { seed: 's' })).toBeNull();
  });
});

describe('flashcards', () => {
  const bank: Question[] = [short('s1', ['תשובה א'], { answerDisplay: 'תשובה א' }), mcq('m1'), tf('t1', false), match('mm', [['א', 'ב'], ['ג', 'ד'], ['ה', 'ו']])];
  it('use answerable single-answer types and show the verified answer on the back', () => {
    const d = flashDeck(bank, { seed: 'x' });
    expect(d.map((c) => c.id).sort()).toEqual(['m1', 's1', 't1']);
    expect(d.find((c) => c.id === 's1')!.back).toBe('תשובה א');
    expect(d.find((c) => c.id === 'm1')!.back).toBe('ב');
    expect(d.find((c) => c.id === 't1')!.back).toBe('לא נכון');
    expect(d.find((c) => c.id === 't1')!.front).toContain('נכון או לא נכון');
  });
  it('queue: known cards leave, unknown cards come back later', () => {
    expect(advanceFlashQueue(['a', 'b', 'c'], true)).toEqual(['b', 'c']);
    expect(advanceFlashQueue(['a', 'b', 'c'], false, 1)).toEqual(['b', 'a', 'c']);
    expect(advanceFlashQueue(['a', 'b'], false, 4)).toEqual(['b', 'a']);
    expect(advanceFlashQueue(['a'], false)).toEqual(['a']);
    expect(advanceFlashQueue([], true)).toEqual([]);
  });
});
