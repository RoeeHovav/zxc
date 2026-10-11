import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../app/store';
import { Num, Progress } from '../components/common';

export function Guided() {
  const { manifest, statuses, lessonStates, orderedLessonIds } = useApp();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!manifest) return null;
  const chapters = [...manifest.chapters].sort((a, b) => a.order - b.order);
  const hasHidden = manifest.chapters.some((c) => c.lessons.some((l) => !orderedLessonIds.includes(l.id)));
  return (
    <div className="stack fade-in">
      <div>
        <h1>לימוד מודרך</h1>
        <p className="muted">עוברים על החוברת לפי הסדר. שיעור נחשב <b>נשלט</b> רק אם במבחן השליטה שלו ענית נכון על <b>כל</b> השאלות, ללא רמזים וללא ניסיון שני — 100% בלבד. אחרי שליטה נפתח השיעור הבא במסלול. שימו לב: גם שיעור נעול פתוח תמיד ללימוד ולתרגול חופשי.</p>
      </div>
      {chapters.map((c, ci) => {
        const ids = c.lessons.map((l) => l.id).filter((id) => orderedLessonIds.includes(id));
        const done = ids.filter((id) => lessonStates[id]?.masteredAt).length;
        const isOpen = open[c.id] ?? (ci === 0 || ids.some((id) => statuses[id] === 'available'));
        return (
          <section key={c.id} className="card stack" aria-label={c.title}>
            <div className="chapter-head" onClick={() => setOpen({ ...open, [c.id]: !isOpen })} role="button" tabIndex={0} aria-expanded={isOpen}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen({ ...open, [c.id]: !isOpen }); } }}>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0 }}>{c.title}</h2>
                <span className="muted small">עמודים <Num>{c.firstPage}–{c.lastPage}</Num> · <Num>{done}</Num> מתוך <Num>{ids.length}</Num> שיעורים נשלטו</span>
              </div>
              <span aria-hidden>{isOpen ? '▾' : '◂'}</span>
            </div>
            <Progress value={ids.length ? done / ids.length : 0} gold />
            {isOpen && (
              <div className="stack tight">
                {c.lessons.filter((l) => orderedLessonIds.includes(l.id)).map((l, i) => {
                  const st = statuses[l.id];
                  const ls = lessonStates[l.id];
                  return (
                    <div key={l.id} className={`lesson-row ${st}`} data-testid={`lesson-${l.id}`} data-status={st}>
                      <span className="ico" aria-hidden>{st === 'mastered' ? '✓' : st === 'locked' ? '🔒' : i + 1}</span>
                      <div className="t">
                        <b>{l.title}</b>
                        <span className="muted small">עמודים <Num>{l.pages[0]}{l.pages[1] !== l.pages[0] ? `–${l.pages[1]}` : ''}</Num>
                          {ls?.attempts ? <> · ניסיונות שליטה: <Num>{ls.attempts}</Num> · שיא <Num>{Math.round(ls.bestScore * 100)}%</Num></> : null}</span>
                      </div>
                      <span className={`chip ${st === 'mastered' ? 'ok' : st === 'available' ? 'accent' : ''}`}>{st === 'mastered' ? 'נשלט 100%' : st === 'available' ? 'זמין' : 'נעול במסלול'}</span>
                      <Link to={`/lesson/${l.id}`} className="btn">{st === 'locked' ? 'לימוד חופשי' : 'פתיחה'}</Link>
                      {st !== 'locked' && <Link to={`/assess/${l.id}`} className="btn primary">מבחן שליטה</Link>}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
      {hasHidden && <p className="muted small">חלק מהשיעורים עדיין אינם מוצגים במסלול המודרך כי טרם עברו אימות מול החוברת. ניתן לעיין בהם בלוח בקרת המקורות.</p>}
    </div>
  );
}
