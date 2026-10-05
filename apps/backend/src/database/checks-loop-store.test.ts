import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createChecksLoopStore } from './checks-loop-store.js';

function setup(result: { recordset?: unknown[]; rowsAffected?: number[] } = {}) {
  const query = vi.fn(async () => ({
    recordset: result.recordset ?? [],
    rowsAffected: result.rowsAffected ?? [],
  }));
  const input = vi.fn().mockReturnThis();
  const request = { input, query };
  const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
  return { input, pool, query, store: createChecksLoopStore(pool) };
}

const failedRun = {
  repository: 'DanAakesen/jarvis',
  runId: '71',
  workflow: 'CI',
  pullRequestNumber: 19,
  taskId: '42',
  taskState: 'Running',
  failedRunCount: 2,
  logArtifact: null,
};

describe('checks loop store', () => {
  it('loads a failed PR run linked to its task and counts that task’s failed runs', async () => {
    const { input, query, store } = setup({ recordset: [failedRun] });

    await expect(store.getFailedRun(failedRun.repository, 71)).resolves.toEqual({
      ...failedRun,
      runId: 71,
    });

    expect(query.mock.calls[0]?.[0]).toContain('COUNT(DISTINCT failedRun.id)');
    expect(query.mock.calls[0]?.[0]).toContain('failedPullRequest.task_id = task.id');
    expect(query.mock.calls[0]?.[0]).toContain("JSON_VALUE(failedEvent.payload, '$.checkRunId')");
    expect(input).toHaveBeenCalledWith('repository', sql.NVarChar(140), failedRun.repository);
    expect(input).toHaveBeenCalledWith('runId', sql.BigInt, 71);
  });

  it('returns no run for an unmatched webhook mapping', async () => {
    const { store } = setup();

    await expect(store.getFailedRun(failedRun.repository, 71)).resolves.toBeNull();
  });

  it('rejects invalid event types and reports an unsaved log artifact', async () => {
    const { query, store } = setup({ rowsAffected: [0] });

    await expect(store.hasEvent('42', 71, 'created' as never)).rejects.toThrow('Checks loop event type is invalid');
    await expect(store.setLogArtifact(failedRun.repository, 71, 'check-logs/42/71.log'))
      .rejects.toThrow('Check log reference could not be saved');
    expect(query.mock.calls[0]?.[0]).toContain('UPDATE run SET log_artifact = @name');
  });

  it('matches durable check-run markers for retries and steers', async () => {
    const { input, query, store } = setup({ recordset: [{ found: true }] });

    await expect(store.hasEvent('42', 71, 'checks_retry_started')).resolves.toBe(true);
    expect(query.mock.calls[0]?.[0]).toContain("JSON_VALUE(payload, '$.checkRunId') = @runId");
    expect(input).toHaveBeenCalledWith('taskId', sql.BigInt, 42n);
    expect(input).toHaveBeenCalledWith('runId', sql.NVarChar(20), '71');

    await store.hasEvent('42', 71, 'steered');
    expect(query.mock.calls[1]?.[0]).toContain('CHARINDEX(@marker, CONVERT(nvarchar(max), payload))');
    expect(input).toHaveBeenCalledWith('marker', sql.NVarChar(64), 'JARVIS_CHECK_RUN_ID=71');
  });
});
