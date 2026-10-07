import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextPanel, ContextPanelProvider } from '../ContextPanel';
import { FactoryArea } from './FactoryArea';

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
  id: '7', name: 'Jarvis', default_agent: 'copilot' as const,
  repo: 'DanAakesen/jarvis', defaultBranch: 'main',
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
let boardTask = { ...task };

const getAccessToken = vi.fn(async () => 'test-access-token');
const fetchMock = vi.fn<typeof fetch>();

function response(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderFactory(path = '/factory/kanban') {
  return render(
    <ContextPanelProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/factory/*" element={
            <FactoryArea backendUrl="https://api.example.com" getAccessToken={getAccessToken} />
          } />
        </Routes>
        <ContextPanel closeIcon={<span aria-hidden="true">×</span>} />
      </MemoryRouter>
    </ContextPanelProvider>,
  );
}

beforeEach(() => {
  getAccessToken.mockClear();
  streamHarness.callbacks.clear();
  boardTask = { ...task };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/factory/projects') && method === 'GET') return response([project]);
    if (url.endsWith('/factory/projects/7/releases') && method === 'GET') return response(projectRelease);
    if (url.includes('/factory/tasks?') && method === 'GET') return response({ tasks: [boardTask], limit: 100, offset: 0 });
    if (url.includes('/factory/tasks/42?') && method === 'GET') {
      return response({
        ...task, source: 'board', originMessageId: null, modelOverride: null, reasoningOverride: null,
        latestSessionEndReason: null, events: [], usage: [],
      });
    }
    if (url.endsWith('/factory/tasks') && method === 'POST') {
      return response({ ...task, ...JSON.parse(String(init?.body)), id: '43', state: 'Ready' }, 201);
    }
    return response({ error: 'Unexpected request' }, 500);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('Factory task board', () => {
  it('shows the Kanban board with state columns, compact cards, instant filters and the shared details pane', async () => {
    const user = userEvent.setup();
    renderFactory('/factory/kanban');

    expect(await screen.findByRole('heading', { level: 1, name: 'Kanban' })).not.toBeNull();
    const board = await screen.findByRole('region', { name: 'Tasks by state' });
    for (const name of ['Ready', 'Running', 'Paused', 'Needs attention', 'Done', 'Cancelled']) {
      expect(within(board).getByRole('heading', { level: 2, name })).not.toBeNull();
    }
    const running = within(board).getByRole('heading', { level: 2, name: 'Running' }).closest('section')!;
    const card = within(running).getByRole('article', { name: 'Fix the bug' });
    expect(within(card).getByRole('list', { name: 'Project and agent' }).textContent).toContain('Jarvis');
    expect(within(card).getByText('Updating tests')).not.toBeNull();
    expect(within(card).getByText(/2 attempts/)).not.toBeNull();
    expect(within(card).getByText('copilot/fix-the-bug')).not.toBeNull();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Agent' }), 'codex');
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('agent=codex'))).toBe(true));

    await user.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'bug');
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('search=bug'))).toBe(true));

    const title = await screen.findByRole('button', { name: 'Fix the bug' });
    await user.click(title);
    expect(title.getAttribute('aria-pressed')).toBe('true');
    expect(await screen.findByRole('complementary', { name: 'Fix the bug' })).not.toBeNull();
  });

  it('shows task cards by state with activity, timing, attempt, and unavailable data points', async () => {
    renderFactory();

    const running = await screen.findByRole('region', { name: 'Running' });
    const card = within(running).getByRole('article', { name: 'Fix the bug' });
    expect(within(card).getByText('Jarvis')).not.toBeNull();
    expect(within(card).getByText('Codex')).not.toBeNull();
    expect(within(card).getByText('Updating tests')).not.toBeNull();
    expect(within(card).getByText(/2 attempts/)).not.toBeNull();
    expect(within(card).getByRole('button', { name: 'Pause' })).not.toBeNull();
    expect(within(card).getByRole('button', { name: 'Steer' })).not.toBeNull();
    expect(within(card).getByRole('button', { name: 'View details' })).not.toBeNull();
    expect(within(card).getByRole('link', { name: 'Open Fix the bug in a window' }).getAttribute('href')).toBe('/factory/tasks/42');
    expect(within(card).getByRole('button', { name: 'Fix the bug' }).getAttribute('aria-pressed')).toBe('false');
    expect(await screen.findByText('Live updates connected.')).not.toBeNull();
    expect(streamHarness.callbacks.has('42')).toBe(true);
  });

  it('applies project, agent, state, period, and search filters to the Tasks API', async () => {
    const user = userEvent.setup();
    renderFactory();
    await screen.findByRole('article', { name: 'Fix the bug' });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Project' }), '7');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Agent' }), 'codex');
    await user.selectOptions(screen.getByRole('combobox', { name: 'State' }), 'Running');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Period' }), '7');
    await user.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'tests');

    await waitFor(() => {
      const listRequest = fetchMock.mock.calls.find(([url]) => {
        const parsed = new URL(String(url));
        return parsed.pathname === '/factory/tasks' && parsed.searchParams.get('projectId') === '7' &&
          parsed.searchParams.get('search') === 'tests';
      });
      expect(listRequest).toBeDefined();
      const url = new URL(String(listRequest?.[0]));
      expect(url.searchParams.get('agent')).toBe('codex');
      expect(url.searchParams.get('state')).toBe('Running');
      expect(url.searchParams.get('search')).toBe('tests');
      expect(url.searchParams.get('createdAfter')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
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

    expect(await screen.findByText('Task created and added to Ready.')).not.toBeNull();
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
    });
  });

  it('shows the latest activity from a task SSE event', async () => {
    boardTask = { ...task, activity: null };
    renderFactory();
    const card = await screen.findByRole('article', { name: 'Fix the bug' });
    await waitFor(() => expect(streamHarness.callbacks.has('42')).toBe(true));
    const onEvent = streamHarness.callbacks.get('42');
    expect(onEvent).toBeDefined();

    onEvent?.({ id: '19', taskId: '42', type: 'progress', summary: 'Tests passed', at: '2026-10-04T00:30:00.000Z' });

    await waitFor(() => {
      expect(within(card).getByText('Tests passed')).not.toBeNull();
    });
  });

  it('shows a recoverable error when the task list cannot be loaded', async () => {
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith('/factory/projects')) return response([project]);
      return response({ error: 'unavailable' }, 503);
    });
    renderFactory();

    expect((await screen.findByRole('alert')).textContent).toMatch(/Task data is unavailable/);
    expect(screen.getByRole('button', { name: 'Retry tasks' })).not.toBeNull();
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
      if (url.includes('/factory/tasks?')) return Promise.resolve(response({ tasks: [task, second], limit: 100, offset: 0 }));
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
});
