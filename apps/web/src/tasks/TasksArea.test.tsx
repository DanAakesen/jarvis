import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TasksArea } from './TasksArea';
import type { VaultTask } from './tasks-data';

const getAccessToken = vi.fn(async () => 'fixture-token');
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const task = (id: string, text: string, dueDate: string | null, done = false, priority: VaultTask['priority'] = 'normal',
  path = 'Personal/Inbox.md'): VaultTask => ({
  id: id.padStart(64, '0'), text, done, dueDate, dueTime: null,
  dueAt: dueDate ? `${dueDate}T12:00:00.000Z` : null, priority,
  path, line: Number(id), heading: 'Inbox',
});
const allTasks = [
  task('1', 'Overdue fixture', '2031-04-08'),
  task('2', 'Buy a mirror', '2031-04-09', false, 'high', 'Personal/Mirror & Frame.md'),
  task('3', 'Upcoming fixture', '2031-04-10'),
  task('4', 'No date fixture', null),
  task('5', 'Completed fixture', null, true),
];
const fetchMock = vi.fn<typeof fetch>();

function mount(initialEntry = '/tasks') {
  const router = createMemoryRouter([
    { path: '/tasks', element: <TasksArea backendUrl="https://api.example.com" getAccessToken={getAccessToken} /> },
    { path: '/notes', element: <h1>Notes source opened</h1> },
  ], { initialEntries: [initialEntry] });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async (input) => {
    const url = new URL(String(input));
    const state = url.searchParams.get('state');
    const query = url.searchParams.get('q')?.toLowerCase();
    const matches = allTasks.filter((item) =>
      (state === 'all' || (state === 'done' ? item.done : !item.done)) &&
      (!query || item.text.toLowerCase().includes(query)));
    return json({
      items: matches,
      readAt: '2031-04-09T12:30:00.000Z',
      today: '2031-04-09',
      total: matches.length,
      truncated: false,
    });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('vault Tasks area', () => {
  it('groups open tasks by the owner date, displays read-only state and source-note links', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Overdue' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Today' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Upcoming' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'No date' })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Done' })).toBeNull();
    expect(screen.getAllByText('Open')).toHaveLength(4);
    expect(screen.getByText('High priority')).not.toBeNull();
    expect(screen.getByText((_content, element) => element?.tagName === 'P' &&
      /Read from your vault at\s+12:30/u.test(element.textContent ?? ''))).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Open source note Personal/Mirror & Frame.md, line 2' }).getAttribute('href'))
      .toBe('/notes?note=Personal%2FMirror+%26+Frame.md');
    expect(screen.getByText(/checkbox items in your Personal and Work notes/)).not.toBeNull();
    expect(screen.queryByRole('button', { name: /complete|edit|delete|create/i })).toBeNull();
  });

  it('filters by query, shows completed tasks only when requested, and uses the Tasks deep-link query', async () => {
    mount('/tasks?q=mirror');
    expect(await screen.findByText('Buy a mirror')).not.toBeNull();
    expect(screen.queryByText('Overdue fixture')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/vault/tasks?state=open&q=mirror', expect.anything(),
    );

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show completed' }));
    expect(await screen.findByRole('heading', { name: 'Done' })).not.toBeNull();
    expect(screen.getByText('Completed fixture')).not.toBeNull();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), { target: { value: 'missing phrase' } });
    expect(await screen.findByText('No tasks match “missing phrase”.')).not.toBeNull();
  });

  it('shows an actionable 503 failure and retries without presenting an empty list', async () => {
    fetchMock.mockImplementationOnce(async () => json({ error: 'Vault tasks unavailable', reason: 'scan_limit' }, 503));
    mount();
    expect(await screen.findByText(/safe scan limit was reached/)).not.toBeNull();
    expect(screen.queryByText('No open tasks.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('shows the distinct no-open-tasks empty state', async () => {
    fetchMock.mockResolvedValueOnce(json({
      items: [], readAt: '2031-04-09T12:30:00.000Z', today: '2031-04-09', total: 0, truncated: false,
    }));
    mount();
    expect(await screen.findByText('No open tasks.')).not.toBeNull();
  });
});
