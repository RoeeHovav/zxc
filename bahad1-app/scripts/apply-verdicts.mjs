#!/usr/bin/env node
// Merges verifier verdicts into the expanded content and derives the final verification status.
//   node scripts/apply-verdicts.mjs ch1
// Verdict files: private/content/<ch>/verdicts/*.json   { "<itemId or short id>": { "v": "pass"|"fail"|"uncertain", "n": "notes", "by": "verifier-label" } }
// An item becomes 'verified' ONLY if (a) all programmatic source/answer-key checks pass AND (b) an independent verifier said 'pass'.
//   fail      -> status 'rejected'  (never enters the bank)
//   uncertain -> status 'flagged'   (human review required; never enters the bank by itself)
//   no verdict-> stays 'pending'    (never enters the bank)
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_SRC, loadFigures, loadUnits, normalizeAnswer, normalizeForQuote, NONE_OF_ABOVE, readJson } from './lib/content-lib.mjs';

const ch = process.argv[2];
const dir = path.join(CONTENT_SRC, ch);
const units = loadUnits();
const figures = loadFigures();
const load = (n) => readJson(path.join(dir, n));
const facts = load('facts.json'); const lessons = load('lessons.json'); const questions = load('questions.json');
const verdicts = {};
const vdir = path.join(dir, 'verdicts');
if (fs.existsSync(vdir)) for (const f of fs.readdirSync(vdir).sort()) if (f.endsWith('.json')) Object.assign(verdicts, readJson(path.join(vdir, f)));
const P = (id) => (id.startsWith(`${ch}.`) ? id : `${ch}.${id}`);
const verdictFor = (id) => verdicts[id] ?? verdicts[id.replace(`${ch}.`, '')];

function refsOk(refs) {
  return (refs ?? []).length > 0 && refs.every((r) => {
    const u = units.get(r.unit);
    return u && u.scope === 'core' && u.page === r.page && normalizeForQuote(r.quote).length >= 3 && normalizeForQuote(u.text).includes(normalizeForQuote(r.quote)) && (!u.visual || r.transcribed) && (!r.figure || figures.has(r.figure));
  });
}
const noExcluded = (refs) => (refs ?? []).every((r) => units.get(r.unit)?.scope === 'core');

function keyOk(q) {
  try {
    switch (q.type) {
      case 'mcq': case 'compare': {
        const ids = q.options.map((o) => o.id);
        const norm = q.options.map((o) => normalizeAnswer(o.text));
        return ids.length >= 3 && ids.length <= 5 && ids.includes(q.correct) && new Set(ids).size === ids.length && new Set(norm).size === norm.length && !q.options.some((o) => NONE_OF_ABOVE.test(o.text));
      }
      case 'multi': return q.correct.length >= 2 && q.correct.length < q.options.length && q.correct.every((c) => q.options.some((o) => o.id === c));
      case 'tf': return typeof q.correct === 'boolean';
      case 'short': case 'blank': return q.accepted.length > 0 && q.accepted.every((a) => normalizeAnswer(a)) && q.accepted.map(normalizeAnswer).includes(normalizeAnswer(q.answerDisplay));
      case 'match': return q.left.length >= 3 && q.left.every((l) => q.right.some((r) => r.id === q.correct[l.id]));
      case 'order': return q.items.length >= 3 && new Set(q.correct).size === q.items.length && q.correct.every((c) => q.items.some((i) => i.id === c));
      default: return false;
    }
  } catch { return false; }
}

function finish(item, programmaticOk, pc) {
  const v = verdictFor(item.id);
  item.verification = {
    status: 'pending', generatedBy: item.verification?.generatedBy ?? 'author',
    programmatic: pc,
    ...(v ? { independent: { verdict: v.v, notes: v.n, by: v.by ?? 'verifier' } } : {}),
  };
  if (!programmaticOk) item.verification.status = v?.v === 'fail' ? 'rejected' : 'flagged';
  else if (v?.v === 'pass') item.verification.status = 'verified';
  else if (v?.v === 'fail') item.verification.status = 'rejected';
  else if (v?.v === 'uncertain') item.verification.status = 'flagged';
}

const factOk = new Map();
for (const f of facts) {
  const ok = refsOk(f.refs);
  factOk.set(f.id, ok);
  finish(f, ok, { quotesFound: ok, answerKeyValid: true, noExcludedSource: noExcluded(f.refs) });
}
for (const q of questions) {
  const ok = refsOk(q.refs) && q.factIds.every((f) => factOk.get(f)) && keyOk(q);
  finish(q, ok, { quotesFound: refsOk(q.refs), answerKeyValid: keyOk(q), noExcludedSource: noExcluded(q.refs) });
}
for (const l of lessons) {
  const ok = l.objectives.every((o) => factOk.get(o)) && l.steps.every((s) => s.type !== 'explain' || s.factIds.every((f) => factOk.has(f)));
  finish(l, ok, { quotesFound: ok, answerKeyValid: true, noExcludedSource: true });
}
fs.writeFileSync(path.join(dir, 'facts.json'), JSON.stringify(facts, null, 1));
fs.writeFileSync(path.join(dir, 'lessons.json'), JSON.stringify(lessons, null, 1));
fs.writeFileSync(path.join(dir, 'questions.json'), JSON.stringify(questions, null, 1));
const count = (arr) => arr.reduce((a, x) => { a[x.verification.status] = (a[x.verification.status] ?? 0) + 1; return a; }, {});
console.log(`${ch}: facts ${JSON.stringify(count(facts))} | lessons ${JSON.stringify(count(lessons))} | questions ${JSON.stringify(count(questions))}`);
void P;
