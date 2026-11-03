import { expect, test } from '@playwright/test';
// Real private build: chapters that are not open yet are shown as "עובדים על זה", cannot be opened, and have no content bundle at all.
test('unopened chapters are visible as work-in-progress, locked, and not served', async ({ page, request }) => {
  const manifest = await (await request.get('/content/manifest.json')).json();
  const open = manifest.chapters.map((c: { id: string }) => c.id);
  expect(open).not.toContain('ch5');
  expect(open).not.toContain('ch6');
  expect((manifest.upcoming as { id: string }[]).map((c) => c.id)).toEqual(expect.arrayContaining(['ch5', 'ch6', 'ch7']));
  for (const id of ['ch5', 'ch6', 'ch7']) {
    const r = await request.get(`/content/${id}.json`);
    expect((r.headers()['content-type'] ?? '').includes('json') && r.ok()).toBe(false);
  }
  await page.goto('/#/guided');
  const up = page.locator('[data-testid="upcoming"]');
  await expect(up).toBeVisible();
  await expect(up.locator('[data-testid="upcoming-ch5"]')).toContainText('עובדים על זה');
  expect(await up.locator('a, button').count()).toBe(0); // nothing to click
  await page.goto('/#/library');
  await expect(page.locator('[data-testid="upcoming-ch5"]')).toBeVisible();
  await page.goto('/#/library/ch5');
  await expect(page.locator('[data-testid^="lib-lesson-ch5"]')).toHaveCount(0);
});

test('the dashboard shows the book map with open and locked chapters', async ({ page }) => {
  await page.goto('/#/');
  const map = page.locator('[data-testid="book-map"]');
  await expect(map).toBeVisible();
  await expect(map).toContainText('עובדים על זה');
  await expect(map).toContainText('שער 1');
});
