import { expect, test } from '@playwright/test';
import { loadQuestions, takeAssessment } from '../e2e/helpers';

// REAL private content (preview build). Verifies the 100% rule and the unlocking on the actual chapter.
loadQuestions('public/content/ch1.json');
test.beforeEach(async ({ page }) => { page.on('dialog', (d) => d.accept('')); });

test('real chapter: one mistake = no mastery; a perfect retry masters l01 and unlocks l02', async ({ page }) => {
  await page.goto('/#/guided');
  await expect(page.locator('[data-testid="lesson-ch1.l01"]')).toHaveAttribute('data-status', 'available');
  await expect(page.locator('[data-testid="lesson-ch1.l02"]')).toHaveAttribute('data-status', 'locked');
  const first = await takeAssessment(page, 'ch1.l01', 1);
  await expect(page.locator('[data-testid="result-title"]')).toHaveText('שליטה עדיין לא הושגה');
  await page.goto('/#/guided');
  await expect(page.locator('[data-testid="lesson-ch1.l02"]')).toHaveAttribute('data-status', 'locked');
  const second = await takeAssessment(page, 'ch1.l01', 0);
  await expect(page.locator('[data-testid="result-title"]')).toHaveText('שליטה הושגה – 100%!');
  expect(second.join('|')).not.toBe(first.join('|'));
  await page.goto('/#/guided');
  await expect(page.locator('[data-testid="lesson-ch1.l01"]')).toHaveAttribute('data-status', 'mastered');
  await expect(page.locator('[data-testid="lesson-ch1.l02"]')).toHaveAttribute('data-status', 'available');
  console.log('assessment sizes', first.length, second.length);
});
