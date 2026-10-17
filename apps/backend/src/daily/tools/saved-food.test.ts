import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { BrowserConfirmationDelivery, ConfirmationActionKind } from '../../teams/service.js';
import { ToolFailure, ToolRefusal } from '../../core/tool-registry.js';
import { prepareMeal, preparePlan, normalizeSearchText, type FavoriteInput, type FavoriteAuthority, type PlanRequest } from '../nutrition/model.js';
import { dailySavedFoodTool } from './saved-food.js';
import { favoriteFingerprint } from '../records.js';

type Row = Record<string, unknown>;
const owner = '11111111-1111-4111-8111-111111111111';
const at = new Date('2026-10-17T06:00:00Z');
const signal = () => new AbortController().signal;
const save = () => ({ operation: 'save_favorite', expectedRevision: '0', name: 'Synthetic favourite', aliases: ['Alias'],
  definition: { mealName: 'Synthetic portion', energyKcal: 200, proteinGrams: null, fatGrams: 0 } });
const plan = () => ({ operation: 'save_plan', expectedRevision: '0', name: 'Synthetic plan', description: null,
  entries: ['breakfast', 'lunch', 'dinner'].map(slot => ({ slot, favoriteId: 'favorite' })) });
function favoriteRow(input: FavoriteInput, source: Row | null, revision: string): Row {
  const definition = input.definition;
  return {
    id: input.id, favorite_name: input.name, normalized_name: normalizeSearchText(input.name),
    aliases_json: JSON.stringify([...new Set(input.aliases)]), source_meal_id: source?.id ?? null,
    source_idempotency_key: source?.idempotency_key ?? null,
    meal_name: source ? source.meal_name : definition!.mealName, meal_type: source ? source.meal_type : definition!.mealType,
    energy_kcal: source ? source.energy_kcal : definition!.energyKcal,
    protein_grams: source ? source.protein_grams : definition!.proteinGrams,
    carbohydrates_grams: source ? source.carbohydrates_grams : definition!.carbohydratesGrams,
    fat_grams: source ? source.fat_grams : definition!.fatGrams, fiber_grams: source ? source.fiber_grams : definition!.fiberGrams,
    confidence: source ? source.confidence : definition!.confidence,
    components_json: source ? source.components_json : JSON.stringify(definition!.components),
    nutrient_provenance_json: source ? source.nutrient_provenance_json : JSON.stringify(definition!.provenance),
    revision, created_at: at.toISOString(), updated_at: at.toISOString(), private_field: 'must-not-escape',
  };
}
function fixture() {
  const favorites = new Map<string, Row>(); const plans = new Map<string, Row>(); const preferences = new Map<string, Row>();
  const meal = prepareMeal({ id: 'meal', idempotencyKey: 'intake', mealName: 'Retained meal', mealType: 'dinner', components: [],
    energyKcal: 300, proteinGrams: null, carbohydratesGrams: 20, fatGrams: 0, fiberGrams: null,
    confidence: 'accurate', captureMethod: 'voice', provenance: { energyKcal: { source: 'user-exact' } } }, at.toISOString());
  const sourceRow: Row = { id: meal.id, idempotency_key: meal.idempotencyKey, meal_name: meal.mealName, meal_type: meal.mealType,
    energy_kcal: meal.energyKcal, protein_grams: meal.proteinGrams, carbohydrates_grams: meal.carbohydratesGrams,
    fat_grams: meal.fatGrams, fiber_grams: meal.fiberGrams, confidence: meal.confidence, capture_method: meal.captureMethod,
    components_json: JSON.stringify(meal.components), nutrient_provenance_json: JSON.stringify(meal.provenance),
    occurred_at: meal.occurredAt, meal_date: meal.mealDate, expires_at: meal.expiresAt, revision: '1', deleted_at: null };
  favorites.set('favorite', favoriteRow({ id: 'favorite', name: 'Existing', aliases: [] }, sourceRow, '1'));
  const store = {
    intake: vi.fn(async () => sourceRow),
    lookupSaved: vi.fn(async (): Promise<{ source: 'favorite' | 'history'; row: Row } | null> => ({ source: 'favorite', row: favorites.get('favorite')! })),
    findFavorite: vi.fn(async (name: string) => [...favorites.values()].find(row => row.normalized_name === normalizeSearchText(name)) ?? null),
    favoriteRecords: vi.fn(async (ids: readonly string[]) => ids.flatMap(id => favorites.has(id) ? [favorites.get(id)!] : [])),
    favorite: vi.fn(async (input: FavoriteInput, authority: FavoriteAuthority, operationSignal: AbortSignal) => {
      operationSignal.throwIfAborted();
      const row = favoriteRow(input, input.sourceIdempotencyKey ? sourceRow : null, String(authority.expectedRevision! + 1n));
      favorites.set(input.id, row); return row;
    }),
    preferences: vi.fn(async (ids: readonly string[]) => ids.flatMap(id => preferences.has(id) ? [preferences.get(id)!] : [])),
    feedback: vi.fn(async (key: string, preference: 'like' | 'dislike' | null, operationSignal: AbortSignal, expected?: bigint, reviewed?: string) => {
      operationSignal.throwIfAborted(); expect(reviewed).toBe(favoriteFingerprint(favorites.get(key)!));
      const row = { meal_key: key, preference, revision: String(expected! + 1n), private_field: 'must-not-escape' };
      preferences.set(key, row); return row;
    }),
    findPlan: vi.fn(async (name: string) => [...plans.values()].find(row => row.normalized_name === normalizeSearchText(name)) ?? null),
    planRecord: vi.fn(async (id: string) => plans.get(id) ?? null),
    savePlan: vi.fn(async (input: PlanRequest, expected: bigint, operationSignal: AbortSignal, reviewed?: ReadonlyMap<string, string>) => {
      operationSignal.throwIfAborted(); expect(reviewed?.get('favorite')).toBe(favoriteFingerprint(favorites.get('favorite')!));
      const snapshot = preparePlan(input, [...favorites.values()]);
      const row = { id: input.id, plan_name: input.name, normalized_name: normalizeSearchText(input.name), description: input.description,
        items_json: JSON.stringify(snapshot.items), energy_kcal: snapshot.energyKcal, protein_grams: snapshot.proteinGrams,
        carbohydrates_grams: snapshot.carbohydratesGrams, fat_grams: snapshot.fatGrams, fiber_grams: snapshot.fiberGrams,
        revision: String(expected + 1n), deleted_at: null };
      plans.set(input.id, row); return row;
    }),
    removePlan: vi.fn(async (id: string, expected: bigint) => {
      const row = { ...plans.get(id)!, revision: String(expected + 1n), deleted_at: at.toISOString() };
      plans.set(id, row); return row;
    }),
  };
  const decisions: ReturnType<typeof Promise.withResolvers<'approve' | 'reject'>>[] = [];
  const runConfirmed = vi.fn(async <T>(_kind: ConfirmationActionKind, _summary: string, action: () => Promise<T>,
    operationSignal?: AbortSignal, delivery?: BrowserConfirmationDelivery): Promise<T> => {
    expect(delivery).toEqual({ channel: 'browser', lifetimeSeconds: 120 });
    const decision = Promise.withResolvers<'approve' | 'reject'>(); decisions.push(decision);
    const answer = await decision.promise; operationSignal?.throwIfAborted();
    if (answer !== 'approve') throw new ToolRefusal('Dan rejected the request.');
    return action();
  });
  const mode = { mode: 'present' };
  const session = { id: 'session', channel: 'voice', language: 'en', startedAt: at, endedAt: null as Date | null };
  const source = { id: '42', sessionId: 'session', role: 'dan' as const, text: 'Review this synthetic saved food.', model: null, at };
  const request = { principal: { objectId: owner }, headers: {}, jarvisConversationMessage: source,
    server: { ownerObjectId: owner, conversationStore: { getSession: async () => session },
      awayModeStore: { read: async () => mode }, teamsNotifications: { runConfirmed } } } as unknown as FastifyRequest;
  const tool = dailySavedFoodTool(() => store, () => at.getTime());
  const begin = async (input: unknown, operationSignal = signal()) => {
    const active = tool.execute(input, request, operationSignal);
    const settled = active.then(value => ({ value, error: null }), error => ({ value: null, error: error as unknown }));
    await vi.waitFor(() => expect(decisions.length).toBeGreaterThan(0));
    const decision = decisions.shift()!;
    return { resolve: async (answer: 'approve' | 'reject' = 'approve') => {
      decision.resolve(answer); const result = await settled; if (result.error) throw result.error; return result.value;
    } };
  };
  return { tool, request, store, favorites, plans, preferences, runConfirmed, mode, session, sourceRow, begin };
}

