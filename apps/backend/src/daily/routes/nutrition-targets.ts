import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { AuthenticationDenied } from '../../auth/verify.js';
import { ToolFailure, ToolRefusal } from '../../core/tool-registry.js';
import { parseNutritionTargetsPatch, presentNutritionTargets } from '../nutrition/targets.js';
import type { NutritionTargetsAccess } from '../nutrition/targets-store.js';
import { resolveDailyOwner } from '../owner.js';

/**
 * Settings route for the owner's nutrition targets. Registered only when Daily is composed.
 * It carries no `jarvisAgent` marker: the hosted agent changes targets through the approved
 * chat/voice tool instead, and a direct write here is the signed-in owner's own edit.
 */
export function nutritionTargetsRoutes(access: NutritionTargetsAccess): FastifyPluginAsync {
  return async app => {
    const guard = async (request: FastifyRequest, reply: FastifyReply) => {
      resolveDailyOwner(request);
      if (request.agentPrincipal || request.dailyConnectorPrincipal) throw new AuthenticationDenied(403);
      reply.header('Cache-Control', 'no-store');
      if (Object.keys(request.query as Record<string, unknown>).length) return reply.code(400).send({ error: 'Invalid nutrition targets request' });
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

    app.get('/daily/nutrition-targets', { onRequest: guard }, async (request, reply) =>
      bounded(request, reply, async signal => presentNutritionTargets(await access(request).read(signal))));

    app.patch('/daily/nutrition-targets', { bodyLimit: 1024, onRequest: guard }, async (request, reply) => {
      // No body schema: Fastify's Ajv would coerce or strip fields before this strict parser saw them.
      const parsed = parseNutritionTargetsPatch(request.body);
      if (!parsed.ok) return reply.code(400).send({ error: parsed.reason });
      return bounded(request, reply, async signal => presentNutritionTargets(await access(request).write(parsed.patch, signal)));
    });
  };
}
