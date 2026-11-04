import sql from 'mssql';
import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolFailure } from '../../core/tool-registry.js';
import { TrainingTargetsStore } from './targets-store.js';

afterEach(() => { vi.restoreAllMocks(); });

const owner = 'abcdef01-2345-4678-89ab-cdef01234567';
const other = '99999999-9999-4999-8999-999999999999';
const savedAt = new Date('2026-10-17T10:00:00.000Z');
const ownerRequest = (objectId = owner) => ({ principal: { objectId }, server: { ownerObjectId: owner } }) as unknown as FastifyRequest;
const signal = () => new AbortController().signal;

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
  return { request, pool, transaction, store: TrainingTargetsStore.forRequest(pool, ownerRequest()) };
}

describe('TrainingTargetsStore.forRequest', () => {
  it('resolves the owner for signed-in users and the hosted agent', () => {
    const { pool } = fixture();
    expect(TrainingTargetsStore.forRequest(pool, ownerRequest())).toBeInstanceOf(TrainingTargetsStore);
    expect(TrainingTargetsStore.forRequest(pool, {
      agentPrincipal: { kind: 'jarvis-agent', objectId: other }, server: { ownerObjectId: owner },
    } as unknown as FastifyRequest)).toBeInstanceOf(TrainingTargetsStore);
  });

  it('refuses a different or missing owner before SQL access', () => {
    const { pool } = fixture();
    expect(() => TrainingTargetsStore.forRequest(pool, ownerRequest(other))).toThrow();
    expect(() => TrainingTargetsStore.forRequest(pool, { server: { ownerObjectId: owner } } as unknown as FastifyRequest)).toThrow();
    expect(pool.request).not.toHaveBeenCalled();
  });
});

describe('TrainingTargetsStore.read', () => {
  it('reads only the bound owner row and decodes its stored targets', async () => {
    const { request, store } = fixture();
    request.query.mockResolvedValueOnce({
      recordset: [{ gym_sessions_per_week: 3, run_sessions_per_week: null, daily_steps: 8_000, updated_at: savedAt }],
    });
    expect(await store.read(signal())).toEqual({
      targets: { gymSessionsPerWeek: 3, runSessionsPerWeek: null, dailySteps: 8_000 },
      updatedAt: savedAt.toISOString(),
    });
    expect(request.input).toHaveBeenCalledWith('owner', sql.UniqueIdentifier, owner);
    expect(String(request.query.mock.calls[0]?.[0])).toContain('FROM daily.training_targets');
    expect(String(request.query.mock.calls[0]?.[0])).toContain('owner_object_id = @owner');
  });

  it('returns all null targets and no timestamp when there is no row', async () => {
    const { store } = fixture();
    expect(await store.read(signal())).toEqual({
      targets: { gymSessionsPerWeek: null, runSessionsPerWeek: null, dailySteps: null }, updatedAt: null,
    });
  });

  it('hides database errors and propagates caller cancellation', async () => {
    const { request, store } = fixture();
    request.query.mockRejectedValueOnce(new Error('private sql detail'));
    await expect(store.read(signal())).rejects.toEqual(new ToolFailure('Training targets are unavailable.'));
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(store.read(controller.signal)).rejects.toThrow('cancelled');
  });
});

describe('TrainingTargetsStore.write', () => {
  it('locks, partially updates, reads back before commit and retains untouched values', async () => {
    const { request, transaction, store } = fixture();
    request.query
      .mockResolvedValueOnce({ recordset: [{ gym_sessions_per_week: 3, run_sessions_per_week: 2, daily_steps: 8_000, updated_at: savedAt }] })
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [1] })
      .mockResolvedValueOnce({ recordset: [{ gym_sessions_per_week: 4, run_sessions_per_week: 2, daily_steps: 8_000, updated_at: savedAt }] });
    expect(await store.write({ gymSessionsPerWeek: 4 }, signal())).toEqual({
      targets: { gymSessionsPerWeek: 4, runSessionsPerWeek: 2, dailySteps: 8_000 }, updatedAt: savedAt.toISOString(),
    });
    expect(String(request.query.mock.calls[0]?.[0])).toContain('UPDLOCK, HOLDLOCK');
    expect(String(request.query.mock.calls[1]?.[0])).toContain('UPDATE daily.training_targets');
    expect(request.input).toHaveBeenCalledWith('gym', sql.Int, 4);
    expect(request.input).toHaveBeenCalledWith('run', sql.Int, 2);
    expect(transaction.begin).toHaveBeenCalledOnce();
    expect(transaction.commit).toHaveBeenCalledOnce();
    expect(request.query.mock.invocationCallOrder[2]!).toBeLessThan(transaction.commit.mock.invocationCallOrder[0]!);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('creates a first row, then deletes it when the final target is cleared', async () => {
    const { request, store } = fixture();
    request.query
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [1] })
      .mockResolvedValueOnce({ recordset: [{ gym_sessions_per_week: 3, run_sessions_per_week: null, daily_steps: null, updated_at: savedAt }] })
      .mockResolvedValueOnce({ recordset: [{ gym_sessions_per_week: 3, run_sessions_per_week: null, daily_steps: null, updated_at: savedAt }] })
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [1] })
      .mockResolvedValueOnce({ recordset: [] });
    await store.write({ gymSessionsPerWeek: 3 }, signal());
    expect(String(request.query.mock.calls[1]?.[0])).toContain('INSERT INTO daily.training_targets');
    expect(await store.write({ gymSessionsPerWeek: null }, signal())).toEqual({
      targets: { gymSessionsPerWeek: null, runSessionsPerWeek: null, dailySteps: null }, updatedAt: null,
    });
    expect(String(request.query.mock.calls[4]?.[0])).toContain('DELETE FROM daily.training_targets');
  });

  it('rolls back failures and rejects invalid patches before opening a transaction', async () => {
    const { request, transaction, store } = fixture();
    await expect(store.write({ dailySteps: 100_001 }, signal())).rejects.toThrow(TypeError);
    expect(transaction.begin).not.toHaveBeenCalled();
    request.query.mockRejectedValueOnce(new Error('private sql detail'));
    await expect(store.write({ dailySteps: 8_000 }, signal())).rejects.toThrow('Training targets could not be saved.');
    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
  });
});
