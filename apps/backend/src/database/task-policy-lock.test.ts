import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { withTaskPolicyLock } from './task-policy-lock.js';

const state = vi.hoisted(() => ({ events: [] as string[], query: '', inputs: [] as unknown[][] }));

vi.mock('mssql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mssql')>();
  class FakeTransaction {
    constructor(readonly parent: unknown) {}
    async begin() { state.events.push('begin'); }
    async commit() { state.events.push('commit'); }
    async rollback() { state.events.push('rollback'); }
  }
  class FakeRequest {
    constructor(private readonly _transaction: FakeTransaction) {}
    input(...values: unknown[]) {
      state.inputs.push(values);
      return this;
    }
    async query(query: string) {
      state.query = query;
      state.events.push('lock');
      return { recordset: [{ result: 0 }] };
    }
  }
  return {
    ...actual,
    default: { ...actual.default, Transaction: FakeTransaction, Request: FakeRequest },
  };
});

describe('project policy task lock', () => {
  it('holds a transaction-owned task lock for the operation', async () => {
    state.events.length = 0;
    state.inputs.length = 0;
    const operation = vi.fn(async () => {
      state.events.push('operation');
      return 'merged';
    });

    await expect(withTaskPolicyLock({} as sql.ConnectionPool, '42', operation)).resolves.toBe('merged');

    expect(state.query).toContain('sys.sp_getapplock');
    expect(state.query).toContain("@LockOwner = N'Transaction'");
    expect(state.inputs).toContainEqual(['resource', sql.NVarChar(255), 'jarvis.project-policy:42']);
    expect(state.events).toEqual(['begin', 'lock', 'operation', 'commit']);
  });

  it('releases the task lock when the operation fails', async () => {
    state.events.length = 0;
    const error = new Error('merge request failed');

    await expect(withTaskPolicyLock({} as sql.ConnectionPool, '42', async () => {
      throw error;
    })).rejects.toBe(error);

    expect(state.events).toEqual(['begin', 'lock', 'rollback']);
  });
});
