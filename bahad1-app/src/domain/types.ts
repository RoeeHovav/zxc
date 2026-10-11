/* Core data contracts. Content (facts/lessons/questions) is produced during development from the official
   book only; at runtime everything here is plain data + deterministic code (no AI). */

export type Scope = 'core' | 'supplementary' | 'excluded_footnote' | 'meta';
export type VerificationStatus = 'pending' | 'verified' | 'flagged' | 'rejected';

/** A precise pointer into the unified 314-page source index. `quote` is a verbatim excerpt of unit `unit`. */
export interface SourceRef {
  unit: string; // e.g. "p023.u03"
  page: number; // global page 1..314 (equals printed page for this edition)
  quote: string; // verbatim substring of the source unit (validated at build time)
  figure?: string; // e.g. "p015-f1" when the support is an original figure
  transcribed?: boolean; // true when the text was read from an image (needs the figure to be shown next to it)
}

export interface Verification {
  status: VerificationStatus;
  generatedBy: string;
  /** automatic, inspectable checks performed by scripts/validate-content.mjs */
  programmatic: { quotesFound: boolean; answerKeyValid: boolean; noExcludedSource: boolean };
  /** independent second pass against the source (separate agent from the generator) */
  independent?: { verdict: 'pass' | 'fail' | 'uncertain'; notes?: string; by: string };
  note?: string;
}

export type FactKind =
  | 'definition' | 'date' | 'name' | 'list' | 'sequence' | 'relation' | 'number' | 'quote' | 'procedure' | 'classification' | 'other';

export interface Fact {
  id: string; // ch1.f012
  chapter: string; // ch1
  topic: string; // nearest section heading (Hebrew)
  kind: FactKind;
  statement: string; // short self-contained Hebrew statement, meaning identical to the book
  refs: SourceRef[];
  emphasis?: boolean; // the supporting source text is bold/underlined in the book
  origin?: 'text' | 'table' | 'figure' | 'caption' | 'box';
  verification: Verification;
}

/* ---------- lessons ------------------------------------------------------------------------------------------ */

export interface ExplainBlock {
  kind: 'p' | 'bullets' | 'key' | 'table' | 'note';
  text?: string; // p / key / note
  items?: string[]; // bullets
  table?: { headers: string[]; rows: string[][] };
  factIds?: string[];
}

export type LessonStep =
  | { type: 'explain'; title?: string; blocks: ExplainBlock[]; factIds: string[]; figures?: string[] }
  | { type: 'check'; questionId: string }
  | { type: 'figure'; figureId: string; caption?: string };

export interface Lesson {
  id: string; // ch1.l03
  chapter: string;
  order: number; // order inside the chapter (guided path)
  title: string;
  pages: [number, number];
  objectives: string[]; // factIds the mastery assessment must cover
  steps: LessonStep[];
  /** how many questions a mastery attempt contains (<= pool size) */
  assessmentSize: number;
  summary?: string;
  verification: Verification; // lesson explanations are verified like every other educational item
}

export interface Chapter {
  id: string;
  title: string;
  firstPage: number;
  lastPage: number;
  order: number;
  lessonIds: string[];
}

/* ---------- questions ------------------------------------------------------------------------------------------ */

export type QuestionType = 'mcq' | 'multi' | 'tf' | 'short' | 'blank' | 'match' | 'order' | 'compare';
export type Difficulty = 1 | 2 | 3;
export interface Option { id: string; text: string }

export interface QuestionBase {
  id: string; // ch1.q0123
  lessonId: string;
  chapter: string;
  topic: string;
  factIds: string[]; // facts this question tests (>=1)
  difficulty: Difficulty;
  pool: 'practice' | 'mastery' | 'both';
  stem: string;
  hints: string[]; // progressive, each derived only from the source (>=1 unless type is tf)
  explanation: string; // short, faithful
  refs: SourceRef[];
  verification: Verification;
  figure?: string; // original figure to show with the stem
}

