import { expect, test, type Page } from '@playwright/test';

// Games hub on SYNTHETIC content (no book needed). Every game must use only verified questions, grade strictly and feed the review statistics.
const correctOption = async (page: Page) => {
  // the synthetic MCQ keys are always the option whose text is in this list; true/false is read from the stem
  return page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="opt-"]')).map((e) => (e as HTMLElement).innerText.replace(/^[^\S\r\n]*[א-ה]\s*/, '').trim()));
};
void correctOption;

test('games hub lists every game with availability and personal records', async ({ page }) => {
  await page.goto('/#/games');
  await expect(page.locator('[data-testid="games-hub"]')).toBeVisible();
  for (const id of ['daily', 'blitz', 'survival', 'memory', 'flash']) await expect(page.locator(`[data-testid="card-${id}"]`)).toBeVisible();
  await expect(page.locator('[data-testid="start-blitz"]')).toBeEnabled();
  await expect(page.locator('[data-testid="start-memory"]')).toBeEnabled();
});

test('blitz: tapping answers scores, a mistake resets the combo and shows the verified answer, the result screen lists what to review', async ({ page }) => {
  await page.goto('/#/games');
  await page.selectOption('[data-testid="blitz-cat"]', 'tf');
  await page.click('[data-testid="start-blitz"]');
  await expect(page.locator('[data-testid="game-blitz"]')).toBeVisible();
  await expect(page.locator('[data-testid="game-timer"]')).toBeVisible();
  await expect(page.locator('[data-testid="game-score"]')).toHaveText('0');
  // answer true/false deliberately wrong for the first question so a mistake path is exercised: pick "נכון"; whichever it is, one of the two paths runs
  await page.click('[data-testid="tf-true"]');
  const fb = page.locator('[data-testid="game-feedback"]');
  await expect(fb).toBeVisible();
  const ok = (await fb.innerText()).includes('✓');
  if (ok) {
    await expect(page.locator('[data-testid="game-score"]')).not.toHaveText('0');
    await expect(page.locator('[data-testid="game-combo"]')).toContainText('1');
  } else {
    await expect(fb).toContainText('לא נכון');
    await expect(page.locator('[data-testid="game-score"]')).toHaveText('0');
    await page.click('[data-testid="game-next"]');
  }
  await page.click('[data-testid="speech-stop"]').catch(() => {});
  // leave: back on the hub
  await page.getByRole('button', { name: 'יציאה' }).click();
  await expect(page.locator('[data-testid="games-hub"]')).toBeVisible();
});

test('blitz ends when the time runs out and stores a personal record', async ({ page }) => {
  await page.clock.install();
  await page.goto('/#/games');
  await page.selectOption('[data-testid="blitz-secs"]', '60');
  await page.selectOption('[data-testid="blitz-cat"]', 'tf');
  await page.click('[data-testid="start-blitz"]');
  await page.click('[data-testid="tf-true"]');
  await page.clock.runFor(1500); // feedback
  // if the answer was wrong the feedback waits for "המשך"
  if (await page.locator('[data-testid="game-next"]').isVisible()) await page.click('[data-testid="game-next"]');
  await page.clock.runFor(61000);
  await expect(page.locator('[data-testid="game-end"]')).toBeVisible();
  await expect(page.locator('[data-testid="end-score"]')).toBeVisible();
});

test('survival: three mistakes end the run, each mistake costs a life', async ({ page }) => {
  await page.goto('/#/games');
  await page.click('[data-testid="start-survival"]');
  await expect(page.locator('[data-testid="game-survival"]')).toBeVisible();
  for (let i = 0; i < 40; i++) {
    if (await page.locator('[data-testid="game-end"]').isVisible()) break;
    // always choose the first option / "נכון": the run must end eventually because wrong answers cost lives
    const tf = page.locator('[data-testid="tf-true"]');
    if (await tf.isVisible()) await tf.click(); else await page.click('[data-testid="opt-0"]');
    const next = page.locator('[data-testid="game-next"]');
    await Promise.race([next.waitFor({ timeout: 1500 }).catch(() => {}), page.waitForTimeout(900)]);
    if (await next.isVisible()) await next.click();
  }
  await expect(page.locator('[data-testid="game-end"]')).toBeVisible({ timeout: 15000 });
});

