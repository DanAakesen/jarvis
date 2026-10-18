import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextPanel, ContextPanelProvider } from '../ContextPanel';
import { FactoryArea } from './FactoryArea';
import { TasksPage } from './TasksPage';
import { factoryBoardColumnIds, type BoardCard, type FactoryBoard, type FactoryBoardColumnId } from '@jarvis/contracts';
import { publishFactoryBoardStatus, publishFactoryBoardUpdate, resetFactoryBoardForTests } from '../factory-board-store';
import { FactoryIssueNavigationContext, waitForFactoryIssue, type FactoryIssueNavigator } from '../page-navigation';

const streamHarness = vi.hoisted(() => ({
  callbacks: new Map<string, (event: { id: string; taskId: string; type: string; summary: string | null; at: string }) => void>(),
}));

vi.mock('../task-events', () => ({
  streamTaskEvents: vi.fn(async (options: {
    taskId: string;
    signal: AbortSignal;
    onEvent: (event: { id: string; taskId: string; type: string; summary: string | null; at: string }) => void;
    onStatus?: (status: 'connecting' | 'connected' | 'reconnecting' | 'error') => void;
  }) => {
    options.onStatus?.('connected');
    streamHarness.callbacks.set(options.taskId, options.onEvent);
    await new Promise<void>((resolve) => options.signal.addEventListener('abort', () => resolve(), { once: true }));
  }),
}));

const project = {
  id: '7', name: 'Jarvis', default_agent: 'copilot' as const, policy: 'deliver_pr' as const,
  repo: 'DanAakesen/jarvis', default_branch: 'main', merge_rules: null,
  sandbox_size: '1x2' as const, tech: 'node', max_parallel_tasks: 1, active: true,
};
const projectRelease = {
  project: { id: '7', name: 'Jarvis', repo: 'DanAakesen/jarvis', defaultBranch: 'main' },
  releases: [],
  pullRequests: [{
    id: '11', number: 17, branch: 'copilot/fix-the-bug', headSha: 'abc1234', state: 'open',
    checks: 'failed', taskId: '42',
  }],
  workflowRuns: [],
  deployments: [],
  graph: null,
};
const task = {
  id: '42',
  projectId: '7',
  title: 'Fix the bug',
  request: 'Find and fix it',
  agent: 'codex' as const,
  state: 'Running' as const,
  activity: 'Updating tests' as string | null,
  attemptCount: 2,
  branch: 'copilot/fix-the-bug',
  createdAt: '2026-10-03T12:00:00.000Z',
  startedAt: '2026-10-03T12:10:00.000Z',
  finishedAt: null,
};
let boardTask: Omit<typeof task, 'state'> & {
  state: 'Ready' | 'Running' | 'PauseRequested' | 'Paused' | 'NeedsAttention' | 'Done' | 'Cancelled';
  latestSessionEndReason?: 'crashed' | null;
} = { ...task };

const getAccessToken = vi.fn(async () => 'test-access-token');
const fetchMock = vi.fn<typeof fetch>();

function makeCard(value = boardTask): BoardCard {
  return {
    issue: {
      number: Number(value.id), url: `https://github.com/DanAakesen/jarvis/issues/${value.id}`,
      title: value.title, taskCode: 'P10-07', labels: ['P10', 'Codex'], worker: 'Codex',
      state: 'open', updatedAt: '2026-10-13T12:00:00.000Z', closedAt: null, blockedBy: [],
    },
    pr: null,
    task: {
      id: value.id, state: value.state, agent: value.agent, activity: value.activity,
      attemptCount: value.attemptCount, branch: value.branch, startedAt: value.startedAt,
      latestSessionEndReason: value.latestSessionEndReason ?? null,
    },
  };
}

function boardFixture(values = [boardTask], column: FactoryBoardColumnId = 'in_progress', projectId = '7'): FactoryBoard {
  return {
    project: { id: projectId, repo: projectId === '7' ? 'DanAakesen/jarvis' : 'DanAakesen/other' },
    fetchedAt: '2026-10-13T13:00:00.000Z', stale: false,
    columns: factoryBoardColumnIds.map((id) => ({ id, cards: id === column ? values.map(makeCard) : [] })),
  };
}

function invalidate(version = 1, projectId = '7') {
  act(() => publishFactoryBoardUpdate('https://api.example.com', { projectId, version }));
}

