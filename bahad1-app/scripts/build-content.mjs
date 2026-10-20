#!/usr/bin/env node
// Compiles the private authored content into the app's static content bundle (public/content, git-ignored).
//   node scripts/build-content.mjs [--out public/content]
// - ONLY chapters that have authored content are emitted.
// - Items keep their verification status; the app's bank admits 'verified' items only (plus explicit human approvals).
// - Footnotes (excluded_footnote) and front matter are never written to the bundle; source units for the original-passage viewer are core + supplementary only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_SRC, PRIV, ROOT, SOURCE_DIR, chaptersMeta, loadChapterContent, loadUnits, readJson } from './lib/content-lib.mjs';

const args = process.argv.slice(2);
const PREVIEW = args.includes('--assume-verified'); // UI evaluation ONLY: marks everything verified and flags the manifest as preview
// Atomic build: everything is written to a temporary sibling directory and swapped in only when the whole build succeeded,
// so an interrupted or failing build (session cut-off, corrupt authoring file) never destroys the last good content bundle.
const finalDir = path.resolve(ROOT, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'public/content');
const outDir = `${finalDir}.tmp-build`;
fs.rmSync(outDir, { recursive: true, force: true });
for (const d of ['sources', 'figs', 'pages']) fs.mkdirSync(path.join(outDir, d), { recursive: true });

const units = loadUnits();
const figIds = new Set(readJson(path.join(SOURCE_DIR, 'figures.json')).map((f) => f.id));
const chapters = chaptersMeta().filter((c) => c.id !== 'ch0');
const emitted = []; const bundles = []; const neededFigs = new Set(); const neededPages = new Set();
const review = { generatedAt: new Date().toISOString(), chapters: {}, flagged: [], visual: [], extraction: {} };
const validation = fs.existsSync(path.join(PRIV, 'work/validation/report.json')) ? readJson(path.join(PRIV, 'work/validation/report.json')) : null;

for (const [order, ch] of chapters.entries()) {
  let { facts, lessons, questions } = loadChapterContent(ch.id);
  if (!lessons.length) continue;
  if (PREVIEW) {
    const mark = (x) => ({ ...x, verification: { ...x.verification, status: 'verified', note: 'PREVIEW – not independently verified' } });
    facts = facts.map(mark); lessons = lessons.map(mark); questions = questions.map(mark);
  }
  lessons.sort((a, b) => a.order - b.order);
  const bundle = {
    chapter: { id: ch.id, title: ch.title, firstPage: ch.firstPage, lastPage: ch.lastPage, order, lessonIds: lessons.map((l) => l.id) },
    facts, lessons, questions,
  };
  bundles.push(bundle);
  for (const l of lessons) for (const s of l.steps) { if (s.type === 'figure') neededFigs.add(s.figureId); if (s.type === 'explain') (s.figures ?? []).forEach((f) => neededFigs.add(f)); }
  for (const arr of [facts, questions]) for (const it of arr) { (it.refs ?? []).forEach((r) => { neededPages.add(r.page); if (r.figure) neededFigs.add(r.figure); }); if (it.figure) neededFigs.add(it.figure); }
  const chUnits = [...units.values()].filter((u) => u.chapter === ch.id && (u.scope === 'core' || u.scope === 'supplementary'));
  fs.writeFileSync(path.join(outDir, 'sources', `${ch.id}.json`), JSON.stringify(chUnits.map((u) => ({ id: u.id, page: u.page, kind: u.kind, text: u.text, ...(u.figure ? { figure: u.figure } : {}), ...(u.cells ? { cells: u.cells } : {}) }))));
  fs.writeFileSync(path.join(outDir, `${ch.id}.json`), JSON.stringify(bundle));
  const count = (arr) => arr.reduce((a, x) => { a[x.verification.status] = (a[x.verification.status] ?? 0) + 1; return a; }, {});
  const covFile = path.join(PRIV, 'work/coverage', `${ch.id}.json`);
  const cov = fs.existsSync(covFile) ? readJson(covFile) : null;
  review.chapters[ch.id] = {
    title: ch.title, pages: [ch.firstPage, ch.lastPage], facts: count(facts), lessons: count(lessons), questions: count(questions),
    coverage: cov && { requiredUnits: cov.requiredUnits, unitsWithoutFact: cov.unitsWithoutFact, unitsWithoutLesson: cov.unitsWithoutLesson, unitsWithoutQuestion: cov.unitsWithoutQuestion, factsWithoutQuestion: cov.factsWithoutQuestion, excludedFootnotes: cov.excludedFootnotes, supplementaryBoxes: cov.supplementaryBoxes },
    validation: validation?.chapters?.[ch.id] ? { errors: validation.chapters[ch.id].errors.length, warnings: validation.chapters[ch.id].warnings } : null,
  };
  for (const [kind, arr] of [['question', questions], ['lesson', lessons], ['fact', facts]]) {
    for (const it of arr) if (it.verification.status !== 'verified') review.flagged.push({ kind, chapter: ch.id, id: it.id, status: it.verification.status, item: it });
  }
  for (const u of chUnits.filter((x) => x.visual)) review.visual.push({ id: u.id, page: u.page, figure: u.figure, text: u.text, status: u.transcription?.status ?? 'single_read', readings: u.readings });
  emitted.push({ ...bundle.chapter, lessons: lessons.map((l) => ({
    id: l.id, title: l.title, pages: l.pages, status: l.verification.status,
    // assessable = every objective has >= 1 verified mastery-pool question; the guided path only includes assessable lessons so that
    // a lesson with a rejected/pending question pool can never block the learner's progress.
    assessable: l.objectives.every((o) => questions.some((q) => q.lessonId === l.id && q.verification.status === 'verified' && (q.pool === 'mastery' || q.pool === 'both') && q.factIds.includes(o))),
  })), counts: { facts: facts.length, lessons: lessons.length, questions: questions.length, verifiedQuestions: questions.filter((q) => q.verification.status === 'verified').length } });
}

