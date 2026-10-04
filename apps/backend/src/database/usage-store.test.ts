import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createUsageStore } from './usage-store.js';

describe('SQL usage store', () => {
  it('returns grouped usage with exact period bounds and includes live sandbox estimates', async () => {
    const row = {
      taskId: '42',
      taskTitle: 'Fix the bug',
      projectId: '7',
      projectName: 'Jarvis',
      agent: 'codex' as const,
      source: 'sandbox' as const,
      metric: 'minutes' as const,
      quantity: 12.5,
      costDkk: 0.2,
      at: new Date('2026-10-04T03:00:00.000Z'),
      estimated: true,
      totalEntries: '1',
    };
    const query = vi.fn(async () => ({ recordset: [row] }));
    const input = vi.fn();
    const request = { input, query };
    input.mockReturnValue(request);
    const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
    const from = new Date('2026-10-03T03:00:00.000Z');
    const to = new Date('2026-10-04T03:00:00.000Z');

    const report = await createUsageStore(pool).list(from, to);

    expect(report).toEqual({
      entries: [{
        taskId: row.taskId,
        taskTitle: row.taskTitle,
        projectId: row.projectId,
        projectName: row.projectName,
        agent: row.agent,
        source: row.source,
        metric: row.metric,
        quantity: row.quantity,
        costDkk: row.costDkk,
        at: '2026-10-04T03:00:00.000Z',
        estimated: row.estimated,
      }],
      totalEntries: '1',
    });
    expect(input).toHaveBeenNthCalledWith(1, 'from', sql.DateTime2, from);
    expect(input).toHaveBeenNthCalledWith(2, 'to', sql.DateTime2, to);
    expect(query.mock.calls[0]?.[0]).toContain('FROM dbo.usage');
    expect(query.mock.calls[0]?.[0]).toContain('FROM dbo.sandbox_sessions s');
    expect(query.mock.calls[0]?.[0]).toContain("u.source IN (N'codex', N'copilot') THEN NULL");
    expect(query.mock.calls[0]?.[0]).toContain('SUM(CASE WHEN u.source');
    expect(query.mock.calls[0]?.[0]).toContain('SELECT TOP (1000)');
  });
});
