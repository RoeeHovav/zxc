#!/usr/bin/env node
// Generates SYNTHETIC test content (an invented "kingdom of colours"; it contains NO book content and makes no factual claim)
// for the browser end-to-end tests:  node scripts/make-fixture.mjs   -> tests/fixtures/public/content/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests/fixtures/public/content');
fs.rmSync(OUT, { recursive: true, force: true });
for (const d of ['sources', 'figs', 'pages']) fs.mkdirSync(path.join(OUT, d), { recursive: true });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
fs.writeFileSync(path.join(OUT, 'figs/x1-f1.png'), PNG);
for (let p = 1; p <= 9; p++) fs.writeFileSync(path.join(OUT, `pages/p${String(p).padStart(3, '0')}.jpg`), JPG);

const V = (status = 'verified', verdict = 'pass') => ({ status, generatedBy: 'fixture', programmatic: { quotesFound: true, answerKeyValid: true, noExcludedSource: true }, independent: { verdict, by: 'fixture' } });
const units = [
  { id: 'p001.u01', page: 1, kind: 'paragraph', text: 'בממלכת הצבעים הדמיונית יש שלושה פסים בדגל: אדום, כחול וירוק. הממלכה הוקמה בשנת 1200 לפי ספר הבדיקות.' },
  { id: 'p002.u01', page: 2, kind: 'paragraph', text: 'מלך הצבעים הראשון נקרא אורן, והוא שלט שלושים שנה. אחריו שלט המלך נועם עשרים שנה.' },
  { id: 'p003.u01', page: 3, kind: 'paragraph', text: 'העיר הבירה של הממלכה נקראת צבעונית. בעיר שלוש שכונות: צפונית, דרומית ומזרחית.' },
  { id: 'p004.u01', page: 4, kind: 'paragraph', text: 'שלבי הכנת הצבע: ראשית טוחנים את הפיגמנט, אחר כך מערבבים עם מים ולבסוף מסננים.' },
  { id: 'p005.u01', page: 5, kind: 'paragraph', text: 'ארבעת הגילדות: הצבעים, האורגים, הצורפים והסופרים.' },
];
const R = (u, q) => ({ unit: u, page: Number(u.slice(1, 4)), quote: q });
const fact = (id, topic, s, refs) => ({ id: `x1.${id}`, chapter: 'x1', topic, kind: 'other', statement: s, refs, verification: V() });
const facts = [
  fact('f1', 'הדגל', 'בדגל הממלכה שלושה פסים: אדום, כחול וירוק.', [R('p001.u01', 'יש שלושה פסים בדגל: אדום, כחול וירוק')]),
  fact('f2', 'הדגל', 'הממלכה הוקמה בשנת 1200.', [R('p001.u01', 'הוקמה בשנת 1200')]),
  fact('f3', 'המלכים', 'המלך הראשון נקרא אורן ושלט שלושים שנה.', [R('p002.u01', 'נקרא אורן, והוא שלט שלושים שנה')]),
  fact('f4', 'המלכים', 'אחרי אורן שלט המלך נועם עשרים שנה.', [R('p002.u01', 'אחריו שלט המלך נועם עשרים שנה')]),
  fact('f5', 'העיר', 'הבירה נקראת צבעונית.', [R('p003.u01', 'הבירה של הממלכה נקראת צבעונית')]),
  fact('f6', 'העיר', 'בבירה שלוש שכונות: צפונית, דרומית ומזרחית.', [R('p003.u01', 'שלוש שכונות: צפונית, דרומית ומזרחית')]),
  fact('f7', 'הכנת צבע', 'סדר הכנת הצבע: טוחנים, מערבבים עם מים, מסננים.', [R('p004.u01', 'ראשית טוחנים את הפיגמנט, אחר כך מערבבים עם מים ולבסוף מסננים')]),
  fact('f8', 'הגילדות', 'ארבע הגילדות: הצבעים, האורגים, הצורפים והסופרים.', [R('p005.u01', 'הצבעים, האורגים, הצורפים והסופרים')]),
];
const opt = (arr, correctIdx) => arr.map((t, i) => (i === correctIdx ? `*${t}` : t));
const Q = [];
let n = 0;
const q = (lesson, fids, ty, d, stem, extra, pool = 'both') => { n++; Q.push({ id: `x1.q${String(n).padStart(3, '0')}`, lessonId: `x1.${lesson}`, chapter: 'x1', topic: { l1: 'הדגל', l2: 'המלכים', l3: 'העיר והגילדות' }[lesson], factIds: fids.map((f) => `x1.${f}`), difficulty: d, pool, stem, hints: ['רמז ראשון: חשבו על הנושא של השיעור.', 'רמז שני: זה מופיע בתחילת הקטע.'], explanation: `הסבר קצר לשאלה ${n}.`, refs: fids.flatMap((f) => facts.find((x) => x.id === `x1.${f}`).refs), verification: V(), ...extra }); };
const mc = (correct, wrong) => { const all = [correct, ...wrong]; return { type: 'mcq', options: all.map((t, i) => ({ id: 'abcde'[i], text: t })), correct: 'a' }; };
// lesson 1 (flag): 2 objectives f1,f2, size 3, pool 7
q('l1', ['f1'], 'mcq', 1, 'כמה פסים יש בדגל הממלכה?', mc('שלושה', ['שניים', 'ארבעה', 'חמישה']));
q('l1', ['f1'], 'mcq', 2, 'איזה צבע נמצא בדגל?', mc('ירוק', ['צהוב', 'סגול', 'כתום']));
q('l1', ['f1'], 'tf', 1, 'בדגל הממלכה יש פס סגול.', { type: 'tf', correct: false });
q('l1', ['f1'], 'multi', 2, 'בחרו את כל הצבעים שבדגל.', { type: 'multi', options: [{ id: 'a', text: 'אדום' }, { id: 'b', text: 'כחול' }, { id: 'c', text: 'ירוק' }, { id: 'd', text: 'צהוב' }], correct: ['a', 'b', 'c'] });
q('l1', ['f2'], 'short', 1, 'באיזו שנה הוקמה הממלכה? (מספר)', { type: 'short', accepted: ['1200'], answerDisplay: '1200' });
q('l1', ['f2'], 'mcq', 2, 'מתי הוקמה הממלכה?', mc('1200', ['1300', '1100', '1250']));
q('l1', ['f2'], 'tf', 1, 'הממלכה הוקמה בשנת 1200.', { type: 'tf', correct: true });
// lesson 2 (kings)
q('l2', ['f3'], 'mcq', 1, 'מי היה המלך הראשון?', mc('אורן', ['נועם', 'דן', 'גל']));
q('l2', ['f3'], 'short', 2, 'כמה שנים שלט המלך הראשון? (במילים)', { type: 'short', accepted: ['שלושים', '30'], answerDisplay: 'שלושים' });
q('l2', ['f3'], 'tf', 1, 'המלך הראשון שלט עשרים שנה.', { type: 'tf', correct: false });
q('l2', ['f4'], 'mcq', 1, 'מי שלט אחרי אורן?', mc('נועם', ['גל', 'רון', 'דן']));
q('l2', ['f4'], 'short', 2, 'כתבו את שם המלך השני.', { type: 'short', accepted: ['נועם', 'המלך נועם'], answerDisplay: 'נועם' });
q('l2', ['f3', 'f4'], 'order', 2, 'סדרו את המלכים לפי סדר השלטון.', { type: 'order', items: [{ id: 'i1', text: 'אורן' }, { id: 'i2', text: 'נועם' }, { id: 'i3', text: 'גל' }], correct: ['i1', 'i2', 'i3'] });
// lesson 3 (city & guilds)
q('l3', ['f5'], 'mcq', 1, 'מה שם הבירה?', mc('צבעונית', ['צבעים', 'עיר הצבע', 'אורנית']));
q('l3', ['f5'], 'short', 1, 'כתבו את שם הבירה.', { type: 'short', accepted: ['צבעונית'], answerDisplay: 'צבעונית' });
q('l3', ['f6'], 'mcq', 2, 'כמה שכונות יש בבירה?', mc('שלוש', ['שתיים', 'ארבע', 'חמש']));
q('l3', ['f6'], 'tf', 1, 'אחת מהשכונות נקראת צפונית.', { type: 'tf', correct: true });
q('l3', ['f7'], 'order', 2, 'סדרו את שלבי הכנת הצבע.', { type: 'order', items: [{ id: 'i1', text: 'טוחנים את הפיגמנט' }, { id: 'i2', text: 'מערבבים עם מים' }, { id: 'i3', text: 'מסננים' }], correct: ['i1', 'i2', 'i3'] });
q('l3', ['f7'], 'mcq', 1, 'מהו השלב הראשון בהכנת הצבע?', mc('טחינת הפיגמנט', ['סינון', 'ערבוב עם מים', 'צביעה']));
q('l3', ['f8'], 'match', 3, 'התאימו כל גילדה לתחום שלה.', { type: 'match', left: [{ id: 'l1', text: 'הצבעים' }, { id: 'l2', text: 'האורגים' }, { id: 'l3', text: 'הצורפים' }], right: [{ id: 'r1', text: 'צבע' }, { id: 'r2', text: 'בד' }, { id: 'r3', text: 'תכשיט' }], correct: { l1: 'r1', l2: 'r2', l3: 'r3' } });
q('l3', ['f8'], 'multi', 2, 'בחרו את כל הגילדות שבממלכה.', { type: 'multi', options: [{ id: 'a', text: 'הצבעים' }, { id: 'b', text: 'הצורפים' }, { id: 'c', text: 'הנגרים' }, { id: 'd', text: 'הסופרים' }], correct: ['a', 'b', 'd'] });
q('l3', ['f8'], 'tf', 1, 'יש בממלכה גילדה של האורגים.', { type: 'tf', correct: true });
// one FLAGGED question (not verified) for the review dashboard test
const flaggedQ = { ...Q[0], id: 'x1.q900', stem: 'שאלה לבדיקה ידנית: מהו הצבע הראשון בדגל?', verification: { ...V('flagged', 'uncertain'), independent: { verdict: 'uncertain', notes: 'ניסוח עלול להיות דו-משמעי', by: 'fixture' } } };
Q.push(flaggedQ);

