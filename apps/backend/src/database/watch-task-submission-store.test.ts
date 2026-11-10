import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createWatchTaskSubmissionStore } from './watch-task-submission-store.js';
import { readDownMigration, readMigrations } from './migrations.js';
import type { WatchTaskReceipt } from '../vault/watch-task-capture.js';
import type { TaskWriteResult } from '../vault/task-writes.js';

const owner = '11111111-2222-4333-8444-555555555555';
const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const receipt: WatchTaskReceipt = {
  requestHash: 'a'.repeat(64), result: null,
  resolved: {
    text: 'Review launch', scope: 'personal', due: '2026-11-10', time: '14:15',
    dueAt: '2026-11-10T13:15:27.000Z', timeZone: 'Europe/Copenhagen', priority: 'normal', notes: 'Keep notes',
  },
};
function fixture(recordset: unknown[] = [], rowsAffected = [1]) {
  const query = vi.fn(async (text: string) => { expect(text).not.toBe(''); return { recordset, rowsAffected }; });
  const request = { input: vi.fn(), query, cancel: vi.fn() };
  request.input.mockReturnValue(request);
  const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
  return { store: createWatchTaskSubmissionStore(pool), query, request };
}
const row = { request_hash: receipt.requestHash, resolved_json: JSON.stringify(receipt.resolved), result_json: null };
const signal = () => AbortSignal.timeout(30_000);

describe('durable Watch submission SQL boundary', () => {
  it('uses parameterized, owner-scoped reads and restores frozen resolution after a process restart', async () => {
    const state = fixture([row]);
    expect(await state.store.get(owner, id, signal())).toEqual(receipt);
    expect(state.request.input).toHaveBeenCalledWith('owner', sql.UniqueIdentifier, owner);
    expect(state.request.input).toHaveBeenCalledWith('submission', sql.UniqueIdentifier, id);
    expect(state.query.mock.calls[0]![0]).toContain('owner_object_id=@owner AND submission_id=@submission');
    expect(await fixture().store.get(owner, id, signal())).toBeNull();
  });

  it('reserves one immutable resolution under a database key-range lock and returns the winner', async () => {
    const state = fixture([row]);
    const losing: WatchTaskReceipt = { ...receipt, requestHash: 'b'.repeat(64), resolved: { ...receipt.resolved, text: 'Different title' } };
    expect(await state.store.reserve(owner, id, losing, signal())).toEqual(receipt);
    expect(state.request.input).toHaveBeenCalledWith('hash', sql.Char(64), losing.requestHash);
    expect(state.request.input).toHaveBeenCalledWith('resolved', sql.NVarChar(sql.MAX), JSON.stringify(losing.resolved));
    const statement = state.query.mock.calls[0]![0];
    for (const fragment of ['BEGIN TRANSACTION', 'WITH (UPDLOCK, HOLDLOCK)', 'owner_object_id=@owner AND submission_id=@submission',
      'INSERT dbo.watch_task_submissions', 'COMMIT TRANSACTION', 'ROLLBACK TRANSACTION', 'THROW']) expect(statement).toContain(fragment);
    expect(statement).not.toContain('UPDATE');
  });

  it('records completion only for the exact owner/key/hash and never overwrites an earlier result', async () => {
    const state = fixture();
    const result = { id: 'b'.repeat(64), text: 'Review launch' } as TaskWriteResult;
    await state.store.complete(owner, id, receipt.requestHash, result, signal());
    const statement = state.query.mock.calls[0]![0];
    expect(statement).toContain('result_json=COALESCE(result_json, @result)');
    expect(statement).toContain('owner_object_id=@owner AND submission_id=@submission AND request_hash=@hash');
    expect(state.request.input).toHaveBeenCalledWith('result', sql.NVarChar(sql.MAX), JSON.stringify(result));
    await expect(fixture([], [0]).store.complete(owner, id, receipt.requestHash, result, signal())).rejects.toThrow('not saved');
  });

  it('propagates actual SQL failures, rejects corrupt frozen data, and respects cancellation', async () => {
    const state = fixture();
    state.query.mockRejectedValueOnce(new Error('SQL unavailable'));
    await expect(state.store.get(owner, id, signal())).rejects.toThrow('SQL unavailable');
    await expect(fixture([{ ...row, resolved_json: '{"text":null}' }]).store.get(owner, id, signal())).rejects.toThrow('Invalid persisted');
    const controller = new AbortController();
    controller.abort();
    await expect(state.store.reserve(owner, id, receipt, controller.signal)).rejects.toThrow();
    expect(state.query).toHaveBeenCalledOnce();
    state.query.mockImplementationOnce(async () => {
      controller2.abort();
      return { recordset: [], rowsAffected: [0] };
    });
    const controller2 = new AbortController();
    await state.store.get(owner, id, controller2.signal);
    expect(state.request.cancel).toHaveBeenCalledOnce();
  });

  it('ships durable UUID uniqueness and JSON bounds, and refuses to discard receipts during rollback', async () => {
    const migration = (await readMigrations()).find(item => item.name === '0078_watch_task_submissions.sql')!;
    expect(migration.sql).toContain('PRIMARY KEY (owner_object_id, submission_id)');
    expect(migration.sql).toContain('ISJSON(resolved_json)=1');
    expect(migration.sql).toContain('DATALENGTH(resolved_json)<=32768');
    const down = await readDownMigration(migration.name);
    expect(down.sql.indexOf('THROW')).toBeLessThan(down.sql.indexOf('DROP TABLE'));
  });
});
