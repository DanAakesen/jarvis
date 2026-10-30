import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';
const root = resolve(import.meta.dirname, '..');
const module = process.env.PLAYWRIGHT_CORE_MODULE ?? 'playwright-core';
const { chromium } = await import(module.startsWith('/') ? pathToFileURL(module).href : module);
const vite = await createServer({ root: resolve(root, 'apps/web'), configFile: resolve(root, 'apps/web/vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false } });
const evidence = resolve(root, 'docs/ui/screenshots/runtime-test-1350');
await mkdir(evidence, { recursive: true });
let browser;
try {
  await vite.listen();
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox'] });
  const results = [];
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: theme === 'light' ? 'reduce' : 'no-preference' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const expectedConsole = [];
    page.on('console', message => {
      if (message.type() !== 'error') return;
      if (message.location().url === 'https://runtime-test.invalid/conversation/sessions' && message.text().includes('status of 503')) expectedConsole.push(message.text());
      else errors.push(message.text());
    });
    let creates = 0;
    let turns = 0;
    await page.route('https://runtime-test.invalid/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/conversation/sessions') {
        creates++;
        const body = route.request().postDataJSON();
        assert.equal(body.runtimeTest, 'current');
        if (creates === 1) return route.fulfill({ status: 503, json: { error: 'Synthetic failure.' } });
        return route.fulfill({ json: { id: '50', channel: 'chat', language: 'en', runtimeTest: 'current' } });
      }
      if (url.pathname === '/conversation/history') {
        assert.equal(url.searchParams.get('sessionId'), '50');
        return route.fulfill({ json: { messages: [], nextCursor: null } });
      }
      if (url.pathname === '/conversation/sessions/50/turns') {
        turns++;
        assert.equal(route.request().postDataJSON().text, 'A synthetic test message');
        const message = { id: '51', sessionId: '50', role: 'dan', text: 'A synthetic test message', model: null, at: '2026-10-29T12:00:00Z' };
        const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        return route.fulfill({ contentType: 'text/event-stream', body: frame('user', message) + frame('delta', { text: 'Synthetic reply for browser inspection.' }) + frame('done', { ...message, id: '52', role: 'jarvis', text: 'Synthetic reply for browser inspection.' }) });
      }
      throw new Error(`Unexpected synthetic request: ${url.pathname}`);
    });
    const address = vite.httpServer.address();
    await page.goto(`http://127.0.0.1:${address.port}/browser-tests/runtime-test.html`, { waitUntil: 'networkidle' });
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    await page.getByRole('button', { name: 'More options' }).click();
    await page.getByRole('menuitem', { name: 'Test agent runtime' }).click();
    await page.getByRole('dialog').waitFor();
    assert.equal(creates, 0);
    assert.equal(await page.getByRole('radio', { name: /Copilot/ }).isDisabled(), true);
    await page.getByRole('radio', { name: 'Current', exact: true }).check();
    await page.screenshot({ path: resolve(evidence, `selector-${width}-${theme}.png`) });
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('button', { name: 'More options' }).evaluate(el => el === document.activeElement), true);
    await page.getByRole('button', { name: 'More options' }).click();
    await page.getByRole('menuitem', { name: 'Test agent runtime' }).click();
    await page.getByRole('radio', { name: 'Current', exact: true }).check();
    await page.getByRole('button', { name: 'Open test conversation' }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(creates, 1);
    await page.screenshot({ path: resolve(evidence, `error-${width}-${theme}.png`) });
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByRole('heading', { name: 'Current test conversation' }).waitFor();
    await page.getByText('No test messages yet.').waitFor();
    await page.getByRole('textbox', { name: 'Message Current' }).fill('A synthetic test message');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByText('Synthetic reply for browser inspection.', { exact: true }).waitFor();
    assert.equal(turns, 1);
    await page.screenshot({ path: resolve(evidence, `conversation-${width}-${theme}.png`) });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false);
    await page.getByRole('button', { name: 'Return to normal conversation' }).click();
    assert.equal(creates, 2);
    assert.deepEqual(errors, []);
    assert.equal(expectedConsole.length, 1);
    results.push({ width, theme, creates, turns, overflow, errors, expectedConsole, checked: ['menu', 'unavailable', 'radio', 'escape', 'focus return', 'create failure', 'explicit retry', 'labelled separate conversation', 'scoped history', 'streamed test reply', 'return'] });
    await page.close();
  }
  await writeFile(resolve(evidence, 'browser.json'), JSON.stringify({ synthetic: true, browser: await browser.version(), results }, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser?.close(); await vite.close(); }