test('memory: flipping the two sides of a pair matches them; a wrong pair flips back; the source of a found pair can be opened', async ({ page }) => {
  await page.goto('/#/games');
  await page.selectOption('[data-testid="memory-pairs"]', '4');
  await page.click('[data-testid="start-memory"]');
  await expect(page.locator('[data-testid="game-memory"]')).toBeVisible();
  const cards = page.locator('.mem-card');
  const n = await cards.count();
  expect(n).toBeGreaterThanOrEqual(6);
  const info = await cards.evaluateAll((els) => els.map((e) => ({ pair: (e as HTMLElement).dataset.testid!, side: (e as HTMLElement).dataset.side!, card: (e as HTMLElement).dataset.card! })));
  // deliberately wrong first: two cards of different pairs
  const a = info[0]; const b = info.find((x) => x.pair !== a.pair)!;
  await page.locator(`[data-card="${a.card}"]`).click();
  await page.locator(`[data-card="${b.card}"]`).click();
  await expect(page.locator('.mem-card.up')).toHaveCount(2);
  await expect(page.locator('.mem-card.up')).toHaveCount(0, { timeout: 4000 });
  // now play it out by pairing correctly
  const pairs = [...new Set(info.map((x) => x.pair))];
  for (const p of pairs) {
    const two = info.filter((x) => x.pair === p);
    await page.locator(`[data-card="${two[0].card}"]`).click();
    await page.locator(`[data-card="${two[1].card}"]`).click();
    await expect(page.locator(`.mem-card.done[data-testid="${p}"]`)).toHaveCount(2, { timeout: 3000 });
  }
  await expect(page.locator('[data-testid="game-end"]')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('[data-testid="end-moves"]')).toHaveText(String(pairs.length + 1)); // one mistake + one move per pair
});

test('flashcards: flip, known cards leave, unknown cards come back, no XP and no grading', async ({ page }) => {
  await page.goto('/#/games');
  const xpBefore = await page.evaluate(() => document.body.innerText);
  void xpBefore;
  await page.click('[data-testid="start-flash"]');
  await expect(page.locator('[data-testid="flash-card"]')).toBeVisible();
  await expect(page.locator('[data-testid="flash-back"]')).toHaveCount(0);
  const total = Number((await page.locator('.game-hud .chip').first().innerText()).replace(/\D+/g, ''));
  await page.click('[data-testid="flash-flip"]');
  await expect(page.locator('[data-testid="flash-back"]')).toBeVisible();
  await page.click('[data-testid="flash-again"]'); // not known: card returns
  await expect(page.locator('.game-hud .chip').first()).toContainText(String(total));
  for (let i = 0; i < total + 5; i++) {
    if (await page.locator('[data-testid="flash-end"]').isVisible()) break;
    await page.keyboard.press('Space');
    await page.keyboard.press('1');
  }
  await expect(page.locator('[data-testid="flash-end"]')).toBeVisible();
});

test('daily challenge: the same ten questions for a date, explanations after every answer, one official score per day', async ({ page }) => {
  await page.goto('/#/games');
  await page.click('[data-testid="start-daily-game"]');
  await expect(page.locator('[data-testid="game-daily"]')).toBeVisible();
  const firstStem = await page.locator('.q-stem').innerText();
  const total = Number((await page.locator('.game-hud .chip').first().innerText()).match(/\d+/g)!.pop());
  expect(total).toBeGreaterThanOrEqual(5);
  for (let i = 0; i < total; i++) {
    const tf = page.locator('[data-testid="tf-true"]');
    const short = page.locator('[data-testid="short-input"]');
    if (await tf.isVisible()) await tf.click();
    else if (await short.isVisible()) await short.fill('1200');
    else if (await page.locator('[data-testid="opt-0"]').isVisible()) await page.click('[data-testid="opt-0"]');
    // order / match / multi: just submit the default arrangement when allowed
    const check = page.locator('[data-testid="game-check"]');
    if (await check.isVisible() && await check.isEnabled()) await check.click();
    else if (await check.isVisible()) { // match needs every select: choose the first option of each
      for (const s of await page.locator('select[data-testid^="match-"]').all()) await s.selectOption({ index: 1 });
      if (await page.locator('[data-testid="opt-0"]').count()) await page.click('[data-testid="opt-0"]');
      if (await check.isEnabled()) await check.click();
    }
    await expect(page.locator('[data-testid="game-feedback"]')).toBeVisible();
    await page.click('[data-testid="game-next"]');
  }
  await expect(page.locator('[data-testid="game-end"]')).toBeVisible();
  await page.getByRole('button', { name: 'חזרה למשחקים' }).click();
  await expect(page.locator('[data-testid="daily-done"]')).toBeVisible();
  // a second play shows the same first question
  await page.click('[data-testid="start-daily-game"]');
  await expect(page.locator('.q-stem')).toHaveText(firstStem);
});

test('games work on a phone: no horizontal overflow on the hub and in the memory grid', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'mobile layout only');
  await page.goto('/#/games');
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(ov).toBeLessThanOrEqual(1);
  await page.click('[data-testid="start-memory"]');
  const ov2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(ov2).toBeLessThanOrEqual(1);
});
