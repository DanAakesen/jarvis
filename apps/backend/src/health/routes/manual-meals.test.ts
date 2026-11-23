import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ToolFailure, ToolRefusal } from '../../core/tool-registry.js';
import type { MealInput } from '../nutrition/model.js';
import { manualMealRoutes } from './manual-meals.js';

const body = { idempotencyKey: 'de4657e7-bf7e-4bb0-8fbe-4c0c44ac0287', occurredAt: '2025-12-09T23:30:00Z', energyKcal: 275.5 };

describe('direct manual meal', () => {
  const app = Fastify();
  const log = vi.fn(async (meal: MealInput): Promise<Record<string, unknown>> => ({ id: meal.id }));
  beforeAll(async () => {
    app.decorate('ownerObjectId', 'owner');
    app.addHook('onRequest', async request => {
      if (request.headers.authorization === 'owner') Object.assign(request, { principal: { objectId: 'owner' } });
    });
    await app.register(manualMealRoutes(() => ({ log })));
  });
  afterAll(() => app.close());
  const save = (payload: typeof body & { proteinGrams?: unknown }, authorization = 'owner') => app.inject({
    method: 'POST', url: '/health/meals', payload, headers: { authorization },
  });

  it('builds the identical meal on retry, using exact kcal, unknown macros and the original Copenhagen date', async () => {
    const first = await save(body);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ idempotencyKey: body.idempotencyKey, energyKcal: 275.5, proteinGrams: null, mealDate: '2025-12-10' });
    expect((await save(body)).statusCode).toBe(200);
    const [original, retry] = log.mock.calls.map(([meal]) => meal);
    expect(retry).toEqual(original);
    expect(original).toMatchObject({ idempotencyKey: 'manual:' + body.idempotencyKey, energyKcal: 275.5, proteinGrams: null,
      carbohydratesGrams: null, fatGrams: null, fiberGrams: null, confidence: 'accurate',
      provenance: { energyKcal: { source: 'user-exact' }, proteinGrams: { source: 'unknown' } } });
    await save({ ...body, idempotencyKey: 'cc4bd868-3e88-4395-863e-eea427350ad4' });
    expect(log.mock.lastCall?.[0].idempotencyKey).not.toBe(original?.idempotencyKey);
  });

  it.each([0, 24.5, 1000])('stores %s g as exact protein on the same meal and confirms it', async proteinGrams => {
    const response = await save({ ...body, proteinGrams });
    expect(response.statusCode).toBe(200);
    expect(response.json().proteinGrams).toBe(proteinGrams);
    expect(log.mock.lastCall?.[0]).toMatchObject({ energyKcal: body.energyKcal, proteinGrams,
      carbohydratesGrams: null, provenance: { proteinGrams: { source: 'user-exact', unit: 'g' } } });
  });

  it('rejects non-owner, invalid and extra fields before storage', async () => {
    expect((await save(body, 'anonymous')).statusCode).toBe(403);
    for (const change of [{ energyKcal: 0 }, { energyKcal: 10001 }, { proteinGrams: -1 }, { proteinGrams: 1001 }, { proteinGrams: '25' }, { fatGrams: 1 }, { occurredAt: 'tomorrow' }, { idempotencyKey: 'abc' }]) {
      expect((await save({ ...body, ...change })).statusCode).toBe(400);
    }
    expect(log).not.toHaveBeenCalled();
  });

  it('keeps an uncertain save retryable and reports a conflicting replay', async () => {
    log.mockRejectedValueOnce(new ToolFailure('store unavailable'));
    expect((await save(body)).statusCode).toBe(503);
    log.mockRejectedValueOnce(new ToolRefusal('conflicting intake'));
    expect((await save(body)).statusCode).toBe(409);
  });
});
