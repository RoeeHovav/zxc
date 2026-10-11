import type { ContentBundle, Question, ReviewDecision } from './types';

/** The verified question bank: ONLY items with verification.status === 'verified' (or explicitly approved/corrected by the
 *  user in the content-review dashboard) enter it. Rejected items never do. Uncertain content is never silently included. */
export function buildBank(bundles: ContentBundle[], decisions: Record<string, ReviewDecision | undefined> = {}): Question[] {
  const out: Question[] = [];
  for (const b of bundles) {
    for (const q of b.questions) {
      const d = decisions[q.id];
      if (d?.decision === 'rejected') continue;
      if (d?.decision === 'corrected' && d.override) { out.push({ ...q, ...d.override, verification: { ...q.verification, status: 'verified', note: 'מתוקן ידנית' } } as Question); continue; }
      if (d?.decision === 'approved' || q.verification.status === 'verified') out.push(q);
    }
  }
  return out;
}
