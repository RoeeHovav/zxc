#!/usr/bin/env node
// Expands the COMPACT authoring format into the strict content schema.
//   node scripts/author-expand.mjs ch1
// Input : private/content/<ch>/src/facts*.json  lessons*.json  questions*.json   (arrays, see docs/AUTHORING_GUIDE.md)
// Output: private/content/<ch>/facts.json lessons.json questions.json            (full schema, verification.status = 'pending')
// Verdicts from independent verifiers (private/content/<ch>/verdicts/*.json) are merged by scripts/apply-verdicts.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_SRC, loadUnits, normalizeForQuote, readJson, chaptersMeta } from './lib/content-lib.mjs';

const ARGS = process.argv.slice(2);
const argv = (k) => (ARGS.includes(k) ? ARGS[ARGS.indexOf(k) + 1] : null);
const ch = ARGS.find((a) => !a.startsWith('--') && ARGS.indexOf(a) === 0);
const SEG = argv('--seg');
if (!ch) { console.error('usage: author-expand.mjs <chapterId>'); process.exit(2); }
const meta = chaptersMeta().find((c) => c.id === ch);
if (!meta) { console.error('unknown chapter'); process.exit(2); }
const dir = argv('--out') ? path.resolve(argv('--out')) : path.join(CONTENT_SRC, ch);
const srcDir = path.join(CONTENT_SRC, ch, 'src');
const units = loadUnits();
const files = (prefix) => fs.existsSync(srcDir) ? fs.readdirSync(srcDir).filter((f) => f.endsWith('.json') && (SEG ? (f.startsWith(`${prefix}-${SEG}-`) || f === `${prefix}-${SEG}.json`) : f.startsWith(prefix))).sort() : [];
const loadAll = (prefix) => files(prefix).flatMap((f) => readJson(path.join(srcDir, f)));
const errors = [];
const P = (id) => (id.startsWith(`${ch}.`) ? id : `${ch}.${id}`);
const pending = (by) => ({ status: 'pending', generatedBy: by, programmatic: { quotesFound: false, answerKeyValid: false, noExcludedSource: false } });

const toRef = ([unit, quote]) => {
  const u = units.get(unit);
  if (!u) { errors.push(`unknown unit ${unit}`); return { unit, page: 0, quote }; }
  const ref = { unit, page: u.page, quote };
  if (u.visual) { ref.transcribed = true; if (u.figure) ref.figure = u.figure; }
  return ref;
};
const emphasisOf = (refs) => refs.some((r) => {
  const u = units.get(r.unit);
  if (!u) return false;
  const q = normalizeForQuote(r.quote);
  return [...(u.boldTerms ?? []), ...(u.underlinedTerms ?? [])].some((t) => t && q.includes(normalizeForQuote(t)) && normalizeForQuote(t).length > 3);
});
const originOf = (refs) => {
  const k = units.get(refs[0]?.unit)?.kind;
  return k === 'table_row' ? 'table' : k === 'caption' ? 'caption' : k === 'figure_text' ? 'figure' : k === 'box' ? 'box' : 'text';
};

// ---------- facts ----------
const facts = loadAll('facts').map((f) => {
  const refs = (f.r ?? []).map(toRef);
  return { id: P(f.id), chapter: ch, topic: f.t, kind: f.k ?? 'other', statement: f.s, refs, emphasis: emphasisOf(refs), origin: originOf(refs), verification: pending('author') };
});
const factById = new Map(facts.map((f) => [f.id, f]));

