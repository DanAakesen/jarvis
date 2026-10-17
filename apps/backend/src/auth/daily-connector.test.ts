import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { coreModule } from '../core/index.js';
import { resolveDailyOwner } from '../daily/owner.js';
import { dailyMcpMetadataPath, dailyMcpPath } from '../daily/mcp/paths.js';
import { AuthenticationDenied, createTokenVerifier, dailyNutritionScopes } from './verify.js';

const clientId = '44444444-4444-4444-8444-444444444444';
const other = '55555555-5555-4555-8555-555555555555';
const base = loadConfig({});
const config = { ...base, logLevel: 'silent' as const, auth: { ...base.auth, dailyConnectorClientId: clientId } };
const apps: ReturnType<typeof buildApp>[] = [];
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => { keys = await generateKeyPair('RS256'); });
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

async function token(overrides: JWTPayload = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims: JWTPayload = {
    iss: `https://login.microsoftonline.com/${config.auth.tenantId}/v2.0`,
    aud: config.auth.apiClientId, tid: config.auth.tenantId, ver: '2.0', oid: config.auth.ownerObjectId,
    azp: clientId, scp: dailyNutritionScopes.read, idtyp: 'user', exp: now + 60, iat: now - 5, nbf: now - 5,
    ...overrides,
  };
  for (const field of Object.keys(claims)) if (claims[field] === undefined) delete claims[field];
  return new SignJWT(claims).setProtectedHeader({ alg: 'RS256' }).sign(keys.privateKey);
}
function verifier(enabled = true) {
  return createTokenVerifier(enabled ? config.auth : base.auth, async () => keys.publicKey);
}
function fixture() {
  const app = buildApp(config, undefined, {
    auth: verifier(),
    modules: [coreModule, {
      id: 'synthetic-connector-boundary', tools: [],
      registerRoutes: async app => {
        app.post(dailyMcpPath, { config: { jarvisDailyMcp: true, jarvisDailyMcpMetadataUrl: 'https://fixture.test/.well-known/oauth-protected-resource/daily/mcp' } },
          async request => ({ owner: resolveDailyOwner(request), principal: request.principal, connector: request.dailyConnectorPrincipal?.kind }));
        app.get('/synthetic-wrong-mcp-path', { config: { jarvisDailyMcp: true } }, async () => ({ exposed: true }));
        app.get(dailyMcpMetadataPath, { config: { jarvisDailyMcpMetadata: true } }, async () => ({ resource: 'https://fixture.test/daily/mcp' }));
        app.get('/synthetic-wrong-metadata-path', { config: { jarvisDailyMcpMetadata: true } }, async () => ({ exposed: true }));
      },
    }],
  });
  apps.push(app);
  return app;
}

describe('inactive nutrition-only delegated Entra identity', () => {
  it('accepts a signed owner token only for the explicitly configured client and exact nutrition scopes', async () => {
    const verify = verifier();
    const principal = await verify(await token({ scp: `${dailyNutritionScopes.read} ${dailyNutritionScopes.write}` }));
    expect(principal).toEqual({
      kind: 'jarvis-daily-connector', objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, clientId,
      scopes: [dailyNutritionScopes.read, dailyNutritionScopes.write],
    });
    expect(JSON.stringify(principal)).not.toContain('access_as_user');
  });

  it.each([
    ['unapproved client', { azp: other }],
    ['missing client identity', { azp: undefined }],
    ['another owner', { oid: other }],
    ['mixed broad delegated scope', { scp: `${dailyNutritionScopes.read} access_as_user` }],
    ['only broad delegated scope', { scp: 'access_as_user' }],
    ['missing delegated scope', { scp: undefined }],
    ['unknown scope', { scp: `${dailyNutritionScopes.read} Daily.Admin` }],
    ['application identity', { idtyp: 'app' }],
    ['application roles', { roles: ['Jarvis.Tools'] }],
  ])('refuses %s', async (_name, claims) => {
    await expect(verifier()(await token(claims))).rejects.toEqual(new AuthenticationDenied(403));
  });

  it('does not activate through normal configuration and preserves existing first-party user tokens', async () => {
    expect(base.auth).not.toHaveProperty('dailyConnectorClientId');
    await expect(verifier(false)(await token())).rejects.toEqual(new AuthenticationDenied(403));
    expect(await verifier()(await token({ azp: other, scp: 'access_as_user' }))).toMatchObject({
      objectId: config.auth.ownerObjectId, displayName: 'Dan',
    });
  });

  it('normalises the explicit client GUID without changing its restricted principal kind', async () => {
    const lower = 'abcdef01-4444-4444-8444-444444444444';
    const verify = createTokenVerifier({ ...config.auth, dailyConnectorClientId: lower.toUpperCase() }, async () => keys.publicKey);
    expect(await verify(await token({ azp: lower }))).toMatchObject({ kind: 'jarvis-daily-connector', clientId: lower });
    expect(() => createTokenVerifier({ ...config.auth, dailyConnectorClientId: config.auth.apiClientId.toUpperCase() })).toThrow('separate approved OAuth client');
  });

  it('denies missing expiry, wrong audience and wrong tenant using real signature verification', async () => {
    for (const overrides of [{ exp: undefined }, { aud: other }, { tid: other }]) {
      await expect(verifier()(await token(overrides))).rejects.toEqual(new AuthenticationDenied(401));
    }
  });

  it('never turns connector identity into a general owner, Factory, tool, health-upload or export capability', async () => {
    const app = fixture();
    const headers = { authorization: `Bearer ${await token()}` };
    const allowed = await app.inject({ method: 'POST', url: dailyMcpPath, headers, payload: {} });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({ owner: config.auth.ownerObjectId, principal: null, connector: 'jarvis-daily-connector' });
    for (const url of ['/me', '/tools', '/factory/projects', '/daily/query', '/synthetic-wrong-mcp-path']) {
      expect((await app.inject({ url, headers })).statusCode).toBe(403);
    }
    for (const url of ['/daily/health-upload', '/daily/nutrition-export/claim']) {
      expect((await app.inject({ method: 'POST', url, headers, payload: {} })).statusCode).toBe(403);
    }
  });

  it('limits public discovery to the exact installed metadata path and advertises its trusted challenge URL', async () => {
    const app = fixture();
    expect((await app.inject(dailyMcpMetadataPath)).statusCode).toBe(200);
    expect((await app.inject('/synthetic-wrong-metadata-path')).statusCode).toBe(401);
    const denied = await app.inject({ method: 'POST', url: dailyMcpPath, payload: {} });
    expect(denied.statusCode).toBe(401);
    expect(denied.headers['www-authenticate']).toBe(
      'Bearer resource_metadata="https://fixture.test/.well-known/oauth-protected-resource/daily/mcp"',
    );
  });
});
