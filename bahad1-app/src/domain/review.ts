import { addDays, daysBetween, todayStr } from './dates';
import { hashString, mulberry32, shuffled } from './rng';
import type { LessonState, Outcome, Question, QuestionStat } from './types';

/** Simple deterministic Leitner scheduling (no AI). Box -> days until next review. */
export const BOX_INTERVAL_DAYS = [0, 1, 2, 4, 7, 14, 30] as const;

export function newStat(questionId: string, now: Date = new Date()): QuestionStat {
  return {
    questionId, seen: 0, firstTry: 0, retry: 0, hinted: 0, wrong: 0, revealed: 0,
    lastSeen: 0, lastOutcome: null, box: 0, due: todayStr(now), lastIndependentCorrect: null,
  };
}

/** Outcomes are not equivalent: only an independent (first-try) answer advances the box. */
export function applyOutcome(prev: QuestionStat | undefined, questionId: string, outcome: Outcome, now: Date = new Date()): QuestionStat {
  const s = { ...(prev ?? newStat(questionId, now)) };
  const today = todayStr(now);
  s.seen += 1;
  s.lastSeen = now.getTime();
  s.lastOutcome = outcome;
  switch (outcome) {
    case 'first_try':
      s.firstTry += 1;
      s.box = Math.min(BOX_INTERVAL_DAYS.length - 1, s.box + 1);
      s.due = addDays(today, BOX_INTERVAL_DAYS[s.box]);
      s.lastIndependentCorrect = now.getTime();
      break;
    case 'retry':
      s.retry += 1;
      s.box = Math.max(1, s.box);
      s.due = addDays(today, 1);
      break;
    case 'hinted':
      s.hinted += 1;
      s.box = Math.max(0, s.box - 1);
      s.due = addDays(today, 1);
      break;
    case 'wrong':
      s.wrong += 1;
      s.box = 0;
      s.due = today;
      break;
    case 'revealed':
      s.revealed += 1;
      s.box = 0;
      s.due = today;
      break;
  }
  return s;
}

export function firstTryAccuracy(s: QuestionStat): number {
  return s.seen ? s.firstTry / s.seen : 0;
}

export interface TopicStat { key: string; chapter: string; topic: string; attempts: number; firstTry: number; accuracy: number; lastSeen: number }

export function topicStats(questions: Question[], stats: Record<string, QuestionStat | undefined>): TopicStat[] {
  const map = new Map<string, TopicStat>();
  for (const q of questions) {
    const s = stats[q.id];
    if (!s || !s.seen) continue;
    const key = `${q.chapter}|${q.topic}`;
    const t = map.get(key) ?? { key, chapter: q.chapter, topic: q.topic, attempts: 0, firstTry: 0, accuracy: 0, lastSeen: 0 };
    t.attempts += s.seen;
    t.firstTry += s.firstTry;
    t.lastSeen = Math.max(t.lastSeen, s.lastSeen);
    map.set(key, t);
  }
  return [...map.values()].map((t) => ({ ...t, accuracy: t.attempts ? t.firstTry / t.attempts : 0 }));
}

export function weakTopics(ts: TopicStat[], minAttempts = 4, threshold = 0.7): TopicStat[] {
  return ts.filter((t) => t.attempts >= minAttempts && t.accuracy < threshold).sort((a, b) => a.accuracy - b.accuracy);
}

export interface ReviewInput {
  questions: Question[]; // verified bank
  stats: Record<string, QuestionStat | undefined>;
  lessonStates: Record<string, LessonState | undefined>;
  today: string;
  size: number;
  seed?: string;
}

export interface ReviewItem { question: Question; reason: 'overdue' | 'weak_topic' | 'recent_lesson' | 'stale' | 'fill' }

/** Daily review: previously wrong first, weak topics, recently studied lessons, long-unseen material.
 *  Deterministic for a given (date, seed); at most one question per fact cluster in a session. */
