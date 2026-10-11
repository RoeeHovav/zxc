import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';

// All content here is SYNTHETIC (scripts/make-fixture.mjs). The suite exercises mechanics, not book facts.
const bundle = JSON.parse(fs.readFileSync('tests/fixtures/public/content/x1.json', 'utf8'));
const QS: any[] = bundle.questions;
const byStem = (stem: string) => QS.find((q) => q.stem === stem);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept(''));
});

async function stem(page: Page) { return (await page.locator('.q-stem').first().innerText()).trim(); }
const optBtn = (page: Page, text: string) => page.locator('button.opt').filter({ has: page.locator('span', { hasText: new RegExp(`^${esc(text)}$`) }) }).first();

/** Answers the question currently on screen, correctly or (when wrong=true) incorrectly. Does NOT submit. */
async function fill(page: Page, wrong = false) {
  const q = byStem(await stem(page));
  expect(q, 'question must exist in fixture').toBeTruthy();
  switch (q.type) {
    case 'mcq': case 'compare': {
      if (!wrong) { await optBtn(page, q.options.find((o: any) => o.id === q.correct).text).click(); break; }
      for (const o of q.options.filter((x: any) => x.id !== q.correct)) {            // first wrong option that is still enabled (tried ones are eliminated)
        const b = optBtn(page, o.text);
        if (await b.isEnabled()) { await b.click(); break; }
      }
      break;
    }
    case 'tf': await page.click(`[data-testid="tf-${wrong ? !q.correct : q.correct}"]`); break;
    case 'short': case 'blank': await page.fill('[data-testid="short-input"]', wrong ? 'תשובה שגויה' : q.accepted[0]); break;
    case 'multi': {
      const ids = wrong ? [q.options.find((o: any) => !q.correct.includes(o.id)).id] : q.correct;
      for (const id of ids) await optBtn(page, q.options.find((o: any) => o.id === id).text).click(); break;
    }
    case 'match': for (const l of q.left) { const r = q.right.find((x: any) => x.id === (wrong ? q.right.find((y: any) => y.id !== q.correct[l.id]).id : q.correct[l.id])); await page.selectOption(`[data-testid="match-${l.id}"]`, { label: r.text }); } break;
    case 'order': {
      const want = q.correct.map((id: string) => q.items.find((i: any) => i.id === id).text);
      if (wrong) { await page.locator('[data-testid="order-0"] button[aria-label="הזזה למטה"]').click(); const cur = await page.locator('[data-testid^="order-"]').allInnerTexts(); if (cur.every((t, i) => t.includes(want[i]))) await page.locator('[data-testid="order-0"] button[aria-label="הזזה למטה"]').click(); break; }
      for (let i = 0; i < want.length; i++) {
        const cur = (await page.locator('[data-testid^="order-"]').allInnerTexts()).map((t) => t.replace(/[\d\n▲▼\s]+$/g, '').replace(/^\d+\s*/, ''));
        const j = cur.findIndex((t) => t.includes(want[i]));
        for (let k = j; k > i; k--) await page.locator(`[data-testid="order-${k}"] button[aria-label="הזזה למעלה"]`).click();
      }
      break;
    }
  }
  return q;
}

async function takeAssessment(page: Page, lessonId: string, wrongCount: number) {
  await page.goto('/#/guided');                       // leave the route first: the same hash would not remount the page
  await page.waitForSelector('[data-testid^="lesson-"]');
  await page.goto(`/#/assess/${lessonId}`);
  await page.click('[data-testid="start-assessment"]');
  const stems: string[] = [];
  let remainingWrong = wrongCount;
  for (;;) {
    await page.waitForSelector('.q-stem');
    stems.push(await stem(page));
    await fill(page, remainingWrong > 0 && (remainingWrong--, true));
    const label = await page.locator('[data-testid="confirm-answer"]').innerText();
    await page.click('[data-testid="confirm-answer"]');
    if (label.includes('סיום')) break;
  }
  await page.waitForSelector('[data-testid="assessment-result"]');
  return stems;
}

