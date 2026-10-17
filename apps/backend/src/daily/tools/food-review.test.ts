import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import type { ConfirmationActionKind } from '../../teams/service.js';
import type { MealInput } from '../nutrition/model.js';
import { ToolFailure, ToolRefusal } from '../../core/tool-registry.js';
import { dailyFoodReviewTool } from './food-review.js';
import { foodReviewSchema } from '../nutrition/review.js';

const owner = '11111111-1111-4111-8111-111111111111';
const at = new Date('2026-10-17T03:00:00Z');
const signal = () => new AbortController().signal;
const estimate = () => ({ change: { operation: 'log_estimate', food: { mealName: 'Synthetic portion', energyKcal: 200 } } });
function row(input: MealInput, revision = '1', deletedAt: string | null = null): Record<string, unknown> {
  return {
    id: input.id, idempotency_key: input.idempotencyKey, meal_name: input.mealName, meal_type: input.mealType,
    components_json: JSON.stringify(input.components), nutrient_provenance_json: JSON.stringify(input.provenance),
    occurred_at: input.occurredAt, meal_date: new Date(`${input.mealDate}T00:00:00Z`), expires_at: input.expiresAt,
    energy_kcal: input.energyKcal, protein_grams: input.proteinGrams, carbohydrates_grams: input.carbohydratesGrams,
    fat_grams: input.fatGrams, fiber_grams: input.fiberGrams, confidence: input.confidence,
    capture_method: input.captureMethod, revision, deleted_at: deletedAt, private_field: 'must-not-escape',
  };
}
function fixture() {
  const rows = new Map<string, Record<string, unknown>>();
  const store = {
    intake: vi.fn(async (key: string) => rows.get(key) ?? null),
    lookupSaved: vi.fn(async (): Promise<{ source: 'favorite'; row: Record<string, unknown> } | null> => null),
    log: vi.fn(async (input: MealInput) => { const saved = row(input); rows.set(input.idempotencyKey, saved); return saved; }),
    correct: vi.fn(async (input: MealInput, revision: bigint) => {
      const saved = row(input, (revision + 1n).toString()); rows.set(input.idempotencyKey, saved); return saved;
    }),
    remove: vi.fn(async (key: string, revision: bigint) => {
      const saved = { ...rows.get(key)!, revision: (revision + 1n).toString(), deleted_at: at.toISOString() }; rows.set(key, saved); return saved;
    }),
  };
  const decision = Promise.withResolvers<'approve' | 'reject'>();
  const staged = Promise.withResolvers<void>();
  const runConfirmed = vi.fn(async <T>(_kind: ConfirmationActionKind, _summary: string, action: () => Promise<T>,
    operationSignal?: AbortSignal, delivery?: 'browser'): Promise<T> => {
    expect(delivery).toBe('browser');
    staged.resolve();
    const answer = await decision.promise;
    operationSignal?.throwIfAborted();
    if (answer !== 'approve') throw new ToolRefusal('Dan rejected the request.');
    return action();
  });
  const mode = { mode: 'present' };
  const session = { id: 'session', channel: 'voice', language: 'en', startedAt: at, endedAt: null };
  const source = { id: '42', sessionId: session.id, role: 'dan' as const, text: 'I ate a portion; please review it.', at, model: null };
  const request = {
    server: { ownerObjectId: owner, conversationStore: { getSession: vi.fn(async () => session) },
      awayModeStore: { read: vi.fn(async () => mode) }, teamsNotifications: { runConfirmed } },
    principal: { objectId: owner }, headers: {}, jarvisConversationMessage: source,
  } as unknown as FastifyRequest;
  const nutrition = vi.fn(() => store);
  const tool = dailyFoodReviewTool(nutrition, () => at.getTime());
  const seed = () => {
    const saved = row({ id: 'old', idempotencyKey: 'retained-key', mealName: 'Old meal', mealType: null, components: [],
      energyKcal: 100, proteinGrams: null, carbohydratesGrams: null, fatGrams: null, fiberGrams: null,
      occurredAt: '2026-01-01T23:30:00Z', mealDate: '2026-01-02', expiresAt: '9999-12-31T23:59:59Z',
      confidence: 'accurate', captureMethod: 'mixed', provenance: { energyKcal: { source: 'user-exact' } } });
    rows.set('retained-key', saved); return saved;
  };
  return { tool, request, store, nutrition, rows, runConfirmed, staged: staged.promise,
    approve: () => decision.resolve('approve'), reject: () => decision.resolve('reject'), mode, session, seed };
}

