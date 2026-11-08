import sql from 'mssql';
import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolFailure } from '../../core/tool-registry.js';
import { createHealthChanges } from '../revisions.js';
import { WorkoutEntriesStore } from './workouts-store.js';

afterEach(() => { vi.restoreAllMocks(); });

const owner = 'abcdef01-2345-4678-89ab-cdef01234567';
const id = '33333333-3333-4333-8333-333333333333';
const key = '44444444-4444-4444-8444-444444444444';
const startedAt = new Date('2026-11-02T23:30:00.000Z');
const signal = () => new AbortController().signal;
const ownerRequest = (objectId = owner) => ({ principal: { objectId }, server: { ownerObjectId: owner } }) as unknown as FastifyRequest;
const stored = () => ({
  id, session_type: 'cardio', title: null, started_at: startedAt, gym_day: '2026-11-03', duration_minutes: 30, note: null,
  deleted_at: null, updated_at: startedAt, revision: 1, vault_synced_revision: null,
});
const input = { idempotencyKey: key, sessionType: 'cardio' as const, title: null, startedAt: startedAt.toISOString(), durationMinutes: 30, note: null };

function fixture(syncState?: 'synced' | 'pending') {
  const request = { input: vi.fn().mockReturnThis(), query: vi.fn().mockResolvedValue({ recordset: [] }), cancel: vi.fn() };
  const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
  const transaction = { begin: vi.fn(async () => {}), commit: vi.fn(async () => {}), rollback: vi.fn(async () => {}), request: vi.fn(() => request) };
  vi.spyOn(sql, 'Transaction').mockImplementation(function () { return transaction as unknown as sql.Transaction; });
  const changes = createHealthChanges();
  const publish = vi.spyOn(changes, 'publish');
  const syncWorkout = vi.fn(async () => syncState ?? 'pending');
  return {
    request, transaction, publish, syncWorkout,
    store: WorkoutEntriesStore.forRequest(pool, ownerRequest(), changes, syncState ? { syncWorkout } : undefined),
    pool, changes,
  };
}

describe('WorkoutEntriesStore', () => {
  it('binds only the signed-in owner', () => {
    const f = fixture();
    expect(() => WorkoutEntriesStore.forRequest(f.pool, ownerRequest('99999999-9999-4999-8999-999999999999'), f.changes)).toThrow();
    expect(() => WorkoutEntriesStore.forOwner(f.pool, 'nope', f.changes)).toThrow();
  });

  it('inserts once with the Copenhagen day, then reports the vault copy truthfully', async () => {
    for (const state of ['synced', 'pending'] as const) {
      const f = fixture(state);
      f.request.query.mockResolvedValueOnce({ recordset: [] }).mockResolvedValueOnce({ recordset: [stored()] });
      const result = await f.store.create(input, signal());
      expect(result).toMatchObject({ replayed: false, entry: { id, vault: state } });
      expect(f.request.input).toHaveBeenCalledWith('gymDay', sql.Char(10), '2026-11-03');
      expect(f.publish.mock.invocationCallOrder[0]).toBeGreaterThan(f.transaction.commit.mock.invocationCallOrder[0]!);
    }
  });

  it('keeps the entry and reports pending when no vault writer exists; replay retries the copy', async () => {
    const f = fixture();
    f.request.query.mockResolvedValueOnce({ recordset: [stored()] });
    expect(await f.store.create(input, signal())).toMatchObject({ replayed: true, entry: { vault: 'pending' } });
    expect(f.publish).not.toHaveBeenCalled();
    const g = fixture('synced');
    g.request.query.mockResolvedValueOnce({ recordset: [stored()] });
    expect(await g.store.create(input, signal())).toMatchObject({ replayed: true, entry: { vault: 'synced' } });
    expect(g.syncWorkout).toHaveBeenCalledOnce();
  });

  it('rolls back and sanitizes persistence failures', async () => {
    const f = fixture();
    f.request.query.mockRejectedValueOnce(new Error('private sql detail'));
    await expect(f.store.create(input, signal())).rejects.toEqual(new ToolFailure('Workout could not be saved. Check history before retrying.'));
    expect(f.transaction.rollback).toHaveBeenCalledOnce();
  });

  it('lists only live owner rows inside the requested window', async () => {
    const f = fixture();
    f.request.query.mockResolvedValueOnce({ recordset: [stored()] });
    const page = await f.store.history({ limit: 10, days: 7 }, signal());
    expect(page.items[0]).toMatchObject({ id, sessionType: 'cardio', vault: 'pending' });
    expect(page.items[0]).not.toHaveProperty('gymDay');
    expect(String(f.request.query.mock.calls[0]?.[0])).toContain('deleted_at IS NULL');
    f.request.query.mockRejectedValueOnce(new Error('private'));
    await expect(f.store.history({ limit: 10 }, signal())).rejects.toEqual(new ToolFailure('Workout history is unavailable.'));
    await expect(f.store.history({ limit: 101 }, signal())).rejects.toThrow(TypeError);
  });

  it('updates validated columns, soft-deletes, and returns null for missing entries', async () => {
    const f = fixture('pending');
    f.request.query.mockResolvedValueOnce({ recordset: [{ ...stored(), revision: 2, duration_minutes: 45 }] });
    expect(await f.store.update(id, { durationMinutes: 45 }, signal())).toMatchObject({ revision: 2, vault: 'pending' });
    expect(String(f.request.query.mock.calls[0]?.[0])).toContain('duration_minutes = @duration');
    f.request.query.mockResolvedValueOnce({ recordset: [{ ...stored(), deleted_at: startedAt, revision: 3 }] });
    expect(await f.store.delete(id, signal())).toMatchObject({ deletedAt: startedAt.toISOString() });
    f.request.query.mockResolvedValueOnce({ recordset: [] });
    expect(await f.store.delete(id, signal())).toBeNull();
    await expect(f.store.update(id, {}, signal())).rejects.toThrow(TypeError);
  });

  it('clears the title when the type is no longer Other', async () => {
    const f = fixture();
    f.request.query.mockResolvedValueOnce({ recordset: [stored()] });
    await f.store.update(id, { sessionType: 'cardio' }, signal());
    expect(String(f.request.query.mock.calls[0]?.[0])).toContain('title = NULL');
  });
});


describe('WorkoutEntriesStore.forConversation', () => {
  it('binds the configured owner for hosted tools without opening browser-only routes or external connector access', () => {
    const changes = createHealthChanges();
    const pool = {} as sql.ConnectionPool;
    const hosted = { agentPrincipal: { kind: 'jarvis-agent', objectId: '99999999-9999-4999-8999-999999999999' },
      server: { ownerObjectId: owner } } as unknown as FastifyRequest;
    expect(WorkoutEntriesStore.forConversation(pool, hosted, changes)).toBeInstanceOf(WorkoutEntriesStore);
    expect(() => WorkoutEntriesStore.forRequest(pool, hosted, changes)).toThrow();
    expect(() => WorkoutEntriesStore.forConversation(pool, { ...hosted,
      healthConnectorPrincipal: { kind: 'jarvis-daily-connector', objectId: owner },
    } as unknown as FastifyRequest, changes)).toThrow();
    expect(() => WorkoutEntriesStore.forConversation(pool, { server: { ownerObjectId: owner },
      principal: { objectId: '99999999-9999-4999-8999-999999999999' },
    } as unknown as FastifyRequest, changes)).toThrow();
  });
});
