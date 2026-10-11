import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  DEFAULT_PREFERENCES, type AssessmentRecord, type ExamRecord, type GradeFlag, type LessonState, type Preferences,
  type QuestionStat, type ReviewDecision,
} from '../domain/types';

export const SCHEMA_VERSION = 1;

export interface ActivityDay { date: string; answered: number; firstTry: number; xp: number }
export interface UnlockedAchievement { id: string; ts: number }
export interface PersonalRecord { id: string; value: number; ts: number }
export interface BackupSnapshot { id?: number; ts: number; reason: string; payload: string }

interface Schema extends DBSchema {
  meta: { key: string; value: unknown };
  questionStats: { key: string; value: QuestionStat };
  lessonState: { key: string; value: LessonState };
  assessments: { key: number; value: AssessmentRecord; indexes: { byLesson: string } };
  exams: { key: number; value: ExamRecord };
  activity: { key: string; value: ActivityDay };
  achievements: { key: string; value: UnlockedAchievement };
  records: { key: string; value: PersonalRecord };
  flags: { key: number; value: GradeFlag };
  decisions: { key: string; value: ReviewDecision };
  xpLog: { key: string; value: { questionId: string; ts: number } };
  backups: { key: number; value: BackupSnapshot };
}

export type StoreName =
  | 'questionStats' | 'lessonState' | 'assessments' | 'exams' | 'activity' | 'achievements' | 'records' | 'flags' | 'decisions' | 'xpLog';
export const DATA_STORES: readonly StoreName[] = ['questionStats', 'lessonState', 'assessments', 'exams', 'activity', 'achievements', 'records', 'flags', 'decisions', 'xpLog'];

/** All learning progress lives here (IndexedDB, local to this browser). There is NO cross-device synchronisation. */
export class ProgressStore {
  private constructor(readonly db: IDBPDatabase<Schema>) {}

  static async open(name = 'bahad1'): Promise<ProgressStore> {
    const db = await openDB<Schema>(name, SCHEMA_VERSION, {
      upgrade(d) {
        d.createObjectStore('meta');
        d.createObjectStore('questionStats', { keyPath: 'questionId' });
        d.createObjectStore('lessonState', { keyPath: 'lessonId' });
        const a = d.createObjectStore('assessments', { keyPath: 'id', autoIncrement: true });
        a.createIndex('byLesson', 'lessonId');
        d.createObjectStore('exams', { keyPath: 'id', autoIncrement: true });
        d.createObjectStore('activity', { keyPath: 'date' });
        d.createObjectStore('achievements', { keyPath: 'id' });
        d.createObjectStore('records', { keyPath: 'id' });
        d.createObjectStore('flags', { keyPath: 'id', autoIncrement: true });
        d.createObjectStore('decisions', { keyPath: 'itemId' });
        d.createObjectStore('xpLog', { keyPath: 'questionId' });
        d.createObjectStore('backups', { keyPath: 'id', autoIncrement: true });
      },
    });
    const s = new ProgressStore(db);
    if ((await db.get('meta', 'schemaVersion')) == null) await db.put('meta', SCHEMA_VERSION, 'schemaVersion');
    if ((await db.get('meta', 'createdAt')) == null) await db.put('meta', Date.now(), 'createdAt');
    return s;
  }

  close() { this.db.close(); }

  /* ----- meta ----- */
  async getMeta<T>(key: string, fallback: T): Promise<T> {
    const v = await this.db.get('meta', key);
    return (v === undefined ? fallback : v) as T;
  }
  async setMeta(key: string, value: unknown) { await this.db.put('meta', value, key); }

  async getPreferences(): Promise<Preferences> { return { ...DEFAULT_PREFERENCES, ...(await this.getMeta<Partial<Preferences>>('preferences', {})) }; }
  async setPreferences(p: Preferences) { await this.setMeta('preferences', p); }
  async getXp(): Promise<number> { return this.getMeta<number>('xp', 0); }
  async addXp(n: number): Promise<number> { const x = (await this.getXp()) + n; await this.setMeta('xp', x); return x; }