test('Hebrew RTL shell, no horizontal overflow', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('[data-testid="resume"]')).toBeVisible();
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(o.sw).toBeLessThanOrEqual(o.cw + 1);
  for (const route of ['/#/guided', '/#/practice', '/#/exam', '/#/review', '/#/library', '/#/stats', '/#/settings', '/#/content-review']) {
    await page.goto(route);
    await page.waitForTimeout(250);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(m.sw, `${route} overflows`).toBeLessThanOrEqual(m.cw + 1);
  }
});

test('guided lock: next lessons locked for the assessment but free to study', async ({ page }) => {
  await page.goto('/#/guided');
  await expect(page.locator('[data-testid="lesson-x1.l1"]')).toHaveAttribute('data-status', 'available');
  await expect(page.locator('[data-testid="lesson-x1.l2"]')).toHaveAttribute('data-status', 'locked');
  await expect(page.locator('[data-testid="lesson-x1.l3"]')).toHaveAttribute('data-status', 'locked');
  await page.goto('/#/assess/x1.l2');
  await expect(page.locator('[data-testid="locked-assessment"]')).toBeVisible();
  await expect(page.locator('[data-testid="start-assessment"]')).toHaveCount(0);
  // free study of a locked lesson is allowed
  await page.goto('/#/lesson/x1.l2?step=0');
  await expect(page.locator('[data-testid="explain-step"]')).toBeVisible();
  // library is free too
  await page.goto('/#/library/x1');
  await expect(page.locator('[data-testid="lib-lesson-x1.l3"]')).toBeVisible();
});

test('practice: wrong -> hint -> retry -> more specific hint -> reveal; outcomes are distinct', async ({ page }) => {
  await page.goto('/#/lesson/x1.l1?step=1');
  await page.waitForSelector('[data-testid="practice-question"]');
  await fill(page, true); await page.click('[data-testid="submit"]');
  await expect(page.locator('[data-testid="wrong-feedback"]')).toBeVisible();
  await expect(page.locator('[data-testid="hint"]')).toHaveCount(1);
  await fill(page, true); await page.click('[data-testid="submit"]');
  await expect(page.locator('[data-testid="hint"]')).toHaveCount(2);
  await fill(page, true); await page.click('[data-testid="submit"]');
  const fb = page.locator('[data-testid="feedback"]');
  await expect(fb).toBeVisible();
  await expect(fb).toHaveAttribute('data-outcome', 'revealed');
  await expect(page.locator('[data-testid="correct-answer"]')).toBeVisible();
  // next question (short-answer) answered correctly at once = first_try (independent)
  await page.click('[data-testid="next"]');
  await page.getByRole('button', { name: 'המשך' }).first().click();          // the lesson's original-figure step
  await page.waitForSelector('[data-testid="explain-step"]');
  await page.click('[data-testid="step-next"]');
  await page.waitForSelector('[data-testid="practice-question"]');
  await fill(page); await page.click('[data-testid="submit"]');
  await expect(page.locator('[data-testid="feedback"]')).toHaveAttribute('data-outcome', 'first_try');
});

test('hint requested before answering counts as hinted, not independent', async ({ page }) => {
  await page.goto('/#/lesson/x1.l1?step=1');
  await page.click('[data-testid="hint-btn"]');
  await expect(page.locator('[data-testid="hint"]')).toHaveCount(1);
  await fill(page); await page.click('[data-testid="submit"]');
  await expect(page.locator('[data-testid="feedback"]')).toHaveAttribute('data-outcome', 'hinted');
});

