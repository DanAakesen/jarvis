import { describe, expect, it, vi } from 'vitest';
import sql from 'mssql';
import { createNowFeedStore } from './now-feed-store.js';
import { notificationDailyCapPerKind } from '../core/notification-policy.js';

vi.mock('mssql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mssql')>();
  class FakeTransaction {
    constructor(readonly parent: unknown) {}
    async begin() {}
    async commit() {}
    async rollback() {}
  }
  class FakeRequest {
    private readonly parameters: Record<string, unknown> = {};
    constructor(private readonly transaction: FakeTransaction) {}
    input(name: string, _type: unknown, value: unknown) {
      this.parameters[name] = value;
      return this;
    }
    query(query: string) {
      const pool = this.transaction.parent as { query: (sql: string, parameters: Record<string, unknown>) => Promise<unknown> };
      return pool.query(query, this.parameters);
    }
  }
  return { ...actual, default: { ...actual.default, Transaction: FakeTransaction, Request: FakeRequest } };
});

function notificationTable() {
  const rows: { kind: string; title: string; at: Date }[] = [];
  const query = vi.fn(async (statement: string, parameters: Record<string, unknown>) => {
    if (statement.includes('INSERT dbo.activity')) {
      rows.push({ kind: String(parameters.kind), title: String(parameters.title), at: new Date() });
      expect(parameters.alertKey).toMatch(/^notification:/u);
      return { recordset: [] };
    }
    return { recordset: rows };
  });
  return { rows, pool: { query } as unknown as sql.ConnectionPool };
}

describe('Now feed notifications', () => {
  it('persists a bounded alert and refreshes the feed after insertion', async () => {
    const { rows, pool } = notificationTable();
    const onNotificationCreated = vi.fn();
    const store = createNowFeedStore(pool, onNotificationCreated);

    await store.recordNotification!('warning', 'A task needs attention.');

    expect(rows).toEqual([expect.objectContaining({ kind: 'warning', title: 'A task needs attention.' })]);
    expect(onNotificationCreated).toHaveBeenCalledOnce();
  });

  it('stores a repeated notification once', async () => {
    const { rows, pool } = notificationTable();
    const onNotificationCreated = vi.fn();
    const store = createNowFeedStore(pool, onNotificationCreated);

    for (let index = 0; index < 5; index += 1) await store.recordNotification!('error', 'Task 7 is now Done.');

    expect(rows).toHaveLength(1);
    expect(onNotificationCreated).toHaveBeenCalledOnce();
  });

  it('keeps a burst of distinct notifications within the daily cap per kind', async () => {
    const { rows, pool } = notificationTable();
    const store = createNowFeedStore(pool);

    for (let index = 0; index < 60; index += 1) {
      await store.recordNotification!('info', `Task ${index} is now Running.`);
      await store.recordNotification!('warning', `Task ${index} needs attention.`);
    }

    expect(rows.filter(({ kind }) => kind === 'info')).toHaveLength(notificationDailyCapPerKind);
    expect(rows.filter(({ kind }) => kind === 'warning')).toHaveLength(notificationDailyCapPerKind);
  });
});

describe('Now feed dismissal', () => {
  it('dismisses one group or every visible item with the same visibility rules as the feed', async () => {
    const query = vi.fn(async () => ({ recordset: [{ dismissed: 3 }] }));
    const input = vi.fn().mockReturnThis();
    const pool = { request: () => ({ input, query }) } as unknown as sql.ConnectionPool;
    const store = createNowFeedStore(pool);

    expect(await store.dismissGroup!('alert')).toBe(3);
    expect(input).toHaveBeenCalledWith('category', sql.NVarChar(16), 'alert');
    expect(query.mock.calls[0]?.[0]).toContain('category = @category');
    expect(await store.dismissAll!()).toBe(3);
    expect(query.mock.calls[1]?.[0]).toContain('SELECT id FROM visible)');
    expect(query.mock.calls[1]?.[0]).toContain('dismissed_at = COALESCE(dismissed_at');
  });

  it('expires stored notifications from the feed after the retention period', async () => {
    const query = vi.fn().mockResolvedValue({ recordset: [] });
    const pool = { request: () => ({ query }) } as unknown as sql.ConnectionPool;

    await createNowFeedStore(pool).read();

    expect(query.mock.calls[1]?.[0]).toContain("alert_key NOT LIKE N'notification:%' OR");
    expect(query.mock.calls[1]?.[0]).toContain('at > DATEADD(day, -7');
    expect(query.mock.calls[1]?.[0]).toContain("kind <> N'success'");
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
    expect(activityQuery).toContain("alert_key NOT LIKE N'credential:github-app:failed:%' OR recovered_at IS NULL");
    expect(activityQuery).not.toContain("N'mode' AS category");
    expect(activityQuery).not.toContain("kind = N'away_mode'");
  });
});
