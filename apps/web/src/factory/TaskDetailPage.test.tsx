import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskDetailPage } from './TaskDetailPage';

const streamHarness = vi.hoisted(() => ({
  callbacks: new Map<string, (event: {
    id: string;
    taskId: string;
    type: string;
    summary: string | null;
    payload: unknown;
    payloadTruncated: boolean;
    source: 'runner' | 'backend' | 'github' | 'dan';
    at: string;
  }) => void>(),
  lastEventIds: new Map<string, string | undefined>(),
}));

vi.mock('../task-events', () => ({
  streamTaskEvents: vi.fn(async (options: {
    taskId: string;
    lastEventId?: string;
    signal: AbortSignal;
    onEvent: (event: {
      id: string;
      taskId: string;
      type: string;
      summary: string | null;
      payload: unknown;
      payloadTruncated: boolean;
      source: 'runner' | 'backend' | 'github' | 'dan';
      at: string;
    }) => void;
    onStatus?: (status: 'connecting' | 'connected' | 'reconnecting' | 'error') => void;
  }) => {
    options.onStatus?.('connected');
    streamHarness.callbacks.set(options.taskId, options.onEvent);
    streamHarness.lastEventIds.set(options.taskId, options.lastEventId);
    await new Promise<void>((resolve) => options.signal.addEventListener('abort', () => resolve(), { once: true }));
  }),
}));

const project = { id: '7', name: 'Jarvis', repo: 'DanAakesen/jarvis' };
const getAccessToken = vi.fn(async () => 'test-access-token');
const fetchMock = vi.fn<typeof fetch>();

function event(id: string, type: string, source: 'runner' | 'backend' | 'github' | 'dan', summary = type) {
  return {
    id,
    type,
    summary,
    payload: { eventId: id },
    payloadTruncated: false,
    source,
    at: `2026-10-04T12:${String(Number(id) % 60).padStart(2, '0')}:00.000Z`,
  };
}

const task = {
  id: '42',
  projectId: '7',
  originMessageId: '9',
  title: 'Keep disk headroom',
  request: 'Monitor writable disk',
  source: 'chat',
  agent: 'copilot',
  modelOverride: 'gpt-5.6-luna',
  reasoningOverride: null,
  state: 'NeedsAttention',
  activity: null,
  priority: 0,
  attemptCount: 1,
  nextAttemptAt: null,
  branch: 'task/disk-headroom',
  createdAt: '2026-10-04T12:00:00.000Z',
  startedAt: '2026-10-04T12:01:00.000Z',
  finishedAt: null,
  events: [
    {
      ...event('20', 'disk_snapshot', 'runner', 'Session disk snapshot'),
      payload: {
        invocationId: 'invocation-1',
        eventIndex: 1,
        data: {
          disk_total_bytes: 6 * 1024 ** 3,
          disk_free_bytes: 2.5 * 1024 ** 3,
          threshold_bytes: 1024 ** 3,
        },
      },
    },
    {
      ...event('21', 'state_changed', 'backend', 'Low sandbox disk; task needs attention'),
      payload: { from: 'Running', to: 'NeedsAttention', reason: 'disk_low' },
    },
    {
      ...event('22', 'disk_low', 'runner', 'Writable disk is below the configured threshold'),
      payload: {
        invocationId: 'invocation-1',
        eventIndex: 2,
        data: {
          disk_total_bytes: 6 * 1024 ** 3,
          disk_free_bytes: 0.5 * 1024 ** 3,
          threshold_bytes: 1024 ** 3,
        },
      },
    },
    event('23', 'check_result', 'github', 'GitHub reported passing checks'),
    event('24', 'steered', 'dan', 'Dan sent a steering message'),
  ],
  usage: [
    {
      id: '1',
      source: 'sandbox',
      metric: 'minutes',
      quantity: 3.5,
      costDkk: 0.0519,
      sandboxSessionId: '9',
      at: '2026-10-04T12:00:00.000Z',
      estimated: true,
    },
    {
      id: null,
      source: 'copilot',
      metric: 'turns',
      quantity: 2,
      costDkk: null,
      sandboxSessionId: null,
      at: '2026-10-04T12:02:00.000Z',
      estimated: false,
    },
    {
      id: null,
      source: 'copilot',
      metric: 'premium_requests',
      quantity: 1,
      costDkk: null,
      sandboxSessionId: null,
      at: '2026-10-04T12:02:00.000Z',
      estimated: false,
    },
  ],
};

