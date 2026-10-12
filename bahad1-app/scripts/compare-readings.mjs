#!/usr/bin/env node
// Compares the author's transcription of image text with a BLIND second reading (word-level, after normalisation).
//   node scripts/compare-readings.mjs private/content/readings/ch1_blind.json [chapter=ch1] [visualFile=visual_units.jsonl]
// Units whose normalised text is identical get transcription.status = 'double_read_agree'; others 'disagree' (manual review).
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_SRC, normalizeAnswer, readJson, readJsonl } from './lib/content-lib.mjs';

const blindFile = process.argv[2];
const blind = readJson(blindFile);
const file = path.join(CONTENT_SRC, process.argv[3] ?? 'ch1', process.argv[4] ?? 'visual_units.jsonl');
const units = readJsonl(file);
let agree = 0, disagree = 0;
for (const u of units) {
  const b = blind[u.id];
  if (b === undefined) continue;
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
