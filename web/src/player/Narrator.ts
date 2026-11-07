import { api, ApiError, PrepStatus, QuizPlan, Speech, Unit } from "../api";

export type Status = "idle" | "loading" | "playing" | "paused" | "error";

export interface NarrPos {
  unit: Unit;
  chunk: number;
  word: number; // index into unit.words
  page: number;
  pageWord: number;
  sentence: number;
  timing: "word" | "estimated";
  time: number;
  duration: number;
}

interface Current {
  unit: Unit;
  chunk: number;
  speech: Speech;
  starts: number[];
}

export interface StopAt {
  page: number;
  word: number; // page word index (inclusive end)
}

type Start = { word?: number; time?: number; fromEnd?: number };

/** Document order of two unit ids ("page.block"). */
export function cmpUnit(a: string, b: string) {
  const [pa, ba] = a.split(".").map(Number);
  const [pb, bb] = b.split(".").map(Number);
  return pa !== pb ? pa - pb : ba - bb;
}

export function cmpRef(a: [number, number], b: [number, number]) {
  return a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1];
}

/** Playback engine: sequences synthesized chunks, keeps exact position, and
 * reports the spoken word for highlighting.  Framework-independent. */
export class Narrator extends EventTarget {
  docId: string;
  pages: number;
  status: Status = "idle";
  error: string | null = null;
  rate = 1;
  pauseScale = 1;
  readKinds: Record<string, boolean> = {};
  pos: NarrPos | null = null;
  stopAt: StopAt | null = null;
  consentHandler?: (info: any) => Promise<boolean>;
  /** Called with a plain-language message, e.g. when a limited voice ran out and the free voice took over. */
  noticeHandler?: (msg: string) => void;
  /** Before the first play, wait until this share (0-100) of the remaining document is narrated. */
  bufferPercent = 0;
  /** ...but never longer than this many minutes of narration (0 = no cap). */
  bufferMinutes = 0;
  prep: PrepStatus | null = null;
  private skipWait = false;
  private prepPoll: number | undefined;
  private lastNotice = "";
  /** Teacher Mode: called at the end of each section; narration continues when it resolves. */
  teacherMode = false;
  teacherHandler?: (unit: Unit) => Promise<void>;

  /** Comprehension checkpoints: the stretch being listened to is planned by the server; when its last unit has been
   * heard, narration waits while `checkpointHandler` (the questions) runs. */
  quizOn = false;
  quizPrefetch?: (unitIds: string[]) => void;
  checkpointHandler?: (heard: string[], plan: QuizPlan, resumeAt: string | null) => Promise<void>;
  private qPlan: QuizPlan | null = null;
  private qPlanning: string | null = null;
  private qHeard = new Set<string>();
  private qHeardChars = 0;
  private qPrefetched = false;
  private qDoneUpTo: string | null = null;
  private qTok = 0;

  private audio: HTMLAudioElement;
  private cur: Current | null = null;
  private units = new Map<string, Unit>();
  private links = new Map<string, string | null>();
  private speechCache = new Map<string, Promise<Speech>>();
  private token = 0;
  private raf = 0;
  private gapTimer: number | undefined;
  private pendingNext: { unit: Unit; chunk: number } | null = null;
  private lastSave = 0;
  private origin: { unitId: string; word: number; stopAt: StopAt | null } | null = null;
  private preload: HTMLAudioElement | null = null;
  private sleepTimer: number | undefined;
  sleepUntil: number | null = null;

  constructor(docId: string, pages: number) {
    super();
    this.docId = docId;
    this.pages = pages;
    this.audio = new Audio();
    this.audio.preload = "auto";
    (this.audio as any).preservesPitch = true;
    (this.audio as any).webkitPreservesPitch = true;
    this.audio.addEventListener("ended", () => this.onEnded());
    this.audio.addEventListener("error", () => {
      if (this.cur && this.status !== "idle") this.fail("The audio could not be played. Press play to retry.");
    });
    this.setupMediaSession();
  }

