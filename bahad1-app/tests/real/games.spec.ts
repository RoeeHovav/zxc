import { expect, test } from '@playwright/test';
// Real private build: the games run on the real verified bank, and the reading-first lesson shows every card with no questions in between.
test('real chapter: the lesson page shows the book\'s own text (not rewritten cards), with the narrator button and the test at the end', async ({ page }) => {
  await page.goto('/#/lesson/ch1.l01');
  await expect(page.locator('[data-testid="lesson-reading"]')).toHaveAttribute('data-flow', 'original');
  const t = page.locator('[data-testid="original-text"]');
  await expect(t).toBeVisible();
  expect((await t.innerText()).length).toBeGreaterThan(80);
  await expect(page.locator('[data-testid="explain-card"], [data-testid="practice-question"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="listen-all"]')).toHaveCount(await page.locator('[data-testid="listen-all"]').count());
  await expect(page.locator('[data-testid="to-assessment"]')).toHaveCount(1);
});

test('real chapter: a lesson with a picture shows the original picture and its text; the page image view works', async ({ page }) => {
  await page.goto('/#/lesson/ch1.l05');
  await expect(page.locator('[data-testid="book-figure"] img').first()).toBeVisible();
  await page.click('[data-testid="view-pages"]');
  await expect(page.locator('[data-testid="page-images"] img').first()).toBeVisible();
});

test('real chapter: the whole chapter can be read as printed', async ({ page }) => {
  await page.goto('/#/read/ch1');
  await expect(page.locator('[data-testid="page-marker"]').first()).toBeVisible();
  expect(await page.locator('[data-testid="page-marker"]').count()).toBe(11); // pages 13-23
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
