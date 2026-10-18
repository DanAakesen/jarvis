import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createProactiveTodoReceiptStore } from './proactive-todo-store.js';

const owner = '11111111-1111-4111-8111-111111111111';
const dedupeKey = '0123456789abcdef0123456789abcdef';

function poolFixture(responses: unknown[][]) {
  const queries: { sql: string; inputs: [string, unknown, unknown][] }[] = [];
  const request = {
    inputs: [] as [string, unknown, unknown][],
    input(name: string, type: unknown, value: unknown) {
      request.inputs.push([name, type, value]);
      return request;
    },
    async query(statement: string) {
      queries.push({ sql: statement, inputs: [...request.inputs] });
      request.inputs = [];
      return { recordset: responses.shift() ?? [] };
    },
  };
  return {
    pool: { request: vi.fn(() => request) } as unknown as sql.ConnectionPool,
    queries,
  };
}

describe('proactive todo receipt store', () => {
  it('summarizes receipt states and counts only added receipts through database read requests', async () => {
    const fixture = poolFixture([
      [
        { dedupe_key: dedupeKey, status: 'failed', attempt_count: 2 },
        { dedupe_key: '1123456789abcdef0123456789abcdef', status: 'skipped', attempt_count: 1 },
      ],
      [{ count: 5 }],
    ]);
    const store = createProactiveTodoReceiptStore(fixture.pool, owner.toUpperCase());
    await expect(store.list([dedupeKey])).resolves.toEqual([
      { dedupeKey, added: false, skipped: false, failedAttempts: 2 },
      { dedupeKey: '1123456789abcdef0123456789abcdef', added: false, skipped: true, failedAttempts: 0 },
    ]);
    await expect(store.countAdded('2026-10-18')).resolves.toBe(5);
    expect(fixture.queries[0]?.inputs).toContainEqual(['owner', sql.UniqueIdentifier, owner]);
    expect(fixture.queries[0]?.sql).toContain('OPENJSON(@keys)');
    expect(fixture.queries[1]?.sql).toContain("status = N'added'");
  });

  it('parameterizes receipt writes and reports filtered-index races as not inserted', async () => {
    const fixture = poolFixture([[{ inserted: false }]]);
    const store = createProactiveTodoReceiptStore(fixture.pool, owner);
    await expect(store.insert({
      itemId: null,
      dedupeKey,
      dayKey: '2026-10-18',
      runId: owner,
      status: 'added',
      reason: null,
      commitSha: 'a'.repeat(40),
    })).resolves.toBe(false);
    expect(fixture.queries[0]?.sql).toContain('ERROR_NUMBER() IN (2601, 2627)');
    expect(fixture.queries[0]?.inputs).toContainEqual(['key', sql.Char(32), dedupeKey]);
    expect(fixture.queries[0]?.inputs).toContainEqual(['commitSha', sql.Char(40), 'a'.repeat(40)]);
    expect(fixture.queries[0]?.sql).not.toContain(dedupeKey);
  });
});
