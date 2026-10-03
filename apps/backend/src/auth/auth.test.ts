import { createServer, request, type Server } from 'node:http';
import { Writable } from 'node:stream';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRemoteJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createLogger } from '../logging.js';
import { createTokenVerifier } from './verify.js';
import { loadAuthConfig } from './config.js';

const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
const issuer = `https://login.microsoftonline.com/${config.auth.tenantId}/v2.0`;
const now = Math.floor(Date.now() / 1000);
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let server: Server;
let url: URL;
let jwksRequests = 0;
let jwksFailure = false;
let jwksStalled = false;
const apps: ReturnType<typeof buildApp>[] = [];

beforeAll(async () => {
  keys = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(keys.publicKey), kid: 'fixture-key', alg: 'RS256', use: 'sig' };
  server = createServer((_req, res) => {
    jwksRequests++;
    if (jwksStalled) return;
    res.writeHead(jwksFailure ? 503 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(jwksFailure ? { secret: 'jwks-body-secret' } : { keys: [jwk] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test listener');
  url = new URL(`http://127.0.0.1:${address.port}/keys`);
});
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); jwksFailure = false; jwksStalled = false; server.closeAllConnections(); });
afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())); });

async function token(overrides: JWTPayload = {}, kid = 'fixture-key') {
  const payload: JWTPayload = {
    iss: issuer, aud: config.auth.apiClientId, sub: 'signed-subject',
    tid: config.auth.tenantId, ver: '2.0', oid: config.auth.ownerObjectId,
    scp: 'access_as_user', iat: now - 10, nbf: now - 10, exp: now + 3600,
    ...overrides,
  };
  for (const field of Object.keys(payload)) if (payload[field] === undefined) delete payload[field];
  return new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid }).sign(keys.privateKey);
}

function fixture() {
  const records: string[] = [];
  const output = new Writable({ write(chunk: Buffer, _enc, done) { records.push(chunk.toString()); done(); } });
  const verify = createTokenVerifier(config.auth, createRemoteJWKSet(url, { timeoutDuration: 100, cooldownDuration: 30_000 }));
  const app = buildApp(config, createLogger(config, undefined, output), { auth: verify });
  app.get('/protected', async (request) => ({ principal: request.principal }));
  app.post('/protected', async () => ({ accepted: true }));
  app.options('/business-options', async () => ({ accepted: true }));
  app.register(async (nested) => { nested.get('/nested', async (request) => ({ principal: request.principal })); });
  apps.push(app);
  return { app, records };
}

