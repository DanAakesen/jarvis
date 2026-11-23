import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { ToolFailure, ToolRefusal } from '../../core/tool-registry.js';
import { prepareMeal, resolveNutrients } from '../nutrition/model.js';
import { resolveHealthBrowserOwner } from '../owner.js';
import type { NutritionStore } from '../nutrition/store.js';

const operationId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;

export function manualMealRoutes(access: (request: FastifyRequest) => Pick<NutritionStore, 'log'>): FastifyPluginAsync {
  return async app => {
    app.post<{ Body: { idempotencyKey?: unknown; occurredAt?: unknown; energyKcal?: unknown; proteinGrams?: unknown } }>('/health/meals', {
      bodyLimit: 1024,
      onRequest: async (request, reply) => {
        resolveHealthBrowserOwner(request);
        reply.header('Cache-Control', 'no-store');
        if (Object.keys(request.query as object).length) return reply.code(400).send({ error: 'Invalid meal request' });
      },
    }, async (request, reply) => {
      const body = request.body;
      if (!body || typeof body !== 'object' || Object.keys(body).some(key => !['idempotencyKey', 'occurredAt', 'energyKcal', 'proteinGrams'].includes(key)) ||
          typeof body.idempotencyKey !== 'string' || !operationId.test(body.idempotencyKey) ||
          typeof body.occurredAt !== 'string' || typeof body.energyKcal !== 'number' || !Number.isFinite(body.energyKcal) ||
          body.energyKcal <= 0 || (body.proteinGrams !== undefined && typeof body.proteinGrams !== 'number')) return reply.code(400).send({ error: 'Invalid meal request' });
      const id = 'manual:' + body.idempotencyKey.toLowerCase();
      let meal;
      try {
        const exact = { energyKcal: body.energyKcal, ...(body.proteinGrams === undefined ? {} : { proteinGrams: body.proteinGrams }) };
        const { values, confidence, provenance } = resolveNutrients(exact, null);
        meal = prepareMeal({ id, idempotencyKey: id, mealName: body.proteinGrams === undefined ? 'Manual kcal' : 'Manual meal', mealType: null, captureMethod: 'text',
          components: [], occurredAt: body.occurredAt, confidence, provenance, ...values }, new Date().toISOString());
      } catch (error) {
        if (error instanceof TypeError) return reply.code(400).send({ error: 'Invalid meal time or nutrient quantity' });
        throw error;
      }
      try {
        await access(request).log(meal, { intent: 'log-intake', explicit: true, proposalRequired: false, estimateAccepted: false },
          AbortSignal.timeout(30_000));
      } catch (error) {
        if (error instanceof ToolRefusal) return reply.code(409).send({ error: 'Meal submission conflicts with the saved entry' });
        if (error instanceof ToolFailure) return reply.code(503).send({ error: 'Meal save could not be confirmed' });
        throw error;
      }
      return { idempotencyKey: body.idempotencyKey, energyKcal: meal.energyKcal, proteinGrams: meal.proteinGrams, mealDate: meal.mealDate };
    });
  };
}
