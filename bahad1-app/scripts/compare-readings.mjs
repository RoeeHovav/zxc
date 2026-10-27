#!/usr/bin/env node
// Compares the author's transcription of image text with a BLIND second reading (word-level, after normalisation).
//   node scripts/compare-readings.mjs private/content/readings/ch1_blind.json [chapter=ch1] [visualFile=visual_units.jsonl] [--cited]
// --cited: the blind reader may have transcribed MORE than the author (e.g. the print inside a stamp): a unit agrees when EVERY quote that facts/questions cite from it
//          occurs in the blind reading (after normalisation); otherwise it is 'disagree' (manual review).
// Units whose normalised text is identical get transcription.status = 'double_read_agree'; others 'disagree' (manual review).
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_SRC, loadChapterContent, normalizeAnswer, normalizeForQuote, readJson, readJsonl } from './lib/content-lib.mjs';

const blindFile = process.argv[2];
const CITED = process.argv.includes('--cited');
const chapterId = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'ch1';
const blind = readJson(blindFile);
const file = path.join(CONTENT_SRC, chapterId, process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : 'visual_units.jsonl');
const units = readJsonl(file);
let agree = 0, disagree = 0;
for (const u of units) {
  const b = blind[u.id];
  if (b === undefined) continue;
  if (CITED) {
    const { facts, questions } = loadChapterContent(chapterId);
    const quotes = [...facts, ...questions].flatMap((x) => (x.refs ?? []).filter((r) => r.unit === u.id).map((r) => r.quote));
    const nb = normalizeForQuote(b);
    const missing = [...new Set(quotes)].filter((q) => !nb.includes(normalizeForQuote(q)));
    u.readings = [...(u.readings ?? []).filter((r) => r.by !== 'blind'), { by: 'blind', text: b }];
    u.transcription = { status: quotes.length && !missing.length ? 'double_read_agree' : 'disagree', basis: 'cited quotes found in the blind reading' };
    if (u.transcription.status === 'double_read_agree') agree++; else { disagree++; console.log(`DISAGREE ${u.id}: ${quotes.length ? 'not confirmed by the blind reading: ' + missing.join(' | ') : 'no cited quotes'}`); }
    continue;
  }
  const A = normalizeAnswer(u.text).split(' ').filter(Boolean);
  const B = normalizeAnswer(b).split(' ').filter(Boolean);
  const same = A.length === B.length && A.every((w, i) => w === B[i]) && !/\[\?\]/.test(b);
  u.readings = [...(u.readings ?? []).filter((r) => r.by !== 'blind'), { by: 'blind', text: b }];
  u.transcription = { status: same ? 'double_read_agree' : 'disagree' };
  if (same) agree++; else {
    disagree++;
    const diffs = [];
    for (let i = 0, j = 0; i < A.length || j < B.length; i++, j++) {
      if (A[i] !== B[j]) { diffs.push(`#${i}: author "${A[i] ?? '∅'}" vs blind "${B[j] ?? '∅'}"`); if (diffs.length > 12) break; }
    }
    console.log(`DISAGREE ${u.id}:`, diffs.join(' | '));
  }
}
fs.writeFileSync(file, units.map((u) => JSON.stringify(u)).join('\n') + '\n');
console.log(`readings compared: ${agree} agree, ${disagree} disagree`);
