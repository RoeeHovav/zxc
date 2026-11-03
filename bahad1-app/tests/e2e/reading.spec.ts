import { expect, test, type Page } from '@playwright/test';

// "Read the book's own text of the lesson, then get tested": the default lesson page shows the ORIGINAL text (no questions in between); the narrator is optional.
// The rewritten summary page (?flow=summary) and the card-by-card flow stay available.
const fakeSynth = `
(() => {
  const voices = [{ voiceURI: 'local-he', name: 'Carmit', lang: 'he-IL', localService: true, default: true }];
  const log = []; let timer = null;
  class U { constructor(t) { this.text = t; this.lang = ''; this.voice = null; this.rate = 1; this.pitch = 1; this.volume = 1; this.onend = null; this.onerror = null; } }
  const synth = { speaking: false, paused: false, pending: false, getVoices: () => voices, addEventListener() {}, removeEventListener() {},
    cancel() { clearTimeout(timer); synth.speaking = false; },
    speak(u) { synth.speaking = true; log.push(u.text); timer = setTimeout(() => { synth.speaking = false; u.onend && u.onend({}); }, 30); } };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = U; window.__spoken = log;
})();`;
const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);

test('summary flow: a lesson is one reading page: every card is there, no practice question in between, and the test comes at the end', async ({ page }) => {
  await page.goto('/#/lesson/x1.l1?flow=summary');
  await expect(page.locator('[data-testid="lesson-reading"]')).toBeVisible();
  const cards = page.locator('[data-testid="explain-card"]');
  expect(await cards.count()).toBeGreaterThanOrEqual(2);
  await expect(page.locator('[data-testid="practice-question"], [data-testid="check-step"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="step-next"]')).toHaveCount(0);
  await page.locator('[data-testid="lesson-end"]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-testid="to-assessment"]')).toBeVisible();
  await page.click('[data-testid="to-assessment"]');
  await expect(page).toHaveURL(/#\/assess\/x1\.l1/);
});

test('summary flow: the source of a card opens, and the narrator is optional (nothing is spoken unless asked)', async ({ page }) => {
  await page.addInitScript(fakeSynth);
  await page.goto('/#/lesson/x1.l1?flow=summary');
  await page.waitForSelector('[data-testid="explain-card"]');
  await page.waitForTimeout(700);
  expect((await spoken(page)).length).toBe(0);
  await page.locator('[data-testid="step-source"]').first().click();
  await expect(page.locator('.modal, [role="dialog"]').first()).toBeVisible();
});

test('summary flow narrator: listen to the whole lesson reads every card in order, highlights what is read, and ends at the test button', async ({ page }) => {
  await page.addInitScript(fakeSynth);
  await page.goto('/#/lesson/x1.l1?flow=summary');
  await page.click('[data-testid="listen-all"]');
  await expect(page.locator('[data-testid="speech-bar"]')).toBeVisible();
  await expect(page.locator('.speaking').first()).toBeVisible();
  await expect(page.locator('[data-testid="speech-bar"]')).toHaveCount(0, { timeout: 60000 });
  await expect(page.locator('[data-testid="lesson-end"]')).toBeInViewport();
  const heard = (await spoken(page)).join(' ');
  const titles = await page.locator('[data-testid="explain-card"] h2').allInnerTexts();
  for (const t of titles) expect(heard).toContain(t.trim());
});

test('summary flow narrator: a single card can be read on its own', async ({ page }) => {
  await page.addInitScript(fakeSynth);
  await page.goto('/#/lesson/x1.l1?flow=summary');
  const title = (await page.locator('[data-testid="explain-card"] h2').nth(1).innerText()).trim();
  await page.locator('[data-testid^="read-card-"]').nth(1).click();
  await expect.poll(async () => (await spoken(page)).length).toBeGreaterThan(0);
  expect((await spoken(page))[0]).toBe(title);
});

test('the learning style can be switched in Settings: original text (default), rewritten summary, card by card', async ({ page }) => {
  await page.goto('/#/lesson/x1.l1');
  await expect(page.locator('[data-testid="lesson-reading"]')).toHaveAttribute('data-flow', 'original');
  await page.goto('/#/settings');
  await page.selectOption('[data-testid="pref-flow"]', 'steps');
  await page.goto('/#/lesson/x1.l1?step=0');
  await expect(page.locator('[data-testid="explain-step"]')).toBeVisible();
  await expect(page.locator('[data-testid="lesson-reading"]')).toHaveCount(0);
  await page.goto('/#/settings');
  await page.selectOption('[data-testid="pref-flow"]', 'summary');
  await page.goto('/#/lesson/x1.l1');
  await expect(page.locator('[data-testid="lesson-reading"]')).toHaveAttribute('data-flow', 'summary');
  await page.goto('/#/settings');
  await page.selectOption('[data-testid="pref-flow"]', 'original');
  await page.goto('/#/lesson/x1.l1');
  await expect(page.locator('[data-testid="lesson-reading"]')).toHaveAttribute('data-flow', 'original');
});