test('100% mastery: one mistake fails, no hints in assessment, retry uses other questions, perfect run unlocks next lesson, persists after reload', async ({ page }) => {
  await page.goto('/#/assess/x1.l1');
  await page.click('[data-testid="start-assessment"]');
  await page.waitForSelector('[data-testid="assessment-running"]');
  await expect(page.locator('[data-testid="hint-btn"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="reveal-btn"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="feedback"]')).toHaveCount(0);

  const first = await takeAssessment(page, 'x1.l1', 1);       // exactly one wrong answer
  await expect(page.locator('[data-testid="result-title"]')).toHaveText('שליטה עדיין לא הושגה');
  await expect(page.locator('[data-testid="wrong-item"]')).toHaveCount(1);
  await page.goto('/#/guided');
  await expect(page.locator('[data-testid="lesson-x1.l2"]')).toHaveAttribute('data-status', 'locked');

  const second = await takeAssessment(page, 'x1.l1', 0);       // retry, all correct
  expect(new Set(second).size).toBe(second.length);
  expect(second.join('|')).not.toBe(first.join('|'));            // a different assessment, not the identical repeat
  await expect(page.locator('[data-testid="result-title"]')).toHaveText('שליטה הושגה – 100%!');
  await page.goto('/#/guided');
  await expect(page.locator('[data-testid="lesson-x1.l1"]')).toHaveAttribute('data-status', 'mastered');
  await expect(page.locator('[data-testid="lesson-x1.l2"]')).toHaveAttribute('data-status', 'available');

  await page.reload();                                           // progress is persisted in IndexedDB
  await page.waitForSelector('[data-testid="lesson-x1.l1"]');
  await expect(page.locator('[data-testid="lesson-x1.l1"]')).toHaveAttribute('data-status', 'mastered');
});

test('an unanswered/locked-in answer cannot be changed and a wrong first answer is never corrected inside an assessment', async ({ page }) => {
  await page.goto('/#/assess/x1.l1');
  await page.click('[data-testid="start-assessment"]');
  await page.waitForSelector('[data-testid="assessment-running"]');
  // confirm is disabled until an answer is complete
  await expect(page.locator('[data-testid="confirm-answer"]')).toBeDisabled();
  await fill(page, true);
  await page.click('[data-testid="confirm-answer"]');
  await expect(page.locator('text=שאלה 2 מתוך')).toBeVisible();   // moved on: there is no way back to the first question
  await expect(page.locator('text=הקודמת')).toHaveCount(0);
});

test('custom practice: original page-range filter uses the book pages cited by questions', async ({ page }) => {
  await page.goto('/#/practice');
  await page.waitForSelector('[data-testid="match-count"]');
  const verified = QS.filter((q) => q.verification.status === 'verified');
  await expect(page.locator('[data-testid="match-count"]')).toContainText(String(verified.length));
  await page.fill('[data-testid="page-from"]', '2');
  await page.fill('[data-testid="page-to"]', '2');
  const expected = verified.filter((q) => q.refs.some((r: any) => r.page === 2)).length;
  await expect(page.locator('[data-testid="match-count"]')).toContainText(String(expected));
  await page.fill('[data-testid="count"]', '3');
  await page.click('[data-testid="start-practice"]');
  await expect(page.locator('[data-testid="practice-question"]')).toBeVisible();
});

test('exam: no hints, no feedback, real percentage, result with sources', async ({ page }) => {
  await page.goto('/#/exam');
  await page.fill('[data-testid="exam-count"]', '5');
  await page.click('[data-testid="start-exam"]');
  await page.waitForSelector('[data-testid="exam-running"]');
  await expect(page.locator('[data-testid="hint-btn"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="feedback"]')).toHaveCount(0);
  // answer the first two correctly, leave the rest unanswered
  for (let i = 0; i < 2; i++) { await fill(page); await page.click('[data-testid="exam-next"]'); }
  await expect(page.locator('[data-testid="feedback"]')).toHaveCount(0);
  await page.click('[data-testid="exam-submit-any"]');
  await page.waitForSelector('[data-testid="exam-result"]');
  await expect(page.locator('[data-testid="exam-result"]')).toContainText('40%'); // 2 of 5, honest percentage
  await expect(page.locator('[data-testid="exam-result"]')).toContainText('דרישת ה-100% חלה רק על שליטה בשיעורי המסלול');
});

test('wrong assessment answers feed the daily review', async ({ page }) => {
  await takeAssessment(page, 'x1.l1', 1);
  await page.goto('/#/review');
  await expect(page.locator('[data-testid="daily-card"]')).toContainText('הממתינות לחזרה: 1');
  await page.click('[data-testid="start-daily"]');
  await expect(page.locator('[data-testid="practice-question"]')).toBeVisible();
});

