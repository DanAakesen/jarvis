import rateLimit, { type RateLimitOptions } from '@fastify/rate-limit';
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { watchCredentialPath, watchTranscriptionPath } from './watch-credential.js';

declare module 'fastify' {
  interface FastifyRequest { watchCredentialHash: string | null }
}

function watchRoute(method: string, url: string | undefined): boolean {
  return url === watchTranscriptionPath && method === 'POST' ||
    url === watchCredentialPath && (method === 'POST' || method === 'DELETE');
}

export function installWatchRateLimits<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>, ownerObjectId: string,
): void {
  app.register(rateLimit, { global: false, cache: 512, skipOnError: false });
  app.decorateRequest('watchCredentialHash', null);
  const preAuthOptions: RateLimitOptions = {
    max: 30, timeWindow: 1000, cache: 512, continueExceeding: false, exponentialBackoff: false,
    // Use the transport peer, never caller-controlled Forwarded/X-Forwarded-For.
    keyGenerator: request => request.raw.socket.remoteAddress ?? 'unknown-peer',
    errorResponseBuilder: () => Object.assign(new Error('Too many requests'), { statusCode: 429 }),
  };
  app.addHook('onRoute', route => {
    if (watchRoute(String(route.method), route.url)) {
      route.config = { ...route.config, rateLimit: { ...preAuthOptions } };
    }
  });
  let issuePreAuth: ReturnType<typeof app.rateLimit>;
  let revokePreAuth: ReturnType<typeof app.rateLimit>;
  let transcribePreAuth: ReturnType<typeof app.rateLimit>;
  // A route onRequest limiter runs after root auth. Install this root guard first
  // so even well-formed unknown credentials cannot reach SQL without a budget.
  app.addHook('onRequest', async (request, reply) => {
    if (!watchRoute(request.method, request.routeOptions.url)) return;
    const guard = request.routeOptions.url === watchTranscriptionPath ? transcribePreAuth
      : request.method === 'POST' ? issuePreAuth : revokePreAuth;
    await guard.call(app, request as Parameters<typeof guard>[0], reply as Parameters<typeof guard>[1]);
  });
  let issuance: ReturnType<typeof app.createRateLimit>;
  let transcription: ReturnType<typeof app.createRateLimit>;
  app.addHook('onReady', async () => {
    issuePreAuth = app.rateLimit(preAuthOptions);
    revokePreAuth = app.rateLimit(preAuthOptions);
    transcribePreAuth = app.rateLimit(preAuthOptions);
    const issueOptions: RateLimitOptions = { max: 6, timeWindow: 60_000, cache: 1, keyGenerator: () => ownerObjectId };
    const transcriptionOptions: RateLimitOptions = { max: 30, timeWindow: 60_000, cache: 1,
      keyGenerator: request => request.watchCredentialHash! };
    issuance = app.createRateLimit(issueOptions);
    transcription = app.createRateLimit(transcriptionOptions);
  });
  const enforce = async (limiter: ReturnType<typeof app.createRateLimit>, request: FastifyRequest, reply: FastifyReply) => {
    const result = await limiter(request);
    if (!result.isAllowed && result.isExceeded) {
      reply.header('Retry-After', String(Math.max(1, result.ttlInSeconds)));
      return reply.code(429).send({ error: 'Too many requests' });
    }
  };
  // Authentication has finished before preValidation. Unknown tokens never
  // consume the valid credential's minute budget; DELETE has its own IP budget.
  app.addHook('preValidation', async (request, reply) => {
    if (request.method !== 'POST') return;
    if (request.routeOptions.url === watchCredentialPath && request.principal?.objectId === ownerObjectId) {
      return enforce(issuance, request, reply);
    }
    if (request.routeOptions.url === watchTranscriptionPath && request.watchCredentialHash !== null) {
      return enforce(transcription, request, reply);
    }
  });
}