  destroy() {
    this.token++;
    this.resetQuiz();
    this.audio.pause();
    this.audio.removeAttribute("src");
    cancelAnimationFrame(this.raf);
    clearTimeout(this.gapTimer);
    clearTimeout(this.sleepTimer);
    clearInterval(this.prepPoll);
  }

  // ------------------------------------------------- narrate ahead
  /** Stop waiting for the buffer and start playing now (narration keeps being prepared). */
  startNow() {
    this.skipWait = true;
  }

  private setPrep(p: PrepStatus | null) {
    this.prep = p;
    this.emit("prep", p);
  }

  /** Follow a running background job (also after playback has started) so the UI can show progress. */
  watchPrep() {
    clearInterval(this.prepPoll);
    const tick = async () => {
      try {
        const st = await api.prepareStatus(this.docId);
        this.setPrep(st.state === "none" ? null : st);
        if (st.state !== "running") clearInterval(this.prepPoll);
      } catch {
        clearInterval(this.prepPoll);
      }
    };
    this.prepPoll = window.setInterval(tick, 2500);
    tick();
  }

  /** Start narrating the whole document ahead of the position (optionally keeping a limited premium voice). */
  async prepareFrom(unitId: string, patient = false) {
    const st = await api.prepare(this.docId, unitId, patient);
    this.setPrep(st);
    this.watchPrep();
  }

  async cancelPrep() {
    clearInterval(this.prepPoll);
    await api.prepareCancel(this.docId).catch(() => undefined);
    this.setPrep(null);
  }

  private async waitForBuffer(unit: Unit, tok: number) {
    this.skipWait = false;
    try {
      await this.fetchSpeech(unit, 0); // first words ready, and the permission question (if any) asked now
      let st = await api.prepare(this.docId, unit.id);
      while (tok === this.token) {
        this.setPrep(st);
        if (this.skipWait || st.state !== "running" || st.percent >= this.bufferPercent || (this.bufferMinutes > 0 && st.minutes_ready >= this.bufferMinutes)) break;
        await new Promise((r) => setTimeout(r, 700));
        st = await api.prepareStatus(this.docId);
      }
      if (st.state === "running") this.watchPrep();
      else if (st.state !== "error") this.setPrep(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) throw e;
      /* preparing ahead is best effort: play normally */
    }
  }

  // ----------------------------------------------------------- events
  private emit(type: string, detail?: any) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
  private setStatus(s: Status) {
    if (this.status !== s) {
      this.status = s;
      if (s !== "error") this.error = null;
      this.emit("status", s);
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = s === "playing" ? "playing" : s === "paused" ? "paused" : "none";
    }
  }
  private fail(msg: string) {
    this.error = msg;
    this.status = "error";
    this.audio.pause();
    this.emit("status", "error");
  }

  // ------------------------------------------------------------ data
  invalidate() {
    this.speechCache.clear();
    this.units.clear();
    this.links.clear();
  }

  rememberUnit(u: Unit) {
    this.units.set(u.id, u);
  }

  async getUnit(id: string): Promise<Unit> {
    const c = this.units.get(id);
    if (c) return c;
    const u = await api.unit(this.docId, id);
    this.units.set(u.id, u);
    return u;
  }

  private async neighbour(u: Unit, dir: 1 | -1): Promise<Unit | null> {
    const key = `${u.id}${dir > 0 ? ">" : "<"}`;
    if (this.links.has(key)) {
      const id = this.links.get(key);
      return id ? this.getUnit(id) : null;
    }
    const r = await api.neighbour(this.docId, u.id, dir);
    this.links.set(key, r.unit ? r.unit.id : null);
    if (r.unit) this.units.set(r.unit.id, r.unit);
    return r.unit;
  }

