import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';
import { localWebOrigin, type BackendConfig } from '../config.js';
import {
  AuthenticationDenied, createTokenVerifier, isAgentPrincipal, isRunnerPrincipal,
  isPcBridgePrincipal, isPhoneEventGridPrincipal,
  type AgentPrincipal, type PcBridgePrincipal, type PhoneEventGridPrincipal, type RunnerPrincipal,
  type TokenVerifier, type UserPrincipal,
} from './verify.js';

declare module 'fastify' {
  interface FastifyRequest {
    principal: UserPrincipal | null;
    agentPrincipal: AgentPrincipal | null;
    runnerPrincipal: RunnerPrincipal | null;
    pcBridgePrincipal: PcBridgePrincipal | null;
    phoneEventGridPrincipal: PhoneEventGridPrincipal | null;
  }
  // Service identities may call only the routes that explicitly opt in.
  interface FastifyContextConfig {
    jarvisAgent?: boolean;
    jarvisRunner?: boolean;
    jarvisPcBridge?: boolean;
    githubWebhook?: boolean;
    teamsBot?: boolean;
    teamsAudio?: boolean;
    jarvisPhoneEvents?: boolean;
    jarvisPhoneMedia?: boolean;
    jarvisPhoneCallback?: boolean;
  }
}

const VOICE_PROTOCOL = 'jarvis.voice.v1';
const VOICE_AUTH_PREFIX = 'jarvis.auth.';
const VOICE_ROUTES = new Set(['/voice', '/voice/da']);

function voiceWebsocketToken(request: FastifyRequest): string | undefined {
  if (request.method !== 'GET' || !VOICE_ROUTES.has(request.routeOptions.url ?? '') ||
      request.headers.upgrade?.toLowerCase() !== 'websocket') return undefined;
  const rawHeaders = request.raw.rawHeaders;
  const duplicates = rawHeaders.filter((_value, index) =>
    index % 2 === 0 && rawHeaders[index]?.toLowerCase() === 'sec-websocket-protocol').length > 1;
  const header = request.headers['sec-websocket-protocol'];
  if (duplicates || typeof header !== 'string' || header.length > 16_384) return undefined;
  const protocols = header.split(',').map((protocol) => protocol.trim());
  if (protocols.length !== 2 || new Set(protocols).size !== 2 || !protocols.includes(VOICE_PROTOCOL)) return undefined;
  const tokenProtocol = protocols.find((protocol) => protocol.startsWith(VOICE_AUTH_PREFIX));
  const token = tokenProtocol?.slice(VOICE_AUTH_PREFIX.length);
  return token && /^[\w-]+\.[\w-]+\.[\w-]+$/u.test(token) ? token : undefined;
}

export function installAuthentication<Logger extends FastifyBaseLogger>(app: FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>, config: BackendConfig, verify: TokenVerifier = createTokenVerifier(config.auth)) {
  app.decorateRequest('principal', null);
  app.decorateRequest('agentPrincipal', null);
  app.decorateRequest('runnerPrincipal', null);
  app.decorateRequest('pcBridgePrincipal', null);
  app.decorateRequest('phoneEventGridPrincipal', null);
  app.addHook('onRequest', async (request, reply) => {
    if (request.routeOptions.url === '/health' && ['GET', 'HEAD'].includes(request.method)) return;
    if (request.routeOptions.config?.githubWebhook === true) return;
    if (request.routeOptions.config?.teamsBot === true || request.routeOptions.config?.teamsAudio === true) return;
    if (request.method === 'GET' && request.routeOptions.url === '/phone/media' &&
        request.routeOptions.config?.jarvisPhoneMedia === true) return;
    if (request.method === 'POST' && request.routeOptions.url === '/phone/callback' &&
        request.routeOptions.config?.jarvisPhoneCallback === true) return;
    // Only the CORS plugin's generated OPTIONS route may run without a token.
    // Explicit business OPTIONS endpoints still require authentication.
    const origin = request.headers.origin;
    if (request.method === 'OPTIONS' && request.routeOptions.url === '*' &&
      (origin === localWebOrigin || (config.staticWebAppOrigin !== undefined && origin === config.staticWebAppOrigin))) return;
    const header = request.headers.authorization;
    const rawHeaders = request.raw.rawHeaders;
    const duplicate = rawHeaders.filter((_value, index) => index % 2 === 0 && rawHeaders[index]?.toLowerCase() === 'authorization').length > 1;
    const match = typeof header === 'string' && header.length <= 16_384 ? /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(header) : null;
    // Logged on denial so a refused request can be traced without logging any credential.
    let reason = 'invalid_token';
    try {
      const token = header === undefined && !duplicate ? voiceWebsocketToken(request) : match?.[1];
      if (duplicate) reason = 'duplicate_authorization';
      else if (!token) reason = header === undefined ? 'missing_token' : 'malformed_authorization';
      if (duplicate || !token) throw new AuthenticationDenied(401);
      const principal = await verify(token);
      reason = 'principal_not_allowed_on_route';
      if (isAgentPrincipal(principal)) {
        if (request.routeOptions.config?.jarvisAgent !== true) throw new AuthenticationDenied(403);
        request.agentPrincipal = principal;
      } else if (isRunnerPrincipal(principal)) {
        if (request.routeOptions.config?.jarvisRunner !== true) throw new AuthenticationDenied(403);
        request.runnerPrincipal = principal;
      } else if (isPcBridgePrincipal(principal)) {
        if (request.routeOptions.config?.jarvisPcBridge !== true) throw new AuthenticationDenied(403);
        request.pcBridgePrincipal = principal;
      } else if (isPhoneEventGridPrincipal(principal)) {
        if (request.method !== 'POST' || request.routeOptions.url !== '/phone/events' ||
            request.routeOptions.config?.jarvisPhoneEvents !== true) {
          throw new AuthenticationDenied(403);
        }
        request.phoneEventGridPrincipal = principal;
      } else {
        if (request.routeOptions.config?.jarvisRunner === true ||
            request.routeOptions.config?.jarvisPcBridge === true ||
            request.routeOptions.config?.jarvisPhoneEvents === true) throw new AuthenticationDenied(403);
        request.principal = principal;
      }
    } catch (error) {
      const statusCode = error instanceof AuthenticationDenied ? error.statusCode : 401;
      const path = (request.raw.url ?? '').split('?')[0]?.slice(0, 200);
      request.log.warn({ statusCode, reason, method: request.method, route: path }, 'request.auth_denied');
      // Denials precede the CORS hook; let the approved browser read 401/403.
      if (origin === localWebOrigin || (config.staticWebAppOrigin !== undefined && origin === config.staticWebAppOrigin)) {
        reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin');
      }
      if (statusCode === 401) reply.header('WWW-Authenticate', 'Bearer');
      return reply.code(statusCode).send({ error: statusCode === 401 ? 'Unauthorized' : 'Forbidden' });
    }
  });
}