export function buildDailyReview(input: ReviewInput): ReviewItem[] {
  const { questions, stats, lessonStates, today, size } = input;
  const rnd = mulberry32(hashString(`${input.seed ?? 'daily'}|${today}`));
  const studiedLessons = new Set(Object.values(lessonStates).filter((l): l is LessonState => !!l && (!!l.masteredAt || l.stepsDone.length > 0)).map((l) => l.lessonId));
  const pool = questions.filter((q) => {
    const s = stats[q.id];
    return (s && s.seen > 0) || studiedLessons.has(q.lessonId);
  });
  const ts = topicStats(questions, stats);
  const weak = new Set(weakTopics(ts).map((t) => t.key));

  const taken = new Set<string>();
  const factsUsed = new Set<string>();
  const out: ReviewItem[] = [];
  const add = (q: Question, reason: ReviewItem['reason']): boolean => {
    if (taken.has(q.id) || out.length >= size) return false;
    if (q.factIds.some((f) => factsUsed.has(f)) && out.length < size - 1) {
      // allow overlap only when we cannot otherwise fill the session (handled by the final fill pass)
      return false;
    }
    taken.add(q.id);
    q.factIds.forEach((f) => factsUsed.add(f));
    out.push({ question: q, reason });
    return true;
  };

  const jitter = new Map(pool.map((q) => [q.id, rnd()] as const));
  const j = (q: Question) => jitter.get(q.id) ?? 0;

  const overdue = pool
    .filter((q) => { const s = stats[q.id]; return s && s.seen > 0 && s.due <= today; })
    .sort((a, b) => (stats[b.id]!.wrong + stats[b.id]!.revealed) - (stats[a.id]!.wrong + stats[a.id]!.revealed) || stats[a.id]!.due.localeCompare(stats[b.id]!.due) || j(a) - j(b));
  const weakQs = pool
    // inside a weak topic, focus on questions NOT yet answered independently (skip those last answered first-try and not due)
    .filter((q) => weak.has(`${q.chapter}|${q.topic}`) && !(stats[q.id]?.lastOutcome === 'first_try' && stats[q.id]!.due > today))
    .sort((a, b) => ((stats[b.id]?.wrong ?? 0) - (stats[a.id]?.wrong ?? 0)) || j(a) - j(b));
  const recent = pool
    .filter((q) => {
      const l = lessonStates[q.lessonId];
      const when = l?.masteredAt ?? l?.lastOpened ?? 0;
      return l && when && daysBetween(todayStr(new Date(when)), today) <= 7;
    })
    .sort((a, b) => (stats[a.id]?.seen ?? 0) - (stats[b.id]?.seen ?? 0) || j(a) - j(b));
  const stale = pool
    .filter((q) => { const s = stats[q.id]; return s && s.seen > 0 && daysBetween(todayStr(new Date(s.lastSeen)), today) >= 14; })
    .sort((a, b) => stats[a.id]!.lastSeen - stats[b.id]!.lastSeen);

  const quota = { overdue: Math.ceil(size * 0.45), weak: Math.ceil(size * 0.25), recent: Math.ceil(size * 0.2), stale: Math.max(1, Math.floor(size * 0.1)) };
  const fillFrom = (list: Question[], n: number, reason: ReviewItem['reason']) => {
    let c = 0;
    for (const q of list) { if (c >= n) break; if (add(q, reason)) c++; }
  };
  fillFrom(overdue, quota.overdue, 'overdue');
  fillFrom(weakQs, quota.weak, 'weak_topic');
  fillFrom(recent, quota.recent, 'recent_lesson');
  fillFrom(stale, quota.stale, 'stale');
  // top up from remaining buckets in priority order, then (last resort) allow fact overlap
  for (const [list, reason] of [[overdue, 'overdue'], [weakQs, 'weak_topic'], [recent, 'recent_lesson'], [stale, 'stale']] as const) fillFrom(list, size, reason);
  if (out.length < size) {
    // last-resort top-up: skip items answered recently that are not due yet (pointless repetition); prefer never-seen
    // questions of studied lessons, then the longest-unseen ones.
    const worthwhile = (q: Question) => {
      const st = stats[q.id];
      return !st || st.seen === 0 || !(st.due > today && daysBetween(todayStr(new Date(st.lastSeen)), today) < 3);
    };
    const rest = shuffled(pool, rnd).filter((q) => !taken.has(q.id) && worthwhile(q)).sort((a, b) => (stats[a.id]?.lastSeen ?? 0) - (stats[b.id]?.lastSeen ?? 0));
    for (const q of rest) {
      if (out.length >= size) break;
      taken.add(q.id);
      out.push({ question: q, reason: 'fill' });
    }
  }
  return out.slice(0, size);
}

export function dueCount(stats: Record<string, QuestionStat | undefined>, today: string): number {
  return Object.values(stats).filter((s) => s && s.seen > 0 && s.due <= today).length;
}