function response(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderFactory(path = '/factory/kanban', issueNavigation: { current: FactoryIssueNavigator | null } = { current: null }) {
  return render(
    <ContextPanelProvider>
      <FactoryIssueNavigationContext.Provider value={issueNavigation}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/factory/*" element={
            <FactoryArea backendUrl="https://api.example.com" getAccessToken={getAccessToken} />
          } />
        </Routes>
        <button id="context-panel-toggle" type="button">Context panel</button>
        <ContextPanel closeIcon={<span aria-hidden="true">×</span>} />
      </MemoryRouter>
      </FactoryIssueNavigationContext.Provider>
    </ContextPanelProvider>,
  );
}

async function openTaskForm(title = 'Add coverage') {
  await screen.findByRole('article', { name: 'Fix the bug' });
  fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
  const dialog = screen.getByRole('dialog', { name: 'Create task' });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Task title' }), { target: { value: title } });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Request' }), { target: { value: 'Cover retries' } });
  return dialog.querySelector('form')!;
}

function submittedTasks() {
  return fetchMock.mock.calls
    .filter(([input, init]) => String(input).endsWith('/factory/tasks') && init?.method === 'POST')
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal('crypto', webcrypto);
  resetFactoryBoardForTests();
  publishFactoryBoardStatus('https://api.example.com', 'connected');
  getAccessToken.mockClear();
  streamHarness.callbacks.clear();
  boardTask = { ...task };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/factory/projects') && method === 'GET') return response([project]);
    if (url.endsWith('/factory/projects/7') && method === 'PATCH') {
      return response({ ...project, ...JSON.parse(String(init?.body)) });
    }
    if (url.endsWith('/factory/projects/7/releases') && method === 'GET') return response(projectRelease);
    if (url.includes('/factory/board?') && method === 'GET') return response(boardFixture());
    if (url.includes('/factory/tasks/42?') && method === 'GET') {
      return response({
        ...task, source: 'board', originMessageId: null, modelOverride: null, reasoningOverride: null,
        latestSessionEndReason: null, events: [], usage: [],
      });
    }
    if (url.endsWith('/factory/tasks') && method === 'POST') {
      return response({
        ...task, ...JSON.parse(String(init?.body)), id: '43', state: 'Ready',
        issueUrl: 'https://github.com/DanAakesen/jarvis/issues/108', issueNumber: 108,
      }, 201);
    }
    return response({ error: 'Unexpected request' }, 500);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Factory task board', () => {
  it('reveals an exact issue beyond the display cap by clearing filters and expanding its column', async () => {
    const user = userEvent.setup();
    const fixture = boardFixture();
    fixture.columns.find((column) => column.id === 'in_progress')!.cards.unshift(
      ...Array.from({ length: 101 }, (_, index) => {
        const card = makeCard();
        card.issue.number = 420 + index;
        card.issue.title = `Other issue ${card.issue.number}`;
        card.task = null;
        return card;
      }),
    );
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/factory/projects')) return response([project]);
      if (url.includes('/factory/board?')) return response(fixture);
      return response(projectRelease);
    });
    const navigation: { current: FactoryIssueNavigator | null } = { current: null };
    const view = renderFactory('/factory/kanban', navigation);
    await screen.findByRole('article', { name: 'Other issue 420' });
    expect(screen.queryByRole('article', { name: 'Fix the bug' })).toBeNull();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Agent' }), 'copilot');
    await user.type(screen.getByRole('searchbox', { name: 'Search issues' }), 'not this issue');
    await user.click(screen.getByRole('button', { name: 'In progress' }));
    act(() => expect(navigation.current?.(42)).toEqual({ status: 'ready', anchorId: 'issue-title-42', taskId: '42' }));
    expect(screen.getByRole('combobox', { name: 'Agent' })).toHaveProperty('value', '');
    expect(screen.getByRole('searchbox', { name: 'Search issues' })).toHaveProperty('value', '#42');
    expect(screen.getByRole('button', { name: 'In progress' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(document.getElementById('task-title-42')).toBe(screen.getByRole('button', { name: 'Fix the bug' }));
    view.unmount();
    expect(navigation.current).toBeNull();
  });

  it('navigates task-free issues without inventing tasks and refuses absent issues or conflicting task ids', async () => {
    const fixture = boardFixture();
    fixture.columns.find((column) => column.id === 'in_progress')!.cards[0]!.task = null;
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith('/factory/projects')) return response([project]);
      if (String(input).includes('/factory/board?')) return response(fixture);
      return response(projectRelease);
    });
    const navigation: { current: FactoryIssueNavigator | null } = { current: null };
    renderFactory('/factory/kanban', navigation);
    await screen.findByRole('article', { name: 'Fix the bug' });
    act(() => expect(navigation.current?.(42)).toEqual({ status: 'ready', anchorId: 'issue-title-42' }));
    expect(screen.getByRole('link', { name: 'Fix the bug' }).getAttribute('href')).toContain('/issues/42');
    expect(navigation.current?.(42, '42')).toMatchObject({ status: 'refused', reason: expect.stringContaining('not linked') });
    expect(navigation.current?.(793)).toMatchObject({ status: 'refused', reason: expect.stringContaining('not in') });
  });

  it('shows canonical GitHub Project columns, issue links, local filters and the shared details pane', async () => {
    const user = userEvent.setup();
    renderFactory('/factory/kanban');

    expect(await screen.findByRole('heading', { level: 1, name: 'Kanban' })).not.toBeNull();
    const board = await screen.findByRole('region', { name: 'Issues by GitHub Project column' });
    const names = ['Backlog', 'Needs Dan', 'Ready', 'In progress', 'In review', 'Done'];
    expect(within(board).getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(names);
    for (const name of names) {
      expect(within(board).getByRole('heading', { level: 2, name })).not.toBeNull();
    }
    const running = within(board).getByRole('heading', { level: 2, name: 'In progress' }).closest('section')!;
    const card = within(running).getByRole('article', { name: 'Fix the bug' });
    expect(within(card).getByRole('list', { name: 'Worker and task state' }).textContent).toContain('Running');
    expect(within(card).getByRole('link', { name: '#42' }).getAttribute('href')).toBe('https://github.com/DanAakesen/jarvis/issues/42');
    expect(within(card).getByText('Updating tests')).not.toBeNull();
    expect(within(card).getByText(/2 attempts/)).not.toBeNull();
    const branch = within(card).getByText('copilot/fix-the-bug');
    expect(branch.tagName).toBe('CODE');
    expect(branch.getAttribute('title')).toBe('copilot/fix-the-bug');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Agent' }), 'codex');
    expect(screen.getByRole('article', { name: 'Fix the bug' })).toBe(card);

    await user.type(screen.getByRole('searchbox', { name: 'Search issues' }), 'bug');
    await waitFor(() => expect(screen.getByRole('article', { name: 'Fix the bug' })).toBe(card));

    const title = await screen.findByRole('button', { name: 'Fix the bug' });
    await user.click(title);
    expect(title.getAttribute('aria-pressed')).toBe('true');
    expect(await screen.findByRole('complementary', { name: 'Fix the bug' })).not.toBeNull();
  });

  it('shows supplied task activity, start time, attempts, controls and workspace links', async () => {
    renderFactory();

    const running = await screen.findByRole('region', { name: 'In progress' });
    const card = within(running).getByRole('article', { name: 'Fix the bug' });
    expect(within(card).getByText('Codex')).not.toBeNull();
    expect(within(card).getByText('Updating tests')).not.toBeNull();
    expect(within(card).getByText(/2 attempts/)).not.toBeNull();
    expect(within(card).getByRole('button', { name: 'Pause' })).not.toBeNull();
    expect(within(card).getByRole('button', { name: 'Steer' })).not.toBeNull();
    expect(within(card).getByRole('button', { name: 'View details' })).not.toBeNull();
    expect(within(card).getByRole('link', { name: 'Open Fix the bug in a window' }).getAttribute('href')).toBe('/factory/tasks/42');
    expect(within(card).getByRole('button', { name: 'Fix the bug' }).getAttribute('aria-pressed')).toBe('false');
    expect(within(card).getByText(/Started/)).not.toBeNull();
    expect(await screen.findByText('Live board updates connected.')).not.toBeNull();
    expect(streamHarness.callbacks.size).toBe(0);
  });

  it('uses only the required project query and applies agent, task-state, update-period and search filters locally', async () => {
    const user = userEvent.setup();
    renderFactory();
    await screen.findByRole('article', { name: 'Fix the bug' });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Project' }), '7');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Agent' }), 'codex');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Task state' }), 'Running');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Updated' }), '7');
    await user.type(screen.getByRole('searchbox', { name: 'Search issues' }), '#42');

    await waitFor(() => {
      const listRequest = fetchMock.mock.calls.find(([url]) => String(url).includes('/factory/board?'));
      expect(listRequest).toBeDefined();
      const url = new URL(String(listRequest?.[0]));
      expect(url.search).toBe('?project=7');
      expect(screen.getByRole('article', { name: 'Fix the bug' })).not.toBeNull();
    });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Agent' }), 'copilot');
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Fix the bug' })).toBeNull());
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/factory/board?'))).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/factory/tasks?'))).toBe(false);
  });

  it('creates a task with selected project, agent, and optional overrides', async () => {
    const user = userEvent.setup();
    renderFactory();
    await screen.findByRole('article', { name: 'Fix the bug' });
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    const dialog = screen.getByRole('dialog', { name: 'Create task' });

    await user.type(within(dialog).getByRole('textbox', { name: 'Task title' }), 'Add coverage');
    await user.type(within(dialog).getByRole('textbox', { name: 'Request' }), 'Cover the new board behavior');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Agent' }), 'codex');
    await user.type(within(dialog).getByRole('textbox', { name: 'Model override (optional)' }), 'gpt-5.6');
    await user.type(within(dialog).getByRole('textbox', { name: 'Reasoning override (optional)' }), 'high');
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }));

    const issueLink = await screen.findByRole('link', { name: 'issue #108' });
    expect(issueLink.getAttribute('href')).toBe('https://github.com/DanAakesen/jarvis/issues/108');
    expect(issueLink.closest('[role="status"]')?.textContent).toBe('Task created and linked to issue #108');
    expect(screen.queryByRole('dialog', { name: 'Create task' })).toBeNull();
    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(createCall?.[0]).toBe('https://api.example.com/factory/tasks');
    expect(createCall?.[1]?.headers).toMatchObject({ Authorization: ['Bearer', 'test-access-token'].join(' ') });
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      projectId: '7',
      title: 'Add coverage',
      request: 'Cover the new board behavior',
      agent: 'codex',
      modelOverride: 'gpt-5.6',
      reasoningOverride: 'high',
      submissionId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
    });
  });

  it('shows and changes the selected project policy from the Create task dialog', async () => {
    const user = userEvent.setup();
    renderFactory();
    await screen.findByRole('article', { name: 'Fix the bug' });
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    const dialog = screen.getByRole('dialog', { name: 'Create task' });
    const policy = within(dialog).getByRole('group', { name: 'Completion policy for Jarvis' });
    const deliver = within(policy).getByRole('radio', { name: /Deliver a pull request/ });
    const complete = within(policy).getByRole('radio', { name: /Complete without deployment/ });

    expect(deliver).toHaveProperty('checked', true);
    await user.click(complete);

    expect(await within(policy).findByRole('status')).toHaveProperty('textContent', 'Saved.');
    expect(within(policy).getByText('Applies now, including pull requests that are already open.', {
      selector: '.project-policy-applies',
    })).not.toBeNull();
    expect(complete).toHaveProperty('checked', true);
    const patch = fetchMock.mock.calls.find(([url, init]) =>
      String(url).endsWith('/factory/projects/7') && init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ policy: 'complete_without_deployment' });
  });

  it.each([
    [400, { error: 'Choose an active project.' }, 'Choose an active project.'],
    [502, { message: 'GitHub issue creation failed. Try again.' }, 'GitHub issue creation failed. Try again.'],
    [503, { error: 'Issue #108 was created, but linking the task failed. Retry to finish linking.' },
      'Issue #108 was created, but linking the task failed. Retry to finish linking.'],
  ])('retains the task form and backend error for HTTP %s', async (status, failure, message) => {
    const defaultFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => init?.method === 'POST'
      ? Promise.resolve(response(failure, status)) : defaultFetch(input, init));
    renderFactory();
    const form = await openTaskForm();
    fireEvent.submit(form);
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(screen.getByRole('dialog', { name: 'Create task' }).contains(form)).toBe(true);
    expect(screen.getByRole('textbox', { name: 'Task title' })).toHaveProperty('value', 'Add coverage');
    expect(screen.getByRole('textbox', { name: 'Request' })).toHaveProperty('value', 'Cover retries');
    expect(screen.queryByRole('link', { name: 'issue #108' })).toBeNull();
    const submit = within(screen.getByRole('dialog')).getByRole('button', { name: 'Create task' }) as HTMLButtonElement;
    expect(submit.form).toBe(form);
    expect(submit.hasAttribute('disabled')).toBe(false);
  });

  it('reuses the submission id after a network failure, dialog dismissal and remount', async () => {
    const defaultFetch = fetchMock.getMockImplementation()!;
    let fail = true;
    fetchMock.mockImplementation((input, init) => {
      if (init?.method === 'POST' && fail) return Promise.reject(new TypeError('Network unavailable'));
      return defaultFetch(input, init);
    });
    const view = renderFactory();
    fireEvent.submit(await openTaskForm());
    expect((await screen.findByRole('alert')).textContent).toBe('Jarvis could not reach the task service. Try again.');
    const firstId = submittedTasks()[0]!.submissionId;
    expect(sessionStorage.getItem('jarvis.factory.taskSubmission:https://api.example.com')).not.toContain('Cover retries');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.submit(await openTaskForm());
    await screen.findByRole('alert');
    expect(submittedTasks()[1]!.submissionId).toBe(firstId);
    view.unmount();
    renderFactory();
    fail = false;
    fireEvent.submit(await openTaskForm());
    await screen.findByRole('link', { name: 'issue #108' });
    expect(submittedTasks()[2]!.submissionId).toBe(firstId);
    expect(sessionStorage.getItem('jarvis.factory.taskSubmission:https://api.example.com')).toBeNull();
  });

  it('uses a new submission id when the payload changes and after a successful submission', async () => {
    const defaultFetch = fetchMock.getMockImplementation()!;
    let fail = true;
    fetchMock.mockImplementation((input, init) => init?.method === 'POST' && fail
      ? Promise.resolve(response({ error: 'Try again.' }, 502)) : defaultFetch(input, init));
    renderFactory();
    const form = await openTaskForm();
    fireEvent.submit(form);
    await screen.findByRole('alert');
    fireEvent.change(screen.getByRole('textbox', { name: 'Task title' }), { target: { value: 'Edited coverage' } });
    fail = false;
    fireEvent.submit(form);
    await screen.findByRole('link', { name: 'issue #108' });
    expect(submittedTasks()[1]!.submissionId).not.toBe(submittedTasks()[0]!.submissionId);
    fireEvent.submit(await openTaskForm('Edited coverage'));
    await screen.findByRole('link', { name: 'issue #108' });
    expect(submittedTasks()[2]!.submissionId).not.toBe(submittedTasks()[1]!.submissionId);
  });

  it.each([false, true])('retains uncertain A across successful B and retries A with its original id (remount: %s)', async (remount) => {
    const defaultFetch = fetchMock.getMockImplementation()!;
    let loseResponse = true;
    fetchMock.mockImplementation((input, init) => {
      if (init?.method === 'POST' && loseResponse) return Promise.reject(new TypeError('Response lost'));
      return defaultFetch(input, init);
    });
    const view = renderFactory();
    const form = await openTaskForm('Uncertain A');
    fireEvent.submit(form);
    await screen.findByRole('alert');
    const originalId = submittedTasks()[0]!.submissionId;
    loseResponse = false;
    fireEvent.change(screen.getByRole('textbox', { name: 'Task title' }), { target: { value: 'Successful B' } });
    fireEvent.submit(form);
    await screen.findByRole('link', { name: 'issue #108' });
    expect(submittedTasks()[1]!.submissionId).not.toBe(originalId);
    const stored = JSON.parse(sessionStorage.getItem('jarvis.factory.taskSubmission:https://api.example.com')!);
    expect(stored).toEqual([{
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      submissionId: originalId,
    }]);
    if (remount) {
      view.unmount();
      renderFactory();
    }
    fireEvent.submit(await openTaskForm('Uncertain A'));
    await screen.findByRole('link', { name: 'issue #108' });
    expect(submittedTasks()[2]!.submissionId).toBe(originalId);
    expect(sessionStorage.getItem('jarvis.factory.taskSubmission:https://api.example.com')).toBeNull();
  });

  it('reuses a legacy single-record submission after remount', async () => {
    const defaultFetch = fetchMock.getMockImplementation()!;
    let loseResponse = true;
    fetchMock.mockImplementation((input, init) => init?.method === 'POST' && loseResponse
      ? Promise.reject(new TypeError('Response lost')) : defaultFetch(input, init));
    const view = renderFactory();
    fireEvent.submit(await openTaskForm());
    await screen.findByRole('alert');
    const key = 'jarvis.factory.taskSubmission:https://api.example.com';
    const [legacy] = JSON.parse(sessionStorage.getItem(key)!);
    sessionStorage.setItem(key, JSON.stringify(legacy));
    view.unmount();
    renderFactory();
    loseResponse = false;
    fireEvent.submit(await openTaskForm());
    await screen.findByRole('link', { name: 'issue #108' });
    expect(submittedTasks()[1]!.submissionId).toBe(submittedTasks()[0]!.submissionId);
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it('synchronously blocks rapid duplicate form submissions while creation is pending', async () => {
    const defaultFetch = fetchMock.getMockImplementation()!;
    let finish!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    fetchMock.mockImplementation((input, init) => init?.method === 'POST' ? pending : defaultFetch(input, init));
    renderFactory();
    const form = await openTaskForm();
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await waitFor(() => expect(submittedTasks()).toHaveLength(1));
    const submit = screen.getByRole('button', { name: 'Creating task…' }) as HTMLButtonElement;
    expect(submit.form).toBe(form);
    expect(submit.hasAttribute('disabled')).toBe(true);
    fireEvent.submit(form);
    expect(submittedTasks()).toHaveLength(1);
    finish(response({
      ...task, issueUrl: 'https://github.com/DanAakesen/jarvis/issues/108', issueNumber: 108,
    }, 201));
    await screen.findByRole('link', { name: 'issue #108' });
    expect(submittedTasks()).toHaveLength(1);
  });

  it('does not report success for a task response missing its linked issue', async () => {
    const defaultFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => init?.method === 'POST'
      ? Promise.resolve(response(task, 201)) : defaultFetch(input, init));
    renderFactory();
    fireEvent.submit(await openTaskForm());
    expect((await screen.findByRole('alert')).textContent).toBe('Jarvis returned invalid task data. Try again.');
    expect(screen.getByRole('dialog', { name: 'Create task' })).not.toBeNull();
  });

  it('refreshes canonical placement and activity after a board invalidation', async () => {
    boardTask = { ...task, activity: null };
    renderFactory();
    const card = await screen.findByRole('article', { name: 'Fix the bug' });
    boardTask = { ...task, activity: 'Tests passed' };
    invalidate();
    await waitFor(() => {
      expect(within(card).getByText('Tests passed')).not.toBeNull();
    });
  });

  it('keeps the board, scroll and selected task mounted while a live refresh is pending', async () => {
      const user = userEvent.setup();
      renderFactory();
      const board = await screen.findByRole('region', { name: 'Issues by GitHub Project column' });
      const title = screen.getByRole('button', { name: 'Fix the bug' });
      await user.click(title);
      board.scrollLeft = 180;
      board.scrollTop = 90;
      let finishRefresh!: (value: Response) => void;
      const originalFetch = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation((input, init) => String(input).includes('/factory/board?')
        ? new Promise<Response>((resolve) => { finishRefresh = resolve; })
        : originalFetch(input, init));
      invalidate();
      await waitFor(() => expect(finishRefresh).toBeDefined());
      expect(screen.queryByText('Loading GitHub board…')).toBeNull();
      expect(screen.getByRole('region', { name: 'Issues by GitHub Project column' })).toBe(board);
      expect(title.getAttribute('aria-pressed')).toBe('true');
      expect(board.scrollLeft).toBe(180);
      expect(board.scrollTop).toBe(90);
      await act(async () => finishRefresh(response(boardFixture([{ ...task, activity: 'Recovered' }]))));
      expect(await screen.findByText('Recovered')).not.toBeNull();
      expect(screen.getByRole('region', { name: 'Issues by GitHub Project column' })).toBe(board);
      expect(screen.getByRole('button', { name: 'Fix the bug' })).toBe(title);
      expect(board.scrollLeft).toBe(180);
      expect(board.scrollTop).toBe(90);
      expect(title.getAttribute('aria-pressed')).toBe('true');
    });

  it('keeps an empty board mounted after a live refresh without an orb', async () => {
      renderFactory();
      const board = await screen.findByRole('region', { name: 'Issues by GitHub Project column' });
      const originalFetch = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation((input, init) => String(input).includes('/factory/board?')
        ? Promise.resolve(response(boardFixture([])))
        : originalFetch(input, init));
      invalidate();
      await waitFor(() => expect(screen.queryByRole('article', { name: 'Fix the bug' })).toBeNull());
      expect(screen.getByRole('region', { name: 'Issues by GitHub Project column' })).toBe(board);
      expect(document.querySelector('.loader-core')).toBeNull();
  });

  it('refreshes after Recover without inserting a loader or replacing the board', async () => {
    const user = userEvent.setup();
    boardTask = { ...task, state: 'NeedsAttention', latestSessionEndReason: 'crashed' };
    renderFactory();
    const board = await screen.findByRole('region', { name: 'Issues by GitHub Project column' });
    const card = await screen.findByRole('article', { name: 'Fix the bug' });
    board.scrollLeft = 160;
    board.scrollTop = 70;
    let finishRefresh!: (value: Response) => void;
    const originalFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => {
      if (String(input).endsWith('/factory/tasks/42/controls')) {
        return Promise.resolve(response({ id: '42', state: 'Running' }));
      }
      return String(input).includes('/factory/board?')
        ? new Promise<Response>((resolve) => { finishRefresh = resolve; })
        : originalFetch(input, init);
    });
    await user.click(within(card).getByRole('button', { name: 'Recover' }));
    await waitFor(() => expect(finishRefresh).toBeDefined());
    expect(screen.getByRole('region', { name: 'Issues by GitHub Project column' })).toBe(board);
    expect(screen.getByRole('article', { name: 'Fix the bug' })).toBe(card);
    expect(board.scrollLeft).toBe(160);
    expect(board.scrollTop).toBe(70);
    expect(screen.queryByText('Loading GitHub board…')).toBeNull();
    expect(document.querySelector('.loader-core')).toBeNull();
    await act(async () => finishRefresh(response(boardFixture([{ ...task, activity: 'Recovered' }]))));
    expect(await screen.findByText('Recovered')).not.toBeNull();
    expect(screen.getByRole('region', { name: 'Issues by GitHub Project column' })).toBe(board);
    expect(board.scrollLeft).toBe(160);
    expect(board.scrollTop).toBe(70);
    const control = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/controls'));
    expect(JSON.parse(String(control?.[1]?.body))).toEqual({ action: 'recover' });
  });

  it('shows a live refresh failure beside the retained board without replacing its cards', async () => {
    renderFactory();
    const board = await screen.findByRole('region', { name: 'Issues by GitHub Project column' });
    const card = screen.getByRole('article', { name: 'Fix the bug' });
    const originalFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => String(input).includes('/factory/board?')
      ? Promise.resolve(response({ error: 'unavailable' }, 503))
      : originalFetch(input, init));
    invalidate();
    expect(await screen.findByText('Showing the last loaded board because refresh failed.')).not.toBeNull();
    expect(screen.getByRole('region', { name: 'Issues by GitHub Project column' })).toBe(board);
    expect(screen.getByRole('article', { name: 'Fix the bug' })).toBe(card);
    expect(screen.queryByText('Loading GitHub board…')).toBeNull();
    expect(document.querySelector('.loader-core')).toBeNull();
  });

  it('shows a recoverable error when the GitHub board cannot be loaded', async () => {
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith('/factory/projects')) return response([project]);
      if (String(input).endsWith('/factory/projects/7/releases')) return response(projectRelease);
      return response({ error: 'unavailable' }, 503);
    });
    renderFactory();

    expect((await screen.findByRole('alert')).textContent).toContain('Board data could not be loaded. Try again.');
    expect(screen.getByRole('button', { name: 'Retry board' })).not.toBeNull();
  });

  it('opens task details in the shared panel and returns focus to the selected card', async () => {
    const user = userEvent.setup();
    renderFactory();

    const title = await screen.findByRole('button', { name: 'Fix the bug' });
    await user.click(title);

    expect(await screen.findByText('Find and fix it')).not.toBeNull();
    expect(screen.getByRole('link', { name: '#17' }).getAttribute('href'))
      .toBe('https://github.com/DanAakesen/jarvis/pull/17');
    expect(screen.getByRole('link', { name: 'Open pull request' }).getAttribute('href'))
      .toBe('https://github.com/DanAakesen/jarvis/pull/17');
    expect(screen.getByText('failed')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Open task window' }).getAttribute('href')).toBe('/factory/tasks/42');
    await user.click(screen.getByRole('button', { name: 'Close context panel' }));
    expect(document.activeElement).toBe(title);
  });

  it('ignores a late detail response after selecting a different task', async () => {
    const user = userEvent.setup();
    let finishFirst: (() => void) | undefined;
    const second = { ...task, id: '43', title: 'Second task', request: 'Second request' };
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/factory/projects')) return Promise.resolve(response([project]));
      if (url.includes('/factory/board?')) return Promise.resolve(response(boardFixture([task, second])));
      if (url.includes('/factory/tasks/42?')) {
        return new Promise<Response>((resolve) => {
          finishFirst = () => resolve(response({
            ...task, source: 'board', originMessageId: null, modelOverride: null, reasoningOverride: null,
            latestSessionEndReason: null, events: [], usage: [],
          }));
        });
      }
      if (url.includes('/factory/tasks/43?')) {
        return Promise.resolve(response({
          ...second, source: 'board', originMessageId: null, modelOverride: null, reasoningOverride: null,
          latestSessionEndReason: null, events: [], usage: [],
        }));
      }
      return Promise.resolve(response({ error: 'Unexpected request', method }, 500));
    });
    renderFactory();

    await user.click(await screen.findByRole('button', { name: 'Fix the bug' }));
    await waitFor(() => expect(finishFirst).toBeDefined());
    await user.click(screen.getByRole('button', { name: 'Second task' }));
    expect(await screen.findByText('Second request')).not.toBeNull();
    finishFirst?.();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Second task', level: 2 })).not.toBeNull();
      expect(screen.queryByText('Find and fix it')).toBeNull();
    });
  });

  it.each(['Paused', 'NeedsAttention', 'Cancelled'] as const)('keeps %s as an overlay fact, not a column', async (state) => {
    boardTask = { ...task, state };
    renderFactory();
    const progress = await screen.findByRole('region', { name: 'In progress' });
    const card = within(progress).getByRole('article', { name: 'Fix the bug' });
    expect(within(card).getByRole('list', { name: 'Worker and task state' }).textContent)
      .toContain(state === 'NeedsAttention' ? 'Needs attention' : state);
    expect(screen.queryByRole('heading', { level: 2, name: state === 'NeedsAttention' ? 'Needs attention' : state })).toBeNull();
  });

  it('shows an issue and PR without fabricating a Factory task or controls', async () => {
    const value = boardFixture();
    const issue = makeCard();
    value.columns = value.columns.map((column) => column.id === 'in_progress' ? { ...column, cards: [issue] } : column);
    issue.task = null;
    issue.issue.worker = 'Dan';
    issue.issue.blockedBy = [790];
    issue.pr = { number: 99, url: 'https://github.com/DanAakesen/jarvis/pull/99', draft: true, checks: 'failing' };
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => String(input).includes('/factory/board?')
      ? Promise.resolve(response(value)) : original(input, init));
    renderFactory();
    const card = await screen.findByRole('article', { name: 'Fix the bug' });
    expect(within(card).getByRole('link', { name: 'Fix the bug' }).getAttribute('href'))
      .toBe('https://github.com/DanAakesen/jarvis/issues/42');
    expect(within(card).getByRole('link', { name: 'PR #99' }).getAttribute('href'))
      .toBe('https://github.com/DanAakesen/jarvis/pull/99');
    expect(within(card).getByText('Draft · Checks: failing')).not.toBeNull();
    expect(within(card).getByText('No Factory task linked.')).not.toBeNull();
    expect(within(card).getByText('Blocked by #790')).not.toBeNull();
    expect(within(card).queryAllByRole('button')).toHaveLength(0);
    expect(within(card).queryByText(/attempt/)).toBeNull();
  });

  it('moves an issue on refresh while retaining its selected task and returning focus safely', async () => {
    const user = userEvent.setup();
    renderFactory();
    const title = await screen.findByRole('button', { name: 'Fix the bug' });
    await user.click(title);
    await screen.findByText('Find and fix it');
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => String(input).includes('/factory/board?')
      ? Promise.resolve(response(boardFixture([boardTask], 'in_review'))) : original(input, init));
    invalidate();
    await waitFor(() => {
      expect(within(screen.getByRole('region', { name: 'In review' })).getByRole('article', { name: 'Fix the bug' })).not.toBeNull();
    });
    expect(title.isConnected).toBe(false);
    expect(screen.getByRole('button', { name: 'Fix the bug' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Find and fix it')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Close context panel' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fix the bug' }));
  });

  it('refreshes after reconnection and accepts lower versions after a backend restart', async () => {
    renderFactory();
    await screen.findByRole('article', { name: 'Fix the bug' });
    invalidate(100);
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/factory/board?'))).toHaveLength(2));
    act(() => publishFactoryBoardStatus('https://api.example.com', 'reconnecting'));
    expect(screen.getByText(/Reconnecting to live board updates/)).not.toBeNull();
    act(() => publishFactoryBoardStatus('https://api.example.com', 'connected'));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/factory/board?'))).toHaveLength(3));
    invalidate(1);
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/factory/board?'))).toHaveLength(4));
  });

  it('ignores unrelated board invalidations and debounces relevant bursts', async () => {
    renderFactory();
    await screen.findByRole('article', { name: 'Fix the bug' });
    vi.useFakeTimers();
    invalidate(1, '9');
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/factory/board?'))).toHaveLength(1);
    invalidate(2);
    invalidate(3);
    invalidate(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/factory/board?'))).toHaveLength(2);
  });

  describe('scoped automatic refresh lifecycle', () => {
    interface BoardRead {
      signal: AbortSignal;
      aborted: boolean;
      finish: (value: Response) => void;
    }
    let reads: BoardRead[];
    let nextBoard: FactoryBoard | null;
    let navigation: { current: FactoryIssueNavigator | null };

    const readAt = (index: number) => {
      const read = reads[index];
      if (!read) throw new Error(`Expected board read ${index + 1}.`);
      return read;
    };
    const advance = async (ms = 0) => {
      await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    };
    const scopedBoard = (backendUrl = 'https://api.example.com', token = getAccessToken) => (
      <ContextPanelProvider>
        <FactoryIssueNavigationContext.Provider value={navigation}>
        <MemoryRouter><TasksPage backendUrl={backendUrl} getAccessToken={token} /></MemoryRouter>
        </FactoryIssueNavigationContext.Provider>
      </ContextPanelProvider>
    );
    const mount = async () => {
      const view = render(scopedBoard());
      await advance();
      expect(reads).toHaveLength(1);
      return view;
    };

    beforeEach(() => {
      vi.useFakeTimers();
      reads = [];
      nextBoard = null;
      navigation = { current: null };
      const original = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation((input, init) => {
        const url = new URL(String(input));
        if (url.pathname === '/factory/projects') return Promise.resolve(response([
          project, { ...project, id: '9', name: 'Other', repo: 'DanAakesen/other' },
        ]));
        if (url.pathname === '/factory/projects/9/releases') return Promise.resolve(response({
          ...projectRelease, project: { ...projectRelease.project, id: '9', name: 'Other', repo: 'DanAakesen/other' },
        }));
        if (url.pathname !== '/factory/board') return original(input, init);
        const signal = init?.signal;
        if (!signal) throw new Error('Expected a cancellable board read.');
        const projectId = url.searchParams.get('project')!;
        const snapshot = nextBoard ?? boardFixture([boardTask], 'in_progress', projectId);
        return new Promise<Response>((resolve, reject) => {
          const finish = (value: Response) => {
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
            resolve(value);
          };
          const read: BoardRead = { signal, aborted: false, finish };
          const abort = () => {
            read.aborted = true;
            clearTimeout(timer);
            reject(signal.reason);
          };
          const timer = setTimeout(() => finish(response(snapshot)), 10_000);
          reads.push(read);
          signal.addEventListener('abort', abort, { once: true });
        });
      });
    });

    it('finishes slow reads and queues one follow-up, including updates arriving during that follow-up', async () => {
      await mount();
      for (let version = 1; version <= 4; version++) {
        await advance(2_000);
        invalidate(version);
        await advance(0);
        expect(reads).toHaveLength(1);
        expect(readAt(0).signal.aborted).toBe(false);
      }
      await advance(2_000);
      const card = screen.getByRole('article', { name: 'Fix the bug' });
      expect(reads).toHaveLength(1);
      await advance(100);
      invalidate(5);
      await advance(50);
      expect(reads).toHaveLength(2);
      await advance(2_000);
      invalidate(6);
      invalidate(7);
      await advance(8_000);
      expect(reads).toHaveLength(2);
      expect(screen.getByRole('article', { name: 'Fix the bug' })).toBe(card);
      expect(navigation.current?.(999)).toEqual({ status: 'loading' });
      await advance(150);
      expect(reads).toHaveLength(3);
      await advance(10_150);
      expect(reads).toHaveLength(3);
      expect(reads.every((read) => !read.aborted)).toBe(true);
      expect(screen.getByRole('button', { name: 'Refresh board' }).hasAttribute('disabled')).toBe(false);
      expect(screen.queryAllByRole('alert')).toHaveLength(0);
    });

    describe.each(['pending read', 'idle debounce'] as const)('navigation during %s', (phase) => {
      it.each(['missing issue', 'missing task overlay', 'replaced task link'] as const)(
        'waits for the known follow-up before resolving a %s',
        async (kind) => {
          const older = boardFixture();
          if (kind === 'missing task overlay') older.columns[3]!.cards[0]!.task = null;
          nextBoard = older;
          await mount();
          if (phase === 'idle debounce') await advance(10_000);
          const issueNumber = kind === 'missing issue' ? 43 : 42;
          const taskId = kind === 'replaced task link' ? '43' : String(issueNumber);
          const newer = boardFixture([{ ...boardTask, id: String(issueNumber) }]);
          newer.columns[3]!.cards[0]!.task!.id = taskId;
          nextBoard = newer;
          invalidate(1);
          if (phase === 'pending read') await advance(10_000);
          expect(reads).toHaveLength(1);
          expect(navigation.current?.(issueNumber, taskId)).toEqual({ status: 'loading' });
          await advance(149);
          expect(navigation.current?.(issueNumber, taskId)).toEqual({ status: 'loading' });
          expect(reads).toHaveLength(1);
          await advance(1);
          expect(reads).toHaveLength(2);
          expect(navigation.current?.(issueNumber, taskId)).toEqual({ status: 'loading' });
          await advance(10_000);
          act(() => expect(navigation.current?.(issueNumber, taskId)).toEqual({
            status: 'ready', anchorId: `issue-title-${issueNumber}`, taskId,
          }));
          expect(screen.getByRole('searchbox', { name: 'Search issues' })).toHaveProperty('value', `#${issueNumber}`);
          expect(navigation.current?.(999)).toMatchObject({ status: 'refused', reason: expect.stringContaining('not in') });
          await advance(1_000);
          expect(reads).toHaveLength(2);
          expect(reads.every((read) => !read.aborted)).toBe(true);
        },
      );
    });

    it.each(['issue', 'task link'] as const)('keeps the existing navigation budget and never applies a late %s navigation after timeout', async (kind) => {
      const older = boardFixture();
      older.columns[3]!.cards[0]!.task = null;
      nextBoard = older;
      await mount();
      const issueNumber = kind === 'issue' ? 43 : 42;
      nextBoard = boardFixture([{ ...boardTask, id: String(issueNumber) }]);
      invalidate(1);
      await advance(10_000);
      const find = vi.fn(() => navigation.current?.(issueNumber, String(issueNumber)) ?? null);
      const startedAt = Date.now();
      const result = waitForFactoryIssue(find, new AbortController().signal);
      await advance(5_750);
      expect(await result).toEqual({
        status: 'refused', reason: 'The Factory board is still loading. Try the issue again when the board is ready.',
      });
      expect(Date.now() - startedAt).toBe(5_750);
      const calls = find.mock.calls.length;
      await advance(4_400);
      expect(find).toHaveBeenCalledTimes(calls);
      expect(screen.getByRole('searchbox', { name: 'Search issues' })).toHaveProperty('value', '');
      expect(reads).toHaveLength(2);
    });

    it('reports a failed follow-up rather than a definitive task-link miss and does not retry on navigation', async () => {
      const older = boardFixture();
      older.columns[3]!.cards[0]!.task = null;
      nextBoard = older;
      await mount();
      invalidate(1);
      await advance(10_150);
      await act(async () => readAt(1).finish(response({ error: 'Fixture follow-up unavailable' }, 503)));
      expect(navigation.current?.(42, '42')).toEqual({ status: 'refused', reason: 'Board data could not be loaded. Try again.' });
      await advance(20_000);
      expect(reads).toHaveLength(2);
      expect(screen.getByText('Showing the last loaded board because refresh failed.')).not.toBeNull();
    });

    it('does not queue duplicate latest versions or unrelated project updates', async () => {
      invalidate(10);
      await mount();
      invalidate(10);
      invalidate(11, '9');
      await advance(10_150);
      expect(reads).toHaveLength(1);
      expect(readAt(0).aborted).toBe(false);
      expect(screen.getByRole('article', { name: 'Fix the bug' })).not.toBeNull();
    });

    it('coalesces reconnection and new-epoch updates without aborting the pending read', async () => {
      await mount();
      act(() => publishFactoryBoardStatus('https://api.example.com', 'reconnecting'));
      act(() => publishFactoryBoardStatus('https://api.example.com', 'connected'));
      invalidate(1);
      await advance(500);
      expect(reads).toHaveLength(1);
      expect(readAt(0).signal.aborted).toBe(false);
      await advance(9_650);
      expect(reads).toHaveLength(2);
      await advance(10_150);
      expect(reads).toHaveLength(2);
    });

    it('keeps a failed refresh visible with the retained snapshot while its queued follow-up recovers', async () => {
      await mount();
      await advance(10_000);
      const board = screen.getByRole('region', { name: 'Issues by GitHub Project column' });
      const card = screen.getByRole('article', { name: 'Fix the bug' });
      invalidate(1);
      await advance(150);
      invalidate(2);
      invalidate(3);
      await advance(1_000);
      expect(reads).toHaveLength(2);
      expect(readAt(1).signal.aborted).toBe(false);
      await act(async () => readAt(1).finish(response({ error: 'unavailable' }, 503)));
      expect(screen.getByText('Showing the last loaded board because refresh failed.')).not.toBeNull();
      await advance(150);
      expect(reads).toHaveLength(3);
      expect(screen.getByText('Showing the last loaded board because refresh failed.')).not.toBeNull();
      expect(screen.getByRole('region', { name: 'Issues by GitHub Project column' })).toBe(board);
      expect(screen.getByRole('article', { name: 'Fix the bug' })).toBe(card);
      await advance(10_150);
      expect(reads).toHaveLength(3);
      expect(screen.queryByText('Showing the last loaded board because refresh failed.')).toBeNull();
    });

    it('does not retry a failure without a new invalidation and preserves explicit Retry and Refresh', async () => {
      await mount();
      await act(async () => readAt(0).finish(response({ error: 'unavailable' }, 503)));
      await advance(10_150);
      expect(reads).toHaveLength(1);
      fireEvent.click(screen.getByRole('button', { name: 'Retry board' }));
      await advance();
      expect(reads).toHaveLength(2);
      await advance(10_000);
      fireEvent.click(screen.getByRole('button', { name: 'Refresh board' }));
      await advance();
      expect(reads).toHaveLength(3);
      await advance(10_000);
      expect(screen.queryAllByRole('alert')).toHaveLength(0);
    });

    it.each(['backend', 'identity'] as const)('cancels %s replacement and discards the old pending invalidation', async (kind) => {
      const view = await mount();
      invalidate(1);
      const backend = kind === 'backend' ? 'https://other.example.com' : 'https://api.example.com';
      const token = kind === 'identity' ? vi.fn(async () => 'replacement-token') : getAccessToken;
      view.rerender(scopedBoard(backend, token));
      await advance();
      expect(reads).toHaveLength(2);
      expect(readAt(0).signal.aborted).toBe(true);
      await advance(10_150);
      expect(reads).toHaveLength(2);
      expect(screen.getByRole('article', { name: 'Fix the bug' })).not.toBeNull();
      expect(navigation.current?.(999)).toMatchObject({ status: 'refused', reason: expect.stringContaining('not in') });
    });

    it('cancels project replacement without carrying its queued refresh into the new project', async () => {
      await mount();
      invalidate(1);
      fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), { target: { value: '9' } });
      await advance();
      expect(reads).toHaveLength(2);
      expect(readAt(0).signal.aborted).toBe(true);
      await advance(10_150);
      expect(reads).toHaveLength(2);
      expect(screen.getByText('DanAakesen/other')).not.toBeNull();
      expect(navigation.current?.(999)).toMatchObject({ status: 'refused', reason: expect.stringContaining('not in') });
    });

    it.each(['pending', 'settled'] as const)('disposes %s reads and queued work on unmount', async (state) => {
      const view = await mount();
      if (state === 'settled') await advance(10_000);
      invalidate(1);
      view.unmount();
      expect(navigation.current).toBeNull();
      await advance(20_000);
      expect(reads).toHaveLength(1);
      expect(readAt(0).signal.aborted).toBe(true);
      expect(readAt(0).aborted).toBe(state === 'pending');
    });
  });

  it('marks cached data and permits manual refresh when live updates are unavailable', async () => {
    const user = userEvent.setup();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => String(input).includes('/factory/board?')
      ? Promise.resolve(response({ ...boardFixture(), stale: true })) : original(input, init));
    publishFactoryBoardStatus('https://api.example.com', 'unavailable');
    renderFactory();
    await screen.findByText('Showing a cached board; issue placement may be out of date.');
    expect(screen.getByText(/Live board updates are unavailable/)).not.toBeNull();
    expect(screen.getByText('DanAakesen/jarvis')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Refresh board' }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/factory/board?'))).toHaveLength(2));
  });

  it.each(['wrong project', 'wrong columns', 'unsafe issue link'] as const)('rejects %s rather than showing false data', async (kind) => {
    const value = boardFixture();
    if (kind === 'wrong project') value.project.id = '9';
    if (kind === 'wrong columns') value.columns.reverse();
    if (kind === 'unsafe issue link') value.columns.forEach((column) => {
      column.cards.forEach((card) => { card.issue.url = 'javascript:alert(1)'; });
    });
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => String(input).includes('/factory/board?')
      ? Promise.resolve(response(value)) : original(input, init));
    renderFactory();
    expect(await screen.findByText('Jarvis returned invalid board data for this project. Try again.')).not.toBeNull();
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry board' })).not.toBeNull();
  });

  it('does not request an unscoped board when there are no active projects', async () => {
    fetchMock.mockResolvedValue(response([]));
    renderFactory();
    await screen.findByText('No active projects are available for a GitHub board.');
    await screen.findByText('Create a project to begin.');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/factory/board'))).toBe(false);
    expect(screen.getByRole('button', { name: 'Create task' }).hasAttribute('disabled')).toBe(true);
  });

  it('isolates project changes and ignores a late response for the previous selection', async () => {
    const user = userEvent.setup();
    let finishOld!: (value: Response) => void;
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/factory/projects')) return Promise.resolve(response([
        project, { ...project, id: '9', name: 'Other', repo: 'DanAakesen/other' },
      ]));
      if (url.endsWith('/factory/board?project=7')) return new Promise<Response>((resolve) => { finishOld = resolve; });
      if (url.endsWith('/factory/board?project=9')) return Promise.resolve(response(boardFixture([{ ...task, title: 'Other issue' }], 'ready', '9')));
      if (url.endsWith('/factory/projects/9/releases')) return Promise.resolve(response({
        ...projectRelease, project: { ...projectRelease.project, id: '9', name: 'Other', repo: 'DanAakesen/other' },
      }));
      return original(input, init);
    });
    renderFactory();
    await waitFor(() => expect(finishOld).toBeDefined());
    const oldRequest = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/factory/board?project=7'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Project' }), '9');
    expect(oldRequest?.[1]?.signal?.aborted).toBe(true);
    await screen.findByRole('article', { name: 'Other issue' });
    await act(async () => finishOld(response(boardFixture())));
    expect(screen.queryByRole('article', { name: 'Fix the bug' })).toBeNull();
    expect(screen.getByRole('article', { name: 'Other issue' })).not.toBeNull();
    expect(screen.getByText('DanAakesen/other')).not.toBeNull();
  });

  it('caps each column explicitly and filters the full snapshot before applying that cap', async () => {
    const user = userEvent.setup();
    const values = Array.from({ length: 101 }, (_, index) => ({
      ...task, id: String(index + 100), title: `Issue ${index + 100}`,
    }));
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => String(input).includes('/factory/board?')
      ? Promise.resolve(response(boardFixture(values))) : original(input, init));
    renderFactory();
    await screen.findByText('Showing 100 of 101 matching issues. Refine the filters to find another issue.');
    expect(screen.getAllByRole('article')).toHaveLength(100);
    expect(screen.queryByRole('article', { name: 'Issue 200' })).toBeNull();
    await user.type(screen.getByRole('searchbox', { name: 'Search issues' }), '#200');
    await screen.findByRole('article', { name: 'Issue 200' });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.queryByText(/Showing 100 of/)).toBeNull();
  });

  it('collapses canonical columns and filters with keyboard-operable controls', async () => {
    const user = userEvent.setup();
    renderFactory('/factory/tasks');
    const title = await screen.findByRole('button', { name: 'Fix the bug' });
    const toggle = screen.getByRole('button', { name: 'In progress' });
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('article', { name: 'Fix the bug' })).toBeNull();
    expect(localStorage.getItem('jarvis.kanban.collapsedColumns')).toContain('In progress');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Fix the bug' })).toBe(title);
    await user.click(screen.getByRole('button', { name: 'Search and filters' }));
    expect(screen.getByRole('button', { name: 'Search and filters' }).getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('kanban-filter-body')?.hasAttribute('inert')).toBe(true);
  });
});