describe('inactive internal saved-food workflow', () => {
  it('reads owned saved snapshots without approval and redacts private columns', async () => {
    const f = fixture();
    expect(await f.tool.execute({ operation: 'lookup_saved', name: 'Alias' }, f.request, signal())).toMatchObject({
      status: 'available', source: 'favorite', record: { energy_kcal: 300, protein_grams: null }, intakeLogged: false,
    });
    expect(f.store.lookupSaved).toHaveBeenCalledWith('Alias', expect.any(AbortSignal));
    f.store.lookupSaved.mockResolvedValueOnce(null);
    expect(await f.tool.execute({ operation: 'lookup_saved', name: 'Missing' }, f.request, signal())).toMatchObject({ status: 'empty' });
    expect(f.runConfirmed).not.toHaveBeenCalled();
    expect(f.tool.sensitive).toBe(true); expect(f.tool.denyOnPhone).toBe(true); expect(f.tool.reflexSafe).not.toBe(true);
    expect(JSON.stringify(await f.tool.execute({ operation: 'lookup_saved', name: 'Existing' }, f.request, signal()))).not.toContain('must-not-escape');
  });
  it('keeps absent, cleared and disliked preferences distinct, with canonical exact keys', async () => {
    const f = fixture();
    f.preferences.set('cleared', { meal_key: 'cleared', preference: null, revision: '2' });
    f.preferences.set('disliked', { meal_key: 'disliked', preference: 'dislike', revision: '3' });
    const result = await f.tool.execute({ operation: 'read_preferences', favoriteIds: ['missing', 'cleared', 'disliked', 'cleared'] }, f.request, signal());
    expect(result).toMatchObject({ records: [
      { favoriteId: 'missing', status: 'not-set', revision: '0', preference: null },
      { favoriteId: 'cleared', status: 'cleared', revision: '2', preference: null },
      { favoriteId: 'disliked', status: 'available', revision: '3', preference: 'dislike' },
    ] });
    expect(f.store.preferences).toHaveBeenCalledWith(['missing', 'cleared', 'disliked'], expect.any(AbortSignal));
    expect(f.runConfirmed).not.toHaveBeenCalled();
  });
  it('freezes a definition until actual browser approval and recovers the real replay without another approval', async () => {
    const f = fixture(); const input = save(); const pending = await f.begin(input);
    expect(f.store.favorite).not.toHaveBeenCalled();
    expect(f.runConfirmed.mock.calls[0]![1]).toContain('"energy_kcal": 200');
    input.definition.energyKcal = 999;
    const committed = await pending.resolve();
    expect(committed).toMatchObject({ status: 'committed', record: { energy_kcal: 200, protein_grams: null, fat_grams: 0, confidence: 'estimate' } });
    expect(JSON.stringify(committed)).not.toContain('must-not-escape');
    expect(f.store.favorite.mock.calls[0]![0].definition?.provenance).toMatchObject({ independentlyVerified: false });
    expect(await f.tool.execute(save(), f.request, signal())).toMatchObject({ status: 'already-applied', record: { revision: '1', energy_kcal: 200 } });
    expect(f.store.favorite).toHaveBeenCalledOnce(); expect(f.runConfirmed).toHaveBeenCalledOnce();
  });
  it('binds the actual source revision, saved quantities and unchanged provenance for an intake-derived favourite', async () => {
    const f = fixture();
    const pending = await f.begin({ operation: 'save_favorite', expectedRevision: '0', name: 'From intake', sourceIdempotencyKey: 'intake' });
    expect(await pending.resolve()).toMatchObject({ record: { energy_kcal: 300, confidence: 'accurate', source_idempotency_key: 'intake' } });
    expect(f.store.favorite.mock.calls[0]![1]).toMatchObject({ explicit: true, expectedRevision: 0n, sourceRevision: 1n });
  });
  it('snapshots plans from actual favourites with authoritative unknown totals and reviewed-source fingerprints', async () => {
    const f = fixture(); const input = plan(); const pending = await f.begin(input);
    expect(f.store.savePlan).not.toHaveBeenCalled();
    input.entries[0]!.favoriteId = 'not-reviewed';
    expect(await pending.resolve()).toMatchObject({ record: { energy_kcal: 900, protein_grams: null, fat_grams: 0, revision: '1' } });
    expect(f.runConfirmed.mock.calls[0]![1].length).toBeLessThanOrEqual(4000);
    expect(await f.tool.execute(plan(), f.request, signal())).toMatchObject({ status: 'already-applied' });
    expect(f.store.savePlan).toHaveBeenCalledOnce();
  });
  it.each(['like', 'dislike', null] as const)('requires native approval for canonical preference %s and preserves clears/replays', async preference => {
    const f = fixture();
    const input = { operation: 'set_feedback', favoriteId: 'favorite', expectedRevision: '0', preference };
    const pending = await f.begin(input); expect(f.store.feedback).not.toHaveBeenCalled();
    expect(await pending.resolve()).toMatchObject({ record: { meal_key: 'favorite', preference, revision: '1' } });
    expect(await f.tool.execute(input, f.request, signal())).toMatchObject({ status: 'already-applied' });
    expect(f.store.feedback).toHaveBeenCalledOnce();
  });
  it('rejects soft deletion without writing, releases the guard and returns an actual tombstone on retry', async () => {
    const f = fixture();
    const creation = await f.begin(plan()); await creation.resolve();
    const id = [...f.plans.keys()][0]!;
    const input = { operation: 'delete_plan', id, expectedRevision: '1' };
    const pending = await f.begin(input);
    await expect(f.tool.execute(input, f.request, signal())).rejects.toThrow('already pending');
    await expect(pending.resolve('reject')).rejects.toThrow('rejected');
    expect(f.store.removePlan).not.toHaveBeenCalled();
    const retry = await f.begin(input); expect(await retry.resolve()).toMatchObject({ record: { revision: '2', deleted_at: expect.any(String) } });
    expect(await f.tool.execute(input, f.request, signal())).toMatchObject({ status: 'already-deleted' });
    expect(f.store.removePlan).toHaveBeenCalledOnce();
  });
  it.each(['away', 'ended', 'cancelled'])('refuses %s before the approved callback writes', async state => {
    const f = fixture(); const controller = new AbortController();
    const pending = await f.begin(save(), controller.signal);
    if (state === 'away') f.mode.mode = 'away';
    if (state === 'ended') f.session.endedAt = at;
    if (state === 'cancelled') controller.abort();
    await expect(pending.resolve()).rejects.toThrow();
    expect(f.store.favorite).not.toHaveBeenCalled();
  });
  it('recovers an uncertain commit by one matching readback without retrying the write', async () => {
    const f = fixture(); const original = f.store.favorite.getMockImplementation()!;
    f.store.favorite.mockImplementationOnce(async (...args) => { await original(...args); throw new ToolFailure('Synthetic uncertain result'); });
    const pending = await f.begin(save());
    expect(await pending.resolve()).toMatchObject({ status: 'committed', record: { revision: '1', energy_kcal: 200 } });
    expect(f.store.favorite).toHaveBeenCalledOnce(); expect(f.store.findFavorite).toHaveBeenCalledTimes(2);
  });
  it('does not invent success from a missing receipt or retry changed source failures', async () => {
    const f = fixture();
    f.store.favorite.mockRejectedValueOnce(new ToolRefusal('Reviewed source changed'));
    const pending = await f.begin(save());
    await expect(pending.resolve()).rejects.toThrow('Reviewed source changed');
    expect(f.store.favorite).toHaveBeenCalledOnce(); expect(f.store.findFavorite).toHaveBeenCalledTimes(2);
  });
  it('refuses stale revisions, excessive summaries, invalid slots and cross-operation/authority fields before approval', async () => {
    const f = fixture();
    for (const input of [
      { operation: 'set_feedback', favoriteId: 'favorite', expectedRevision: '2', preference: 'like' },
      { ...plan(), entries: Array.from({ length: 3 }, () => ({ slot: 'breakfast', favoriteId: 'favorite' })) },
      { ...plan(), description: 'x'.repeat(3900) },
      { operation: 'lookup_saved', name: 'Existing', favoriteIds: ['favorite'] },
      { ...save(), operationId: 'untrusted' }, { ...save(), confirmed: true },
    ]) await expect(f.tool.execute(input, f.request, signal())).rejects.toThrow();
    expect(f.runConfirmed).not.toHaveBeenCalled();
  });
});
