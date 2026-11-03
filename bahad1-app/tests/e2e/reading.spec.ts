import { expect, test, type Page } from '@playwright/test';

// "Read the lesson, then get tested": the default lesson page is one continuous reading page (no questions in between); the narrator is optional.
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

test('a lesson is one reading page: every card is there, no practice question in between, and the test comes at the end', async ({ page }) => {
  await page.goto('/#/lesson/x1.l1');
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

test('reading page: the source of a card opens, and the narrator is optional (nothing is spoken unless asked)', async ({ page }) => {
  await page.addInitScript(fakeSynth);
  await page.goto('/#/lesson/x1.l1');
  await page.waitForSelector('[data-testid="explain-card"]');
  await page.waitForTimeout(700);
  expect((await spoken(page)).length).toBe(0);
  await page.locator('[data-testid="step-source"]').first().click();
  await expect(page.locator('.modal, [role="dialog"]').first()).toBeVisible();
});

test('narrator: listen to the whole lesson reads every card in order, highlights what is read, and ends at the test button', async ({ page }) => {
  await page.addInitScript(fakeSynth);
  await page.goto('/#/lesson/x1.l1');
  await page.click('[data-testid="listen-all"]');
  await expect(page.locator('[data-testid="speech-bar"]')).toBeVisible();
  await expect(page.locator('.speaking').first()).toBeVisible();
  await expect(page.locator('[data-testid="speech-bar"]')).toHaveCount(0, { timeout: 60000 });
  await expect(page.locator('[data-testid="lesson-end"]')).toBeInViewport();
  const heard = (await spoken(page)).join(' ');
  const titles = await page.locator('[data-testid="explain-card"] h2').allInnerTexts();
  for (const t of titles) expect(heard).toContain(t.trim());
});

test('narrator: a single card can be read on its own', async ({ page }) => {
  await page.addInitScript(fakeSynth);
  await page.goto('/#/lesson/x1.l1');
  const title = (await page.locator('[data-testid="explain-card"] h2').nth(1).innerText()).trim();
  await page.locator('[data-testid^="read-card-"]').nth(1).click();
  await expect.poll(async () => (await spoken(page)).length).toBeGreaterThan(0);
  expect((await spoken(page))[0]).toBe(title);
});

test('the learning style can be switched in Settings to card-by-card with practice questions', async ({ page }) => {
  await page.goto('/#/settings');
  await page.selectOption('[data-testid="pref-flow"]', 'steps');
  await page.goto('/#/lesson/x1.l1?step=0');
  await expect(page.locator('[data-testid="explain-step"]')).toBeVisible();
  await expect(page.locator('[data-testid="lesson-reading"]')).toHaveCount(0);
  await page.goto('/#/settings');
  await page.selectOption('[data-testid="pref-flow"]', 'read');
  await page.goto('/#/lesson/x1.l1');
  await expect(page.locator('[data-testid="lesson-reading"]')).toBeVisible();
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
