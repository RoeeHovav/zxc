/** Game logic (pure, deterministic, no runtime AI). Every game draws ONLY from the verified question bank, so a game can never show an
 *  unverified claim; correctness is graded by the same strict grader as practice and exams. */
import { correctAnswerText } from './grade';
import { hashString, mulberry32, shuffled } from './rng';
import type { Difficulty, MatchQuestion, Question } from './types';

// ---------------------------------------------------------------------------------------------------------------------------
// scoring
// ---------------------------------------------------------------------------------------------------------------------------
const BASE_POINTS: Record<Difficulty, number> = { 1: 10, 2: 15, 3: 20 };

/** x1 for combos 0-2, x1.5 for 3-5, x2 for 6-8 … capped at x4 (combo 18+). */
export function comboMultiplier(combo: number): number {
  return Math.min(4, 1 + Math.floor(Math.max(0, combo) / 3) * 0.5);
}

/** Points for a correct answer; `comboAfter` is the combo including this answer. Wrong answers earn nothing and reset the combo. */
export function pointsFor(difficulty: Difficulty, comboAfter: number): number {
  return Math.round(BASE_POINTS[difficulty] * comboMultiplier(comboAfter - 1));
}

// ---------------------------------------------------------------------------------------------------------------------------
// tap games: Blitz and Survival (single tap = answer, so only single-choice types)
// ---------------------------------------------------------------------------------------------------------------------------
export type TapCategory = 'all' | 'tf' | 'mcq';
export const TAP_CATEGORY_LABEL: Record<TapCategory, string> = { all: 'הכול', tf: 'נכון / לא נכון', mcq: 'אמריקאיות' };

export function isTapQuestion(q: Question): boolean { return q.type === 'mcq' || q.type === 'tf' || q.type === 'compare'; }

export function tapDeck(bank: Question[], opts: { chapters?: string[]; category?: TapCategory; seed: string }): Question[] {
  const cat = opts.category ?? 'all';
  const pool = bank.filter((q) => isTapQuestion(q)
    && (!opts.chapters?.length || opts.chapters.includes(q.chapter))
    && (cat === 'all' || (cat === 'tf' ? q.type === 'tf' : q.type === 'mcq' || q.type === 'compare')));
  return shuffled(pool, mulberry32(hashString(`${opts.seed}|tap`)));
}

/** Survival: difficulty rises with the current streak (0-2 easy, 3-7 medium, 8+ hard) but falls back to any unused question when a tier runs out.
 *  Deterministic for a given seed and history. Returns null when the deck is exhausted. */
export function nextSurvivalQuestion(deck: Question[], used: ReadonlySet<string>, streak: number): Question | null {
  const unused = deck.filter((q) => !used.has(q.id));
  if (!unused.length) return null;
  const target: Difficulty = streak < 3 ? 1 : streak < 8 ? 2 : 3;
  return unused.find((q) => q.difficulty === target)
    ?? unused.find((q) => Math.abs(q.difficulty - target) === 1)
    ?? unused[0];
}

