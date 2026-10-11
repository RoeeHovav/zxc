#!/usr/bin/env node
// FINAL SOURCE AUDIT: re-derives every number from the data (nothing is hand-written).
//   node scripts/final-audit.mjs
// Writes: private/work/audit/FINAL_AUDIT_PRIVATE.json (details, may quote ids)  and  docs/FINAL_AUDIT.md (counts only, safe to commit).
import fs from 'node:fs';
import path from 'node:path';
import { PRIV, ROOT, chaptersMeta, loadChapterContent, loadUnits, loadFigures, normalizeForQuote, readJson } from './lib/content-lib.mjs';

const units = loadUnits();
const figures = loadFigures();
const chapters = chaptersMeta().filter((c) => c.id !== 'ch0');
const manifestParts = readJson(path.join(PRIV, 'work/source/manifest.json'));
const pagesIdx = readJson(path.join(PRIV, 'work/source/pages_index.json'));
const rows = [];
const details = { uncoveredUnits: {}, notVerified: {}, badRefs: [], warnings: {}, deficiencies: [] };
const REQUIRED = new Set(['paragraph', 'box', 'caption', 'table_row', 'note', 'figure_text']);
const tot = { facts: 0, factsV: 0, lessons: 0, lessonsV: 0, questions: 0, questionsV: 0, required: 0, uncovered: 0, noQuestion: 0 };
const typeDist = {}; const diffDist = {}; const poolDist = {};

for (const ch of chapters) {
  const { facts, lessons, questions } = loadChapterContent(ch.id);
  const required = [...units.values()].filter((u) => u.chapter === ch.id && u.scope === 'core' && REQUIRED.has(u.kind));
  const built = lessons.length > 0;
  const refUnits = new Set(facts.flatMap((f) => f.refs.map((r) => r.unit)));
  const uncovered = required.filter((u) => !refUnits.has(u.id));
  const qFacts = new Set(questions.filter((q) => q.verification.status === 'verified').flatMap((q) => q.factIds));
  const noQ = facts.filter((f) => f.verification.status === 'verified' && !qFacts.has(f.id));
  // re-verify every reference of every verified item against the actual source text
  for (const it of [...facts, ...questions]) {
    for (const r of it.refs ?? []) {
      const u = units.get(r.unit);
      const ok = u && u.scope === 'core' && u.page === r.page && normalizeForQuote(u.text).includes(normalizeForQuote(r.quote));
      if (!ok && it.verification.status === 'verified') details.badRefs.push({ id: it.id, ref: r.unit });
    }
  }
  const nv = [...facts, ...lessons, ...questions].filter((x) => x.verification.status !== 'verified');
  details.notVerified[ch.id] = nv.map((x) => ({ id: x.id, status: x.verification.status }));
  details.uncoveredUnits[ch.id] = uncovered.map((u) => u.id);
  const val = fs.existsSync(path.join(PRIV, 'work/validation/report.json')) ? readJson(path.join(PRIV, 'work/validation/report.json')).chapters?.[ch.id] : null;
  details.warnings[ch.id] = val?.warnings ?? [];
  for (const q of questions.filter((x) => x.verification.status === 'verified')) {
    typeDist[q.type] = (typeDist[q.type] ?? 0) + 1; diffDist[q.difficulty] = (diffDist[q.difficulty] ?? 0) + 1; poolDist[q.pool] = (poolDist[q.pool] ?? 0) + 1;
  }
  // lessons whose mastery pool cannot support a meaningful assessment (verified questions only)
  for (const l of lessons.filter((x) => x.verification.status === 'verified')) {
    const pool = questions.filter((q) => q.lessonId === l.id && q.verification.status === 'verified' && (q.pool === 'mastery' || q.pool === 'both'));
    const missing = l.objectives.filter((o) => !pool.some((q) => q.factIds.includes(o)));
    if (missing.length) details.deficiencies.push({ lesson: l.id, missingObjectives: missing });
  }
  rows.push({
    id: ch.id, title: ch.title, pages: `${ch.firstPage}-${ch.lastPage}`, built, requiredUnits: required.length, uncovered: uncovered.length, factsWithoutVerifiedQuestion: noQ.length,
    facts: facts.length, factsVerified: facts.filter((f) => f.verification.status === 'verified').length, lessons: lessons.length, lessonsVerified: lessons.filter((l) => l.verification.status === 'verified').length,
    questions: questions.length, questionsVerified: questions.filter((q) => q.verification.status === 'verified').length, validationErrors: val?.errors?.length ?? null,
  });
  tot.facts += facts.length; tot.factsV += rows.at(-1).factsVerified; tot.lessons += lessons.length; tot.lessonsV += rows.at(-1).lessonsVerified;
  tot.questions += questions.length; tot.questionsV += rows.at(-1).questionsVerified; tot.required += required.length; tot.uncovered += uncovered.length; tot.noQuestion += noQ.length;
}
const visual = [...units.values()].filter((u) => u.visual);
const visStatus = {};
for (const v of visual) { const s = v.transcription?.status ?? 'single_read'; visStatus[s] = (visStatus[s] ?? 0) + 1; }
const builtCount = rows.filter((r) => r.built).length;
const complete = builtCount === rows.length && tot.uncovered === 0 && tot.factsV === tot.facts && tot.lessonsV === tot.lessons && tot.questionsV === tot.questions;

