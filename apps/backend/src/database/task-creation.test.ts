import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createEventHub } from '../core/event-hub.js';
import { createTaskStore } from './task-store.js';

vi.mock('mssql', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof sql }>();
  class FakeTransaction {
    constructor(readonly parent: {
      query: (text: string, inputs: Map<string, unknown>) => Promise<unknown>;
      events: string[];
    }) {}
    async begin() { this.parent.events.push('begin'); }
    async commit() { this.parent.events.push('commit'); }
    async rollback() { this.parent.events.push('rollback'); }
  }
  class FakeRequest {
    private readonly inputs = new Map<string, unknown>();
    constructor(private readonly transaction: FakeTransaction) {}
    input(name: string, _type: unknown, value: unknown) { this.inputs.set(name, value); return this; }
    query(text: string) { return this.transaction.parent.query(text, this.inputs); }
  }
  return { ...actual, default: { ...actual.default, Transaction: FakeTransaction, Request: FakeRequest } };
});

const submissionId = '00000000-0000-4000-8000-000000000001';
const fingerprint = 'a'.repeat(64);

describe('durable Factory task submissions', () => {
  it('commits the exclusive claim before any external creation can begin', async () => {
    const events: string[] = [];
    const query = vi.fn().mockResolvedValue({ recordset: [] });
    const store = createTaskStore({ query, events } as unknown as sql.ConnectionPool, createEventHub());
    expect(await store.claimCreation!(submissionId, fingerprint)).toEqual({ kind: 'claimed' });
    expect(query.mock.calls[0]?.[0]).toContain('WITH (UPDLOCK, HOLDLOCK)');
    expect(query.mock.calls[1]?.[0]).toContain('INSERT INTO dbo.factory_task_submissions');
    expect(query.mock.calls[1]?.[1]).toEqual(new Map([['submissionId', submissionId], ['fingerprint', fingerprint]]));
    expect(events).toEqual(['begin', 'commit']);
  });

  it.each([null, 201, 502])('reads existing result %s from SQL even with a new store instance', async (statusCode) => {
    const response = statusCode === null ? null : { issueNumber: 8 };
    const query = vi.fn().mockResolvedValue({
      recordset: [{ fingerprint, statusCode, response: JSON.stringify(response) }],
    });
    const pool = { query, events: [] } as unknown as sql.ConnectionPool;
    await createTaskStore(pool, createEventHub()).claimCreation!(submissionId, fingerprint);
    const result = await createTaskStore(pool, createEventHub()).claimCreation!(submissionId, fingerprint);
    expect(result).toEqual({ kind: 'existing', fingerprint, statusCode, response });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.every(([text]) => !text.includes('INSERT'))).toBe(true);
  });

  it('rolls back a failed claim without pretending to own it', async () => {
    const events: string[] = [];
    const query = vi.fn().mockRejectedValue(new Error('database unavailable'));
    const store = createTaskStore({ query, events } as unknown as sql.ConnectionPool, createEventHub());
    await expect(store.claimCreation!(submissionId, fingerprint)).rejects.toThrow('Task submission storage unavailable');
    expect(events).toEqual(['begin', 'rollback']);
  });

  it('persists the bounded response with parameterized values and does not overwrite completed results', async () => {
    const query = vi.fn(async () => ({ rowsAffected: [1] }));
    const input = vi.fn().mockReturnThis();
    const store = createTaskStore({
      request: () => ({ input, query }),
    } as unknown as sql.ConnectionPool, createEventHub());
    await store.completeCreation!(submissionId, 201, { issueNumber: 8 });
    expect(input).toHaveBeenCalledWith('submissionId', sql.UniqueIdentifier, submissionId);
    expect(input).toHaveBeenCalledWith('response', sql.NVarChar(sql.MAX), '{"issueNumber":8}');
    expect(query.mock.calls[0]?.[0]).toContain('AND status_code IS NULL');
  });
});
