import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { HealthPayloadError } from '../health/value.js';
import { resolveHealthBrowserOwner } from '../owner.js';
import { parseDeviceSync } from '../sync/device-sync.js';
import type { DeviceSyncAccess } from '../sync/device-sync-store.js';

/** Dan-only: the browser/app user token, never the agent, connector or any other principal. */
export function deviceSyncRoutes(access: DeviceSyncAccess): FastifyPluginAsync {
  return async app => {
    const guard = async (request: FastifyRequest, reply: FastifyReply) => {
      resolveHealthBrowserOwner(request);
      reply.header('Cache-Control', 'no-store');
      if (Object.keys(request.query as Record<string, unknown>).length) return reply.code(400).send({ error: 'Invalid Health sync request.' });
    };

    app.post('/health/sync', { bodyLimit: 8 * 1024 * 1024, onRequest: guard }, async (request, reply) => {
      const parsed = parseDeviceSync(request.body);
      if (!parsed.ok) return reply.code(400).send({ error: parsed.reason });
      const controller = new AbortController();
      const cancel = () => { controller.abort(); };
      const disconnect = () => { if (!reply.raw.writableEnded) cancel(); };
      request.raw.once('aborted', cancel);
      reply.raw.once('close', disconnect);
      try {
        const result = await access(request).apply(parsed.value, controller.signal);
        return { ...result, anchor: parsed.value.anchor };
      } catch (error) {
        if (error instanceof HealthPayloadError) return reply.code(400).send({ error: 'Health sync data was rejected.' });
        return reply.code(503).send({ error: 'Health sync is unavailable.' });
      } finally {
        request.raw.off('aborted', cancel);
        reply.raw.off('close', disconnect);
      }
    });
  };
}
