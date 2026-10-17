import { beforeEach, describe, expect, it, vi } from 'vitest';
import sql from 'mssql';
import type { FastifyRequest } from 'fastify';
import { NutritionStore } from './store.js';
import type { MealInput } from './model.js';
import { createDailyChanges } from '../revisions.js';
import { dailyQuerySources } from '@jarvis/contracts';

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
  confidence: 'accurate', captureMethod: 'text', provenance: {} };
const authority = { intent: 'log-intake' as const, explicit: true, estimateAccepted: false, proposalRequired: false };
const store = () => NutritionStore.forRequest({} as sql.ConnectionPool, request, () => '2026-10-12T15:00:00Z');
const signal = () => new AbortController().signal;
beforeEach(() => { vi.clearAllMocks(); db.inputs.length = 0; db.begin.mockResolvedValue(undefined); db.commit.mockResolvedValue(undefined); db.rollback.mockResolvedValue(undefined); db.query.mockReset(); });
describe('nutrition failure/privacy boundaries', () => {
  it('publishes intake invalidation only after acknowledged commit, not during persistence or on replay', async () => {
    const changes = createDailyChanges(); const listener = vi.fn(); changes.subscribe(listener);
    const persistence = NutritionStore.forRequest({} as sql.ConnectionPool, request, () => '2026-10-12T15:00:00Z', changes);
    let commit!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { commit = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    db.commit.mockImplementationOnce(() => { entered(); return gate; });
    db.query.mockResolvedValueOnce({ recordset: [] }).mockResolvedValueOnce({ recordset: [{ id: '01' }] });
    const pending = persistence.log(input, authority, signal());
    await started; expect(listener).not.toHaveBeenCalled();
    commit(); await pending;
    expect(listener).toHaveBeenCalledExactlyOnceWith({ owner, sources: [dailyQuerySources.meals] });
    const row = { id: input.id, idempotency_key: input.idempotencyKey, meal_name: input.mealName, meal_type: input.mealType,
      occurred_at: input.occurredAt, meal_date: new Date(input.mealDate), expires_at: input.expiresAt,
      energy_kcal: input.energyKcal, protein_grams: null, carbohydrates_grams: null, fat_grams: null, fiber_grams: null,
      confidence: input.confidence, capture_method: input.captureMethod, components_json: '[]', nutrient_provenance_json: '{}',
      revision: '1', deleted_at: null };
    db.query.mockResolvedValueOnce({ recordset: [row] });
    await persistence.log(input, authority, signal());
    expect(listener).toHaveBeenCalledTimes(1);
    db.query.mockResolvedValueOnce({ recordset: [row] }).mockResolvedValueOnce({ recordset: [{ ...row, revision: '2' }] });
    await persistence.correct(input, 1n, signal());
    expect(listener).toHaveBeenCalledTimes(2);
    db.query.mockResolvedValueOnce({ recordset: [{ ...row, revision: '2' }] });
    await persistence.correct(input, 1n, signal());
    expect(listener).toHaveBeenCalledTimes(2);
    db.query.mockResolvedValueOnce({ recordset: [{ ...row, revision: '2' }] }).mockResolvedValueOnce({ recordset: [{ ...row, revision: '3', deleted_at: '2026-10-12T15:00:00Z' }] });
    await persistence.remove(input.idempotencyKey, 2n, signal());
    expect(listener).toHaveBeenCalledTimes(3);
    db.query.mockResolvedValueOnce({ recordset: [{ ...row, revision: '3', deleted_at: '2026-10-12T15:00:00Z' }] });
    await persistence.remove(input.idempotencyKey, 2n, signal());
    expect(listener).toHaveBeenCalledTimes(3);
  });
  it('does not publish a failed/uncertain commit or deadlock attempt as a new revision', async () => {
    const changes = createDailyChanges(); const listener = vi.fn(); changes.subscribe(listener);
    const persistence = NutritionStore.forRequest({} as sql.ConnectionPool, request, () => '2026-10-12T15:00:00Z', changes);
    db.query.mockResolvedValueOnce({ recordset: [] }).mockResolvedValueOnce({ recordset: [{ id: '01' }] });
    db.commit.mockRejectedValueOnce(new Error('synthetic commit uncertainty'));
    await expect(persistence.log(input, authority, signal())).rejects.toThrow('no successful write');
    expect(listener).not.toHaveBeenCalled();
    db.query.mockRejectedValue(Object.assign(new Error('synthetic deadlock'), { number: 1205 }));
    await expect(persistence.log(input, authority, signal())).rejects.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });
  const sourceRow = { id: '01', idempotency_key: input.idempotencyKey, meal_name: input.mealName, meal_type: null,
    energy_kcal: 100, protein_grams: null, carbohydrates_grams: null, fat_grams: null, fiber_grams: null,
    components_json: '[]', nutrient_provenance_json: '{}', confidence: 'accurate', deleted_at: null };
  it('refuses a changed source revision while holding the intake lock, before any favourite mutation', async () => {
    db.query.mockResolvedValueOnce({ recordset: [{ ...sourceRow, revision: '2' }] });
    await expect(store().favorite({ id: 'favorite', name: 'Synthetic favourite', aliases: [], sourceIdempotencyKey: input.idempotencyKey },
      { explicit: true, estimateAccepted: true, expectedRevision: 0n, sourceRevision: 1n }, signal())).rejects.toThrow('reviewed source intake changed');
    expect(db.query).toHaveBeenCalledOnce();
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WITH (UPDLOCK,HOLDLOCK)'));
    expect(db.rollback).toHaveBeenCalledOnce();
  });
  it('returns the real committed favourite on exact replay without another update or invalidation', async () => {
    const saved = { ...sourceRow, id: 'favorite', favorite_name: 'Synthetic favourite', normalized_name: 'synthetic favourite',
      aliases_json: '[]', source_meal_id: '01', source_idempotency_key: input.idempotencyKey, revision: '1' };
    const publish = vi.fn();
    const persistence = NutritionStore.forRequest({} as sql.ConnectionPool, request, () => '2026-10-12T15:00:00Z', { publish });
    db.query.mockResolvedValueOnce({ recordset: [{ ...sourceRow, revision: '1' }] }).mockResolvedValueOnce({ recordset: [saved] });
    expect(await persistence.favorite({ id: 'favorite', name: 'Synthetic favourite', aliases: [], sourceIdempotencyKey: input.idempotencyKey },
      { explicit: true, estimateAccepted: true, expectedRevision: 0n, sourceRevision: 1n }, signal())).toEqual(saved);
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.commit).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
  });
  it('does not replay an old like over a newer clear and retains the clear revision on an exact retry', async () => {
    const cleared = { meal_key: 'favorite', preference: null, revision: '2' };
    db.query.mockResolvedValueOnce({ recordset: [cleared] });
    await expect(store().feedback('favorite', 'like', signal(), 0n)).rejects.toThrow('preference changed');
    expect(db.query).toHaveBeenCalledOnce();
    db.query.mockResolvedValueOnce({ recordset: [cleared] });
    expect(await store().feedback('favorite', null, signal(), 1n)).toEqual(cleared);
    expect(db.query).toHaveBeenCalledTimes(2);
  });
  it('persists an initial clear tombstone so a delayed revision-0 like cannot overwrite it', async () => {
    const cleared = { meal_key: 'favorite', preference: null, revision: '1' };
    db.query.mockResolvedValueOnce({ recordset: [] }).mockResolvedValueOnce({ recordset: [cleared] });
    expect(await store().feedback('favorite', null, signal(), 0n)).toEqual(cleared);
    expect(db.query).toHaveBeenNthCalledWith(2, expect.stringContaining('INSERT daily.nutrition_recommendation_feedback'));
    db.query.mockResolvedValueOnce({ recordset: [cleared] });
    await expect(store().feedback('favorite', 'like', signal(), 0n)).rejects.toThrow('preference changed');
    expect(db.query).toHaveBeenCalledTimes(3);
  });
  const collectionMutations = [
    { name: 'favourite', source: dailyQuerySources.favorites, records: [[sourceRow], [], []],
      run: (persistence: NutritionStore) => persistence.favorite({ id: 'favorite', name: 'Synthetic favourite', aliases: [],
        sourceIdempotencyKey: input.idempotencyKey }, { explicit: true, estimateAccepted: false }, signal()) },
    { name: 'plan', source: dailyQuerySources.plans, records: [[], [{ ...sourceRow, id: 'favorite' }], [{ id: 'plan', revision: '1' }]],
      run: (persistence: NutritionStore) => persistence.savePlan({ id: 'plan', name: 'Synthetic plan', description: null,
        entries: (['breakfast', 'lunch', 'dinner'] as const).map(slot => ({ slot, favoriteId: 'favorite' })) }, 0n, signal()) },
    { name: 'plan tombstone', source: dailyQuerySources.plans,
      records: [[{ id: 'plan', revision: '1', deleted_at: null }], [{ id: 'plan', revision: '2', deleted_at: '2026-10-12T15:00:00Z' }]],
      run: (persistence: NutritionStore) => persistence.removePlan('plan', 1n, signal()) },
  ];
  it.each(collectionMutations)('publishes the $name source only after acknowledged commit', async ({ source, records, run }) => {
    const changes = createDailyChanges(); const listener = vi.fn(); changes.subscribe(listener);
    const persistence = NutritionStore.forRequest({} as sql.ConnectionPool, request, () => '2026-10-12T15:00:00Z', changes);
    for (const recordset of records) db.query.mockResolvedValueOnce({ recordset });
    let commit!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { commit = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    db.commit.mockImplementationOnce(() => { entered(); return gate; });
    const pending = run(persistence);
    await started; expect(listener).not.toHaveBeenCalled();
    commit(); await pending;
    expect(listener).toHaveBeenCalledExactlyOnceWith({ owner, sources: [source] });
    expect(db.rollback).not.toHaveBeenCalled();
  });
  it('does not publish another collection change for an exact plan-deletion replay', async () => {
    const publish = vi.fn();
    const persistence = NutritionStore.forRequest({} as sql.ConnectionPool, request, () => '2026-10-12T15:00:00Z', { publish });
    const deleted = { id: 'plan', revision: '2', deleted_at: '2026-10-12T15:00:00Z' };
    db.query.mockResolvedValueOnce({ recordset: [deleted] });
    expect(await persistence.removePlan('plan', 1n, signal())).toEqual(deleted);
    expect(db.commit).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
  });
  const mutations = [
    { name: 'insert', existing: [], run: (persistence: NutritionStore) => persistence.log(input, authority, signal()) },
    { name: 'correct', existing: [{ id: input.id, revision: '1', deleted_at: null }],
      run: (persistence: NutritionStore) => persistence.correct(input, 1n, signal()) },
    { name: 'delete', existing: [{ id: input.id, revision: '1', deleted_at: null }],
      run: (persistence: NutritionStore) => persistence.remove(input.idempotencyKey, 1n, signal()) },
  ];
  it.each(mutations)('contains a throwing sink after committed $name without rollback/retry or hiding the returned row', async ({ name, existing, run }) => {
    const publish = vi.fn(() => { throw new TypeError('synthetic notification failure'); });
    const persistence = NutritionStore.forRequest({} as sql.ConnectionPool, request, () => '2026-10-12T15:00:00Z', { publish });
    const saved = { id: input.id, revision: name === 'insert' ? '1' : '2', deleted_at: name === 'delete' ? '2026-10-12T15:00:00Z' : null };
    db.query.mockResolvedValueOnce({ recordset: existing }).mockResolvedValueOnce({ recordset: [saved] });
    expect(await run(persistence)).toEqual(saved);
    expect(db.begin).toHaveBeenCalledTimes(1); expect(db.commit).toHaveBeenCalledTimes(1);
    expect(db.query).toHaveBeenCalledTimes(2); expect(db.rollback).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledExactlyOnceWith({ owner, sources: [dailyQuerySources.meals] });
  });
  it.each(mutations.flatMap(mutation => ['write', 'commit'].map(failure => ({ ...mutation, failure }))))(
    'keeps failed $failure during $name unsuccessful and never invokes its throwing sink',
    async ({ existing, run, failure }) => {
      const publish = vi.fn(() => { throw new Error('synthetic notification failure'); });
      const persistence = NutritionStore.forRequest({} as sql.ConnectionPool, request, () => '2026-10-12T15:00:00Z', { publish });
      db.query.mockResolvedValueOnce({ recordset: existing });
      if (failure === 'write') db.query.mockRejectedValueOnce(new Error('synthetic storage failure'));
      else {
        db.query.mockResolvedValueOnce({ recordset: [{ id: input.id, revision: '2' }] });
        db.commit.mockRejectedValueOnce(new Error('synthetic commit uncertainty'));
      }
      await expect(run(persistence)).rejects.toThrow('no successful write');
      expect(db.begin).toHaveBeenCalledTimes(1); expect(db.rollback).toHaveBeenCalledTimes(1);
      expect(db.query).toHaveBeenCalledTimes(2);
      expect(db.commit).toHaveBeenCalledTimes(failure === 'commit' ? 1 : 0);
      expect(publish).not.toHaveBeenCalled();
    },
  );
  it.each([{ mealType: 'supper' }, { energyKcal: 10001 }, { proteinGrams: 1001 }, { mealDate: '2026-01-02' },
    { occurredAt: '2026-10-12T15:05:01Z', mealDate: '2026-10-12' }])('rejects log and correction writes before SQL %j', async (patch) => {
    await expect(store().log({ ...input, ...patch }, authority, signal())).rejects.toThrow();
    await expect(store().correct({ ...input, ...patch }, 1n, signal())).rejects.toThrow();
    expect(db.begin).not.toHaveBeenCalled(); expect(db.query).not.toHaveBeenCalled();
  });
  it('rejects invalid confirmed favourite definitions before SQL', async () => {
    await expect(store().favorite({ id: 'fav', name: 'Fav', aliases: [], definition: { ...input, energyKcal: 10001 } }, { explicit: true, estimateAccepted: true }, signal())).rejects.toThrow();
    expect(db.begin).not.toHaveBeenCalled();
  });
  it('fails closed on incomplete favourite namespaces', async () => {
    db.query.mockResolvedValue({ recordset: Array(1001).fill({}) });
    await expect(store().findFavorite('name', signal())).rejects.toThrow('safe lookup limits');
  });
  it('looks up full-length and non-key historical names exactly without entering the favourite namespace', async () => {
    for (const name of ['x'.repeat(257), 'x'.repeat(2000), '\u5bff\u53f8', '\ufb03'.repeat(100)]) {
      db.query.mockClear();
      const row = { id: 'synthetic-history', meal_name: name };
      db.query.mockResolvedValue({ recordset: [row] });
      expect(await store().lookupSaved(name, signal())).toEqual({ source: 'history', row });
      expect(db.query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('meal_name COLLATE Latin1_General_100_BIN2=@name'));
      expect(db.inputs).toContainEqual(['name', sql.NVarChar(sql.MAX), name]);
    }
    db.query.mockClear();
    await expect(store().lookupSaved('x'.repeat(2001), signal())).rejects.toThrow('Invalid nutrition text');
    expect(db.query).not.toHaveBeenCalled();
  });
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
  it.each([Error, TypeError])('does not retry uncertain commits or expose %s diagnostics', async (ErrorType) => {
    db.query.mockResolvedValueOnce({ recordset: [] }).mockResolvedValueOnce({ recordset: [{ id: '01' }] });
    db.commit.mockRejectedValueOnce(new ErrorType('synthetic-secret-and-record-content'));
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