const el = (t, f) => ({ type: 'explain', title: t, blocks: [{ kind: 'p', text: `הסבר קצר על ${t}.` }, { kind: 'key', text: `לזכור: ${t}` }], factIds: f.map((x) => `x1.${x}`) });
const chk = (i) => ({ type: 'check', questionId: `x1.q${String(i).padStart(3, '0')}` });
const lessons = [
  { id: 'x1.l1', chapter: 'x1', order: 1, title: 'דגל הממלכה', pages: [1, 1], objectives: ['x1.f1', 'x1.f2'], assessmentSize: 3, summary: 'סיכום שיעור הדגל.', verification: V(),
    steps: [el('פסי הדגל', ['f1']), chk(1), { type: 'figure', figureId: 'x1-f1', caption: 'איור לדוגמה' }, el('שנת ההקמה', ['f2']), chk(5)] },
  { id: 'x1.l2', chapter: 'x1', order: 2, title: 'מלכי הממלכה', pages: [2, 2], objectives: ['x1.f3', 'x1.f4'], assessmentSize: 3, verification: V(),
    steps: [el('המלך הראשון', ['f3']), chk(8), el('המלך השני', ['f4']), chk(11)] },
  { id: 'x1.l3', chapter: 'x1', order: 3, title: 'העיר והגילדות', pages: [3, 5], objectives: ['x1.f5', 'x1.f6', 'x1.f7', 'x1.f8'], assessmentSize: 5, verification: V(),
    steps: [el('הבירה', ['f5', 'f6']), chk(14), el('הכנת צבע', ['f7']), chk(18), el('הגילדות', ['f8']), chk(21)] },
];
const bundle = { chapter: { id: 'x1', title: 'פרק בדיקה סינתטי', firstPage: 1, lastPage: 5, order: 0, lessonIds: lessons.map((l) => l.id) }, facts, lessons, questions: Q };
fs.writeFileSync(path.join(OUT, 'x1.json'), JSON.stringify(bundle));
fs.writeFileSync(path.join(OUT, 'sources/x1.json'), JSON.stringify(units));
const manifest = {
  contentVersion: 'fixture01', generatedAt: '2026-01-01T00:00:00Z', book: 'synthetic', totalPages: 5,
  chapters: [{ ...bundle.chapter, lessons: lessons.map((l) => ({ id: l.id, title: l.title, pages: l.pages, status: 'verified' })), counts: { facts: facts.length, lessons: lessons.length, questions: Q.length, verifiedQuestions: Q.length - 1 } }],
  stats: { chapters: 1, facts: facts.length, lessons: lessons.length, questions: Q.length, verifiedQuestions: Q.length - 1 },
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest));
const review = {
  generatedAt: '2026-01-01', chapters: { x1: { title: 'פרק בדיקה סינתטי', pages: [1, 5], facts: { verified: facts.length }, lessons: { verified: 3 }, questions: { verified: Q.length - 1, flagged: 1 }, coverage: { requiredUnits: 5, unitsWithoutFact: [], unitsWithoutLesson: [], unitsWithoutQuestion: [], factsWithoutQuestion: [], excludedFootnotes: 0, supplementaryBoxes: 0 }, validation: { errors: 0, warnings: [] } } },
  flagged: [{ kind: 'question', chapter: 'x1', id: 'x1.q900', status: 'flagged', item: flaggedQ }], visual: [],
  extraction: { pagesProcessed: 5, totalPages: 5, unitsByScope: { core: 5, excluded_footnote: 0, supplementary: 0 }, visualReviewPages: [], allChapters: [{ id: 'x1', title: 'פרק בדיקה סינתטי', firstPage: 1, lastPage: 5, built: true }] },
};
fs.writeFileSync(path.join(OUT, 'review.json'), JSON.stringify(review));
console.log(`fixture written: ${Q.length} questions (1 flagged), ${lessons.length} lessons`);
