import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { buildBank } from '../domain/bank';
import { todayStr } from '../domain/dates';
import { guidedStatuses, type GuidedStatus } from '../domain/mastery';
import { applyOutcome } from '../domain/review';
import { ACHIEVEMENTS, XP_LESSON_MASTERY, newlyUnlocked, rankFor, streakFromDays, xpForAnswer, type AchievementContext, type XpMode } from '../domain/xp';
import {
  DEFAULT_PREFERENCES, type AssessmentRecord, type ContentBundle, type ExamRecord, type LessonState, type Lesson, type Outcome, type Preferences,
  type Question, type QuestionStat, type ReviewDecision,
} from '../domain/types';
import { ProgressStore } from '../storage/db';
import { maybeAutoSnapshot } from '../storage/backup';
import { loadChapter, loadManifest, type Manifest } from '../content/loader';

export interface AppState {
  ready: boolean;
  error: string | null;
  manifest: Manifest | null;
  prefs: Preferences;
  xp: number;
  stats: Record<string, QuestionStat>;
  lessonStates: Record<string, LessonState>;
  decisions: Record<string, ReviewDecision>;
  activityDays: string[];
  activityToday: { answered: number; firstTry: number; xp: number };
  achievements: string[];
  exams: ExamRecord[];
  assessments: AssessmentRecord[];
  bundles: Record<string, ContentBundle>;
  lastPosition: { lessonId: string; stepIndex: number } | null;
  reviewSessions: number;
}