// ---------- lessons ----------
const lessonSrc = loadAll('lessons');
const lessons = lessonSrc.map((l, i) => ({
  id: P(l.id), chapter: ch, order: l.o ?? i + 1, title: l.title, pages: l.pages, objectives: (l.obj ?? []).map(P), assessmentSize: l.size ?? 8,
  summary: l.sum,
  steps: (l.steps ?? []).map((s) => {
    if (s.x) {
      const blocks = (s.x.b ?? []).map(([k, v]) => {
        if (k === 'p') return { kind: 'p', text: v };
        if (k === 'b') return { kind: 'bullets', items: v };
        if (k === 'k') return { kind: 'key', text: v };
        if (k === 'n') return { kind: 'note', text: v };
        if (k === 't') return { kind: 'table', table: { headers: v.h, rows: v.r } };
        errors.push(`lesson ${l.id}: unknown block kind ${k}`); return { kind: 'p', text: '' };
      });
      return { type: 'explain', title: s.x.t, blocks, factIds: (s.x.f ?? []).map(P), ...(s.x.fig ? { figures: s.x.fig } : {}) };
    }
    if (s.c) return { type: 'check', questionId: P(s.c) };
    if (s.fig) return { type: 'figure', figureId: s.fig, caption: s.cap };
    errors.push(`lesson ${l.id}: unknown step`); return { type: 'explain', blocks: [], factIds: [] };
  }),
  verification: pending('author'),
}));
const lessonById = new Map(lessons.map((l) => [l.id, l]));

// ---------- questions ----------
let optLetters = 'abcde';
const questions = loadAll('questions').map((q) => {
  const lessonId = P(q.l);
  const factIds = (q.f ?? []).map(P);
  const refs = q.r ? q.r.map(toRef) : dedupeRefs(factIds.flatMap((f) => factById.get(f)?.refs ?? []));
  const base = {
    id: P(q.id), lessonId, chapter: ch, topic: q.topic ?? lessonById.get(lessonId)?.title ?? '', factIds, difficulty: q.d ?? 1, pool: q.pool ?? 'both',
    stem: q.q, hints: q.h ?? [], explanation: q.x ?? '', refs, verification: pending('author'),
    ...(q.fig ? { figure: q.fig } : {}),
  };
  const mk = (o) => ({ ...base, ...o });
  switch (q.ty) {
    case 'mcq': case 'compare': case 'multi': {
      const options = q.o.map((t, i) => ({ id: optLetters[i], text: t.replace(/^\*/, '') }));
      const correctIds = q.o.map((t, i) => (t.startsWith('*') ? optLetters[i] : null)).filter(Boolean);
      return mk({ type: q.ty, options, correct: q.ty === 'multi' ? correctIds : correctIds[0] ?? null });
    }
    case 'tf': return mk({ type: 'tf', correct: !!q.a });
    case 'short': case 'blank': return mk({ type: q.ty, accepted: q.a, answerDisplay: q.a[0], ...(q.ph ? { placeholder: q.ph } : {}) });
    case 'match': {
      const left = q.pairs.map(([l], i) => ({ id: `l${i + 1}`, text: l }));
      const right = q.pairs.map(([, r], i) => ({ id: `r${i + 1}`, text: r }));
      (q.extra ?? []).forEach((t, j) => right.push({ id: `r${q.pairs.length + j + 1}`, text: t }));
      return mk({ type: 'match', left, right, correct: Object.fromEntries(left.map((l, i) => [l.id, `r${i + 1}`])) });
    }
    case 'order': {
      const items = q.seq.map((t, i) => ({ id: `i${i + 1}`, text: t }));
      return mk({ type: 'order', items, correct: items.map((i) => i.id) });
    }
    default: errors.push(`question ${q.id}: unknown type ${q.ty}`); return mk({ type: q.ty });
  }
});
function dedupeRefs(refs) {
  const seen = new Set();
  return refs.filter((r) => { const k = `${r.unit}|${r.quote}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
fs.mkdirSync(dir, { recursive: true });
// keep independent verdicts that were already merged (statuses are re-derived by apply-verdicts.mjs afterwards)
fs.writeFileSync(path.join(dir, 'facts.json'), JSON.stringify(facts, null, 1));
fs.writeFileSync(path.join(dir, 'lessons.json'), JSON.stringify(lessons, null, 1));
fs.writeFileSync(path.join(dir, 'questions.json'), JSON.stringify(questions, null, 1));
console.log(`${ch}: ${facts.length} facts, ${lessons.length} lessons, ${questions.length} questions expanded`);
