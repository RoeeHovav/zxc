import { expect, test } from '@playwright/test';
// Real private build: the games run on the real verified bank, and the reading-first lesson shows every card with no questions in between.
test('real chapter: reading-first lesson page', async ({ page }) => {
  await page.goto('/#/lesson/ch1.l01');
  await expect(page.locator('[data-testid="lesson-reading"]')).toBeVisible();
  expect(await page.locator('[data-testid="explain-card"]').count()).toBeGreaterThanOrEqual(2);
  await expect(page.locator('[data-testid="practice-question"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="to-assessment"]')).toHaveCount(1);
});

test('real bank: every game can start and memory has verified pairs', async ({ page }) => {
  await page.goto('/#/games');
  await expect(page.locator('[data-testid="start-memory"]')).toBeEnabled({ timeout: 20000 });
  await expect(page.locator('[data-testid="start-flash"]')).toBeEnabled();
  await page.click('[data-testid="start-daily-game"]');
  await expect(page.locator('[data-testid="game-daily"]')).toBeVisible();
  await page.getByRole('button', { name: 'יציאה' }).click();
  await page.click('[data-testid="start-blitz"]');
  await expect(page.locator('[data-testid="game-blitz"]')).toBeVisible();
  await page.getByRole('button', { name: 'יציאה' }).click();
  await page.click('[data-testid="start-survival"]');
  await expect(page.locator('[data-testid="game-survival"]')).toBeVisible();
  await page.getByRole('button', { name: 'יציאה' }).click();
  await page.click('[data-testid="start-memory"]');
  expect(await page.locator('.mem-card').count()).toBe(12);
});
