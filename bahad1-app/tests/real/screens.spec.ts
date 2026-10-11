import { test } from '@playwright/test';
test('real chapter screens', async ({ page }, info) => {
  const tag = info.project.name;
  const shot = async (n: string) => { await page.waitForTimeout(500); await page.screenshot({ path: `test-results/real/${tag}-${n}.png` }); };
  await page.goto('/'); await page.waitForSelector('[data-testid="resume"]'); await shot('01-dashboard');
  await page.goto('/#/guided'); await page.waitForSelector('[data-testid="lesson-ch1.l01"]'); await shot('02-guided');
  await page.goto('/#/lesson/ch1.l04?step=0'); await page.waitForSelector('[data-testid="explain-step"]'); await shot('03-lesson-explain');
  await page.goto('/#/lesson/ch1.l04?step=1'); await page.waitForSelector('[data-testid="practice-question"]'); await shot('04-check-question');
  await page.goto('/#/lesson/ch1.l05?step=0'); await page.waitForSelector('[data-testid="explain-step"]'); await shot('05-lesson-figure-card');
  await page.goto('/#/assess/ch1.l01'); await page.waitForSelector('[data-testid="start-assessment"]'); await page.click('[data-testid="start-assessment"]'); await page.waitForSelector('.q-stem'); await shot('06-assessment-q1');
  await page.goto('/#/library/ch1'); await page.waitForSelector('[data-testid="lib-search"]'); await shot('07-library');
});
