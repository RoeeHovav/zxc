import { expect, type Page } from '@playwright/test';
import fs from 'node:fs';

// All content here is SYNTHETIC (scripts/make-fixture.mjs). The suite exercises mechanics, not book facts.
let QS: any[] = [];
export function loadQuestions(file: string) { QS = JSON.parse(fs.readFileSync(file, 'utf8')).questions; return QS; }
const byStem = (stem: string) => QS.find((q) => q.stem === stem);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function stem(page: Page) { return (await page.locator('.q-stem').first().innerText()).trim(); }
export const optBtn = (page: Page, text: string) => page.locator('button.opt').filter({ has: page.locator('span', { hasText: new RegExp(`^${esc(text)}$`) }) }).first();

/** Answers the question currently on screen, correctly or (when wrong=true) incorrectly. Does NOT submit. */
export async function fill(page: Page, wrong = false) {
  const q = byStem(await stem(page));
  expect(q, 'question must exist in fixture').toBeTruthy();
  switch (q.type) {
    case 'mcq': case 'compare': {
      if (!wrong) { await optBtn(page, q.options.find((o: any) => o.id === q.correct).text).click(); break; }
      for (const o of q.options.filter((x: any) => x.id !== q.correct)) {            // first wrong option that is still enabled (tried ones are eliminated)
        const b = optBtn(page, o.text);
        if (await b.isEnabled()) { await b.click(); break; }
      }
      break;
    }
    case 'tf': await page.click(`[data-testid="tf-${wrong ? !q.correct : q.correct}"]`); break;
    case 'short': case 'blank': await page.fill('[data-testid="short-input"]', wrong ? 'תשובה שגויה' : q.accepted[0]); break;
    case 'multi': {
      const ids = wrong ? [q.options.find((o: any) => !q.correct.includes(o.id)).id] : q.correct;
      for (const id of ids) await optBtn(page, q.options.find((o: any) => o.id === id).text).click(); break;
    }
    case 'match': for (const l of q.left) { const r = q.right.find((x: any) => x.id === (wrong ? q.right.find((y: any) => y.id !== q.correct[l.id]).id : q.correct[l.id])); await page.selectOption(`[data-testid="match-${l.id}"]`, { label: r.text }); } break;
    case 'order': {
      const want = q.correct.map((id: string) => q.items.find((i: any) => i.id === id).text);
      if (wrong) { await page.locator('[data-testid="order-0"] button[aria-label="הזזה למטה"]').click(); const cur = await page.locator('[data-testid^="order-"]').allInnerTexts(); if (cur.every((t, i) => t.includes(want[i]))) await page.locator('[data-testid="order-0"] button[aria-label="הזזה למטה"]').click(); break; }
      for (let i = 0; i < want.length; i++) {
        const cur = (await page.locator('[data-testid^="order-"]').allInnerTexts()).map((t) => t.replace(/[\d\n▲▼\s]+$/g, '').replace(/^\d+\s*/, ''));
        const j = cur.findIndex((t) => t.includes(want[i]));
        for (let k = j; k > i; k--) await page.locator(`[data-testid="order-${k}"] button[aria-label="הזזה למעלה"]`).click();
      }
      break;
    }
  }
  return q;
}

export async function takeAssessment(page: Page, lessonId: string, wrongCount: number) {
  await page.goto('/#/guided');                       // leave the route first: the same hash would not remount the page
  await page.waitForSelector('[data-testid^="lesson-"]');
  await page.goto(`/#/assess/${lessonId}`);
  await page.click('[data-testid="start-assessment"]');
  const stems: string[] = [];
  let remainingWrong = wrongCount;
  for (;;) {
    await page.waitForSelector('.q-stem');
    stems.push(await stem(page));
    await fill(page, remainingWrong > 0 && (remainingWrong--, true));
    const label = await page.locator('[data-testid="confirm-answer"]').innerText();
    await page.click('[data-testid="confirm-answer"]');
    if (label.includes('סיום')) break;
  }
  await page.waitForSelector('[data-testid="assessment-result"]');
  return stems;
}

