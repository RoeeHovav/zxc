// Shared helpers for content validation/build. Runs on Node >= 22.18 (native TypeScript type stripping).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAnswer, normalizeForQuote } from '../../src/domain/normalize.ts';

export { normalizeAnswer, normalizeForQuote };
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PRIV = path.join(ROOT, 'private');
export const CONTENT_SRC = path.join(PRIV, 'content');
export const SOURCE_DIR = path.join(PRIV, 'work', 'source');

export function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
export function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** All citable source units: printed-text units + transcribed figure units. */
export function loadUnits() {
  const map = new Map();
  for (const u of readJsonl(path.join(SOURCE_DIR, 'units.jsonl'))) map.set(u.id, { ...u, visual: false });
  const vfiles = [path.join(CONTENT_SRC, 'visual_units.jsonl')];
  if (fs.existsSync(CONTENT_SRC)) for (const d of fs.readdirSync(CONTENT_SRC)) vfiles.push(path.join(CONTENT_SRC, d, 'visual_units.jsonl'));
  for (const f of vfiles) for (const u of readJsonl(f)) map.set(u.id, { ...u, kind: u.kind ?? 'figure_text', scope: u.scope ?? 'core', visual: true });
  return map;
}
export function loadFigures() {
  const p = path.join(SOURCE_DIR, 'figures.json');
  const set = new Set();
  if (fs.existsSync(p)) for (const f of readJson(p)) set.add(f.id);
  return set;
}
export function chaptersMeta() { return readJson(path.join(PRIV, 'chapters.json')); }

export function loadChapterContent(chId) {
  const dir = path.join(CONTENT_SRC, chId);
  const get = (n) => (fs.existsSync(path.join(dir, n)) ? readJson(path.join(dir, n)) : []);
  return { facts: get('facts.json'), lessons: get('lessons.json'), questions: get('questions.json'), dir };
}

export function words(s) { return normalizeAnswer(s).split(' ').filter(Boolean); }

/** Longest run of consecutive words of `text` that also appears verbatim (word-wise) in `source`. */
export function longestVerbatimRun(text, source) {
  const tw = words(text);
  const sw = words(source);
  if (!tw.length || !sw.length) return 0;
  const idx = new Map();
  sw.forEach((w, i) => { (idx.get(w) ?? idx.set(w, []).get(w)).push(i); });
  let best = 0;
  for (let i = 0; i < tw.length; i++) {
    for (const j of idx.get(tw[i]) ?? []) {
      let k = 0;
      while (i + k < tw.length && j + k < sw.length && tw[i + k] === sw[j + k]) k++;
      if (k > best) best = k;
    }
  }
  return best;
}

export const NONE_OF_ABOVE = /(כל התשובות|אף אחת מהתשובות|אף תשובה|כל הנ"ל|כולן נכונות|אין תשובה נכונה|שתי התשובות|שני הסעיפים)/;
