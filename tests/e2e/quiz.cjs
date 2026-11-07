// End-to-end check of the comprehension checkpoints, driven in Chromium against the real app and UI.
// The question writer is a pretend model (NARRATOR_TEST_MODE=1), so no network or key is needed.
//   node tests/e2e/quiz.cjs
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PY = process.env.PYTHON || 'python3';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'narrator-quiz-e2e-'));
const PORT = 8900 + Math.floor(Math.random() * 100);
const URL = `http://127.0.0.1:${PORT}/`;
let server;
const log = (...a) => console.log('[quiz-e2e]', ...a);
const check = (c, m) => { if (!c) throw new Error('CHECK FAILED: ' + m); log('✓', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const put = (body) => fetch(URL + 'api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

(async () => {
  server = spawn(PY, ['-m', 'narrator', '--port', String(PORT), '--no-browser'], {
    cwd: ROOT, env: { ...process.env, NARRATOR_DATA_DIR: path.join(TMP, 'data'), NARRATOR_TEST_MODE: '1' }, stdio: 'inherit',
  });
  for (let i = 0; i < 120; i++) { try { if ((await fetch(URL + 'api/state')).ok) break; } catch {} await sleep(250); }
  await put({ buffer_percent: 0, free_fallback: false, speed: 3, quiz_minutes: 2 });
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(URL);
    await page.setInputFiles('[data-testid=file-input]', path.join(ROOT, 'tests/fixtures/he_mixed.pdf'));
    await page.waitForSelector('[data-testid=viewer] .page img', { timeout: 60000 });

    // turning checkpoints on asks permission first (text of the stretch goes to Gemini)
    await page.selectOption('[data-testid=quiz-mode]', 'paragraph');
    await page.waitForSelector('[data-testid=consent]', { timeout: 5000 });
    const consentText = await page.textContent('body');
    check(/Gemini/.test(consentText), 'permission is asked before any text is sent');
    await page.click('[data-testid=consent-allow]');
    await sleep(500);
    const saved = (await (await fetch(URL + 'api/state')).json()).settings;
    check(saved.quiz_mode === 'paragraph' && saved.quiz_style === 'choice', 'the mode is saved, with multiple-choice questions');
    await put({ quiz_style: 'mixed' }); // the rest of this run also checks the open question

    // listen: at the end of the page the narration waits and the questions appear
    await page.click('[data-testid=play]');
    await page.waitForSelector('[data-testid=quiz]', { timeout: 150000 });
    check(true, 'a checkpoint appears at the end of the stretch');
    await page.waitForSelector('[data-testid=quiz-question]', { timeout: 30000 });
    check((await page.textContent('[data-testid=quiz-question]')).length > 10, 'the first question is shown');
    const status = await page.evaluate(() => document.querySelector('[data-testid=play]').getAttribute('aria-label'));
    check(/play|השמע/i.test(status), 'narration is waiting while the questions are open (' + status + ')');

    // answer: keyboard 1-4 or click; feedback shows the explanation and the replay button
    await page.keyboard.press('2');
    await page.waitForSelector('[data-testid=quiz-feedback]', { timeout: 5000 });
    check(true, 'answering shows feedback');
    await page.click('[data-testid=quiz-hear]');
    await sleep(1500);
    check(await page.isVisible('[data-testid=quiz]'), 'hearing the part again keeps the questions open');
    await page.click('[data-testid=quiz-next]');
    await page.waitForSelector('[data-testid=quiz-question]');
    await page.click('[data-testid=quiz-opt-0]');
    await page.click('[data-testid=quiz-next]');

    // the open question: type, reveal, rate
    await page.waitForSelector('[data-testid=quiz-text]', { timeout: 5000 });
    check(true, 'the third question asks for an answer in the listener\'s own words');
    await page.fill('[data-testid=quiz-text]', 'something I remember');
    await page.click('[data-testid=quiz-reveal]');
    await page.click('[data-testid=quiz-partly]');
    await page.waitForSelector('[data-testid=quiz-score]', { timeout: 5000 });
    const score = (await page.textContent('[data-testid=quiz-score]')).replace(/\s/g, '');
    check(/^\d(\.5)?\/3$/.test(score), 'a score is shown (' + score + ')');

    await page.click('[data-testid=quiz-continue]');
    await sleep(500);
    check(!(await page.isVisible('[data-testid=quiz]')), 'continuing closes the card');
    await page.waitForFunction(() => /pause|השהי/i.test(document.querySelector('[data-testid=play]').getAttribute('aria-label') || ''), null, { timeout: 20000 });
    check(true, 'after the questions the narration carries on by itself');
    check(errors.length === 0, 'no page errors: ' + errors.join('; '));
    log('ALL PASSED');
  } catch (e) {
    await page.screenshot({ path: path.join(TMP, 'fail.png') }).catch(() => {});
    log('FAILED:', e.message, '(screenshot in', TMP + ')');
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
})();
