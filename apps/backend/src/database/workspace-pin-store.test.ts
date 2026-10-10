import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { WorkspacePinLimitExceeded, WorkspacePinStore } from './workspace-pin-store.js';

const transactions = vi.hoisted(() => ({ events: [] as string[] }));

vi.mock('mssql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mssql')>();
  class FakeTransaction {
    constructor(readonly parent: unknown) {}
    async begin(isolationLevel: number) { transactions.events.push(`begin:${isolationLevel}`); }
    async commit() { transactions.events.push('commit'); }
    async rollback() { transactions.events.push('rollback'); }
    request() {
      const pool = this.parent as { query: (text: string) => Promise<unknown> };
      return {
        input() { return this; },
        query(text: string) { return pool.query(text); },
        cancel: vi.fn(),
      };
    }
  }
  return { ...actual, default: { ...actual.default, Transaction: FakeTransaction } };
});

const ownerId = 'd5b41c2f-33f4-4b4f-9a52-09346e50c8dd';
const view = {
  version: 1 as const,
  title: 'Research',
  renderer: 'text' as const,
  source: { id: 'research' as const, status: 'complete' as const },
  data: { format: 'plain' as const, content: 'Findings' },
};
const pinnedAt = '2026-10-08T10:00:00.000Z';
const row = { view_id: 'research-report', view_json: JSON.stringify(view), pinned_at: new Date(pinnedAt) };

function fixture(result: unknown = { recordset: [row], rowsAffected: [1] }) {
  const statements: string[] = [];
  const query = vi.fn(async (text: string) => {
    statements.push(text);
    return result;
  });
  const makeRequest = () => ({
    input() { return this; },
    query(text: string) { return query(text); },
    cancel: vi.fn(),
  });
  const pool = { query, request: makeRequest } as unknown as sql.ConnectionPool;
  return { store: new WorkspacePinStore(pool), query, statements };
}

describe('workspace pin store', () => {
  it('lists owner-scoped pins oldest first and maps JSON and UTC timestamps', async () => {
    const data = fixture({ recordset: [row], rowsAffected: [] });
    await expect(data.store.list(ownerId, new AbortController().signal)).resolves.toEqual([
      { viewId: row.view_id, view, pinnedAt },
    ]);
    expect(data.statements[0]).toContain('ORDER BY pinned_at, view_id');
    expect(data.statements[0]).toContain('SELECT TOP (20)');
    expect(data.statements[0]).toContain('WHERE owner_object_id = @owner');
  });

  it('updates only view JSON when re-pinning and keeps the database timestamp', async () => {
    transactions.events.length = 0;
    const updatedView = { ...view, title: 'Updated research' };
    const data = fixture({
      recordset: [{ outcome: 'saved', ...row, view_json: JSON.stringify(updatedView) }],
      rowsAffected: [],
    });
    await expect(data.store.pin(ownerId, row.view_id, updatedView, new AbortController().signal))
      .resolves.toEqual({ viewId: row.view_id, view: updatedView, pinnedAt });
    const statement = data.statements[0] ?? '';
    expect(statement).toContain('UPDATE dbo.workspace_pins SET view_json = @view');
    expect(statement).not.toMatch(/SET view_json = @view[^;]*pinned_at/u);
    expect(statement).toContain('sys.sp_getapplock');
    expect(transactions.events).toEqual([`begin:${sql.ISOLATION_LEVEL.SERIALIZABLE}`, 'commit']);
  });

  it('rolls back when a new pin would exceed the limit', async () => {
    transactions.events.length = 0;
    const data = fixture({ recordset: [{ outcome: 'limit', view_id: null, view_json: null, pinned_at: null }], rowsAffected: [] });
    await expect(data.store.pin(ownerId, 'new-report', view, new AbortController().signal))
      .rejects.toBeInstanceOf(WorkspacePinLimitExceeded);
    expect(data.statements[0]).toContain('>= 20');
    expect(transactions.events).toEqual([`begin:${sql.ISOLATION_LEVEL.SERIALIZABLE}`, 'rollback']);
  });

  it('deletes by both owner and view ID', async () => {
    const data = fixture({ recordset: [], rowsAffected: [1] });
    await expect(data.store.unpin(ownerId, row.view_id, new AbortController().signal)).resolves.toBe(true);
    expect(data.statements[0]).toContain('DELETE dbo.workspace_pins');
    expect(data.statements[0]).toContain('owner_object_id = @owner AND view_id = @viewId');
  });
});
