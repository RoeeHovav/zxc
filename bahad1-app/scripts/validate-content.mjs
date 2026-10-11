#!/usr/bin/env node
// Content validator: enforces source integrity and educational-quality rules MECHANICALLY.
//   node scripts/validate-content.mjs [--chapter ch1] [--json]
// A quote only counts as supported when it is a verbatim substring of a CORE source unit (footnotes can never support content).
import fs from 'node:fs';
import path from 'node:path';
import {
  CONTENT_SRC, PRIV, chaptersMeta, loadChapterContent, loadFigures, loadUnits, longestVerbatimRun, normalizeAnswer, normalizeForQuote, NONE_OF_ABOVE,
} from './lib/content-lib.mjs';

const args = process.argv.slice(2);
const only = args.includes('--chapter') ? args[args.indexOf('--chapter') + 1] : null;
const units = loadUnits();
const figures = loadFigures();
const chapters = chaptersMeta().filter((c) => c.id !== 'ch0' && (!only || c.id === only));

const LIMITS = { stem: 420, option: 160, hint: 230, explanation: 420, fact: 320, explainBlock: 520, explainStep: 1100, copyRunWords: 9 };
const report = { chapters: {}, totals: { errors: 0, warnings: 0, facts: 0, lessons: 0, questions: 0 } };

function checkRef(ref, where, errs, opts = {}) {
  const u = units.get(ref.unit);
  if (!u) { errs.push(`${where}: unknown source unit ${ref.unit}`); return false; }
  if (u.scope === 'excluded_footnote') { errs.push(`${where}: ${ref.unit} is a FOOTNOTE (not exam material) and cannot support content`); return false; }
  if (u.scope === 'meta') { errs.push(`${where}: ${ref.unit} is front matter (meta)`); return false; }
  if (u.scope === 'supplementary' && !opts.allowSupplementary) { errs.push(`${where}: ${ref.unit} is a supplementary thought box (no questions/lessons from it)`); return false; }
  if (ref.page !== u.page) { errs.push(`${where}: page ${ref.page} != unit page ${u.page}`); return false; }
  if (!ref.quote || normalizeForQuote(ref.quote).length < 3) { errs.push(`${where}: empty/too short quote`); return false; }
  if (!normalizeForQuote(u.text).includes(normalizeForQuote(ref.quote))) { errs.push(`${where}: quote is NOT a verbatim substring of ${ref.unit}`); return false; }
  if (u.visual && !ref.transcribed) { errs.push(`${where}: ${ref.unit} is a transcription of an image; ref.transcribed must be true`); return false; }
  if (ref.figure && !figures.has(ref.figure)) { errs.push(`${where}: unknown figure ${ref.figure}`); return false; }
  return true;
}