export interface AppApi extends AppState {
  store: ProgressStore | null;
  orderedLessonIds: string[];
  statuses: Record<string, GuidedStatus>;
  lessonTitle: (id: string) => string;
  streak: { current: number; longest: number };
  rank: ReturnType<typeof rankFor>;
  ensureChapters: (ids?: string[]) => Promise<Record<string, ContentBundle>>;
  bank: Question[];
  verifiedLessons: (chapterId: string) => Lesson[];
  recordAnswer: (q: Question, outcome: Outcome, mode: XpMode) => Promise<{ xp: number; unlocked: string[] }>;
  completeAssessment: (
    lesson: Lesson, questionIds: string[], results: { questionId: string; correct: boolean }[], questions: Question[],
  ) => Promise<{ mastered: boolean; firstMastery: boolean; xpGained: number; unlocked: string[] }>;
  saveLessonProgress: (lessonId: string, stepIndex: number, stepsDone: number[]) => Promise<void>;
  recordExam: (e: Omit<ExamRecord, 'id'>) => Promise<{ unlocked: string[]; xpGained: number }>;
  noteReviewSession: () => Promise<{ unlocked: string[] }>;
  setPrefs: (p: Preferences) => Promise<void>;
  setDecision: (d: ReviewDecision) => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AppApi | null>(null);
export const useApp = (): AppApi => {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppProvider missing');
  return v;
};

const initial: AppState = {
  ready: false, error: null, manifest: null, prefs: DEFAULT_PREFERENCES, xp: 0, stats: {}, lessonStates: {}, decisions: {}, activityDays: [],
  activityToday: { answered: 0, firstTry: 0, xp: 0 }, achievements: [], exams: [], assessments: [], bundles: {}, lastPosition: null, reviewSessions: 0,
};

export function AppProvider({ children, dbName = 'bahad1' }: { children: ReactNode; dbName?: string }) {
  const [state, setState] = useState<AppState>(initial);
  const storeRef = useRef<ProgressStore | null>(null);
  const [store, setStore] = useState<ProgressStore | null>(null);
  const bundlePromises = useRef<Record<string, Promise<ContentBundle>>>({});
  const manifestRef = useRef<Manifest | null>(null);

  const loadAllProgress = useCallback(async (s: ProgressStore) => {
    const today = todayStr();
    const [prefs, xp, stats, lessonStates, decisions, activity, ach, exams, assessments, lastPosition, reviewSessions] = await Promise.all([
      s.getPreferences(), s.getXp(), s.allStats(), s.allLessonStates(), s.allDecisions(), s.allActivity(), s.allAchievements(), s.allExams(), s.allAssessments(),
      s.getLastPosition(), s.getMeta<number>('reviewSessions', 0),
    ]);
    const qualifying = activity.filter((a) => a.answered >= 5 || a.xp > 0).map((a) => a.date);
    const todayAct = activity.find((a) => a.date === today);
    setState((p) => ({
      ...p, prefs, xp, stats, lessonStates, decisions, activityDays: qualifying, activityToday: todayAct ?? { answered: 0, firstTry: 0, xp: 0 },
      achievements: ach.map((a) => a.id), exams, assessments, lastPosition, reviewSessions,
    }));
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await ProgressStore.open(dbName);
        storeRef.current = s;
        if (!alive) return;
        setStore(s);
        const manifest = await loadManifest().catch(() => null);
        manifestRef.current = manifest;
        await loadAllProgress(s);
        try { await navigator.storage?.persist?.(); } catch { /* optional */ }
        if (manifest) await maybeAutoSnapshot(s, manifest.contentVersion, todayStr()).catch(() => false);
        if (alive) setState((p) => ({ ...p, ready: true, manifest, error: manifest ? null : 'לא נמצא תוכן לימוד (content/manifest.json). יש להריץ npm run content:build.' }));
      } catch (e) {
        if (alive) setState((p) => ({ ...p, ready: true, error: `שגיאה בפתיחת האחסון המקומי: ${(e as Error).message}` }));
      }
    })();
    return () => { alive = false; };
  }, [dbName, loadAllProgress]);

  useEffect(() => {
    const root = document.documentElement;
    if (state.prefs.theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', state.prefs.theme);
    root.style.setProperty('--font-scale', String(state.prefs.fontScale));
  }, [state.prefs.theme, state.prefs.fontScale]);

  const ensureChapters = useCallback(async (ids?: string[]) => {
    const want = ids ?? manifestRef.current?.chapters.map((c) => c.id) ?? [];
    const out: Record<string, ContentBundle> = {};
    await Promise.all(want.map(async (id) => {
      bundlePromises.current[id] ??= loadChapter(id);
      out[id] = await bundlePromises.current[id];
    }));
    setState((p) => (Object.keys(out).some((id) => !p.bundles[id]) ? { ...p, bundles: { ...p.bundles, ...out } } : p));
    return out;
  }, []);

  const orderedLessonIds = useMemo(() => {
    if (!state.manifest) return [];
    const ok = (id: string, status: string) => {
      const d = state.decisions[id]?.decision;
      return d !== 'rejected' && (status === 'verified' || d === 'approved' || d === 'corrected');
    };
    // a lesson joins the guided path only when it is verified AND can actually be assessed (every objective has a verified mastery question)
    return [...state.manifest.chapters].sort((a, b) => a.order - b.order).flatMap((c) => c.lessons.filter((l) => ok(l.id, l.status) && (l.assessable !== false || state.decisions[l.id]?.decision === 'approved')).map((l) => l.id));
  }, [state.manifest, state.decisions]);

  const statuses = useMemo(() => guidedStatuses(orderedLessonIds, state.lessonStates), [orderedLessonIds, state.lessonStates]);
  const bank = useMemo(() => buildBank(Object.values(state.bundles), state.decisions), [state.bundles, state.decisions]);

  const lessonTitle = useCallback((id: string) => {
    for (const c of state.manifest?.chapters ?? []) { const l = c.lessons.find((x) => x.id === id); if (l) return l.title; }
    return id;
  }, [state.manifest]);

  const verifiedLessons = useCallback((chapterId: string) => {
    const b = state.bundles[chapterId];
    if (!b) return [];
    return b.lessons.filter((l) => {
      const d = state.decisions[l.id]?.decision;
      return d !== 'rejected' && (l.verification.status === 'verified' || d === 'approved' || d === 'corrected');
    });
  }, [state.bundles, state.decisions]);

  const streak = useMemo(() => streakFromDays(state.activityDays, todayStr()), [state.activityDays]);
  const rank = useMemo(() => rankFor(state.xp), [state.xp]);

  const evaluateAchievements = useCallback(async (s: ProgressStore): Promise<string[]> => {
    const [ls, exams, assess, activity, ach, stats, reviewSessions] = await Promise.all([
      s.allLessonStates(), s.allExams(), s.allAssessments(), s.allActivity(), s.allAchievements(), s.allStats(), s.getMeta<number>('reviewSessions', 0),
    ]);
    const days = activity.filter((a) => a.answered >= 5 || a.xp > 0).map((a) => a.date);
    const st = streakFromDays(days, todayStr());
    const mastered = Object.values(ls).filter((l) => l.masteredAt);
    const lessonsByChapter = (manifestRef.current?.chapters ?? []).map((c) => c.lessons.map((l) => l.id));
    const ctx: AchievementContext = {
      masteredLessons: mastered.length,
      totalLessons: lessonsByChapter.reduce((a, b) => a + b.length, 0),
      masteredChapters: lessonsByChapter.filter((ids) => ids.length > 0 && ids.every((id) => ls[id]?.masteredAt)).length,
      streak: st.current, longestStreak: st.longest, firstTryTotal: Object.values(stats).reduce((a, x) => a + x.firstTry, 0),
      examsTaken: exams.length, bestExamPercent: exams.reduce((m, e) => Math.max(m, e.percent), 0),
      perfectAssessments: assess.filter((a) => a.mastered).length, reviewSessions, xp: await s.getXp(),
    };
    const fresh = newlyUnlocked(ctx, new Set(ach.map((a) => a.id)));
    for (const a of fresh) await s.unlockAchievement(a.id);
    return fresh.map((a) => a.id);
  }, []);

  const refresh = useCallback(async () => { if (storeRef.current) await loadAllProgress(storeRef.current); }, [loadAllProgress]);

  const recordAnswer = useCallback(async (q: Question, outcome: Outcome, mode: XpMode) => {
    const s = storeRef.current!;
    const now = new Date();
    await s.putStat(applyOutcome(await s.getStat(q.id), q.id, outcome, now));
    const recent = Date.now() - (await s.lastXpAward(q.id)) < 20 * 3600 * 1000;
    const xp = xpForAnswer(outcome, q.difficulty, mode, recent);
    if (xp > 0) { await s.addXp(xp); await s.markXpAward(q.id); }
    await s.bumpActivity(todayStr(now), { answered: 1, firstTry: outcome === 'first_try' ? 1 : 0, xp });
    const unlocked = await evaluateAchievements(s);
    await loadAllProgress(s);
    return { xp, unlocked };
  }, [evaluateAchievements, loadAllProgress]);

  const saveLessonProgress = useCallback(async (lessonId: string, stepIndex: number, stepsDone: number[]) => {
    const s = storeRef.current!;
    const prev = await s.getLessonState(lessonId);
    const base: LessonState = prev ?? { lessonId, stepIndex: 0, stepsDone: [], masteredAt: null, masteredOnVersion: null, attempts: 0, bestScore: 0, lastQuestionIds: [], startedAt: Date.now(), lastOpened: null };
    await s.putLessonState({ ...base, stepIndex, stepsDone: [...new Set([...base.stepsDone, ...stepsDone])], lastOpened: Date.now(), startedAt: base.startedAt ?? Date.now() });
    await s.setLastPosition({ lessonId, stepIndex });
    await loadAllProgress(s);
  }, [loadAllProgress]);

  const completeAssessment: AppApi['completeAssessment'] = useCallback(async (lesson, questionIds, results, questions) => {
    const s = storeRef.current!;
    const now = new Date();
    const total = results.length;
    const correct = results.filter((r) => r.correct).length;
    const mastered = total > 0 && correct === total; // 100% rule: a single mistake means NOT mastered
    const prev = await s.getLessonState(lesson.id);
    const attempt = (prev?.attempts ?? 0) + 1;
    const cv = manifestRef.current?.contentVersion ?? '';
    const base: LessonState = prev ?? { lessonId: lesson.id, stepIndex: 0, stepsDone: [], masteredAt: null, masteredOnVersion: null, attempts: 0, bestScore: 0, lastQuestionIds: [], startedAt: Date.now(), lastOpened: null };
    const firstMastery = mastered && !base.masteredAt;
    await s.addAssessment({ lessonId: lesson.id, ts: now.getTime(), attempt, total, correct, mastered, questionIds, results, contentVersion: cv });
    await s.putLessonState({
      ...base, attempts: attempt, bestScore: Math.max(base.bestScore, total ? correct / total : 0), lastQuestionIds: questionIds,
      masteredAt: base.masteredAt ?? (mastered ? now.getTime() : null), masteredOnVersion: base.masteredOnVersion ?? (mastered ? cv : null), lastOpened: now.getTime(),
    });
    // every assessed question feeds the retention scheduler (wrong answers return in the daily review)
    let xpGained = 0;
    for (const r of results) {
      const q = questions.find((x) => x.id === r.questionId);
      if (!q) continue;
      const outcome: Outcome = r.correct ? 'first_try' : 'wrong';
      await s.putStat(applyOutcome(await s.getStat(q.id), q.id, outcome, now));
      const recent = Date.now() - (await s.lastXpAward(q.id)) < 20 * 3600 * 1000;
      const xp = xpForAnswer(outcome, q.difficulty, 'lesson_check', recent);
      if (xp > 0) { xpGained += xp; await s.markXpAward(q.id); }
    }
    if (firstMastery) xpGained += XP_LESSON_MASTERY;
    if (xpGained) await s.addXp(xpGained);
    await s.bumpActivity(todayStr(now), { answered: total, firstTry: correct, xp: xpGained });
    const unlocked = await evaluateAchievements(s);
    await loadAllProgress(s);
    return { mastered, firstMastery, xpGained, unlocked };
  }, [evaluateAchievements, loadAllProgress]);

  const recordExam = useCallback(async (e: Omit<ExamRecord, 'id'>) => {
    const s = storeRef.current!;
    await s.addExam(e as ExamRecord);
    const bonus = e.percent >= 50 ? Math.round(e.percent * 0.5) : 0;
    if (bonus) await s.addXp(bonus);
    await s.bumpActivity(todayStr(), { answered: 0, xp: bonus });
    await s.setRecord('examBestPercent', e.percent);
    const unlocked = await evaluateAchievements(s);
    await loadAllProgress(s);
    return { unlocked, xpGained: bonus };
  }, [evaluateAchievements, loadAllProgress]);

  const noteReviewSession = useCallback(async () => {
    const s = storeRef.current!;
    await s.setMeta('reviewSessions', (await s.getMeta<number>('reviewSessions', 0)) + 1);
    const unlocked = await evaluateAchievements(s);
    await loadAllProgress(s);
    return { unlocked };
  }, [evaluateAchievements, loadAllProgress]);

  const setPrefs = useCallback(async (p: Preferences) => { await storeRef.current!.setPreferences(p); await loadAllProgress(storeRef.current!); }, [loadAllProgress]);
  const setDecision = useCallback(async (d: ReviewDecision) => { await storeRef.current!.putDecision(d); await loadAllProgress(storeRef.current!); }, [loadAllProgress]);

  const api: AppApi = {
    ...state, store, orderedLessonIds, statuses, lessonTitle, streak, rank, ensureChapters, bank, verifiedLessons,
    recordAnswer, completeAssessment, saveLessonProgress, recordExam, noteReviewSession, setPrefs, setDecision, refresh,
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export { ACHIEVEMENTS };