// ---------------------------------------------------------------------------------------------------------------------------
// daily challenge: the same 10 questions for everyone on a given date
// ---------------------------------------------------------------------------------------------------------------------------
export function dailyDeck(bank: Question[], date: string, n = 10): Question[] {
  const rnd = mulberry32(hashString(`daily|${date}`));
  const order = shuffled([...bank].sort((a, b) => a.id.localeCompare(b.id)), rnd); // sort first: the result must not depend on bank order
  const perLesson = new Map<string, number>();
  const perType = new Map<string, number>();
  const out: Question[] = [];
  const taken = new Set<string>();
  // variety first, relaxing step by step only when the bank is too small for the strict caps
  for (const [lessonCap, typeCap] of [[2, 4], [2, 99], [3, 99], [99, 99]]) {
    for (const q of order) {
      if (out.length >= n) break;
      if (taken.has(q.id) || (perLesson.get(q.lessonId) ?? 0) >= lessonCap || (perType.get(q.type) ?? 0) >= typeCap) continue;
      perLesson.set(q.lessonId, (perLesson.get(q.lessonId) ?? 0) + 1);
      perType.set(q.type, (perType.get(q.type) ?? 0) + 1);
      taken.add(q.id);
      out.push(q);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// memory (flip pairs): pairs come from verified "match" questions, so every pair is a verified relation
// ---------------------------------------------------------------------------------------------------------------------------
export interface MemoryPair { id: string; questionId: string; left: string; right: string }
export interface MemoryCard { id: string; pairId: string; text: string; side: 'l' | 'r' }
export interface MemoryRound { pairs: MemoryPair[]; cards: MemoryCard[] }
const MEMORY_MAX_TEXT = 48;
export const MEMORY_MIN_PAIRS = 3;

export function buildMemoryRound(bank: Question[], opts: { seed: string; pairs?: number; chapters?: string[] }): MemoryRound | null {
  const want = opts.pairs ?? 6;
  const rnd = mulberry32(hashString(`${opts.seed}|memory`));
  const matches = shuffled(bank.filter((q): q is MatchQuestion => q.type === 'match' && (!opts.chapters?.length || opts.chapters.includes(q.chapter))), rnd);
  const texts = new Set<string>(); // no two cards may show the same text, otherwise the "right" partner would be ambiguous
  const pairs: MemoryPair[] = [];
  for (const q of matches) {
    let fromThis = 0;
    for (const l of shuffled(q.left, rnd)) {
      if (pairs.length >= want || fromThis >= 2) break;
      const r = q.right.find((x) => x.id === q.correct[l.id]);
      if (!r || l.text.length > MEMORY_MAX_TEXT || r.text.length > MEMORY_MAX_TEXT || texts.has(l.text) || texts.has(r.text) || l.text === r.text) continue;
      texts.add(l.text); texts.add(r.text);
      pairs.push({ id: `${q.id}|${l.id}`, questionId: q.id, left: l.text, right: r.text });
      fromThis++;
    }
    if (pairs.length >= want) break;
  }
  if (pairs.length < MEMORY_MIN_PAIRS) return null;
  const cards: MemoryCard[] = pairs.flatMap((p) => [
    { id: `${p.id}|l`, pairId: p.id, text: p.left, side: 'l' as const },
    { id: `${p.id}|r`, pairId: p.id, text: p.right, side: 'r' as const },
  ]);
  return { pairs, cards: shuffled(cards, rnd) };
}

// ---------------------------------------------------------------------------------------------------------------------------
// flashcards (self-check, no grading, no XP): front = the question, back = the verified answer
// ---------------------------------------------------------------------------------------------------------------------------
export interface FlashCard { id: string; question: Question; front: string; back: string }

export function flashDeck(bank: Question[], opts: { seed: string; chapters?: string[]; lessonId?: string }): FlashCard[] {
  const pool = bank.filter((q) => (q.type === 'short' || q.type === 'blank' || q.type === 'mcq' || q.type === 'tf' || q.type === 'multi')
    && (!opts.chapters?.length || opts.chapters.includes(q.chapter)) && (!opts.lessonId || q.lessonId === opts.lessonId));
  return shuffled(pool, mulberry32(hashString(`${opts.seed}|flash`)))
    .map((q) => ({ id: q.id, question: q, front: q.type === 'tf' ? `${q.stem}\n(נכון או לא נכון?)` : q.stem, back: correctAnswerText(q) }));
}

/** Flashcard session queue: the head card is processed — a known card leaves, an unknown one returns `gap` cards later (or at the end). */
export function advanceFlashQueue(queue: readonly string[], known: boolean, gap = 4): string[] {
  if (!queue.length) return [];
  const [head, ...rest] = queue;
  if (known) return rest;
  const at = Math.min(gap, rest.length);
  return [...rest.slice(0, at), head, ...rest.slice(at)];
}

// ---------------------------------------------------------------------------------------------------------------------------
// daily-challenge streak, from the dates (YYYY-MM-DD) on which a daily challenge was played
// ---------------------------------------------------------------------------------------------------------------------------
export function dailyStreak(playedDates: string[], today: string, prev: (d: string) => string): number {
  const set = new Set(playedDates);
  let cur = set.has(today) ? today : prev(today);
  let n = 0;
  while (set.has(cur)) { n++; cur = prev(cur); }
  return n;
}
