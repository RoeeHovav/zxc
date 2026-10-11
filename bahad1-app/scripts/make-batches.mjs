#!/usr/bin/env node
// Splits an authored chapter into verification batches (by lesson groups) so independent verifiers can work in parallel.
//   node scripts/make-batches.mjs ch1 [maxQuestionsPerBatch=90]
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_SRC, loadChapterContent } from './lib/content-lib.mjs';

const ch = process.argv[2];
const maxQ = Number(process.argv[3] ?? 90);
const { facts, lessons, questions } = loadChapterContent(ch);
const batches = [];
let cur = null;
const flush = () => { if (cur && cur.lessonIds.length) batches.push(cur); cur = null; };
for (const l of lessons) {
  const qs = questions.filter((q) => q.lessonId === l.id);
  const lessonFacts = new Set([...l.objectives, ...l.steps.flatMap((s) => (s.type === 'explain' ? s.factIds : []))]);
  if (cur && cur.questionIds.length + qs.length > maxQ) flush();
  cur ??= { name: `${ch}-b${batches.length + 1}`, lessonIds: [], factIds: [], questionIds: [] };
  cur.lessonIds.push(l.id);
  qs.forEach((q) => cur.questionIds.push(q.id));
  lessonFacts.forEach((f) => { if (!cur.factIds.includes(f)) cur.factIds.push(f); });
}
flush();
// facts never referenced by a lesson still need a verdict: attach them to the last batch
const assigned = new Set(batches.flatMap((b) => b.factIds));
const orphan = facts.map((f) => f.id).filter((f) => !assigned.has(f));
if (orphan.length && batches.length) batches[batches.length - 1].factIds.push(...orphan);
for (const b of batches) b.itemCount = b.lessonIds.length + b.factIds.length + b.questionIds.length;
fs.writeFileSync(path.join(CONTENT_SRC, ch, 'batches.json'), JSON.stringify(batches, null, 1));
for (const b of batches) console.log(`${b.name}: ${b.lessonIds.length} lessons, ${b.factIds.length} facts, ${b.questionIds.length} questions`);
