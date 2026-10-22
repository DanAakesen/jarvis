import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TasksPanel } from './TasksPanel';
import type { VaultTask } from './tasks-data';

const getAccessToken = vi.fn(async () => 'fixture-token');
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const task = (id: string, text: string, dueDate: string | null, done = false, priority: VaultTask['priority'] = 'normal',
  path = 'Personal/Inbox.md'): VaultTask => ({
  id: id.padStart(64, '0'), text, done, dueDate, dueTime: null,
  dueAt: dueDate ? `${dueDate}T20:28:00.000Z` : null, priority,
  path, line: Number(id), heading: 'Inbox', version: id.padStart(64, 'c'),
});
const allTasks = [
  task('1', 'Overdue fixture', '2031-04-08'),
  task('2', 'Buy a mirror', '2031-04-09', false, 'high', 'Personal/Mirror & Frame.md'),
  task('3', 'Upcoming fixture', '2031-04-10', false, 'medium'),
  task('4', 'No date fixture', null),
  task('5', 'Completed fixture', null, true),
  task('6', 'Work fixture', '2031-04-12', false, 'normal', 'Work/Projects.md'),
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
  fetchMock.mockReset().mockImplementation(async (input, init) => {
    if (init?.method === 'PATCH' || init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { path?: string; line?: number; done?: boolean };
      return json({
        id: '9'.padStart(64, '0'), path: body.path ?? 'Personal/Inbox.md', line: body.line ?? 9, done: body.done ?? false,
        commit: 'a'.repeat(40), version: 'd'.repeat(64),
      });
    }
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

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const writeCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH' || init?.method === 'POST');

describe('Tasks panel', () => {
  it('groups open tasks by the owner date and shows an unticked box with a source-note link', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Overdue' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Today' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Upcoming' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'No date' })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Done' })).toBeNull();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(5);
    expect(boxes.every((box) => box.getAttribute('aria-checked') === 'false')).toBe(true);
    expect(screen.getByText('High')).not.toBeNull();
    expect(screen.getByText('Medium')).not.toBeNull();
    const link = screen.getByRole('link', { name: 'Open source note Personal/Mirror & Frame.md, line 2' });
    expect(link.getAttribute('href')).toBe('/notes?note=Personal%2FMirror+%26+Frame.md');
    expect(link.textContent).toBe('Personal ·Mirror & Frame');
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent))
      .toEqual(['Add a task', 'All', 'Personal', 'Work']);
  });

  it('completes a task at once, offers Undo, and lets it leave the list after a moment', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mount();
    const box = await screen.findByRole('checkbox', { name: 'No date fixture' });
    fireEvent.click(box);
    expect(box.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: 'Undo' })).not.toBeNull();
    await waitFor(() => expect(writeCalls()).toHaveLength(1));
    expect(writeCalls()[0]?.[0]).toBe('https://api.example.com/vault/tasks');
    expect(writeCalls()[0]?.[1]).toMatchObject({ method: 'PATCH' });
    expect(JSON.parse(String(writeCalls()[0]?.[1]?.body))).toEqual({
      path: 'Personal/Inbox.md', line: 4, text: 'No date fixture', version: '4'.padStart(64, 'c'), done: true,
    });
    await act(async () => { vi.advanceTimersByTime(4200); });
    expect(screen.queryByText('No date fixture')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('undoes a completion by saving the task as open again', async () => {
    mount();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'No date fixture' }));
    const undo = await screen.findByRole('button', { name: 'Undo' });
    await waitFor(() => expect((undo as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(undo);
    await waitFor(() => expect(writeCalls()).toHaveLength(2));
    expect(JSON.parse(String(writeCalls()[1]?.[1]?.body))).toMatchObject({ line: 4, done: false, version: 'd'.repeat(64) });
    expect(screen.getByRole('checkbox', { name: 'No date fixture' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('puts the box back and says so when the vault refuses the change', async () => {
    mount();
    const box = await screen.findByRole('checkbox', { name: 'No date fixture' });
    fetchMock.mockImplementationOnce(async () => json({ error: 'This task changed in the vault. Refresh the list.' }, 409));
    fireEvent.click(box);
    expect(await screen.findByText(/changed in your vault/)).not.toBeNull();
    expect(screen.getByRole('checkbox', { name: 'No date fixture' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('?state=open'))).toHaveLength(2));
  });

  it('reopens a completed task found by search', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Overdue' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), { target: { value: 'completed' } });
    const box = await screen.findByRole('checkbox', { name: 'Completed fixture' });
    expect(box.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(box);
    await waitFor(() => expect(writeCalls()).toHaveLength(1));
    expect(JSON.parse(String(writeCalls()[0]?.[1]?.body))).toMatchObject({ text: 'Completed fixture', done: false });
    expect(screen.queryByRole('heading', { name: 'Done' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Completed fixture' }).getAttribute('aria-checked')).toBe('false');
  });

  it('adds a task to the chosen side with an optional due date and time, then reloads the list', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Overdue' });
    fireEvent.click(screen.getByRole('button', { name: 'Work' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a task' }));
    const input = screen.getByRole('textbox', { name: 'New task' });
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole('button', { name: 'Add' }).hasAttribute('disabled')).toBe(true);
    expect(within(screen.getByRole('group', { name: 'Save to' })).getByRole('button', { name: 'Work' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(input, { target: { value: 'Send the synthetic report' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2031-04-10' } });
    fireEvent.change(screen.getByLabelText('Due time'), { target: { value: '09:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(writeCalls()).toHaveLength(1));
    expect(writeCalls()[0]?.[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(writeCalls()[0]?.[1]?.body))).toEqual({
      text: 'Send the synthetic report', scope: 'work', due: '2031-04-10', time: '09:30',
    });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'New task' })).toBeNull());
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('?state=open'))).toHaveLength(2));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add a task' }));
  });

  it('keeps the draft and explains when a new task is refused; Escape cancels only the form', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Overdue' });
    fireEvent.click(screen.getByRole('button', { name: 'Add a task' }));
    const input = screen.getByRole('textbox', { name: 'New task' });
    fireEvent.change(input, { target: { value: 'Keep this draft' } });
    fetchMock.mockImplementationOnce(async () => json({ error: 'The Inbox note is full. Nothing was added.' }, 400));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('The Inbox note is full. Nothing was added.')).not.toBeNull();
    expect((screen.getByRole('textbox', { name: 'New task' }) as HTMLInputElement).value).toBe('Keep this draft');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'New task' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'New task' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('opens the source note in place instead of navigating away', async () => {
    mount();
    const link = await screen.findByRole('link', { name: 'Open source note Personal/Mirror & Frame.md, line 2' });
    expect(fireEvent.click(link)).toBe(false);
    expect(onOpenNote).toHaveBeenCalledWith('Personal/Mirror & Frame.md');
  });

  it('keeps completed tasks out of the list but finds them in search', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Overdue' });
    expect(screen.queryByText('Completed fixture')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/vault/tasks?state=open', expect.anything());

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), { target: { value: 'completed' } });
    expect(await screen.findByRole('heading', { name: 'Done' })).not.toBeNull();
    expect(screen.getByText('Completed fixture')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/vault/tasks?state=all&q=completed', expect.anything());
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), { target: { value: 'missing phrase' } });
    expect(await screen.findByText('No matches')).not.toBeNull();
  });

  it('filters by Personal and Work without another request', async () => {
    mount();
    await screen.findByText('Work fixture');
    const calls = fetchMock.mock.calls.length;
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Work' }));
    expect(screen.getByRole('button', { name: 'Work' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Work fixture')).not.toBeNull();
    expect(screen.queryByText('Buy a mirror')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Personal' }));
    expect(screen.queryByText('Work fixture')).toBeNull();
    expect(screen.getByText('Buy a mirror')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  it('names Personal or Work in words in the All view, and drops the cue once a filter says it', async () => {
    mount();
    await screen.findByText('Work fixture');
    const label = (name: string) => screen.getByRole('link', { name: new RegExp(`^Open source note ${name}`, 'u') }).textContent;
    expect(label('Personal/Inbox.md, line 1')).toBe('Personal ·Inbox');
    expect(label('Work/Projects.md')).toBe('Work ·Projects');

    fireEvent.click(screen.getByRole('button', { name: 'Work' }));
    expect(label('Work/Projects.md')).toBe('Projects');
  });

  it('files root-file tasks under Work when their heading says so', async () => {
    fetchMock.mockResolvedValueOnce(json({
      items: [{ ...task('7', 'Root work fixture', null, false, 'normal', 'task.md'), heading: 'Work > Ops' },
        { ...task('8', 'Root home fixture', null, false, 'normal', 'task.md'), heading: 'Home' }],
      readAt: '2031-04-09T20:28:00.000Z', today: '2031-04-09', total: 2, truncated: false,
    }));
    mount();
    await screen.findByText('Root work fixture');
    fireEvent.click(screen.getByRole('button', { name: 'Work' }));
    expect(screen.getByText('Root work fixture')).not.toBeNull();
    expect(screen.queryByText('Root home fixture')).toBeNull();
  });

  it('says when nothing open matches the chosen filter', async () => {
    mount();
    await screen.findByText('Work fixture');
    fireEvent.click(screen.getByRole('button', { name: 'Work' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), { target: { value: 'mirror' } });
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
