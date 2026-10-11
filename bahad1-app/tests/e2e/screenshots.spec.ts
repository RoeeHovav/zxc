import { test } from '@playwright/test';

// Visual review helper: saves screenshots of the main screens to test-results/screens (git-ignored).
test('capture main screens', async ({ page }, info) => {
  const tag = info.project.name;
  const shot = async (n: string) => { await page.waitForTimeout(450); await page.screenshot({ path: `test-results/screens/${tag}-${n}.png`, fullPage: false }); };
  await page.goto('/');
  await page.waitForSelector('[data-testid="resume"]');
  await shot('1-dashboard');
  await page.goto('/#/guided'); await page.waitForSelector('[data-testid="lesson-x1.l1"]'); await shot('2-guided');
  await page.goto('/#/lesson/x1.l1?step=0'); await page.waitForSelector('[data-testid="explain-step"]'); await shot('3-lesson-explain');
  await page.goto('/#/lesson/x1.l1?step=1'); await page.waitForSelector('[data-testid="check-step"]'); await shot('4-lesson-check');
  await page.goto('/#/assess/x1.l1'); await page.waitForSelector('[data-testid="start-assessment"]'); await shot('5-assessment-intro');
  await page.click('[data-testid="start-assessment"]'); await page.waitForSelector('[data-testid="assessment-running"]'); await shot('6-assessment-q');
  await page.goto('/#/practice'); await page.waitForSelector('[data-testid="start-practice"]'); await shot('7-practice');
  await page.goto('/#/exam'); await page.waitForSelector('[data-testid="start-exam"]'); await shot('8-exam-setup');
  await page.goto('/#/settings'); await page.waitForSelector('[data-testid="backup-card"]'); await shot('9-settings');
  await page.goto('/#/content-review'); await page.waitForSelector('[data-testid="content-review"]'); await shot('10-review');
});
