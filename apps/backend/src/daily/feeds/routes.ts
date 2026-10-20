import { z } from 'zod';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { AuthenticationDenied } from '../../auth/verify.js';
import { ToolFailure, ToolRefusal } from '../../core/tool-registry.js';
import { validateCalendarRange } from './calendars.js';
import type { DailyFeedService } from './service.js';
import { resolveDailyBrowserOwner } from '../owner.js';

const range = z.object({ from: z.string().max(64), to: z.string().max(64) }).strict().refine(value => {
  try { validateCalendarRange(value); return true; } catch { return false; }
});
const id = z.object({ id: z.string().min(1).max(256) }).strict();
const restore = z.object({ type: z.enum(['thread', 'order']), key: z.string().min(1).max(256) }).strict();
const json = (value: unknown) => value !== null && typeof value === 'object' && !Array.isArray(value);

function body<T>(schema: z.ZodType<T>, request: FastifyRequest, reply: FastifyReply): T | undefined {
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    void reply.code(400).send({ error: 'Invalid Health feed request' });
    return undefined;
  }
  return parsed.data;
}

function signal(request: FastifyRequest, reply: FastifyReply) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const disconnect = () => { if (!reply.raw.writableEnded) cancel(); };
  request.raw.once('aborted', cancel);
  reply.raw.once('close', disconnect);
  return {
    signal: controller.signal,
    cleanup: () => { request.raw.off('aborted', cancel); reply.raw.off('close', disconnect); },
  };
}

async function execute<T>(request: FastifyRequest, reply: FastifyReply, work: (signal: AbortSignal) => Promise<T>) {
  const abort = signal(request, reply);
  try { return await work(abort.signal); }
  catch (error) {
    if (error instanceof ToolRefusal) return reply.code(400).send({ error: error.message });
    if (error instanceof ToolFailure) return reply.code(503).send({ error: error.message });
    if (error instanceof AuthenticationDenied) return reply.code(error.statusCode).send({ error: 'Health feed access denied' });
    throw error;
  } finally { abort.cleanup(); }
}

export function dailyFeedRoutes(service: Pick<DailyFeedService, 'refreshFromBrowser' | 'hideThread' | 'receiveOrder' | 'restore'>): FastifyPluginAsync {
  return async app => {
    const config = {
      bodyLimit: 16 * 1024,
      onRequest: async (request: FastifyRequest, reply: FastifyReply) => {
        resolveDailyBrowserOwner(request);
        reply.header('Cache-Control', 'no-store');
        if (Object.keys(request.query as Record<string, unknown>).length) {
          return reply.code(400).send({ error: 'Invalid Health feed request' });
        }
      },
      preValidation: async (request: FastifyRequest, reply: FastifyReply) => {
        if (!json(request.body)) return reply.code(400).send({ error: 'Invalid Health feed request' });
      },
    };
    app.post('/daily/feeds/refresh', config, async (request, reply) => {
      const input = body(range, request, reply);
      if (!input) return;
      return execute(request, reply, signal => service.refreshFromBrowser(request, input, signal));
    });
    app.post('/daily/feeds/hide', config, async (request, reply) => {
      const input = body(id, request, reply);
      if (!input) return;
      return execute(request, reply, async signal => ({
        status: await service.hideThread(request, input.id, signal) ? 'hidden' : 'unchanged',
      }));
    });
    app.post('/daily/feeds/receive', config, async (request, reply) => {
      const input = body(id, request, reply);
      if (!input) return;
      return execute(request, reply, async signal => ({
        status: await service.receiveOrder(request, input.id, signal) ? 'received' : 'unchanged',
      }));
    });
    app.post('/daily/feeds/restore', config, async (request, reply) => {
      const input = body(restore, request, reply);
      if (!input) return;
      return execute(request, reply, async signal => ({
        status: await service.restore(request, input.type, input.key, signal) ? 'restored' : 'unchanged',
      }));
    });
  };
}
