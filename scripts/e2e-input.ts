/**
 * Mechanics check for trusted input, no model needed: loads the test build headless, attaches
 * chrome.debugger from the service worker and drives the exact prepare → dispatch → settle path
 * the agent uses. Run: npm run build:test && tsx scripts/e2e-input.ts
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const DIST = path.resolve(process.env.E2E_DIST || 'dist-test');
const FIXTURES = path.resolve('scripts/e2e-fixtures');

async function serveFixtures(): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    const name = path.basename(new URL(req.url || '/', 'http://x').pathname) || 'index.html';
    const file = path.join(FIXTURES, name);
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}/`, close: () => server.close() };
}

/** Runs inside the service worker: the agent's act path for one labelled control (source text, so tsx adds no helpers). */
const actInWorker = String.raw`async ({ url, label, kind, text }) => {
  const [tab] = await chrome.tabs.query({ url });
  if (!tab?.id) throw new Error('no tab for ' + url);
  const tabId = tab.id;
  const send = (m) => chrome.tabs.sendMessage(tabId, m);
  const observe = await send({ type: 'CONTENT_OBSERVE' });
  const action = observe.snapshot.actions.find((a) => a.label === label && a.kind === kind);
  if (!action) throw new Error('no ' + kind + ' "' + label + '" in ' + observe.snapshot.actions.map((a) => a.kind + ':' + a.label).join(', '));
  try { await chrome.debugger.attach({ tabId }, '1.3'); } catch (e) { if (!/already attached/i.test(e.message)) throw e; }
  const cmd = (method, params) => chrome.debugger.sendCommand({ tabId }, method, params);
  const prep = await send({ type: 'CONTENT_PREPARE', action, text });
  if (!prep.ok || prep.done) return { prep };
  if (kind === 'click' || kind === 'fill') {
    await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: prep.x, y: prep.y, button: 'none' });
    await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: prep.x, y: prep.y, button: 'left', clickCount: 1 });
    await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: prep.x, y: prep.y, button: 'left', clickCount: 1 });
  }
  if (kind === 'fill') await cmd('Input.insertText', { text });
  if (kind === 'key') {
    const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
    await cmd('Input.dispatchKeyEvent', { type: 'keyDown', text: '\r', unmodifiedText: '\r', ...key });
    await cmd('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  }
  await send({ type: 'CONTENT_SETTLE' }).catch(() => undefined);
  return { prep };
}`;

async function main() {
  const fixtures = await serveFixtures();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-input-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: process.env.CHROMIUM_PATH ? undefined : 'chromium',
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--no-sandbox', '--disable-gpu', '--silent-debugger-extension-api'],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const results: Array<[string, boolean, string]> = [];
  const check = (name: string, ok: boolean, detail = '') => { results.push([name, ok, detail]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

  try {
    // 1. javascript: link, clicked with trusted input (no main-world workaround involved)
    const page = await context.newPage();
    await page.goto(fixtures.url + 'js-link.html');
    await page.waitForTimeout(300);
    await sw.evaluate(`(${actInWorker})(${JSON.stringify({ url: page.url(), label: 'Show tracking details', kind: 'click' })})`);
    check('javascript: link runs via CDP click', await page.locator('#more').isVisible(), await page.locator('#more').evaluate((e) => getComputedStyle(e).display));

    // 2. isTrusted on a plain button
    const search = await context.newPage();
    await search.goto(fixtures.url + 'search.html');
    await search.waitForTimeout(300);
    await sw.evaluate(`(${actInWorker})(${JSON.stringify({ url: search.url(), label: 'Probe trust', kind: 'click' })})`);
    check('click is trusted', (await search.title()) === 'clicked trusted=true', await search.title());

    // 3. fill replaces the old value with insertText, then Enter submits the form
    const r = await sw.evaluate(`(${actInWorker})(${JSON.stringify({ url: search.url(), label: 'Search', kind: 'fill', text: 'blue widgets' })})`);
    check('fill via insertText replaces the value', (await search.inputValue('input[name=q]')) === 'blue widgets', `value="${await search.inputValue('input[name=q]')}" prep=${JSON.stringify(r.prep)}`);
    await sw.evaluate(`(${actInWorker})(${JSON.stringify({ url: search.url(), label: 'Press Enter in the focused field "Search" to submit it', kind: 'key' })})`);
    await search.waitForURL(/results\.html/, { timeout: 5000 }).catch(() => undefined);
    check('Enter via CDP submits the form', /results\.html\?q=blue\+widgets/.test(search.url()), search.url());

    // 4. covered target is refused before any input is sent
    const covered = await context.newPage();
    await covered.goto(fixtures.url + 'search.html');
    await covered.waitForTimeout(300);
    await covered.evaluate(() => {
      const d = document.createElement('div');
      d.setAttribute('role', 'dialog');
      d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5)';
      d.textContent = 'Cookie wall';
      document.body.appendChild(d);
    });
    let refused: any;
    try {
      refused = await sw.evaluate(`(${actInWorker})(${JSON.stringify({ url: covered.url(), label: 'Probe trust', kind: 'click' })})`);
      check('covered target refused with a code', refused.prep?.ok === false && refused.prep?.code === 'covered', JSON.stringify(refused.prep));
    } catch (e: any) {
      check('covered target refused with a code', /no click "Probe trust"/.test(e.message), 'not even observed: ' + e.message.slice(0, 80));
    }
  } finally {
    await context.close();
    fixtures.close();
  }
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
