import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The release is opened by double-clicking index.html (file://): no server, no fetch(), no module scripts.
const index = path.resolve('dist-file/index.html');
test.skip(!fs.existsSync(index), 'run npm run content:build && npm run build:file first');

test('file:// release: dashboard, guided path, a lesson and practice work, with the source viewer', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const url = pathToFileURL(index).href;
  await page.goto(url);
  await expect(page.locator('[data-testid="book-map"]')).toBeVisible({ timeout: 20000 });
  await page.goto(`${url}#/guided`);
  await expect(page.locator('[data-testid^="lesson-ch1"]').first()).toBeVisible({ timeout: 20000 });
  expect(await page.locator('[data-testid^="lesson-ch1"]').count()).toBeGreaterThan(20);
  await expect(page.locator('[data-testid="upcoming-ch5"]')).toContainText('עובדים על זה');
  await page.goto(`${url}#/lesson/ch1.l03`);
  await expect(page.locator('[data-testid="lesson-reading"]')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-testid="explain-card"]').first()).toBeVisible();
  await page.goto(`${url}#/practice?lesson=ch1.l03`);
  await page.waitForSelector('[data-testid="start-practice"]');
  await page.click('[data-testid="start-practice"]');
  await page.waitForSelector('[data-testid="practice-question"]');
  await page.click('[data-testid="reveal-btn"]');
  await expect(page.locator('[data-testid="feedback"]')).toBeVisible();
  // the source viewer (loads sources/<chapter>.json.js and the page image from disk)
  await page.getByRole('button', { name: /המקור בחוברת|מקור/ }).first().click();
  await expect(page.locator('.modal, [role="dialog"]').first()).toBeVisible();
  expect(errors.filter((e) => !/favicon/i.test(e))).toEqual([]);
});