  private speechFor(u: Unit, chunk: number): Promise<Speech> {
    const key = `${u.id}#${chunk}`;
    let p = this.speechCache.get(key);
    if (!p) {
      p = this.fetchSpeech(u, chunk);
      this.speechCache.set(key, p);
      p.catch(() => this.speechCache.delete(key));
    }
    return p;
  }

  private async fetchSpeech(u: Unit, chunk: number): Promise<Speech> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const sp = await api.speech(this.docId, u.id, chunk);
        if (sp.notice && sp.notice !== this.lastNotice) {
          this.lastNotice = sp.notice;
          this.noticeHandler?.(sp.notice);
        }
        return sp;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && e.body?.error === "consent_required") {
          const ok = this.consentHandler ? await this.consentHandler(e.body) : false;
          if (!ok) throw new Error("Narration needs your permission to use the online voice service.");
          await api.consent(e.body.provider);
          continue;
        }
        if (e instanceof ApiError && e.status === 502 && e.body?.retryable === false) throw e;
        if (attempt === 2) throw e;
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
      }
    }
    throw new Error("unreachable");
  }

  chunkForWord(u: Unit, w: number): number {
    for (const c of u.chunks) if (w >= c.words[0] && w < c.words[1]) return c.i;
    return Math.max(0, u.chunks.length - 1);
  }

  sentenceOf(u: Unit, w: number): number {
    for (let i = 0; i < u.sentences.length; i++) {
      const [a, b] = u.sentences[i];
      if (w >= a && w < b) return i;
    }
    return 0;
  }

  private timeOfWord(sp: Speech, w: number): number {
    for (const [wi, s] of sp.words) if (wi >= w) return s;
    return 0;
  }

  // -------------------------------------------------------- playback
  async playFrom(unitOrId: string | Unit, word = 0, opts: { stopAt?: StopAt | null; time?: number } = {}): Promise<void> {
    const tok = ++this.token;
    clearTimeout(this.gapTimer);
    this.pendingNext = null;
    this.audio.pause();
    this.stopAt = opts.stopAt ?? null;
    this.setStatus("loading");
    try {
      const unit = typeof unitOrId === "string" ? await this.getUnit(unitOrId) : unitOrId;
      this.units.set(unit.id, unit);
      if (tok !== this.token) return;
      if (!unit.chunks.length) {
        const next = await this.nextReadable(unit);
        if (next) return this.playFrom(next, 0, opts);
        this.setStatus("idle");
        return;
      }
      if (!this.pos && !this.stopAt && this.bufferPercent > 0 && opts.time == null) {
        await this.waitForBuffer(unit, tok);
        if (tok !== this.token) return;
      }
      this.origin = { unitId: unit.id, word, stopAt: this.stopAt };
      const chunk = this.chunkForWord(unit, word);
      await this.loadChunk(unit, chunk, opts.time != null ? { time: opts.time } : { word }, tok);
    } catch (e: any) {
      if (tok === this.token) this.fail(e?.message || String(e));
    }
  }

  private async loadChunk(unit: Unit, chunk: number, start: Start, tok: number) {
    this.setStatus("loading");
    let sp: Speech;
    try {
      sp = await this.speechFor(unit, chunk);
    } catch (e: any) {
      if (tok === this.token) this.fail(e?.message || String(e));
      return;
    }
    if (tok !== this.token) return;
    const prevUnit = this.cur?.unit.id;
    this.cur = { unit, chunk, speech: sp, starts: sp.words.map((w) => w[1]) };
    if (prevUnit !== unit.id) this.noteUnitStart(unit);
    const a = this.audio;
    if (!a.src.endsWith(sp.audio)) {
      a.src = sp.audio;
      await new Promise<void>((resolve) => {
        const done = () => {
          a.removeEventListener("loadedmetadata", done);
          a.removeEventListener("error", done);
          resolve();
        };
        a.addEventListener("loadedmetadata", done);
        a.addEventListener("error", done);
      });
      if (tok !== this.token) return;
    }
    const dur = isFinite(a.duration) && a.duration > 0 ? a.duration : sp.duration;
    let t = 0;
    if (start.word != null) t = Math.max(0, this.timeOfWord(sp, start.word) - 0.03);
    else if (start.fromEnd != null) t = Math.max(0, dur - start.fromEnd);
    else if (start.time != null) t = Math.min(Math.max(0, start.time), Math.max(0, dur - 0.05));
    try {
      a.currentTime = t;
    } catch {
      /* not seekable yet */
    }
    a.playbackRate = this.rate;
    this.updatePos(true);
    try {
      await a.play();
    } catch (e: any) {
      if (tok !== this.token) return;
      if (e?.name === "NotAllowedError") {
        this.setStatus("paused");
        return;
      }
      this.fail("Playback failed: " + (e?.message || e));
      return;
    }
    if (tok !== this.token) return;
    this.setStatus("playing");
    this.loop();
    this.prefetchNext(unit, chunk);
  }

  private async prefetchNext(unit: Unit, chunk: number) {
    try {
      const nx = await this.nextChunkPos(unit, chunk);
      if (!nx) return;
      const sp = await this.speechFor(nx.unit, nx.chunk);
      // warm the HTTP cache so the transition is seamless
      this.preload = new Audio();
      this.preload.preload = "auto";
      this.preload.src = sp.audio;
    } catch {
      /* best effort */
    }
  }

  private async nextReadable(u: Unit): Promise<Unit | null> {
    let cur: Unit | null = u;
    for (let i = 0; i < 300 && cur; i++) {
      cur = await this.neighbour(cur, 1);
      if (cur && this.readKinds[cur.kind] !== false && cur.chunks.length) return cur;
    }
    return null;
  }

  private async prevReadable(u: Unit): Promise<Unit | null> {
    let cur: Unit | null = u;
    for (let i = 0; i < 300 && cur; i++) {
      cur = await this.neighbour(cur, -1);
      if (cur && this.readKinds[cur.kind] !== false && cur.chunks.length) return cur;
    }
    return null;
  }

  private async nextChunkPos(unit: Unit, chunk: number) {
    if (chunk + 1 < unit.chunks.length) return { unit, chunk: chunk + 1 };
    const n = await this.nextReadable(unit);
    return n ? { unit: n, chunk: 0 } : null;
  }

  private async prevChunkPos(unit: Unit, chunk: number) {
    if (chunk > 0) return { unit, chunk: chunk - 1 };
    const p = await this.prevReadable(unit);
    return p ? { unit: p, chunk: p.chunks.length - 1 } : null;
  }

  private beyondStop(ref: [number, number]) {
    return this.stopAt != null && cmpRef(ref, [this.stopAt.page, this.stopAt.word]) > 0;
  }

  private async onEnded() {
    const cur = this.cur;
    if (!cur) return;
    const tok = this.token;
    const next = await this.nextChunkPos(cur.unit, cur.chunk);
    if (tok !== this.token) return;
    if ((!next || next.unit.id !== cur.unit.id) && !(await this.afterUnit(cur.unit, next ? next.unit.id : null, tok))) return;
    if (!next || this.beyondStop(next.unit.words[next.unit.chunks[next.chunk].words[0]] ?? [1e9, 0])) {
      this.save("finished");
      this.setStatus("idle");
      this.emit("finished");
      return;
    }
    if (this.teacherMode && this.teacherHandler && next.unit.id !== cur.unit.id && next.unit.kind === "heading" && ["paragraph", "list_item", "note"].includes(cur.unit.kind)) {
      // end of a section: let the teacher explain before moving on
      try {
        await this.teacherHandler(cur.unit);
      } catch {
        /* an explanation failure must never stop the reading */
      }
      if (tok !== this.token) return;
    }
    const gap = next.unit.id === cur.unit.id ? 0 : ((cur.unit.pause_after || 0) + (next.unit.pause_before || 0)) * this.pauseScale / this.rate;
    this.pendingNext = next;
    this.gapTimer = window.setTimeout(() => {
      this.pendingNext = null;
      this.loadChunk(next.unit, next.chunk, { time: 0 }, tok);
    }, gap);
  }

  // ------------------------------------------------------- comprehension checkpoints
  resetQuiz() {
    this.qTok++;
    this.qPlan = null;
    this.qPlanning = null;
    this.qHeard = new Set();
    this.qHeardChars = 0;
    this.qPrefetched = false;
    this.qDoneUpTo = null;
  }

  /** A unit starts playing: if it is outside the planned stretch, plan a new one that starts here. */
  private noteUnitStart(unit: Unit) {
    if (!this.quizOn || this.stopAt) return;
    if (this.qPlan && this.qPlan.units.some((u) => u.id === unit.id)) return; // still inside the stretch
    if (this.qDoneUpTo) {
      if (cmpUnit(unit.id, this.qDoneUpTo) <= 0) return; // hearing something again that was already asked about
      this.qDoneUpTo = null;
    }
    if (this.qPlanning === unit.id) return;
    this.qPlan = null;
    this.qHeard = new Set();
    this.qHeardChars = 0;
    this.qPrefetched = false;
    this.qPlanning = unit.id;
    const tok = ++this.qTok;
    api
      .quizPlan(this.docId, unit.id)
      .then((r) => {
        if (tok === this.qTok && r.plan && r.plan.ask) this.qPlan = r.plan;
      })
      .catch(() => {
        /* no plan: no checkpoint for this stretch */
      })
      .finally(() => {
        if (this.qPlanning === unit.id) this.qPlanning = null;
      });
  }

  /** A unit has been heard to its end.  Returns false when narration should not carry on by itself. */
  private async afterUnit(unit: Unit, nextId: string | null, tok: number): Promise<boolean> {
    const plan = this.qPlan;
    if (!this.quizOn || !plan || this.stopAt) return true;
    const entry = plan.units.find((u) => u.id === unit.id);
    if (!entry) return true;
    if (!this.qHeard.has(unit.id)) {
      this.qHeard.add(unit.id);
      this.qHeardChars += entry.chars;
    }
    if (!this.qPrefetched && this.qHeardChars >= 0.5 * plan.chars && this.quizPrefetch) {
      this.qPrefetched = true; // by now the listener is half way through: start writing the questions
      this.quizPrefetch(plan.units.map((u) => u.id));
    }
    if (unit.id !== plan.end) return true;
    const heard = plan.units.filter((u) => this.qHeard.has(u.id)).map((u) => u.id);
    this.qDoneUpTo = plan.end;
    this.qPlan = null;
    this.qHeard = new Set();
    this.qHeardChars = 0;
    this.qPrefetched = false;
    if (this.checkpointHandler && heard.length) {
      this.setStatus("paused");
      try {
        await this.checkpointHandler(heard, plan, nextId);
      } catch {
        /* the questions must never stop the reading */
      }
    }
    return tok === this.token;
  }

  pause() {
    if (this.status === "playing" || this.status === "loading") {
      this.token++;
      clearTimeout(this.gapTimer);
      this.audio.pause();
      this.setStatus("paused");
      this.save("pause");
    }
  }

  async resume(): Promise<void> {
    if (this.status === "error" && this.pos) {
      this.speechCache.clear();
      return this.playFrom(this.pos.unit, this.pos.word, { stopAt: this.stopAt });
    }
    if (this.pendingNext) {
      const n = this.pendingNext;
      this.pendingNext = null;
      return this.loadChunk(n.unit, n.chunk, { time: 0 }, ++this.token);
    }
    if (this.cur && this.audio.src && !this.audio.ended) {
      const tok = ++this.token;
      this.audio.playbackRate = this.rate;
      try {
        await this.audio.play();
      } catch (e: any) {
        this.fail("Playback failed: " + (e?.message || e));
        return;
      }
      if (tok !== this.token) return;
      this.setStatus("playing");
      this.loop();
      return;
    }
    if (this.pos) return this.playFrom(this.pos.unit, this.pos.word, { stopAt: this.stopAt });
  }

  toggle() {
    if (this.status === "playing" || this.status === "loading") this.pause();
    else this.resume();
  }

  stop() {
    this.token++;
    this.resetQuiz();
    clearTimeout(this.gapTimer);
    this.pendingNext = null;
    this.audio.pause();
    this.save("stop");
    this.stopAt = null;
    this.setStatus("idle");
  }

  restart() {
    if (this.origin) this.playFrom(this.origin.unitId, this.origin.word, { stopAt: this.origin.stopAt });
  }

  setRate(r: number) {
    this.rate = Math.min(3, Math.max(0.5, r));
    this.audio.playbackRate = this.rate;
    this.emit("rate", this.rate);
  }

  /** Skip by seconds of narration (crosses chunk/unit boundaries). */
  async seekBy(sec: number) {
    const cur = this.cur;
    if (!cur) return;
    const a = this.audio;
    const dur = isFinite(a.duration) && a.duration > 0 ? a.duration : cur.speech.duration;
    const t = a.currentTime + sec;
    const wasPlaying = this.status === "playing" || this.status === "loading";
    if (t >= 0 && t < dur) {
      a.currentTime = t;
      this.updatePos(true);
      return;
    }
    const tok = ++this.token;
    clearTimeout(this.gapTimer);
    a.pause();
    this.setStatus("loading");
    if (t < 0) {
      const p = await this.prevChunkPos(cur.unit, cur.chunk);
      if (tok !== this.token) return;
      if (!p) {
        a.currentTime = 0;
        if (wasPlaying) this.resume();
        return;
      }
      await this.loadChunk(p.unit, p.chunk, { fromEnd: -t }, tok);
    } else {
      const n = await this.nextChunkPos(cur.unit, cur.chunk);
      if (tok !== this.token) return;
      if (!n) return;
      await this.loadChunk(n.unit, n.chunk, { time: t - dur }, tok);
    }
    if (!wasPlaying) this.pause();
  }

  async sentence(dir: 1 | -1): Promise<void> {
    const p = this.pos;
    if (!p) return;
    const u = p.unit;
    let s = p.sentence;
    if (dir < 0) {
      const start = this.cur ? this.timeOfWord(this.cur.speech, u.sentences[s]?.[0] ?? 0) : 0;
      if (this.audio.currentTime - start > 1.2 && this.cur?.unit.id === u.id) return this.playFrom(u, u.sentences[s][0], { stopAt: this.stopAt });
      s -= 1;
      if (s < 0) {
        const pu = await this.prevReadable(u);
        if (!pu) return this.playFrom(u, 0, { stopAt: this.stopAt });
        const last = pu.sentences[pu.sentences.length - 1];
        return this.playFrom(pu, last ? last[0] : 0, { stopAt: this.stopAt });
      }
      return this.playFrom(u, u.sentences[s][0], { stopAt: this.stopAt });
    }
    s += 1;
    if (s >= u.sentences.length) {
      const nu = await this.nextReadable(u);
      if (nu) return this.playFrom(nu, 0, { stopAt: this.stopAt });
      return;
    }
    return this.playFrom(u, u.sentences[s][0], { stopAt: this.stopAt });
  }

  repeatSentence() {
    const p = this.pos;
    if (p) this.playFrom(p.unit, p.unit.sentences[p.sentence]?.[0] ?? 0, { stopAt: this.stopAt });
  }

  async paragraph(dir: 1 | -1): Promise<void> {
    const p = this.pos;
    if (!p) return;
    if (dir > 0) {
      const nu = await this.nextReadable(p.unit);
      if (nu) this.playFrom(nu, 0, { stopAt: this.stopAt });
      return;
    }
    if (p.word > 3) return this.playFrom(p.unit, 0, { stopAt: this.stopAt });
    const pu = await this.prevReadable(p.unit);
    this.playFrom(pu || p.unit, 0, { stopAt: this.stopAt });
  }

  setSleep(minutes: number) {
    clearTimeout(this.sleepTimer);
    this.sleepUntil = null;
    if (minutes > 0) {
      this.sleepUntil = Date.now() + minutes * 60000;
      this.sleepTimer = window.setTimeout(() => {
        this.sleepUntil = null;
        this.pause();
        this.emit("sleep");
      }, minutes * 60000);
    }
    this.emit("sleepchange", this.sleepUntil);
  }

  // -------------------------------------------------------- position
  private loop() {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      if (this.status !== "playing") return;
      this.updatePos(false);
      if (Date.now() - this.lastSave > 5000) this.save();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private updatePos(force: boolean) {
    const cur = this.cur;
    if (!cur) return;
    const t = this.audio.currentTime;
    const st = cur.starts;
    let lo = 0,
      hi = st.length - 1,
      idx = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (st[mid] <= t + 0.01) {
        idx = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    const entry = cur.speech.words[idx];
    if (!entry) return;
    const w = entry[0];
    const ref = cur.unit.words[w];
    if (!ref) return;
    if (this.beyondStop(ref)) {
      this.token++;
      this.audio.pause();
      this.save("range-end");
      this.setStatus("idle");
      this.emit("finished");
      return;
    }
    const changed = force || !this.pos || this.pos.unit.id !== cur.unit.id || this.pos.word !== w;
    const dur = isFinite(this.audio.duration) ? this.audio.duration : cur.speech.duration;
    this.pos = {
      unit: cur.unit,
      chunk: cur.chunk,
      word: w,
      page: ref[0],
      pageWord: ref[1],
      sentence: this.sentenceOf(cur.unit, w),
      timing: cur.speech.timing,
      time: t,
      duration: dur,
    };
    if (changed) this.emit("position", this.pos);
    else this.emit("time", this.pos);
  }

  save(event?: string) {
    const p = this.pos;
    if (!p) return;
    this.lastSave = Date.now();
    api
      .savePosition(this.docId, {
        unit_id: p.unit.id,
        word: p.word,
        page: p.page,
        chunk: p.chunk,
        offset: p.time,
        progress: this.pages > 1 ? p.page / (this.pages - 1) : 1,
        event,
      })
      .catch(() => undefined);
  }

  /** Synchronous best-effort save for page unload. */
  saveBeacon() {
    const p = this.pos;
    if (!p) return;
    const body = JSON.stringify({ unit_id: p.unit.id, word: p.word, page: p.page, chunk: p.chunk, offset: p.time, progress: this.pages > 1 ? p.page / (this.pages - 1) : 1 });
    try {
      fetch(`/api/documents/${this.docId}/position`, { method: "PUT", body, headers: { "Content-Type": "application/json" }, keepalive: true });
    } catch {
      /* ignore */
    }
  }

  private setupMediaSession() {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      ms.setActionHandler("play", () => this.resume());
      ms.setActionHandler("pause", () => this.pause());
      ms.setActionHandler("stop", () => this.stop());
      ms.setActionHandler("seekbackward", () => this.seekBy(-10));
      ms.setActionHandler("seekforward", () => this.seekBy(10));
      ms.setActionHandler("previoustrack", () => this.sentence(-1));
      ms.setActionHandler("nexttrack", () => this.sentence(1));
    } catch {
      /* unsupported action */
    }
  }

  setMediaTitle(title: string) {
    if ("mediaSession" in navigator && (window as any).MediaMetadata) {
      navigator.mediaSession.metadata = new (window as any).MediaMetadata({ title, artist: "PDF Narrator" });
    }
  }

  get currentTime() {
    return this.audio.currentTime;
  }
}
