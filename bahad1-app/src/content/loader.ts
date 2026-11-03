import type { Chapter, ContentBundle, ContentManifest } from '../domain/types';

export interface ChapterProgress { requiredUnits: number; coveredUnits: number; coveredThroughPage: number | null; complete: boolean }
export interface UpcomingChapter { id: string; title: string; firstPage: number; lastPage: number }
export interface ManifestChapter extends Chapter {
  /** how much of the chapter's book pages the authored content reaches (absent in older bundles) */
  progress?: ChapterProgress;
  lessons: { id: string; title: string; pages: [number, number]; status: string; assessable?: boolean }[];
  counts: { facts: number; lessons: number; questions: number; verifiedQuestions: number };
}
export interface Manifest extends Omit<ContentManifest, 'chapters'> { chapters: ManifestChapter[]; /** chapters shown as "עובדים על זה" – locked, no content bundle */ upcoming?: UpcomingChapter[]; preview?: boolean }
export interface SourceUnit { id: string; page: number; kind: string; text: string; figure?: string; cells?: string[]; h?: number; table?: string; row?: number; bold?: string[]; tr?: string }
export interface ReviewData {
  generatedAt: string;
  chapters: Record<string, {
    title: string; pages: [number, number];
    facts: Record<string, number>; lessons: Record<string, number>; questions: Record<string, number>;
    coverage: null | { requiredUnits: number; unitsWithoutFact: string[]; unitsWithoutLesson: string[]; unitsWithoutQuestion: string[]; factsWithoutQuestion: string[]; excludedFootnotes: number; supplementaryBoxes: number; unitsWithoutVerifiedFact?: string[] };
    validation: null | { errors: number; warnings: string[] };
  }>;
  flagged: { kind: 'question' | 'lesson' | 'fact'; chapter: string; id: string; status: string; item: any }[];
  visual: { id: string; page: number; figure?: string; text: string; status: string; readings?: { by: string; text: string }[] }[];
  extraction: {
    pagesProcessed: number; totalPages: number; unitsByScope: Record<string, number>; visualReviewPages: number[];
    allChapters: { id: string; title: string; firstPage: number; lastPage: number; built: boolean }[];
  };
}

const cache = new Map<string, Promise<unknown>>();
/**
 * Two ways to read the content files:
 *  - served over http(s) (dev server, vite preview, the optional local server): fetch() of the .json files;
 *  - opened straight from disk (file://, the "double-click index.html" release): browsers block fetch() of local files, so the release
 *    contains each file as <path>.js that registers its data in window.__BAHAD__ (loaded with an ordinary <script> element). That build
 *    also carries <meta name="bahad-content" content="script">, so it works the same when the optional local server serves it.
 */
const fromDisk = typeof location !== 'undefined' && (location.protocol === 'file:' || (typeof document !== 'undefined' && !!document.querySelector('meta[name="bahad-content"][content="script"]')));
function loadScriptData<T>(path: string): Promise<T> {
  const registry = ((window as unknown as { __BAHAD__?: Record<string, unknown> }).__BAHAD__ ??= {});
  if (path in registry) return Promise.resolve(registry[path] as T);
  return new Promise<T>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = `content/${path}.js`;
    el.onload = () => { el.remove(); path in registry ? resolve(registry[path] as T) : reject(new Error(`${path}: missing data`)); };
    el.onerror = () => { el.remove(); reject(new Error(`${path}: not found`)); };
    document.head.appendChild(el);
  });
}
function getJson<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    cache.set(path, fromDisk ? loadScriptData<T>(path) : fetch(`content/${path}`, { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    }));
    // a failed load must not be cached forever (e.g. a temporary network/disk error)
    (cache.get(path) as Promise<unknown>).catch(() => cache.delete(path));
  }
  return cache.get(path) as Promise<T>;
}

export const loadManifest = () => getJson<Manifest>('manifest.json');
export const loadChapter = (id: string) => getJson<ContentBundle>(`${id}.json`);
export const loadSources = (id: string) => getJson<SourceUnit[]>(`sources/${id}.json`);
export const loadReview = () => getJson<ReviewData>('review.json');
export interface CoverageRow { u: string; p: number; k: string; s: string; t: string; f: string[]; l: string[]; q: number; qv: number; fv: number }
export const loadCoverage = (id: string) => getJson<CoverageRow[]>(`coverage/${id}.json`);
export const figureUrl = (id: string) => `content/figs/${id}.png`;
export const pageUrl = (page: number) => `content/pages/p${String(page).padStart(3, '0')}.jpg`;
export function clearContentCache() { cache.clear(); }
