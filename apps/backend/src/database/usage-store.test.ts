import sql from 'mssql';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUsageStore } from './usage-store.js';

describe('SQL usage store', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns grouped usage with exact period bounds and includes live sandbox estimates', async () => {
    const row = {
      taskId: '42',
      taskTitle: 'Fix the bug',
      projectId: '7',
      projectName: 'Jarvis',
      agent: 'codex' as const,
      source: 'sandbox' as const,
      metric: 'minutes' as const,
      role: null,
      model: null,
      quantity: 12.5,
      costUsd: 0.0304,
      costDkk: 0.2,
      costStatus: 'estimated' as const,
      at: new Date('2026-10-04T03:00:00.000Z'),
      estimated: true,
      totalEntries: '1',
    };
    const query = vi.fn()
      .mockResolvedValueOnce({ recordset: [row] })
      .mockResolvedValueOnce({ recordset: [{ tool: 'image_generation', count: '2' }] })
      .mockResolvedValueOnce({ recordset: [
        { period: 'daily', bucket: '2026-10-04', usd: 0.0304, dkk: 0.2, estimatedEntries: 1, unverifiedEntries: 0 },
        { period: 'monthly', bucket: '2026-10', usd: 0.0304, dkk: 0.2, estimatedEntries: 1, unverifiedEntries: 0 },
      ] })
      .mockResolvedValueOnce({ recordset: [
        { tool: 'image_generation', count: '2' },
        { tool: 'research', count: '3' },
      ] });
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
        role: row.role,
        model: row.model,
        quantity: row.quantity,
        costUsd: row.costUsd,
        costDkk: row.costDkk,
        costStatus: row.costStatus,
        at: '2026-10-04T03:00:00.000Z',
        estimated: row.estimated,
      }],
      totalEntries: '1',
      dailyToolCounts: [{ tool: 'image_generation', count: '2' }],
      dailyCostTotals: [{
        period: '2026-10-04', usd: 0.0304, dkk: 0.2, estimatedEntries: 1, unverifiedEntries: 0,
      }],
      monthlyCostTotals: [{
        period: '2026-10', usd: 0.0304, dkk: 0.2, estimatedEntries: 1, unverifiedEntries: 0,
      }],
      toolCalls: [
        { tool: 'image_generation', count: '2', costStatus: 'unverified' },
        { tool: 'research', count: '3', costStatus: 'unverified' },
      ],
    });
    expect(input).toHaveBeenNthCalledWith(1, 'from', sql.DateTime2, from);
    expect(input).toHaveBeenNthCalledWith(2, 'to', sql.DateTime2, to);
    expect(input).toHaveBeenNthCalledWith(3, 'from', sql.DateTime2, new Date('2026-10-04T00:00:00.000Z'));
    expect(input).toHaveBeenNthCalledWith(4, 'to', sql.DateTime2, to);
    expect(query.mock.calls[0]?.[0]).toContain('FROM dbo.usage');
    expect(query.mock.calls[0]?.[0]).toContain('FROM dbo.sandbox_sessions s');
    expect(query.mock.calls[0]?.[0]).toContain("u.source IN (N'codex', N'copilot') THEN NULL");
    expect(query.mock.calls[0]?.[0]).toContain('SUM(CASE WHEN u.source');
    expect(query.mock.calls[0]?.[0]).toContain('SELECT TOP (1000)');
    expect(query.mock.calls[1]?.[0]).toContain('FROM dbo.tool_calls');
    expect(query.mock.calls[1]?.[0]).toContain('COUNT_BIG(*)');
    expect(query.mock.calls[0]?.[0]).toContain('u.role, u.model, u.costStatus');
    expect(query.mock.calls[2]?.[0]).toContain('GROUP BY CONVERT(date, at)');
    expect(query.mock.calls[2]?.[0]).toContain('GROUP BY YEAR(at), MONTH(at)');
    expect(query.mock.calls[3]?.[0]).toContain("N'image_generation'");
    expect(input).toHaveBeenNthCalledWith(7, 'dailyFrom', sql.DateTime2, from);
  });

  it('records role/model token quantities idempotently and prices only known models', async () => {
    const query = vi.fn(async () => ({ rowsAffected: [2] }));
    const input = vi.fn();
    const request = { input, query };
    input.mockReturnValue(request);
    const transaction = {
      begin: vi.fn(async () => {}),
      request: vi.fn(() => request),
      commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => {}),
    };
    vi.spyOn(sql, 'Transaction').mockImplementation(function () {
      return transaction as unknown as sql.Transaction;
    });
    const pool = {} as sql.ConnectionPool;

    await createUsageStore(pool).recordFoundryUsage!({
      role: 'chat',
      model: 'gpt-5.6-luna',
      inputTokens: 100,
      outputTokens: 20,
      eventId: 'a2a01070-225e-4d8b-b882-f925cf177603',
    });

    expect(transaction.begin).toHaveBeenCalledOnce();
    expect(input).toHaveBeenCalledWith('role', sql.NVarChar(24), 'chat');
    expect(input).toHaveBeenCalledWith('model', sql.NVarChar(128), 'gpt-5.6-luna');
    expect(input).toHaveBeenCalledWith('costStatus', sql.NVarChar(16), 'estimated');
    expect(input).toHaveBeenCalledWith('inputDkk', sql.Decimal(19, 8), 0.00013157);
    expect(input).toHaveBeenCalledWith('inputUsd', sql.Decimal(19, 8), 0.00002);
    expect(query.mock.calls[0]?.[0]).toContain('WHERE NOT EXISTS');
    expect(query.mock.calls[0]?.[0]).toContain('WITH (UPDLOCK, HOLDLOCK)');
    expect(transaction.commit).toHaveBeenCalledOnce();
  });
});
