import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { addDays, todayStr } from '../../domain/dates';
import { MEMORY_MIN_PAIRS, TAP_CATEGORY_LABEL, buildMemoryRound, dailyDeck, dailyStreak, flashDeck, tapDeck, type MemoryRound, type TapCategory } from '../../domain/games';
import { correctAnswerText } from '../../domain/grade';
import type { Question } from '../../domain/types';
import { useApp } from '../../app/store';
import { Num, fmtTime, pct, useChapters } from '../components/common';
import { Flashcards } from '../games/Flashcards';
import { MemoryGame, type MemoryResult } from '../games/MemoryGame';
import { QuizGame, type QuizMode, type QuizResult } from '../games/QuizGame';
import { SourceModal } from '../components/SourceModal';
import type { FlashCard } from '../../domain/games';

type Run =
  | { kind: 'quiz'; mode: QuizMode; deck: Question[]; seed: string; seconds?: number; lives?: number; recordKey: string; official: boolean; label: string }
  | { kind: 'memory'; round: MemoryRound; recordKey: string }
  | { kind: 'flash'; deck: FlashCard[] };
type End = { kind: 'quiz'; run: Extract<Run, { kind: 'quiz' }>; result: QuizResult; record: boolean } | { kind: 'memory'; run: Extract<Run, { kind: 'memory' }>; result: MemoryResult; record: boolean };

const SECONDS = [60, 90, 120];

