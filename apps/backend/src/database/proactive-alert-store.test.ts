import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createProactiveAlertStore } from './proactive-alert-store.js';

const owner = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';
const saved = {
  id: '44444444-4444-4444-8444-444444444444',
  alert_key: '0123456789abcdef0123456789abcdef',
  class: 'deadline_24h',
  item_id: itemId,
  run_id: runId,
  day_key: '2026-10-20',
  status: 'failed',
  reason: 'provider_unavailable',
  attempts: 2,
};

function createRequest(query: (statement: string) => Promise<{ recordset: typeof saved[] }>) {
  return {
    input: vi.fn().mockReturnThis(),
    query: vi.fn(query),
  };
}

describe('SQL proactive alert ledger store', () => {
  it('retries a unique-index race with one owner/key update', async () => {
    const statements: string[] = [];
    let calls = 0;
    const request = createRequest(async (statement) => {
      statements.push(statement);
      calls++;
      if (calls === 1) throw Object.assign(new Error('duplicate key'), { number: 2627 });
      return { recordset: [saved] };
    });
    const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
    const store = createProactiveAlertStore(pool, owner);
    await expect(store.upsert({
      alertKey: saved.alert_key,
      class: 'deadline_24h',
      itemId,
      runId,
      dayKey: saved.day_key,
      status: 'failed',
      reason: 'provider_unavailable',
    })).resolves.toMatchObject({ attempts: 2, status: 'failed' });
    expect(calls).toBe(2);
    expect(statements[0]).toContain('MERGE dbo.proactive_alerts WITH (HOLDLOCK)');
    expect(statements[1]).toContain('UPDATE dbo.proactive_alerts');
    expect(statements[1]).toContain('updated_at = SYSUTCDATETIME()');
    expect(request.input).toHaveBeenCalledWith('owner', sql.UniqueIdentifier, owner);
    expect(request.input).toHaveBeenCalledWith('alertKey', sql.Char(32), saved.alert_key);
  });
});
