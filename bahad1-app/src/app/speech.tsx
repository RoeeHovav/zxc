import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { onlineVoiceAvailable, segmentsFromText, type SpeechSegment } from '../domain/speech';
import { RATE_MAX, RATE_MIN, speechEngine, type SpeechState } from './speechEngine';
import { Modal } from '../ui/components/Modal';

export function useSpeech(): SpeechState {
  return useSyncExternalStore(speechEngine.subscribe, speechEngine.getState, speechEngine.getState);
}
/** Wraps on-screen text so that it is highlighted (and kept in view) while it is being read aloud. */
export function Speakable({ id, as: Tag = 'span', className = '', children, ...rest }: { id: string; as?: 'span' | 'div' | 'p' | 'li' | 'h2' | 'figcaption'; className?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
  const on = useReadingBlock(id);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (on) ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }, [on]);
  const T = Tag as 'span';
  return <T ref={ref as React.RefObject<HTMLSpanElement>} className={`${className}${on ? ' speaking' : ''}`.trim() || undefined} data-speaking={on ? 'true' : undefined} {...rest}>{children}</T>;
}

/** true while the on-screen block with this id is the one being read (used to highlight it) */
export function useReadingBlock(blockId: string): boolean {
  return useSyncExternalStore(speechEngine.subscribe, () => speechEngine.getState().activeBlockId === blockId, () => false);
}

const INSTALL_HELP = (
  <ul className="small">
    <li><b>Windows 11 / Edge:</b> הגדרות ← זמן ושפה ← דיבור ← ״הוספת קולות״ ← עברית (הקולות ״Natural״ נשמעים טבעיים במיוחד).</li>
    <li><b>Android / Chrome:</b> הגדרות ← מערכת ← שפות ← פלט טקסט לדיבור ← Google ← התקנת נתוני קול ← עברית.</li>
    <li><b>iPhone / iPad:</b> הגדרות ← נגישות ← תוכן מדובר ← קולות ← עברית (Carmit) והורדת הגרסה המשופרת.</li>
    <li><b>Mac:</b> הגדרות המערכת ← נגישות ← תוכן מדובר ← קול מערכת ← ניהול קולות ← עברית.</li>
  </ul>
);

/** Explains why nothing can be read and what to do — only shown when the learner actually asks for speech. */
export function VoiceHelp({ onClose }: { onClose: () => void }) {
  const sp = useSpeech();
  const online = onlineVoiceAvailable(sp.voices) && !sp.settings.allowOnline;
  return (
    <Modal title="הקראה בקול" onClose={onClose}>
      <div className="stack" data-testid="voice-help">
        {!sp.supported ? <p>הדפדפן הזה אינו תומך בהקראה. אפשר לנסות את Chrome, Edge או Safari העדכניים.</p> : (
          <>
            <p>{online ? 'במכשיר הזה יש קול עברי מקוון בלבד. קולות מקוונים נשמעים לרוב טבעיים יותר, אבל הטקסט המוקרא נשלח לספק הקול של הדפדפן או של מערכת ההפעלה.' : 'לא נמצא במכשיר הזה קול עברי להקראה.'}</p>
            {online && <div className="row"><button className="btn primary" type="button" data-testid="enable-online" onClick={() => { speechEngine.setSettings({ allowOnline: true }); onClose(); }}>להפעיל קולות מקוונים</button></div>}
            <p>התקנת קול עברי (חד־פעמי):</p>
            {INSTALL_HELP}
            <p className="muted small">אחרי ההתקנה יש לרענן את הדף. אפשר לשנות את הקול, המהירות והגובה בהגדרות ← הקראה בקול.</p>
          </>
        )}
      </div>
    </Modal>
  );
}

export interface ReadAloudProps {
  /** unique id of this reader; the button toggles play/stop for it */
  owner: string;
  build: () => SpeechSegment[];
  label?: string;
  icon?: string;
  /** icon-only button */
  compact?: boolean;
  /** start reading when the component appears, if the learner turned on auto-read */
  auto?: boolean;
  className?: string;
  testId?: string;
}

