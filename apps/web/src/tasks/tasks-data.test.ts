import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addVaultTask, loadVaultTasks, readVaultTaskResponse, setVaultTaskDone, VaultTaskConflict, VaultTasksUnavailable, vaultTaskRecovery,
} from './tasks-data';

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const id = 'a'.repeat(64);
const response = {
  items: [{
    id, text: 'Buy a mirror', done: false, dueDate: '2031-04-09', dueTime: '14:30',
    dueAt: '2031-04-09T12:30:00.000Z', priority: 'high', path: 'Personal/Inbox.md',
    line: 4, heading: 'Home', version: 'e'.repeat(64),
  }],
  readAt: '2031-04-09T12:00:00.000Z',
  today: '2031-04-09',
  total: 1,
  truncated: false,
};

afterEach(() => vi.unstubAllGlobals());

describe('vault task API client', () => {
  it('validates the bounded response and rejects malformed items', () => {
    expect(readVaultTaskResponse(response)).toMatchObject({
      total: 1, today: '2031-04-09', items: [{ text: 'Buy a mirror', path: 'Personal/Inbox.md' }],
    });
    expect(() => readVaultTaskResponse({ ...response, items: [{ ...response.items[0], line: 0 }] })).toThrow();
    expect(() => readVaultTaskResponse({ ...response, items: Array(501).fill(response.items[0]) })).toThrow();
  });

  it('uses authenticated no-store reads and passes the query and state filters', async () => {
    const fetchMock = vi.fn(async () => json(response));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadVaultTasks(
      'https://api.example.com/', async () => 'fixture-token', 'mirror lamp', 'all', new AbortController().signal,
    )).resolves.toMatchObject({ total: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/vault/tasks?state=all&q=mirror+lamp',
      expect.objectContaining({
        cache: 'no-store',
        headers: { Authorization: `${['Bear', 'er'].join('')} fixture-token`, Accept: 'application/json' },
      }),
    );
  });

  it('preserves stable 503 reasons and gives a plain recovery for every supported failure', async () => {
    const reasons = [
      'not_connected', 'app_not_installed', 'token_failed', 'todo_file_missing',
      'todo_file_ambiguous', 'scan_limit', 'too_large', 'timeout', 'read_failed',
    ] as const;
    for (const reason of reasons) {
      vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'Unavailable', reason }, 503)));
      await expect(loadVaultTasks(
        'https://api.example.com', async () => 'token', '', 'open', new AbortController().signal,
      )).rejects.toMatchObject({ reason });
      expect(vaultTaskRecovery(reason)).toBeTruthy();
    }
    await expect(loadVaultTasks(null, async () => 'token', '', 'open', new AbortController().signal))
      .rejects.toBeInstanceOf(VaultTasksUnavailable);
  });

  it('sends an authenticated PATCH to tick a task and an authenticated POST to add one', async () => {
    const confirmation = { id, path: 'Personal/Inbox.md', line: 4, done: true, commit: 'b'.repeat(40), version: 'f'.repeat(64) };
    const fetchMock = vi.fn(async () => json(confirmation));
    vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal;
    const headers = {
      Authorization: `${['Bear', 'er'].join('')} fixture-token`, Accept: 'application/json', 'Content-Type': 'application/json',
    };
    await expect(setVaultTaskDone('https://api.example.com/', async () => 'fixture-token',
      { path: 'Personal/Inbox.md', line: 4, text: 'Buy a mirror', version: 'e'.repeat(64) }, true, signal))
      .resolves.toMatchObject({ line: 4, done: true, version: 'f'.repeat(64) });
    expect(fetchMock).toHaveBeenLastCalledWith('https://api.example.com/vault/tasks', expect.objectContaining({
      method: 'PATCH', cache: 'no-store', headers,
      body: JSON.stringify({ path: 'Personal/Inbox.md', line: 4, text: 'Buy a mirror', version: 'e'.repeat(64), done: true }),
    }));
    await addVaultTask('https://api.example.com', async () => 'fixture-token', { text: 'Book a haircut', scope: 'personal' }, signal);
    expect(fetchMock).toHaveBeenLastCalledWith('https://api.example.com/vault/tasks', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ text: 'Book a haircut', scope: 'personal' }),
    }));
    await addVaultTask('https://api.example.com', async () => 'fixture-token',
      { text: 'Send a report', scope: 'work', due: '2031-04-10', time: '09:30' }, signal);
    expect(fetchMock).toHaveBeenLastCalledWith('https://api.example.com/vault/tasks', expect.objectContaining({
      body: JSON.stringify({ text: 'Send a report', scope: 'work', due: '2031-04-10', time: '09:30' }),
    }));
  });

  it('turns write failures into plain, specific errors', async () => {
    const signal = new AbortController().signal;
    const tick = () => setVaultTaskDone('https://api.example.com', async () => 'token',
      { path: 'Personal/Inbox.md', line: 4, text: 'x', version: 'e'.repeat(64) }, true, signal);
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'This task changed in the vault. Refresh the list.' }, 409)));
    await expect(tick()).rejects.toBeInstanceOf(VaultTaskConflict);
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'The Inbox note is full. Nothing was added.' }, 400)));
    await expect(addVaultTask('https://api.example.com', async () => 'token', { text: 'xx', scope: 'work' }, signal))
      .rejects.toThrow('The Inbox note is full. Nothing was added.');
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'internal detail' }, 503)));
    await expect(tick()).rejects.toThrow('The task could not be saved. Try again.');
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 403)));
    await expect(tick()).rejects.toThrow('Sign in again');
    vi.stubGlobal('fetch', vi.fn(async () => json({ id: 'short' })));
    await expect(tick()).rejects.toThrow('invalid task confirmation');
    await expect(setVaultTaskDone(null, async () => 'token', { path: 'a', line: 1, text: 'x', version: 'e'.repeat(64) }, true, signal))
      .rejects.toBeInstanceOf(VaultTasksUnavailable);
  });
});
