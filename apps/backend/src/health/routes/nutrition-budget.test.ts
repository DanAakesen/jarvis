import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readNutritionSuggestions, type NutritionSuggestionSources } from '../nutrition/suggestion-adapter.js';
import type { NutritionTargetsAccess } from '../nutrition/targets-store.js';
import { nutritionTargetsRoutes } from './nutrition-targets.js';

describe('today’s native nutrition budget', () => {
  const app = Fastify();
  let activeKcal: number | null = 150;
  let intake = 200;
  const targets: NutritionTargetsAccess = () => ({
    read: async () => ({ targets: { restingKcal: 2000, deficitKcal: 450, proteinGrams: 100 }, updatedAt: null }),
    write: async () => { throw new Error('unexpected write'); },
  });
  const sources: NutritionSuggestionSources = {
    now: () => '2026-05-01T22:30:00Z',
    health: () => ({ history: async () => ({
      items: activeKcal === null ? [] : [{ metric_name: 'active_energy', metric_date: '2026-05-02', value: activeKcal, unit: 'kcal' }],
      truncated: false, next: null,
    }) }),
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
    activeKcal = active;
    intake = eaten;
    const headers = { authorization: 'owner' };
    const phone = await app.inject({ url: '/health/nutrition-budget', headers });
    const chat = await app.inject({ url: '/chat-test', headers });
    expect(phone.statusCode).toBe(200);
    expect(phone.headers['cache-control']).toBe('no-store');
    expect(phone.json()).toMatchObject({ localDate: '2026-05-02', kcal: { remainingKcal: remaining, eatenKcal: eaten } });
    expect(phone.json().kcal).toEqual(chat.json().kcal);
  });

  it('requires the signed-in owner and rejects date overrides', async () => {
    expect((await app.inject({ url: '/health/nutrition-budget' })).statusCode).toBe(403);
    expect((await app.inject({ url: '/health/nutrition-budget?date=yesterday', headers: { authorization: 'owner' } })).statusCode).toBe(400);
  });
});
