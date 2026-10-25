import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const repositoryRoot = resolve(import.meta.dirname, '..');
const webRoot = resolve(repositoryRoot, 'apps/web');
const screenshotDirectory = resolve(repositoryRoot,
  process.env.WORKSPACE_SCREENSHOT_DIR ?? 'docs/ui/screenshots/workspace-content');
const playwrightModule = process.env.PLAYWRIGHT_CORE_MODULE ?? 'playwright-core';
const { chromium } = await import(
  playwrightModule.startsWith('/') ? pathToFileURL(playwrightModule).href : playwrightModule
);
const vite = await createServer({
  configFile: resolve(webRoot, 'vite.config.ts'),
  root: webRoot,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, strictPort: false },
});
let browser;

function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
}

async function noPageOverflow(page, label) {
  const size = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert(size.document <= size.viewport, `${label}: document overflowed (${JSON.stringify(size)})`);
  assert(size.body <= size.viewport, `${label}: body overflowed (${JSON.stringify(size)})`);
  return size;
}

async function foreground(page, title) {
  await page.getByRole('button', { name: `Show ${title}` }).click();
  await page.getByRole('article', { name: title }).waitFor({ state: 'visible' });
}

async function capture(page, name) {
  const controls = page.locator('.workspace-browser-fixture-controls');
  await controls.evaluate((element) => { element.hidden = true; });
  try {
    await page.screenshot({ path: resolve(screenshotDirectory, name) });
  } finally {
    await controls.evaluate((element) => { element.hidden = false; });
  }
}

async function verifyPage(page, width, height, label) {
  await page.setViewportSize({ width, height });
  await page.waitForFunction((expected) => window.innerWidth === expected, width);
  await page.waitForTimeout(80);
  const workspace = page.locator('.workspace');
  const isPhone = await workspace.getAttribute('data-phone');
  equal(isPhone, String(width <= 700 || (height <= 500 && width <= 900)), `${label}: workspace phone layout`);
  return noPageOverflow(page, label);
}

