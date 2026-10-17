import sql from 'mssql';
import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolFailure } from '../../core/tool-registry.js';
import { nutritionTargetKey, type NutritionTargetField } from './targets.js';
import { NutritionTargetsStore } from './targets-store.js';

afterEach(() => { vi.restoreAllMocks(); });

// Synthetic placeholders. They are not anyone's real figures.
const owner = 'abcdef01-2345-4678-89ab-cdef01234567';
const stranger = '99999999-9999-4999-8999-999999999999';
const at = new Date('2026-10-17T10:00:00.000Z');
const later = new Date('2026-10-17T11:30:00.000Z');
const key = (field: NutritionTargetField) => nutritionTargetKey(owner, field);
const signal = () => new AbortController().signal;
const ownerRequest = (objectId = owner) => ({ principal: { objectId }, server: { ownerObjectId: owner } }) as unknown as FastifyRequest;
const saveFailure = 'Nutrition targets could not be saved. Read them to check the current values before retrying.';

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
  return { request, pool, transaction, store: NutritionTargetsStore.forRequest(pool, ownerRequest()) };
}

/** A statement that stays pending until the store cancels it, like a real SQL request. */
function hangUntilCancelled(request: ReturnType<typeof fixture>['request']) {
  request.query.mockImplementationOnce(() => new Promise((_resolve, reject) => {
    request.cancel.mockImplementationOnce(() => { reject(new Error('Canceled.')); });
  }));
}

describe('NutritionTargetsStore.forRequest', () => {
  it('serves the signed-in owner and the hosted agent acting for the owner', () => {
    const { pool } = fixture();
    expect(NutritionTargetsStore.forRequest(pool, ownerRequest())).toBeInstanceOf(NutritionTargetsStore);
    const agent = { agentPrincipal: { kind: 'jarvis-agent', objectId: stranger }, server: { ownerObjectId: owner } } as unknown as FastifyRequest;
    expect(NutritionTargetsStore.forRequest(pool, agent)).toBeInstanceOf(NutritionTargetsStore);
  });

  it('refuses anyone who is not the owner', () => {
    const { pool } = fixture();
    expect(() => NutritionTargetsStore.forRequest(pool, ownerRequest(stranger))).toThrow();
    expect(() => NutritionTargetsStore.forRequest(pool, { server: { ownerObjectId: owner } } as unknown as FastifyRequest)).toThrow();
  });

  it('fails closed when the configured owner cannot be turned into a settings key', () => {
    const { pool } = fixture();
    const broken = { principal: { objectId: 'not-a-guid' }, server: { ownerObjectId: 'not-a-guid' } } as unknown as FastifyRequest;
    expect(() => NutritionTargetsStore.forRequest(pool, broken)).toThrow(TypeError);
  });
});

describe('NutritionTargetsStore.read', () => {
  it('binds the global scope and the three owner-namespaced keys and decodes the stored rows', async () => {
    const { request, store } = fixture();
    request.query.mockResolvedValueOnce({
      recordset: [
        { key: key('restingKcal'), value: '1750', updated_at: at },
        { key: key('proteinGrams'), value: '110', updated_at: later },
      ],
      rowsAffected: [],
    });
    expect(await store.read(signal())).toEqual({
      targets: { restingKcal: 1750, deficitKcal: null, proteinGrams: 110 },
      updatedAt: later.toISOString(),
    });
    expect(request.input).toHaveBeenCalledWith('scope', expect.anything(), 'global');
    expect(request.input).toHaveBeenCalledWith('key0', expect.anything(), key('restingKcal'));
    expect(request.input).toHaveBeenCalledWith('key1', expect.anything(), key('deficitKcal'));
    expect(request.input).toHaveBeenCalledWith('key2', expect.anything(), key('proteinGrams'));
    const statement = String(request.query.mock.calls[0]![0]);
    expect(statement).toContain('FROM dbo.settings');
    expect(statement).toContain('scope = @scope');
    expect(statement).toContain('[key] IN (@key0, @key1, @key2)');
  });

  it('reads an empty store as three unset targets with no timestamp', async () => {
    const { store } = fixture();
    expect(await store.read(signal())).toEqual({
      targets: { restingKcal: null, deficitKcal: null, proteinGrams: null },
      updatedAt: null,
    });
  });

  it('accepts a text timestamp from the driver', async () => {
    const { request, store } = fixture();
    request.query.mockResolvedValueOnce({ recordset: [{ key: key('deficitKcal'), value: '350', updated_at: at.toISOString() }], rowsAffected: [] });
    expect(await store.read(signal())).toMatchObject({ targets: { deficitKcal: 350 }, updatedAt: at.toISOString() });
  });

  it('reads a malformed, out-of-range or other-owner row as unset and never dates the store from it', async () => {
    const { request, store } = fixture();
    request.query.mockResolvedValueOnce({
      recordset: [
        { key: key('restingKcal'), value: 'garbage', updated_at: later },
        { key: key('deficitKcal'), value: '99999', updated_at: later },
        { key: nutritionTargetKey(stranger, 'proteinGrams'), value: '110', updated_at: later },
      ],
      rowsAffected: [],
    });
    expect(await store.read(signal())).toEqual({
      targets: { restingKcal: null, deficitKcal: null, proteinGrams: null },
      updatedAt: null,
    });
  });

  it('hides the database error behind a safe message', async () => {
    const { request, store } = fixture();
    request.query.mockRejectedValueOnce(new Error('Login failed for user secret-db-user'));
    const failure = await store.read(signal()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ToolFailure);
    expect((failure as Error).message).toBe('Nutrition targets are unavailable.');
  });

  it('cancels the statement and rethrows the caller reason when the caller goes away', async () => {
    const { request, store } = fixture();
    const controller = new AbortController();
    const reason = new Error('Caller went away');
    hangUntilCancelled(request);
    const pending = store.read(controller.signal);
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(request.cancel).toHaveBeenCalledOnce();
  });

  it('does not touch SQL when the signal is already aborted', async () => {
    const { pool, store } = fixture();
    const controller = new AbortController();
    controller.abort(new Error('Already gone'));
    await expect(store.read(controller.signal)).rejects.toThrow('Already gone');
    expect(pool.request).not.toHaveBeenCalled();
  });
});