// assets
for (const f of neededFigs) {
  if (!figIds.has(f)) continue;
  const src = path.join(PRIV, 'work/img/figs', `${f}.png`);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, 'figs', `${f}.png`));
}
for (const p of neededPages) {
  const src = path.join(PRIV, 'work/img/web/pages', `p${String(p).padStart(3, '0')}.jpg`);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, 'pages', `p${String(p).padStart(3, '0')}.jpg`));
}

// extraction / index statistics for the verification dashboard
const idx = readJson(path.join(SOURCE_DIR, 'pages_index.json'));
const byScope = {};
for (const u of units.values()) if (!u.visual) byScope[u.scope] = (byScope[u.scope] ?? 0) + 1;
review.extraction = {
  pagesProcessed: idx.length, totalPages: 314, unitsByScope: byScope,
  visualReviewPages: fs.existsSync(path.join(SOURCE_DIR, 'visual_review_pages.json')) ? readJson(path.join(SOURCE_DIR, 'visual_review_pages.json')) : [],
  allChapters: chaptersMeta().map((c) => ({ id: c.id, title: c.title, firstPage: c.firstPage, lastPage: c.lastPage, built: emitted.some((e) => e.id === c.id) })),
};
fs.writeFileSync(path.join(outDir, 'review.json'), JSON.stringify(review));

const hash = crypto.createHash('sha256');
for (const b of bundles) hash.update(JSON.stringify(b));
const manifest = {
  contentVersion: (PREVIEW ? 'PREVIEW-' : '') + hash.digest('hex').slice(0, 12), preview: PREVIEW, generatedAt: new Date().toISOString(),
  book: 'official-bahad1-book', totalPages: 314, chapters: emitted,
  stats: {
    chapters: emitted.length,
    facts: emitted.reduce((s, c) => s + c.counts.facts, 0), lessons: emitted.reduce((s, c) => s + c.counts.lessons, 0),
    questions: emitted.reduce((s, c) => s + c.counts.questions, 0), verifiedQuestions: emitted.reduce((s, c) => s + c.counts.verifiedQuestions, 0),
  },
};
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
fs.rmSync(finalDir, { recursive: true, force: true });
fs.renameSync(outDir, finalDir);
console.log(`content built -> ${path.relative(ROOT, finalDir)} | chapters ${emitted.length}, facts ${manifest.stats.facts}, lessons ${manifest.stats.lessons}, questions ${manifest.stats.questions} (verified ${manifest.stats.verifiedQuestions}) | figs ${neededFigs.size}, pages ${neededPages.size} | version ${manifest.contentVersion}`);
void CONTENT_SRC;
