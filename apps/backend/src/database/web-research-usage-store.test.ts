import { afterEach, describe, expect, it, vi } from 'vitest';
import sql from 'mssql';
import { createWebResearchUsageStore } from './web-research-usage-store.js';

afterEach(() => vi.restoreAllMocks());

describe('web research usage store', () => {
  it('serializes monthly reservations and commits the count before returning', async () => {
    const query = vi.fn(async () => ({ recordset: [{ outcome: 'reserved' }] }));
    const request = {
      input: vi.fn().mockReturnThis(),
      query,
    };
    const transaction = {
      begin: vi.fn(async () => {}),
      request: vi.fn(() => request),
      commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => {}),
    };
    vi.spyOn(sql, 'Transaction').mockImplementation(function FakeTransaction() {
      return transaction as never;
    });
    const store = createWebResearchUsageStore({} as sql.ConnectionPool);

    await expect(store.reserveMonthlyTransaction({
      at: new Date('2026-10-05T07:00:00Z'),
      monthlyCap: 350,
    })).resolves.toBe('reserved');

    expect(transaction.begin).toHaveBeenCalledWith(sql.ISOLATION_LEVEL.SERIALIZABLE);
    expect(request.input).toHaveBeenCalledWith('monthStart', sql.Date, new Date('2026-10-01T00:00:00.000Z'));
    expect(request.input).toHaveBeenCalledWith('monthlyCap', sql.Int, 350);
    expect(query.mock.calls[0]?.[0]).toContain("@LockOwner = 'Transaction'");
    expect(query.mock.calls[0]?.[0]).toContain('transaction_count < @monthlyCap');
    expect(transaction.commit).toHaveBeenCalledOnce();
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('rolls back and hides SQL diagnostics when reservation fails', async () => {
    const transaction = {
      begin: vi.fn(async () => {}),
      request: vi.fn(() => ({
        input: vi.fn().mockReturnThis(),
        query: vi.fn(async () => { throw new Error('database details'); }),
      })),
      commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => {}),
    };
    vi.spyOn(sql, 'Transaction').mockImplementation(function FakeTransaction() {
      return transaction as never;
    });
    const store = createWebResearchUsageStore({} as sql.ConnectionPool);

    await expect(store.reserveMonthlyTransaction({
      at: new Date('2026-10-05T07:00:00Z'),
      monthlyCap: 350,
    })).rejects.toThrow('Web research usage could not be reserved');

    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
  });
});
