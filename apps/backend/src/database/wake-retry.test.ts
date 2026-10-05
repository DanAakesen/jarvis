import { EventEmitter } from 'node:events';
import sql from 'mssql';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseWakeRetry, databaseReadRequest, isDatabaseResumeError } from './wake-retry.js';

afterEach(() => { vi.useRealTimers(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function fixture() {
  const pool = new sql.ConnectionPool({ server: 'fixture' });
  pool.on('error', () => {});
  const acquire = vi.fn<() => Promise<object>>();
  const release = vi.fn();
  // Use the real public mssql acquire and Request; replace only transport.
  Object.assign(pool, { _connected: true, _acquire: acquire, release });
  const controller = new AbortController();
  const wake = createDatabaseWakeRetry(pool, controller.signal);
  return { pool, acquire, release, controller, wake };
}

function transport(error?: Error) {
  const connection = new EventEmitter();
  const execSql = vi.fn((request: { callback(error?: Error): void }) => { request.callback(error); });
  const beginTransaction = vi.fn((callback: (error?: Error) => void) => { callback(error); });
  const commitTransaction = vi.fn((callback: () => void) => { callback(); });
  const rollbackTransaction = vi.fn((callback: () => void) => { callback(); });
  return Object.assign(connection, { execSql, beginTransaction, commitTransaction, rollbackTransaction });
}

describe('serverless database wake retry', () => {
  it.each([40613, 40197, 40501])('retries SQL resume error %i before a real parameterized write executes once', async (number) => {
    vi.useFakeTimers();
    const { pool, acquire, release, wake } = fixture();
    const connection = transport();
    acquire.mockRejectedValueOnce({ originalError: { info: { number } } }).mockResolvedValue(connection);
    const request = pool.request().input('name', sql.NVarChar(20), 'fixture');
    const result = request.query('INSERT INTO dbo.projects (name) VALUES (@name)');
    await vi.advanceTimersByTimeAsync(0);
    expect(wake.isWaking()).toBe(true);
    expect(connection.execSql).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    await result;
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(connection.execSql).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(wake.isWaking()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('succeeds beyond the previous 30-second timeout without changing the query timeout', async () => {
    vi.useFakeTimers();
    const { pool, acquire, wake } = fixture();
    const first = deferred<object>();
    const connection = transport();
    acquire.mockImplementationOnce(() => first.promise).mockResolvedValue(connection);
    const result = pool.request().query('SELECT 1');
    await vi.advanceTimersByTimeAsync(30_000);
    first.reject(new sql.ConnectionError('fixture timeout', 'ETIMEOUT'));
    await vi.advanceTimersByTimeAsync(1_000);
    await result;
    expect(wake.isWaking()).toBe(false);
    expect(connection.execSql).toHaveBeenCalledOnce();
  });

  it('does not retry permanent errors or classify unrelated messages/query timeouts', async () => {
    vi.useFakeTimers();
    const { pool, acquire, wake } = fixture();
    const error = new sql.ConnectionError('fixture login failure', 'ELOGIN');
    acquire.mockRejectedValue(error);
    const result = expect(pool.request().query('SELECT 1')).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(0);
    await result;
    expect(acquire).toHaveBeenCalledOnce();
    expect(wake.isWaking()).toBe(false);
    expect(isDatabaseResumeError(new Error('40613 timeout'))).toBe(false);
    expect(isDatabaseResumeError(new sql.RequestError('Timeout', 'ETIMEOUT'))).toBe(false);
  });

  it('recognizes Tarn acquisition timeouts and bounds cyclic and wide error trees', () => {
    class TimeoutError extends Error {}
    expect(isDatabaseResumeError(new TimeoutError())).toBe(true);
    const error: { cause?: unknown; precedingErrors?: unknown[] } = {};
    error.cause = error;
    error.precedingErrors = Array.from({ length: 100 }, () => ({}));
    expect(isDatabaseResumeError(error)).toBe(false);
    expect(isDatabaseResumeError(Object.create(null))).toBe(false);
    expect(isDatabaseResumeError({ cause: { precedingErrors: [{ number: 40501 }] } })).toBe(true);
  });

  it('includes a hanging attempt in the strict 90-second budget and releases its late connection', async () => {
    vi.useFakeTimers();
    const { pool, acquire, release, wake } = fixture();
    const late = deferred<object>();
    acquire.mockRejectedValueOnce({ number: 40613 }).mockImplementationOnce(() => late.promise);
    const result = expect(pool.request().query('SELECT 1')).rejects.toMatchObject({ code: 'ETIMEOUT' });
    await vi.advanceTimersByTimeAsync(89_999);
    expect(wake.isWaking()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(wake.isWaking()).toBe(false);
    const connection = transport();
    late.resolve(connection);
    await wake.settle();
    expect(release).toHaveBeenCalledExactlyOnceWith(connection);
    expect(connection.execSql).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops repeated failures and backoff at exactly 90 seconds', async () => {
    vi.useFakeTimers();
    const { pool, acquire, wake } = fixture();
    acquire.mockRejectedValue({ number: 40197 });
    const result = expect(pool.request().query('SELECT 1')).rejects.toMatchObject({ code: 'ETIMEOUT' });
    await vi.advanceTimersByTimeAsync(90_000);
    await result;
    const count = acquire.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(acquire).toHaveBeenCalledTimes(count);
    expect(wake.isWaking()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps concurrent wake status until all waits settle', async () => {
    vi.useFakeTimers();
    const { pool, acquire, wake } = fixture();
    const slow = deferred<object>();
    acquire.mockRejectedValueOnce({ number: 40613 }).mockRejectedValueOnce({ number: 40501 })
      .mockResolvedValueOnce(transport()).mockImplementationOnce(() => slow.promise);
    const first = pool.request().query('SELECT 1');
    const second = pool.request().query('SELECT 2');
    await vi.advanceTimersByTimeAsync(1_000);
    await first;
    expect(wake.isWaking()).toBe(true);
    slow.resolve(transport());
    await second;
    expect(wake.isWaking()).toBe(false);
  });

  it('cancels a waiting real request immediately and releases a late connection without execution', async () => {
    vi.useFakeTimers();
    const { pool, acquire, release, wake } = fixture();
    const late = deferred<object>();
    acquire.mockRejectedValueOnce({ number: 40613 }).mockImplementationOnce(() => late.promise);
    const request = pool.request();
    const originalCancel = request.cancel;
    const result = expect(request.query('INSERT INTO dbo.projects (name) VALUES (N\'fixture\')')).rejects.toMatchObject({ code: 'ECANCEL' });
    await vi.advanceTimersByTimeAsync(1_000);
    request.cancel();
    await result;
    expect(request.cancel).toBe(originalCancel);
    expect(wake.isWaking()).toBe(false);
    const connection = transport();
    late.resolve(connection);
    await wake.settle();
    expect(release).toHaveBeenCalledExactlyOnceWith(connection);
    expect(connection.execSql).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shutdown cancels backoff and rejects new acquisitions without doing idle SQL', async () => {
    vi.useFakeTimers();
    const { pool, acquire, controller, wake } = fixture();
    acquire.mockRejectedValue({ number: 40613 });
    const result = expect(pool.request().query('SELECT 1')).rejects.toMatchObject({ code: 'ECANCEL' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await result;
    expect(wake.isWaking()).toBe(false);
    const next = expect(pool.request().query('SELECT 2')).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(0);
    await next;
    await vi.advanceTimersByTimeAsync(180_000);
    expect(acquire).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([40613, 40197, 40501])('never replays an executed write on error %i', async (number) => {
    const { pool, acquire, wake } = fixture();
    const connection = transport(Object.assign(new Error('fixture'), { info: { number } }));
    acquire.mockResolvedValue(connection);
    await expect(pool.request().query('INSERT INTO dbo.projects (name) VALUES (N\'fixture\')')).rejects.toMatchObject({ number });
    expect(acquire).toHaveBeenCalledOnce();
    expect(connection.execSql).toHaveBeenCalledOnce();
    expect(wake.isWaking()).toBe(false);
  });

  it('retries transaction acquisition but never replays an ambiguous BEGIN', async () => {
    vi.useFakeTimers();
    const { pool, acquire, wake } = fixture();
    const connection = transport(Object.assign(new Error('fixture'), { number: 40197 }));
    acquire.mockRejectedValueOnce({ number: 40613 }).mockResolvedValue(connection);
    const transaction = pool.transaction();
    const result = expect(transaction.begin()).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(2_000);
    await result;
    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(wake.isWaking()).toBe(false);
    const rollback = transaction.rollback();
    await vi.advanceTimersByTimeAsync(1);
    await rollback;
  });

  it('preserves promise acquisition as well as the real request callback overload', async () => {
    const { pool, acquire, controller, wake } = fixture();
    const connection = transport();
    acquire.mockResolvedValue(connection);
    const result = await (pool as unknown as { acquire(requester: object): Promise<object> }).acquire({});
    expect(result).toBe(connection);
    controller.abort();
    await wake.settle();
  });

  it.each([40613, 40197, 40501])('retries explicitly marked safe reads on execution-phase error %i', async (number) => {
    vi.useFakeTimers();
    const { pool, acquire, release, wake } = fixture();
    const failed = transport(Object.assign(new Error('fixture'), { info: { number } }));
    const succeeded = transport();
    acquire.mockResolvedValueOnce(failed).mockResolvedValueOnce(succeeded);
    const request = databaseReadRequest(pool).input('id', sql.BigInt, 1);
    const result = request.query('SELECT name FROM dbo.projects WHERE id = @id');
    await vi.advanceTimersByTimeAsync(0);
    expect(wake.isWaking()).toBe(true);
    await vi.advanceTimersByTimeAsync(1_001);
    await result;
    expect(failed.execSql).toHaveBeenCalledOnce();
    expect(succeeded.execSql).toHaveBeenCalledOnce();
    expect(request.parameters.id?.value).toBe(1);
    expect(release).toHaveBeenCalledTimes(2);
    expect(wake.isWaking()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not give a read retry and its reacquisition separate 90-second budgets', async () => {
    vi.useFakeTimers();
    const { pool, acquire, release, wake } = fixture();
    const failed = transport();
    failed.execSql.mockImplementation((request) => {
      setTimeout(() => { request.callback(Object.assign(new Error('fixture'), { info: { number: 40613 } })); }, 30_000);
    });
    const late = deferred<object>();
    acquire.mockResolvedValueOnce(failed).mockImplementationOnce(() => late.promise);
    const result = expect(databaseReadRequest(pool).query('SELECT 1')).rejects.toMatchObject({ code: 'ETIMEOUT' });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(wake.isWaking()).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    await result;
    expect(wake.isWaking()).toBe(false);
    const connection = transport();
    late.resolve(connection);
    await wake.settle();
    expect(connection.execSql).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a retried read executing when the 90-second wake budget expires', async () => {
    vi.useFakeTimers();
    const { pool, acquire, release, wake } = fixture();
    const first = transport(Object.assign(new Error('fixture'), { info: { number: 40501 } }));
    const second = transport();
    let pending: { callback(error?: Error): void } | undefined;
    second.execSql.mockImplementation((request) => { pending = request; });
    const cancel = vi.fn(() => { pending?.callback(new Error('fixture cancellation')); });
    Object.assign(second, { cancel });
    acquire.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const result = expect(databaseReadRequest(pool).query('SELECT 1')).rejects.toMatchObject({ code: 'ETIMEOUT' });
    await vi.advanceTimersByTimeAsync(90_000);
    await result;
    await wake.settle();
    expect(cancel).toHaveBeenCalledOnce();
    expect(second.execSql).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledTimes(2);
    expect(wake.isWaking()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves normal read query timeouts instead of capping successful execution at 90 seconds', async () => {
    vi.useFakeTimers();
    const { pool, acquire, wake } = fixture();
    const connection = transport();
    connection.execSql.mockImplementation((request) => {
      setTimeout(() => { request.callback(); }, 100_000);
    });
    acquire.mockResolvedValue(connection);
    const result = databaseReadRequest(pool).query('SELECT 1');
    await vi.advanceTimersByTimeAsync(100_000);
    await result;
    expect(wake.isWaking()).toBe(false);
    expect(connection.execSql).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not retry execution-phase query timeouts, even for a marked read', async () => {
    const { pool, acquire, wake } = fixture();
    const connection = transport(new sql.RequestError('fixture query timeout', 'ETIMEOUT'));
    acquire.mockResolvedValue(connection);
    await expect(databaseReadRequest(pool).query('SELECT 1')).rejects.toBeDefined();
    expect(connection.execSql).toHaveBeenCalledOnce();
    expect(acquire).toHaveBeenCalledOnce();
    expect(wake.isWaking()).toBe(false);
  });

  it('does not retry an executed transactional read', async () => {
    const { pool, acquire, wake } = fixture();
    const connection = transport();
    acquire.mockResolvedValue(connection);
    const transaction = pool.transaction();
    await transaction.begin();
    connection.execSql.mockImplementation((request) => {
      request.callback(Object.assign(new Error('fixture'), { info: { number: 40197 } }));
    });
    await expect(transaction.request().query('SELECT 1')).rejects.toMatchObject({ number: 40197 });
    expect(connection.execSql).toHaveBeenCalledOnce();
    expect(acquire).toHaveBeenCalledOnce();
    expect(wake.isWaking()).toBe(false);
    await transaction.rollback();
  });

  it('cancels a safe read during its execution-retry backoff before it can be replayed', async () => {
    vi.useFakeTimers();
    const { pool, acquire, wake } = fixture();
    const connection = transport(Object.assign(new Error('fixture'), { info: { number: 40613 } }));
    acquire.mockResolvedValue(connection);
    const request = databaseReadRequest(pool);
    const originalCancel = request.cancel;
    const result = expect(request.query('SELECT 1')).rejects.toMatchObject({ code: 'ECANCEL' });
    await vi.advanceTimersByTimeAsync(0);
    expect(wake.isWaking()).toBe(true);
    request.cancel();
    await result;
    await vi.advanceTimersByTimeAsync(90_000);
    expect(request.cancel).toBe(originalCancel);
    expect(connection.execSql).toHaveBeenCalledOnce();
    expect(wake.isWaking()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
