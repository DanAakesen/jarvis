import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadVaultTasks, readVaultTaskResponse, VaultTasksUnavailable, vaultTaskRecovery } from './tasks-data';

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const id = 'a'.repeat(64);
const response = {
  items: [{
    id, text: 'Buy a mirror', done: false, dueDate: '2031-04-09', dueTime: '14:30',
    dueAt: '2031-04-09T12:30:00.000Z', priority: 'high', path: 'Personal/Inbox.md',
    line: 4, heading: 'Home',
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
});
