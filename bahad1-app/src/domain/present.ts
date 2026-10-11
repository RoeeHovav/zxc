import { hashString, mulberry32, shuffled } from './rng';
import type { Option, Question } from './types';

export interface Presented {
  question: Question;
  options?: Option[]; // mcq / multi / compare display order
  right?: Option[]; // match: shuffled answers
  items?: Option[]; // order: initial (never already-correct) arrangement
}

function sameOrder(a: Option[], ids: string[]): boolean {
  return a.length === ids.length && a.every((o, i) => o.id === ids[i]);
}

/** Presents one question with a deterministic shuffle derived from `seed`. */
export function presentQuestion(q: Question, seed: string, targetCorrectIndex?: number): Presented {
  const rnd = mulberry32(hashString(`${seed}|${q.id}`));
  switch (q.type) {
    case 'mcq':
    case 'compare': {
      const correct = q.options.find((o) => o.id === q.correct)!;
      const others = shuffled(q.options.filter((o) => o.id !== q.correct), rnd);
      const idx = Math.min(targetCorrectIndex ?? Math.floor(rnd() * q.options.length), q.options.length - 1);
      const opts = others.slice();
      opts.splice(idx, 0, correct);
      return { question: q, options: opts };
    }
    case 'multi':
      return { question: q, options: shuffled(q.options, rnd) };
    case 'match':
      return { question: q, right: shuffled(q.right, rnd) };
    case 'order': {
      let arr = shuffled(q.items, rnd);
      for (let i = 0; i < 12 && sameOrder(arr, q.correct); i++) arr = shuffled(q.items, rnd);
      return { question: q, items: arr };
    }
    default:
      return { question: q };
  }
}

/** Presents a whole set; correct-answer positions of single-answer choice questions are spread evenly so no
 *  recognisable pattern (e.g. "always C") can be learned. */
export function presentSet(questions: Question[], seed: string): Presented[] {
  const rnd = mulberry32(hashString(`${seed}|set`));
  const byN = new Map<number, number[]>();
  questions.forEach((q, i) => {
    if (q.type === 'mcq' || q.type === 'compare') {
      const n = q.options.length;
      (byN.get(n) ?? byN.set(n, []).get(n)!).push(i);
    }
  });
  const target = new Map<number, number>();
  for (const [n, idxs] of byN) {
    // cycle 0..n-1 so counts differ by at most 1, then randomise which question gets which slot
    const slots = shuffled(Array.from({ length: idxs.length }, (_, k) => k % n), rnd);
    shuffled(idxs, rnd).forEach((qi, k) => target.set(qi, slots[k]));
  }
  return questions.map((q, i) => presentQuestion(q, seed, target.get(i)));
}
