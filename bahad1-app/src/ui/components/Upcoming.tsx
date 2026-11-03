import { Link } from 'react-router-dom';
import { useApp } from '../../app/store';
import type { ManifestChapter } from '../../content/loader';
import { Num } from './common';

/** Chapters that are still being prepared: visible, clearly marked, and not openable. */
export function UpcomingChapters() {
  const { manifest } = useApp();
  const list = manifest?.upcoming ?? [];
  if (!list.length) return null;
  return (
    <section className="stack tight" aria-label="פרקים בהכנה" data-testid="upcoming">
      <h2 style={{ margin: 0 }}>בהכנה</h2>
      {list.map((c) => (
        <div key={c.id} className="card upcoming" aria-disabled="true" data-testid={`upcoming-${c.id}`}>
          <span className="ico" aria-hidden>🔒</span>
          <div className="stack tight" style={{ flex: 1 }}>
            <b>{c.title}</b>
            <span className="muted small">עמודים <Num>{c.firstPage}–{c.lastPage}</Num></span>
          </div>
          <span className="chip">עובדים על זה</span>
        </div>
      ))}
    </section>
  );
}

/** True when the authored lessons of an open chapter do not yet reach the whole chapter in the book. */
export function isPartial(c: ManifestChapter) { return !!c.progress && !c.progress.complete; }

/** Honest note for a chapter whose content is still being completed. */
export function PartialNote({ chapter }: { chapter: ManifestChapter }) {
  const pr = chapter.progress;
  if (!pr || pr.complete) return null;
  const reaches = pr.coveredThroughPage;
  const fullyAuthored = pr.coveredUnits === pr.requiredUnits;
  return (
    <p className="note small" style={{ margin: 0 }} data-testid={`partial-${chapter.id}`}>
      {fullyAuthored
        ? 'כל עמודי הפרק כבר בתוכן, אך חלק מהפריטים עדיין עוברים אימות מול החוברת – הם יופיעו כאן רק אחרי שיאומתו.'
        : <>הפרק עדיין בהכנה: כרגע התוכן מגיע עד עמוד <Num>{reaches ?? chapter.firstPage}</Num> מתוך <Num>{chapter.firstPage}–{chapter.lastPage}</Num>. שאר העמודים יתווספו כשיושלמו ויאומתו.</>}
    </p>
  );
}

export function ChapterMap() {
  const { manifest } = useApp();
  if (!manifest) return null;
  return (
    <div className="card stack" data-testid="book-map">
      <h3>מפת הספר</h3>
      <ul className="list-plain">
        {[...manifest.chapters].sort((a, b) => a.order - b.order).map((c) => (
          <li key={c.id} className="row between">
            <Link to={`/library/${c.id}`}>{c.title}</Link>
            <span className={`chip ${c.progress?.complete ? 'ok' : 'accent'}`}>{c.progress?.complete ? 'מלא' : 'זמין חלקית'}</span>
          </li>
        ))}
        {(manifest.upcoming ?? []).map((c) => (
          <li key={c.id} className="row between muted"><span>🔒 {c.title}</span><span className="chip">עובדים על זה</span></li>
        ))}
      </ul>
    </div>
  );
}
