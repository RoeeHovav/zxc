/** Presentation of the ORIGINAL book text (study material = what is printed in the book, not a rewording).
 *  Pure functions: cleaning the extracted text for display, grouping source units into readable blocks, and building the narrator's segments. */
import { PAUSE, segmentsFromText, type SpeechSegment } from './speech';

/** One source unit as exported in sources/<chapter>.json (already in reading order). */
export interface BookUnit {
  id: string; page: number; kind: string; text: string;
  figure?: string; cells?: string[];
  /** heading level 1..3 */ h?: number;
  /** table id + row number (consecutive rows with the same id form one table) */ table?: string; row?: number;
  /** terms printed in bold/underline in the book (exam focus) */ bold?: string[];
  /** transcription status of an image text (figure_text); only agreed/adjudicated transcriptions are shown as text */ tr?: string;
}

const TR_OK = new Set(['double_read_agree', 'adjudicated', 'agreed', 'verified']);
/** an image text may be shown/read as text only when two independent readings agreed (units without a status — e.g. plain text — are fine) */
export const transcriptionTrusted = (tr: string | undefined) => tr === undefined || TR_OK.has(tr);

export type BookBlock =
  | { type: 'page'; id: string; page: number }
  | { type: 'heading'; id: string; level: number; text: string }
  | { type: 'p'; id: string; text: string; bold?: string[] }
  | { type: 'epigraph'; id: string; text: string }
  | { type: 'box'; id: string; text: string; bold?: string[] }
  | { type: 'note'; id: string; text: string; bold?: string[] }
  | { type: 'caption'; id: string; text: string }
  | { type: 'thought'; id: string; text: string }
  | { type: 'table'; id: string; rows: string[][] }
  | { type: 'figure'; id: string; figure: string; text?: string };

// ---------------------------------------------------------------------------------------------------------------------------
// display cleaning: the PDF text layer has layout artefacts (spaces before punctuation, "( 1926", "על- פי", invisible bidi marks).
// Only spacing/invisible characters are touched — never a letter, digit or word.
// ---------------------------------------------------------------------------------------------------------------------------
const WORD_CH = /[א-ת0-9]/;
/** PDF text layers often glue a CLOSING straight quote to the next word ("יהדות "שלוש): quotes are paired in order; a closing quote that is detached
 *  from the previous word and attached to the next one goes back to the previous word. Gershayim inside words (צה"ל) are left alone, and nothing is
 *  changed when the quotes cannot be paired unambiguously (odd count). */
function fixQuotes(t: string): string {
  const boundary = new Set<number>();
  for (let i = 0; i < t.length; i++) if (t[i] === '"' && !(i > 0 && WORD_CH.test(t[i - 1]) && i + 1 < t.length && WORD_CH.test(t[i + 1]))) boundary.add(i);
  if (!boundary.size || boundary.size % 2 === 1) return t;
  let out = ''; let k = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== '"' || !boundary.has(i)) { out += t[i]; continue; }
    const closing = k++ % 2 === 1;
    if (closing && t[i - 1] === ' ' && i + 1 < t.length && WORD_CH.test(t[i + 1])) out = `${out.replace(/ $/, '')}" `; else out += '"';
  }
  return out;
}

export function tidyBookText(raw: string): string {
  return fixQuotes(raw
    .replace(/[‎‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])(?=\s|$)/g, '$1') // "התחומים ." → "התחומים."
    .replace(/\s+([,.;:!?])(?=[^\s\d.,;:!?)"”״'])/g, '$1 ') // "ירושלים ,היישוב" → "ירושלים, היישוב"
    .replace(/([א-ת])\(\s*/g, '$1 (') // "זאבי( 1926" → "זאבי (1926"
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/([א-ת])-\s+(?=[א-ת])/g, '$1-') // "על- פי" → "על-פי"
    .trim());
}

/** Wraps the printed-bold terms of a paragraph. Returns plain text parts and bold parts in order (terms that are not found are skipped). */
export function emphasisParts(text: string, terms: string[] | undefined): { text: string; bold: boolean }[] {
  const t = text;
  if (!terms?.length) return [{ text: t, bold: false }];
  const spans: [number, number][] = [];
  for (const raw of terms) {
    const term = tidyBookText(raw);
    if (term.length < 3) continue;
    let from = 0;
    for (;;) {
      const i = t.indexOf(term, from);
      if (i < 0) break;
      spans.push([i, i + term.length]);
      from = i + term.length;
    }
  }
  if (!spans.length) return [{ text: t, bold: false }];
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const s of spans) { const last = merged[merged.length - 1]; if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]); else merged.push([s[0], s[1]]); }
  const out: { text: string; bold: boolean }[] = [];
  let pos = 0;
  for (const [a, b] of merged) { if (a > pos) out.push({ text: t.slice(pos, a), bold: false }); out.push({ text: t.slice(a, b), bold: true }); pos = b; }
  if (pos < t.length) out.push({ text: t.slice(pos), bold: false });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// units → blocks
