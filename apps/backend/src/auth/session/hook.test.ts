import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import type { LightMyRequestResponse } from 'fastify';
import WebSocket from 'ws';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { coreModule } from '../../core/index.js';
import type { UsageStore } from '../../core/usage.js';
import { dailyMcpPath } from '../../daily/mcp/paths.js';
import { dailyMcpRoutes } from '../../daily/mcp/routes.js';
import type { NutritionExportCredentialVerifier, NutritionExportDevice } from '../../daily/nutrition-export/auth.js';
import { registerNutritionExportRoutes } from '../../daily/nutrition-export/routes.js';
import { createLogger } from '../../logging.js';
import type { BackendModule } from '../../modules.js';
import { AuthenticationDenied, dailyNutritionScopes, type TokenVerifier } from '../verify.js';
import { InMemoryOwnerSessionStore } from './memory-store.js';
import { OwnerSessionService } from './service.js';
import type { OwnerSessionRecord } from './store.js';
import {
  generateOwnerSessionCredential, hashOwnerSessionSecret, ownerSessionTokenPrefix, parseOwnerSessionToken,
} from './token.js';

const origin = 'https://fixture.azurestaticapps.net';
const config = loadConfig({ STATIC_WEB_APP_ORIGIN: origin, JARVIS_OWNER_SESSION_ENABLED: 'true' });
const switchOffConfig = loadConfig({ STATIC_WEB_APP_ORIGIN: origin });
const owner = config.auth.ownerObjectId;
const tenantId = config.auth.tenantId;
const strangerObjectId = '00000000-0000-4000-8000-000000000001';
const connectorClientId = '44444444-4444-4444-8444-444444444444';
const connectorHost = 'nutrition.example.test';
const start = Date.parse('2026-10-22T12:00:00.000Z');
const minute = 60_000;
const day = 24 * 60 * minute;
const leakMarker = 'marker-secret-connection';

// Built from parts so no test line looks like a credential.
const bearer = (value: string) => ['Bearer', value].join(' ');
const auth = (token: string) => ({ authorization: bearer(token) });
const entraOwner = 'eyJ.entra.owner';

const ownerPrincipal = { objectId: owner, tenantId, displayName: 'Test Owner' };
const entraPrincipals: Record<string, Awaited<ReturnType<TokenVerifier>>> = {
  [entraOwner]: ownerPrincipal,
  'eyJ.entra.agent': { kind: 'jarvis-agent', objectId: strangerObjectId, tenantId },
  'eyJ.entra.runner': { kind: 'jarvis-runner', objectId: strangerObjectId, tenantId },
  'eyJ.entra.bridge': { kind: 'jarvis-pc-bridge', objectId: strangerObjectId, tenantId },
  'eyJ.entra.phone': { kind: 'jarvis-phone-event-grid', objectId: strangerObjectId, tenantId },
  'eyJ.entra.deploy': { kind: 'jarvis-deploy', objectId: strangerObjectId, tenantId },
  'eyJ.entra.connector': {
    kind: 'jarvis-daily-connector', objectId: owner, tenantId, clientId: connectorClientId, scopes: [dailyNutritionScopes.read],
  },
};
const noServicePrincipals = { agent: null, runner: null, bridge: null, phone: null, deploy: null, connector: null };

interface FixtureOptions {
  readonly enabled?: boolean;
  readonly modules?: readonly BackendModule[];
  readonly usageStore?: UsageStore;
  readonly nutritionExportAuth?: NutritionExportCredentialVerifier;
}

