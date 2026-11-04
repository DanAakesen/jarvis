import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { AuthenticationDenied } from '../../auth/verify.js';
import { ToolFailure, ToolRefusal } from '../../core/tool-registry.js';
import { parseWorkoutCreate, parseWorkoutPatch } from '../gym/workouts.js';
import type { WorkoutEntriesAccess } from '../gym/workouts-store.js';
import { resolveHealthOwner } from '../owner.js';

const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu;

function integerParameter(value: unknown): number | null {
  return typeof value === 'string' && /^\d{1,3}$/u.test(value) ? Number(value) : null;
}

export function workoutRoutes(access: WorkoutEntriesAccess): FastifyPluginAsync {
  return async app => {
    const guard = async (request: FastifyRequest, reply: FastifyReply) => {
      resolveHealthOwner(request);
      if (request.agentPrincipal || request.healthConnectorPrincipal) throw new AuthenticationDenied(403);
      reply.header('Cache-Control', 'no-store');
    };
    const noQuery = async (request: FastifyRequest, reply: FastifyReply) => {
      await guard(request, reply);
      if (Object.keys(request.query as Record<string, unknown>).length) return reply.code(400).send({ error: 'Invalid workout request' });
    };
    const bounded = async <T>(request: FastifyRequest, reply: FastifyReply, work: (signal: AbortSignal) => Promise<T>) => {
      const controller = new AbortController();
      const cancel = () => { controller.abort(); };
      const disconnect = () => { if (!reply.raw.writableEnded) cancel(); };
      request.raw.once('aborted', cancel);
      reply.raw.once('close', disconnect);
      try { return await work(controller.signal); }
      catch (error) {
        if (error instanceof ToolRefusal) return reply.code(400).send({ error: error.message });
        if (error instanceof ToolFailure) return reply.code(503).send({ error: error.message });
        throw error;
      } finally {
        request.raw.off('aborted', cancel);
        reply.raw.off('close', disconnect);
      }
    };

    app.get('/health/workouts', { onRequest: guard }, async (request, reply) => {
      const query = request.query as Record<string, unknown>;
      if (Object.keys(query).some(key => key !== 'days' && key !== 'limit')) return reply.code(400).send({ error: 'Invalid workout request' });
      const days = query.days === undefined ? undefined : integerParameter(query.days);
      const limit = query.limit === undefined ? 50 : integerParameter(query.limit);
      if (days === null || days !== undefined && ![7, 14, 30].includes(days) || limit === null || limit < 1 || limit > 100) {
        return reply.code(400).send({ error: 'Invalid workout request' });
      }
      return bounded(request, reply, signal => access(request).history({ limit, ...(days === undefined ? {} : { days }) }, signal));
    });

    app.post('/health/workouts', { bodyLimit: 2048, onRequest: noQuery }, async (request, reply) => {
      const parsed = parseWorkoutCreate(request.body);
      if (!parsed.ok) return reply.code(400).send({ error: parsed.reason });
      return bounded(request, reply, async signal => {
        const result = await access(request).create(parsed.value, signal);
        return reply.code(result.replayed ? 200 : 201).send(result);
      });
    });

    app.patch('/health/workouts/:id', { bodyLimit: 2048, onRequest: noQuery }, async (request, reply) => {
      const id = (request.params as { id: string }).id;
      if (!uuid.test(id)) return reply.code(400).send({ error: 'Invalid workout id' });
      const parsed = parseWorkoutPatch(request.body);
      if (!parsed.ok) return reply.code(400).send({ error: parsed.reason });
      return bounded(request, reply, async signal => {
        const entry = await access(request).update(id, parsed.patch, signal);
        return entry ? { entry } : reply.code(404).send({ error: 'Workout entry not found.' });
      });
    });

    app.delete('/health/workouts/:id', { onRequest: noQuery }, async (request, reply) => {
      const id = (request.params as { id: string }).id;
      if (!uuid.test(id)) return reply.code(400).send({ error: 'Invalid workout id' });
      return bounded(request, reply, async signal => {
        const entry = await access(request).delete(id, signal);
        return entry ? { entry } : reply.code(404).send({ error: 'Workout entry not found.' });
      });
    });
  };
}
