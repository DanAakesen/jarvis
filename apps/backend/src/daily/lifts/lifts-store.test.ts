import sql from 'mssql';
import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolFailure } from '../../core/tool-registry.js';
import { createDailyChanges } from '../revisions.js';
import { LiftEntriesStore } from './lifts-store.js';
import type { LiftCreate } from './lifts.js';

afterEach(() => { vi.restoreAllMocks(); });

const owner = 'abcdef01-2345-4678-89ab-cdef01234567';
const id = '33333333-3333-4333-8333-333333333333';
const key = '44444444-4444-4444-8444-444444444444';
const other = '99999999-9999-4999-8999-999999999999';
const performedAt = new Date('2026-10-30T12:00:00.000Z');
const updatedAt = new Date('2026-10-30T12:00:00.000Z');
const input: LiftCreate = {
  idempotencyKey: key, exerciseName: 'Bench press', exerciseKey: 'bench press',
  weightKg: 80, reps: 4, sets: 3, performedAt: performedAt.toISOString(),
};
const ownerRequest = (objectId = owner) => ({ principal: { objectId }, server: { ownerObjectId: owner } }) as unknown as FastifyRequest;
const signal = () => new AbortController().signal;
const stored = () => ({
  id, exercise_name: 'Bench press', exercise_key: 'bench press', weight_kg: 80,
  reps: 4, sets: 3, performed_at: performedAt, deleted_at: null, updated_at: updatedAt, revision: 1,
});

function fixture() {
  const request = {
    input: vi.fn().mockReturnThis(),
    query: vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [1] }),
    cancel: vi.fn(),
  };
  const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
  const transaction = {
    begin: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    request: vi.fn(() => request),
  };
  vi.spyOn(sql, 'Transaction').mockImplementation(function () { return transaction as unknown as sql.Transaction; });
  const changes = createDailyChanges();
  const publish = vi.spyOn(changes, 'publish');
  return {
    request, pool, transaction, changes, publish,
    store: LiftEntriesStore.forRequest(pool, ownerRequest(), changes),
  };
}

describe('LiftEntriesStore.forRequest', () => {
  it('binds only the signed-in owner', () => {
    const f = fixture();
    expect(LiftEntriesStore.forRequest(f.pool, ownerRequest(), f.changes)).toBeInstanceOf(LiftEntriesStore);
    expect(() => LiftEntriesStore.forRequest(f.pool, ownerRequest(other), f.changes)).toThrow();
    expect(() => LiftEntriesStore.forRequest(f.pool, {
      agentPrincipal: { kind: 'jarvis-agent', objectId: other }, server: { ownerObjectId: owner },
    } as unknown as FastifyRequest, f.changes)).toThrow();
  });
});

describe('LiftEntriesStore.history', () => {
  it('pages only active rows for the owner and groups to the latest lift by exercise', async () => {
    const f = fixture();
    f.request.query.mockResolvedValueOnce({ recordset: [stored()] });
    const page = await f.store.history({ limit: 10, lastPerExercise: true }, signal());
    expect(page.items[0]).toMatchObject({ exerciseName: 'Bench press', weightKg: 80, reps: 4, sets: 3 });
    expect(page.next).toBeNull();
    expect(String(f.request.query.mock.calls[0]?.[0])).toContain('ROW_NUMBER() OVER (PARTITION BY exercise_key');
    expect(String(f.request.query.mock.calls[0]?.[0])).toContain('deleted_at IS NULL');
    expect(f.request.input).toHaveBeenCalledWith('owner', sql.UniqueIdentifier, owner);
    expect(f.request.input).toHaveBeenCalledWith('take', sql.Int, 11);
  });

  it('returns a cursor for the last included row when a page overflows', async () => {
    const f = fixture();
    f.request.query.mockResolvedValueOnce({ recordset: [stored(), { ...stored(), id: other }] });
    const page = await f.store.history({ limit: 1 }, signal());
    expect(page.items).toHaveLength(1);
    expect(page.next).toEqual({ performedAt: performedAt.toISOString(), id });
  });

  it('sanitizes SQL errors and propagates cancellation', async () => {
    const f = fixture();
    f.request.query.mockRejectedValueOnce(new Error('private sql detail'));
    await expect(f.store.history({ limit: 10 }, signal())).rejects.toEqual(new ToolFailure('Lift history is unavailable.'));
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(f.store.history({ limit: 10 }, controller.signal)).rejects.toThrow('cancelled');
  });
});

describe('LiftEntriesStore.create', () => {
  it('inserts once, commits, then publishes invalidation after commit', async () => {
    const f = fixture();
    f.request.query.mockResolvedValueOnce({ recordset: [] }).mockResolvedValueOnce({ recordset: [stored()] });
    const result = await f.store.create(input, signal());
    expect(result).toMatchObject({ entry: { id, revision: 1 }, replayed: false });
    expect(String(f.request.query.mock.calls[0]?.[0])).toContain('UPDLOCK, HOLDLOCK');
    expect(String(f.request.query.mock.calls[1]?.[0])).toContain('INSERT INTO daily.lift_entries');
    expect(f.transaction.commit).toHaveBeenCalledOnce();
    expect(f.transaction.rollback).not.toHaveBeenCalled();
    expect(f.publish).toHaveBeenCalledOnce();
    expect(f.publish.mock.invocationCallOrder[0]).toBeGreaterThan(f.transaction.commit.mock.invocationCallOrder[0]!);
  });

  it('returns the original row on an idempotent retry without inserting again', async () => {
    const f = fixture();
    f.request.query.mockResolvedValueOnce({ recordset: [stored()] });
    await expect(f.store.create(input, signal())).resolves.toMatchObject({ entry: { id }, replayed: true });
    expect(f.request.query).toHaveBeenCalledOnce();
    expect(f.transaction.commit).toHaveBeenCalledOnce();
    expect(f.publish).not.toHaveBeenCalled();
  });

  it('rolls back and sanitizes persistence failures', async () => {
    const f = fixture();
    f.request.query.mockRejectedValueOnce(new Error('private sql detail'));
    await expect(f.store.create(input, signal())).rejects.toThrow('Lift could not be saved.');
    expect(f.transaction.rollback).toHaveBeenCalledOnce();
    expect(f.transaction.commit).not.toHaveBeenCalled();
  });
});

describe('LiftEntriesStore.update and delete', () => {
  it('updates validated columns and increments revision', async () => {
    const f = fixture();
    f.request.query.mockResolvedValueOnce({ recordset: [{ ...stored(), weight_kg: 82.5, revision: 2 }] });
    const result = await f.store.update(id, { weightKg: 82.5 }, signal());
    expect(result).toMatchObject({ id, weightKg: 82.5, revision: 2 });
    expect(String(f.request.query.mock.calls[0]?.[0])).toContain('weight_kg = @weight');
    expect(String(f.request.query.mock.calls[0]?.[0])).toContain('revision = revision + 1');
  });

  it('soft-deletes and returns null for missing or already-deleted entries', async () => {
    const f = fixture();
    f.request.query.mockResolvedValueOnce({ recordset: [{ ...stored(), deleted_at: updatedAt, revision: 2 }] });
    const removed = await f.store.delete(id, signal());
    expect(removed).toMatchObject({ id, revision: 2, deletedAt: updatedAt.toISOString() });
    expect(String(f.request.query.mock.calls[0]?.[0])).toContain('SET deleted_at = SYSUTCDATETIME()');
    f.request.query.mockResolvedValueOnce({ recordset: [] });
    await expect(f.store.delete(id, signal())).resolves.toBeNull();
  });
});
