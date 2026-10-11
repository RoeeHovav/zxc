import { hashString, mulberry32, shuffled } from './rng';
import type { Difficulty, Question, QuestionType } from './types';

export interface CustomFilter {
  chapters?: string[];
  topics?: string[];
  lessonIds?: string[];
  pageRange?: [number, number] | null; // matches the ORIGINAL book pages cited by the question's source references
  types?: QuestionType[];
  difficulties?: Difficulty[];
  count: number;
  seed?: string;
}

/** A question matches a page range when ANY of its supporting source references lies inside it. */
export function matchesPageRange(q: Question, range: [number, number]): boolean {
  const [a, b] = range[0] <= range[1] ? range : [range[1], range[0]];
  return q.refs.some((r) => r.page >= a && r.page <= b);
}

export function filterQuestions(bank: Question[], f: CustomFilter): Question[] {
  return bank.filter(
    (q) =>
      (!f.chapters?.length || f.chapters.includes(q.chapter)) &&
      (!f.topics?.length || f.topics.includes(q.topic)) &&
      (!f.lessonIds?.length || f.lessonIds.includes(q.lessonId)) &&
      (!f.pageRange || matchesPageRange(q, f.pageRange)) &&
      (!f.types?.length || f.types.includes(q.type)) &&
      (!f.difficulties?.length || f.difficulties.includes(q.difficulty)),
  );
}

export function buildCustomSession(bank: Question[], f: CustomFilter): Question[] {
  const rnd = mulberry32(hashString(`${f.seed ?? 'custom'}|custom`));
  return shuffled(filterQuestions(bank, f), rnd).slice(0, Math.max(0, f.count));
}