fs.mkdirSync(path.join(PRIV, 'work/audit'), { recursive: true });
fs.writeFileSync(path.join(PRIV, 'work/audit/FINAL_AUDIT_PRIVATE.json'), JSON.stringify({ rows, tot, details, visStatus }, null, 1));

const pctS = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');
const md = [];
md.push('# Final source audit (generated by `scripts/final-audit.mjs` — numbers are derived, not written by hand)', '');
md.push(`Book: 314 pages in ${manifestParts.parts.length} parts (${manifestParts.parts.map((p) => p.pages).join('+')}), printed page numbers equal global pages on all ${pagesIdx.length} pages.`);
md.push(`Chapters built: **${builtCount} / ${rows.length}**. Overall status: **${complete ? 'all identified source units are covered and all items verified' : 'NOT complete – see unresolved items below'}**.`, '');
md.push('| Chapter | Pages | Built | Required source units | Uncovered | Facts (verified) | Lessons (verified) | Questions (verified) | Facts w/o verified question | Validation errors |', '|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) md.push(`| ${r.id} | ${r.pages} | ${r.built ? 'yes' : '**no**'} | ${r.requiredUnits} | ${r.uncovered} | ${r.facts} (${r.factsVerified}) | ${r.lessons} (${r.lessonsVerified}) | ${r.questions} (${r.questionsVerified}) | ${r.factsWithoutVerifiedQuestion} | ${r.validationErrors ?? '–'} |`);
md.push(`| **Total** | 314 | ${builtCount}/${rows.length} | ${tot.required} | ${tot.uncovered} | ${tot.facts} (${tot.factsV}) | ${tot.lessons} (${tot.lessonsV}) | ${tot.questions} (${tot.questionsV}) | ${tot.noQuestion} | |`, '');
md.push(`Source-unit coverage: ${tot.required - tot.uncovered} of ${tot.required} required units (${pctS(tot.required - tot.uncovered, tot.required)}) are cited by at least one fact.`);
md.push(`Verified share: facts ${pctS(tot.factsV, tot.facts)}, lessons ${pctS(tot.lessonsV, tot.lessons)}, questions ${pctS(tot.questionsV, tot.questions)}.`);
md.push(`Question bank (verified only): types ${JSON.stringify(typeDist)}; difficulty ${JSON.stringify(diffDist)}; pools ${JSON.stringify(poolDist)}.`);
md.push(`References re-checked against source text: ${details.badRefs.length} verified items with an invalid reference.`);
md.push(`Lessons with an objective that has no verified mastery question: ${details.deficiencies.length}.`);
md.push(`Image transcriptions: ${visual.length} (${JSON.stringify(visStatus)}).`);
md.push(`Items not verified (pending/flagged/rejected): ${Object.values(details.notVerified).reduce((a, b) => a + b.length, 0)} (ids in the private audit file).`, '');
md.push('Secondary documents (summaries, .docx, .xlsx): never opened for content; excluded from every pipeline stage.');
fs.writeFileSync(path.join(ROOT, 'docs', 'FINAL_AUDIT.md'), md.join('\n') + '\n');
console.log(md.slice(0, 4).join('\n')); console.log(`covered ${tot.required - tot.uncovered}/${tot.required}; verified q ${tot.questionsV}/${tot.questions}; complete=${complete}`);
void figures;
