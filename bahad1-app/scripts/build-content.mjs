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
const figList = readJson(path.join(SOURCE_DIR, 'figures.json'));
const figIds = new Set(figList.map((f) => f.id));
const figById = new Map(figList.map((f) => [f.id, f]));
const figsByPage = new Map();
for (const f of figList) (figsByPage.get(f.page) ?? figsByPage.set(f.page, []).get(f.page)).push(f);
const unitNum = (id) => Number(/\.[uv](\d+)$/.exec(id)?.[1] ?? 0);
const AVAIL = fs.existsSync(path.join(ROOT, 'pipeline/availability.json')) ? readJson(path.join(ROOT, 'pipeline/availability.json')) : { open: null, groups: {} };
// Only chapters listed as open are published to learners; every other chapter (even with authored work in private/) is shown as "עובדים על זה" and has no bundle.
const isOpen = (id) => !AVAIL.open || AVAIL.open.includes(id);
const chapters = chaptersMeta().filter((c) => c.id !== 'ch0');
const emitted = []; const bundles = []; const neededFigs = new Set(); const neededPages = new Set();
const review = { generatedAt: new Date().toISOString(), chapters: {}, flagged: [], visual: [], extraction: {} };
const validation = fs.existsSync(path.join(PRIV, 'work/validation/report.json')) ? readJson(path.join(PRIV, 'work/validation/report.json')) : null;

