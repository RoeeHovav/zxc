/**
 * Read-aloud engine on top of the browser's built-in speech synthesis (Web Speech API). No AI and no network calls of our own:
 * the voice is whatever the device/browser provides. Some browsers expose "online" voices (the browser then sends the text to its
 * provider); those are used only when the learner allows them (default: off) or picks one explicitly.
 *
 * Design for a natural, robust result:
 *  - text arrives as short segments (see domain/speech.ts); each segment is one utterance with its own intonation, followed by a pause
 *    whose length depends on the punctuation → sounds like a person reading, not a machine streaming a long string;
 *  - pause/resume is implemented by cancelling and restarting at the current segment (works in every engine, unlike speechSynthesis.pause());
 *  - stale callbacks of cancelled utterances are ignored through a run token;
 *  - a watchdog moves on when an engine never reports the end of an utterance (a known mobile-Chrome / Safari problem).
 */
import { pickVoice, rankVoices, type SpeechSegment, type VoiceInfo } from '../domain/speech';

export interface SpeechSettings { voiceURI: string | null; rate: number; pitch: number; allowOnline: boolean; autoRead: boolean }
export const DEFAULT_SPEECH_SETTINGS: SpeechSettings = { voiceURI: null, rate: 0.95, pitch: 1, allowOnline: false, autoRead: false };
export const RATE_MIN = 0.6;
export const RATE_MAX = 1.5;

export type SpeechStatus = 'idle' | 'speaking' | 'paused';
export interface SpeechState {
  supported: boolean;
  voices: VoiceInfo[];
  hebrewVoices: VoiceInfo[];
  /** the voice that will be used (null = none matches; the browser default for he-IL is then requested) */
  activeVoice: VoiceInfo | null;
  status: SpeechStatus;
  ownerId: string | null;
  /** owner of the reading that just ran to its natural end (not stopped by the learner); cleared by the next speak/stop */
  finishedOwner: string | null;
  activeBlockId: string | null;
  index: number;
  total: number;
  error: string | null;
  settings: SpeechSettings;
}