export function ReadAloud({ owner, build, label = 'הקראה', icon = '🔊', compact, auto, className = '', testId }: ReadAloudProps) {
  const sp = useSpeech();
  const [help, setHelp] = useState(false);
  const buildRef = useRef(build);
  buildRef.current = build;
  const playing = sp.ownerId === owner && sp.status !== 'idle';

  const start = () => {
    if (!sp.supported || (!sp.activeVoice && sp.voices.length > 0 && sp.hebrewVoices.length === 0) || (!sp.activeVoice && onlineVoiceAvailable(sp.voices))) { setHelp(true); return; }
    speechEngine.speak(buildRef.current(), owner);
  };
  const toggle = () => (playing ? speechEngine.stop() : start());

  // auto-read: only when the learner enabled it and a usable voice exists (never nags with dialogs)
  useEffect(() => {
    const s = speechEngine.getState();
    const listeningAll = !!s.ownerId?.startsWith('lessonall:') && s.status !== 'idle';
    if (auto && s.settings.autoRead && s.supported && s.activeVoice && !listeningAll) {
      const id = window.setTimeout(() => speechEngine.speak(buildRef.current(), owner), 250);
      return () => { window.clearTimeout(id); speechEngine.stopIfOwner(owner); };
    }
    return () => speechEngine.stopIfOwner(owner);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, auto]);

  if (!sp.supported) return null;
  return (
    <>
      <button type="button" className={`btn read-aloud${compact ? ' compact' : ''}${playing ? ' on' : ''} ${className}`.trim()} onClick={toggle} aria-pressed={playing}
        aria-label={playing ? 'עצירת ההקראה' : label} title={playing ? 'עצירת ההקראה' : label} data-testid={testId ?? 'read-aloud'}>
        <span aria-hidden>{playing ? '■' : icon}</span>{!compact && <span>{playing ? 'עצירה' : label}</span>}
      </button>
      {help && <VoiceHelp onClose={() => setHelp(false)} />}
    </>
  );
}

/** Plain-text convenience for passages (source text etc.). */
export const textSegments = (text: string, blockId?: string): SpeechSegment[] => segmentsFromText(text, { blockId });

/** The floating mini player: visible only while something is being read. One compact row, also on a phone. */
const SPEEDS = [0.75, 0.85, 0.95, 1.05, 1.2, 1.35];
export function SpeechBar() {
  const sp = useSpeech();
  if (!sp.supported || sp.status === 'idle') return null;
  const paused = sp.status === 'paused';
  const r = sp.settings.rate;
  const cycle = () => { speechEngine.setSettings({ rate: SPEEDS.find((x) => x > r + 0.001) ?? SPEEDS[0] }); speechEngine.restartCurrent(); };
  return (
    <div className="speech-bar" role="region" aria-label="נגן הקראה" data-testid="speech-bar">
      <span className="ctrls">
        <button type="button" className="icon-btn" aria-label="משפט קודם" onClick={() => speechEngine.prev()} data-testid="speech-prev">⏮</button>
        <button type="button" className="icon-btn primary" aria-label={paused ? 'המשך הקראה' : 'השהיית ההקראה'} onClick={() => (paused ? speechEngine.resume() : speechEngine.pause())} data-testid="speech-toggle">{paused ? '▶' : '⏸'}</button>
        <button type="button" className="icon-btn" aria-label="משפט הבא" onClick={() => speechEngine.next()} data-testid="speech-next">⏭</button>
        <button type="button" className="icon-btn" aria-label="עצירת ההקראה" onClick={() => speechEngine.stop()} data-testid="speech-stop">■</button>
      </span>
      <span className="small muted pos" aria-live="polite"><span aria-hidden>🔊 </span>{paused ? 'מושהה' : 'מקריא'} · <span className="num">{sp.index + 1}</span> מתוך <span className="num">{sp.total}</span></span>
      <button type="button" className="chip speed" aria-label={`מהירות ההקראה ${r.toFixed(2)}, לחיצה משנה`} title="שינוי מהירות" onClick={cycle} data-testid="speech-speed"><span className="num">{r.toFixed(2)}×</span></button>
    </div>
  );
}

const SAMPLE = 'שלום, כך תישמע ההקראה בשיעורים ובשאלות. אפשר לשנות את הקול ואת המהירות כאן בהגדרות, עד שהיא נשמעת לכם נוחה וטבעית.';

