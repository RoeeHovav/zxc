/**
 * Read-aloud text preparation (pure functions, no browser APIs).
 *
 * Goal: make a Hebrew text-to-speech voice sound as natural as possible. Engines read exactly what they are given, so this module
 *  - removes things engines stumble over (niqqud, quotation marks around phrases, brackets, slashes, bullets),
 *  - spells out what engines commonly misread (Hebrew-letter numerals and years such as ט״ו / תש״ח, ranges like 1936-1939, percentages, a few abbreviations),
 *  - cuts the text into short sentences so every sentence gets its own natural intonation and a human-sounding pause.
 * It only changes how text is SPOKEN. Nothing here touches the displayed content.
 */
import type { ExplainBlock } from './types';

export interface SpeechSegment {
  text: string;
  /** silence after this segment (ms): a comma-length breath, a sentence end, a paragraph break */
  pauseAfterMs: number;
  /** multiplies the user's speaking rate (e.g. 0.92 for a sentence the learner must remember) */
  rate?: number;
  /** id of the on-screen block this segment belongs to (used to highlight it while it is read) */
  blockId?: string;
}

export const PAUSE = { clause: 140, sentence: 330, bullet: 420, block: 560, title: 650 } as const;

// ---------------------------------------------------------------------------------------------------------------------------------
// Hebrew-letter numerals (gematria) – read as numbers, not as letter names
// ---------------------------------------------------------------------------------------------------------------------------------
const GEMATRIA: Record<string, number> = {
  א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9, י: 10, כ: 20, ך: 20, ל: 30, מ: 40, ם: 40, נ: 50, ן: 50, ס: 60, ע: 70, פ: 80, ף: 80, צ: 90, ץ: 90,
  ק: 100, ר: 200, ש: 300, ת: 400,
};
export function gematria(letters: string): number {
  let n = 0;
  for (const ch of letters) { const v = GEMATRIA[ch]; if (v === undefined) return NaN; n += v; }
  return n;
}

const HEB = '\\u05d0-\\u05ea';
const NOT_HEB_BEFORE = `(?<![${HEB}"'])`;
const NOT_HEB_AFTER = `(?![${HEB}"'])`;
const MONTHS = 'תשרי|חשוון|חשון|מרחשוון|כסלו|טבת|שבט|אדר|ניסן|אייר|סיוון|סיון|תמוז|אב|אלול';
const TENS = new Set(['י', 'כ', 'ל']);

