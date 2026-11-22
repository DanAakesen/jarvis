import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { HealthData } from '../query.js';
import { healthSourceTools } from './source-tools.js';

const owner = '11111111-1111-4111-8111-111111111111';
const signal = () => new AbortController().signal;

function setup() {
  const nutrition = {
    preferences: vi.fn(async () => []),
    feedback: vi.fn(async (_key: string, preference: string | null) => ({ preference, revision: 1 })),
  };
  const tools = healthSourceTools({} as HealthData, () => nutrition as never, (() => ({})) as never, () => Date.parse('2026-11-21T12:00:00Z'));
  const request = {
    agentPrincipal: { kind: 'jarvis-agent' },
    server: { ownerObjectId: owner, ownerInteractions: { runRequested: async (_kind: string, _summary: string, run: () => Promise<unknown>) => run() } },
  } as unknown as FastifyRequest;
  const preference = (mealKey: string, value: string | null) => tools.find((tool) => tool.name === 'health_nutrition_history')!
    .execute({ operation: 'set_meal_preference', mealKey, preference: value }, request, signal());
  return { nutrition, preference };
}

describe('set_meal_preference', () => {
  it('stores a favorite: key under the bare favourite id that suggestions and health_saved_food read', async () => {
    const { nutrition, preference } = setup();
    const result = await preference('favorite:fav-1', 'dislike');
    expect(nutrition.preferences).toHaveBeenCalledWith(['fav-1'], expect.any(AbortSignal));
    expect(nutrition.feedback).toHaveBeenCalledWith('fav-1', 'dislike', expect.any(AbortSignal), 0n);
    expect(result).toMatchObject({ status: 'committed', mealKey: 'favorite:fav-1', preference: 'dislike' });
  });

  it('keeps a meal: key as given', async () => {
    const { nutrition, preference } = setup();
    await preference('meal:oatmeal', 'like');
    expect(nutrition.feedback).toHaveBeenCalledWith('meal:oatmeal', 'like', expect.any(AbortSignal), 0n);
  });
});
