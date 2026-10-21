import { expect, test, type Page } from '@playwright/test';

// Read-aloud feature, tested against a FAKE speech synthesizer (headless Chromium has no voices). All content is synthetic.
const voicesJs = (list: object[]) => `
(() => {
  const voices = ${JSON.stringify(list)};
  const log = []; let current = null; let timer = null;
  class U { constructor(t) { this.text = t; this.lang = ''; this.voice = null; this.rate = 1; this.pitch = 1; this.volume = 1; this.onend = null; this.onerror = null; } }
  const synth = {
    speaking: false, paused: false, pending: false, getVoices: () => voices, addEventListener() {}, removeEventListener() {},
    cancel() { clearTimeout(timer); current = null; synth.speaking = false; },
    speak(u) { current = u; synth.speaking = true; log.push({ text: u.text, lang: u.lang, voice: u.voice && u.voice.name, rate: u.rate });
      timer = setTimeout(() => { synth.speaking = false; current = null; u.onend && u.onend({}); }, 40); },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = U; window.__spoken = log;
})();`;
const VOICES = [
  { voiceURI: 'local-he', name: 'Carmit', lang: 'he-IL', localService: true, default: true },
  { voiceURI: 'online-he', name: 'Google עברית', lang: 'he-IL', localService: false, default: false },
  { voiceURI: 'en', name: 'Samantha', lang: 'en-US', localService: true, default: false },
];
const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: { text: string; lang: string; voice: string | null; rate: number }[] }).__spoken);

test('a lesson card is read sentence by sentence in a Hebrew voice, highlighted, with a mini player that disappears at the end', async ({ page }) => {
  await page.addInitScript(voicesJs(VOICES));
  await page.goto('/#/lesson/x1.l1?step=0');
  await page.waitForSelector('[data-testid="explain-step"]');
  await expect(page.locator('[data-testid="speech-bar"]')).toHaveCount(0);
  await page.click('[data-testid="read-card"]');
  await expect(page.locator('[data-testid="speech-bar"]')).toBeVisible();
  await expect(page.locator('.speaking').first()).toBeVisible();
  await expect.poll(async () => (await spoken(page)).length, { timeout: 15000 }).toBeGreaterThan(1);
  const log = await spoken(page);
  expect(log.every((u) => u.lang === 'he-IL')).toBe(true);
  expect(log[0].voice).toBe('Carmit'); // best LOCAL voice; online voices are off by default
  const title = (await page.locator('.explain h2').innerText()).trim();
  expect(log[0].text).toBe(title);
  await expect(page.locator('[data-testid="speech-bar"]')).toHaveCount(0, { timeout: 20000 });
  await expect(page.locator('.speaking')).toHaveCount(0);
});

test('pause, resume, previous/next sentence, speed and stop work from the mini player', async ({ page }) => {
  await page.addInitScript(voicesJs(VOICES));
  await page.goto('/#/lesson/x1.l1?step=0');
  await page.click('[data-testid="read-card"]');
  const bar = page.locator('[data-testid="speech-bar"]');
  await expect(bar).toBeVisible();
  await page.click('[data-testid="speech-toggle"]'); // pause
  await expect(bar).toContainText('מושהה');
  const n = (await spoken(page)).length;
  await page.waitForTimeout(900);
  expect((await spoken(page)).length).toBe(n); // silent while paused
  await page.click('[data-testid="speech-toggle"]'); // resume
  await expect(bar).toContainText('מקריא');
  const before = await page.locator('[data-testid="speech-bar"] .pos').innerText();
  await page.click('[data-testid="speech-speed"]');
  await expect(page.locator('[data-testid="speech-speed"]')).toContainText('1.05');
  await page.click('[data-testid="speech-next"]');
  expect(await page.locator('[data-testid="speech-bar"] .pos').innerText()).not.toBe(before);
  await page.click('[data-testid="speech-stop"]');
  await expect(bar).toHaveCount(0);
});

test('on a phone the player sits above the bottom tab bar and never hides the lesson buttons', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'mobile layout only');
  await page.addInitScript(voicesJs(VOICES));
  await page.goto('/#/lesson/x1.l1?step=0');
  await page.click('[data-testid="read-card"]');
  const bar = await page.locator('[data-testid="speech-bar"]').boundingBox();
  const tab = await page.locator('.tabbar').boundingBox();
  expect(bar!.y + bar!.height).toBeLessThanOrEqual(tab!.y + 1);
  await page.locator('[data-testid="step-next"]').scrollIntoViewIfNeeded();
  const next = await page.locator('[data-testid="step-next"]').boundingBox();
  const bar2 = await page.locator('[data-testid="speech-bar"]').boundingBox();
  expect(next!.y + next!.height <= bar2!.y || next!.y >= bar2!.y + bar2!.height).toBe(true);
});

test('questions and answers are never read aloud: no read buttons in practice, feedback or the mastery test', async ({ page }) => {
  await page.addInitScript(voicesJs(VOICES));
  await page.goto('/#/lesson/x1.l1?step=1');
  await page.waitForSelector('[data-testid="practice-question"]');
  await expect(page.locator('[data-testid="read-question"], [data-testid="read-feedback"], [data-testid="read-card"], [data-testid="listen-all"]')).toHaveCount(0);
  await page.click('[data-testid="reveal-btn"]');
  await expect(page.locator('[data-testid="feedback"]')).toBeVisible();
  await expect(page.locator('[data-testid="read-feedback"]')).toHaveCount(0);
  await page.goto('/#/assess/x1.l1');
  await page.click('[data-testid="start-assessment"]');
  await page.waitForSelector('.q-stem');
  await expect(page.locator('[data-testid="read-question"]')).toHaveCount(0);
  expect((await spoken(page)).length).toBe(0);
});

