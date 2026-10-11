import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProgressStore } from '../../src/storage/db';
import { buildBackup, maybeAutoSnapshot, restoreBackup, validateBackup } from '../../src/storage/backup';
import { sha256Hex } from '../../src/storage/sha256';
import { applyOutcome } from '../../src/domain/review';

let n = 0;
let store: ProgressStore;
beforeEach(async () => { store = await ProgressStore.open(`test-${++n}`); });

describe('sha256', () => {
  it('matches known vectors', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('progress persistence', () => {
  it('stores and reloads stats, lesson state, xp and position', async () => {
    await store.putStat(applyOutcome(undefined, 'q1', 'first_try'));
    await store.putLessonState({ lessonId: 'l1', stepIndex: 3, stepsDone: [0, 1, 2], masteredAt: 123, masteredOnVersion: 'v1', attempts: 2, bestScore: 1, lastQuestionIds: ['q1'], startedAt: 1, lastOpened: 2 });
    await store.addXp(40);
    await store.setLastPosition({ lessonId: 'l1', stepIndex: 3 });
    const again = await ProgressStore.open(store.db.name);
    expect((await again.allStats()).q1.firstTry).toBe(1);
    expect((await again.allLessonStates()).l1.masteredAt).toBe(123);
    expect(await again.getXp()).toBe(40);
    expect(await again.getLastPosition()).toEqual({ lessonId: 'l1', stepIndex: 3 });
  });
  it('records assessments and exams', async () => {
    await store.addAssessment({ lessonId: 'l1', ts: 1, attempt: 1, total: 5, correct: 4, mastered: false, questionIds: [], results: [], contentVersion: 'v1' });
    expect(await store.assessmentsFor('l1')).toHaveLength(1);
    await store.addExam({ ts: 1, config: { chapters: [], count: 1, timeLimitMin: null, types: null, difficulties: null }, total: 1, correct: 1, percent: 100, durationMs: 5, results: [], contentVersion: 'v1' });
    expect(await store.allExams()).toHaveLength(1);
  });
  it('personal records only improve', async () => {
    expect(await store.setRecord('streak', 3)).toBe(true);
    expect(await store.setRecord('streak', 2)).toBe(false);
    expect(await store.setRecord('streak', 5)).toBe(true);
  });
});

describe('backup export / import', () => {
  const seed = async () => {
    await store.putStat(applyOutcome(undefined, 'q1', 'first_try'));
    await store.putLessonState({ lessonId: 'l1', stepIndex: 0, stepsDone: [], masteredAt: 5, masteredOnVersion: 'v1', attempts: 1, bestScore: 1, lastQuestionIds: [], startedAt: 1, lastOpened: 1 });
    await store.addXp(77);
  };
  it('round-trips through a validated file', async () => {
    await seed();
    const file = await buildBackup(store, 'v1');
    const text = JSON.stringify(file);
    const { check, file: parsed } = validateBackup(text, 'v1');
    expect(check.ok).toBe(true);
    expect(check.summary?.masteredLessons).toBe(1);
    const other = await ProgressStore.open(`test-restore-${n}`);
    await restoreBackup(other, parsed!, 'v1');
    expect((await other.allStats()).q1.firstTry).toBe(1);
    expect(await other.getXp()).toBe(77);
  });
  it('detects tampering via checksum and rejects non-backup files', async () => {
    await seed();
    const file = await buildBackup(store, 'v1');
    const tampered = JSON.parse(JSON.stringify(file));
    tampered.data.stores.lessonState[0].masteredAt = 999;
    expect(validateBackup(JSON.stringify(tampered), 'v1').check.ok).toBe(false);
    expect(validateBackup('{"hello":1}', 'v1').check.ok).toBe(false);
    expect(validateBackup('not json', 'v1').check.ok).toBe(false);
  });
  it('rejects backups from a newer schema and warns on content version differences', async () => {
    await seed();
    const file = await buildBackup(store, 'v1');
    expect(validateBackup(JSON.stringify({ ...file, schemaVersion: 99 }), 'v1').check.ok).toBe(false);
    const w = validateBackup(JSON.stringify(file), 'v2').check;
    expect(w.ok).toBe(true);
    expect(w.warnings.length).toBe(1);
  });
  it('restore keeps a safety snapshot of the previous progress (undo path)', async () => {
    await seed();
    const file = await buildBackup(store, 'v1');
    const other = await ProgressStore.open(`test-snap-${n}`);
    await other.addXp(5);
    await other.putStat(applyOutcome(undefined, 'old', 'first_try'));
    await restoreBackup(other, file, 'v1');
    const snaps = await other.snapshots();
    expect(snaps.some((s) => s.reason === 'before-restore')).toBe(true);
    expect(Object.keys(await other.allStats())).not.toContain('old');
    const prior = JSON.parse(snaps.find((s) => s.reason === 'before-restore')!.payload);
    expect(prior.data.stores.questionStats.some((s: any) => s.questionId === 'old')).toBe(true);
  });
  it('automatic daily snapshot only once per day and only when there is data', async () => {
    expect(await maybeAutoSnapshot(store, 'v1', '2026-10-11')).toBe(false);
    await seed();
    expect(await maybeAutoSnapshot(store, 'v1', '2026-10-11')).toBe(true);
    expect(await maybeAutoSnapshot(store, 'v1', '2026-10-11')).toBe(false);
  });
  it('wipe clears learning data', async () => {
    await seed();
    await store.wipeData();
    expect(Object.keys(await store.allStats())).toHaveLength(0);
    expect(await store.getXp()).toBe(0);
  });
});
