import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { internalSavedInput, internalSavedInputSchema } from './saved-schema.js';

it('preserves all saved-food HTTP branches, nulls, zero and clear fields before strict domain parsing', async () => {
  const app = Fastify();
  app.post('/synthetic-saved-schema', { schema: { body: internalSavedInputSchema } }, async request => internalSavedInput.parse(request.body));
  try {
    for (const input of [
      { operation: 'lookup_saved', name: 'Synthetic' },
      { operation: 'read_preferences', favoriteIds: ['synthetic'] },
      { operation: 'save_favorite', expectedRevision: '0', name: 'Synthetic', aliases: ['Alias'], sourceIdempotencyKey: 'intake' },
      { operation: 'save_favorite', expectedRevision: '0', name: 'Synthetic', definition: {
        mealName: 'Synthetic', energyKcal: 0, proteinGrams: null, fatGrams: 0, mealType: null,
      } },
      { operation: 'save_plan', expectedRevision: '0', name: 'Synthetic', description: null, entries: [
        { slot: 'breakfast', favoriteId: 'a' }, { slot: 'lunch', favoriteId: 'b' }, { slot: 'dinner', favoriteId: 'c' },
      ] },
      { operation: 'delete_plan', expectedRevision: '1', id: 'synthetic' },
      { operation: 'set_feedback', expectedRevision: '0', favoriteId: 'synthetic', preference: null },
      { operation: 'set_feedback', expectedRevision: '1', favoriteId: 'synthetic', preference: 'dislike' },
    ]) {
      const result = await app.inject({ method: 'POST', url: '/synthetic-saved-schema', payload: input });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toEqual(internalSavedInput.parse(input));
    }
  } finally { await app.close(); }
});
