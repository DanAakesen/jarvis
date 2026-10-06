import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createPcBridgeStatusStore } from './pc-bridge-status-store.js';

const transactionEvents = vi.hoisted(() => ({ values: [] as string[] }));

vi.mock('mssql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mssql')>();
  class FakeTransaction {
    constructor(readonly parent: unknown) {}
    async begin(isolationLevel: number) { transactionEvents.values.push(`begin:${isolationLevel}`); }
    async commit() { transactionEvents.values.push('commit'); }
    async rollback() { transactionEvents.values.push('rollback'); }
  }
  class FakeRequest {
    private readonly parameters: unknown[] = [];
    constructor(private readonly transaction: FakeTransaction) {}
    input(...values: unknown[]) {
      this.parameters.push(values);
      return this;
    }
    query(query: string) {
      const pool = this.transaction.parent as { query: (sql: string, parameters: unknown[]) => Promise<unknown> };
      return pool.query(query, this.parameters);
    }
  }
  return {
    ...actual,
    default: { ...actual.default, Transaction: FakeTransaction, Request: FakeRequest },
  };
});

describe('PC bridge status store', () => {
  it('reports whether Jarvis control is active or paused in the existing activity row', async () => {
    transactionEvents.values.length = 0;
    const query = vi.fn().mockResolvedValue({ rowsAffected: [1] });
    const store = createPcBridgeStatusStore({ query } as unknown as sql.ConnectionPool, vi.fn());

    await store.setStatus(true, true);

    expect(JSON.stringify(query.mock.calls[0]?.[1])).toContain('Local PC bridge is online — Jarvis control is paused');
  });

  it('serializes status writes and publishes only after each commit', async () => {
    transactionEvents.values.length = 0;
    const query = vi.fn().mockResolvedValue({ rowsAffected: [1] });
    const onChanged = vi.fn();
    const store = createPcBridgeStatusStore({ query } as unknown as sql.ConnectionPool, onChanged);

    await Promise.all([store.setStatus(true), store.setStatus(false)]);

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain("VALUES (N'operations', N'pc_bridge_status'");
    expect(query.mock.calls[1]?.[0]).toContain("WHERE alert_key = N'pc_bridge_status'");
    expect(transactionEvents.values).toEqual([
      `begin:${sql.ISOLATION_LEVEL.SERIALIZABLE}`, 'commit',
      `begin:${sql.ISOLATION_LEVEL.SERIALIZABLE}`, 'commit',
    ]);
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it('continues with the next status after a failed write', async () => {
    transactionEvents.values.length = 0;
    const query = vi.fn()
      .mockRejectedValueOnce(new Error('fixture failure'))
      .mockResolvedValueOnce({ rowsAffected: [1] });
    const onChanged = vi.fn();
    const store = createPcBridgeStatusStore({ query } as unknown as sql.ConnectionPool, onChanged);

    const failed = store.setStatus(true);
    const recovered = store.setStatus(false);
    await expect(failed).rejects.toThrow('fixture failure');
    await expect(recovered).resolves.toBeUndefined();

    expect(transactionEvents.values).toEqual([
      `begin:${sql.ISOLATION_LEVEL.SERIALIZABLE}`, 'rollback',
      `begin:${sql.ISOLATION_LEVEL.SERIALIZABLE}`, 'commit',
    ]);
    expect(onChanged).toHaveBeenCalledOnce();
  });
});
