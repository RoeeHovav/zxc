#!/usr/bin/env node
// Coverage matrix:  SOURCE UNIT -> FACT -> LESSON -> QUESTION -> VERIFICATION
//   node scripts/coverage.mjs [chN] [--list]      (writes private/work/coverage/<ch>.json; --list prints uncovered units)
import fs from 'node:fs';
import path from 'node:path';
import { PRIV, chaptersMeta, loadChapterContent, loadUnits } from './lib/content-lib.mjs';

const args = process.argv.slice(2);
const only = args.find((a) => /^ch\d+$/.test(a));
const list = args.includes('--list');
const units = loadUnits();
const REQUIRED = new Set(['paragraph', 'box', 'caption', 'table_row', 'note', 'figure_text']);
fs.mkdirSync(path.join(PRIV, 'work', 'coverage'), { recursive: true });
const summary = [];
for (const ch of chaptersMeta().filter((c) => c.id !== 'ch0' && (!only || c.id === only))) {
  const { facts, lessons, questions } = loadChapterContent(ch.id);
  const required = [...units.values()].filter((u) => u.chapter === ch.id && u.scope === 'core' && REQUIRED.has(u.kind));
  const optional = [...units.values()].filter((u) => u.chapter === ch.id && u.scope === 'core' && !REQUIRED.has(u.kind));
  const excluded = [...units.values()].filter((u) => u.chapter === ch.id && u.scope === 'excluded_footnote');
  const supp = [...units.values()].filter((u) => u.chapter === ch.id && u.scope === 'supplementary');
  const lessonOfFact = new Map();
  for (const l of lessons) for (const s of l.steps) if (s.type === 'explain') for (const f of s.factIds) lessonOfFact.set(f, l.id);
  const row = {};
  for (const u of [...required, ...optional]) row[u.id] = { facts: [], lessons: new Set(), questions: [], verifiedFacts: 0, verifiedQuestions: 0 };
  for (const f of facts) for (const r of f.refs) if (row[r.unit]) {
    row[r.unit].facts.push(f.id);
    if (lessonOfFact.has(f.id)) row[r.unit].lessons.add(lessonOfFact.get(f.id));
    if (f.verification.status === 'verified') row[r.unit].verifiedFacts++;
  }
  for (const q of questions) for (const r of q.refs) if (row[r.unit]) {
    row[r.unit].questions.push(q.id);
    if (q.verification.status === 'verified') row[r.unit].verifiedQuestions++;
  }
  const uncoveredUnits = required.filter((u) => !row[u.id].facts.length);
  const noLesson = required.filter((u) => row[u.id].facts.length && !row[u.id].lessons.size);
  const noQuestion = required.filter((u) => row[u.id].facts.length && !row[u.id].questions.length);
  const covFacts = new Set(questions.flatMap((q) => q.factIds));
  const out = {
    chapter: ch.id, pages: [ch.firstPage, ch.lastPage],
    requiredUnits: required.length, optionalUnits: optional.length, excludedFootnotes: excluded.length, supplementaryBoxes: supp.length,
    facts: facts.length, factsVerified: facts.filter((f) => f.verification.status === 'verified').length,
    lessons: lessons.length, lessonsVerified: lessons.filter((l) => l.verification.status === 'verified').length,
    questions: questions.length, questionsVerified: questions.filter((q) => q.verification.status === 'verified').length,
    unitsWithoutFact: uncoveredUnits.map((u) => u.id), unitsWithoutLesson: noLesson.map((u) => u.id), unitsWithoutQuestion: noQuestion.map((u) => u.id),
    factsWithoutQuestion: facts.filter((f) => !covFacts.has(f.id)).map((f) => f.id),
    matrix: Object.fromEntries(Object.entries(row).map(([k, v]) => [k, { ...v, lessons: [...v.lessons] }])),
  };
  fs.writeFileSync(path.join(PRIV, 'work', 'coverage', `${ch.id}.json`), JSON.stringify(out, null, 1));
  summary.push(out);
  if (facts.length || lessons.length) {
    console.log(`${ch.id} p${ch.firstPage}-${ch.lastPage}: required units ${required.length}, without fact ${uncoveredUnits.length}, without lesson ${noLesson.length}, without question ${noQuestion.length} | facts ${facts.length} (${out.factsVerified} verified), lessons ${lessons.length} (${out.lessonsVerified} verified), questions ${questions.length} (${out.questionsVerified} verified) | facts w/o question ${out.factsWithoutQuestion.length}`);
    if (list) {
      for (const u of uncoveredUnits) console.log(`  UNCOVERED ${u.id} [${u.kind}] ${u.text.slice(0, 90)}`);
    }
  }
}