for (const [order, ch] of chapters.entries()) {
  if (!isOpen(ch.id)) continue;
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
  // ---- reading order of the ORIGINAL book text (study material): text units by extraction order, figures merged in by their position on the page ----
  const rowOf0 = (u) => ({
    id: u.id, page: u.page, kind: u.kind, text: u.text,
    ...(u.figure ? { figure: u.figure } : {}), ...(u.cells ? { cells: u.cells } : {}), ...(u.table ? { table: u.table, row: u.row } : {}),
    ...(u.kind === 'heading' && u.headingLevel ? { h: u.headingLevel } : {}),
    ...(u.boldTerms?.length && u.kind !== 'heading' ? { bold: u.boldTerms.filter((t) => t.length >= 3 && t.length <= 160) } : {}),
    // a transcribed image text is shown only when two independent readings agreed (or an adjudicator decided); otherwise the image alone is shown
    ...(u.visual ? { tr: u.transcription?.status ?? 'none' } : {}),
  });
  const ordered = [];
  for (let pg = ch.firstPage; pg <= ch.lastPage; pg++) {
    const txt = chUnits.filter((u) => u.page === pg && !u.visual).sort((a, b) => unitNum(a.id) - unitNum(b.id));
    const vis = chUnits.filter((u) => u.page === pg && u.visual);
    const visFig = new Set(vis.map((v) => v.figure));
    const figEntries = [
      ...vis.map((v) => ({ bbox: figById.get(v.figure)?.bbox ?? null, row: rowOf0(v) })),
      ...(figsByPage.get(pg) ?? []).filter((f) => !visFig.has(f.id) && (f.pageAreaFraction ?? 1) >= 0.012).map((f) => ({ bbox: f.bbox, row: { id: `fig:${f.id}`, page: pg, kind: 'figure', text: '', figure: f.id } })),
    ];
    // a picture is shown right above its caption when a caption sits directly under it (the book floats pictures beside the text); otherwise by its vertical position
    const isCaption = (u) => u.kind === 'caption' || (u.kind === 'table_row' && (u.cells?.length ?? 1) <= 1);
    const anchored = new Map();
    const loose = [];
    for (const fe of figEntries) {
      const cap = fe.bbox && txt.find((u) => isCaption(u) && u.bbox && Math.min(u.bbox[2], fe.bbox[2]) - Math.max(u.bbox[0], fe.bbox[0]) > 0 && u.bbox[1] >= fe.bbox[3] - 8 && u.bbox[1] <= fe.bbox[3] + 80);
      if (cap) (anchored.get(cap.id) ?? anchored.set(cap.id, []).get(cap.id)).push(fe.row); else loose.push({ y: fe.bbox?.[1] ?? 1e9, row: fe.row });
    }
    loose.sort((x, y) => x.y - y.y);
    let fi = 0;
    for (const u of txt) {
      while (fi < loose.length && loose[fi].y <= (u.bbox?.[1] ?? 0)) ordered.push(loose[fi++].row);
      for (const r of anchored.get(u.id) ?? []) ordered.push(r);
      ordered.push(rowOf0(u));
    }
    while (fi < loose.length) ordered.push(loose[fi++].row);
  }
  for (const r of ordered) if (r.figure) neededFigs.add(r.figure);
  for (let pg = ch.firstPage; pg <= ch.lastPage; pg++) neededPages.add(pg);
  // the part of the original text that belongs to each lesson: from the first to the last source unit cited by the lesson's facts (plus headings directly above)
  {
    const idxOf = new Map(ordered.map((r, i) => [r.id, i]));
    const factById0 = new Map(facts.map((f) => [f.id, f]));
    const inLesson = new Set(); let empty = 0; let widest = 0;
    for (const l of lessons) {
      const fids = new Set(l.objectives); for (const st of l.steps) if (st.type === 'explain') st.factIds.forEach((f) => fids.add(f));
      const cited = []; for (const f of fids) for (const r of factById0.get(f)?.refs ?? []) if (idxOf.has(r.unit)) cited.push(idxOf.get(r.unit));
      if (!cited.length) { l.readingUnits = []; empty++; continue; }
      let a = Math.min(...cited); const b = Math.max(...cited);
      while (a > 0 && ordered[a - 1].kind === 'heading') a--;
      l.readingUnits = ordered.slice(a, b + 1).map((r) => r.id);
      widest = Math.max(widest, l.readingUnits.length); l.readingUnits.forEach((id) => inLesson.add(id));
    }
    const coreText = ordered.filter((r) => r.kind !== 'figure' && r.kind !== 'figure_text' && chUnits.find((u) => u.id === r.id)?.scope === 'core');
    console.log(`  ${ch.id}: reading text — ${ordered.length} blocks, ${lessons.length - empty}/${lessons.length} lessons with text (widest ${widest}), ${coreText.filter((r) => !inLesson.has(r.id)).length}/${coreText.length} core units outside every lesson range`);
  }
  fs.writeFileSync(path.join(outDir, 'sources', `${ch.id}.json`), JSON.stringify(ordered));
  fs.writeFileSync(path.join(outDir, `${ch.id}.json`), JSON.stringify(bundle));
  const count = (arr) => arr.reduce((a, x) => { a[x.verification.status] = (a[x.verification.status] ?? 0) + 1; return a; }, {});
  // ---- coverage matrix: SOURCE UNIT -> FACT -> LESSON -> QUESTION -> VERIFICATION (computed from the compiled items) ----
  const REQUIRED_KINDS = new Set(['paragraph', 'box', 'caption', 'table_row', 'note', 'figure_text']);
  const lessonOfFact = new Map();
  for (const l of lessons) for (const st of l.steps) if (st.type === 'explain') for (const f of st.factIds) { (lessonOfFact.get(f) ?? lessonOfFact.set(f, new Set()).get(f)).add(l.id); }
  const rowOf = new Map();
  for (const u of [...units.values()].filter((x) => x.chapter === ch.id && x.scope !== 'meta')) rowOf.set(u.id, { u: u.id, p: u.page, k: u.kind, s: u.scope, t: String(u.text ?? '').slice(0, 110), f: [], l: new Set(), q: 0, qv: 0, fv: 0 });
  for (const f of facts) for (const r of new Set(f.refs.map((x) => x.unit))) { const row = rowOf.get(r); if (!row) continue; row.f.push(f.id); (lessonOfFact.get(f.id) ?? []).forEach((l) => row.l.add(l)); if (f.verification.status === 'verified') row.fv++; }
  for (const q of questions) for (const r of new Set(q.refs.map((x) => x.unit))) { const row = rowOf.get(r); if (!row) continue; row.q++; if (q.verification.status === 'verified') row.qv++; }
  const matrix = [...rowOf.values()].sort((a, b) => a.p - b.p || a.u.localeCompare(b.u)).map((r) => ({ ...r, l: [...r.l] }));
  fs.mkdirSync(path.join(outDir, 'coverage'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'coverage', `${ch.id}.json`), JSON.stringify(matrix));
  const reqRows = matrix.filter((r) => r.s === 'core' && REQUIRED_KINDS.has(r.k));
  const cov = {
    requiredUnits: reqRows.length, unitsWithoutFact: reqRows.filter((r) => !r.f.length).map((r) => r.u),
    unitsWithoutLesson: reqRows.filter((r) => r.f.length && !r.l.length).map((r) => r.u), unitsWithoutQuestion: reqRows.filter((r) => r.f.length && !r.q).map((r) => r.u),
    factsWithoutQuestion: facts.filter((f) => !questions.some((q) => q.factIds.includes(f.id))).map((f) => f.id),
    excludedFootnotes: matrix.filter((r) => r.s === 'excluded_footnote').length, supplementaryBoxes: matrix.filter((r) => r.s === 'supplementary').length,
    unitsWithoutVerifiedFact: reqRows.filter((r) => r.f.length && !r.fv).map((r) => r.u),
  };
  review.chapters[ch.id] = {
    title: ch.title, pages: [ch.firstPage, ch.lastPage], facts: count(facts), lessons: count(lessons), questions: count(questions),
    coverage: cov,
    validation: validation?.chapters?.[ch.id] ? { errors: validation.chapters[ch.id].errors.length, warnings: validation.chapters[ch.id].warnings } : null,
  };
  for (const [kind, arr] of [['question', questions], ['lesson', lessons], ['fact', facts]]) {
    for (const it of arr) if (it.verification.status !== 'verified') review.flagged.push({ kind, chapter: ch.id, id: it.id, status: it.verification.status, item: it });
  }
  for (const u of chUnits.filter((x) => x.visual)) review.visual.push({ id: u.id, page: u.page, figure: u.figure, text: u.text, status: u.transcription?.status ?? 'single_read', readings: u.readings });
  // progress of the chapter against the book: share of required core units that have at least one fact, and the last page reached
  const coveredReq = reqRows.filter((r) => r.f.length);
  const progress = {
    requiredUnits: reqRows.length, coveredUnits: coveredReq.length,
    coveredThroughPage: coveredReq.length ? Math.max(...coveredReq.map((r) => r.p)) : null,
    complete: reqRows.length > 0 && coveredReq.length === reqRows.length && lessons.every((l) => l.verification.status === 'verified') && questions.every((q) => q.verification.status === 'verified') && facts.every((f) => f.verification.status === 'verified'),
  };
  emitted.push({ ...bundle.chapter, progress, lessons: lessons.map((l) => ({
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

// chapters shown as "עובדים על זה": not open, or open but no authored lessons yet. Appendix-like chapters can be grouped into one card.
const upcoming = [];
const grouped = new Set(Object.values(AVAIL.groups ?? {}).flat());
for (const ch of chapters) {
  if (emitted.some((e) => e.id === ch.id) || grouped.has(ch.id)) continue;
  upcoming.push({ id: ch.id, title: ch.title, firstPage: ch.firstPage, lastPage: ch.lastPage });
}
for (const [gid, ids] of Object.entries(AVAIL.groups ?? {})) {
  const members = chapters.filter((c) => ids.includes(c.id) && !emitted.some((e) => e.id === c.id));
  if (!members.length) continue;
  upcoming.push({ id: `group-${gid}`, title: `המשך הספר: ${members.map((m) => m.title).join(', ')}`, firstPage: Math.min(...members.map((m) => m.firstPage)), lastPage: Math.max(...members.map((m) => m.lastPage)) });
}
upcoming.sort((a, b) => a.firstPage - b.firstPage);

const hash = crypto.createHash('sha256');
for (const b of bundles) hash.update(JSON.stringify(b));
hash.update(JSON.stringify(upcoming));
const manifest = {
  contentVersion: (PREVIEW ? 'PREVIEW-' : '') + hash.digest('hex').slice(0, 12), preview: PREVIEW, generatedAt: new Date().toISOString(),
  book: 'official-bahad1-book', totalPages: 314, chapters: emitted, upcoming,
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
