import { describe, expect, it, vi } from 'vitest';
import sql from 'mssql';
import { createNowFeedStore } from './now-feed-store.js';

describe('Now feed notifications', () => {
  it('persists a bounded alert and refreshes the feed after insertion', async () => {
    const query = vi.fn(async () => ({ recordset: [] }));
    const request = {
      input: vi.fn().mockReturnThis(),
      query,
    };
    const pool = { request: () => request } as unknown as sql.ConnectionPool;
    const onNotificationCreated = vi.fn();
    const store = createNowFeedStore(pool, onNotificationCreated);

    await store.recordNotification!('warning', 'A task needs attention.');

    expect(request.input).toHaveBeenCalledWith('kind', sql.NVarChar(32), 'warning');
    expect(request.input).toHaveBeenCalledWith('title', sql.NVarChar(400), 'A task needs attention.');
    expect(request.input).toHaveBeenCalledWith('alertKey', sql.NVarChar(200), expect.stringMatching(/^notification:/u));
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT dbo.activity'));
    expect(onNotificationCreated).toHaveBeenCalledOnce();
  });
});

describe('Now feed activity query', () => {
  it('does not include persisted presence transitions as feed activity', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [] });
    const request = { query };
    const pool = { request: () => request } as unknown as sql.ConnectionPool;

    await createNowFeedStore(pool).read();

    const activityQuery = query.mock.calls[1]?.[0];
    expect(activityQuery).toContain("N'attention' AS category");
    expect(activityQuery).not.toContain("N'mode' AS category");
    expect(activityQuery).not.toContain("kind = N'away_mode'");
  });
});
