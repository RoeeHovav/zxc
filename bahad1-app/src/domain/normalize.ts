/** Answer normalisation for deterministic short-answer grading.
 *  Only HARMLESS formatting differences are erased (spacing, punctuation, quotation marks, niqqud, bidi marks,
 *  hyphen/maqaf, Latin case). No stemming, no fuzzy / keyword matching: an unknown answer is simply wrong. */
const BIDI = /[‎‏‪-‮⁦-⁩؜﻿]/g;
// vowel points + cantillation only; NOT U+05BE (maqaf, treated as a hyphen) nor U+05C0 / U+05C3 (paseq, sof pasuq = punctuation)
const NIQQUD = /[\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7]/g;
const QUOTES = /["'׳״“”„‘’‚`´]/g; // ״ ׳ “ ” ‘ ’ etc. (also inside acronyms: צה"ל = צהל)
const DASHES = /[\u2010-\u2015\u2212\u05be\u05c0\u05c3-]/g; // hyphens, en/em dash, minus, maqaf, paseq
const PUNCT = /[.,;:!?()[\]{}<>«»|/\\*•·…_~=+]/g;

export function normalizeAnswer(input: string): string {
  return input
    .normalize('NFC')
    .replace(BIDI, '')
    .replace(NIQQUD, '')
    .replace(QUOTES, '')
    .replace(DASHES, ' ')
    .replace(PUNCT, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Same normaliser, used by the content build to prepare `accepted` lists and to validate quotes against source text. */
export function normalizeForQuote(input: string): string {
  return normalizeAnswer(input).replace(/\s+/g, '');
}
