import { expect, test } from '@playwright/test';
// Real private build: the auditable coverage matrix of chapter 1 has no gaps and every row of a required unit points at verified facts.
test('real coverage matrix: chapter 1 has no coverage gaps', async ({ page }) => {
  await page.goto('/#/content-review');
  await page.getByRole('button', { name: 'כיסוי' }).click();
  await page.click('[data-testid="matrix-toggle-ch1"]');
  const t = page.locator('[data-testid="matrix-ch1"]');
  await expect(t.locator('tbody tr').first()).toBeVisible();
  expect(await t.locator('tbody tr').count()).toBeGreaterThan(50);
  await page.getByRole('button', { name: 'פערי כיסוי' }).first().click();
  await expect(t.locator('tbody tr')).toHaveCount(0);
});
