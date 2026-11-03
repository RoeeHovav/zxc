// End-to-end acceptance test of the essential user scenario, driven in Chromium.
// Runs the real app (server + UI) with the deterministic test-tone speech engine.
//   node tests/e2e/acceptance.cjs          (needs: playwright, python deps)
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PY = process.env.PYTHON || 'python3';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'narrator-e2e-'));
const DATA = path.join(TMP, 'data');
const PORT = 8800 + Math.floor(Math.random() * 100);
const URL = `http://127.0.0.1:${PORT}/`;
let server;

function log(...a) { console.log('[e2e]', ...a); }
function check(cond, msg) { if (!cond) throw new Error('CHECK FAILED: ' + msg); log('✓', msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  server = spawn(PY, ['-m', 'narrator', '--port', String(PORT), '--no-browser'], {
    cwd: ROOT, env: { ...process.env, NARRATOR_DATA_DIR: DATA, NARRATOR_TEST_MODE: '1' }, stdio: 'inherit',
  });
}
async function waitServer() {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(URL + 'api/state'); if (r.ok) return; } catch {}
    await sleep(250);
  }
  throw new Error('server did not start');
}
function stopServer() { return new Promise((r) => { if (!server) return r(); server.on('exit', r); server.kill('SIGTERM'); }); }

function buildBigPdf() {
  const user = path.join(ROOT, 'tests', 'private', 'user.pdf');
  const out = path.join(TMP, 'big_hebrew.pdf');
  const code = `
import pymupdf, os, sys
user, he, out = sys.argv[1], sys.argv[2], sys.argv[3]
doc = pymupdf.open()
if os.path.exists(user):
    doc.insert_pdf(pymupdf.open(user))
src = pymupdf.open(he)
while doc.page_count < 520:
    doc.insert_pdf(src)
doc.save(out)
print(doc.page_count)`;
  const pages = execFileSync(PY, ['-c', code, user, path.join(ROOT, 'tests/fixtures/he_mixed.pdf'), out]).toString().trim();
  return { file: out, pages: Number(pages), real: fs.existsSync(user) };
}

async function narr(page, expr) { return page.evaluate(new Function('return (' + expr + ')')); }

