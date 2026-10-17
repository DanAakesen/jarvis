import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const columns = ['backlog', 'needs_dan', 'ready', 'in_progress', 'in_review', 'done'];
const task = {
  id: '43', projectId: '7', title: 'Browser fixture task', request: 'Synthetic browser verification',
  agent: 'copilot', state: 'Ready', activity: null, attemptCount: 0, branch: null,
  createdAt: '2026-10-17T20:00:00.000Z', startedAt: null, finishedAt: null,
  issueUrl: 'https://github.com/example/fixture/issues/108', issueNumber: 108,
};
const outcomes = [];
try {
  for (const width of [1440, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    let mode = 'success';
    const submissions = [];
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === 'http://127.0.0.1:5188') return route.continue();
      if (url.origin !== 'https://fixture.invalid') return route.abort();
      const json = (body, status = 200) => route.fulfill({
        status, contentType: 'application/json', body: JSON.stringify(body),
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
      if (url.pathname === '/factory/projects') return json([{
        id: '7', name: 'Browser fixture project', default_agent: 'copilot',
      }]);
      if (url.pathname === '/factory/board') return json({
        project: { id: '7', repo: 'example/fixture' },
        fetchedAt: '2026-10-17T20:00:00.000Z', stale: false,
        columns: columns.map((id) => ({ id, cards: [] })),
      });
      if (url.pathname === '/factory/projects/7/releases') return json({
        project: { id: '7', name: 'Browser fixture project', repo: 'example/fixture', defaultBranch: 'main' },
        releases: [], pullRequests: [], workflowRuns: [], deployments: [], graph: null,
      });
      if (url.pathname === '/factory/tasks' && request.method() === 'POST') {
        submissions.push(request.postDataJSON());
        await new Promise((resolve) => setTimeout(resolve, 700));
        return mode === 'success' ? json(task, 201) : json({
          error: 'Issue #109 was created, but linking the task failed. Retry to finish linking.',
        }, 503);
      }
      if (url.pathname.includes('/events')) return route.fulfill({
        status: 200, contentType: 'text/event-stream', body: ': fixture\n\n',
      });
      if (url.pathname === '/settings') return json({});
      return json({ error: 'Unavailable in synthetic browser fixture.' }, 404);
    });
    await page.goto('http://127.0.0.1:5188/factory/kanban');
    await page.getByRole('heading', { name: 'Kanban', exact: true }).waitFor();
    const openForm = async () => {
      await page.getByRole('button', { name: 'Create task', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Create task' });
      await dialog.getByRole('textbox', { name: 'Task title', exact: true }).fill('Browser fixture task');
      await dialog.getByRole('textbox', { name: 'Request', exact: true }).fill('Synthetic browser verification');
      return dialog;
    };
    let dialog = await openForm();
    const create = dialog.getByRole('button', { name: 'Create task', exact: true });
    await create.evaluate((button) => { button.click(); button.click(); });
    await dialog.getByRole('button', { name: 'Creating task…', exact: true }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Creating task…', exact: true }).isDisabled(), true);
    const link = page.getByRole('link', { name: 'issue #108', exact: true });
    await link.waitFor();
    assert.equal(await link.getAttribute('href'), task.issueUrl);
    assert.equal((await link.locator('..').textContent()).trim(), 'Task created and linked to issue #108');
    assert.equal(submissions.length, 1);
    await page.screenshot({ path: `.scratch-p10-08/success-${width}.png`, fullPage: true });
    mode = 'error';
    dialog = await openForm();
    await dialog.getByRole('button', { name: 'Create task', exact: true }).click();
    const alert = dialog.getByRole('alert');
    await alert.waitFor();
    assert.equal(await alert.textContent(), 'Issue #109 was created, but linking the task failed. Retry to finish linking.');
    assert.equal(await dialog.getByRole('textbox', { name: 'Task title', exact: true }).inputValue(), task.title);
    assert.equal(await dialog.getByRole('textbox', { name: 'Request', exact: true }).inputValue(), task.request);
    assert.equal(await dialog.getByRole('button', { name: 'Create task', exact: true }).isEnabled(), true);
    const geometry = await dialog.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
      viewport: innerWidth,
      pageWidth: document.documentElement.scrollWidth,
      scrollTop: element.scrollTop,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY,
      overflowingFields: [...element.querySelectorAll('input, textarea, select, button, [role="alert"]')]
        .filter((field) => field.getBoundingClientRect().right > innerWidth + 1).length,
    }));
    assert.equal(geometry.overflowingFields, 0);
    assert.ok(geometry.left >= 0 && geometry.right <= width + 1);
    await alert.scrollIntoViewIfNeeded();
    assert.ok(await alert.isVisible());
    await page.screenshot({ path: `.scratch-p10-08/error-${width}.png` });
    await dialog.getByRole('button', { name: 'Create task', exact: true }).click();
    await page.getByRole('button', { name: 'Creating task…', exact: true }).waitFor();
    await alert.waitFor();
    assert.equal(submissions.length, 3);
    assert.equal(submissions[1].submissionId, submissions[2].submissionId);
    assert.notEqual(submissions[0].submissionId, submissions[1].submissionId);
    assert.deepEqual(pageErrors, []);
    outcomes.push({ width, successLink: true, doubleSubmitGuard: true, partialErrorRetainedForm: true, stableRetry: true, geometry, pageErrors });
    await context.close();
  }
  console.log(JSON.stringify(outcomes, null, 2));
} finally {
  await browser.close();
}
