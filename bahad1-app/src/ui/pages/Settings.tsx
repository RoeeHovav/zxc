import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/store';
import { buildBackup, restoreBackup, validateBackup, type BackupCheck, type BackupFile } from '../../storage/backup';
import type { BackupSnapshot } from '../../storage/db';
import { Num } from '../components/common';

export function Settings() {
  const app = useApp();
  const { store, prefs, manifest } = app;
  const [check, setCheck] = useState<{ check: BackupCheck; file?: BackupFile; name: string } | null>(null);
  const [snaps, setSnaps] = useState<BackupSnapshot[]>([]);
  const [flags, setFlags] = useState<number>(0);
  const [lastExport, setLastExport] = useState<string>('');
  const [msg, setMsg] = useState('');
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cv = manifest?.contentVersion ?? '';

  const reload = async () => {
    if (!store) return;
    setSnaps((await store.snapshots()).reverse());
    setFlags((await store.allFlags()).length);
    setLastExport(await store.getMeta<string>('lastExport', ''));
  };
  useEffect(() => { reload(); navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [store]);

  const doExport = async () => {
    const file = await buildBackup(store!, cv);
    const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bahad1-progress-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    await store!.setMeta('lastExport', new Date().toISOString());
    setMsg('הגיבוי נשמר כקובץ. שמרו אותו במקום בטוח (למשל בענן או בכונן חיצוני).');
    reload();
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const text = await f.text();
    setCheck({ ...validateBackup(text, cv), name: f.name });
  };
  const doRestore = async (file: BackupFile) => {
    if (!window.confirm('השחזור יחליף את כל ההתקדמות הנוכחית בדפדפן הזה. נשמר גיבוי ביטחון אוטומטי של המצב הנוכחי. להמשיך?')) return;
    await restoreBackup(store!, file, cv);
    await app.refresh();
    setCheck(null); setMsg('השחזור הושלם בהצלחה.'); reload();
  };
  const [wipe, setWipe] = useState('');
  const daysSince = lastExport ? Math.floor((Date.now() - new Date(lastExport).getTime()) / 86400000) : null;

  return (
    <div className="stack fade-in narrow">
      <h1>הגדרות</h1>
      <div className="card stack"><h2>תצוגה</h2>
        <label className="field">ערכת נושא<select className="text-in" value={prefs.theme} onChange={(e) => app.setPrefs({ ...prefs, theme: e.target.value as typeof prefs.theme })}><option value="system">לפי המערכת</option><option value="light">בהירה</option><option value="dark">כהה</option></select></label>
        <label className="field">גודל טקסט<select className="text-in" value={prefs.fontScale} onChange={(e) => app.setPrefs({ ...prefs, fontScale: Number(e.target.value) })}><option value={0.9}>קטן</option><option value={1}>רגיל</option><option value={1.12}>גדול</option><option value={1.25}>גדול מאוד</option></select></label>
        <label className="field">גודל חזרה יומית (שאלות)<select className="text-in" value={prefs.dailyReviewSize} onChange={(e) => app.setPrefs({ ...prefs, dailyReviewSize: Number(e.target.value) })}>{[10, 15, 20, 30, 40].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      </div>

      <div className="card stack" data-testid="backup-card"><h2>גיבוי ושחזור התקדמות</h2>
        <p className="muted">ההתקדמות נשמרת רק בדפדפן הזה, במכשיר הזה (אין סנכרון בין מכשירים). כדי לא לאבד אותה — או כדי להעביר אותה למחשב/טלפון אחר — ייצאו קובץ גיבוי ושחזרו אותו שם.</p>
        {daysSince === null ? <span className="chip warn">עדיין לא נוצר קובץ גיבוי</span> : <span className={`chip ${daysSince > 7 ? 'warn' : 'ok'}`}>גיבוי אחרון לפני <Num>{daysSince}</Num> ימים</span>}
        {persisted === false && <span className="muted small">הדפדפן עשוי למחוק נתונים אם נגמר המקום; מומלץ לגבות לעתים קרובות.</span>}
        <div className="row"><button className="btn primary" type="button" onClick={doExport} data-testid="export">ייצוא גיבוי (קובץ JSON)</button>
          <button className="btn" type="button" onClick={() => fileRef.current?.click()}>ייבוא מקובץ…</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} data-testid="import-input" /></div>
        {msg && <div className="feedback ok" role="status">{msg}</div>}
        {check && (
          <div className={`feedback ${check.check.ok ? 'ok' : 'bad'}`} data-testid="import-check">
            <h3>{check.check.ok ? `הקובץ תקין: ${check.name}` : 'הקובץ אינו תקין ולא ייובא'}</h3>
            {check.check.errors.map((e) => <div key={e}>• {e}</div>)}
            {check.check.warnings.map((e) => <div key={e} className="muted">⚠ {e}</div>)}
            {check.check.summary && <ul><li>שיעורים שנשלטו: <Num>{check.check.summary.masteredLessons}</Num></li><li>שאלות עם היסטוריה: <Num>{check.check.summary.questionStats}</Num></li><li>מבחני שליטה: <Num>{check.check.summary.assessments}</Num> · מבחנים: <Num>{check.check.summary.exams}</Num></li><li>נקודות ניסיון: <Num>{check.check.summary.xp}</Num></li><li>נוצר ב: {new Date(check.check.summary.exportedAt).toLocaleString('he-IL')}</li></ul>}
            {check.check.ok && check.file && <button className="btn danger" type="button" onClick={() => doRestore(check.file!)} data-testid="restore">שחזור – החלפת ההתקדמות הנוכחית</button>}
          </div>
        )}
        <details><summary>הוראות שחזור</summary><ol><li>פתחו את האפליקציה בדפדפן שבו תרצו להמשיך.</li><li>הגדרות ← ״ייבוא מקובץ״ ובחרו את קובץ הגיבוי.</li><li>בדקו את הסיכום שמוצג ולחצו על ״שחזור״. מצב ההתקדמות הקודם נשמר אוטומטית כגיבוי ביטחון.</li></ol></details>
      </div>

      <div className="card stack"><h2>גיבויי ביטחון אוטומטיים</h2>
        <p className="muted small">נשמרים בדפדפן (עד 5): גיבוי יומי וגיבוי לפני כל שחזור. הם אינם מחליפים קובץ גיבוי חיצוני.</p>
        {snaps.length === 0 ? <span className="muted">עדיין אין.</span> : <ul className="list-plain">{snaps.map((s) => { const v = validateBackup(s.payload, cv); return <li key={s.id} className="row between"><span>{new Date(s.ts).toLocaleString('he-IL')} · {s.reason === 'before-restore' ? 'לפני שחזור' : 'יומי'}</span>{v.check.ok && v.file && <button className="btn" type="button" onClick={() => doRestore(v.file!)}>שחזור</button>}</li>; })}</ul>}
      </div>

      <div className="card stack"><h2>דיווחי שגיאת בדיקה</h2><p className="muted">דיווחתם על <Num>{flags}</Num> שאלות שבהן נראה לכם שהבדיקה שגויה. מפתח התשובות לא משתנה בשקט; הדיווחים נשמרים ומיוצאים עם הגיבוי לבדיקה אנושית.</p></div>

      <div className="card stack"><h2>על האפליקציה</h2>
        <ul><li>גרסת תוכן: <span className="num">{cv}</span> · {manifest?.stats.lessons} שיעורים · {manifest?.stats.verifiedQuestions} שאלות מאומתות</li>
          <li>האפליקציה פועלת מקומית, ללא תלות ב-AI או בשירותי ענן. אין סנכרון בין מכשירים.</li><li>כל החומר נגזר מהחוברת הרשמית בלבד; אין להפיץ אותו ללא הרשאה.</li></ul></div>

      <div className="card stack"><h2>איפוס</h2>
        <p className="muted">מחיקת כל ההתקדמות בדפדפן הזה. מומלץ לייצא גיבוי קודם. הקלידו ״מחיקה״ כדי לאשר.</p>
        <div className="row"><input className="text-in" style={{ maxWidth: 200 }} value={wipe} onChange={(e) => setWipe(e.target.value)} aria-label="אישור מחיקה" /><button className="btn danger" type="button" disabled={wipe !== 'מחיקה'} onClick={async () => { await store!.addSnapshot({ ts: Date.now(), reason: 'before-reset', payload: JSON.stringify(await buildBackup(store!, cv)) }); await store!.wipeData(); await app.refresh(); setWipe(''); setMsg('ההתקדמות נמחקה. נשמר גיבוי ביטחון אחרון.'); reload(); }}>מחיקת כל ההתקדמות</button></div></div>
    </div>
  );
}
