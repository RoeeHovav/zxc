import { describe, expect, it } from 'vitest';
import { normalizeAnswer } from '../../src/domain/normalize';
import { gradeAnswer, isAnswerComplete } from '../../src/domain/grade';
import { mcq, short, tf } from './helpers';
import type { MatchQuestion, MultiQuestion, OrderQuestion } from '../../src/domain/types';
import { V } from './helpers';

describe('normalizeAnswer (harmless formatting only)', () => {
  it('ignores spacing, case, punctuation, quote styles, niqqud and bidi marks', () => {
    expect(normalizeAnswer('  צה"ל ')).toBe(normalizeAnswer('צה״ל'));
    expect(normalizeAnswer('צה"ל')).toBe('צהל');
    expect(normalizeAnswer('אות-זוג')).toBe(normalizeAnswer('אות זוג'));
    expect(normalizeAnswer('אות־זוג')).toBe(normalizeAnswer('אות זוג'));
    expect(normalizeAnswer('שָׁלוֹם!')).toBe('שלום');
    expect(normalizeAnswer('‏שלום‎')).toBe('שלום');
    expect(normalizeAnswer('M16  A2')).toBe('m16 a2');
  });
  it('does not stem or fuzzy-match', () => {
    expect(normalizeAnswer('המילה')).not.toBe(normalizeAnswer('מילה'));
    expect(normalizeAnswer('1948')).not.toBe(normalizeAnswer('1949'));
  });
});

describe('deterministic grading', () => {
  it('mcq: exactly the correct option', () => {
    const q = mcq('q1');
    expect(gradeAnswer(q, { type: 'mcq', value: 'b' })).toBe(true);
    expect(gradeAnswer(q, { type: 'mcq', value: 'a' })).toBe(false);
    expect(gradeAnswer(q, { type: 'mcq', value: null })).toBe(false);
  });
  it('tf', () => {
    expect(gradeAnswer(tf('t', true), { type: 'tf', value: true })).toBe(true);
    expect(gradeAnswer(tf('t', true), { type: 'tf', value: false })).toBe(false);
    expect(gradeAnswer(tf('t', false), { type: 'tf', value: null })).toBe(false);
  });
  it('short answer: accepts only approved variants, rejects keyword-containing wrong answers', () => {
    const q = short('s1', ['שם ראשון שני', 'שם ראשון']);
    expect(gradeAnswer(q, { type: 'short', value: ' שם  ראשון-שני. ' })).toBe(true); // spacing / hyphen / dot only
    expect(gradeAnswer(q, { type: 'short', value: 'שם ראשון' })).toBe(true); // explicitly approved shorter variant
    expect(gradeAnswer(q, { type: 'short', value: 'שני' })).toBe(false); // keyword only
    expect(gradeAnswer(q, { type: 'short', value: 'שם ראשון שני שלישי' })).toBe(false); // contains the keywords but is a different answer
    expect(gradeAnswer(q, { type: 'short', value: '' })).toBe(false);
  });
  it('multi: set equality, no partial credit', () => {
    const q: MultiQuestion = { ...(mcq('m1') as any), type: 'multi', correct: ['a', 'c'] };
    expect(gradeAnswer(q, { type: 'multi', value: ['c', 'a'] })).toBe(true);
    expect(gradeAnswer(q, { type: 'multi', value: ['a'] })).toBe(false);
    expect(gradeAnswer(q, { type: 'multi', value: ['a', 'b', 'c'] })).toBe(false);
  });
  it('match: every pair must be right', () => {
    const q: MatchQuestion = { ...(mcq('x') as any), type: 'match', left: [{ id: 'l1', text: '1' }, { id: 'l2', text: '2' }], right: [{ id: 'r1', text: 'a' }, { id: 'r2', text: 'b' }], correct: { l1: 'r1', l2: 'r2' }, verification: V };
    expect(gradeAnswer(q, { type: 'match', value: { l1: 'r1', l2: 'r2' } })).toBe(true);
    expect(gradeAnswer(q, { type: 'match', value: { l1: 'r1', l2: 'r1' } })).toBe(false);
    expect(gradeAnswer(q, { type: 'match', value: { l1: 'r1' } })).toBe(false);
  });
  it('order: exact sequence', () => {
    const q: OrderQuestion = { ...(mcq('o') as any), type: 'order', items: [{ id: 'a', text: '' }, { id: 'b', text: '' }, { id: 'c', text: '' }], correct: ['b', 'a', 'c'] };
    expect(gradeAnswer(q, { type: 'order', value: ['b', 'a', 'c'] })).toBe(true);
    expect(gradeAnswer(q, { type: 'order', value: ['a', 'b', 'c'] })).toBe(false);
  });
  it('rejects an answer of the wrong type', () => {
    expect(gradeAnswer(mcq('q'), { type: 'tf', value: true })).toBe(false);
    expect(isAnswerComplete(mcq('q'), { type: 'mcq', value: null })).toBe(false);
    expect(isAnswerComplete(mcq('q'), { type: 'mcq', value: 'a' })).toBe(true);
  });
});