export interface McqQuestion extends QuestionBase { type: 'mcq' | 'compare'; options: Option[]; correct: string }
export interface MultiQuestion extends QuestionBase { type: 'multi'; options: Option[]; correct: string[] }
export interface TfQuestion extends QuestionBase { type: 'tf'; correct: boolean }
export interface ShortQuestion extends QuestionBase {
  type: 'short' | 'blank';
  /** every accepted answer (already normalised by the same normaliser that grades); first one is shown to the user */
  accepted: string[];
  answerDisplay: string;
  placeholder?: string;
}
export interface MatchQuestion extends QuestionBase {
  type: 'match';
  left: Option[]; // prompts (shown in fixed order)
  right: Option[]; // answers (shuffled when shown)
  correct: Record<string, string>; // leftId -> rightId
}
export interface OrderQuestion extends QuestionBase { type: 'order'; items: Option[]; correct: string[] }

export type Question = McqQuestion | MultiQuestion | TfQuestion | ShortQuestion | MatchQuestion | OrderQuestion;

export type Answer =
  | { type: 'mcq' | 'compare'; value: string | null }
  | { type: 'multi'; value: string[] }
  | { type: 'tf'; value: boolean | null }
  | { type: 'short' | 'blank'; value: string }
  | { type: 'match'; value: Record<string, string> }
  | { type: 'order'; value: string[] };

/** Outcomes are NOT equivalent (spec §5.2). */
export type Outcome = 'first_try' | 'retry' | 'hinted' | 'wrong' | 'revealed';

export interface ContentBundle {
  chapter: Chapter;
  facts: Fact[];
  lessons: Lesson[];
  questions: Question[];
}

export interface ContentManifest {
  contentVersion: string;
  generatedAt: string;
  book: string;
  totalPages: number;
  chapters: Chapter[];
  stats: Record<string, number>;
  sourceFiles?: Record<string, string>; // chapter -> units file
}

/* ---------- progress ------------------------------------------------------------------------------------------- */

export interface QuestionStat {
  questionId: string;
  seen: number;
  firstTry: number;
  retry: number;
  hinted: number;
  wrong: number;
  revealed: number;
  lastSeen: number; // epoch ms
  lastOutcome: Outcome | null;
  box: number; // Leitner box 0..6
  due: string; // YYYY-MM-DD local date
  lastIndependentCorrect: number | null; // epoch ms
}

export interface LessonState {
  lessonId: string;
  stepIndex: number;
  stepsDone: number[];
  masteredAt: number | null;
  masteredOnVersion: string | null;
  attempts: number;
  bestScore: number; // fraction 0..1
  lastQuestionIds: string[];
  startedAt: number | null;
  lastOpened: number | null;
}

export interface AssessmentRecord {
  id?: number;
  lessonId: string;
  ts: number;
  attempt: number;
  total: number;
  correct: number;
  mastered: boolean;
  questionIds: string[];
  results: { questionId: string; correct: boolean }[];
  contentVersion: string;
}

export interface ExamRecord {
  id?: number;
  ts: number;
  config: ExamConfig;
  total: number;
  correct: number;
  percent: number;
  durationMs: number;
  results: { questionId: string; correct: boolean; topic: string; chapter: string }[];
  contentVersion: string;
}

export interface ExamConfig {
  chapters: string[];
  count: number;
  timeLimitMin: number | null;
  types: QuestionType[] | null;
  difficulties: Difficulty[] | null;
}

export interface GradeFlag { id?: number; questionId: string; ts: number; note: string; givenAnswer: string }
export interface ReviewDecision {
  itemId: string; // question / lesson / fact id
  itemKind: 'question' | 'lesson' | 'fact';
  decision: 'approved' | 'rejected' | 'corrected';
  note: string;
  ts: number;
  override?: Partial<Question>;
}

export interface Preferences {
  theme: 'system' | 'light' | 'dark';
  dailyReviewSize: number;
  fontScale: number;
}
export const DEFAULT_PREFERENCES: Preferences = { theme: 'system', dailyReviewSize: 20, fontScale: 1 };
