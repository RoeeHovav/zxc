import { addDays } from './dates';
import type { Difficulty, Outcome } from './types';

/** Gamification layer. It rewards independent knowledge; guessing / hint-chasing earns (almost) nothing.
 *  It never introduces factual material. */
export const RANKS = [
  { name: 'טוראי', xp: 0 }, { name: 'רב"ט', xp: 100 }, { name: 'סמל', xp: 300 }, { name: 'סמל ראשון', xp: 600 },
  { name: 'רס"ל', xp: 1000 }, { name: 'רס"ר', xp: 1600 }, { name: 'סגן', xp: 2400 }, { name: 'סרן', xp: 3500 },
  { name: 'רס"ן', xp: 5000 }, { name: 'סא"ל', xp: 7000 }, { name: 'אל"ם', xp: 10000 }, { name: 'תא"ל', xp: 14000 }, { name: 'אלוף', xp: 20000 },
] as const;

export function rankFor(xp: number): { index: number; name: string; next: { name: string; xp: number } | null; progress: number } {
  let idx = 0;
  RANKS.forEach((r, i) => { if (xp >= r.xp) idx = i; });
  const cur = RANKS[idx];
  const nxt = RANKS[idx + 1] ?? null;
  return { index: idx, name: cur.name, next: nxt ? { name: nxt.name, xp: nxt.xp } : null, progress: nxt ? (xp - cur.xp) / (nxt.xp - cur.xp) : 1 };
}

export type XpMode = 'practice' | 'review' | 'exam' | 'challenge' | 'lesson_check';

export function xpForAnswer(outcome: Outcome, difficulty: Difficulty, mode: XpMode, alreadyAwardedRecently: boolean): number {
  if (alreadyAwardedRecently) return 0; // no farming the same question
  const base = { 1: 10, 2: 15, 3: 20 }[difficulty];
  switch (outcome) {
    case 'first_try': return mode === 'review' ? Math.round(base * 0.8) : base;
    case 'retry': return 3;
    case 'hinted': return 1;
    default: return 0;
  }
}

export const XP_LESSON_MASTERY = 100;
export const XP_EXAM_BONUS_PER_PERCENT = 0.5; // only for >=50%

export function streakFromDays(days: string[], today: string): { current: number; longest: number } {
  const set = new Set(days);
  let current = 0;
  let cursor = set.has(today) ? today : addDays(today, -1);
  while (set.has(cursor)) { current++; cursor = addDays(cursor, -1); }
  const sorted = [...set].sort();
  let longest = 0, run = 0, prev: string | null = null;
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  return { current, longest };
}

export interface AchievementContext {
  masteredLessons: number; totalLessons: number; masteredChapters: number;
  streak: number; longestStreak: number; firstTryTotal: number; examsTaken: number; bestExamPercent: number;
  perfectAssessments: number; reviewSessions: number; xp: number;
}
export interface AchievementDef { id: string; title: string; description: string; test: (c: AchievementContext) => boolean }

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-mastery', title: 'צעד ראשון', description: 'שליטה של 100% בשיעור הראשון שלך', test: (c) => c.masteredLessons >= 1 },
  { id: 'five-mastery', title: 'חמישה שיעורים', description: 'שליטה מלאה ב-5 שיעורים', test: (c) => c.masteredLessons >= 5 },
  { id: 'twenty-mastery', title: 'עשרים שיעורים', description: 'שליטה מלאה ב-20 שיעורים', test: (c) => c.masteredLessons >= 20 },
  { id: 'chapter-complete', title: 'שער הושלם', description: 'שליטה בכל שיעורי שער אחד', test: (c) => c.masteredChapters >= 1 },
  { id: 'all-complete', title: 'כל החוברת', description: 'שליטה מלאה בכל השיעורים', test: (c) => c.totalLessons > 0 && c.masteredLessons >= c.totalLessons },
  { id: 'streak-3', title: 'שלושה ימים ברצף', description: 'למדת 3 ימים ברציפות', test: (c) => c.longestStreak >= 3 },
  { id: 'streak-7', title: 'שבוע ברצף', description: 'למדת 7 ימים ברציפות', test: (c) => c.longestStreak >= 7 },
  { id: 'streak-30', title: 'חודש ברצף', description: 'למדת 30 ימים ברציפות', test: (c) => c.longestStreak >= 30 },
  { id: 'independent-100', title: '100 תשובות עצמאיות', description: '100 תשובות נכונות בניסיון ראשון, ללא רמזים', test: (c) => c.firstTryTotal >= 100 },
  { id: 'independent-1000', title: '1,000 תשובות עצמאיות', description: '1,000 תשובות נכונות בניסיון ראשון, ללא רמזים', test: (c) => c.firstTryTotal >= 1000 },
  { id: 'first-exam', title: 'מבחן ראשון', description: 'השלמת סימולציית מבחן', test: (c) => c.examsTaken >= 1 },
  { id: 'exam-90', title: 'ציון 90+ במבחן', description: 'ציון של 90% ומעלה בסימולציית מבחן', test: (c) => c.bestExamPercent >= 90 },
  { id: 'review-7', title: 'שבעה תרגולי חזרה', description: 'השלמת 7 סשנים של חזרה יומית', test: (c) => c.reviewSessions >= 7 },
];

export function newlyUnlocked(ctx: AchievementContext, unlocked: Set<string>): AchievementDef[] {
  return ACHIEVEMENTS.filter((a) => !unlocked.has(a.id) && a.test(ctx));
}
