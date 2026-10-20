import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { AuthenticationDenied } from '../../auth/verify.js';
import { ToolFailure, ToolRefusal } from '../../core/tool-registry.js';
import { parseTrainingTargetsPatch, presentTrainingTargets } from '../training/targets.js';
import type { TrainingTargetsAccess } from '../training/targets-store.js';
import { resolveDailyOwner } from '../owner.js';

export function trainingTargetsRoutes(access: TrainingTargetsAccess): FastifyPluginAsync {
  return async app => {
    const guard = async (request: FastifyRequest, reply: FastifyReply) => {
      resolveDailyOwner(request);
      if (request.agentPrincipal || request.dailyConnectorPrincipal) throw new AuthenticationDenied(403);
      reply.header('Cache-Control', 'no-store');
      if (Object.keys(request.query as Record<string, unknown>).length) return reply.code(400).send({ error: 'Invalid training targets request' });
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

    app.get('/daily/training-targets', { onRequest: guard }, async (request, reply) =>
      bounded(request, reply, async signal => presentTrainingTargets(await access(request).read(signal))));

    app.patch('/daily/training-targets', { bodyLimit: 1024, onRequest: guard }, async (request, reply) => {
      const parsed = parseTrainingTargetsPatch(request.body);
      if (!parsed.ok) return reply.code(400).send({ error: parsed.reason });
      return bounded(request, reply, async signal => presentTrainingTargets(await access(request).write(parsed.patch, signal)));
    });
  };
}