await mkdir(screenshotDirectory, { recursive: true });
try {
  await vite.listen();
  const address = vite.httpServer.address();
  assert(address && typeof address !== 'string', 'Vite did not provide a local HTTP port');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext({
    viewport: { width: 320, height: 700 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto(`${baseUrl}/browser-tests/workspace-content.html`, { waitUntil: 'networkidle' });
  try {
    await page.locator('.code-view-wrap input').waitFor({ state: 'visible' });
  } catch (error) {
    const body = await page.locator('body').innerText().catch(() => '');
    throw new Error(`Workspace fixture did not render: ${body}; page errors=${pageErrors.join('; ')}; console=${consoleErrors.join('; ')}`, { cause: error });
  }

  const sourceLine = 'Exact selection sample.';
  const codeLine = page.locator('[data-line="5"] .code-line-text');
  const wrappedIdentifier = page.locator('[data-line="3"] .code-line-text');
  const codeBody = page.locator('.code-view-body');
  const checkbox = page.getByRole('checkbox', { name: 'Wrap lines' });
  equal(await checkbox.isChecked(), true, 'repository lines wrap by default');
  equal(await codeLine.textContent(), sourceLine, 'the rendered source line stays exact');
  assert(await wrappedIdentifier.evaluate((element) =>
    element.getBoundingClientRect().height > Number.parseFloat(getComputedStyle(element).lineHeight) * 1.5),
  'long repository identifiers wrap across visual lines');
  equal(await page.locator('[data-line="6"]').evaluate((element) => element.hasAttribute('data-highlighted')), true,
    'highlighted line remains present');
  equal(await page.locator('mark.code-match').count(), 2, 'search matches remain marked');

  await codeLine.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  equal(await page.evaluate(() => window.getSelection()?.toString()), sourceLine, 'selected code text is exact');
  await page.keyboard.press('Control+C');
  equal(await page.evaluate(() => navigator.clipboard.readText()), sourceLine, 'clipboard copy is exact');
  await page.evaluate(() => window.getSelection()?.removeAllRanges());

  await checkbox.uncheck();
  assert(await codeBody.evaluate((element) => element.scrollWidth > element.clientWidth), 'original-lines mode scrolls inside the code body');
  await noPageOverflow(page, '320px unwrapped code');
  await checkbox.check();
  assert(await codeBody.evaluate((element) => element.scrollWidth <= element.clientWidth), 'wrapped code fits the allocated window');

  await verifyPage(page, 320, 700, '320x700 phone');
  await capture(page, 'workspace-320-code.png');

  const tableTitle = 'Wide synthetic table';
  await foreground(page, tableTitle);
  const tableRegion = page.getByRole('region', { name: `Scrollable table: ${tableTitle}` });
  await tableRegion.focus();
  equal(await tableRegion.evaluate((element) => element === document.activeElement), true, 'table scroll region can receive keyboard focus');
  const tableSize = await tableRegion.evaluate((element) => ({
    width: element.clientWidth, scrollWidth: element.scrollWidth,
    values: element.querySelectorAll('tbody td').length,
  }));
  assert(tableSize.scrollWidth > tableSize.width, 'wide table scroll remains local');
  equal(tableSize.values, 40, 'all table values are present');
  await tableRegion.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  assert(await tableRegion.evaluate((element) => element.scrollLeft > 0), 'table is horizontally explorable');
  await noPageOverflow(page, '320px local table scroll');
  await tableRegion.evaluate((element) => { element.scrollLeft = 0; });
  await foreground(page, tableTitle);
  await verifyPage(page, 375, 812, '375x812 phone');
  await capture(page, 'workspace-375-table.png');

  const chartTitle = 'Long-label chart';
  await foreground(page, chartTitle);
  const chartRegion = page.getByRole('region', { name: `Scrollable chart plot: ${chartTitle}` });
  await chartRegion.focus();
  equal(await chartRegion.evaluate((element) => element === document.activeElement), true, 'chart scroll region can receive keyboard focus');
  equal(await page.locator('.chart-x-label').count(), 3, 'all chart category labels remain present');
  equal(await page.locator('.chart-values tbody tr').count(), 3,
    'chart values remain available in the table');
  assert(await chartRegion.evaluate((element) => element.scrollWidth > element.clientWidth), 'long chart labels scroll locally');
  await chartRegion.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  assert(await chartRegion.evaluate((element) => element.scrollLeft > 0), 'chart is horizontally explorable');
  await chartRegion.evaluate((element) => { element.scrollLeft = 0; });
  await verifyPage(page, 390, 844, '390x844 phone');
  await capture(page, 'workspace-390-chart.png');
  await page.locator('.workspace-window[data-view-id="chart"]')
    .getByRole('button', { name: 'Close Long-label chart' }).click();
  await page.getByRole('article', { name: chartTitle }).waitFor({ state: 'detached' });
  await page.getByTestId('reopen-chart').click();
  await foreground(page, chartTitle);
  await noPageOverflow(page, 'phone after close and reopen');
  await foreground(page, 'Synthetic README');
  await noPageOverflow(page, 'phone foreground switch');

  await page.getByTestId('toggle-theme').click();
  equal(await page.locator('html').getAttribute('data-theme'), 'dark', 'dark theme fixture is applied');
  await noPageOverflow(page, 'dark phone');
  await page.getByTestId('toggle-theme').click();
  await verifyPage(page, 844, 390, '844x390 touch landscape');
  const highDensity = await browser.newContext({
    viewport: { width: 160, height: 350 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const zoomApproximation = await highDensity.newPage();
  await zoomApproximation.goto(`${baseUrl}/browser-tests/workspace-content.html`, { waitUntil: 'networkidle' });
  equal(await zoomApproximation.evaluate(() => window.devicePixelRatio), 2, 'high-density viewport uses DPR 2');
  await noPageOverflow(zoomApproximation, '160px CSS viewport at DPR 2');
  await highDensity.close();

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(() => document.querySelector('.workspace')?.getAttribute('data-phone') === 'false');
  await noPageOverflow(page, '1440x1000 desktop');
  await capture(page, 'workspace-1440-desktop.png');
  await page.getByTestId('constrain-workspace').click();
  await page.waitForFunction(() => document.querySelector('.workspace-browser-fixture-stage')?.clientWidth === 520);
  await foreground(page, 'Synthetic README');
  const narrowWidth = await page.locator('.workspace-window[data-view-id="readme"]').evaluate((element) => element.clientWidth);
  assert(narrowWidth > 0 && narrowWidth < 520, `narrow desktop window should have a constrained content width, got ${narrowWidth}`);
  await capture(page, 'workspace-520-narrow-desktop.png');
  await page.getByTestId('expand-workspace').click();
  await page.setViewportSize({ width: 1024, height: 900 });
  await noPageOverflow(page, 'desktop viewport resized after opening windows');
  await page.getByTestId('constrain-workspace').click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await noPageOverflow(page, 'narrow desktop after viewport resize');
  assert.deepEqual(pageErrors, [], `browser page errors: ${pageErrors.join('; ')}`);
  assert.deepEqual(consoleErrors, [], `browser console errors: ${consoleErrors.join('; ')}`);
  await context.close();

  console.log(JSON.stringify({
    browser: await browser.version(),
    viewportChecks: ['320x700', '375x812', '390x844', '844x390 touch landscape', '160x350 CSS viewport at DPR 2', '1440x1000 desktop', '520px embedded workspace on 1440px desktop', '1024x900 resized after opening'],
    checks: ['page overflow', 'wrapped/unwrapped repository text', 'exact selected code and clipboard copy', 'line highlight and search marks', 'focusable local table/chart scrolling and retained values', 'foreground switching', 'close/reopen', 'light/dark', 'container-width resize'],
    screenshots: [
      'workspace-320-code.png', 'workspace-375-table.png', 'workspace-390-chart.png',
      'workspace-1440-desktop.png', 'workspace-520-narrow-desktop.png',
    ],
  }, null, 2));
} finally {
  await browser?.close();
  await vite.close();
}