// ---------------------------------------------------------------------------------------------------------------------------
export function groupBookBlocks(units: BookUnit[], opts: { pageMarkers?: boolean } = {}): BookBlock[] {
  const out: BookBlock[] = [];
  let lastPage = -1;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (opts.pageMarkers && u.page !== lastPage) { out.push({ type: 'page', id: `page:${u.page}`, page: u.page }); }
    lastPage = u.page;
    const text = tidyBookText(u.text ?? '');
    const bold = u.bold?.length ? u.bold : undefined;
    switch (u.kind) {
      case 'heading': if (text) out.push({ type: 'heading', id: u.id, level: Math.min(3, Math.max(1, u.h ?? 3)), text }); break;
      case 'epigraph': if (text) out.push({ type: 'epigraph', id: u.id, text }); break;
      case 'box': if (text) out.push({ type: 'box', id: u.id, text, bold }); break;
      case 'note': if (text) out.push({ type: 'note', id: u.id, text, bold }); break;
      case 'caption': if (text) out.push({ type: 'caption', id: u.id, text }); break;
      case 'thought_box': if (text) out.push({ type: 'thought', id: u.id, text }); break;
      case 'figure': if (u.figure) out.push({ type: 'figure', id: u.id, figure: u.figure }); break;
      case 'figure_text': out.push({ type: 'figure', id: u.id, figure: u.figure ?? '', text: transcriptionTrusted(u.tr) && text ? text : undefined }); break;
      case 'table_row': {
        const rows: string[][] = [];
        const tid = u.table ?? u.id;
        let j = i;
        while (j < units.length && units[j].kind === 'table_row' && (units[j].table ?? units[j].id) === tid && units[j].page === u.page) {
          rows.push((units[j].cells?.length ? units[j].cells! : [units[j].text]).map(tidyBookText));
          j++;
        }
        i = j - 1;
        if (rows.every((r) => r.length <= 1)) rows.forEach((r, k) => { if (r[0]) out.push({ type: 'caption', id: `${tid}.${k}`, text: r[0] }); }); // a one-column "table" is a caption
        else out.push({ type: 'table', id: tid, rows });
        break;
      }
      default: if (text) out.push({ type: 'p', id: u.id, text, bold });
    }
  }
  return out;
}

/** Block id used for highlighting while the narrator reads (one id per block). */
export const blockSpeechId = (prefix: string, b: BookBlock) => `${prefix}:${b.id}`;

/** Narrator segments for the original text, in reading order. Headings get a title pause; tables are read row by row. */
export function bookSegments(blocks: BookBlock[], prefix: string): SpeechSegment[] {
  const out: SpeechSegment[] = [];
  for (const b of blocks) {
    const id = blockSpeechId(prefix, b);
    switch (b.type) {
      case 'page': break;
      case 'heading': out.push(...segmentsFromText(b.text, { blockId: id, after: PAUSE.title })); break;
      case 'table': b.rows.forEach((row, r) => out.push(...segmentsFromText(row.join(', '), { blockId: id, after: r === b.rows.length - 1 ? PAUSE.block : PAUSE.bullet }))); break;
      case 'figure': if (b.text) out.push(...segmentsFromText(b.text, { blockId: id, after: PAUSE.block })); break;
      default: out.push(...segmentsFromText(b.text, { blockId: id }));
    }
  }
  return out;
}
