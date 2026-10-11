#!/usr/bin/env node
// After apply-verdicts: lists every fail/uncertain item with the verifier's note, grouped by lesson, for a FIXER agent.
//   node scripts/export-fixlist.mjs ch1      -> private/content/ch1/fixlist.json
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_SRC, loadChapterContent } from './lib/content-lib.mjs';

const ch = process.argv[2];
const { facts, lessons, questions } = loadChapterContent(ch);
const lessonOf = new Map();
for (const l of lessons) { lessonOf.set(l.id, l.id); for (const s of l.steps) if (s.type === 'explain') for (const f of s.factIds) if (!lessonOf.has(f)) lessonOf.set(f, l.id); }
const items = [];
for (const [kind, arr] of [['fact', facts], ['lesson', lessons], ['question', questions]]) {
  for (const x of arr) {
    const st = x.verification.status;
    if (st === 'verified') continue;
    items.push({ id: x.id, kind, lesson: kind === 'question' ? x.lessonId : lessonOf.get(x.id) ?? (kind === 'lesson' ? x.id : null), status: st, verdict: x.verification.independent?.verdict ?? null, note: x.verification.independent?.notes ?? null, programmatic: x.verification.programmatic });
  }
}
const noVerdict = items.filter((i) => !i.verdict);
fs.writeFileSync(path.join(CONTENT_SRC, ch, 'fixlist.json'), JSON.stringify(items, null, 1));
const c = (a) => a.reduce((m, x) => ((m[x.kind] = (m[x.kind] ?? 0) + 1), m), {});
console.log(`${ch}: ${items.length} items need attention`, JSON.stringify(c(items)), `| without any verdict: ${noVerdict.length}`);