  /* ----- question stats ----- */
  async getStat(id: string) { return this.db.get('questionStats', id); }
  async putStat(s: QuestionStat) { await this.db.put('questionStats', s); }
  async allStats(): Promise<Record<string, QuestionStat>> {
    const out: Record<string, QuestionStat> = {};
    for (const s of await this.db.getAll('questionStats')) out[s.questionId] = s;
    return out;
  }

  /* ----- lessons ----- */
  async getLessonState(id: string) { return this.db.get('lessonState', id); }
  async putLessonState(s: LessonState) { await this.db.put('lessonState', s); }
  async allLessonStates(): Promise<Record<string, LessonState>> {
    const out: Record<string, LessonState> = {};
    for (const s of await this.db.getAll('lessonState')) out[s.lessonId] = s;
    return out;
  }
  async setLastPosition(p: { lessonId: string; stepIndex: number } | null) { await this.setMeta('lastPosition', p); }
  async getLastPosition() { return this.getMeta<{ lessonId: string; stepIndex: number } | null>('lastPosition', null); }

  /* ----- assessments / exams ----- */
  async addAssessment(a: AssessmentRecord) { return this.db.add('assessments', a) as Promise<number>; }
  async assessmentsFor(lessonId: string) { return this.db.getAllFromIndex('assessments', 'byLesson', lessonId); }
  async allAssessments() { return this.db.getAll('assessments'); }
  async addExam(e: ExamRecord) { return this.db.add('exams', e) as Promise<number>; }
  async allExams() { return this.db.getAll('exams'); }

  /* ----- activity / achievements / records ----- */
  async bumpActivity(date: string, d: { answered?: number; firstTry?: number; xp?: number }) {
    const cur = (await this.db.get('activity', date)) ?? { date, answered: 0, firstTry: 0, xp: 0 };
    cur.answered += d.answered ?? 0; cur.firstTry += d.firstTry ?? 0; cur.xp += d.xp ?? 0;
    await this.db.put('activity', cur);
    return cur;
  }
  async allActivity() { return this.db.getAll('activity'); }
  async unlockAchievement(id: string) { if (!(await this.db.get('achievements', id))) await this.db.put('achievements', { id, ts: Date.now() }); }
  async allAchievements() { return this.db.getAll('achievements'); }
  async setRecord(id: string, value: number, higherIsBetter = true): Promise<boolean> {
    const cur = await this.db.get('records', id);
    if (!cur || (higherIsBetter ? value > cur.value : value < cur.value)) { await this.db.put('records', { id, value, ts: Date.now() }); return true; }
    return false;
  }
  async allRecords() { return this.db.getAll('records'); }

  /* ----- grading flags + content-review decisions ----- */
  async addFlag(f: GradeFlag) { return this.db.add('flags', f) as Promise<number>; }
  async allFlags() { return this.db.getAll('flags'); }
  async putDecision(d: ReviewDecision) { await this.db.put('decisions', d); }
  async allDecisions(): Promise<Record<string, ReviewDecision>> {
    const out: Record<string, ReviewDecision> = {};
    for (const d of await this.db.getAll('decisions')) out[d.itemId] = d;
    return out;
  }
  async lastXpAward(questionId: string) { return (await this.db.get('xpLog', questionId))?.ts ?? 0; }
  async markXpAward(questionId: string) { await this.db.put('xpLog', { questionId, ts: Date.now() }); }

  /* ----- backups ----- */
  async addSnapshot(s: Omit<BackupSnapshot, 'id'>) {
    await this.db.add('backups', s as BackupSnapshot);
    const all = await this.db.getAllKeys('backups');
    for (const k of all.slice(0, Math.max(0, all.length - 5))) await this.db.delete('backups', k); // keep the 5 most recent
  }
  async snapshots() { return this.db.getAll('backups'); }

  async wipeData() {
    const tx = this.db.transaction([...DATA_STORES] as StoreName[], 'readwrite');
    await Promise.all(DATA_STORES.map((n) => tx.objectStore(n).clear()));
    await tx.done;
    for (const k of ['xp', 'lastPosition', 'preferences']) await this.db.delete('meta', k);
  }
}