for (const ch of chapters) {
  const { facts, lessons, questions } = loadChapterContent(ch.id);
  if (!facts.length && !lessons.length && !questions.length) continue;
  const errs = []; const warns = [];
  const factIds = new Set(); const lessonIds = new Set(); const qIds = new Set();
  const factById = new Map();

  for (const f of facts) {
    const w = `fact ${f.id}`;
    if (factIds.has(f.id)) errs.push(`${w}: duplicate id`);
    factIds.add(f.id); factById.set(f.id, f);
    if (!f.id?.startsWith(`${ch.id}.`)) errs.push(`${w}: id must start with ${ch.id}.`);
    if (!f.statement || f.statement.length > LIMITS.fact) errs.push(`${w}: statement missing or longer than ${LIMITS.fact} chars`);
    if (!f.refs?.length) errs.push(`${w}: no source reference`);
    let allOk = true;
    for (const r of f.refs ?? []) allOk = checkRef(r, w, errs) && allOk;
    f._programmatic = allOk;
    if (f.verification?.status === 'verified' && !allOk) errs.push(`${w}: marked verified but source check failed`);
  }

  for (const q of questions) {
    const w = `question ${q.id}`;
    if (qIds.has(q.id)) errs.push(`${w}: duplicate id`);
    qIds.add(q.id);
    if (!q.id?.startsWith(`${ch.id}.`)) errs.push(`${w}: id must start with ${ch.id}.`);
    if (!q.stem || q.stem.length > LIMITS.stem) errs.push(`${w}: stem missing or > ${LIMITS.stem} chars`);
    if (!q.explanation || q.explanation.length > LIMITS.explanation) errs.push(`${w}: explanation missing or > ${LIMITS.explanation} chars (no page dumps)`);
    if (!q.factIds?.length) errs.push(`${w}: no factIds`);
    for (const f of q.factIds ?? []) if (!factIds.has(f)) errs.push(`${w}: unknown fact ${f}`);
    if (![1, 2, 3].includes(q.difficulty)) errs.push(`${w}: difficulty must be 1..3`);
    if (!['practice', 'mastery', 'both'].includes(q.pool)) errs.push(`${w}: bad pool`);
    if (!q.refs?.length) errs.push(`${w}: no source reference`);
    let allOk = true;
    for (const r of q.refs ?? []) allOk = checkRef(r, w, errs) && allOk;
    // every fact the question tests must itself be source-supported
    for (const f of q.factIds ?? []) if (factById.get(f) && factById.get(f)._programmatic === false) { allOk = false; errs.push(`${w}: tests fact ${f} whose sources failed`); }
    // hints
    if (!Array.isArray(q.hints) || (q.type !== 'tf' && !q.hints.length)) errs.push(`${w}: needs at least one hint`);
    for (const h of q.hints ?? []) if (!h || h.length > LIMITS.hint) errs.push(`${w}: hint empty or > ${LIMITS.hint} chars`);
    // type specific
    let keyOk = true;
    const ansTexts = [];
    switch (q.type) {
      case 'mcq': case 'compare': case 'multi': {
        const ids = (q.options ?? []).map((o) => o.id);
        if (ids.length < 3 || ids.length > 5) { errs.push(`${w}: needs 3..5 options`); keyOk = false; }
        if (new Set(ids).size !== ids.length) { errs.push(`${w}: duplicate option ids`); keyOk = false; }
        const norm = (q.options ?? []).map((o) => normalizeAnswer(o.text));
        if (new Set(norm).size !== norm.length) { errs.push(`${w}: two options have identical text`); keyOk = false; }
        for (const o of q.options ?? []) {
          if (!o.text || o.text.length > LIMITS.option) errs.push(`${w}: option text empty or > ${LIMITS.option}`);
          if (NONE_OF_ABOVE.test(o.text)) errs.push(`${w}: "all/none of the above" style options are not allowed (position must be freely shuffled)`);
        }
        if (q.type === 'multi') {
          if (!Array.isArray(q.correct) || q.correct.length < 2 || !q.correct.every((c) => ids.includes(c))) { errs.push(`${w}: multi needs >=2 valid correct ids`); keyOk = false; }
          if (q.correct.length >= ids.length) { errs.push(`${w}: multi cannot have every option correct`); keyOk = false; }
          q.correct?.forEach((c) => ansTexts.push(q.options.find((o) => o.id === c)?.text ?? ''));
        } else {
          if (typeof q.correct !== 'string' || !ids.includes(q.correct)) { errs.push(`${w}: correct must be exactly one option id`); keyOk = false; }
          ansTexts.push(q.options?.find((o) => o.id === q.correct)?.text ?? '');
        }
        break;
      }
      case 'tf':
        if (typeof q.correct !== 'boolean') { errs.push(`${w}: tf.correct must be boolean`); keyOk = false; }
        break;
      case 'short': case 'blank': {
        if (!q.accepted?.length) { errs.push(`${w}: no accepted answers`); keyOk = false; break; }
        const n = q.accepted.map(normalizeAnswer);
        if (n.some((x) => !x)) { errs.push(`${w}: an accepted answer normalises to empty`); keyOk = false; }
        if (new Set(n).size !== n.length) warns.push(`${w}: duplicate accepted answers after normalisation`);
        if (!q.answerDisplay || !n.includes(normalizeAnswer(q.answerDisplay))) { errs.push(`${w}: answerDisplay must be one of the accepted answers`); keyOk = false; }
        ansTexts.push(q.answerDisplay ?? '');
        break;
      }
      case 'match': {
        const L = q.left ?? []; const R = q.right ?? [];
        if (L.length < 3 || L.length > 6 || R.length < L.length) { errs.push(`${w}: match needs 3..6 pairs and >= as many answers`); keyOk = false; }
        if (!L.every((l) => R.some((r) => r.id === q.correct?.[l.id]))) { errs.push(`${w}: match key refers to unknown answers`); keyOk = false; }
        const used = L.map((l) => q.correct?.[l.id]);
        if (new Set(used).size !== used.length) { errs.push(`${w}: two prompts map to the same answer`); keyOk = false; }
        break;
      }
      case 'order': {
        const ids = (q.items ?? []).map((i) => i.id);
        if (ids.length < 3 || ids.length > 8) { errs.push(`${w}: order needs 3..8 items`); keyOk = false; }
        if (!Array.isArray(q.correct) || q.correct.length !== ids.length || new Set(q.correct).size !== ids.length || !q.correct.every((c) => ids.includes(c))) { errs.push(`${w}: order key must be a permutation of item ids`); keyOk = false; }
        break;
      }
      default: errs.push(`${w}: unknown type ${q.type}`); keyOk = false;
    }
    // hints must not simply contain the answer
    for (const a of ansTexts) for (const h of q.hints ?? []) {
      const na = normalizeForQuote(a);
      if (na.length >= 4 && normalizeForQuote(h).includes(na)) warns.push(`${w}: a hint contains the full answer text ("${a.slice(0, 30)}")`);
    }
    // originality: no long verbatim runs copied from the source
    const srcText = (q.refs ?? []).map((r) => units.get(r.unit)?.text ?? '').join(' ');
    const stemRun = longestVerbatimRun(q.stem ?? '', srcText);
    if (stemRun >= LIMITS.copyRunWords) warns.push(`${w}: stem copies ${stemRun} consecutive words from the source (write an original question)`);
    if (longestVerbatimRun(q.explanation ?? '', srcText) >= 25) warns.push(`${w}: explanation copies a long source passage`);
    q._programmatic = allOk && keyOk;
    if (q.verification?.status === 'verified' && !q._programmatic) errs.push(`${w}: marked verified but programmatic checks failed`);
    if (q.verification?.status === 'verified' && !(q.verification.independent?.verdict === 'pass')) errs.push(`${w}: verified requires an independent 'pass' verdict`);
    if (q.lessonId && !lessons.some((l) => l.id === q.lessonId)) errs.push(`${w}: unknown lesson ${q.lessonId}`);
  }

  for (const l of lessons) {
    const w = `lesson ${l.id}`;
    if (lessonIds.has(l.id)) errs.push(`${w}: duplicate id`);
    lessonIds.add(l.id);
    if (!l.id?.startsWith(`${ch.id}.`)) errs.push(`${w}: id must start with ${ch.id}.`);
    if (!l.title) errs.push(`${w}: no title`);
    if (!(l.pages?.length === 2 && l.pages[0] <= l.pages[1])) errs.push(`${w}: bad pages`);
    if (!l.objectives?.length || l.objectives.length > 14) errs.push(`${w}: needs 1..14 objectives (split big lessons)`);
    for (const o of l.objectives ?? []) if (!factIds.has(o)) errs.push(`${w}: unknown objective fact ${o}`);
    if (!l.steps?.length) errs.push(`${w}: no steps`);
    const stepsFacts = new Set();
    for (const [i, s] of (l.steps ?? []).entries()) {
      if (s.type === 'explain') {
        let total = 0;
        for (const b of s.blocks ?? []) {
          const len = (b.text ?? '').length + (b.items ?? []).join('').length + (b.table ? JSON.stringify(b.table).length : 0);
          total += len;
          if (len > LIMITS.explainBlock) errs.push(`${w} step ${i}: block longer than ${LIMITS.explainBlock} chars (keep explanations short)`);
        }
        if (total > LIMITS.explainStep) errs.push(`${w} step ${i}: explain step longer than ${LIMITS.explainStep} chars`);
        if (!s.factIds?.length) errs.push(`${w} step ${i}: explain step must list the factIds it presents`);
        for (const f of s.factIds ?? []) { if (!factIds.has(f)) errs.push(`${w} step ${i}: unknown fact ${f}`); stepsFacts.add(f); }
        for (const g of s.figures ?? []) if (!figures.has(g)) errs.push(`${w} step ${i}: unknown figure ${g}`);
      } else if (s.type === 'check') {
        if (!qIds.has(s.questionId)) errs.push(`${w} step ${i}: unknown question ${s.questionId}`);
      } else if (s.type === 'figure') {
        if (!figures.has(s.figureId)) errs.push(`${w} step ${i}: unknown figure ${s.figureId}`);
      } else errs.push(`${w} step ${i}: unknown step type`);
    }
    for (const o of l.objectives ?? []) if (!stepsFacts.has(o)) errs.push(`${w}: objective ${o} is never taught in an explain step`);
    // mastery pool coverage
    const pool = questions.filter((q) => q.lessonId === l.id && (q.pool === 'mastery' || q.pool === 'both'));
    for (const o of l.objectives ?? []) {
      const n = pool.filter((q) => q.factIds.includes(o)).length;
      if (n === 0) errs.push(`${w}: objective ${o} has NO mastery question`);
      else if (n === 1) warns.push(`${w}: objective ${o} has only 1 mastery question (retries repeat it)`);
    }
    if (l.assessmentSize < 3 || l.assessmentSize > 24) errs.push(`${w}: assessmentSize must be 3..24`);
    if (pool.length < Math.ceil(l.assessmentSize * 1.5)) warns.push(`${w}: mastery pool ${pool.length} < 1.5 x assessmentSize ${l.assessmentSize}`);
    const types = new Set(pool.map((q) => q.type));
    if (pool.length >= 6 && types.size < 2) warns.push(`${w}: mastery pool uses a single question type`);
    const hasRecall = pool.some((q) => ['short', 'blank', 'order', 'match', 'multi'].includes(q.type));
    if (pool.length >= 6 && !hasRecall) warns.push(`${w}: mastery pool has no recall-style question (short/blank/order/match/multi)`);
  }

  // position-pattern check for single-answer choice questions (authoring is shuffled at runtime, this only warns on degenerate banks)
  report.chapters[ch.id] = { errors: errs, warnings: warns, facts: facts.length, lessons: lessons.length, questions: questions.length };
  report.totals.errors += errs.length; report.totals.warnings += warns.length;
  report.totals.facts += facts.length; report.totals.lessons += lessons.length; report.totals.questions += questions.length;
}

fs.mkdirSync(path.join(PRIV, 'work', 'validation'), { recursive: true });
fs.writeFileSync(path.join(PRIV, 'work', 'validation', 'report.json'), JSON.stringify(report, null, 1));
if (args.includes('--json')) console.log(JSON.stringify(report));
else {
  for (const [id, r] of Object.entries(report.chapters)) {
    console.log(`${id}: facts ${r.facts}, lessons ${r.lessons}, questions ${r.questions} | errors ${r.errors.length} | warnings ${r.warnings.length}`);
    r.errors.slice(0, 25).forEach((e) => console.log('  ERROR ', e));
    if (r.errors.length > 25) console.log(`  ... ${r.errors.length - 25} more errors`);
    r.warnings.slice(0, 10).forEach((e) => console.log('  warn  ', e));
    if (r.warnings.length > 10) console.log(`  ... ${r.warnings.length - 10} more warnings`);
  }
  console.log(`TOTAL errors ${report.totals.errors}, warnings ${report.totals.warnings}; facts ${report.totals.facts}, lessons ${report.totals.lessons}, questions ${report.totals.questions}`);
}
void CONTENT_SRC;
process.exit(report.totals.errors ? 1 : 0);
