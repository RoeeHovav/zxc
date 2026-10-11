import type { Answer, Question } from './types';
import type { Presented } from './present';

/** Empty answer for a question (initial UI state). For `order` the shuffled arrangement is the starting answer. */
export function defaultAnswer(p: Presented): Answer {
  const q: Question = p.question;
  switch (q.type) {
    case 'mcq': case 'compare': return { type: q.type, value: null };
    case 'tf': return { type: 'tf', value: null };
    case 'multi': return { type: 'multi', value: [] };
    case 'short': case 'blank': return { type: q.type, value: '' };
    case 'match': return { type: 'match', value: {} };
    case 'order': return { type: 'order', value: (p.items ?? q.items).map((i) => i.id) };
  }
}

export function answerToText(q: Question, a: Answer | undefined): string {
  if (!a) return '';
  switch (a.type) {
    case 'mcq': case 'compare': return q.type === 'mcq' || q.type === 'compare' ? q.options.find((o) => o.id === a.value)?.text ?? '' : '';
    case 'tf': return a.value === null ? '' : a.value ? 'נכון' : 'לא נכון';
    case 'multi': return q.type === 'multi' ? q.options.filter((o) => a.value.includes(o.id)).map((o) => o.text).join(' · ') : '';
    case 'short': case 'blank': return a.value;
    case 'match': return q.type === 'match' ? q.left.map((l) => `${l.text} ← ${q.right.find((r) => r.id === a.value[l.id])?.text ?? '?'}`).join(' | ') : '';
    case 'order': return q.type === 'order' ? a.value.map((id) => q.items.find((i) => i.id === id)?.text ?? '').join(' > ') : '';
  }
}
