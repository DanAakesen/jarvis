import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const project = { id: '7', name: 'Jarvis', default_agent: 'copilot' as const };
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

function renderFactory() {
  return render(
    <MemoryRouter initialEntries={['/factory/tasks']}>
      <Routes>
        <Route path="/factory/*" element={
          <FactoryArea backendUrl="https://api.example.com" getAccessToken={getAccessToken} />
        } />
      </Routes>
    </MemoryRouter>,
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
    if (url.includes('/factory/tasks?') && method === 'GET') return response({ tasks: [boardTask], limit: 100, offset: 0 });
    if (url.endsWith('/factory/tasks') && method === 'POST') {
      return response({ ...task, ...JSON.parse(String(init?.body)), id: '43', state: 'Ready' }, 201);
    }
    return response({ error: 'Unexpected request' }, 500);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('Factory task board', () => {
  it('shows task cards by state with activity, timing, attempt, and unavailable data points', async () => {
    renderFactory();

    const running = await screen.findByRole('region', { name: 'Running' });
    const card = within(running).getByRole('article', { name: 'Fix the bug' });
    expect(within(card).getByText('Jarvis')).not.toBeNull();
    expect(within(card).getByText('Codex')).not.toBeNull();
    expect(within(card).getByText('Updating tests')).not.toBeNull();
    expect(within(card).getByText('2')).not.toBeNull();
    expect(within(card).getByRole('button', { name: 'Pause' })).not.toBeNull();
    expect(within(card).getByRole('button', { name: 'Steer' })).not.toBeNull();
    expect(within(card).getAllByText('Not reported')).toHaveLength(3);
    expect(within(card).getByRole('link', { name: 'Fix the bug' }).getAttribute('href')).toBe('/factory/tasks/42');
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
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'tests');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      const listRequest = fetchMock.mock.calls.find(([url]) => {
        const parsed = new URL(String(url));
        return parsed.pathname === '/factory/tasks' && parsed.searchParams.get('projectId') === '7';
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

  it('updates the last-updated time from a task SSE event', async () => {
    boardTask = { ...task, activity: null };
    renderFactory();
    const card = await screen.findByRole('article', { name: 'Fix the bug' });
    await waitFor(() => expect(streamHarness.callbacks.has('42')).toBe(true));
    const onEvent = streamHarness.callbacks.get('42');
    expect(onEvent).toBeDefined();

    onEvent?.({ id: '19', taskId: '42', type: 'progress', summary: 'Tests passed', at: '2026-10-04T00:30:00.000Z' });

    await waitFor(() => {
      expect(within(card).getByText(/Oct 4, 2026/)).not.toBeNull();
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
});
