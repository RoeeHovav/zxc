import { hashString, mulberry32, shuffled } from './rng';
import { topicStats, weakTopics } from './review';
import type { Question, QuestionStat } from './types';

/** Weakness challenge: questions from the user's weakest topics, previously-missed ones first. Verified bank only. */
export function buildWeaknessChallenge(bank: Question[], stats: Record<string, QuestionStat | undefined>, count: number, seed: string): { questions: Question[]; topics: string[] } {
  const rnd = mulberry32(hashString(`${seed}|weak`));
  const weak = weakTopics(topicStats(bank, stats), 3, 0.8);
  const keys = new Set(weak.map((t) => t.key));
  const pool = bank.filter((q) => keys.has(`${q.chapter}|${q.topic}`));
  const missed = (q: Question) => (stats[q.id]?.wrong ?? 0) + (stats[q.id]?.revealed ?? 0) + (stats[q.id]?.hinted ?? 0);
  const ordered = shuffled(pool, rnd).sort((a, b) => missed(b) - missed(a));
  return { questions: ordered.slice(0, count), topics: weak.map((t) => t.key) };
}
