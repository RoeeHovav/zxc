import { describe, expect, it } from 'vitest';
import { canRequestHint, currentHints, maxWrong, requestHint, revealAnswer, startPractice, submitPractice } from '../../src/domain/practice';
import { mcq, short, tf } from './helpers';

describe('practice: progressive hints, distinct outcomes', () => {
  it('correct first try without help = first_try', () => {
    const q = mcq('q1');
    const r = submitPractice(q, startPractice(q), { type: 'mcq', value: 'b' });
    expect(r.correct).toBe(true);
    expect(r.state.outcome).toBe('first_try');
  });
  it('wrong answer shows hint 1, retry allowed; correct on 2nd try = retry (not first_try)', () => {
    const q = mcq('q1');
    let st = startPractice(q);
    let r = submitPractice(q, st, { type: 'mcq', value: 'a' });
    expect(r.correct).toBe(false);
    expect(r.revealed).toBe(false);
    expect(currentHints(q, r.state)).toEqual(['רמז 1']);
    expect(r.state.eliminated).toEqual(['a']);
    r = submitPractice(q, r.state, { type: 'mcq', value: 'b' });
    expect(r.state.outcome).toBe('retry');
  });
  it('manual hint then correct = hinted (never first_try)', () => {
    const q = mcq('q1');
    let st = startPractice(q);
    expect(canRequestHint(q, st)).toBe(true);
    st = requestHint(q, st);
    expect(currentHints(q, st)).toHaveLength(1);
    const r = submitPractice(q, st, { type: 'mcq', value: 'b' });
    expect(r.state.outcome).toBe('hinted');
  });
  it('two wrong answers then correct = hinted; eventually the answer is revealed', () => {
    const q = mcq('q1');
    let r = submitPractice(q, startPractice(q), { type: 'mcq', value: 'a' });
    r = submitPractice(q, r.state, { type: 'mcq', value: 'c' });
    expect(currentHints(q, r.state)).toHaveLength(2); // more specific hint
    const ok = submitPractice(q, r.state, { type: 'mcq', value: 'b' });
    expect(ok.state.outcome).toBe('hinted');
    // reveal after maxWrong wrong answers
    let st = startPractice(q);
    const wrongs = ['a', 'c', 'd'];
    for (let i = 0; i < maxWrong(q); i++) st = submitPractice(q, st, { type: 'mcq', value: wrongs[i % 3] }).state;
    expect(st.status).toBe('revealed');
    expect(st.outcome).toBe('revealed');
  });
  it('true/false reveals after a single wrong answer (a retry would be a guaranteed guess)', () => {
    const q = tf('t', true);
    const r = submitPractice(q, startPractice(q), { type: 'tf', value: false });
    expect(r.revealed).toBe(true);
    expect(r.state.outcome).toBe('revealed');
  });
  it('explicit reveal counts as revealed, answers after reveal are ignored', () => {
    const q = short('s', ['תשובה']);
    const st = revealAnswer(q, startPractice(q));
    expect(st.outcome).toBe('revealed');
    const r = submitPractice(q, st, { type: 'short', value: 'תשובה' });
    expect(r.state.outcome).toBe('revealed');
  });
});
