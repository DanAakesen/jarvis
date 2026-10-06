import { describe, expect, it, vi } from 'vitest';
import sql from 'mssql';
import { createTaskStatusNotificationStore } from './task-status-notification-store.js';

describe('task status notification store', () => {
  it('claims a task/state key with one insert and reports duplicates', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ recordset: [{ taskId: '42' }] })
      .mockResolvedValueOnce({ recordset: [] });
    const request = {
      input: vi.fn().mockReturnThis(),
      query,
    };
    const store = createTaskStatusNotificationStore({ request: () => request } as unknown as sql.ConnectionPool);

    await expect(store.claim('42', 'Done')).resolves.toBe(true);
    await expect(store.claim('42', 'Done')).resolves.toBe(false);

    expect(request.input).toHaveBeenNthCalledWith(1, 'taskId', sql.BigInt, 42n);
    expect(request.input).toHaveBeenNthCalledWith(2, 'state', sql.NVarChar(32), 'Done');
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain('WHERE NOT EXISTS');
  });
});
