export type WordTuple = [string, number, number, number, number, number, number];

export interface PageLayout {
  n: number;
  w: number;
  h: number;
  rtl: boolean;
  source: string;
  ocr?: { engine: string; languages: string; dpi: number } | null;
  words: WordTuple[];
  lines: [number, number, number][];
  blocks: { l: [number, number]; kind: string; level: number; size: number; rtl: boolean; bbox: [number, number, number, number]; cont: boolean }[];
  images: [number, number, number, number, string][];
  warnings: string[];
  word_unit: number[];
  word_pos: number[];
  word_sent: number[];
  units: string[];
  unit_kinds: string[];
}

export interface Chunk {
  i: number;
  lang: string;
  words: [number, number];
  chars: number;
}

export interface Unit {
  id: string;
  kind: string;
  level: number;
  page: number;
  pages: number[];
  words: [number, number][];
  text: string;
  rtl: boolean;
  lang: string;
  sentences: [number, number, string][];
  chunks: Chunk[];
  pause_before: number;
  pause_after: number;
}

export interface Speech {
  audio: string;
  key: string;
  duration: number;
  words: [number, number, number][];
  timing: "word" | "estimated";
  voice: string;
  lang: string;
  text: string;
  notice?: string;
  assistant?: { state: string; changed: string[][]; detail?: string };
}

export interface PrepStatus {
  state: "none" | "running" | "done" | "error" | "cancelled";
  percent: number;
  page: number;
  from_page: number;
  pages: number;
  chunks_done: number;
  error: string | null;
  skipped: string | null;
  seconds: number;
  patient: boolean;
  waiting_seconds: number;
}

export interface Provider {
  id: string;
  name: string;
  free: boolean;
  cloud: boolean;
  requires_key: boolean;
  word_timing: boolean;
  privacy: string;
  verified: string;
  available: boolean;
  reason: string;
}

export interface Voice {
  id: string;
  provider: string;
  name: string;
  locale: string;
  gender: string;
  lang: string;
  description: string;
}

export interface Settings {
  voices: Record<string, string>;
  provider: string;
  speed: number;
  pause_scale: number;
  skip_seconds: number;
  read_kinds: Record<string, boolean>;
  auto_scroll: boolean;
  highlight: "word" | "sentence";
  switch_voice_for_foreign: boolean;
  max_chunk_chars: number;
  skip_citations: boolean;
  skip_footnote_marks: boolean;
  verbalize_math: boolean;
  theme: "system" | "light" | "dark";
  ui_lang: "auto" | "en" | "he";
  zoom: number;
  cloud_consent: Record<string, number>;
  azure_region: string;
  prefetch_chunks: number;
  buffer_percent: number;
  ai_pronunciation: boolean;
  pronunciation_model: string;
  free_fallback: boolean;
  sleep_minutes: number;
  teacher_mode: boolean;
  llm_base_url: string;
  llm_model: string;
}

export interface AppState {
  version: string;
  settings: Settings;
  providers: Provider[];
  secrets: Record<string, boolean>;
  ocr: { available: boolean; tessdata: string | null; languages: string[] };
  test_mode: boolean;
  data_dir: string;
}

export interface DocInfo {
  id: string;
  title: string;
  filename: string;
  pages: number;
  size: number;
  added_at: number;
  opened_at: number | null;
  progress?: number | null;
  last_page?: number | null;
  position?: Position | null;
  page_sizes?: [number, number][];
  rtl?: boolean;
  doc_settings?: Record<string, any>;
}

export interface Position {
  unit_id: string | null;
  word: number;
  page: number;
  chunk: number;
  offset: number;
  progress: number;
  updated_at?: number;
}

export interface Bookmark {
  id: number;
  doc_id: string;
  page: number;
  unit_id: string | null;
  word: number;
  label: string;
  note: string;
  created_at: number;
}

export interface OutlineEntry {
  level: number;
  title: string;
  page: number;
  unit_id?: string;
  y?: number | null;
  source?: string;
}

