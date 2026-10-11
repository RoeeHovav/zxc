import { filterQuestions } from './custom';
import { hashString, mulberry32, shuffled } from './rng';
import { gradeAnswer } from './grade';
import type { Answer, ExamConfig, Question } from './types';

/** Exam simulation. Not claimed to reproduce the real Bahad 1 exam (only the book's description on p.12 is known:
 *  an anthem-writing task, a blank map and multiple-choice questions). Selection is representative and fact-diverse. */
export function buildExam(bank: Question[], config: ExamConfig, seed: string): Question[] {
  const rnd = mulberry32(hashString(`${seed}|exam`));
  const pool = filterQuestions(bank, {
    chapters: config.chapters, types: config.types ?? undefined, difficulties: config.difficulties ?? undefined, count: 0,
  });
  // stratify by chapter proportionally to pool size, at most one question per primary fact
  const byChapter = new Map<string, Question[]>();
  for (const q of shuffled(pool, rnd)) (byChapter.get(q.chapter) ?? byChapter.set(q.chapter, []).get(q.chapter)!).push(q);
  const total = Math.min(config.count, pool.length);
  const usedFacts = new Set<string>();
  const picked: Question[] = [];
  const chapterKeys = [...byChapter.keys()];
  const poolSize = pool.length || 1;
  const quotas = new Map(chapterKeys.map((c) => [c, Math.max(1, Math.round((byChapter.get(c)!.length / poolSize) * total))] as const));
  for (const c of chapterKeys) {
    let n = 0;
    for (const q of byChapter.get(c)!) {
      if (n >= quotas.get(c)! || picked.length >= total) break;
      if (q.factIds.some((f) => usedFacts.has(f))) continue;
      q.factIds.forEach((f) => usedFacts.add(f));
      picked.push(q); n++;
    }
  }
  for (const q of shuffled(pool, rnd)) {
    if (picked.length >= total) break;
    if (!picked.includes(q) && !q.factIds.some((f) => usedFacts.has(f))) { q.factIds.forEach((f) => usedFacts.add(f)); picked.push(q); }
  }
  for (const q of shuffled(pool, rnd)) { if (picked.length >= total) break; if (!picked.includes(q)) picked.push(q); }
  return shuffled(picked, rnd).slice(0, total);
}

export interface ExamScore {
  total: number;
  correct: number;
  percent: number; // actual percentage, never altered (the 100% rule governs guided lesson mastery only)
  byTopic: { chapter: string; topic: string; total: number; correct: number }[];
  byChapter: { chapter: string; total: number; correct: number }[];
  results: { questionId: string; correct: boolean; topic: string; chapter: string }[];
  weakTopics: { chapter: string; topic: string; accuracy: number }[];
}

export function scoreExam(questions: Question[], answers: Record<string, Answer | undefined>): ExamScore {
  const results = questions.map((q) => ({ questionId: q.id, correct: answers[q.id] ? gradeAnswer(q, answers[q.id]!) : false, topic: q.topic, chapter: q.chapter }));
  const correct = results.filter((r) => r.correct).length;
  const topicMap = new Map<string, { chapter: string; topic: string; total: number; correct: number }>();
  const chapMap = new Map<string, { chapter: string; total: number; correct: number }>();
  for (const r of results) {
    const t = topicMap.get(`${r.chapter}|${r.topic}`) ?? { chapter: r.chapter, topic: r.topic, total: 0, correct: 0 };
    t.total++; if (r.correct) t.correct++; topicMap.set(`${r.chapter}|${r.topic}`, t);
    const c = chapMap.get(r.chapter) ?? { chapter: r.chapter, total: 0, correct: 0 };
    c.total++; if (r.correct) c.correct++; chapMap.set(r.chapter, c);
  }
  const byTopic = [...topicMap.values()];
  return {
    total: questions.length, correct,
    percent: questions.length ? Math.round((correct / questions.length) * 1000) / 10 : 0,
    byTopic, byChapter: [...chapMap.values()], results,
    weakTopics: byTopic.filter((t) => t.total >= 1 && t.correct / t.total < 0.6).map((t) => ({ chapter: t.chapter, topic: t.topic, accuracy: t.correct / t.total })).sort((a, b) => a.accuracy - b.accuracy),
  };
}
