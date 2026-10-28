import { describe, expect, it, vi } from 'vitest';
import sql from 'mssql';
import { createTaskStatusNotificationStore } from './task-status-notification-store.js';

describe('task status notification store', () => {
  it('writes the message and receipt in one rollback-protected transaction and reports duplicates', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ recordset: [{ delivered: true }] })
      .mockResolvedValueOnce({ recordset: [{ delivered: false }] });
    const request = {
      input: vi.fn().mockReturnThis(),
      query,
    };
    const store = createTaskStatusNotificationStore({ request: () => request } as unknown as sql.ConnectionPool);

    await expect(store.deliver('42', 'Done', { sessionId: '5', text: 'Synthetic completion', language: 'en' })).resolves.toBe(true);
    await expect(store.deliver('42', 'Done', { sessionId: '5', text: 'Synthetic completion', language: 'en' })).resolves.toBe(false);

    expect(request.input).toHaveBeenNthCalledWith(1, 'taskId', sql.BigInt, 42n);
    expect(request.input).toHaveBeenNthCalledWith(2, 'state', sql.NVarChar(32), 'Done');
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain('IF NOT EXISTS');
    expect(query.mock.calls[0]?.[0]).toContain('INSERT dbo.messages');
    expect(query.mock.calls[0]?.[0]).toContain('ROLLBACK TRANSACTION');
  });
});