/** Settings card: voice, speed, pitch, online voices, auto-read, test, installation help. */
export function ReadAloudSettings() {
  const sp = useSpeech();
  const s = sp.settings;
  const [showHelp, setShowHelp] = useState(false);
  if (!sp.supported) {
    return <div className="card stack" data-testid="tts-settings"><h2>הקראה בקול</h2><p className="muted">הדפדפן הזה אינו תומך בהקראה. אפשר לנסות את Chrome, Edge או Safari העדכניים.</p></div>;
  }
  const test = () => speechEngine.speak(segmentsFromText(SAMPLE, { blockId: 'tts-test' }), 'tts-test');
  const playing = sp.ownerId === 'tts-test' && sp.status !== 'idle';
  const hv = sp.hebrewVoices;
  const voiceLabel = (v: (typeof hv)[number]) => `${v.name} — ${v.localService ? 'מקומי' : 'מקוון'}`;
  return (
    <div className="card stack" data-testid="tts-settings">
      <h2>הקראה בקול</h2>
      <p className="muted">האפליקציה מקריאה את כרטיסי הלימוד, את השאלות ואת הקטעים מהחוברת בקול עברי של המכשיר שלכם. אין שירות ענן של האפליקציה ואין בינה מלאכותית; איכות הקול תלויה בקולות שמותקנים אצלכם.</p>
      <div className="row">
        <span className={`chip ${hv.length ? 'ok' : 'warn'}`} data-testid="tts-voice-count">{hv.length ? `נמצאו ${hv.length} קולות עבריים` : 'לא נמצא קול עברי'}</span>
        {sp.activeVoice && <span className="chip" data-testid="tts-active-voice">קול פעיל: {sp.activeVoice.name} ({sp.activeVoice.localService ? 'מקומי' : 'מקוון'})</span>}
      </div>
      <label className="field">קול
        <select className="text-in" value={s.voiceURI ?? ''} onChange={(e) => { speechEngine.setSettings({ voiceURI: e.target.value || null }); speechEngine.restartCurrent(); }} data-testid="tts-voice">
          <option value="">אוטומטי – הקול הטבעי ביותר שמותר להשתמש בו</option>
          {hv.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{voiceLabel(v)}</option>)}
        </select>
      </label>
      <label className="check"><input type="checkbox" checked={s.allowOnline} onChange={(e) => { speechEngine.setSettings({ allowOnline: e.target.checked }); speechEngine.restartCurrent(); }} data-testid="tts-online" />
        <span>לאפשר קולות מקוונים (לרוב טבעיים יותר). <span className="muted small">הטקסט המוקרא נשלח לספק הקול של הדפדפן או של מערכת ההפעלה. כבוי כברירת מחדל.</span></span></label>
      <label className="field">מהירות: <span className="num">{s.rate.toFixed(2)}×</span>
        <input type="range" min={RATE_MIN} max={RATE_MAX} step={0.05} value={s.rate} onChange={(e) => speechEngine.setSettings({ rate: Number(e.target.value) })} onMouseUp={() => speechEngine.restartCurrent()} onTouchEnd={() => speechEngine.restartCurrent()} data-testid="tts-rate" /></label>
      <label className="field">גובה הקול: <span className="num">{s.pitch.toFixed(2)}</span>
        <input type="range" min={0.7} max={1.3} step={0.05} value={s.pitch} onChange={(e) => speechEngine.setSettings({ pitch: Number(e.target.value) })} data-testid="tts-pitch" /></label>
      <label className="check"><input type="checkbox" checked={s.autoRead} onChange={(e) => speechEngine.setSettings({ autoRead: e.target.checked })} data-testid="tts-auto" />
        <span>הקראה אוטומטית של כרטיסי הלימוד ושל השאלות <span className="muted small">(אפשר לעצור בכל רגע)</span></span></label>
      <div className="row">
        <button className="btn primary" type="button" onClick={() => (playing ? speechEngine.stop() : test())} data-testid="tts-test">{playing ? 'עצירה' : 'בדיקת קול'}</button>
        <button className="btn ghost" type="button" onClick={() => setShowHelp((x) => !x)}>איך מתקינים קול עברי טבעי?</button>
      </div>
      {onlineVoiceAvailable(sp.voices) && !s.allowOnline && <div className="muted small" data-testid="tts-online-hint">במכשיר יש גם קול עברי מקוון. הפעילו ״לאפשר קולות מקוונים״ כדי להשתמש בו.</div>}
      {showHelp && <div data-testid="tts-install-help">{INSTALL_HELP}</div>}
    </div>
  );
}
