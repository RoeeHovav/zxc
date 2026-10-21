import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanForSpeech, explainSegments, gematria, pickVoice, rankVoices, segmentsFromText, splitIntoSentences, voiceScore, type VoiceInfo,
} from '../../src/domain/speech';
import { SpeechEngine, DEFAULT_SPEECH_SETTINGS } from '../../src/app/speechEngine';

describe('cleanForSpeech: what engines usually get wrong', () => {
  it('reads Hebrew-letter numerals and years as numbers', () => {
    expect(cleanForSpeech('ט"ו בשבט')).toBe('15 בשבט');
    expect(cleanForSpeech('בי"ב באב')).toBe('ב-12 באב');
    expect(cleanForSpeech('ה\' באייר תש"ח')).toBe('5 באייר 5708');
    expect(cleanForSpeech('בתרפ"ט')).toBe('ב-5689');
    expect(cleanForSpeech('ט\' באב')).toBe('9 באב');
    expect(gematria('תשח')).toBe(708);
  });
  it('does not touch acronyms that engines read well, and expands the few that are spelled out', () => {
    expect(cleanForSpeech('צה"ל ובג"ץ')).toBe('צה"ל ובג"ץ');
    expect(cleanForSpeech('נעשה ע"י הממשלה')).toBe('נעשה על ידי הממשלה');
    expect(cleanForSpeech('ר\' יהודה הנשיא')).toBe('רבי יהודה הנשיא');
    expect(cleanForSpeech('דגל ה"הגנה')).toBe('דגל ההגנה');
  });
  it('spells ranges, percentages and approximations', () => {
    expect(cleanForSpeech('בשנים 1936-1939')).toBe('בשנים 1936 עד 1939');
    expect(cleanForSpeech('כ-85,000 נפש')).toBe('בערך 85,000 נפש');
    expect(cleanForSpeech('10% מן האוכלוסייה')).toBe('10 אחוז מן האוכלוסייה');
  });
  it('removes vowel points, silent quotes and brackets; turns asides and dashes into breaths', () => {
    expect(cleanForSpeech('שָׁלוֹם')).toBe('שלום');
    expect(cleanForSpeech('הוא אמר "שלום" ויצא')).toBe('הוא אמר שלום ויצא');
    expect(cleanForSpeech('זוג רקדנים (1990), מסגד')).toBe('זוג רקדנים, 1990, מסגד');
    expect(cleanForSpeech('בן־גוריון – ראש הממשלה')).toBe('בן גוריון, ראש הממשלה');
    expect(cleanForSpeech('אל-כרמל')).toBe('אל כרמל');
    expect(cleanForSpeech('א • ב   ג')).toBe('א ב ג');
    expect(cleanForSpeech('כך [?] ויותר')).toBe('כך ויותר');
  });
  it('keeps the geresh inside foreign names (צ\'רקסים)', () => {
    expect(cleanForSpeech('הצ\'רקסים')).toBe("הצ'רקסים");
  });
});

describe('segmentation: short sentences with human pauses', () => {
  it('splits at sentence ends and cuts very long sentences at a comma', () => {
    const long = `${'מילה '.repeat(20).trim()}, ${'עוד '.repeat(40).trim()}.`;
    const parts = splitIntoSentences(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 170)).toBe(true);
    expect(splitIntoSentences('שלום. מה שלומך? בסדר!')).toEqual(['שלום.', 'מה שלומך?', 'בסדר!']);
  });
  it('gives sentence ends longer pauses than commas and the last segment the block pause', () => {
    const segs = segmentsFromText('משפט ראשון. משפט שני?', { after: 700 });
    expect(segs.map((s) => s.pauseAfterMs)).toEqual([330, 700]);
    const cut = segmentsFromText(`${'מילה '.repeat(20).trim()}, ${'עוד '.repeat(40).trim()}.`, { after: 700 });
    expect(cut[0].pauseAfterMs).toBeLessThan(330);
  });
  it('reads a lesson card: title, paragraphs, each bullet separately, the key sentence slower; every segment points at its block', () => {
    const segs = explainSegments('כותרת', [
      { kind: 'p', text: 'פסקה אחת.' }, { kind: 'bullets', items: ['פריט א', 'פריט ב'] }, { kind: 'key', text: 'לזכור.' },
    ], 'c');
    expect(segs.map((s) => s.text)).toEqual(['כותרת', 'פסקה אחת.', 'פריט א', 'פריט ב', 'לזכור.']);
    expect(segs.map((s) => s.blockId)).toEqual(['c:title', 'c:0', 'c:1', 'c:1', 'c:2']);
    expect(segs[4].rate).toBeLessThan(1);
    expect(segs[2].pauseAfterMs).toBeLessThan(segs[3].pauseAfterMs);
  });
});

