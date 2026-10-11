import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createBackgroundJobStore } from './background-job-store.js';

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
