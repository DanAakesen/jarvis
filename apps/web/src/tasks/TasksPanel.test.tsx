import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatTimeOnly } from '../format/date-time';
import { TasksPanel } from './TasksPanel';
import type { VaultTask } from './tasks-data';

const getAccessToken = vi.fn(async () => 'fixture-token');
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const task = (id: string, text: string, dueDate: string | null, done = false, priority: VaultTask['priority'] = 'normal',
  path = 'Personal/Inbox.md'): VaultTask => ({
  id: id.padStart(64, '0'), text, done, dueDate, dueTime: null,
  dueAt: dueDate ? `${dueDate}T20:28:00.000Z` : null, priority,
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
const onOpenNote = vi.fn();
const onClose = vi.fn();

function mount(initialQuery = '') {
  return render(<TasksPanel id="tasks-panel" backendUrl="https://api.example.com" getAccessToken={getAccessToken}
    initialQuery={initialQuery} onOpenNote={onOpenNote} onClose={onClose} />);
}

beforeEach(() => {
  onOpenNote.mockReset();
  onClose.mockReset();
  fetchMock.mockReset().mockImplementation(async (input) => {
    const url = new URL(String(input));
    const state = url.searchParams.get('state');
    const query = url.searchParams.get('q')?.toLowerCase();
    const matches = allTasks.filter((item) =>
      (state === 'all' || (state === 'done' ? item.done : !item.done)) &&
      (!query || item.text.toLowerCase().includes(query)));
    return json({
      items: matches,
      readAt: '2031-04-09T20:28:00.000Z',
      today: '2031-04-09',
      total: matches.length,
      truncated: false,
    });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('Tasks panel', () => {
  it('groups open tasks by the owner date and shows read-only state with a source-note link', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Overdue' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Today' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Upcoming' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'No date' })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Done' })).toBeNull();
    expect(screen.getAllByText('Open')).toHaveLength(4);
    expect(screen.getByText('High priority')).not.toBeNull();
    expect(screen.getByText((_content, element) => element?.tagName === 'TIME' &&
      element.textContent?.trim() === formatTimeOnly('2031-04-09T20:28:00.000Z'))).not.toBeNull();
    const link = screen.getByRole('link', { name: 'Open source note Personal/Mirror & Frame.md, line 2' });
    expect(link.getAttribute('href')).toBe('/notes?note=Personal%2FMirror+%26+Frame.md');
    expect(link.textContent).toBe('Mirror & Frame');
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent))
      .toEqual(['Refresh tasks', 'Completed']);
  });

  it('opens the source note in place instead of navigating away', async () => {
    mount();
    const link = await screen.findByRole('link', { name: 'Open source note Personal/Mirror & Frame.md, line 2' });
    expect(fireEvent.click(link)).toBe(false);
    expect(onOpenNote).toHaveBeenCalledWith('Personal/Mirror & Frame.md');
  });

  it('filters by query and shows completed tasks only when requested', async () => {
    mount('mirror');
    expect(await screen.findByText('Buy a mirror')).not.toBeNull();
    expect(screen.queryByText('Overdue fixture')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/vault/tasks?state=open&q=mirror', expect.anything(),
    );

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Completed' }));
    expect(screen.getByRole('button', { name: 'Completed' }).getAttribute('aria-pressed')).toBe('true');
    expect(await screen.findByRole('heading', { name: 'Done' })).not.toBeNull();
    expect(screen.getByText('Completed fixture')).not.toBeNull();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), { target: { value: 'missing phrase' } });
    expect(await screen.findByText('No matches')).not.toBeNull();
  });

  it('shows an actionable 503 failure and retries without presenting an empty list', async () => {
    fetchMock.mockImplementationOnce(async () => json({ error: 'Vault tasks unavailable', reason: 'scan_limit' }, 503));
    mount();
    expect(await screen.findByText(/safe scan limit was reached/)).not.toBeNull();
    expect(screen.queryByText('No open tasks')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('heading', { name: 'Overdue' })).not.toBeNull();
  });

  it('refreshes from the icon button', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Overdue' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh tasks' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('heading', { name: 'Overdue' })).not.toBeNull();
  });

  it('shows the distinct no-open-tasks empty state', async () => {
    fetchMock.mockResolvedValueOnce(json({
      items: [], readAt: '2031-04-09T12:30:00.000Z', today: '2031-04-09', total: 0, truncated: false,
    }));
    mount();
    expect(await screen.findByText('No open tasks')).not.toBeNull();
  });

  it('says how many of the matching tasks are shown when the list is capped', async () => {
    fetchMock.mockResolvedValueOnce(json({
      items: [allTasks[3]], readAt: '2031-04-09T20:28:00.000Z', today: '2031-04-09', total: 3, truncated: true,
    }));
    mount();
    expect(await screen.findByText('First 1 of 3')).not.toBeNull();
  });

  it('takes focus on open; Escape clears a typed query first and closes the panel otherwise', async () => {
    mount();
    const region = screen.getByRole('region', { name: 'Task list' });
    expect(document.activeElement).toBe(region);
    await screen.findByRole('heading', { name: 'Overdue' });
    const box = screen.getByRole('searchbox', { name: 'Search tasks' });
    fireEvent.change(box, { target: { value: 'mirror' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect((box as HTMLInputElement).value).toBe('');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(region, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('heading', { name: 'Overdue' })).not.toBeNull();
  });
});