const V = (name: string, lang: string, localService: boolean, uri = name): VoiceInfo => ({ voiceURI: uri, name, lang, localService });
const VOICES = [
  V('Microsoft Asaf - Hebrew (Israel)', 'he-IL', true), V('Microsoft Hila Online (Natural) - Hebrew (Israel)', 'he-IL', false),
  V('Google עברית', 'he-IL', false), V('Carmit', 'he-IL', true), V('Samantha', 'en-US', true), V('Old', 'iw-IL', true),
];
describe('voice choice', () => {
  it('prefers neural/natural voices when online voices are allowed, local voices otherwise', () => {
    expect(rankVoices(VOICES, true)[0].name).toContain('Natural');
    const local = rankVoices(VOICES, false);
    expect(local.every((v) => v.localService)).toBe(true);
    expect(local[0].name).toBe('Carmit');
    expect(rankVoices(VOICES, true).some((v) => v.lang.startsWith('en'))).toBe(false);
    expect(voiceScore(V('espeak he', 'he', true))).toBeLessThan(voiceScore(V('Carmit', 'he-IL', true)));
  });
  it('an explicit choice wins, even for an online voice; a vanished choice falls back to the automatic pick', () => {
    expect(pickVoice(VOICES, 'Google עברית', false)?.name).toBe('Google עברית');
    expect(pickVoice(VOICES, 'gone', false)?.name).toBe('Carmit');
    expect(pickVoice([V('Google עברית', 'he-IL', false)], null, false)).toBeNull();
  });
});

// ---- engine with a fake speech synthesis ----------------------------------------------------------------------------------------
class FakeUtterance {
  text: string; lang = ''; voice: unknown = null; rate = 1; pitch = 1; volume = 1;
  onend: (() => void) | null = null; onerror: ((e: { error: string }) => void) | null = null;
  constructor(t: string) { this.text = t; }
}
class FakeSynth {
  voices: { voiceURI: string; name: string; lang: string; localService: boolean; default: boolean }[];
  spoken: FakeUtterance[] = []; current: FakeUtterance | null = null; speaking = false; cancelled = 0;
  constructor(voices: VoiceInfo[]) { this.voices = voices.map((v) => ({ ...v, default: false })); }
  getVoices() { return this.voices; }
  addEventListener() { /* voiceschanged not simulated */ }
  cancel() { this.cancelled++; this.current = null; this.speaking = false; }
  speak(u: FakeUtterance) { this.current = u; this.speaking = true; this.spoken.push(u); }
  /** the engine reports that the current utterance finished */
  end() { const u = this.current; this.speaking = false; u?.onend?.(); }
}
const mkEngine = (voices: VoiceInfo[] = VOICES, storage: Record<string, string> = {}) => {
  const synth = new FakeSynth(voices);
  const store = { getItem: (k: string) => storage[k] ?? null, setItem: (k: string, v: string) => { storage[k] = v; } };
  const engine = new SpeechEngine({ synth: synth as unknown as SpeechSynthesis, Utterance: FakeUtterance as unknown as typeof SpeechSynthesisUtterance, storage: store });
  return { engine, synth, storage };
};
const SEGS = [{ text: 'אחד.', pauseAfterMs: 300, blockId: 'a' }, { text: 'שניים.', pauseAfterMs: 300, blockId: 'b' }, { text: 'שלושה.', pauseAfterMs: 0, blockId: 'c' }];

