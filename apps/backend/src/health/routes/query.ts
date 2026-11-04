import { healthQuerySchema, isHealthQuery } from '@jarvis/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { ToolFailure, ToolRefusal } from '../../core/tool-registry.js';
import { resolveHealthOwner } from '../owner.js';
import type { HealthQueryService } from '../query.js';

export function healthQueryRoutes(service: Pick<HealthQueryService, 'query'>): FastifyPluginAsync {
  return async app => {
    app.post('/health/query', {
      config: { jarvisAgent: true },
      bodyLimit: 16 * 1024,
      onRequest: async (request, reply) => {
        resolveHealthOwner(request);
        reply.header('Cache-Control', 'no-store');
        if (Object.keys(request.query as Record<string, unknown>).length) return reply.code(400).send({ error: 'Invalid Health query' });
      },
      preValidation: async (request, reply) => {
        if (!isHealthQuery(request.body)) return reply.code(400).send({ error: 'Invalid Health query' });
      },
      schema: { body: healthQuerySchema },
    }, async (request, reply) => {
      const controller = new AbortController();
      const cancel = () => { controller.abort(); };
      const disconnect = () => { if (!reply.raw.writableEnded) cancel(); };
      request.raw.once('aborted', cancel);
      reply.raw.once('close', disconnect);
      try { return await service.query(request.body, request, controller.signal); }
      catch (error) {
        if (error instanceof ToolRefusal) return reply.code(400).send({ error: error.message });
        if (error instanceof ToolFailure) return reply.code(503).send({ error: error.message });
        throw error;
      } finally {
        request.raw.off('aborted', cancel);
        reply.raw.off('close', disconnect);
      }
    });
  };
}
