import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { foodLookupInputSchema, foodLookupSchema } from './lookup-schema.js';

it('retains unknown food amounts and preparation through the actual HTTP validator', async () => {
  const app = Fastify();
  app.post('/synthetic-lookup-schema', { schema: { body: foodLookupInputSchema } }, async request => foodLookupSchema.parse(request.body));
  try {
    for (const component of [
      { name: 'Synthetic food', grams: null, preparationMethod: null },
      { name: 'Synthetic food', grams: 100, preparationMethod: 'boiled' },
    ]) {
      const result = await app.inject({ method: 'POST', url: '/synthetic-lookup-schema', payload: { components: [component] } });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toEqual({ components: [component] });
    }
    expect((await app.inject({ method: 'POST', url: '/synthetic-lookup-schema', payload: {
      components: [{ name: 'Synthetic food', grams: 0, preparationMethod: null }],
    } })).statusCode).toBe(400);
  } finally { await app.close(); }
});