interface Deps {
  synth?: SpeechSynthesis | null;
  Utterance?: typeof SpeechSynthesisUtterance;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

const STORAGE_KEY = 'bahad1.read-aloud.v1';
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

function safeStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export class SpeechEngine {
  private synth: SpeechSynthesis | null;
  private Utter: typeof SpeechSynthesisUtterance | null;
  private storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  private st: (fn: () => void, ms: number) => unknown;
  private ct: (id: unknown) => void;
  private listeners = new Set<() => void>();
  private segments: SpeechSegment[] = [];
  private token = 0;
  private timer: unknown = null;
  private watchdog: unknown = null;
  private errors = 0;
  private voiceRetries = 0;
  private state: SpeechState;

  constructor(deps: Deps = {}) {
    this.synth = deps.synth !== undefined ? deps.synth : typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis : null;
    this.Utter = deps.Utterance ?? (typeof window !== 'undefined' && window.SpeechSynthesisUtterance ? window.SpeechSynthesisUtterance : null);
    this.storage = deps.storage !== undefined ? deps.storage : safeStorage();
    this.st = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.ct = deps.clearTimeout ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
    this.state = {
      supported: !!(this.synth && this.Utter), voices: [], hebrewVoices: [], activeVoice: null, status: 'idle', ownerId: null, finishedOwner: null, activeBlockId: null,
      index: 0, total: 0, error: null, settings: this.loadSettings(),
    };
    if (this.synth) {
      this.refreshVoices();
      try { this.synth.addEventListener?.('voiceschanged', () => this.refreshVoices()); } catch { /* old engines */ }
      this.pollVoices();
    }
  }

  // ---- store protocol ---------------------------------------------------------------------------------------------------------
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getState = () => this.state;
  private set(patch: Partial<SpeechState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((l) => l()); }

  // ---- settings ---------------------------------------------------------------------------------------------------------------
  private loadSettings(): SpeechSettings {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (raw) {
        const o = JSON.parse(raw) as Partial<SpeechSettings>;
        return {
          voiceURI: typeof o.voiceURI === 'string' ? o.voiceURI : null,
          rate: clamp(Number(o.rate) || DEFAULT_SPEECH_SETTINGS.rate, RATE_MIN, RATE_MAX),
          pitch: clamp(Number(o.pitch) || DEFAULT_SPEECH_SETTINGS.pitch, 0.7, 1.3),
          allowOnline: !!o.allowOnline, autoRead: !!o.autoRead,
        };
      }
    } catch { /* corrupt or blocked storage → defaults */ }
    return { ...DEFAULT_SPEECH_SETTINGS };
  }
  setSettings(patch: Partial<SpeechSettings>) {
    const settings = { ...this.state.settings, ...patch };
    settings.rate = clamp(settings.rate, RATE_MIN, RATE_MAX);
    settings.pitch = clamp(settings.pitch, 0.7, 1.3);
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* private mode: keep in memory */ }
    this.set({ settings, activeVoice: pickVoice(this.state.voices, settings.voiceURI, settings.allowOnline) });
  }

  // ---- voices -----------------------------------------------------------------------------------------------------------------
  private refreshVoices() {
    if (!this.synth) return;
    let list: SpeechSynthesisVoice[] = [];
    try { list = this.synth.getVoices(); } catch { /* ignore */ }
    const voices: VoiceInfo[] = list.map((v) => ({ voiceURI: v.voiceURI, name: v.name, lang: v.lang, localService: v.localService, default: v.default }));
    if (voices.length === this.state.voices.length && voices.every((v, i) => v.voiceURI === this.state.voices[i].voiceURI)) return;
    const { settings } = this.state;
    this.set({ voices, hebrewVoices: rankVoices(voices, true), activeVoice: pickVoice(voices, settings.voiceURI, settings.allowOnline) });
  }
  /** Chrome fills the voice list asynchronously and Safari never fires voiceschanged: poll a few times. */
  private pollVoices() {
    if (this.state.voices.length || this.voiceRetries++ > 12) return;
    this.st(() => { this.refreshVoices(); this.pollVoices(); }, 300);
  }

  // ---- playback ---------------------------------------------------------------------------------------------------------------
  isOwner(id: string) { return this.state.ownerId === id && this.state.status !== 'idle'; }

  speak(segments: SpeechSegment[], ownerId: string | null = null) {
    if (!this.state.supported || !segments.length) return;
    this.segments = segments;
    this.errors = 0;
    this.set({ ownerId, finishedOwner: null, total: segments.length, error: null });
    this.run(0);
  }

  private clearTimers() {
    if (this.timer !== null) { this.ct(this.timer); this.timer = null; }
    if (this.watchdog !== null) { this.ct(this.watchdog); this.watchdog = null; }
  }

  private run(from: number) {
    const synth = this.synth; const Utter = this.Utter;
    if (!synth || !Utter) return;
    const tok = ++this.token;
    this.clearTimers();
    try { synth.cancel(); } catch { /* ignore */ }
    const play = (i: number) => {
      if (tok !== this.token) return;
      if (i >= this.segments.length) { this.finish(); return; }
      const seg = this.segments[i];
      this.set({ status: 'speaking', index: i, activeBlockId: seg.blockId ?? null });
      const u = new Utter(seg.text);
      u.lang = 'he-IL';
      const v = this.state.activeVoice ? synth.getVoices().find((x) => x.voiceURI === this.state.activeVoice!.voiceURI) : undefined;
      if (v) u.voice = v;
      u.rate = clamp(this.state.settings.rate * (seg.rate ?? 1), 0.5, 2);
      u.pitch = this.state.settings.pitch;
      u.volume = 1;
      let advanced = false;
      const advance = (delay: number) => {
        if (advanced || tok !== this.token) return;
        advanced = true;
        if (this.watchdog !== null) { this.ct(this.watchdog); this.watchdog = null; }
        this.timer = this.st(() => play(i + 1), delay);
      };
      u.onend = () => advance(seg.pauseAfterMs);
      u.onerror = (e: SpeechSynthesisErrorEvent) => {
        if (tok !== this.token) return;
        if (e.error === 'canceled' || e.error === 'interrupted') return;
        this.errors += 1;
        this.set({ error: e.error || 'error' });
        if (this.errors >= 3) { this.stop(); return; }
        advance(120);
      };
      // some engines never report the end of an utterance: after a generous estimate move on anyway
      const est = (seg.text.length * 95) / Math.max(0.5, u.rate) + 4000;
      this.watchdog = this.st(() => { if (tok === this.token && !advanced && !synth.speaking) advance(0); else if (tok === this.token && !advanced) this.watchdog = this.st(() => advance(0), est); }, est);
      try { synth.speak(u); } catch (e) { this.set({ error: String(e) }); this.stop(); }
    };
    // Chrome sometimes drops an utterance that is spoken immediately after cancel(): a tiny delay avoids it
    this.timer = this.st(() => play(from), 50);
    this.set({ status: 'speaking', index: from });
  }

  private finish() {
    this.clearTimers();
    this.token++;
    this.set({ status: 'idle', finishedOwner: this.state.ownerId, ownerId: null, activeBlockId: null, index: 0, total: 0 });
  }

  stop() {
    this.token++;
    this.clearTimers();
    try { this.synth?.cancel(); } catch { /* ignore */ }
    this.set({ status: 'idle', finishedOwner: null, ownerId: null, activeBlockId: null, index: 0, total: 0 });
  }
  stopIfOwner(id: string) { if (this.state.ownerId === id) this.stop(); }

  /** Pause = remember the position and cancel; resume restarts from the beginning of the current sentence. Works in every engine. */
  pause() {
    if (this.state.status !== 'speaking') return;
    this.token++;
    this.clearTimers();
    try { this.synth?.cancel(); } catch { /* ignore */ }
    this.set({ status: 'paused' });
  }
  resume() { if (this.state.status === 'paused') this.run(this.state.index); }
  next() { if (this.state.status !== 'idle') { if (this.state.index + 1 >= this.state.total) this.stop(); else this.run(this.state.index + 1); } }
  prev() { if (this.state.status !== 'idle') this.run(Math.max(0, this.state.index - 1)); }

  /** Re-speak the current sentence with the new settings (voice/rate changes while listening take effect immediately). */
  restartCurrent() { if (this.state.status === 'speaking') this.run(this.state.index); }

  hasHebrewVoice() { return this.state.hebrewVoices.length > 0; }
}

export const speechEngine = new SpeechEngine();
