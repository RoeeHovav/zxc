#!/usr/bin/env node
// Builds re-verification batches (round N) for a given list of ids (the items a fixer changed).
//   node scripts/make-repair-batches.mjs ch1 2 private/content/ch1/changed-r2.json [maxItems=90]
// Output: private/content/<ch>/batches-r<N>.json  with names "<ch>-r<N>-b<k>"; verifiers write verdicts to verdicts/<ch>-r<N>-b<k>.json
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_SRC, loadChapterContent, readJson } from './lib/content-lib.mjs';

const [ch, round, idsFile, max = '90'] = process.argv.slice(2);
const ids = new Set(readJson(idsFile).map((i) => (i.startsWith(`${ch}.`) ? i : `${ch}.${i}`)));
const { facts, lessons, questions } = loadChapterContent(ch);
const items = [];
for (const [kind, arr] of [['fact', facts], ['lesson', lessons], ['question', questions]]) for (const x of arr) if (ids.has(x.id)) items.push({ kind, id: x.id, lesson: kind === 'question' ? x.lessonId : kind === 'lesson' ? x.id : 'facts' });
items.sort((a, b) => a.lesson.localeCompare(b.lesson) || a.kind.localeCompare(b.kind));
const batches = [];
let cur = null;
for (const it of items) {
  if (!cur || cur.itemCount >= Number(max)) { cur = { name: `${ch}-r${round}-b${batches.length + 1}`, lessonIds: [], factIds: [], questionIds: [], itemCount: 0 }; batches.push(cur); }
  (it.kind === 'lesson' ? cur.lessonIds : it.kind === 'fact' ? cur.factIds : cur.questionIds).push(it.id); cur.itemCount++;
}
fs.writeFileSync(path.join(CONTENT_SRC, ch, `batches-r${round}.json`), JSON.stringify(batches, null, 1));
const missing = [...ids].filter((i) => !items.some((x) => x.id === i));
console.log(`${batches.length} batches, ${items.length} items${missing.length ? `, ${missing.length} ids not found (deleted?)` : ''}`);
