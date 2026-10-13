import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextPanel, ContextPanelProvider } from '../ContextPanel';
import { FactoryArea } from './FactoryArea';
import { factoryBoardColumnIds, type BoardCard, type FactoryBoard, type FactoryBoardColumnId } from '@jarvis/contracts';
import { publishFactoryBoardStatus, publishFactoryBoardUpdate, resetFactoryBoardForTests } from '../factory-board-store';
import { FactoryIssueNavigationContext, type FactoryIssueNavigator } from '../page-navigation';

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

beforeEach(() => {
  localStorage.clear();
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
    if (url.endsWith('/factory/projects/7/releases') && method === 'GET') return response(projectRelease);
    if (url.includes('/factory/board?') && method === 'GET') return response(boardFixture());
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
    expect(within(card).getByText('copilot/fix-the-bug')).not.toBeNull();

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

    expect(await screen.findByText('Task created. Linked issues appear in their GitHub Project column.')).not.toBeNull();
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

  it('marks cached data and permits manual refresh when live updates are unavailable', async () => {
    const user = userEvent.setup();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => String(input).includes('/factory/board?')
      ? Promise.resolve(response({ ...boardFixture(), stale: true })) : original(input, init));
    publishFactoryBoardStatus('https://api.example.com', 'unavailable');
    renderFactory();
    await screen.findByText('GitHub is unavailable. Showing a cached board; placement may be out of date.');
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
    await screen.findByText('No active projects are available for a GitHub board. Create a project to begin.');
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
