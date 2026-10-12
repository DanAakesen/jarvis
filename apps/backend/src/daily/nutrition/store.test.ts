import { beforeEach, describe, expect, it, vi } from 'vitest';
import sql from 'mssql';
import type { FastifyRequest } from 'fastify';
import { NutritionStore } from './store.js';
import type { MealInput } from './model.js';

const db = vi.hoisted(() => ({ query: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), cancel: vi.fn(), inputs: [] as unknown[][] }));
vi.mock('mssql', async (original) => {
  const module = await original<typeof import('mssql')>();
  class Request {
    input(...values: unknown[]) { db.inputs.push(values); return this; }
    query(query: string) { return db.query(query); }
    cancel() { db.cancel(); }
  }
  class Transaction {
    begin() { return db.begin(); }
    commit() { return db.commit(); }
    rollback() { return db.rollback(); }
  }
  return { ...module, default: { ...module.default, Request, Transaction } };
});
const owner = '11111111-1111-4111-8111-111111111111';
const request = { server: { ownerObjectId: owner }, principal: { objectId: owner } } as unknown as FastifyRequest;
const input: MealInput = { id: '01', idempotencyKey: 'synthetic-key', mealName: 'Synthetic food', mealType: null, components: [],
  occurredAt: '2026-01-01T23:30:00+01:00', mealDate: '2026-01-01', expiresAt: '2028-01-01T00:00:00Z',
  energyKcal: 100, proteinGrams: null, carbohydratesGrams: null, fatGrams: null, fiberGrams: null,
  confidence: 'exact', captureMethod: 'text', provenance: {} };
const authority = { intent: 'log-intake' as const, explicit: true, estimateAccepted: false };
const store = () => NutritionStore.forRequest({} as sql.ConnectionPool, request, () => '2026-10-12T15:00:00Z');
const signal = () => new AbortController().signal;
beforeEach(() => { vi.clearAllMocks(); db.inputs.length = 0; db.begin.mockResolvedValue(undefined); db.commit.mockResolvedValue(undefined); db.rollback.mockResolvedValue(undefined); db.query.mockReset(); });
describe('nutrition failure/privacy boundaries', () => {
  it('denies callers selecting another owner or a coding runner before SQL', () => {
    expect(() => NutritionStore.forRequest({} as sql.ConnectionPool, { ...request, principal: { objectId: 'other' } } as unknown as FastifyRequest)).toThrow();
    expect(() => NutritionStore.forRequest({} as sql.ConnectionPool, { ...request, runnerPrincipal: { kind: 'jarvis-runner' } } as unknown as FastifyRequest)).toThrow();
    expect(db.begin).not.toHaveBeenCalled();
  });
  it('rejects added owner fields and unaccepted intake before opening a transaction', async () => {
    await expect(store().log({ ...input, ownerEmail: 'synthetic@example.invalid' } as MealInput, authority, signal())).rejects.toThrow('fields');
    await expect(store().log(input, { ...authority, explicit: false }, signal())).rejects.toThrow('Confirm');
    expect(db.begin).not.toHaveBeenCalled();
  });
  it('binds only the server owner, preserves numeric-looking IDs, and commits before success', async () => {
    db.query.mockResolvedValueOnce({ recordset: [] }).mockResolvedValueOnce({ recordset: [{ id: '01' }] });
    expect(await store().log(input, authority, signal())).toEqual({ id: '01' });
    expect(db.inputs.some(([name, , value]) => name === 'owner' && value === owner)).toBe(true);
    expect(db.inputs.some(([name, , value]) => name === 'id' && value === '01')).toBe(true);
    expect(db.commit).toHaveBeenCalledTimes(1);
  });
  it('retries only deadlocks with the same transaction operation and bounds attempts', async () => {
    db.query.mockRejectedValue(Object.assign(new Error('synthetic SQL failure'), { number: 1205 }));
    await expect(store().log(input, authority, signal())).rejects.toThrow('Nutrition persistence failed');
    expect(db.begin).toHaveBeenCalledTimes(3); expect(db.rollback).toHaveBeenCalledTimes(3); expect(db.commit).not.toHaveBeenCalled();
  });
  it('does not retry uncertain commits or expose provider/record/credential diagnostics', async () => {
    db.query.mockResolvedValueOnce({ recordset: [] }).mockResolvedValueOnce({ recordset: [{ id: '01' }] });
    db.commit.mockRejectedValueOnce(new Error('synthetic-secret-and-record-content'));
    const error = await store().log(input, authority, signal()).catch((value: Error) => value);
    expect(String(error)).toContain('Retry with the same operation key'); expect(String(error)).not.toContain('synthetic-secret');
    expect(db.begin).toHaveBeenCalledTimes(1);
  });
  it('sanitizes read failures and bounds pages and candidate feedback', async () => {
    db.query.mockRejectedValue(new Error('synthetic-secret-and-record-content'));
    await expect(store().history({ limit: 1 }, signal())).rejects.toThrow('Nutrition read failed');
    await expect(store().history({ limit: 101 }, signal())).rejects.toThrow('page');
    await expect(store().disliked(Array(1001).fill('meal') as string[], signal())).rejects.toThrow('keys');
    expect(await store().disliked([], signal())).toEqual(new Set());
  });
  it('always consults persisted owner feedback before returning suggestions', async () => {
    db.query.mockResolvedValue({ recordset: [{ meal_key: 'disliked' }] });
    const candidate = (mealKey: string) => ({ ...input, mealKey, name: 'Synthetic', localTimeWindows: [] });
    const rows = await store().suggestions([candidate('disliked'), candidate('liked')],
      { now: '2026-10-12T18:00:00+02:00', localTime: '18:00', remainingKcal: 200, remainingProteinGrams: null }, signal());
    expect(rows.map((row) => row.mealKey)).toEqual(['liked']);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("preference=N'dislike'"));
    expect(db.inputs.some(([name, , value]) => name === 'owner' && value === owner)).toBe(true);
  });
  it('cancels in-flight SQL and rolls back without claiming success', async () => {
    const controller = new AbortController();
    db.query.mockImplementation(async () => { controller.abort(); throw new Error('synthetic request cancellation'); });
    await expect(store().log(input, authority, controller.signal)).rejects.toThrow();
    expect(db.cancel).toHaveBeenCalledTimes(1); expect(db.rollback).toHaveBeenCalledTimes(1); expect(db.commit).not.toHaveBeenCalled();
  });
});
