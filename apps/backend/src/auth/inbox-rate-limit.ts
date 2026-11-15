import type { RateLimitOptions } from '@fastify/rate-limit';
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { inboxCapturePath, inboxCredentialsPath } from './inbox-capture-credential.js';

declare module 'fastify' {
  interface FastifyRequest { inboxCaptureCredentialHash: string | null }
}

function inboxRoute(method: string, url: string | undefined): boolean {
  return url === inboxCapturePath && method === 'POST' ||
    url === inboxCredentialsPath && (method === 'POST' || method === 'GET') ||
    url === `${inboxCredentialsPath}/:id` && method === 'DELETE';
}

/**
 * Same shape as the Watch limiter and installed after it (it registers the rate-limit plugin): a transport-peer budget
 * runs in an early root hook, before authentication can touch SQL, so well-formed unknown tokens cannot reach the
 * database; budgets after authentication are per credential hash for capture and per owner for credential management.
 */
export function installInboxCaptureLimits<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>, ownerObjectId: string,
): void {
  app.decorateRequest('inboxCaptureCredentialHash', null);
  const preAuthOptions: RateLimitOptions = {
    max: 30, timeWindow: 1000, cache: 512, continueExceeding: false, exponentialBackoff: false,
    keyGenerator: request => request.raw.socket.remoteAddress ?? 'unknown-peer',
    errorResponseBuilder: () => Object.assign(new Error('Too many requests'), { statusCode: 429 }),
  };
  app.addHook('onRoute', route => {
    if (inboxRoute(String(route.method), route.url)) {
      route.config = { ...route.config, rateLimit: { ...preAuthOptions } };
    }
  });
  let preAuth: ReturnType<typeof app.rateLimit>;
  app.addHook('onRequest', async (request, reply) => {
    if (!inboxRoute(request.method, request.routeOptions.url)) return;
    await preAuth.call(app, request as Parameters<typeof preAuth>[0], reply as Parameters<typeof preAuth>[1]);
  });
  let capture: ReturnType<typeof app.createRateLimit>;
  let management: ReturnType<typeof app.createRateLimit>;
  app.addHook('onReady', async () => {
    preAuth = app.rateLimit(preAuthOptions);
    capture = app.createRateLimit({
      max: 60, timeWindow: 60_000,
      keyGenerator: request => request.inboxCaptureCredentialHash ?? ownerObjectId,
    });
    management = app.createRateLimit({ max: 12, timeWindow: 60_000, keyGenerator: () => ownerObjectId });
  });
  const enforce = async (limiter: ReturnType<typeof app.createRateLimit>, request: FastifyRequest, reply: FastifyReply) => {
    const result = await limiter(request);
    if (!result.isAllowed && result.isExceeded) {
      reply.header('Retry-After', String(Math.max(1, result.ttlInSeconds)));
      return reply.code(429).send({ error: 'Too many requests' });
    }
  };
  // Authentication has finished before preValidation, so unknown tokens never spend a valid credential's budget.
  app.addHook('preValidation', async (request, reply) => {
    const url = request.routeOptions.url;
    if (!inboxRoute(request.method, url)) return;
    if (url === inboxCapturePath) {
      if (request.inboxCaptureCredentialHash !== null || request.principal?.objectId === ownerObjectId) {
        return enforce(capture, request, reply);
      }
      return;
    }
    if (request.principal?.objectId === ownerObjectId) return enforce(management, request, reply);
  });
}
