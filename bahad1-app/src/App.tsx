import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { useApp } from './app/store';
import { Dashboard } from './ui/pages/Dashboard';
import { Guided } from './ui/pages/Guided';
import { LessonPage } from './ui/pages/Lesson';
import { AssessmentPage } from './ui/pages/Assessment';
import { PracticePage } from './ui/pages/Practice';
import { ExamPage } from './ui/pages/Exam';
import { ReviewHub } from './ui/pages/ReviewHub';
import { Library } from './ui/pages/Library';
import { Stats } from './ui/pages/Stats';
import { Settings } from './ui/pages/Settings';
import { ContentReview } from './ui/pages/ContentReview';

const NAV: { to: string; label: string; ico: string }[] = [
  { to: '/', label: 'בית', ico: '⌂' },
  { to: '/guided', label: 'לימוד מודרך', ico: '▶' },
  { to: '/practice', label: 'תרגול', ico: '✎' },
  { to: '/review', label: 'חזרה ואתגרים', ico: '↻' },
  { to: '/exam', label: 'מבחן', ico: '⏱' },
  { to: '/library', label: 'ספרייה', ico: '☰' },
  { to: '/stats', label: 'סטטיסטיקה', ico: '▤' },
  { to: '/settings', label: 'הגדרות', ico: '⚙' },
];
const TABS = ['/', '/guided', '/practice', '/review', '/settings'];

export function App() {
  const { ready, error, manifest } = useApp();
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand" aria-label="בה״ד 1 – דף הבית"><span className="logo" aria-hidden>★</span><span>בה״ד 1 · מרכז הלמידה</span></NavLink>
          <nav className="nav" aria-label="ניווט ראשי">
            {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>{n.label}</NavLink>)}
          </nav>
        </div>
      </header>
      <main className="container">
        {!ready ? <div className="empty">טוען…</div> : error && !manifest ? (
          <div className="card narrow"><h2>אין תוכן לימוד זמין</h2><p>{error}</p><p className="muted small">כדי ליצור את חבילת התוכן מהחוברת הרשמית יש להריץ את שלבי הפיתוח (ראו README).</p></div>
        ) : (
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/guided" element={<Guided />} />
            <Route path="/lesson/:id" element={<LessonPage />} />
            <Route path="/assess/:id" element={<AssessmentPage />} />
            <Route path="/practice" element={<PracticePage />} />
            <Route path="/exam" element={<ExamPage />} />
            <Route path="/review" element={<ReviewHub />} />
            <Route path="/library" element={<Library />} />
            <Route path="/library/:chapterId" element={<Library />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/content-review" element={<ContentReview />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>
      <nav className="tabbar" aria-label="ניווט תחתון">
        {NAV.filter((n) => TABS.includes(n.to)).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}><span className="ico" aria-hidden>{n.ico}</span><span>{n.label}</span></NavLink>
        ))}
      </nav>
    </div>
  );
}