let taskEvents: typeof task.events;
let taskState: 'Ready' | 'Running' | 'PauseRequested' | 'Paused' | 'NeedsAttention' | 'Done' | 'Cancelled';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderTaskPage() {
  return render(
    <MemoryRouter>
      <TaskDetailPage backendUrl="https://api.example.com" getAccessToken={getAccessToken} taskId="42" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getAccessToken.mockClear();
  streamHarness.callbacks.clear();
  streamHarness.lastEventIds.clear();
  taskEvents = [...task.events];
  taskState = 'NeedsAttention';
  fetchMock.mockReset().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/factory/tasks/42/controls') {
      const body = JSON.parse(String((init as RequestInit | undefined)?.body)) as { action?: string };
      taskState = body.action === 'recover' ? 'Running' : 'PauseRequested';
      return response({ ...task, state: taskState });
    }
    if (url.pathname === '/factory/projects') return response([project]);
    if (url.pathname === '/conversation/history') {
      return response({
        messages: [{
          id: '9',
          sessionId: '3',
          role: 'dan',
          text: 'Please monitor writable disk.',
          at: '2026-10-04T11:59:00.000Z',
        }],
        nextCursor: null,
      });
    }
    if (url.pathname === '/factory/tasks/42') {
      const offset = Number(url.searchParams.get('eventOffset') ?? 0);
      const limit = Number(url.searchParams.get('eventLimit') ?? 100);
      return response({ ...task, state: taskState, events: taskEvents.slice(offset, offset + limit) });
    }
    return response({ error: 'Unexpected request' }, 500);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('task detail page', () => {
  it('shows task metadata, project and branch links, state-valid actions, disk readings, and every event source', async () => {
    renderTaskPage();

    expect(await screen.findByRole('heading', { name: 'Keep disk headroom' })).not.toBeNull();
    expect(screen.getByText('Monitor writable disk')).not.toBeNull();
    expect(screen.getByText('Needs attention')).not.toBeNull();
    expect(screen.getAllByText('disk_low').length).toBeGreaterThan(0);
    const agentRow = screen.getByText('Agent').closest('div');
    if (!agentRow) throw new Error('Agent metadata row is missing');
    expect(within(agentRow).getByText('Copilot')).not.toBeNull();
    expect(screen.getByText('gpt-5.6-luna')).not.toBeNull();
    expect(await screen.findByText('Please monitor writable disk.')).not.toBeNull();
    expect((await screen.findByRole('link', { name: 'Jarvis' })).getAttribute('href')).toBe('/factory/projects/7');
    expect(screen.getByRole('link', { name: 'task/disk-headroom' }).getAttribute('href'))
      .toBe('https://github.com/DanAakesen/jarvis/tree/task/disk-headroom');
    expect(screen.getAllByText('Not reported')).toHaveLength(2);
    expect(screen.getAllByText('6.00 GiB')).toHaveLength(2);
    expect(screen.getByText('2.50 GiB')).not.toBeNull();
    expect(screen.getByText('0.50 GiB')).not.toBeNull();
    expect(screen.getAllByText('1.00 GiB')).toHaveLength(2);
    expect(await screen.findByRole('table', { name: 'Usage entries for task 42' })).not.toBeNull();
    expect(screen.getByText('Sandbox session 9')).not.toBeNull();
    expect(screen.getByText('3.50 min')).not.toBeNull();
    expect(screen.getByText('Estimated · DKK 0.0519')).not.toBeNull();
    expect(screen.getByText('Agent turns')).not.toBeNull();
    expect(screen.getByText('Premium requests')).not.toBeNull();
    expect(screen.getByText('Session disk snapshot')).not.toBeNull();
    expect(screen.getByText('Low sandbox disk; task needs attention')).not.toBeNull();
    expect(screen.getByText('GitHub reported passing checks')).not.toBeNull();
    expect(screen.getByText('Dan sent a steering message')).not.toBeNull();
    expect(screen.getByText('Chat')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Steer' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Recover' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByText('Starts a new sandbox from the existing task branch and its recorded history.')).not.toBeNull();
    expect(screen.getByText('Live updates connected')).not.toBeNull();
    expect(streamHarness.lastEventIds.get('42')).toBe('24');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/factory/tasks/42?eventLimit=100&eventOffset=0',
      expect.objectContaining({ headers: { Authorization: `${['Bear', 'er'].join('')} test-access-token` } }),
    );
  });

  it('removes Recover after recovery starts a Running session', async () => {
    const user = userEvent.setup();
    renderTaskPage();
    await screen.findByRole('heading', { name: 'Keep disk headroom' });

    await user.click(screen.getByRole('button', { name: 'Recover' }));

    expect(await screen.findByText('Recovery started from the task branch.')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Recover' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pause' })).not.toBeNull();
  });

  it('sends task controls from the detail page for a Running task', async () => {
    const user = userEvent.setup();
    taskState = 'Running';
    renderTaskPage();
    await screen.findByRole('heading', { name: 'Keep disk headroom' });

    await user.click(screen.getByRole('button', { name: 'Pause' }));

    expect(await screen.findByText(/Pause requested/)).not.toBeNull();
    expect(await screen.findByText('Pause requested', { exact: true })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(fetchMock.mock.calls.filter(([input]) =>
      new URL(String(input)).pathname === '/factory/tasks/42')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/factory/tasks/42/controls',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'pause' }) }),
    );
  });

  it('filters event types, expands event payloads, and displays live runner events', async () => {
    const user = userEvent.setup();
    renderTaskPage();
    expect(await screen.findByText('Session disk snapshot')).not.toBeNull();

    await user.selectOptions(screen.getByLabelText('Event type'), 'disk_low');
    expect(screen.getByText('Writable disk is below the configured threshold')).not.toBeNull();
    expect(screen.queryByText('Session disk snapshot')).toBeNull();
    await user.click(screen.getByText('View event payload'));
    expect(screen.getByText(/invocation-1/)).not.toBeNull();

    await user.selectOptions(screen.getByLabelText('Event type'), 'all');
    await waitFor(() => expect(streamHarness.callbacks.has('42')).toBe(true));
    streamHarness.callbacks.get('42')?.({
      ...event('25', 'tests_run', 'runner', 'Runner finished tests'),
      taskId: '42',
    });
    expect(await screen.findByText('Runner finished tests')).not.toBeNull();
  });

  it('loads the next bounded archived-event page on demand', async () => {
    const user = userEvent.setup();
    taskEvents = Array.from({ length: 101 }, (_value, index) => event(String(index + 1), 'runner_event', 'runner', `Timeline event ${index + 1}`));
    renderTaskPage();
    expect(await screen.findByText('Timeline event 1')).not.toBeNull();
    expect(screen.queryByText('Timeline event 101')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Load more events' }));

    expect(await screen.findByText('Timeline event 101')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/factory/tasks/42?eventLimit=100&eventOffset=100',
      expect.objectContaining({ headers: { Authorization: `${['Bear', 'er'].join('')} test-access-token` } }),
    );
  });

  it('retries the task detail request and uses the same response for usage', async () => {
    const user = userEvent.setup();
    const loadTask = fetchMock.getMockImplementation();
    if (!loadTask) throw new Error('Default fetch mock is missing');
    let failed = false;
    fetchMock.mockImplementation(async (input, init) => {
      if (!failed && String(input).includes('/factory/tasks/42')) {
        failed = true;
        return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 });
      }
      return loadTask(input, init);
    });
    render(
      <MemoryRouter>
        <TaskDetailPage backendUrl="https://api.example.com" getAccessToken={getAccessToken} taskId="42" />
      </MemoryRouter>,
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Task details could not be loaded');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('table', { name: 'Usage entries for task 42' })).not.toBeNull();
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/factory/tasks/42'))).toHaveLength(2);
  });
});