function hebrewNumerals(s: string): string {
  // Hebrew years: תש״ח → 5708 (the thousands are implied in print); the letters must add up to a plausible year (500–899)
  s = s.replace(new RegExp(`${NOT_HEB_BEFORE}([ובכלמש]?)(ת[${HEB}]{1,3}"[${HEB}])${NOT_HEB_AFTER}`, 'g'), (m, prefix: string, tok: string) => {
    const v = gematria(tok.replace('"', ''));
    if (!(v >= 500 && v <= 899)) return m;
    return `${prefix ? `${prefix}-` : ''}${5000 + v}`;
  });
  // two-letter day/number numerals: ט״ו, י״ב, כ״ט, ל״ג … (tens letter + units letter, or ט״ו / ט״ז), optionally with a one-letter prefix (בי״ב באב)
  s = s.replace(new RegExp(`${NOT_HEB_BEFORE}([בלמו]?)([${HEB}])"([${HEB}])${NOT_HEB_AFTER}`, 'g'), (m, prefix: string, a: string, b: string) => {
    const va = GEMATRIA[a]; const vb = GEMATRIA[b];
    const n = a === 'ט' && (b === 'ו' || b === 'ז') ? va + vb : TENS.has(a) && vb >= 1 && vb <= 9 ? va + vb : 0;
    return n ? `${prefix ? `${prefix}-` : ''}${n}` : m;
  });
  // a single letter before a month name is the day of the month: ה׳ באייר → 5 באייר
  s = s.replace(new RegExp(`${NOT_HEB_BEFORE}([${HEB}])' (ב(?:${MONTHS}))(?![${HEB}])`, 'g'), (m, a: string, month: string) => {
    const v = GEMATRIA[a];
    return v >= 1 && v <= 30 && (v < 10 || TENS.has(a)) ? `${v} ${month}` : m;
  });
  return s;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Abbreviations engines usually spell out letter by letter (only expansions that are certain; צה״ל, האו״ם, בג״ץ … are read well by engines)
// ---------------------------------------------------------------------------------------------------------------------------------
const PREFIX = '[וכלבהמש]{0,2}';
const ABBREVIATIONS: [string, string][] = [
  ['וכו\'', 'וכולי'], ['וגו\'', 'וגומר'], ['וכד\'', 'וכדומה'], ['עמ\'', 'עמוד'], ['מס\'', 'מספר'], ['פרופ\'', 'פרופסור'], ['ד"ר', 'דוקטור'],
  ['ע"י', 'על ידי'], ['ע"פ', 'על פי'], ['עפ"י', 'על פי'], ['בד"כ', 'בדרך כלל'], ['ז"ל', 'זכרונו לברכה'], ['חז"ל', 'חכמינו זכרונם לברכה'],
  ['ק"מ', 'קילומטר'], ['ס"מ', 'סנטימטר'], ['דו"ח', 'דוח'], ['בע"ח', 'בעלי חיים'],
];
function expandAbbreviations(s: string): string {
  for (const [abbr, full] of ABBREVIATIONS) {
    const re = new RegExp(`(?<![${HEB}])(${PREFIX})${abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![${HEB}])`, 'g');
    s = s.replace(re, (_m, pre: string) => `${pre}${full}`);
  }
  // רבי before a name: ר׳ יהודה הנשיא
  s = s.replace(new RegExp(`(?<![${HEB}])ר' (?=[${HEB}])`, 'g'), 'רבי ');
  return s;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// cleaning
// ---------------------------------------------------------------------------------------------------------------------------------
export function cleanForSpeech(input: string): string {
  let s = String(input ?? '');
  s = s.replace(/[​-‏‪-‮⁦-⁩﻿]/g, '').replace(/ /g, ' ');
  // typographic variants → plain ones
  s = s.replace(/״/g, '"').replace(/׳/g, "'").replace(/[“”„‟«»]/g, '"').replace(/[‘’]/g, "'");
  s = s.replace(/\[\?\]/g, '');
  s = hebrewNumerals(s);
  s = expandAbbreviations(s);
  // vowel points and cantillation (most voices read them badly or not at all); maqaf is a hyphen
  s = s.replace(/־/g, '-').replace(/[֑-ֽֿ-ׇ]/g, '');
  // approximately: כ-85,000 → בערך 85,000
  s = s.replace(new RegExp(`(?<![${HEB}])כ-(?=\\d)`, 'g'), 'בערך ');
  // ranges and percentages
  s = s.replace(/(\d)\s*[-–—]\s*(\d)/g, '$1 עד $2');
  s = s.replace(/(\d+(?:[.,]\d+)?)\s*%/g, '$1 אחוז');
  // a hyphen between two Hebrew words (בן-גוריון, אל-כרמל) is just a space for the voice
  s = s.replace(new RegExp(`([${HEB}])-(?=[${HEB}])`, 'g'), '$1 ');
  // a stray quote after a one-letter prefix (ה"הגנה, ל"הגנה — an artefact of the printed text) is silent
  s = s.replace(new RegExp(`(?<![${HEB}])([הלבומשכ])"(?=[${HEB}]{3,})`, 'g'), '$1');
  // quotation marks around phrases are silent; the quote inside an acronym (צה"ל) stays
  s = s.replace(/(^|[\s(\[,;:.!?])"/g, '$1').replace(/"(?=$|[\s)\],;:.!?])/g, '');
  s = s.replace(/(^|[\s(\[,;:.!?])'/g, '$1').replace(/'(?=$|[\s)\],;:.!?])/g, (m, off: number, str: string) => (/[א-ת]/.test(str[off - 1] ?? '') ? m : ''));
  // parentheses and dashes become a short breath
  s = s.replace(/\s*[(\[{]\s*/g, ', ').replace(/\s*[)\]}]\s*/g, ', ');
  s = s.replace(/\s+[–—-]\s+/g, ', ').replace(/\s*…\s*|\s*\.{3,}\s*/g, ', ');
  s = s.replace(/\s+\/\s+/g, ', ');
  s = s.replace(/[•·▪◦►▶→←↔↑↓§#*_^~|✓✔×]/g, ' ');
  // tidy up the punctuation that the replacements created
  s = s.replace(/\s+([,;:.!?])/g, '$1').replace(/([,;:])(\s*[,;:])+/g, '$1').replace(/^[\s,;:]+/, '');
  s = s.replace(/,\s*([.!?])/g, '$1');
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s.replace(/[\s,;]+$/, '');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// segmentation
// ---------------------------------------------------------------------------------------------------------------------------------
const MAX_SEGMENT = 170; // engines (Chrome especially) cut very long utterances off; short sentences also sound more natural

function splitLong(sentence: string, max: number): string[] {
  if (sentence.length <= max) return [sentence];
  const out: string[] = [];
  let rest = sentence;
  while (rest.length > max) {
    const win = rest.slice(0, max);
    let cut = Math.max(win.lastIndexOf(', '), win.lastIndexOf('; '), win.lastIndexOf(': '));
    if (cut < max * 0.4) cut = win.lastIndexOf(' ');
    if (cut < 20) cut = max;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Cleaned text → sentences (each ≤ MAX_SEGMENT chars). A trailing colon keeps the sentence together with what it introduces only when short. */
export function splitIntoSentences(cleaned: string, max = MAX_SEGMENT): string[] {
  const parts = cleaned.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  return parts.flatMap((p) => splitLong(p, max));
}

function pauseFor(sentence: string, isLast: boolean, last: number): number {
  if (isLast) return last;
  if (/[?]$/.test(sentence)) return PAUSE.sentence + 40;
  if (/[:]$/.test(sentence)) return PAUSE.sentence - 60;
  if (/[.!]$/.test(sentence)) return PAUSE.sentence;
  return PAUSE.clause; // a long sentence that was cut at a comma
}

export interface TextOpts { blockId?: string; rate?: number; after?: number }
/** Plain text → segments with human-like pauses; `after` is the pause after the last segment (e.g. a paragraph break). */
export function segmentsFromText(text: string, o: TextOpts = {}): SpeechSegment[] {
  const sentences = splitIntoSentences(cleanForSpeech(text));
  return sentences.map((t, i) => ({ text: t, pauseAfterMs: pauseFor(t, i === sentences.length - 1, o.after ?? PAUSE.block), ...(o.rate ? { rate: o.rate } : {}), ...(o.blockId ? { blockId: o.blockId } : {}) }));
}

/** A lesson card: title, then every block in order. Lists get a breath after each item, the key sentence is read a little slower. */
export function explainSegments(title: string | undefined, blocks: ExplainBlock[], idPrefix: string): SpeechSegment[] {
  const out: SpeechSegment[] = [];
  if (title) out.push(...segmentsFromText(title, { blockId: `${idPrefix}:title`, after: PAUSE.title }));
  blocks.forEach((b, i) => {
    const id = `${idPrefix}:${i}`;
    switch (b.kind) {
      case 'p': out.push(...segmentsFromText(b.text ?? '', { blockId: id })); break;
      case 'note': out.push(...segmentsFromText(b.text ?? '', { blockId: id })); break;
      case 'key': out.push(...segmentsFromText(b.text ?? '', { blockId: id, rate: 0.93, after: PAUSE.block + 120 })); break;
      case 'bullets': (b.items ?? []).forEach((it, j, arr) => out.push(...segmentsFromText(it, { blockId: id, after: j === arr.length - 1 ? PAUSE.block : PAUSE.bullet }))); break;
      case 'table': {
        const t = b.table;
        if (!t) break;
        t.rows.forEach((row, r) => {
          const line = row.map((cell, c) => `${t.headers[c] ? `${t.headers[c]}: ` : ''}${cell}`).join('. ');
          out.push(...segmentsFromText(line, { blockId: id, after: r === t.rows.length - 1 ? PAUSE.block : PAUSE.bullet }));
        });
        break;
      }
    }
  });
  return out;
}

const ORDINAL = ['ראשונה', 'שנייה', 'שלישית', 'רביעית', 'חמישית', 'שישית'];

export interface SpeakableQuestion {
  type: string;
  stem: string;
  /** idx = position of the option on screen (kept when some options are eliminated) */
  options?: { text: string; idx?: number }[];
  right?: { text: string }[];
  leftTexts?: string[];
  items?: string[];
}
/** A question as it is shown: the stem, then the options in the order on screen. It never says which option is right. */
export function questionSegments(q: SpeakableQuestion, idPrefix = 'q'): SpeechSegment[] {
  const out = segmentsFromText(q.stem, { blockId: `${idPrefix}:stem`, after: PAUSE.title });
  if ((q.type === 'mcq' || q.type === 'compare' || q.type === 'multi') && q.options) {
    q.options.forEach((o, k) => {
      const i = o.idx ?? k;
      out.push(...segmentsFromText(`אפשרות ${ORDINAL[i] ?? i + 1}: ${o.text}`, { blockId: `${idPrefix}:opt${i}`, after: PAUSE.bullet }));
    });
  }
  if (q.type === 'tf') out.push(...segmentsFromText('אפשרות ראשונה: נכון. אפשרות שנייה: לא נכון.', { blockId: `${idPrefix}:tf` }));
  if (q.type === 'match' && q.leftTexts && q.right) {
    out.push(...segmentsFromText('יש להתאים בין הפריטים הבאים.', { blockId: `${idPrefix}:mh`, after: PAUSE.sentence }));
    q.leftTexts.forEach((t, i) => out.push(...segmentsFromText(`פריט ${i + 1}: ${t}`, { blockId: `${idPrefix}:l${i}`, after: PAUSE.bullet })));
    out.push(...segmentsFromText('האפשרויות להתאמה הן:', { blockId: `${idPrefix}:mr`, after: PAUSE.sentence }));
    q.right.forEach((r, i) => out.push(...segmentsFromText(r.text, { blockId: `${idPrefix}:r${i}`, after: PAUSE.bullet })));
  }
  if (q.type === 'order' && q.items) {
    out.push(...segmentsFromText('יש לסדר את הפריטים הבאים:', { blockId: `${idPrefix}:oh`, after: PAUSE.sentence }));
    q.items.forEach((t, i) => out.push(...segmentsFromText(t, { blockId: `${idPrefix}:o${i}`, after: PAUSE.bullet })));
  }
  if (out.length) out[out.length - 1] = { ...out[out.length - 1], pauseAfterMs: 0 };
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// voices
// ---------------------------------------------------------------------------------------------------------------------------------
export interface VoiceInfo { voiceURI: string; name: string; lang: string; localService: boolean; default?: boolean }

export const isHebrewVoice = (v: Pick<VoiceInfo, 'lang'>): boolean => /^(he|iw)([-_]|$)/i.test(v.lang ?? '');

/** Heuristic quality score. Neural / "natural" / online voices sound far more human than the old concatenative desktop voices. */
export function voiceScore(v: VoiceInfo): number {
  const n = `${v.name} ${v.voiceURI}`;
  let s = 0;
  if (/natural|neural|wavenet|studio|premium|enhanced|מוגבר|משופר/i.test(n)) s += 60;
  if (/online|מקוון/i.test(n)) s += 15;
  if (/google/i.test(n)) s += 30;
  if (/microsoft/i.test(n) && /(hila|avri|noa|orly)/i.test(n)) s += 25; // current Microsoft Hebrew voices
  if (/(carmit|כרמית)/i.test(n)) s += 20;
  if (/(asaf|אסף)/i.test(n)) s -= 5; // older Windows desktop voice
  if (/compact|espeak|festival|mbrola/i.test(n)) s -= 40;
  if (v.localService) s += 4; // works offline, nothing leaves the device
  if (v.default) s += 1;
  return s;
}

export function rankVoices(voices: VoiceInfo[], allowOnline: boolean): VoiceInfo[] {
  return voices.filter(isHebrewVoice).filter((v) => allowOnline || v.localService).sort((a, b) => voiceScore(b) - voiceScore(a) || a.name.localeCompare(b.name));
}

/** The voice that will actually be used: an explicit choice (even an online one) wins, otherwise the best allowed Hebrew voice. */
export function pickVoice(voices: VoiceInfo[], voiceURI: string | null, allowOnline: boolean): VoiceInfo | null {
  const he = voices.filter(isHebrewVoice);
  if (voiceURI) { const chosen = he.find((v) => v.voiceURI === voiceURI); if (chosen) return chosen; }
  return rankVoices(voices, allowOnline)[0] ?? null;
}

/** Is there a Hebrew voice that is only available online while the user has not allowed online voices? (the UI then offers to enable it) */
export const onlineVoiceAvailable = (voices: VoiceInfo[]): boolean => voices.some((v) => isHebrewVoice(v) && !v.localService);