test('source viewer shows the exact passage with the highlighted quote, and the original page', async ({ page }) => {
  await page.goto('/#/lesson/x1.l1?step=1');
  await fill(page); await page.click('[data-testid="submit"]');
  await page.click('[data-testid="source-btn"]');
  await expect(page.locator('[data-testid="source-ref"]').first()).toBeVisible();
  await expect(page.locator('mark.q').first()).toBeVisible();
  await expect(page.locator('[data-testid="modal"]')).toContainText('עמוד');
  await page.getByRole('button', { name: 'הצגת העמוד המקורי' }).first().click();
  await expect(page.locator('[data-testid="image-viewer"]')).toBeVisible();
});

test('backup: export is validated, tampering is detected, restore works', async ({ page }) => {
  await takeAssessment(page, 'x1.l1', 0);
  await page.goto('/#/settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid="export"]')]);
  const path = await dl.path();
  const text = fs.readFileSync(path!, 'utf8');
  const file = JSON.parse(text);
  expect(file.format).toBe('bahad1-progress');
  expect(file.data.stores.lessonState.some((l: any) => l.masteredAt)).toBeTruthy();

  const good = test.info().outputPath('good.json');
  fs.mkdirSync(test.info().outputDir, { recursive: true });
  fs.writeFileSync(good, text);
  await page.setInputFiles('[data-testid="import-input"]', good);
  await expect(page.locator('[data-testid="import-check"]')).toContainText('הקובץ תקין');

  const bad = test.info().outputPath('bad.json');
  const tampered = JSON.parse(text); tampered.data.stores.lessonState[0].bestScore = 0.123;
  fs.writeFileSync(bad, JSON.stringify(tampered));
  await page.setInputFiles('[data-testid="import-input"]', bad);
  await expect(page.locator('[data-testid="import-check"]')).toContainText('סכום הביקורת');
  await expect(page.locator('[data-testid="restore"]')).toHaveCount(0);

  // wipe by restoring an EMPTY-progress backup is covered by unit tests; here: restore the good file after a reset
  await page.setInputFiles('[data-testid="import-input"]', good);
  await page.click('[data-testid="restore"]');
  await expect(page.locator('text=השחזור הושלם')).toBeVisible();
});

test('content review dashboard: flagged item shows source + concern; approval admits it into the bank only after an explicit decision', async ({ page }) => {
  await page.goto('/#/practice');
  await expect(page.locator('[data-testid="match-count"]')).not.toContainText('נמצאו 0 ');
  const before = Number((await page.locator('[data-testid="match-count"]').innerText()).match(/\d+/)![0]);
  await page.goto('/#/content-review');
  await page.getByRole('button', { name: 'פריטים לבדיקה' }).click();
  await page.getByRole('button', { name: /x1\.q900/ }).click();
  const d = page.locator('[data-testid="item-detail"]');
  await expect(d).toContainText('ניסוח עלול להיות דו-משמעי');
  await expect(d).toContainText('עמוד');
  await expect(d.locator('mark.q').first()).toBeVisible();
  await page.click('[data-testid="approve"]');
  await page.goto('/#/practice');
  await expect(page.locator('[data-testid="match-count"]')).toContainText(String(before + 1));
});

test('lesson flow reaches the end screen with a call to the mastery assessment', async ({ page }) => {
  await page.goto('/#/lesson/x1.l1?step=0');
  for (let guard = 0; guard < 14; guard++) {
    await page.waitForSelector('[data-testid$="-step"], [data-testid="lesson-end"]');
    const kind = await page.evaluate(() => (document.querySelector('[data-testid$="-step"], [data-testid="lesson-end"]') as HTMLElement).dataset.testid);
    if (kind === 'lesson-end') break;
    if (kind === 'explain-step') await page.click('[data-testid="step-next"]');
    else if (kind === 'figure-step') await page.getByRole('button', { name: 'המשך' }).first().click();
    else { await fill(page); await page.click('[data-testid="submit"]'); await page.click('[data-testid="next"]'); }
    await page.waitForTimeout(120);
  }
  await expect(page.locator('[data-testid="lesson-end"]')).toBeVisible();
  await expect(page.locator('[data-testid="to-assessment"]')).toBeVisible();
});

test('mobile: bottom tab bar replaces the top nav', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile');
  await page.goto('/');
  await expect(page.locator('nav.tabbar')).toBeVisible();
  await expect(page.locator('nav.nav')).toBeHidden();
});
