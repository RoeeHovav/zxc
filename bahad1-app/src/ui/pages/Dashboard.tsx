import { Link } from 'react-router-dom';
import { todayStr } from '../../domain/dates';
import { dueCount, topicStats, weakTopics } from '../../domain/review';
import { nextGuidedLesson } from '../../domain/mastery';
import { ACHIEVEMENTS } from '../../domain/xp';
import { useApp } from '../../app/store';
import { Num, Progress, pct, useChapters } from '../components/common';

export function Dashboard() {
  const app = useApp();
  const { manifest, statuses, orderedLessonIds, lessonStates, stats, lastPosition, lessonTitle, streak, rank, xp, exams, achievements, activityToday } = app;
  const { loading } = useChapters(null);
  const total = orderedLessonIds.length;
  const mastered = orderedLessonIds.filter((id) => lessonStates[id]?.masteredAt).length;
  const next = nextGuidedLesson(orderedLessonIds, statuses);
  const resume = lastPosition && orderedLessonIds.includes(lastPosition.lessonId) && !lessonStates[lastPosition.lessonId]?.masteredAt ? lastPosition : null;
  const target = resume?.lessonId ?? next;
  const chaptersDone = (manifest?.chapters ?? []).filter((c) => { const ids = c.lessons.map((l) => l.id).filter((id) => orderedLessonIds.includes(id)); return ids.length > 0 && ids.every((id) => lessonStates[id]?.masteredAt); }).length;
  const bankQs = app.bank;
  const seen = Object.values(stats).filter((s) => s.seen > 0).length;
  const recalled = Object.values(stats).filter((s) => s.box >= 2 && s.seen >= 2).length;
  const started = Object.values(lessonStates).filter((l) => l.stepsDone.length > 0 || l.masteredAt).length;
  const due = dueCount(stats, todayStr());
  const weak = weakTopics(topicStats(bankQs, stats)).slice(0, 3);
  const lastAch = ACHIEVEMENTS.filter((a) => achievements.includes(a.id)).slice(-3);
  const lessonStep = target ? lessonStates[target]?.stepIndex ?? 0 : 0;

  return (
    <div className="stack fade-in">
      <div className="card accent">
        <div className="row between">
          <div className="stack tight" style={{ flex: 1, minWidth: 240 }}>
            <span className="muted small">{resume ? 'המשך מהמקום שבו עצרת' : target ? 'השיעור המומלץ הבא' : 'אין שיעורים זמינים'}</span>
            <h1 style={{ margin: 0 }}>{target ? lessonTitle(target) : total === 0 ? 'עדיין אין תוכן מאומת' : 'סיימת את כל המסלול המודרך 🎉'}</h1>
            {target && <span className="muted">שיעור {orderedLessonIds.indexOf(target) + 1} מתוך <Num>{total}</Num></span>}
          </div>
          {target && <Link to={`/lesson/${target}?step=${resume ? lessonStep : 0}`} className="btn primary big" data-testid="resume">{resume ? 'המשך ללמוד' : 'התחלת השיעור'}</Link>}
        </div>
      </div>

      <div className="grid cols-4">
        <div className="card kpi"><span className="v"><Num>{mastered}</Num><span className="muted small"> / <Num>{total}</Num></span></span><span className="l">שיעורים שנשלטו ב-100%</span></div>
        <div className="card kpi"><span className="v"><Num>{chaptersDone}</Num><span className="muted small"> / <Num>{manifest?.chapters.length ?? 0}</Num></span></span><span className="l">פרקים שהושלמו</span></div>
        <div className="card kpi"><span className="v"><Num>{streak.current}</Num></span><span className="l">ימים ברצף (שיא: <Num>{streak.longest}</Num>)</span></div>
        <div className="card kpi"><span className="v"><Num>{xp}</Num></span><span className="l">נקודות ניסיון · דרגה: {rank.name}</span></div>
      </div>

      <div className="grid cols-2">
        <div className="card stack">
          <h3>חזרה יומית</h3>
          <p style={{ margin: 0 }}>{due > 0 ? <>יש <Num>{due}</Num> שאלות שמחכות לחזרה היום.</> : 'אין כרגע שאלות שמחכות לחזרה.'}</p>
          <div className="row"><Link to="/review" className="btn primary">לחזרה יומית</Link><span className="muted small">היום נענו <Num>{activityToday.answered}</Num> שאלות</span></div>
        </div>
        <div className="card stack">
          <h3>נושאים חלשים</h3>
          {loading && bankQs.length === 0 ? <span className="muted">טוען…</span> : weak.length === 0 ? <span className="muted">אין עדיין מספיק נתונים כדי לזהות נושאים חלשים.</span> : (
            <ul className="list-plain">{weak.map((t) => <li key={t.key} className="row between"><span>{t.topic}</span><span className="chip bad">דיוק ראשוני {pct(t.accuracy)}</span></li>)}</ul>
          )}
          <Link to="/review" className="btn">אתגר חולשות</Link>
        </div>
      </div>

      <div className="card stack">
        <h3>התקדמות בחומר</h3>
        <div className="stack tight">
          <div className="row between"><span>שיעורים שהתחלת</span><span><Num>{started}</Num> מתוך <Num>{total}</Num></span></div><Progress value={total ? started / total : 0} />
          <div className="row between"><span>שאלות שתורגלו (מתוך הבנק המאומת)</span><span><Num>{seen}</Num> מתוך <Num>{bankQs.length || manifest?.stats.verifiedQuestions || 0}</Num></span></div><Progress value={bankQs.length ? seen / bankQs.length : 0} />
          <div className="row between"><span>שיעורים שנשלטו ב-100%</span><span><Num>{mastered}</Num> מתוך <Num>{total}</Num></span></div><Progress value={total ? mastered / total : 0} gold />
          <div className="row between"><span>שאלות שנזכרו שוב בהצלחה, באופן עצמאי, בהמשך</span><Num>{recalled}</Num></div><Progress value={seen ? recalled / seen : 0} />
        </div>
        <p className="muted small" style={{ margin: 0 }}>שליטה ב-100% מעידה על הביצועים במבחן השליטה בלבד – היא אינה הוכחה שהחומר לא יישכח, ולכן החזרות היומיות חשובות.</p>
      </div>

      <div className="grid cols-2">
        <div className="card stack">
          <h3>מבחנים אחרונים</h3>
          {exams.length === 0 ? <span className="muted">עדיין לא בוצעה סימולציית מבחן.</span> : (
            <ul className="list-plain">{[...exams].reverse().slice(0, 3).map((e) => <li key={e.id} className="row between"><span className="muted">{new Date(e.ts).toLocaleDateString('he-IL')}</span><span className="chip accent"><Num>{e.percent}%</Num> · <Num>{e.correct}/{e.total}</Num></span></li>)}</ul>
          )}
          <Link to="/exam" className="btn">למבחן</Link>
        </div>
        <div className="card stack">
          <h3>הישגים</h3>
          {lastAch.length === 0 ? <span className="muted">עדיין לא הושגו הישגים.</span> : <ul className="list-plain">{lastAch.map((a) => <li key={a.id}>🏅 <b>{a.title}</b> <span className="muted small">— {a.description}</span></li>)}</ul>}
          <div className="muted small">דרגה: <b>{rank.name}</b>{rank.next && <> · עוד <Num>{rank.next.xp - xp}</Num> נק׳ לדרגת {rank.next.name}</>}</div>
          <Progress value={rank.progress} gold />
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'center' }}>
        <Link to="/library" className="btn ghost">עיון חופשי בכל החומר</Link>
        <Link to="/content-review" className="btn ghost">לוח בקרת מקורות</Link>
      </div>
    </div>
  );
}