describe('Entra bearer authentication at the server boundary', () => {
  it('accepts a real signed API token for Dan, including nested routes, and caches JWKS', async () => {
    const { app } = fixture();
    const before = jwksRequests;
    const authorization = `Bearer ${await token()}`;
    for (const path of ['/protected', '/nested']) {
      const response = await app.inject({ url: path, headers: { authorization } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ principal: { objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId } });
    }
    expect(jwksRequests - before).toBe(1);
  });
  it.each([
    ['wrong audience', { aud: '00000000-0000-0000-0000-000000000000' }],
    ['resource URI instead of v2 API audience', { aud: `api://${config.auth.apiClientId}` }],
    ['wrong issuer', { iss: 'https://evil.example/v2.0' }],
    ['wrong tenant', { tid: '00000000-0000-0000-0000-000000000000' }],
    ['v1 token', { ver: '1.0' }],
    ['expired token', { exp: now - 30 }],
    ['not yet valid', { nbf: now + 3600 }],
    ['missing expiry', { exp: undefined }],
    ['missing not-before', { nbf: undefined }],
    ['missing issued-at', { iat: undefined }],
    ['missing object ID', { oid: undefined }],
    ['malformed object ID', { oid: ['object-id-secret'] }],
  ])('rejects %s with 401', async (_name, claims) => {
    const { app } = fixture();
    const response = await app.inject({ url: '/protected', headers: { authorization: `Bearer ${await token(claims)}` } });
    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(response.json()).toEqual({ error: 'Unauthorized' });
  });
  it.each([
    ['another user', { oid: '00000000-0000-0000-0000-000000000000' }],
    ['ID token / application token', { scp: undefined }],
    ['wrong scope', { scp: 'access_as_user_extra' }],
    ['malformed scope', { scp: ['access_as_user'] }],
  ])('rejects verified %s with 403', async (_name, claims) => {
    const { app } = fixture();
    const response = await app.inject({ url: '/protected', headers: { authorization: `Bearer ${await token(claims)}` } });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Forbidden' });
  });
  it.each([undefined, '', 'Basic password-secret', 'Bearer a.b.c', 'Bearer a.b.c, Bearer a.b.c', 'Bearer ' + 'a'.repeat(17_000)])('rejects missing or malformed credentials without fetching JWKS', async (authorization) => {
    const { app, records } = fixture();
    const before = jwksRequests;
    const response = await app.inject({ method: 'POST', url: '/protected', headers: authorization === undefined ? {} : { authorization }, payload: { ignored: 'body-secret' } });
    expect(response.statusCode).toBe(401);
    expect(jwksRequests).toBe(before);
    expect(records.join('')).not.toMatch(/password-secret|body-secret|Bearer/);
  });
  it('rejects tampering, unknown keys, and symmetric algorithm substitution', async () => {
    const { app } = fixture();
    const valid = await token();
    const [header, payload, signature] = valid.split('.');
    const tampered = `${header}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), oid: '00000000-0000-0000-0000-000000000000' })).toString('base64url')}.${signature}`;
    const symmetric = await new SignJWT({ aud: config.auth.apiClientId }).setProtectedHeader({ alg: 'HS256' }).sign(new Uint8Array(32));
    for (const value of [tampered, await token({}, 'unknown-key'), symmetric]) {
      expect((await app.inject({ url: '/protected', headers: { authorization: `Bearer ${value}` } })).statusCode).toBe(401);
    }
  });
  it('fails closed on JWKS outage without disclosing provider response or signed identity', async () => {
    const { app, records } = fixture();
    jwksFailure = true;
    const value = await token();
    const response = await app.inject({ url: '/protected?token=query-secret', headers: { authorization: `Bearer ${value}` } });
    expect(response.statusCode).toBe(401);
    for (const text of [records.join(''), response.body]) {
      expect(text).not.toContain(value);
      expect(text).not.toContain(config.auth.ownerObjectId);
      expect(text).not.toContain(config.auth.tenantId);
      expect(text).not.toMatch(/secret|127\.0\.0\.1|JWT/);
    }
  });
  it('bounds a stalled JWKS lookup and never executes the protected handler', async () => {
    const { app, records } = fixture();
    let executed = false;
    app.get('/sensitive', async () => { executed = true; return { accepted: true }; });
    jwksStalled = true;
    const value = await token();
    const started = performance.now();
    const response = await app.inject({ url: '/sensitive', headers: { authorization: `Bearer ${value}` } });
    expect(response.statusCode).toBe(401);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(executed).toBe(false);
    expect(records.join('')).not.toContain(value);
  });
  it('rejects duplicate Authorization headers over a real socket before fetching keys', async () => {
    const { app } = fixture();
    let executed = false;
    app.get('/sensitive', async () => { executed = true; return { accepted: true }; });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('No test listener');
    const value = `Bearer ${await token()}`;
    const before = jwksRequests;
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: address.port, path: '/sensitive', headers: ['Host', `127.0.0.1:${address.port}`, 'Authorization', value, 'authorization', value, 'Connection', 'close'] }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(401);
    expect(jwksRequests).toBe(before);
    expect(executed).toBe(false);
  });
  it('leaves only exact health probes and CORS-generated preflights public', async () => {
    const { app } = fixture();
    for (const method of ['GET', 'HEAD'] as const) expect((await app.inject({ method, url: '/health?probe=true' })).statusCode).toBe(200);
    // Fastify canonicalizes the encoded path to the same public health route.
    expect((await app.inject('/%68ealth')).statusCode).toBe(200);
    for (const path of ['/health/', '/health/extra', '/nested', '/missing']) expect((await app.inject(path)).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/health' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'OPTIONS', url: '/business-options', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'GET' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'OPTIONS', url: '/protected', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'OPTIONS', url: '/protected', headers: { origin: 'http://localhost:5173' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'OPTIONS', url: '/protected', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } })).statusCode).toBe(403);
  });
});

describe('auth configuration', () => {
  it('matches the nonsecret bootstrapped Entra identities', async () => {
    const { readFile } = await import('node:fs/promises');
    const bootstrap = JSON.parse(await readFile(new URL('../../../../infra/bootstrap.output.json', import.meta.url), 'utf8'));
    expect(loadAuthConfig({})).toEqual({ tenantId: bootstrap.tenantId, apiClientId: bootstrap.api.appId, ownerObjectId: bootstrap.ownerObjectId });
  });
  it.each(['ENTRA_TENANT_ID', 'ENTRA_API_CLIENT_ID', 'ENTRA_OWNER_OBJECT_ID'])('validates %s without echoing values', (name) => {
    for (const value of ['', 'secret', 'https://evil.example', '00000000-0000-0000-0000-000000000000/path']) expect(() => loadConfig({ [name]: value })).toThrow(`${name} must be a UUID`);
  });
});
