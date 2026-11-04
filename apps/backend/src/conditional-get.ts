import { createHash } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';

/** GET routes the on-device cache revalidates with If-None-Match. Everything else is left untouched. */
export const cacheableGetRoutes: ReadonlySet<string> = new Set([
  '/status',
  '/settings',
  '/now',
  '/usage',
  '/notes',
  '/notes/tree',
  '/vault/tasks',
  '/factory/projects',
  '/factory/board',
  '/daily/capabilities',
  '/daily/training-targets',
  '/daily/nutrition-targets',
  '/proactive/status',
  '/proactive/items',
  '/proactive/runs',
]);

function matches(header: string | string[] | undefined, etag: string): boolean {
  if (header === undefined) return false;
  const value = Array.isArray(header) ? header.join(',') : header;
  return value.split(',').some((candidate) => {
    const trimmed = candidate.trim();
    return trimmed === '*' || trimmed === etag || trimmed === `W/${etag}`;
  });
}

/**
 * Adds a strong ETag to successful responses of the cacheable GET routes and answers 304 when the client already
 * holds that exact body. `Cache-Control: private, no-cache` keeps shared caches out and forces revalidation, so the
 * client always decides freshness itself. A Cache-Control a route already set (for example `no-store`) is kept.
 */
export function installConditionalGet<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>,
): void {
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.method !== 'GET' || reply.statusCode !== 200) return payload;
    const route = request.routeOptions.url;
    if (route === undefined || !cacheableGetRoutes.has(route)) return payload;
    if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload;
    const etag = `"${createHash('sha256').update(payload).digest('base64url').slice(0, 27)}"`;
    reply.header('ETag', etag);
    if (reply.getHeader('cache-control') === undefined) reply.header('Cache-Control', 'private, no-cache');
    if (!matches(request.headers['if-none-match'], etag)) return payload;
    reply.code(304);
    reply.removeHeader('content-length');
    reply.removeHeader('content-type');
    return '';
  });
}
