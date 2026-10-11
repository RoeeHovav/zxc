import { gradeAnswer } from './grade';
import { hashString, mulberry32, shuffled } from './rng';
import type { Answer, Lesson, LessonState, Question } from './types';

/** ===== 100% mastery rule (spec §6) =====
 *  A lesson is mastered ONLY when every question of a representative assessment is answered correctly,
 *  independently: no hints, no second attempt, unanswered = wrong. */
export const MASTERY_REQUIRED_FRACTION = 1;

export interface AssessmentPlan {
  questions: Question[];
  deficiencies: string[]; // content problems that must be fixed instead of faking mastery
  blocked: boolean; // true when the pool cannot cover every objective
}

export interface AssessmentHistory {
  lastQuestionIds: string[];
  wrongCounts: Record<string, number>;
}

export function masteryPool(lessonId: string, questions: Question[]): Question[] {
  return questions.filter((q) => q.lessonId === lessonId && (q.pool === 'mastery' || q.pool === 'both'));
}

/** Chooses a representative assessment: covers EVERY lesson objective, prefers questions not used in the previous
 *  attempt (different questions on retries), prefers previously failed ones, varies question types. Deterministic per seed. */
export function planAssessment(lesson: Lesson, pool: Question[], history: AssessmentHistory, seed: string): AssessmentPlan {
  const rnd = mulberry32(hashString(`${seed}|${lesson.id}`));
  const deficiencies: string[] = [];
  const objectives = lesson.objectives.length ? lesson.objectives : [...new Set(pool.flatMap((q) => q.factIds))];
  const last = new Set(history.lastQuestionIds);
  const score = (q: Question) =>
    (last.has(q.id) ? 0 : 100) + Math.min(5, history.wrongCounts[q.id] ?? 0) * 8 + rnd() * 10;

  const chosen: Question[] = [];
  const chosenIds = new Set<string>();
  const covered = new Set<string>();
  let blocked = false;

  for (const fact of shuffled(objectives, rnd)) {
    if (covered.has(fact)) continue;
    const candidates = pool.filter((q) => q.factIds.includes(fact) && !chosenIds.has(q.id));
    if (!candidates.length) {
      const any = pool.some((q) => q.factIds.includes(fact));
      deficiencies.push(any ? `objective ${fact}: all covering questions already chosen` : `objective ${fact}: no mastery question`);
      if (!any) blocked = true;
      continue;
    }
    // prefer a question covering several still-uncovered objectives, then freshness / past failure
    const best = candidates
      .map((q) => ({ q, s: score(q) + q.factIds.filter((f) => objectives.includes(f) && !covered.has(f)).length * 15 }))
      .sort((a, b) => b.s - a.s)[0].q;
    chosen.push(best);
    chosenIds.add(best.id);
    best.factIds.forEach((f) => covered.add(f));
  }

  const target = Math.min(Math.max(lesson.assessmentSize, chosen.length), pool.length);
  if (chosen.length < target) {
    const typeCount = new Map<string, number>();
    chosen.forEach((q) => typeCount.set(q.type, (typeCount.get(q.type) ?? 0) + 1));
    const base = new Map(pool.map((q) => [q.id, score(q)] as const)); // scored once: random jitter must not change between comparisons
    const rest = pool.filter((q) => !chosenIds.has(q.id));
    while (chosen.length < target && rest.length) {
      const adj = (q: Question) => (base.get(q.id) ?? 0) - (typeCount.get(q.type) ?? 0) * 4; // favour type variety
      rest.sort((a, b) => adj(b) - adj(a));
      const q = rest.shift()!;
      chosen.push(q);
      typeCount.set(q.type, (typeCount.get(q.type) ?? 0) + 1);
    }
  }
  for (const f of objectives) {
    const n = pool.filter((q) => q.factIds.includes(f)).length;
    if (n === 1) deficiencies.push(`objective ${f}: only one question (a retry repeats it)`);
  }
  if (pool.length < Math.ceil(lesson.assessmentSize * 1.5)) deficiencies.push(`pool ${pool.length} < 1.5 x assessment size ${lesson.assessmentSize}`);
  return { questions: shuffled(chosen, rnd), deficiencies, blocked: blocked || chosen.length === 0 };
}

export interface AssessmentResult {
  total: number;
  correct: number;
  mastered: boolean;
  results: { questionId: string; correct: boolean }[];
}

/** Strict evaluation: unanswered counts as wrong; a single wrong answer => not mastered. No partial credit. */
export function evaluateAssessment(questions: Question[], answers: Record<string, Answer | undefined>): AssessmentResult {
  const results = questions.map((q) => {
    const a = answers[q.id];
    return { questionId: q.id, correct: a ? gradeAnswer(q, a) : false };
  });
  const correct = results.filter((r) => r.correct).length;
  const total = questions.length;
  return { total, correct, mastered: total > 0 && correct / total >= MASTERY_REQUIRED_FRACTION && correct === total, results };
}

/* ---------- guided path ------------------------------------------------------------------------------------- */

export type GuidedStatus = 'mastered' | 'available' | 'locked';

/** Guided progression: lesson i can be assessed only after ALL earlier guided lessons are mastered. Browsing and
 *  practice are never blocked by this (see `canStudy`). */
export function guidedStatuses(orderedLessonIds: string[], states: Record<string, LessonState | undefined>): Record<string, GuidedStatus> {
  const out: Record<string, GuidedStatus> = {};
  let allPriorMastered = true;
  for (const id of orderedLessonIds) {
    const mastered = !!states[id]?.masteredAt;
    out[id] = mastered ? 'mastered' : allPriorMastered ? 'available' : 'locked';
    if (!mastered) allPriorMastered = false;
  }
  return out;
}

export function canTakeAssessment(status: GuidedStatus): boolean {
  return status !== 'locked';
}

/** Free browsing & practice are always allowed regardless of guided locks. */
export function canStudy(_status: GuidedStatus): boolean {
  return true;
}

export function nextGuidedLesson(orderedLessonIds: string[], statuses: Record<string, GuidedStatus>): string | null {
  return orderedLessonIds.find((id) => statuses[id] === 'available') ?? null;
}
