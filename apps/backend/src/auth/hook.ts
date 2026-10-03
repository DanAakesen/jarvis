import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { localWebOrigin, type BackendConfig } from '../config.js';
import { AuthenticationDenied, createTokenVerifier, type TokenVerifier, type UserPrincipal } from './verify.js';

declare module 'fastify' {
  interface FastifyRequest { principal: UserPrincipal | null }
}

export function installAuthentication<Logger extends FastifyBaseLogger>(app: FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>, config: BackendConfig, verify: TokenVerifier = createTokenVerifier(config.auth)) {
  app.decorateRequest('principal', null);
  app.addHook('onRequest', async (request, reply) => {
    if (request.routeOptions.url === '/health' && ['GET', 'HEAD'].includes(request.method)) return;
    // Only the CORS plugin's generated OPTIONS route may run without a token.
    // Explicit business OPTIONS endpoints still require authentication.
    const origin = request.headers.origin;
    if (request.method === 'OPTIONS' && request.routeOptions.url === '*' &&
      (origin === localWebOrigin || (config.staticWebAppOrigin !== undefined && origin === config.staticWebAppOrigin))) return;
    const header = request.headers.authorization;
    const rawHeaders = request.raw.rawHeaders;
    const duplicate = rawHeaders.filter((_value, index) => index % 2 === 0 && rawHeaders[index]?.toLowerCase() === 'authorization').length > 1;
    const match = typeof header === 'string' && header.length <= 16_384 ? /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(header) : null;
    try {
      if (duplicate || !match) throw new AuthenticationDenied(401);
      request.principal = await verify(match[1]!);
    } catch (error) {
      const statusCode = error instanceof AuthenticationDenied ? error.statusCode : 401;
      request.log.warn({ statusCode }, 'request.auth_denied');
      // Denials precede the CORS hook; let the approved browser read 401/403.
      if (origin === localWebOrigin || (config.staticWebAppOrigin !== undefined && origin === config.staticWebAppOrigin)) {
        reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin');
      }
      if (statusCode === 401) reply.header('WWW-Authenticate', 'Bearer');
      return reply.code(statusCode).send({ error: statusCode === 401 ? 'Unauthorized' : 'Forbidden' });
    }
  });
}
