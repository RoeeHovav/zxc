import { expect, test } from '@playwright/test';
// Real private build + a fake speech synthesizer: checks that real Hebrew content is read in sensible short segments and captures screenshots.
const FAKE = `(() => {
  const voices = [{ voiceURI: 'local-he', name: 'Carmit', lang: 'he-IL', localService: true, default: true }, { voiceURI: 'online-he', name: 'Google עברית', lang: 'he-IL', localService: false, default: false }];
  const log = []; let timer = null;
  class U { constructor(t) { this.text = t; this.lang = ''; this.voice = null; this.rate = 1; this.pitch = 1; this.volume = 1; } }
  const synth = { speaking: false, getVoices: () => voices, addEventListener() {}, cancel() { clearTimeout(timer); synth.speaking = false; },
    speak(u) { synth.speaking = true; log.push({ text: u.text, voice: u.voice && u.voice.name }); timer = setTimeout(() => { synth.speaking = false; u.onend && u.onend({}); }, 1400); } };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = U; window.__spoken = log;
})();`;
test('real chapter: lesson card, question and settings with read-aloud', async ({ page }, info) => {
  const tag = info.project.name;
  const shot = async (n: string) => { await page.waitForTimeout(400); await page.screenshot({ path: `test-results/real/${tag}-speech-${n}.png` }); };
  await page.addInitScript(FAKE);
  await page.goto('/#/lesson/ch1.l03?step=0'); await page.waitForSelector('[data-testid="explain-step"]');
  await shot('1-card-idle');
  await page.click('[data-testid="read-card"]');
  await expect(page.locator('[data-testid="speech-bar"]')).toBeVisible();
  await page.waitForTimeout(1700);
  await shot('2-card-reading');
  const log = await page.evaluate(() => (window as unknown as { __spoken: { text: string }[] }).__spoken.map((u) => u.text));
  expect(log.length).toBeGreaterThan(1);
  expect(log.every((t) => t.length <= 170 && !/[֑-ׇ]/.test(t))).toBe(true);
  await page.click('[data-testid="speech-stop"]');
  await page.goto('/#/lesson/ch1.l03?step=1'); await page.waitForSelector('[data-testid="practice-question"]');
  await page.click('[data-testid="read-question"]');
  await page.waitForTimeout(1700);
  await shot('3-question-reading');
  await page.goto('/#/settings'); await page.waitForSelector('[data-testid="tts-settings"]');
  await page.locator('[data-testid="tts-settings"]').scrollIntoViewIfNeeded();
  await shot('4-settings');
});
