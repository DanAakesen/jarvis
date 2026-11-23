import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readNutritionSuggestions, type NutritionSuggestionSources } from '../nutrition/suggestion-adapter.js';
import type { NutritionTargetsAccess } from '../nutrition/targets-store.js';
import { nutritionTargetsRoutes } from './nutrition-targets.js';

describe('today’s native nutrition budget', () => {
  const app = Fastify();
  const day = { metric_date: '2026-05-02', unit: 'kcal' };
  const native = { ...day, metric_name: 'active_energy_burned', ingestion_id: 'ios-batch', value: 103,
    fields: { mergedDailyTotal: true }, end_at: '2026-05-01T22:25:00Z', updated_at: '2026-05-01T22:29:00Z' };
  const exported = { ...day, metric_name: 'active_energy', value: 90, updated_at: '2026-05-01T22:20:00Z' };
  let metrics: Record<string, unknown>[] = [];
  let intake = 200;
  const targets: NutritionTargetsAccess = () => ({
    read: async () => ({ targets: { restingKcal: 2000, deficitKcal: 450, proteinGrams: 100 }, updatedAt: null }),
    write: async () => { throw new Error('unexpected write'); },
  });
  const sources: NutritionSuggestionSources = {
    now: () => '2026-05-01T22:30:00Z',
    health: () => ({ history: async (_, range) => {
      expect(range).toMatchObject({ startDate: day.metric_date, endDate: day.metric_date, limit: 1 });
      return { items: metrics.filter(row => row.metric_name === range.metric), truncated: false, next: null };
    } }),
    nutrition: () => ({
      history: async ({ from, to }) => {
        expect([from, to]).toEqual(['2026-05-02', '2026-05-02']);
        return { rows: [{ energy_kcal: intake, protein_grams: 12 }], next: null };
      },
      favorites: async () => ({ rows: [], nextId: null }),
      suggestions: async () => [],
    }),
  };
  beforeAll(async () => {
    app.decorate('ownerObjectId', 'owner');
    app.addHook('onRequest', async request => {
      if (request.headers.authorization === 'owner') Object.assign(request, { principal: { objectId: 'owner' } });
    });
    await app.register(nutritionTargetsRoutes(targets, sources));
    app.get('/chat-test', request => readNutritionSuggestions(sources, targets, request, 1, AbortSignal.timeout(5000)));
  });
  afterAll(() => app.close());

  it.each([
    { active: 150, eaten: 200, remaining: 1500 },
    { active: 0, eaten: 1800, remaining: -250 },
    { active: null, eaten: 200, remaining: null },
  ])('matches Chat for $active active kcal and $eaten logged kcal', async ({ active, eaten, remaining }) => {
    metrics = active === null ? [] : [{ ...exported, value: active }];
    intake = eaten;
    const headers = { authorization: 'owner' };
    const phone = await app.inject({ url: '/health/nutrition-budget', headers });
    const chat = await app.inject({ url: '/chat-test', headers });
    expect(phone.statusCode).toBe(200);
    expect(phone.headers['cache-control']).toBe('no-store');
    expect(phone.json()).toMatchObject({ localDate: '2026-05-02', kcal: { remainingKcal: remaining, eatenKcal: eaten } });
    expect(phone.json().kcal).toEqual(chat.json().kcal);
  });

  it.each([
    { name: 'native only', rows: [native], metric: native.metric_name, kcal: 103 },
    { name: 'newer native coverage', rows: [exported, native], metric: native.metric_name, kcal: 103 },
    { name: 'export after native coverage', rows: [native, { ...exported, updated_at: '2026-05-01T22:27:00Z' }],
      metric: exported.metric_name, kcal: 90 },
    { name: 'equal times prefer native', rows: [{ ...exported, updated_at: native.end_at }, native], metric: native.metric_name, kcal: 103 },
    { name: 'invalid native unit', rows: [exported, { ...native, unit: 'min' }], metric: exported.metric_name, kcal: 90 },
    { name: 'interval-only iOS upload', rows: [{ ...native, fields: { aggregation: 'sum' } }], metric: null, kcal: null },
  ])('uses one current daily total for $name', async ({ rows, metric, kcal }) => {
    metrics = rows;
    intake = 200;
    const headers = { authorization: 'owner' };
    const phone = await app.inject({ url: '/health/nutrition-budget', headers });
    const chat = await app.inject({ url: '/chat-test', headers });
    expect(phone.json().kcal).toMatchObject({ activeKcal: kcal, remainingKcal: kcal === null ? null : 1350 + kcal });
    expect(chat.json().kcal).toEqual(phone.json().kcal);
    expect(chat.json().burn.metric).toBe(metric);
  });

  it('requires the signed-in owner and rejects date overrides', async () => {
    expect((await app.inject({ url: '/health/nutrition-budget' })).statusCode).toBe(403);
    expect((await app.inject({ url: '/health/nutrition-budget?date=yesterday', headers: { authorization: 'owner' } })).statusCode).toBe(400);
  });
});