export interface LexiconEntry {
  id: number;
  scope: "global" | "document";
  doc_id: string | null;
  lang: string;
  written: string;
  spoken: string;
  context: string;
  note: string;
  enabled: number;
}

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    super(body?.message || body?.detail || body?.error || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function req<T>(method: string, url: string, body?: any, signal?: AbortSignal): Promise<T> {
  const init: RequestInit = { method, signal, headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as any)["Content-Type"] = "application/json";
  }
  const r = await fetch(url, init);
  const text = await r.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }
  if (!r.ok) throw new ApiError(r.status, data);
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  state: () => req<AppState>("GET", "/api/state"),
  putSettings: (patch: Partial<Settings>) => req<Settings>("PUT", "/api/settings", patch),
  putSecret: (key: string, value: string) => req<any>("POST", "/api/secrets", { key, value }),
  consent: (provider: string) => req<any>("POST", "/api/consent", { provider }),
  voices: (provider?: string) => req<{ voices: Voice[] }>("GET", `/api/voices${provider ? `?provider=${enc(provider)}` : ""}`),
  documents: () => req<{ documents: DocInfo[] }>("GET", "/api/documents"),
  upload: (files: File[], combine: boolean, onProgress?: (f: number) => void) =>
    new Promise<{ documents: DocInfo[] }>((resolve, reject) => {
      const fd = new FormData();
      for (const f of files) fd.append("files", f, f.name);
      fd.append("combine", combine ? "true" : "false");
      const x = new XMLHttpRequest();
      x.open("POST", "/api/documents");
      x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      x.onload = () => {
        let data: any = null;
        try {
          data = JSON.parse(x.responseText);
        } catch {
          data = { message: x.responseText };
        }
        if (x.status >= 200 && x.status < 300) resolve(data);
        else reject(new ApiError(x.status, data));
      };
      x.onerror = () => reject(new ApiError(0, { message: "Upload failed (connection error)" }));
      x.send(fd);
    }),
  document: (id: string) => req<DocInfo>("GET", `/api/documents/${id}`),
  patchDocument: (id: string, body: any) => req<DocInfo>("PATCH", `/api/documents/${id}`, body),
  deleteDocument: (id: string) => req<any>("DELETE", `/api/documents/${id}`),
  progress: (id: string) => req<{ processed: number; pages: number; processing: boolean; error: string | null; ocr: any }>("GET", `/api/documents/${id}/progress`),
  layout: (id: string, n: number, signal?: AbortSignal) => req<PageLayout>("GET", `/api/documents/${id}/pages/${n}/layout`, undefined, signal),
  pageImageUrl: (id: string, n: number, scale: number) => `/api/documents/${id}/pages/${n}/image?scale=${scale.toFixed(2)}`,
  outline: (id: string) => req<{ pdf: OutlineEntry[]; detected: OutlineEntry[]; complete: boolean }>("GET", `/api/documents/${id}/outline`),
  search: (id: string, q: string) => req<{ results: { page: number; w0: number; w1: number; snippet: string }[]; indexed: number; pages: number }>("GET", `/api/documents/${id}/search?q=${enc(q)}`),
  units: (id: string, page: number, count = 20) => req<{ units: Unit[] }>("GET", `/api/documents/${id}/units?page=${page}&count=${count}`),
  unit: (id: string, unitId: string) => req<Unit>("GET", `/api/documents/${id}/units/${enc(unitId)}`),
  neighbour: (id: string, unitId: string, direction: 1 | -1) => req<{ unit: Unit | null }>("GET", `/api/documents/${id}/units/${enc(unitId)}/next?direction=${direction}`),
  unitAt: (id: string, page: number, word: number) => req<{ unit: Unit; word: number }>("GET", `/api/documents/${id}/unit_at?page=${page}&word=${word}`),
  prepare: (id: string, unitId: string, patient = false) => req<PrepStatus>("POST", `/api/documents/${id}/prepare`, { unit_id: unitId, patient }),
  prepareStatus: (id: string) => req<PrepStatus>("GET", `/api/documents/${id}/prepare`),
  prepareCancel: (id: string) => req<PrepStatus>("DELETE", `/api/documents/${id}/prepare`),
  speech: (id: string, unitId: string, chunk: number, signal?: AbortSignal) => req<Speech>("POST", `/api/documents/${id}/speech`, { unit_id: unitId, chunk }, signal),
  preview: (text: string, voice: string, lang: string, vowels = false) => req<Speech>("POST", "/api/preview", { text, voice, lang, vowels }),
  position: (id: string) => req<{ position: Position | null }>("GET", `/api/documents/${id}/position`),
  savePosition: (id: string, p: Partial<Position> & { event?: string }) => req<any>("PUT", `/api/documents/${id}/position`, p),
  bookmarks: (id: string) => req<{ bookmarks: Bookmark[] }>("GET", `/api/documents/${id}/bookmarks`),
  addBookmark: (id: string, b: Partial<Bookmark>) => req<{ id: number; bookmarks: Bookmark[] }>("POST", `/api/documents/${id}/bookmarks`, b),
  updateBookmark: (id: string, bid: number, b: Partial<Bookmark>) => req<{ bookmarks: Bookmark[] }>("PUT", `/api/documents/${id}/bookmarks/${bid}`, b),
  deleteBookmark: (id: string, bid: number) => req<{ bookmarks: Bookmark[] }>("DELETE", `/api/documents/${id}/bookmarks/${bid}`),
  history: () => req<{ history: any[] }>("GET", "/api/history"),
  lexicon: (docId?: string) => req<{ entries: LexiconEntry[]; builtin: any[] }>("GET", `/api/lexicon${docId ? `?doc_id=${docId}` : ""}`),
  addLexicon: (e: Partial<LexiconEntry>) => req<{ id: number }>("POST", "/api/lexicon", e),
  putLexicon: (id: number, e: Partial<LexiconEntry>) => req<any>("PUT", `/api/lexicon/${id}`, e),
  deleteLexicon: (id: number) => req<any>("DELETE", `/api/lexicon/${id}`),
  occurrence: (docId: string, page: number, word: number, spoken: string | null) => req<any>("POST", `/api/documents/${docId}/occurrence`, { page, word, spoken }),
  addRating: (r: any) => req<any>("POST", "/api/ratings", r),
  ratings: () => req<{ ratings: any[] }>("GET", "/api/ratings"),
  cacheInfo: () => req<{ bytes: number; limit: number }>("GET", "/api/cache"),
  clearCache: () => req<any>("DELETE", "/api/cache"),
  ocrRefresh: () => req<any>("POST", "/api/ocr/refresh"),
  explain: (id: string, unitId: string, scope: "paragraph" | "section") =>
    req<{ text: string; lang: string; model: string; heading: string; unit_id: string; scope: string }>("POST", `/api/documents/${id}/explain`, { unit_id: unitId, scope }),
  llmStatus: () => req<{ ok: boolean; models?: string[]; error?: string; local: boolean }>("GET", "/api/llm/status"),
};
