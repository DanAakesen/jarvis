import { dailyQuerySchema, isDailyQuery } from '@jarvis/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { ToolFailure, ToolRefusal } from '../../core/tool-registry.js';
import { resolveDailyOwner } from '../owner.js';
import type { DailyQueryService } from '../query.js';

export function dailyQueryRoutes(service: Pick<DailyQueryService, 'query'>): FastifyPluginAsync {
  return async app => {
    app.post('/daily/query', {
      config: { jarvisAgent: true },
      bodyLimit: 16 * 1024,
      onRequest: async (request, reply) => {
        resolveDailyOwner(request);
        reply.header('Cache-Control', 'no-store');
        if (Object.keys(request.query as Record<string, unknown>).length) return reply.code(400).send({ error: 'Invalid Health query' });
      },
      preValidation: async (request, reply) => {
        if (!isDailyQuery(request.body)) return reply.code(400).send({ error: 'Invalid Health query' });
      },
      schema: { body: dailyQuerySchema },
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