describe('NutritionTargetsStore.write', () => {
  it('saves named targets and clears null ones in one transaction, reading the result back before commit', async () => {
    const { request, transaction, store } = fixture();
    request.query
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [1] })
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [1] })
      .mockResolvedValueOnce({ recordset: [{ key: key('restingKcal'), value: '1750', updated_at: at }], rowsAffected: [] });
    expect(await store.write({ restingKcal: 1750, proteinGrams: null }, signal())).toEqual({
      targets: { restingKcal: 1750, deficitKcal: null, proteinGrams: null },
      updatedAt: at.toISOString(),
    });
    const statements = request.query.mock.calls.map(([text]) => String(text));
    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain('MERGE dbo.settings WITH (HOLDLOCK)');
    expect(statements[1]).toContain('DELETE FROM dbo.settings');
    expect(statements[2]).toContain('SELECT [key], value, updated_at FROM dbo.settings');
    expect(request.input).toHaveBeenCalledWith('scope', expect.anything(), 'global');
    expect(request.input).toHaveBeenCalledWith('key', expect.anything(), key('restingKcal'));
    expect(request.input).toHaveBeenCalledWith('value', expect.anything(), '1750');
    expect(request.input).toHaveBeenCalledWith('key', expect.anything(), key('proteinGrams'));
    expect(request.input).not.toHaveBeenCalledWith('key', expect.anything(), key('deficitKcal'));
    expect(request.input).not.toHaveBeenCalledWith('value', expect.anything(), 'null');
    expect(transaction.begin).toHaveBeenCalledOnce();
    expect(transaction.commit).toHaveBeenCalledOnce();
    expect(transaction.rollback).not.toHaveBeenCalled();
    expect(request.query.mock.invocationCallOrder[2]!).toBeLessThan(transaction.commit.mock.invocationCallOrder[0]!);
  });

  it('stores each value as a bare JSON number', async () => {
    const { request, store } = fixture();
    await store.write({ restingKcal: 1750, deficitKcal: 350, proteinGrams: 110 }, signal());
    for (const value of ['1750', '350', '110']) {
      expect(request.input).toHaveBeenCalledWith('value', expect.anything(), value);
    }
  });

  it('rolls back and hides the database error when a statement fails', async () => {
    const { request, transaction, store } = fixture();
    request.query.mockRejectedValueOnce(new Error('Violation of PRIMARY KEY secret-detail'));
    const failure = await store.write({ restingKcal: 1750 }, signal()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ToolFailure);
    expect((failure as Error).message).toBe(saveFailure);
    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it('does not commit when the read-back fails', async () => {
    const { request, transaction, store } = fixture();
    request.query
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [1] })
      .mockRejectedValueOnce(new Error('read-back failed'));
    await expect(store.write({ restingKcal: 1750 }, signal())).rejects.toThrow(saveFailure);
    expect(transaction.commit).not.toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalledOnce();
  });

  it('reports a failed commit with the safe message', async () => {
    const { transaction, store } = fixture();
    transaction.commit.mockRejectedValueOnce(new Error('commit failed'));
    await expect(store.write({ restingKcal: 1750 }, signal())).rejects.toThrow(saveFailure);
    expect(transaction.rollback).toHaveBeenCalledOnce();
  });

  it('keeps the safe message when the rollback itself fails', async () => {
    const { request, transaction, store } = fixture();
    request.query.mockRejectedValueOnce(new Error('statement failed'));
    transaction.rollback.mockRejectedValueOnce(new Error('rollback failed'));
    await expect(store.write({ restingKcal: 1750 }, signal())).rejects.toThrow(saveFailure);
  });

  it('cancels the statement, rolls back and rethrows the caller reason when the caller goes away', async () => {
    const { request, transaction, store } = fixture();
    const controller = new AbortController();
    const reason = new Error('Caller went away');
    hangUntilCancelled(request);
    const pending = store.write({ restingKcal: 1750 }, controller.signal);
    await vi.waitFor(() => { expect(request.query).toHaveBeenCalled(); });
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it('does not open a transaction when the signal is already aborted', async () => {
    const { transaction, store } = fixture();
    const controller = new AbortController();
    controller.abort(new Error('Already gone'));
    await expect(store.write({ restingKcal: 1750 }, controller.signal)).rejects.toThrow('Already gone');
    expect(transaction.begin).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty change', {}],
    ['an unknown target', { bmr: 1700 }],
    ['a value out of range', { restingKcal: 12 }],
    ['a fractional value', { proteinGrams: 110.5 }],
  ])('refuses %s before touching the database', async (_label, patch) => {
    const { request, transaction, store } = fixture();
    await expect(store.write(patch as never, signal())).rejects.toThrow(TypeError);
    expect(transaction.begin).not.toHaveBeenCalled();
    expect(request.query).not.toHaveBeenCalled();
  });
});