(async () => {
  const big = buildBigPdf();
  log(`built ${big.pages}-page Hebrew test PDF (user document included: ${big.real})`);
  startServer();
  await waitServer();
  let browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  let page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // 1-2. launch and open a 500+ page PDF
  await page.goto(URL);
  await page.setInputFiles('[data-testid=file-input]', big.file);
  await page.waitForSelector('[data-testid=viewer] .page img', { timeout: 60000 });
  const total = await page.textContent('.page-ind');
  check(total.includes(String(big.pages)), `opened ${big.pages}-page document (${total.trim()})`);
  const docUrl = page.url();

  // 3. navigate to a Hebrew chapter
  const target = big.real ? 201 : 400; // page 201 of the booklet: history chapter
  await page.fill('[data-testid=page-input]', String(target));
  await page.press('[data-testid=page-input]', 'Enter');
  const P = target - 1;
  await page.waitForSelector(`.page[data-page="${P}"] .w`, { timeout: 30000 });
  await sleep(500);

  // 4. select a whole paragraph by dragging over it
  const layout = await page.evaluate(async ([P]) => {
    const id = location.hash.split('/')[2];
    return (await fetch(`/api/documents/${id}/pages/${P}/layout`)).json();
  }, [P]);
  const ui = layout.unit_kinds.findIndex((k, i) => k === 'paragraph' && layout.word_unit.filter((u) => u === i).length > 25);
  const idxs = layout.word_unit.map((u, i) => (u === ui ? i : -1)).filter((i) => i >= 0);
  const a = idxs[0], b = idxs[idxs.length - 1];
  const wa = page.locator(`.page[data-page="${P}"] .w[data-w="${a}"]`);
  const wb = page.locator(`.page[data-page="${P}"] .w[data-w="${b}"]`);
  await wa.scrollIntoViewIfNeeded();
  const ba = await wa.boundingBox(), bb = await wb.boundingBox();
  await page.mouse.move(ba.x + ba.width / 2, ba.y + ba.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForSelector('[data-testid=selection-bar]');
  check((await page.locator('.hl.select').count()) > 0, `paragraph selected (${idxs.length} words) and highlighted`);

  // 5. press play (read selection)
  await page.click('[data-testid=read-selection]');
  await page.waitForFunction(() => window.__narrator && window.__narrator.status === 'playing', null, { timeout: 30000 });
  check(true, 'narration started');

  // 7. highlighting follows the narration, in sync with audio time
  const w1 = await narr(page, 'window.__narrator.pos.pageWord');
  await sleep(1500);
  const w2 = await narr(page, 'window.__narrator.pos.pageWord');
  check(w2 > w1, `highlighted word advances with audio (${w1} -> ${w2})`);
  check(w1 >= a && w2 <= b, 'highlighted words stay inside the selection');
  const hl = await page.locator(`.page[data-page="${P}"] .hl.word`).boundingBox();
  const cur = await narr(page, 'window.__narrator.pos.pageWord');
  const wbox = await page.locator(`.page[data-page="${P}"] .w[data-w="${cur}"]`).boundingBox();
  check(hl && wbox && Math.abs(hl.x - wbox.x) < 6 && Math.abs(hl.y - wbox.y) < 6, 'word highlight box sits exactly on the spoken word');
  check((await page.locator('.hl.sentence').count()) > 0, 'current sentence highlighted');
  check((await page.textContent('[data-testid=timing]')).includes('word'), 'player reports word-level sync');

  // 8. adjust speed
  await page.selectOption('.speed select', '1.5');
  await sleep(300);
  const rate = await page.evaluate(() => document.querySelector('audio') ? 0 : window.__narrator.rate);
  check(rate === 1.5, 'playback speed set to 1.5x');
  const t0 = await narr(page, 'window.__narrator.currentTime');
  await sleep(1000);
  const t1 = await narr(page, 'window.__narrator.currentTime');
  check(t1 - t0 > 1.2, `audio advances faster than real time at 1.5x (${(t1 - t0).toFixed(2)}s per 1s)`);

  // 9. skip backward / forward
  await page.selectOption('.speed select', '1');
  const gpos = '[window.__narrator.pos.page, window.__narrator.pos.pageWord]';
  await sleep(2500); // be well into the passage
  const before = await narr(page, gpos);
  await page.keyboard.press('ArrowLeft');
  await sleep(50);
  await page.waitForFunction(() => window.__narrator.status === 'playing', null, { timeout: 15000 });
  await sleep(300);
  const afterBack = await narr(page, gpos);
  const earlier = afterBack[0] < before[0] || (afterBack[0] === before[0] && afterBack[1] < before[1]);
  check(earlier, `skip back moved to an earlier word (${before} -> ${afterBack})`);
  await page.keyboard.press('ArrowRight');
  await sleep(50);
  await page.waitForFunction(() => window.__narrator.status === 'playing', null, { timeout: 15000 });
  await sleep(300);
  const afterFwd = await narr(page, gpos);
  const later = afterFwd[0] > afterBack[0] || (afterFwd[0] === afterBack[0] && afterFwd[1] > afterBack[1]);
  check(later, `skip forward moved to a later word (${afterBack} -> ${afterFwd})`);
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForFunction(() => window.__narrator.status === 'playing', null, { timeout: 15000 });
  await sleep(300);
  const afterNext = await narr(page, 'window.__narrator.pos.sentence');
  check(afterNext >= 1, 'next-sentence navigation works');

  // 10. pause, close the application, reopen it, resume
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__narrator.status === 'paused');
  const saved = await narr(page, '({unit: window.__narrator.pos.unit.id, word: window.__narrator.pos.word, page: window.__narrator.pos.page})');
  await sleep(500);
  check(true, `paused at unit ${saved.unit}, word ${saved.word}`);
  await browser.close();
  await stopServer();
  log('application closed; restarting');
  startServer();
  await waitServer();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.waitForSelector('[data-testid=doc-card]');
  await page.click('[data-testid=doc-card]');
  await page.waitForSelector('[data-testid=resume-banner]', { timeout: 30000 });
  check((await page.textContent('[data-testid=resume-banner]')).includes(String(saved.page + 1)), `resume offered at page ${saved.page + 1}`);
  await page.click('[data-testid=resume]');
  await page.waitForFunction(() => window.__narrator.status === 'playing', null, { timeout: 30000 });
  const resumed = await narr(page, '({unit: window.__narrator.pos.unit.id, word: window.__narrator.pos.word})');
  check(resumed.unit === saved.unit && Math.abs(resumed.word - saved.word) <= 2, `resumed where it stopped (${resumed.unit}/${resumed.word})`);
  await page.keyboard.press('Space');

  // 11. switch to an English document
  await page.goto(URL);
  await page.setInputFiles('[data-testid=file-input]', path.join(ROOT, 'tests/fixtures/en_academic.pdf'));
  await page.waitForSelector('.page[data-page="0"] .w', { timeout: 30000 });
  const enLayout = await page.evaluate(async () => {
    const id = location.hash.split('/')[2];
    return (await fetch(`/api/documents/${id}/pages/0/layout`)).json();
  });
  const enWord = enLayout.words.findIndex((w) => w[0] === 'Reading');
  await page.dblclick(`.page[data-page="0"] .w[data-w="${enWord}"]`);
  await page.waitForFunction(() => window.__narrator && window.__narrator.status === 'playing', null, { timeout: 30000 });
  const en = await narr(page, '({lang: window.__narrator.pos.unit.lang, text: window.__narrator.pos.unit.text.slice(0, 40)})');
  check(en.lang === 'en', `English document narrated with English routing ("${en.text}…")`);
  await page.screenshot({ path: path.join(TMP, 'english.png') });

  check(errors.length === 0, 'no JavaScript errors: ' + JSON.stringify(errors));
  await browser.close();
  await stopServer();
  log('ACCEPTANCE SCENARIO PASSED');
  process.exit(0);
})().catch(async (e) => {
  console.error(e);
  try { await stopServer(); } catch {}
  process.exit(1);
});