describe('speech engine', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('speaks segment by segment with pauses in between, Hebrew language and the chosen voice, then goes idle', () => {
    const { engine, synth } = mkEngine();
    expect(engine.getState().activeVoice?.name).toBe('Carmit'); // best LOCAL voice; online voices are off by default
    engine.speak(SEGS, 'owner');
    expect(engine.getState().status).toBe('speaking');
    vi.advanceTimersByTime(60);
    expect(synth.spoken.map((u) => u.text)).toEqual(['אחד.']);
    expect(synth.spoken[0].lang).toBe('he-IL');
    expect((synth.spoken[0].voice as { name: string }).name).toBe('Carmit');
    expect(engine.getState().activeBlockId).toBe('a');
    synth.end();
    vi.advanceTimersByTime(200);
    expect(synth.spoken).toHaveLength(1); // still inside the 300 ms pause
    vi.advanceTimersByTime(150);
    expect(synth.spoken.map((u) => u.text)).toEqual(['אחד.', 'שניים.']);
    expect(engine.getState().index).toBe(1);
    synth.end(); vi.advanceTimersByTime(400); synth.end(); vi.advanceTimersByTime(10);
    expect(synth.spoken).toHaveLength(3);
    expect(engine.getState().status).toBe('idle');
    expect(engine.getState().activeBlockId).toBeNull();
    expect(engine.getState().finishedOwner).toBe('owner'); // ran to its natural end
    engine.speak(SEGS, 'o2'); vi.advanceTimersByTime(60); engine.stop();
    expect(engine.getState().finishedOwner).toBeNull(); // a manual stop is not a finish
  });

  it('pause keeps the position, resume restarts the current sentence, stop clears everything', () => {
    const { engine, synth } = mkEngine();
    engine.speak(SEGS, 'o');
    vi.advanceTimersByTime(60); synth.end(); vi.advanceTimersByTime(400);
    expect(engine.getState().index).toBe(1);
    engine.pause();
    expect(engine.getState().status).toBe('paused');
    vi.advanceTimersByTime(2000);
    expect(synth.spoken).toHaveLength(2); // nothing is spoken while paused
    engine.resume(); vi.advanceTimersByTime(60);
    expect(synth.spoken.map((u) => u.text)).toEqual(['אחד.', 'שניים.', 'שניים.']);
    engine.stop();
    expect(engine.getState()).toMatchObject({ status: 'idle', ownerId: null, index: 0 });
    vi.advanceTimersByTime(5000);
    expect(synth.spoken).toHaveLength(3);
  });

  it('ignores late end events of cancelled utterances (no double reading)', () => {
    const { engine, synth } = mkEngine();
    engine.speak(SEGS, 'o'); vi.advanceTimersByTime(60);
    const first = synth.spoken[0];
    engine.next(); vi.advanceTimersByTime(60);
    expect(synth.spoken.map((u) => u.text)).toEqual(['אחד.', 'שניים.']);
    first.onend?.(); vi.advanceTimersByTime(1000);
    expect(synth.spoken).toHaveLength(2);
  });

  it('next/prev jump by sentence and speed changes multiply the segment rate', () => {
    const { engine, synth } = mkEngine();
    engine.setSettings({ rate: 1.2 });
    engine.speak([{ ...SEGS[0], rate: 0.9 }, SEGS[1], SEGS[2]], 'o'); vi.advanceTimersByTime(60);
    expect(synth.spoken[0].rate).toBeCloseTo(1.08, 5);
    engine.next(); vi.advanceTimersByTime(60); engine.next(); vi.advanceTimersByTime(60);
    expect(engine.getState().index).toBe(2);
    engine.prev(); vi.advanceTimersByTime(60);
    expect(engine.getState().index).toBe(1);
    engine.next(); engine.next(); // beyond the end stops
    expect(engine.getState().status).toBe('idle');
  });

  it('survives engine errors: cancelled is ignored, real errors skip ahead and stop after repeated failures', () => {
    const { engine, synth } = mkEngine();
    engine.speak(SEGS, 'o'); vi.advanceTimersByTime(60);
    synth.current!.onerror?.({ error: 'canceled' });
    expect(engine.getState().status).toBe('speaking');
    synth.current!.onerror?.({ error: 'synthesis-failed' }); vi.advanceTimersByTime(200);
    expect(synth.spoken).toHaveLength(2);
    synth.current!.onerror?.({ error: 'synthesis-failed' }); vi.advanceTimersByTime(200);
    synth.current!.onerror?.({ error: 'synthesis-failed' });
    expect(engine.getState().status).toBe('idle');
  });

  it('moves on by itself when an engine never reports the end of an utterance (watchdog)', () => {
    const { engine, synth } = mkEngine();
    engine.speak(SEGS, 'o'); vi.advanceTimersByTime(60);
    synth.speaking = false; // the engine silently dropped it
    vi.advanceTimersByTime(8000);
    expect(synth.spoken.length).toBeGreaterThanOrEqual(2);
  });

  it('persists settings (and survives broken storage); online voices only after the learner allows them', () => {
    const storage: Record<string, string> = {};
    const a = mkEngine(VOICES, storage).engine;
    a.setSettings({ rate: 1.1, allowOnline: true, autoRead: true });
    expect(a.getState().activeVoice?.name).toContain('Natural');
    const b = mkEngine(VOICES, storage).engine;
    expect(b.getState().settings).toMatchObject({ rate: 1.1, allowOnline: true, autoRead: true });
    const broken = new SpeechEngine({ synth: new FakeSynth(VOICES) as unknown as SpeechSynthesis, Utterance: FakeUtterance as unknown as typeof SpeechSynthesisUtterance,
      storage: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } });
    expect(broken.getState().settings).toEqual(DEFAULT_SPEECH_SETTINGS);
    expect(() => broken.setSettings({ rate: 1 })).not.toThrow();
  });

  it('clamps nonsense settings and reports no support without a synthesizer', () => {
    const { engine } = mkEngine();
    engine.setSettings({ rate: 99, pitch: -3 });
    expect(engine.getState().settings.rate).toBeLessThanOrEqual(1.5);
    expect(engine.getState().settings.pitch).toBeGreaterThanOrEqual(0.7);
    const none = new SpeechEngine({ synth: null, Utterance: undefined, storage: null });
    expect(none.getState().supported).toBe(false);
    none.speak(SEGS, 'x');
    expect(none.getState().status).toBe('idle');
  });

  it('picks voices up when the browser loads them late', () => {
    const synth = new FakeSynth([]);
    const engine = new SpeechEngine({ synth: synth as unknown as SpeechSynthesis, Utterance: FakeUtterance as unknown as typeof SpeechSynthesisUtterance, storage: null });
    expect(engine.getState().hebrewVoices).toHaveLength(0);
    synth.voices = [{ ...V('Carmit', 'he-IL', true), default: false }];
    vi.advanceTimersByTime(700);
    expect(engine.getState().hebrewVoices.map((v) => v.name)).toEqual(['Carmit']);
    expect(engine.getState().activeVoice?.name).toBe('Carmit');
  });
});