const apps: ReturnType<typeof buildApp>[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
// The first app built in a worker loads every route module; keep that one-off cost out of the first test's timeout.
beforeAll(async () => { await fixture().app.ready(); });

function fixture({ enabled = true, ...options }: FixtureOptions = {}) {
  let current = start;
  const chunks: string[] = [];
  const output = new Writable({ write(chunk: Buffer, _encoding, done) { chunks.push(chunk.toString()); done(); } });
  const store = new InMemoryOwnerSessionStore();
  const service = new OwnerSessionService({ store, ownerObjectId: owner, tenantId, now: () => new Date(current) });
  const verifyEntra = vi.fn<TokenVerifier>(async (token) => {
    const principal = entraPrincipals[token];
    if (!principal) throw new AuthenticationDenied(401);
    return principal;
  });
  const settings = enabled ? config : switchOffConfig;
  const app = buildApp(settings, createLogger(settings, undefined, output), {
    auth: verifyEntra, ownerSessions: service, modules: [coreModule], ...options,
  });
  apps.push(app);
  const executed = vi.fn();
  app.get('/probe', async (request) => {
    executed();
    return {
      principal: request.principal,
      agent: request.agentPrincipal,
      runner: request.runnerPrincipal,
      bridge: request.pcBridgePrincipal,
      phone: request.phoneEventGridPrincipal,
      deploy: request.deployPrincipal,
      connector: request.dailyConnectorPrincipal,
      ownerSession: request.ownerSession,
    };
  });
  return {
    app, store, service, verifyEntra, executed,
    advance: (ms: number) => { current += ms; },
    logText: () => chunks.join(''),
    records: () => chunks.join('').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
type Fixture = ReturnType<typeof fixture>;

// Creates a session over HTTP and moves the clock on, so a run of creates stays inside the create limits.
async function mint(f: Fixture): Promise<string> {
  const response = await f.app.inject({ method: 'POST', url: '/auth/session', headers: auth(entraOwner) });
  expect(response.statusCode).toBe(201);
  f.advance(15_000);
  return response.json<{ token: string }>().token;
}

// Writes a row straight into the store, for states the routes cannot produce.
async function insertSession(f: Fixture, overrides: Partial<OwnerSessionRecord> = {}): Promise<string> {
  const credential = generateOwnerSessionCredential();
  await f.store.create({
    record: {
      sessionId: credential.sessionId, secretHash: credential.secretHash, ownerObjectId: owner, displayName: 'Test Owner',
      deviceLabel: null, createdAt: new Date(start), lastUsedAt: new Date(start),
      idleExpiresAt: new Date(start + 10 * day), absoluteExpiresAt: new Date(start + 30 * day), revokedAt: null,
      ...overrides,
    },
    maxActive: 10,
    purgeBefore: new Date(start - 30 * day),
  });
  return credential.token;
}

const meStatus = async (f: Fixture, token: string) => (await f.app.inject({ url: '/me', headers: auth(token) })).statusCode;
const revokeCurrent = (f: Fixture, token: string) => f.app.inject({ method: 'DELETE', url: '/auth/session', headers: auth(token) });
const sessionIdOf = (token: string) => parseOwnerSessionToken(token)?.sessionId ?? '';
const prefixOf = (token: string) => sessionIdOf(token).slice(0, 8);
const entries = (f: Fixture, msg: string) => f.records().filter((record) => record.msg === msg);

function expectUnauthorized(f: Fixture, response: LightMyRequestResponse) {
  expect(response.statusCode).toBe(401);
  expect(response.json()).toEqual({ error: 'Unauthorized' });
  expect(response.headers['www-authenticate']).toBe('Bearer');
  expect(f.executed).not.toHaveBeenCalled();
}

type VoiceOutcome =
  | { readonly opened: true; readonly message: unknown }
  | { readonly opened: false; readonly statusCode: number; readonly retryAfter: string | undefined };

async function connectVoice(f: Fixture, token: string): Promise<VoiceOutcome> {
  await f.app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = f.app.server.address() as AddressInfo;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/voice`, ['jarvis.voice.v1', `jarvis.auth.${token}`], { headers: { origin } });
  sockets.push(socket);
  return await new Promise<VoiceOutcome>((resolve, reject) => {
    socket.on('error', reject);
    socket.once('message', (data) => resolve({ opened: true, message: JSON.parse(data.toString()) as unknown }));
    socket.once('unexpected-response', (_request, response) => {
      response.resume();
      resolve({ opened: false, statusCode: response.statusCode ?? 0, retryAfter: response.headers['retry-after'] });
    });
  });
}

describe('owner session tokens in the authentication hook', () => {
  describe('valid sessions', () => {
    it('authenticate as the owner without consulting Entra and expose the session context', async () => {
      const f = fixture();
      const token = await mint(f);
      const entraCalls = f.verifyEntra.mock.calls.length;
      const response = await f.app.inject({ url: '/probe', headers: auth(token) });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        principal: ownerPrincipal, ...noServicePrincipals, ownerSession: { id: sessionIdOf(token), prefix: prefixOf(token) },
      });
      expect(f.verifyEntra).toHaveBeenCalledTimes(entraCalls);
      expect((await f.app.inject({ url: '/me', headers: auth(token) })).json()).toEqual({ name: 'Test Owner' });
    });

    it('leave ownerSession empty for an Entra owner token, which never reaches the session service', async () => {
      const f = fixture();
      const verify = vi.spyOn(f.service, 'verify');
      const find = vi.spyOn(f.store, 'find');
      const response = await f.app.inject({ url: '/probe', headers: auth(entraOwner) });
      expect(response.json()).toEqual({ principal: ownerPrincipal, ...noServicePrincipals, ownerSession: null });
      for (const headers of [{}, auth('eyJ.entra.unknown')]) {
        expect((await f.app.inject({ url: '/probe', headers })).statusCode).toBe(401);
      }
      expect((await f.app.inject({ url: '/health' })).statusCode).toBe(200);
      expect(verify).not.toHaveBeenCalled();
      expect(find).not.toHaveBeenCalled();
    });

    it('write the sliding refresh at most once an hour', async () => {
      const f = fixture();
      const touch = vi.spyOn(f.store, 'touch');
      const token = await mint(f);
      f.advance(30 * minute);
      expect(await meStatus(f, token)).toBe(200);
      expect(touch).not.toHaveBeenCalled();
      f.advance(31 * minute);
      expect(await meStatus(f, token)).toBe(200);
      expect(touch).toHaveBeenCalledTimes(1);
      f.advance(minute);
      expect(await meStatus(f, token)).toBe(200);
      expect(touch).toHaveBeenCalledTimes(1);
      const row = await f.store.find(sessionIdOf(token));
      expect(row?.idleExpiresAt.getTime()).toBe(start + 15_000 + 61 * minute + 10 * day);
    });

    it('stop sliding at the absolute cap and are rejected once it passes', async () => {
      const f = fixture();
      const token = await mint(f);
      for (let step = 0; step < 3; step++) {
        f.advance(9 * day);
        expect(await meStatus(f, token)).toBe(200);
      }
      const row = await f.store.find(sessionIdOf(token));
      expect(row?.idleExpiresAt.getTime()).toBe(start + 30 * day);
      expect(row?.absoluteExpiresAt.getTime()).toBe(start + 30 * day);
      f.advance(2 * day);
      expect(await meStatus(f, token)).toBe(200);
      f.advance(day);
      expect(await meStatus(f, token)).toBe(401);
      expect(f.records()).toContainEqual(expect.objectContaining({
        msg: 'owner_session.rejected', reason: 'absolute_expired', sessionPrefix: prefixOf(token),
      }));
    });

    it('keep working when the sliding refresh cannot be written', async () => {
      const f = fixture();
      const token = await mint(f);
      vi.spyOn(f.store, 'touch').mockRejectedValue(new Error(leakMarker));
      f.advance(2 * 60 * minute);
      const response = await f.app.inject({ url: '/probe', headers: auth(token) });
      expect(response.statusCode).toBe(200);
      expect(f.records()).toContainEqual(expect.objectContaining({
        level: 40, msg: 'owner_session.refresh_failed', sessionPrefix: prefixOf(token),
      }));
      expect(f.logText()).not.toContain(leakMarker);
    });
  });

  describe('rejected sessions', () => {
    const cases: [string, string, (f: Fixture) => Promise<string>][] = [
      ['an unknown session', 'unknown_session', async () => generateOwnerSessionCredential().token],
      ['a wrong secret', 'secret_mismatch', async (f) => {
        const token = await mint(f);
        return `${ownerSessionTokenPrefix}${sessionIdOf(token)}.${generateOwnerSessionCredential().secret}`;
      }],
      ['an idle session', 'idle_expired', async (f) => {
        const token = await mint(f);
        f.advance(10 * day);
        return token;
      }],
      ['a revoked session', 'revoked', async (f) => {
        const token = await mint(f);
        await revokeCurrent(f, token);
        return token;
      }],
      ['a session that belongs to another account', 'owner_mismatch', (f) => insertSession(f, { ownerObjectId: strangerObjectId })],
    ];

    it.each(cases)('refuse %s with 401 and audit %s', async (_name, reason, prepare) => {
      const f = fixture();
      const token = await prepare(f);
      const response = await f.app.inject({ url: '/probe', headers: auth(token) });
      expectUnauthorized(f, response);
      expect(f.verifyEntra).not.toHaveBeenCalledWith(token);
      expect(f.records()).toContainEqual(expect.objectContaining({
        level: 40, msg: 'owner_session.rejected', reason, method: 'GET', route: '/probe', statusCode: 401, sessionPrefix: prefixOf(token),
      }));
    });

    it('refuse a token that only looks like a session token without a lookup or a prefix', async () => {
      const f = fixture();
      const find = vi.spyOn(f.store, 'find');
      const response = await f.app.inject({ url: '/probe', headers: auth('js.short.short') });
      expectUnauthorized(f, response);
      expect(find).not.toHaveBeenCalled();
      const [record] = entries(f, 'owner_session.rejected');
      expect(record).toMatchObject({ reason: 'malformed', statusCode: 401 });
      expect(record).not.toHaveProperty('sessionPrefix');
    });

    it('give every rejection the same response, so a caller cannot tell why', async () => {
      const f = fixture();
      const tokens = ['js.short.short', 'eyJ.entra.unknown'];
      for (const [, , prepare] of cases) tokens.push(await prepare(f));
      const seen = new Set<string>();
      for (const token of tokens) {
        const response = await f.app.inject({ url: '/probe', headers: auth(token) });
        seen.add(JSON.stringify([
          response.statusCode, response.body, response.headers['www-authenticate'],
          response.headers['content-type'], response.headers['content-length'], response.headers['cache-control'],
        ]));
      }
      expect([...seen]).toHaveLength(1);
    });
  });

  describe('credentials that are not a single Authorization header', () => {
    it.each<[string, (token: string) => { url: string; headers: Record<string, string> }, string]>([
      ['a query string parameter', (token) => ({ url: `/probe?access_token=${token}`, headers: {} }), 'missing_token'],
      ['a cookie', (token) => ({ url: '/probe', headers: { cookie: `session=${token}` } }), 'missing_token'],
      ['a WebSocket subprotocol on another route', (token) => ({
        url: '/probe', headers: { upgrade: 'websocket', 'sec-websocket-protocol': `jarvis.voice.v1, jarvis.auth.${token}` },
      }), 'missing_token'],
      ['a scheme other than Bearer', (token) => ({ url: '/probe', headers: { authorization: `Basic ${token}` } }), 'malformed_authorization'],
      ['a token with an extra segment', (token) => ({ url: '/probe', headers: auth(`${token}.extra`) }), 'malformed_authorization'],
      ['a header over the size limit', () => ({ url: '/probe', headers: auth(`js.${'a'.repeat(16_400)}`) }), 'malformed_authorization'],
    ])('do not accept a session token in %s', async (_name, build, reason) => {
      const f = fixture();
      const token = await mint(f);
      const find = vi.spyOn(f.store, 'find');
      const response = await f.app.inject(build(token));
      expectUnauthorized(f, response);
      expect(find).not.toHaveBeenCalled();
      expect(f.records()).toContainEqual(expect.objectContaining({ msg: 'request.auth_denied', reason, statusCode: 401 }));
      expect(entries(f, 'owner_session.rejected')).toEqual([]);
    });

    it('hand an upper-case prefix to Entra, never to the session store', async () => {
      const f = fixture();
      const token = await mint(f);
      const find = vi.spyOn(f.store, 'find');
      const lookalike = `JS.${token.slice(ownerSessionTokenPrefix.length)}`;
      const response = await f.app.inject({ url: '/probe', headers: auth(lookalike) });
      expectUnauthorized(f, response);
      expect(f.verifyEntra).toHaveBeenCalledWith(lookalike);
      expect(find).not.toHaveBeenCalled();
    });

    it('refuse duplicate Authorization headers over a real socket before reading the store', async () => {
      const f = fixture();
      const token = await mint(f);
      const find = vi.spyOn(f.store, 'find');
      await f.app.listen({ host: '127.0.0.1', port: 0 });
      const { port } = f.app.server.address() as AddressInfo;
      const value = bearer(token);
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const req = httpRequest({
          host: '127.0.0.1', port, path: '/probe',
          headers: ['Host', `127.0.0.1:${port}`, 'Authorization', value, 'authorization', value, 'Connection', 'close'],
        }, (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        });
        req.on('error', reject);
        req.end();
      });
      expect(status).toBe(401);
      expect(find).not.toHaveBeenCalled();
      expect(f.executed).not.toHaveBeenCalled();
    });
  });

  describe('cross-origin requests', () => {
    it('let the approved browser read a session rejection', async () => {
      const f = fixture();
      const response = await f.app.inject({ url: '/probe', headers: { ...auth(generateOwnerSessionCredential().token), origin } });
      expect(response.statusCode).toBe(401);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
      expect(response.headers.vary).toBe('Origin');
      expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('never reach the session store from an origin that is not approved', async () => {
      const f = fixture();
      const token = await mint(f);
      const find = vi.spyOn(f.store, 'find');
      const response = await f.app.inject({ url: '/probe', headers: { ...auth(token), origin: 'https://evil.example' } });
      expect(response.statusCode).toBe(403);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(find).not.toHaveBeenCalled();
      expect(f.executed).not.toHaveBeenCalled();
    });
  });

  describe('session store failures', () => {
    it('answer 503 with Retry-After, keep the CORS headers and do not sign the owner out', async () => {
      const f = fixture();
      const token = await mint(f);
      const find = vi.spyOn(f.store, 'find').mockRejectedValue(new Error(leakMarker));
      const response = await f.app.inject({ url: '/probe', headers: { ...auth(token), origin } });
      expect(response.statusCode).toBe(503);
      expect(response.headers['retry-after']).toBe('5');
      expect(response.headers['www-authenticate']).toBeUndefined();
      expect(response.headers['access-control-allow-origin']).toBe(origin);
      expect(response.headers.vary).toBe('Origin');
      expect(response.json()).toEqual({ error: 'Service unavailable' });
      expect(f.executed).not.toHaveBeenCalled();
      expect(f.records()).toContainEqual(expect.objectContaining({
        level: 40, msg: 'owner_session.rejected', reason: 'store_unavailable', method: 'GET', route: '/probe', statusCode: 503,
      }));
      expect(`${response.body}${JSON.stringify(response.headers)}${f.logText()}`).not.toContain(leakMarker);
      find.mockRestore();
      expect(await meStatus(f, token)).toBe(200);
    });
  });

  describe('with the feature switch off', () => {
    it('refuse every session token, even one that exists, without reading the store', async () => {
      const f = fixture({ enabled: false });
      const find = vi.spyOn(f.store, 'find');
      const existing = await insertSession(f);
      const response = await f.app.inject({ url: '/probe', headers: auth(existing) });
      expectUnauthorized(f, response);
      expect(f.records()).toContainEqual(expect.objectContaining({
        level: 40, msg: 'owner_session.rejected', reason: 'disabled', statusCode: 401,
      }));
      expect(find).not.toHaveBeenCalled();
      expect(f.verifyEntra).not.toHaveBeenCalled();
      expect((await f.app.inject({ url: '/probe', headers: auth(entraOwner) })).statusCode).toBe(200);
    });
  });

  describe('service routes', () => {
    function registerFamilyRoutes(f: Fixture) {
      const reached = vi.fn();
      f.app.post('/runner-only', { config: { jarvisRunner: true } }, async () => { reached(); return { ok: true }; });
      f.app.get('/bridge-only', { config: { jarvisPcBridge: true } }, async () => { reached(); return { ok: true }; });
      f.app.post('/phone/events', { config: { jarvisPhoneEvents: true } }, async () => { reached(); return { ok: true }; });
      return reached;
    }

    it.each<['POST' | 'GET', string, string]>([
      ['POST', '/runner-only', 'eyJ.entra.runner'],
      ['GET', '/bridge-only', 'eyJ.entra.bridge'],
      ['POST', '/phone/events', 'eyJ.entra.phone'],
    ])('refuse a session on %s %s, which only its own identity may call', async (method, url, serviceToken) => {
      const f = fixture();
      const reached = registerFamilyRoutes(f);
      const session = await mint(f);
      expect((await f.app.inject({ method, url, headers: auth(serviceToken) })).statusCode).toBe(200);
      expect(reached).toHaveBeenCalledTimes(1);
      reached.mockClear();
      for (const token of [session, entraOwner]) {
        const refused = await f.app.inject({ method, url, headers: auth(token) });
        expect(refused.statusCode).toBe(403);
        expect(refused.json()).toEqual({ error: 'Forbidden' });
      }
      expect(reached).not.toHaveBeenCalled();
      expect(f.records()).toContainEqual(expect.objectContaining({
        msg: 'request.auth_denied', reason: 'principal_not_allowed_on_route', statusCode: 403, route: url,
      }));
    });

    it('refuse a session in the handlers that are reserved for the agent identity', async () => {
      const recordFoundryUsage = vi.fn(async () => {});
      const f = fixture({ usageStore: { list: vi.fn(), recordFoundryUsage } });
      const session = await mint(f);
      const usage = {
        role: 'chat', model: 'synthetic-model', inputTokens: 10, outputTokens: 5, eventId: '11111111-1111-4111-8111-111111111111',
      };
      const record = (token: string) => f.app.inject({ method: 'POST', url: '/usage/foundry', headers: auth(token), payload: usage });
      expect((await record('eyJ.entra.agent')).statusCode).toBe(204);
      expect(recordFoundryUsage).toHaveBeenCalledTimes(1);
      recordFoundryUsage.mockClear();
      for (const token of [session, entraOwner]) {
        const refused = await record(token);
        expect(refused.statusCode).toBe(403);
        expect(refused.json()).toEqual({ error: 'Forbidden' });
      }
      expect(recordFoundryUsage).not.toHaveBeenCalled();

      const smokeTools = (token: string) => f.app.inject({ url: '/tools', headers: { ...auth(token), 'x-jarvis-smoke': 'true' } });
      expect((await smokeTools('eyJ.entra.agent')).statusCode).toBe(200);
      const refusedSmoke = await smokeTools(session);
      expect(refusedSmoke.statusCode).toBe(403);
      expect(refusedSmoke.json()).toEqual({ error: 'Smoke tools are unavailable' });
      expect((await f.app.inject({ url: '/tools', headers: auth(session) })).statusCode).toBe(200);
    });

    it('refuse a session on the nutrition export route and never offer it to the capability verifier', async () => {
      const device: NutritionExportDevice = {
        kind: 'nutrition-export-device', scope: 'nutrition-export', ownerObjectId: owner, deviceId: 'synthetic-phone',
        expiresAt: '2099-01-01T00:00:00Z', revoked: false,
      };
      const verify = vi.fn<NutritionExportCredentialVerifier>(async () => device);
      const claim = vi.fn(async () => ({
        state: 'claimed' as const, claimToken: '11111111-1111-4111-8111-111111111111',
        claimedAt: '2026-10-22T12:00:00Z', claimExpiresAt: '2026-10-22T12:05:00Z', items: [],
      }));
      const f = fixture({ nutritionExportAuth: verify });
      await registerNutritionExportRoutes(f.app, () => ({ claim, complete: vi.fn() }));
      const session = await mint(f);
      const capability = 'synthetic_export_capability_'.padEnd(43, 'x');
      const claimWith = (token: string) => f.app.inject({
        method: 'POST', url: '/daily/nutrition/export/claim', headers: auth(token), payload: { operationKey: 'x' },
      });
      expect((await claimWith(capability)).statusCode).toBe(200);
      expect(verify).toHaveBeenCalledTimes(1);
      expect(claim).toHaveBeenCalledTimes(1);
      verify.mockClear();
      claim.mockClear();
      const refused = await claimWith(session);
      expect(refused.statusCode).toBe(403);
      expect(verify).not.toHaveBeenCalled();
      expect(claim).not.toHaveBeenCalled();
      expect(f.records()).toContainEqual(expect.objectContaining({
        level: 40, msg: 'request.auth_denied', method: 'POST', route: '/daily/nutrition/export/claim', statusCode: 403,
      }));
    });

    it('refuse a session on the Health connector route', async () => {
      const query = vi.fn();
      const connector: BackendModule = {
        id: 'connector-stub',
        tools: [],
        registerRoutes: dailyMcpRoutes({ query }, {
          auth: { ...config.auth, dailyConnectorClientId: connectorClientId },
          resource: `https://${connectorHost}${dailyMcpPath}`,
          nutrition: {} as never,
        }),
      };
      const f = fixture({ modules: [coreModule, connector] });
      const session = await mint(f);
      const call = (token: string) => f.app.inject({ url: dailyMcpPath, headers: { ...auth(token), host: connectorHost } });
      expect([400, 401, 403]).not.toContain((await call('eyJ.entra.connector')).statusCode);
      for (const token of [session, entraOwner]) expect((await call(token)).statusCode).toBe(403);
      expect(query).not.toHaveBeenCalled();
    });

    it('refuse a session on the deploy smoke route, which the Entra owner and the deploy identity still reach', async () => {
      const f = fixture();
      const session = await mint(f);
      const smoke = (token: string) => f.app.inject({ url: '/status/smoke', headers: auth(token) });
      const checks = () => entries(f, 'system.smoke_check').length;
      expect((await smoke(entraOwner)).statusCode).toBe(200);
      expect((await smoke('eyJ.entra.deploy')).statusCode).toBe(200);
      const before = checks();
      expect(before).toBeGreaterThan(0);
      const refused = await smoke(session);
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toEqual({ error: 'Forbidden' });
      expect(checks()).toBe(before);
      expect(f.records()).toContainEqual(expect.objectContaining({
        msg: 'request.auth_denied', reason: 'principal_not_allowed_on_route', statusCode: 403, route: '/status/smoke',
      }));
    });
  });

  describe('voice WebSocket credential', () => {
    const voice: BackendModule = {
      id: 'voice-stub',
      tools: [],
      registerRoutes: async (app) => {
        app.get('/voice', { websocket: true }, (socket, request) => {
          socket.send(JSON.stringify({ principal: request.principal, ownerSession: request.ownerSession }));
          socket.close(1000, 'done');
        });
      },
    };

    it('accepts a valid session in the subprotocol', async () => {
      const f = fixture({ modules: [coreModule, voice] });
      const token = await mint(f);
      expect(await connectVoice(f, token)).toEqual({
        opened: true, message: { principal: ownerPrincipal, ownerSession: { id: sessionIdOf(token), prefix: prefixOf(token) } },
      });
    });

    it('refuses a revoked session with 401', async () => {
      const f = fixture({ modules: [coreModule, voice] });
      const token = await mint(f);
      await revokeCurrent(f, token);
      expect(await connectVoice(f, token)).toEqual({ opened: false, statusCode: 401, retryAfter: undefined });
      expect(f.records()).toContainEqual(expect.objectContaining({
        msg: 'owner_session.rejected', reason: 'revoked', route: '/voice', statusCode: 401,
      }));
    });

    it('answers 503 with Retry-After when the store fails', async () => {
      const f = fixture({ modules: [coreModule, voice] });
      const token = await mint(f);
      vi.spyOn(f.store, 'find').mockRejectedValue(new Error(leakMarker));
      expect(await connectVoice(f, token)).toEqual({ opened: false, statusCode: 503, retryAfter: '5' });
      expect(f.logText()).not.toContain(leakMarker);
    });
  });

  describe('redaction', () => {
    it('keeps the secret, its hash and the full session id out of every log line and every refusal', async () => {
      const f = fixture();
      const token = await mint(f);
      const credential = parseOwnerSessionToken(token);
      if (!credential) throw new Error('The minted token must be well formed');
      const stranger = generateOwnerSessionCredential();
      const wrongSecret = generateOwnerSessionCredential().secret;
      const hash = hashOwnerSessionSecret(credential.secret);

      const refusals: LightMyRequestResponse[] = [];
      const use = async (value: string, headers: Record<string, string> = {}) => f.app.inject({
        url: '/probe', headers: { ...auth(value), ...headers },
      });
      expect((await use(token)).statusCode).toBe(200);
      refusals.push(await use(stranger.token));
      refusals.push(await use(`${ownerSessionTokenPrefix}${credential.sessionId}.${wrongSecret}`));
      refusals.push(await use('js.short.short'));
      const failing = vi.spyOn(f.store, 'find').mockRejectedValue(new Error(leakMarker));
      refusals.push(await use(token, { origin }));
      failing.mockRestore();
      expect((await revokeCurrent(f, token)).statusCode).toBe(204);
      refusals.push(await use(token));
      refusals.push(await f.app.inject({ method: 'DELETE', url: '/auth/session', headers: auth(entraOwner) }));
      expect((await f.app.inject({ method: 'DELETE', url: '/auth/sessions', headers: auth(entraOwner) })).statusCode).toBe(200);

      const surface = `${f.logText()}${refusals.map((response) => `${response.body}${JSON.stringify(response.headers)}`).join('')}`;
      const secrets = [
        token, credential.secret, credential.sessionId, hash.toString('hex'), hash.toString('base64'), hash.toString('base64url'),
        stranger.token, stranger.secret, stranger.sessionId, wrongSecret, leakMarker,
      ];
      for (const secret of secrets) expect(surface).not.toContain(secret);
      expect(f.logText()).toContain(prefixOf(token));
    });
  });
});
