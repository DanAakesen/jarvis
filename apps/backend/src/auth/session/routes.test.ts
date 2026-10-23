import { Writable } from 'node:stream';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { ConfigurationError, loadConfig } from '../../config.js';
import { createLogger } from '../../logging.js';
import { AuthenticationDenied, type TokenVerifier } from '../verify.js';
import { InMemoryOwnerSessionStore } from './memory-store.js';
import { OwnerSessionService } from './service.js';
import { hashOwnerSessionSecret, parseOwnerSessionToken } from './token.js';

const origin = 'https://fixture.azurestaticapps.net';
const config = loadConfig({ STATIC_WEB_APP_ORIGIN: origin, JARVIS_OWNER_SESSION_ENABLED: 'true' });
const switchOffConfig = loadConfig({ STATIC_WEB_APP_ORIGIN: origin });
const owner = config.auth.ownerObjectId;
const tenantId = config.auth.tenantId;
const strangerObjectId = '00000000-0000-4000-8000-000000000001';
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
  'eyJ.entra.other-user': { objectId: strangerObjectId, tenantId, displayName: 'Other User' },
  'eyJ.entra.agent': { kind: 'jarvis-agent', objectId: strangerObjectId, tenantId },
  'eyJ.entra.runner': { kind: 'jarvis-runner', objectId: strangerObjectId, tenantId },
  'eyJ.entra.bridge': { kind: 'jarvis-pc-bridge', objectId: strangerObjectId, tenantId },
  'eyJ.entra.phone': { kind: 'jarvis-phone-event-grid', objectId: strangerObjectId, tenantId },
  'eyJ.entra.deploy': { kind: 'jarvis-deploy', objectId: strangerObjectId, tenantId },
};

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
// The first app built in a worker loads every route module; keep that one-off cost out of the first test's timeout.
beforeAll(async () => { await fixture().app.ready(); });