test('after reading a chapter: a test or practice on the whole chapter is one click away', async ({ page }) => {
  await page.goto('/#/library/x1');
  await expect(page.locator('[data-testid="chapter-exam"]')).toBeVisible();
  await page.click('[data-testid="chapter-exam"]');
  await expect(page).toHaveURL(/#\/exam\?chapter=x1/);
  await expect(page.getByRole('checkbox', { name: /פרק בדיקה סינתטי/ })).toBeChecked();
  await page.goto('/#/library/x1');
  await page.click('[data-testid="chapter-practice"]');
  await expect(page.getByRole('checkbox', { name: /פרק בדיקה סינתטי/ })).toBeChecked();
});

// ---- the original book text ----
test('original text: the lesson shows what the book prints — heading, paragraphs with printed-bold terms, a table, figure text — and no rewritten cards or questions', async ({ page }) => {
  await page.goto('/#/lesson/x1.l1');
  await expect(page.locator('[data-testid="lesson-reading"]')).toHaveAttribute('data-flow', 'original');
  const t = page.locator('[data-testid="original-text"]');
  await expect(t).toContainText('בממלכת הצבעים הדמיונית יש שלושה פסים בדגל');
  await expect(t.locator('h2, h3, h4').first()).toContainText('דגל הממלכה');
  await expect(t.locator('strong.book-bold')).toHaveText('שלושה פסים');
  await expect(t).toContainText('למחשבה'); // thought boxes are shown, labelled as supplementary
  await expect(page.locator('[data-testid="explain-card"], [data-testid="practice-question"]')).toHaveCount(0);
  // an image text is shown only when two independent readings agreed
  await expect(t).toContainText('טקסט מדומה מתוך אינפוגרפיקה');
  await expect(t).not.toContainText('לא מאומת');
  await page.locator('[data-testid="lesson-end"]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-testid="to-assessment"]')).toBeVisible();
  await page.goto('/#/lesson/x1.l2');
  await expect(page.locator('[data-testid="original-text"] table')).toBeVisible();
  await expect(page.locator('[data-testid="original-text"] table td').first()).toContainText('המלך');
});

test('original text: the narrator reads the book text in order, highlights it, and the learner can switch to the original page image', async ({ page }) => {
  await page.addInitScript(fakeSynth);
  await page.goto('/#/lesson/x1.l1');
  await page.waitForSelector('[data-testid="original-text"]');
  await page.waitForTimeout(600);
  expect((await spoken(page)).length).toBe(0); // nothing is read unless asked
  await page.click('[data-testid="listen-all"]');
  await expect(page.locator('.speaking').first()).toBeVisible();
  await expect(page.locator('[data-testid="speech-bar"]')).toHaveCount(0, { timeout: 60000 });
  const heard = (await spoken(page)).join(' | ');
  expect(heard.indexOf('דגל הממלכה')).toBeGreaterThanOrEqual(0);
  expect(heard.indexOf('דגל הממלכה')).toBeLessThan(heard.indexOf('בממלכת הצבעים'));
  expect(heard).toContain('טקסט מדומה מתוך אינפוגרפיקה');
  expect(heard).not.toContain('לא מאומת');
  await page.click('[data-testid="view-pages"]');
  await expect(page.locator('[data-testid="page-images"] img').first()).toHaveAttribute('src', /pages\/p001\.jpg/);
  await page.click('[data-testid="view-text"]');
  await expect(page.locator('[data-testid="original-text"]')).toBeVisible();
});

test('read the whole chapter as printed: page markers, jump to a page, narrator from that page, then the chapter test', async ({ page }) => {
  await page.addInitScript(fakeSynth);
  await page.goto('/#/library/x1');
  await page.click('[data-testid="chapter-read"]');
  await expect(page).toHaveURL(/#\/read\/x1/);
  await expect(page.locator('[data-testid="page-marker"]')).toHaveCount(5);
  await page.selectOption('[data-testid="jump-page"]', '3');
  await expect(page.locator('[data-testid="listen-chapter"]')).toContainText('מעמוד 3');
  await page.click('[data-testid="listen-chapter"]');
  await expect.poll(async () => (await spoken(page)).length, { timeout: 15000 }).toBeGreaterThan(0);
  expect((await spoken(page))[0]).toContain('העיר הבירה'); // starts at page 3, not at the beginning
  await page.click('[data-testid="speech-stop"]');
  await page.click('[data-testid="view-pages"]');
  expect(await page.locator('[data-testid="page-images"] img').count()).toBe(5);
  await page.getByRole('link', { name: 'מבחן על הפרק' }).first().click();
  await expect(page).toHaveURL(/#\/exam\?chapter=x1/);
});