describe('inactive internal food proposal review', () => {
  it('preserves each operation and unknown versus zero through real Fastify/Ajv before strict tool validation', async () => {
    const app = Fastify();
    app.post('/synthetic-food-schema', { schema: { body: fixture().tool.inputSchema } }, async request => foodReviewSchema.parse(request.body));
    try {
      for (const input of [
        estimate(),
        { change: { operation: 'log_estimate', food: { mealName: 'Synthetic meal', energyKcal: 0, proteinGrams: null, carbohydratesGrams: 0, fatGrams: null, fiberGrams: 0 } } },
        { change: { operation: 'correct', idempotencyKey: 'retained-key', expectedRevision: '1', changes: { energyKcal: 222 } } },
        { change: { operation: 'correct', idempotencyKey: 'retained-key', expectedRevision: '1', changes: { proteinGrams: null, fatGrams: 0 } } },
        { change: { operation: 'delete', idempotencyKey: 'retained-key', expectedRevision: '1' } },
      ]) {
        const result = await app.inject({ method: 'POST', url: '/synthetic-food-schema', payload: input });
        expect(result.statusCode).toBe(200);
        expect(result.json()).toEqual(foodReviewSchema.parse(input));
      }
    } finally { await app.close(); }
  });
  it('writes only after the exact browser proposal is approved, retaining actual voice/null/confidence evidence', async () => {
    const f = fixture(); const input = estimate();
    const result = f.tool.execute(input, f.request, signal());
    await f.staged;
    expect(f.store.log).not.toHaveBeenCalled();
    expect(f.runConfirmed.mock.calls[0]![4]).toBe('browser');
    expect(f.runConfirmed.mock.calls[0]![1]).toContain('"energyKcal": 200');
    input.change.food.energyKcal = 999;
    f.approve();
    expect(await result).toMatchObject({ status: 'committed', record: { energy_kcal: 200, protein_grams: null, confidence: 'estimate', capture_method: 'voice' } });
    expect(f.store.log).toHaveBeenCalledWith(expect.objectContaining({ confidence: 'estimate' }),
      { intent: 'log-intake', explicit: true, proposalRequired: true, estimateAccepted: true }, expect.any(AbortSignal));
    expect(JSON.stringify(await f.tool.execute(estimate(), f.request, signal()))).not.toContain('must-not-escape');
    expect(f.store.log).toHaveBeenCalledOnce(); expect(f.runConfirmed).toHaveBeenCalledOnce();
    expect(f.tool.sensitive).toBe(true); expect(f.tool.publicAllowedOnPhone).not.toBe(true); expect(f.tool.reflexSafe).not.toBe(true);
  });
  it('does not write after rejection and releases the pending guard', async () => {
    const f = fixture(); const result = f.tool.execute(estimate(), f.request, signal());
    const refused = expect(result).rejects.toThrow('rejected');
    await f.staged; f.reject(); await refused;
    expect(f.store.log).not.toHaveBeenCalled();
    await expect(f.tool.execute(estimate(), f.request, signal())).rejects.toThrow('rejected');
    expect(f.runConfirmed).toHaveBeenCalledTimes(2);
  });
  it('refuses overlapping review instead of showing duplicate or changed approval cards', async () => {
    const f = fixture(); const first = f.tool.execute(estimate(), f.request, signal());
    await f.staged;
    await expect(f.tool.execute(estimate(), f.request, signal())).rejects.toThrow('already awaiting');
    f.approve(); await first;
    expect(f.runConfirmed).toHaveBeenCalledOnce(); expect(f.store.log).toHaveBeenCalledOnce();
  });
  it('refuses presence changes or cancellation after staging without committing', async () => {
    const f = fixture(); const result = f.tool.execute(estimate(), f.request, signal());
    const refused = expect(result).rejects.toThrow('present');
    await f.staged; f.mode.mode = 'away'; f.approve(); await refused;
    expect(f.store.log).not.toHaveBeenCalled();
    const cancelled = fixture(); const controller = new AbortController();
    const pending = cancelled.tool.execute(estimate(), cancelled.request, controller.signal);
    const aborted = expect(pending).rejects.toThrow();
    await cancelled.staged; controller.abort(); cancelled.approve(); await aborted;
    expect(cancelled.store.log).not.toHaveBeenCalled();
  });
  it('refuses non-present, unavailable, stale and phone context before requesting review', async () => {
    for (const modify of [
      (f: ReturnType<typeof fixture>) => { f.mode.mode = 'away'; },
      (f: ReturnType<typeof fixture>) => { f.request.server.teamsNotifications = undefined; },
      (f: ReturnType<typeof fixture>) => { f.session.channel = 'phone'; },
      (f: ReturnType<typeof fixture>) => { f.request.jarvisConversationMessage = { ...f.request.jarvisConversationMessage!, at: new Date(at.getTime() - 600001) }; },
    ]) {
      const f = fixture(); modify(f);
      await expect(f.tool.execute(estimate(), f.request, signal())).rejects.toThrow();
      expect(f.runConfirmed).not.toHaveBeenCalled(); expect(f.store.log).not.toHaveBeenCalled();
    }
  });
  it('routes direct exact labels and actual saved favourites back to the one-step tool without another confirmation', async () => {
    const exact = fixture(); exact.request.jarvisConversationMessage!.text = 'Log yoghurt: 200 kcal';
    await expect(exact.tool.execute(estimate(), exact.request, signal())).rejects.toThrow('log_exact');
    expect(exact.runConfirmed).not.toHaveBeenCalled();
    const favorite = fixture(); favorite.request.jarvisConversationMessage!.text = 'Log my favourite Dinner';
    favorite.store.lookupSaved.mockResolvedValue({ source: 'favorite', row: {} });
    await expect(favorite.tool.execute(estimate(), favorite.request, signal())).rejects.toThrow('log_favorite');
    expect(favorite.runConfirmed).not.toHaveBeenCalled();
  });
  it('rejects forged input authority and a different owner before touching nutrition', async () => {
    const f = fixture();
    await expect(f.tool.execute({ ...estimate(), userConfirmed: true }, f.request, signal())).rejects.toThrow();
    f.request.principal = { objectId: 'different' };
    await expect(f.tool.execute(estimate(), f.request, signal())).rejects.toThrow();
    expect(f.nutrition).not.toHaveBeenCalled();
  });
  it('recovers only an actual source/payload-bound commit after an uncertain log', async () => {
    const f = fixture(); const persist = f.store.log.getMockImplementation()!;
    f.store.log.mockImplementationOnce(async input => { await persist(input); throw new ToolFailure('Synthetic uncertain commit'); });
    const pending = f.tool.execute(estimate(), f.request, signal());
    await f.staged; f.approve();
    expect(await pending).toMatchObject({ status: 'committed', record: { energy_kcal: 200 } });
    await expect(f.tool.execute({ change: { operation: 'log_estimate', food: { mealName: 'Other', energyKcal: 1 } } }, f.request, signal())).rejects.toThrow('different committed intake');
    expect(f.store.log).toHaveBeenCalledOnce();
  });
  it('preserves an unverified failure rather than manufacturing success', async () => {
    const f = fixture(); f.store.log.mockRejectedValueOnce(new ToolFailure('Synthetic missing receipt'));
    const pending = f.tool.execute(estimate(), f.request, signal());
    const failed = expect(pending).rejects.toThrow('missing receipt');
    await f.staged; f.approve(); await failed;
    expect(f.rows.size).toBe(0);
  });
  it('corrects old history with the exact revision and does not repeat a source-bound committed correction', async () => {
    const f = fixture(); f.seed();
    const input = { change: { operation: 'correct', idempotencyKey: 'retained-key', expectedRevision: '1',
      changes: { energyKcal: 222, occurredAt: '2026-01-02T23:30:00Z' } } };
    const pending = f.tool.execute(input, f.request, signal());
    await f.staged;
    expect(f.runConfirmed.mock.calls[0]![1]).toContain('"energyKcal": 100');
    expect(f.runConfirmed.mock.calls[0]![1]).toContain('"energyKcal": 222');
    expect(f.store.correct).not.toHaveBeenCalled();
    f.approve();
    expect(await pending).toMatchObject({ status: 'committed', record: { energy_kcal: 222, meal_date: '2026-01-03', revision: '2', confidence: 'estimate', capture_method: 'mixed' } });
    expect(await f.tool.execute(input, f.request, signal())).toMatchObject({ status: 'committed', record: { revision: '2' } });
    expect(f.runConfirmed).toHaveBeenCalledOnce(); expect(f.store.correct).toHaveBeenCalledOnce();
  });
  it('refuses changes made while a correction was awaiting approval', async () => {
    const f = fixture(); const saved = f.seed();
    const pending = f.tool.execute({ change: { operation: 'correct', idempotencyKey: 'retained-key', expectedRevision: '1', changes: { mealName: 'New' } } }, f.request, signal());
    const refused = expect(pending).rejects.toThrow('while approval was pending');
    await f.staged; saved.revision = '2'; f.approve(); await refused;
    expect(f.store.correct).not.toHaveBeenCalled();
  });
  it('recovers the identical committed correction when another instance finishes while its approval is pending', async () => {
    const f = fixture(); const original = structuredClone(f.seed());
    const input = { change: { operation: 'correct', idempotencyKey: 'retained-key', expectedRevision: '1', changes: { energyKcal: 222 } } };
    const first = f.tool.execute(input, f.request, signal());
    await f.staged; f.approve(); const committed = await first;
    f.store.intake.mockResolvedValueOnce(original);
    const second = dailyFoodReviewTool(() => f.store, () => at.getTime());
    expect(await second.execute(input, f.request, signal())).toEqual(committed);
    expect(f.store.correct).toHaveBeenCalledOnce();
    expect(f.runConfirmed).toHaveBeenCalledTimes(2);
  });
  it('recovers an actual source-bound corrected row after an uncertain correction result', async () => {
    const f = fixture(); f.seed(); const persist = f.store.correct.getMockImplementation()!;
    f.store.correct.mockImplementationOnce(async (input, revision) => { await persist(input, revision); throw new ToolFailure('Synthetic uncertain correction'); });
    const pending = f.tool.execute({ change: { operation: 'correct', idempotencyKey: 'retained-key', expectedRevision: '1', changes: { energyKcal: 222 } } }, f.request, signal());
    await f.staged; f.approve();
    expect(await pending).toMatchObject({ status: 'committed', record: { revision: '2', energy_kcal: 222 } });
    expect(f.store.correct).toHaveBeenCalledOnce();
  });
  it('recovers a real tombstone after an uncertain deletion result without another write', async () => {
    const f = fixture(); f.seed(); const persist = f.store.remove.getMockImplementation()!;
    f.store.remove.mockImplementationOnce(async (key, revision) => { await persist(key, revision); throw new ToolFailure('Synthetic uncertain deletion'); });
    const pending = f.tool.execute({ change: { operation: 'delete', idempotencyKey: 'retained-key', expectedRevision: '1' } }, f.request, signal());
    await f.staged; f.approve();
    expect(await pending).toMatchObject({ status: 'committed', record: { revision: '2', deleted_at: at.toISOString() } });
    expect(f.store.remove).toHaveBeenCalledOnce();
  });
  it('soft-deletes only after review, preserves the row and reports a real tombstone without another write', async () => {
    const f = fixture(); f.seed();
    const input = { change: { operation: 'delete', idempotencyKey: 'retained-key', expectedRevision: '1' } };
    const pending = f.tool.execute(input, f.request, signal());
    await f.staged; expect(f.store.remove).not.toHaveBeenCalled(); f.approve();
    expect(await pending).toMatchObject({ status: 'committed', record: { revision: '2', deleted_at: at.toISOString(), energy_kcal: 100 } });
    expect(await f.tool.execute(input, f.request, signal())).toMatchObject({ status: 'already-deleted', record: { revision: '2' } });
    expect(f.rows.size).toBe(1); expect(f.store.remove).toHaveBeenCalledOnce(); expect(f.runConfirmed).toHaveBeenCalledOnce();
  });
});
