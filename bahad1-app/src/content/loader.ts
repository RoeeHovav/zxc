import type { Chapter, ContentBundle, ContentManifest } from '../domain/types';

export interface ManifestChapter extends Chapter {
  lessons: { id: string; title: string; pages: [number, number]; status: string; assessable?: boolean }[];
  counts: { facts: number; lessons: number; questions: number; verifiedQuestions: number };
}
export interface Manifest extends Omit<ContentManifest, 'chapters'> { chapters: ManifestChapter[]; preview?: boolean }
export interface SourceUnit { id: string; page: number; kind: string; text: string; figure?: string; cells?: string[] }
export interface ReviewData {
  generatedAt: string;
  chapters: Record<string, {
    title: string; pages: [number, number];
    facts: Record<string, number>; lessons: Record<string, number>; questions: Record<string, number>;
    coverage: null | { requiredUnits: number; unitsWithoutFact: string[]; unitsWithoutLesson: string[]; unitsWithoutQuestion: string[]; factsWithoutQuestion: string[]; excludedFootnotes: number; supplementaryBoxes: number };
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
function getJson<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    cache.set(path, fetch(`content/${path}`, { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    }));
  }
  return cache.get(path) as Promise<T>;
}

export const loadManifest = () => getJson<Manifest>('manifest.json');
export const loadChapter = (id: string) => getJson<ContentBundle>(`${id}.json`);
export const loadSources = (id: string) => getJson<SourceUnit[]>(`sources/${id}.json`);
export const loadReview = () => getJson<ReviewData>('review.json');
export const figureUrl = (id: string) => `content/figs/${id}.png`;
export const pageUrl = (page: number) => `content/pages/p${String(page).padStart(3, '0')}.jpg`;
export function clearContentCache() { cache.clear(); }
