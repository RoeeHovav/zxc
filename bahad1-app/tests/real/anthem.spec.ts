import { test } from '@playwright/test';
test('anthem question types', async ({ page }, info) => {
  const tag = info.project.name;
  const shot = async (n: string) => { await page.waitForTimeout(450); await page.screenshot({ path: `test-results/real/${tag}-${n}.png` }); };
  await page.goto('/#/practice?lesson=ch1.l32');
  await page.waitForSelector('[data-testid="start-practice"]');
  await page.getByLabel('סידור').check();
  await page.fill('[data-testid="count"]', '1');
  await page.click('[data-testid="start-practice"]');
  await page.waitForSelector('[data-testid="practice-question"]'); await shot('11-anthem-order');
  await page.goto('/#/guided'); await page.goto('/#/practice?lesson=ch1.l32');
  await page.waitForSelector('[data-testid="start-practice"]');
  await page.getByLabel('תשובה קצרה').check();
  await page.fill('[data-testid="count"]', '40');
  await page.click('[data-testid="start-practice"]');
  for (let i = 0; i < 40; i++) {
    await page.waitForSelector('.q-stem');
    if (await page.locator('textarea[data-testid="short-input"]').count()) { await shot('12-anthem-write-stanza'); break; }
    await page.click('[data-testid="reveal-btn"]'); await page.click('[data-testid="next"]');
  }
});