test('settings: voices are listed with local/online labels, online voices need consent, choices persist, rate applies', async ({ page }) => {
  await page.addInitScript(voicesJs(VOICES));
  await page.goto('/#/settings');
  const card = page.locator('[data-testid="tts-settings"]');
  await expect(card).toBeVisible();
  await expect(page.locator('[data-testid="tts-voice-count"]')).toContainText('2 קולות עבריים'); // the English voice is not offered
  await expect(page.locator('[data-testid="tts-active-voice"]')).toContainText('Carmit');
  await expect(page.locator('[data-testid="tts-online-hint"]')).toBeVisible();
  await page.check('[data-testid="tts-online"]');
  await expect(page.locator('[data-testid="tts-active-voice"]')).toContainText('Google עברית');
  await page.fill('[data-testid="tts-rate"]', '1.2');
  await page.click('[data-testid="tts-test"]');
  await expect.poll(async () => (await spoken(page)).length, { timeout: 15000 }).toBeGreaterThan(0);
  const first = (await spoken(page))[0];
  expect(first.voice).toBe('Google עברית');
  expect(first.rate).toBeCloseTo(1.2, 1);
  await page.reload();
  await expect(page.locator('[data-testid="tts-active-voice"]')).toContainText('Google עברית');
  await expect(page.locator('[data-testid="tts-online"]')).toBeChecked();
  await page.selectOption('[data-testid="tts-voice"]', 'local-he');
  await expect(page.locator('[data-testid="tts-active-voice"]')).toContainText('Carmit');
});

test('auto-read: when enabled, a new lesson card starts reading by itself; navigating away stops it', async ({ page }) => {
  await page.addInitScript(voicesJs(VOICES));
  await page.goto('/#/settings');
  await page.check('[data-testid="tts-auto"]');
  await page.goto('/#/lesson/x1.l1?step=0');
  await page.waitForSelector('[data-testid="explain-step"]');
  await expect.poll(async () => (await spoken(page)).length, { timeout: 8000 }).toBeGreaterThan(0);
  await page.goto('/#/guided');
  await expect(page.locator('[data-testid="speech-bar"]')).toHaveCount(0);
});

test('no Hebrew voice installed: the button explains how to install one instead of staying silent', async ({ page }) => {
  await page.addInitScript(voicesJs([{ voiceURI: 'en', name: 'Samantha', lang: 'en-US', localService: true, default: true }]));
  await page.goto('/#/lesson/x1.l1?step=0');
  await page.waitForTimeout(800); // voice polling finishes
  await page.click('[data-testid="read-card"]');
  await expect(page.locator('[data-testid="voice-help"]')).toContainText('לא נמצא');
  await expect(page.locator('[data-testid="voice-help"]')).toContainText('Windows');
  expect((await spoken(page)).length).toBe(0);
});

test('only an online Hebrew voice exists: the player offers to enable online voices (explicit consent)', async ({ page }) => {
  await page.addInitScript(voicesJs([{ voiceURI: 'on', name: 'Microsoft Hila Online (Natural) - Hebrew (Israel)', lang: 'he-IL', localService: false, default: true }]));
  await page.goto('/#/lesson/x1.l1?step=0');
  await page.waitForTimeout(800);
  await page.click('[data-testid="read-card"]');
  await expect(page.locator('[data-testid="voice-help"]')).toContainText('מקוון');
  expect((await spoken(page)).length).toBe(0); // nothing is sent anywhere before the learner agrees
  await page.click('[data-testid="enable-online"]');
  await page.click('[data-testid="read-card"]');
  await expect.poll(async () => (await spoken(page)).length, { timeout: 10000 }).toBeGreaterThan(0);
  expect((await spoken(page))[0].voice).toContain('Natural');
});

test('browsers without speech synthesis: no read buttons, the settings page says so, nothing breaks', async ({ page }) => {
  await page.addInitScript(() => { try { delete (window as unknown as Record<string, unknown>).speechSynthesis; Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true }); } catch { /* ignore */ } });
  await page.goto('/#/lesson/x1.l1?step=0');
  await page.waitForSelector('[data-testid="explain-step"]');
  await expect(page.locator('[data-testid="read-card"]')).toHaveCount(0);
  await page.goto('/#/settings');
  await expect(page.locator('[data-testid="tts-settings"]')).toContainText('אינו תומך');
});

test('listen to the whole lesson: cards are read one after the other, the screen follows, and it ends on the mastery-test screen', async ({ page }) => {
  await page.addInitScript(voicesJs(VOICES));
  await page.goto('/#/lesson/x1.l1?step=0');
  await page.click('[data-testid="listen-all"]');
  await expect(page.locator('[data-testid="speech-bar"]')).toBeVisible();
  await expect(page.locator('[data-testid="lesson-end"]')).toBeVisible({ timeout: 90000 });
  await expect(page.locator('[data-testid="speech-bar"]')).toHaveCount(0);
  const log = (await spoken(page)).map((u) => u.text);
  expect(log.length).toBeGreaterThan(3);
});

test('stopping the lesson listening midway leaves the learner where they are', async ({ page }) => {
  await page.addInitScript(voicesJs(VOICES));
  await page.goto('/#/lesson/x1.l1?step=0');
  await page.click('[data-testid="listen-all"]');
  await expect(page.locator('[data-testid="speech-bar"]')).toBeVisible();
  await page.click('[data-testid="speech-stop"]');
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-testid="lesson-end"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="listen-all"]')).toBeVisible();
});