function fixture({ enabled = true }: { enabled?: boolean } = {}) {
  let current = start;
  const chunks: string[] = [];
  const output = new Writable({ write(chunk: Buffer, _encoding, done) { chunks.push(chunk.toString()); done(); } });
  const store = new InMemoryOwnerSessionStore();
  const service = new OwnerSessionService({ store, ownerObjectId: owner, tenantId, now: () => new Date(current) });
  const verifyEntra = vi.fn<TokenVerifier>(async (token) => {
    if (token === 'eyJ.entra.stranger') throw new AuthenticationDenied(403);
    const principal = entraPrincipals[token];
    if (!principal) throw new AuthenticationDenied(401);
    return principal;
  });
  const settings = enabled ? config : switchOffConfig;
  const app = buildApp(settings, createLogger(settings, undefined, output), { auth: verifyEntra, ownerSessions: service });
  apps.push(app);
  return {
    app, store, service, verifyEntra,
    advance: (ms: number) => { current += ms; },
    logText: () => chunks.join(''),
    records: () => chunks.join('').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
type Fixture = ReturnType<typeof fixture>;

function createSession(f: Fixture, payload?: string | object, token: string | null = entraOwner) {
  const headers: Record<string, string> = token === null ? {} : auth(token);
  if (typeof payload === 'string') headers['content-type'] = 'application/json';
  return f.app.inject({ method: 'POST', url: '/auth/session', headers, ...(payload === undefined ? {} : { payload }) });
}

// Creates a session and moves the clock on, so a run of creates stays inside the create limits.
async function mint(f: Fixture, payload?: object): Promise<string> {
  const response = await createSession(f, payload);
  expect(response.statusCode).toBe(201);
  f.advance(15_000);
  return response.json<{ token: string }>().token;
}

const meStatus = async (f: Fixture, token: string) => (await f.app.inject({ url: '/me', headers: auth(token) })).statusCode;
const revokeCurrent = (f: Fixture, token: string) => f.app.inject({ method: 'DELETE', url: '/auth/session', headers: auth(token) });
const revokeAll = (f: Fixture, token: string) => f.app.inject({ method: 'DELETE', url: '/auth/sessions', headers: auth(token) });
const prefixOf = (token: string) => parseOwnerSessionToken(token)?.sessionId.slice(0, 8);

function expectUnavailable(f: Fixture, response: LightMyRequestResponse, route: string) {
  expect(response.statusCode).toBe(503);
  expect(response.headers['retry-after']).toBe('5');
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.json()).toEqual({ error: 'Service unavailable' });
  expect(`${response.body}${JSON.stringify(response.headers)}${f.logText()}`).not.toContain(leakMarker);
  expect(f.records()).toContainEqual(expect.objectContaining({
    msg: 'owner_session.rejected', reason: 'store_unavailable', method: expect.any(String), route, statusCode: 503,
  }));
}

describe('POST /auth/session', () => {
  it('creates a session for the verified owner and returns the only readable copy of the token', async () => {
    const f = fixture();
    const response = await createSession(f);
    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.json<{ sessionId: string; token: string; idleExpiresAt: string; absoluteExpiresAt: string }>();
    expect(Object.keys(body).sort()).toEqual(['absoluteExpiresAt', 'idleExpiresAt', 'sessionId', 'token']);
    const credential = parseOwnerSessionToken(body.token);
    if (!credential) throw new Error('The response token must be a well-formed session token');
    expect(body.sessionId).toBe(credential.sessionId);
    expect(body.idleExpiresAt).toBe(new Date(start + 10 * day).toISOString());
    expect(body.absoluteExpiresAt).toBe(new Date(start + 30 * day).toISOString());

    const row = await f.store.find(body.sessionId);
    expect(row).toMatchObject({ ownerObjectId: owner, displayName: 'Test Owner', deviceLabel: null, revokedAt: null });
    expect(row?.secretHash.equals(hashOwnerSessionSecret(credential.secret))).toBe(true);
    expect(JSON.stringify(row)).not.toContain(credential.secret);
    expect(f.records()).toContainEqual(expect.objectContaining({
      level: 30, msg: 'owner_session.created', sessionPrefix: credential.sessionId.slice(0, 8), evicted: 0,
    }));
    expect(f.logText()).not.toContain(credential.secret);
    expect(await meStatus(f, body.token)).toBe(200);
  });

  it.each<[string, string | object | undefined, string | null]>([
    ['no body', undefined, null],
    ['an empty object', {}, null],
    ['a null label', { deviceLabel: null }, null],
    ['a label with surrounding blanks', { deviceLabel: '  Work laptop  ' }, 'Work laptop'],
    ['a Danish label', { deviceLabel: 'Bærbar på kontoret' }, 'Bærbar på kontoret'],
    ['a label of exactly 40 characters', { deviceLabel: 'a'.repeat(40) }, 'a'.repeat(40)],
    ['an emoji label', { deviceLabel: '📱 Phone' }, '📱 Phone'],
    ['a label of 40 UTF-16 units that ends in an emoji', { deviceLabel: `${'x'.repeat(38)}📱` }, `${'x'.repeat(38)}📱`],
  ])('accepts %s', async (_name, payload, label) => {
    const f = fixture();
    const response = await createSession(f, payload);
    expect(response.statusCode).toBe(201);
    const row = await f.store.find(response.json<{ sessionId: string }>().sessionId);
    expect(row?.deviceLabel).toBe(label);
  });

  it.each<[string, string | object]>([
    ['an empty label', { deviceLabel: '' }],
    ['a blank label', { deviceLabel: '   ' }],
    ['a label of 41 characters', { deviceLabel: 'a'.repeat(41) }],
    ['a label of 41 UTF-16 units that ends in an emoji', { deviceLabel: `${'x'.repeat(39)}📱` }],
    ['a tab', { deviceLabel: 'a\tb' }],
    ['a newline', { deviceLabel: 'a\nb' }],
    ['a NUL character', { deviceLabel: 'a\u0000b' }],
    ['a bell character', { deviceLabel: 'a\u0007b' }],
    ['a line separator', { deviceLabel: 'a\u2028b' }],
    ['a zero-width space', { deviceLabel: 'a\u200Bb' }],
    ['a no-break space', { deviceLabel: 'a\u00A0b' }],
    ['a numeric label', { deviceLabel: 5 }],
    ['an object label', { deviceLabel: { text: 'x' } }],
    ['an array label', { deviceLabel: ['x'] }],
    ['an unknown field', { deviceLabel: 'ok', extra: true }],
    ['an array body', ['x']],
    ['a JSON string body', '"label"'],
    ['a JSON number body', '42'],
  ])('rejects %s with 400 and stores nothing', async (_name, payload) => {
    const f = fixture();
    const create = vi.spyOn(f.store, 'create');
    const response = await createSession(f, payload);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Invalid request' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(create).not.toHaveBeenCalled();
  });

  it.each<[string, string | null, number]>([
    ['no credential', null, 401],
    ['an unknown Entra token', 'eyJ.entra.unknown', 401],
    ['an Entra account that is not the owner', 'eyJ.entra.stranger', 403],
    ['the agent identity', 'eyJ.entra.agent', 403],
    ['the runner identity', 'eyJ.entra.runner', 403],
    ['the PC bridge identity', 'eyJ.entra.bridge', 403],
    ['the phone event identity', 'eyJ.entra.phone', 403],
    ['the deployment identity', 'eyJ.entra.deploy', 403],
  ])('refuses %s', async (_name, token, expected) => {
    const f = fixture();
    const create = vi.spyOn(f.store, 'create');
    const response = await createSession(f, undefined, token);
    expect(response.statusCode).toBe(expected);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a user principal that is not the configured owner even if the verifier accepted it', async () => {
    const f = fixture();
    const create = vi.spyOn(f.store, 'create');
    const response = await createSession(f, undefined, 'eyJ.entra.other-user');
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Forbidden' });
    expect(create).not.toHaveBeenCalled();
    expect(f.records()).toContainEqual(expect.objectContaining({
      msg: 'owner_session.rejected', reason: 'forbidden', route: '/auth/session', statusCode: 403,
    }));
  });

  it('does not let a session token mint another session', async () => {
    const f = fixture();
    const token = await mint(f);
    const create = vi.spyOn(f.store, 'create');
    const response = await createSession(f, undefined, token);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Forbidden' });
    expect(create).not.toHaveBeenCalled();
    expect(f.records()).toContainEqual(expect.objectContaining({
      msg: 'owner_session.rejected', reason: 'forbidden', route: '/auth/session', statusCode: 403,
    }));
  });

  it('allows five creates a minute, then answers 429 with the wait and frees the window on time', async () => {
    const f = fixture();
    for (let attempt = 0; attempt < 5; attempt += 1) expect((await createSession(f)).statusCode).toBe(201);
    const limited = await createSession(f);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
    expect(limited.headers['cache-control']).toBe('no-store');
    expect(limited.json()).toEqual({ error: 'rate_limited' });
    expect(f.records()).toContainEqual(expect.objectContaining({
      msg: 'owner_session.rejected', reason: 'rate_limited', statusCode: 429,
    }));

    f.advance(30_000);
    const stillLimited = await createSession(f);
    expect(stillLimited.statusCode).toBe(429);
    expect(stillLimited.headers['retry-after']).toBe('30');

    f.advance(30_000);
    expect((await createSession(f)).statusCode).toBe(201);
  });

  it('also allows at most thirty creates an hour', async () => {
    const f = fixture();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      expect((await createSession(f)).statusCode).toBe(201);
      f.advance(15_000);
    }
    const limited = await createSession(f);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('3150');
  });

  it('counts a rejected body against the allowance and leaves other routes alone', async () => {
    const f = fixture();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await createSession(f, { deviceLabel: '' })).statusCode).toBe(400);
    }
    expect((await createSession(f)).statusCode).toBe(429);
    expect((await f.app.inject({ url: '/me', headers: auth(entraOwner) })).statusCode).toBe(200);
    expect((await revokeAll(f, entraOwner)).statusCode).toBe(200);
  });

  it('keeps at most ten active sessions by revoking the least recently used one', async () => {
    const f = fixture();
    const tokens: string[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) tokens.push(await mint(f));
    for (const [index, token] of tokens.entries()) expect(await meStatus(f, token)).toBe(index === 0 ? 401 : 200);
    const created = f.records().filter((record) => record.msg === 'owner_session.created');
    expect(created.map((record) => record.evicted)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('answers the approved origin with the CORS headers a browser needs', async () => {
    const f = fixture();
    for (const method of ['POST', 'DELETE']) {
      const preflight = await f.app.inject({
        method: 'OPTIONS',
        url: '/auth/session',
        headers: { origin, 'access-control-request-method': method, 'access-control-request-headers': 'authorization,content-type' },
      });
      expect(preflight.statusCode).toBe(204);
      expect(preflight.headers['access-control-allow-origin']).toBe(origin);
      expect(preflight.headers['access-control-allow-methods']).toContain(method);
      expect(preflight.headers['access-control-allow-headers']).toMatch(/authorization/iu);
    }
    const created = await f.app.inject({ method: 'POST', url: '/auth/session', headers: { ...auth(entraOwner), origin } });
    expect(created.statusCode).toBe(201);
    expect(created.headers['access-control-allow-origin']).toBe(origin);
  });

  it('answers 503 with Retry-After when the store cannot create, without leaking the cause', async () => {
    const f = fixture();
    vi.spyOn(f.store, 'create').mockRejectedValue(new Error(leakMarker));
    expectUnavailable(f, await createSession(f), '/auth/session');
  });
});

describe('DELETE /auth/session', () => {
  it('revokes only the calling session', async () => {
    const f = fixture();
    const first = await mint(f);
    const second = await mint(f);
    const response = await revokeCurrent(f, first);
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(await meStatus(f, first)).toBe(401);
    expect(await meStatus(f, second)).toBe(200);
    expect(f.records()).toContainEqual(expect.objectContaining({
      level: 30, msg: 'owner_session.revoked', scope: 'current', sessionPrefix: prefixOf(first),
    }));
  });

  it('answers 204 even when another request revoked the session first', async () => {
    const f = fixture();
    const token = await mint(f);
    vi.spyOn(f.store, 'revoke').mockResolvedValueOnce(false);
    expect((await revokeCurrent(f, token)).statusCode).toBe(204);
  });

  it.each<[string, string | null, number]>([
    ['no credential', null, 401],
    ['an Entra owner token, which is not a session', entraOwner, 403],
    ['an Entra account that is not the owner', 'eyJ.entra.stranger', 403],
    ['the agent identity', 'eyJ.entra.agent', 403],
    ['the deployment identity', 'eyJ.entra.deploy', 403],
  ])('refuses %s', async (_name, token, expected) => {
    const f = fixture();
    const revoke = vi.spyOn(f.store, 'revoke');
    const response = await f.app.inject({ method: 'DELETE', url: '/auth/session', headers: token === null ? {} : auth(token) });
    expect(response.statusCode).toBe(expected);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('answers 503 and keeps the session usable when the store cannot revoke', async () => {
    const f = fixture();
    const token = await mint(f);
    const revoke = vi.spyOn(f.store, 'revoke').mockRejectedValue(new Error(leakMarker));
    expectUnavailable(f, await revokeCurrent(f, token), '/auth/session');
    revoke.mockRestore();
    expect(await meStatus(f, token)).toBe(200);
    expect((await revokeCurrent(f, token)).statusCode).toBe(204);
  });
});

describe('DELETE /auth/sessions', () => {
  it('revokes every active session with an Entra token and reports the count', async () => {
    const f = fixture();
    const tokens = [await mint(f), await mint(f), await mint(f)];
    const response = await revokeAll(f, entraOwner);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({ revoked: 3 });
    for (const token of tokens) expect(await meStatus(f, token)).toBe(401);
    expect(await meStatus(f, entraOwner)).toBe(200);
    expect(f.records()).toContainEqual(expect.objectContaining({
      level: 30, msg: 'owner_session.revoked', scope: 'all', count: 3,
    }));
  });

  it('revokes the calling session too when called with a session token', async () => {
    const f = fixture();
    const caller = await mint(f);
    const other = await mint(f);
    const response = await revokeAll(f, caller);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ revoked: 2 });
    expect(await meStatus(f, caller)).toBe(401);
    expect(await meStatus(f, other)).toBe(401);
  });

  it('counts only sessions that are still active', async () => {
    const f = fixture();
    await mint(f);
    f.advance(10 * day);
    const revoked = await mint(f);
    await mint(f);
    expect((await revokeCurrent(f, revoked)).statusCode).toBe(204);
    expect((await revokeAll(f, entraOwner)).json()).toEqual({ revoked: 1 });
    expect((await revokeAll(f, entraOwner)).json()).toEqual({ revoked: 0 });
  });

  it.each<[string, string | null, number]>([
    ['no credential', null, 401],
    ['an Entra account that is not the owner', 'eyJ.entra.stranger', 403],
    ['the agent identity', 'eyJ.entra.agent', 403],
    ['the runner identity', 'eyJ.entra.runner', 403],
    ['the deployment identity', 'eyJ.entra.deploy', 403],
  ])('refuses %s', async (_name, token, expected) => {
    const f = fixture();
    const revokeEverything = vi.spyOn(f.store, 'revokeAll');
    const response = await f.app.inject({ method: 'DELETE', url: '/auth/sessions', headers: token === null ? {} : auth(token) });
    expect(response.statusCode).toBe(expected);
    expect(revokeEverything).not.toHaveBeenCalled();
  });

  it('answers 503 when the store cannot revoke, without leaking the cause', async () => {
    const f = fixture();
    vi.spyOn(f.store, 'revokeAll').mockRejectedValue(new Error(leakMarker));
    expectUnavailable(f, await revokeAll(f, entraOwner), '/auth/sessions');
  });
});

describe('with the feature switch off', () => {
  it('does not register the routes even when a service is supplied', async () => {
    const f = fixture({ enabled: false });
    const create = vi.spyOn(f.store, 'create');
    for (const [method, url] of [['POST', '/auth/session'], ['DELETE', '/auth/session'], ['DELETE', '/auth/sessions']] as const) {
      const response = await f.app.inject({ method, url, headers: auth(entraOwner) });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'Not found' });
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses to start when the switch is on and no service was composed', () => {
    const output = new Writable({ write(_chunk, _encoding, done) { done(); } });
    expect(() => buildApp(config, createLogger(config, undefined, output), { auth: async () => ownerPrincipal }))
      .toThrow(ConfigurationError);
  });
});