export function GamesPage() {
  const app = useApp();
  const { manifest, bank, store } = app;
  const { loading } = useChapters(null);
  const [run, setRun] = useState<Run | null>(null);
  const [end, setEnd] = useState<End | null>(null);
  const [scope, setScope] = useState('');
  const [secs, setSecs] = useState(60);
  const [cat, setCat] = useState<TapCategory>('all');
  const [pairs, setPairs] = useState(6);
  const [records, setRecords] = useState<Record<string, number>>({});
  const [src, setSrc] = useState<Question | null>(null);
  const today = todayStr();

  const reloadRecords = useCallback(() => { store?.allRecords().then((r) => setRecords(Object.fromEntries(r.map((x) => [x.id, x.value])))).catch(() => {}); }, [store]);
  useEffect(() => { reloadRecords(); }, [reloadRecords, end]);

  const chapters = useMemo(() => (scope ? [scope] : []), [scope]);
  const tapCount = useMemo(() => tapDeck(bank, { chapters, category: cat, seed: 'count' }).length, [bank, chapters, cat]);
  const flashCount = useMemo(() => flashDeck(bank, { chapters, seed: 'count' }).length, [bank, chapters]);
  const memoryOk = useMemo(() => buildMemoryRound(bank, { chapters, seed: 'count', pairs: MEMORY_MIN_PAIRS }) !== null, [bank, chapters]);
  const playedDays = useMemo(() => Object.keys(records).filter((k) => k.startsWith('daily-')).map((k) => k.slice(6)), [records]);
  const streak = dailyStreak(playedDays, today, (d) => addDays(d, -1));
  const dailyDone = records[`daily-${today}`];

  const seed = () => `${Date.now()}`;
  const startBlitz = () => setRun({ kind: 'quiz', mode: 'blitz', deck: tapDeck(bank, { chapters, category: cat, seed: seed() }), seed: seed(), seconds: secs, recordKey: `blitz-${secs}s-${cat}`, official: true, label: 'ברק' });
  const startSurvival = () => setRun({ kind: 'quiz', mode: 'survival', deck: tapDeck(bank, { chapters, category: 'all', seed: seed() }), seed: seed(), lives: 3, recordKey: 'survival-best-streak', official: true, label: 'הישרדות' });
  const startDaily = () => setRun({ kind: 'quiz', mode: 'daily', deck: dailyDeck(bank, today), seed: `daily|${today}`, recordKey: `daily-${today}`, official: dailyDone === undefined, label: 'אתגר יומי' });
  const startMemory = () => { const round = buildMemoryRound(bank, { chapters, seed: seed(), pairs }); if (round) setRun({ kind: 'memory', round, recordKey: `memory-${round.pairs.length}-moves` }); };
  const startFlash = () => setRun({ kind: 'flash', deck: flashDeck(bank, { chapters, seed: seed() }) });

  const onQuizEnd = useCallback(async (r: QuizResult) => {
    if (!run || run.kind !== 'quiz' || !store) return;
    let record = false;
    try {
      if (run.mode === 'survival') record = r.bestCombo > 0 && await store.setRecord(run.recordKey, r.bestCombo);
      else if (run.mode === 'blitz') record = r.score > 0 && await store.setRecord(run.recordKey, r.score);
      else if (run.official) await store.setRecord(run.recordKey, r.score); // the first play of the day is the official one (no "record" chip for it)
    } catch { /* records are a bonus */ }
    setEnd({ kind: 'quiz', run, result: r, record });
    setRun(null);
  }, [run, store]);
  const onMemoryEnd = useCallback(async (r: MemoryResult) => {
    if (!run || run.kind !== 'memory' || !store) return;
    let record = false;
    try { record = await store.setRecord(run.recordKey, r.moves, false); } catch { /* ignore */ }
    setEnd({ kind: 'memory', run, result: r, record });
    setRun(null);
  }, [run, store]);
  const quit = useCallback(() => { setRun(null); }, []);

  if (run?.kind === 'quiz') return <QuizGame key={run.seed + run.mode} mode={run.mode} deck={run.deck} seed={run.seed} seconds={run.seconds} lives={run.lives} onEnd={onQuizEnd} onQuit={quit} />;
  if (run?.kind === 'memory') return <MemoryGame round={run.round} bank={bank} onEnd={onMemoryEnd} onQuit={quit} />;
  if (run?.kind === 'flash') return <Flashcards deck={run.deck} onQuit={quit} />;

  if (end?.kind === 'quiz') {
    const { result: r, run: ru } = end;
    return (
      <div className="stack fade-in narrow" data-testid="game-end">
        <div className="card stack center" style={{ alignItems: 'center' }}>
          <h2>{ru.label} – סיכום</h2>
          <div className="kpi"><span className="v" data-testid="end-score"><Num>{r.score}</Num></span><span className="l">נקודות</span></div>
          <div className="muted">נכון: <Num>{r.correct}</Num> מתוך <Num>{r.asked}</Num>{r.asked > 0 && <> ({pct(r.correct / r.asked)})</>} · רצף ארוך ביותר: <Num>{r.bestCombo}</Num>{r.xp > 0 && <> · <Num>{r.xp}</Num> נק׳ ניסיון</>}</div>
          {end.record && <span className="chip gold">🏆 שיא אישי חדש!</span>}
          {r.timedOut && <span className="muted small">הזמן נגמר</span>}
          <div className="row"><button className="btn primary" type="button" onClick={() => { setEnd(null); ru.mode === 'blitz' ? startBlitz() : ru.mode === 'survival' ? startSurvival() : startDaily(); }}>{ru.mode === 'daily' ? 'משחק חוזר (ללא שיא)' : 'עוד סיבוב'}</button><button className="btn" type="button" onClick={() => setEnd(null)}>חזרה למשחקים</button></div>
        </div>
        {r.wrong.length > 0 && (
          <div className="card stack" data-testid="end-wrong">
            <h3>כדאי לחזור על</h3>
            <p className="muted small" style={{ margin: 0 }}>השאלות האלה ייכנסו לחזרה היומית.</p>
            <ul className="list-plain">{r.wrong.map((q) => (
              <li key={q.id} className="stack tight" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                <span>{q.stem}</span><b>{correctAnswerText(q)}</b>
                <div><button className="btn ghost" type="button" onClick={() => setSrc(q)}>המקור בחוברת</button></div>
              </li>))}</ul>
          </div>
        )}
        {src && <SourceModal refs={src.refs} onClose={() => setSrc(null)} />}
      </div>
    );
  }
  if (end?.kind === 'memory') {
    const r = end.result;
    return (
      <div className="stack fade-in narrow" data-testid="game-end">
        <div className="card stack center" style={{ alignItems: 'center' }}>
          <h2>זיכרון – כל הזוגות נמצאו! 🧠</h2>
          <div className="kpi"><span className="v" data-testid="end-moves"><Num>{r.moves}</Num></span><span className="l">מהלכים · <Num>{fmtTime(r.ms)}</Num></span></div>
          {end.record && <span className="chip gold">🏆 שיא אישי חדש (הכי מעט מהלכים)!</span>}
          <div className="row"><button className="btn primary" type="button" onClick={() => { setEnd(null); startMemory(); }}>עוד סיבוב</button><button className="btn" type="button" onClick={() => setEnd(null)}>חזרה למשחקים</button></div>
        </div>
      </div>
    );
  }

  const none = !loading && bank.length === 0;
  return (
    <div className="stack fade-in" data-testid="games-hub">
      <div>
        <h1>משחקים</h1>
        <p className="muted">דרכים כיפיות לתרגל. כל המשחקים משתמשים רק בשאלות שאומתו מול החוברת, עם בדיקה קפדנית של תשובות. טעויות במשחק נכנסות לחזרה היומית, ותשובות נכונות עצמאיות מזכות בנקודות ניסיון.</p>
      </div>
      <label className="field" style={{ maxWidth: 320 }}>היקף החומר
        <select className="text-in" value={scope} onChange={(e) => setScope(e.target.value)} data-testid="games-scope">
          <option value="">כל הפרקים הפתוחים</option>
          {manifest?.chapters.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </label>
      {none && <div className="empty">עדיין אין שאלות מאומתות למשחקים.</div>}
      <div className="grid cols-2">
        <section className="card stack game-card" data-testid="card-daily">
          <h2>📅 אתגר יומי</h2>
          <p>עשר שאלות שמשתנות כל יום (אותן שאלות לכולם), עם הסבר אחרי כל תשובה. {streak > 0 && <b>רצף: <Num>{streak}</Num> ימים</b>}</p>
          {dailyDone !== undefined && <span className="chip ok" data-testid="daily-done">היום שיחקת: <Num>{dailyDone}</Num> נקודות</span>}
          <div><button className="btn primary" type="button" onClick={startDaily} disabled={bank.length === 0} data-testid="start-daily-game">{dailyDone !== undefined ? 'משחק חוזר' : 'התחלה'}</button></div>
        </section>

        <section className="card stack game-card" data-testid="card-blitz">
          <h2>⚡ ברק</h2>
          <p>לוחצים על התשובה ועוברים הלאה. רצף תשובות נכונות מכפיל את הניקוד. השעון רץ רק בזמן שאלה פתוחה.</p>
          <div className="row">
            <label className="field">משך<select className="text-in" value={secs} onChange={(e) => setSecs(Number(e.target.value))} data-testid="blitz-secs">{SECONDS.map((s) => <option key={s} value={s}>{s} שניות</option>)}</select></label>
            <label className="field">סוג<select className="text-in" value={cat} onChange={(e) => setCat(e.target.value as TapCategory)} data-testid="blitz-cat">{(Object.keys(TAP_CATEGORY_LABEL) as TapCategory[]).map((k) => <option key={k} value={k}>{TAP_CATEGORY_LABEL[k]}</option>)}</select></label>
          </div>
          <span className="muted small">שיא: {records[`blitz-${secs}s-${cat}`] !== undefined ? <Num>{records[`blitz-${secs}s-${cat}`]}</Num> : 'עדיין אין'} · <Num>{tapCount}</Num> שאלות זמינות</span>
          <div><button className="btn primary" type="button" onClick={startBlitz} disabled={tapCount === 0} data-testid="start-blitz">התחלה</button></div>
        </section>

        <section className="card stack game-card" data-testid="card-survival">
          <h2>❤️ הישרדות</h2>
          <p>שלושה חיים. כל טעות עולה בחיים, והשאלות נעשות קשות יותר ככל שהרצף שלכם ארוך יותר. כמה רחוק תגיעו?</p>
          <span className="muted small">רצף שיא: {records['survival-best-streak'] !== undefined ? <Num>{records['survival-best-streak']}</Num> : 'עדיין אין'}</span>
          <div><button className="btn primary" type="button" onClick={startSurvival} disabled={tapCount === 0} data-testid="start-survival">התחלה</button></div>
        </section>

        <section className="card stack game-card" data-testid="card-memory">
          <h2>🧠 זיכרון</h2>
          <p>הופכים שני קלפים ומחפשים זוגות: מושג והפרט שמתאים לו לפי החוברת. אחרי כל זוג אפשר לפתוח את המקור.</p>
          <label className="field" style={{ maxWidth: 200 }}>מספר זוגות<select className="text-in" value={pairs} onChange={(e) => setPairs(Number(e.target.value))} data-testid="memory-pairs">{[4, 6, 8].map((n) => <option key={n} value={n}>{n} זוגות</option>)}</select></label>
          <span className="muted small">שיא (הכי מעט מהלכים): {records[`memory-${pairs}-moves`] !== undefined ? <Num>{records[`memory-${pairs}-moves`]}</Num> : 'עדיין אין'}</span>
          {!memoryOk && !none && <span className="muted small">אין עדיין מספיק זוגות מאומתים להיקף שבחרתם.</span>}
          <div><button className="btn primary" type="button" onClick={startMemory} disabled={!memoryOk} data-testid="start-memory">התחלה</button></div>
        </section>

        <section className="card stack game-card" data-testid="card-flash">
          <h2>🗂️ כרטיסיות</h2>
          <p>חושבים על התשובה, הופכים ובודקים. מה שלא ידעתם חוזר בהמשך הסבב. בלי ציון ובלי לחץ – כלי להכרת החומר.</p>
          <span className="muted small"><Num>{flashCount}</Num> כרטיסים זמינים</span>
          <div><button className="btn primary" type="button" onClick={startFlash} disabled={flashCount === 0} data-testid="start-flash">התחלה</button></div>
        </section>

        <section className="card stack game-card">
          <h2>⏳ אתגר זמן</h2>
          <p>סולם קושי שעולה לפי הרצף, ושיאים אישיים. נמצא באזור "חזרה ואתגרים".</p>
          <div><Link to="/review" className="btn">לאתגר זמן</Link></div>
        </section>
      </div>
      {loading && <p className="muted small">טוען שאלות…</p>}
    </div>
  );
}
