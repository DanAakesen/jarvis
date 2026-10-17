import sql from 'mssql';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackgroundJobStore } from './background-job-store.js';

afterEach(() => { vi.restoreAllMocks(); });

const owner = '11111111-1111-4111-8111-111111111111';
const finishedId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const runningId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function dismissalSqlFixture(rows: Array<{ job_id: string; status: string }> = []) {
  const transaction = {
    begin: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
  };
  const request = {
    input: vi.fn().mockReturnThis(),
    query: vi.fn().mockResolvedValue({ recordset: rows }),
  };
  const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
  vi.spyOn(sql, 'Transaction').mockImplementation(function () { return transaction as unknown as sql.Transaction; });
  vi.spyOn(sql, 'Request').mockImplementation(function () { return request as unknown as sql.Request; });
  return { transaction, request, store: createBackgroundJobStore(pool) };
}

describe('SQL background job dismissals', () => {
  it('binds owner-specific dismissal reads and excludes expired jobs', async () => {
    const { request, store } = dismissalSqlFixture([{ job_id: finishedId.toUpperCase(), status: 'done' }]);
    await expect(store.listDismissed!(owner)).resolves.toEqual([finishedId]);
    expect(request.input).toHaveBeenCalledWith('ownerObjectId', sql.UniqueIdentifier, owner);
    expect(request.query.mock.calls[0]?.[0]).toContain('dismissal.owner_object_id = @ownerObjectId');
    expect(request.query.mock.calls[0]?.[0]).toContain('job.started_at >= DATEADD(day, -30, SYSUTCDATETIME())');
    expect(request.query.mock.calls[0]?.[0]).toContain('SELECT TOP (1000)');
    expect(request.query.mock.calls[0]?.[0]).toContain('ORDER BY dismissal.dismissed_at DESC');
  });

  it('bounds visible SQL results while excluding against all persisted dismissals, not a limited tombstone list', async () => {
    const { request, store } = dismissalSqlFixture();
    await expect(store.listVisible!(owner)).resolves.toEqual([]);
    expect(request.input).toHaveBeenCalledWith('ownerObjectId', sql.UniqueIdentifier, owner);
    const statement = request.query.mock.calls[1]?.[0] as string;
    expect(statement).toContain('SELECT TOP (1000) job.job_id');
    expect(statement).toContain('AND NOT EXISTS (SELECT 1 FROM dbo.background_job_dismissals');
    expect(statement).toContain('dismissal.owner_object_id = @ownerObjectId AND dismissal.job_id = job.job_id');
    expect(statement).toContain("ORDER BY CASE WHEN job.status = N'running' THEN 0 ELSE 1 END");
    expect(statement).toContain('job.started_at DESC');
  });

  it('normalizes and deduplicates bound IDs, atomically inserts only confirmed terminal jobs and never changes audit rows', async () => {
    const { request, transaction, store } = dismissalSqlFixture([{ job_id: finishedId.toUpperCase(), status: 'done' }]);
    await expect(store.dismiss!(owner, [finishedId.toUpperCase(), finishedId])).resolves.toEqual({
      dismissedJobIds: [finishedId], runningJobIds: [],
    });
    expect(transaction.begin).toHaveBeenCalledWith(sql.ISOLATION_LEVEL.SERIALIZABLE);
    expect(request.input).toHaveBeenCalledWith('jobIds', expect.anything(), JSON.stringify([finishedId]));
    expect(request.input).toHaveBeenCalledWith('ownerObjectId', sql.UniqueIdentifier, owner);
    const statements = request.query.mock.calls.map(([statement]) => statement as string);
    expect(statements[0]).toContain('WITH (UPDLOCK, HOLDLOCK)');
    expect(statements[0]).toContain('SELECT [value] FROM OPENJSON(@jobIds)');
    expect(statements[0]).toContain('started_at >= DATEADD(day, -30, SYSUTCDATETIME())');
    expect(statements[1]).toContain('INSERT dbo.background_job_dismissals');
    expect(statements[1]).toContain('WHERE NOT EXISTS');
    expect(statements[1]).toContain('owner_object_id = @ownerObjectId AND job_id = requested.[value]');
    expect(statements.join('\n')).not.toMatch(/(?:UPDATE|DELETE|INSERT)\s+dbo\.background_jobs\b/u);
    expect(transaction.commit).toHaveBeenCalledOnce();
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('rolls back a strict dismissal batch when any requested known job is running', async () => {
    const { request, transaction, store } = dismissalSqlFixture([
      { job_id: finishedId, status: 'failed' }, { job_id: runningId, status: 'running' },
    ]);
    await expect(store.dismiss!(owner, [finishedId, runningId])).resolves.toEqual({
      dismissedJobIds: [], runningJobIds: [runningId],
    });
    expect(request.query).toHaveBeenCalledOnce();
    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it('allows legacy import to skip running IDs while committing only terminal dismissals', async () => {
    const { request, transaction, store } = dismissalSqlFixture([
      { job_id: finishedId, status: 'failed' }, { job_id: runningId, status: 'running' },
    ]);
    await expect(store.dismiss!(owner, [finishedId, runningId], true)).resolves.toEqual({
      dismissedJobIds: [finishedId], runningJobIds: [runningId],
    });
    expect(request.input).toHaveBeenLastCalledWith('jobIds', expect.anything(), JSON.stringify([finishedId]));
    expect(transaction.commit).toHaveBeenCalledOnce();
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('dismisses only terminal jobs for clear-finished and safely returns no confirmations for absent IDs', async () => {
    const { request, transaction, store } = dismissalSqlFixture();
    await expect(store.dismiss!(owner)).resolves.toEqual({ dismissedJobIds: [], runningJobIds: [] });
    expect(request.input).toHaveBeenCalledWith('ownerObjectId', sql.UniqueIdentifier, owner);
    const statement = request.query.mock.calls[0]?.[0] as string;
    expect(statement).toContain("AND job.status <> N'running'");
    expect(statement).toContain('SELECT @ownerObjectId, job.job_id FROM dbo.background_jobs');
    expect(statement).not.toMatch(/SELECT TOP \(1000\)[\s\S]*INSERT/u);
    expect(statement).toContain('SELECT TOP (1000) dismissal.job_id');
    await expect(store.dismiss!(owner, [finishedId])).resolves.toEqual({ dismissedJobIds: [], runningJobIds: [] });
    expect(request.query).toHaveBeenCalledTimes(2);
    expect(transaction.commit).toHaveBeenCalledTimes(2);
  });

  it('propagates write failures after rollback rather than acknowledging unsaved dismissals', async () => {
    const { request, transaction, store } = dismissalSqlFixture([{ job_id: finishedId, status: 'cancelled' }]);
    request.query.mockResolvedValueOnce({ recordset: [{ job_id: finishedId, status: 'cancelled' }] })
      .mockRejectedValueOnce(new Error('SQL unavailable'));
    await expect(store.dismiss!(owner, [finishedId])).rejects.toThrow('SQL unavailable');
    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it('rejects malformed or oversized internal requests before opening SQL transactions', async () => {
    const { transaction, request, store } = dismissalSqlFixture();
    await expect(store.listDismissed!('not-owner')).rejects.toThrow(TypeError);
    await expect(store.dismiss!('not-owner', [finishedId])).rejects.toThrow(TypeError);
    await expect(store.dismiss!(owner, ['------------------------------------'])).rejects.toThrow(TypeError);
    await expect(store.dismiss!(owner, Array.from({ length: 1_001 }, () => finishedId))).rejects.toThrow(TypeError);
    expect(transaction.begin).not.toHaveBeenCalled();
    expect(request.query).not.toHaveBeenCalled();
  });
});

describe('SQL background health aggregate', () => {
  it('binds the failure time range and returns bounded counts without reading private text', async () => {
    const query = vi.fn(async () => ({ recordset: [{ count: 1_234, retryable: 1 }] }));
    const input = vi.fn();
    const cancel = vi.fn();
    const request = { input, query, cancel };
    input.mockReturnValue(request);
    const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
    const controller = new AbortController();
    const from = new Date('2026-10-10T11:00:00.000Z');
    const to = new Date('2026-10-10T12:00:00.000Z');
    await expect(createBackgroundJobStore(pool).recentFailures!(from, to, controller.signal))
      .resolves.toEqual({ count: 1_000, retryable: true });
    expect(input).toHaveBeenNthCalledWith(1, 'from', sql.DateTime2, from);
    expect(input).toHaveBeenNthCalledWith(2, 'to', sql.DateTime2, to);
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain("WHERE status = N'failed'");
    expect(query.mock.calls[0]?.[0]).toContain('updated_at >= @from AND updated_at <= @to');
    expect(query.mock.calls[0]?.[0]).not.toMatch(/\b(?:title|detail|view_id)\b/u);
    controller.abort();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('cancels an in-flight SQL aggregate on abort and removes the listener', async () => {
    let reject: (error: Error) => void = () => {};
    const query = vi.fn(() => new Promise<never>((_resolve, fail) => { reject = fail; }));
    const input = vi.fn();
    const cancel = vi.fn(() => reject(new Error('Cancelled')));
    const request = { input, query, cancel };
    input.mockReturnValue(request);
    const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
    const controller = new AbortController();
    const pending = createBackgroundJobStore(pool).recentFailures!(new Date(0), new Date(1), controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('Cancelled');
    expect(cancel).toHaveBeenCalledOnce();
    await expect(createBackgroundJobStore(pool).recentFailures!(new Date(0), new Date(1), controller.signal))
      .rejects.toThrow();
    expect(query).toHaveBeenCalledOnce();
  });
});
