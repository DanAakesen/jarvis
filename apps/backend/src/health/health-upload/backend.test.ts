import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { buildApp } from '../../app.js';
import { InMemoryOwnerSessionStore } from '../../auth/session/memory-store.js';
import { OwnerSessionService } from '../../auth/session/service.js';
import { loadConfig } from '../../config.js';
import { createLogger } from '../../logging.js';
import { HealthConflict,HealthUnavailable,healthUploadLimit,sha256,type HealthBuffer,type HealthCapability,type HealthReceipt } from './contracts.js';
import { SqlHealthCapabilities } from './sql-capabilities.js';
import type { HealthUploadOptions } from './server.js';

const config = loadConfig({});
const token = randomBytes(32).toString('base64url'); // Synthetic only, never logged.
const capability: HealthCapability = { version: 1,ownerObjectId: config.auth.ownerObjectId,deviceId: 'synthetic-phone',permissions: ['health-ingest','health-heartbeat'],expiresAt: '2099-01-01T00:00:00.000Z',revoked: false };
const body = '{"synthetic_private_marker":true,"data":{"metrics":[],"workouts":[]}}';
const headers = { authorization: `Bearer ${token}`,'content-type': 'application/json','automation-id': 'synthetic-automation','session-id': 'synthetic-session' };
const receipt: HealthReceipt = { acceptanceId: '33333333-3333-4333-8333-333333333333',acceptedAt: '2026-10-13T18:00:00.000Z',status: 'accepted',storage: 'sql',queue: 'pending',processing: 'not-confirmed',duplicate: false };
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
function fixture(overrides: HealthUploadOptions = {}) {
  const logs: string[] = [];
  const output = new Writable({ write(chunk: Buffer,_encoding,done) { logs.push(chunk.toString()); done(); } });
  const accept = vi.fn<HealthBuffer['accept']>(async () => receipt);
  const buffer: HealthBuffer = { owner: config.auth.ownerObjectId,accept };
  const verifier = overrides.verifier ?? vi.fn(async () => capability);
  const auth = vi.fn(async () => ({ objectId: config.auth.ownerObjectId,tenantId: config.auth.tenantId,displayName: 'Synthetic owner' }));
  const app = buildApp(config,createLogger(config,undefined,output),{ auth,healthUpload: { enabled: true,buffer,verifier,...overrides } });
  app.get('/synthetic-owner-route',async request => ({ owner: request.principal?.objectId }));
  app.post('/synthetic-owner-json',async request => ({ body: request.body }));
  app.post('/synthetic-opt-in',{ config: { jarvisHealthUpload: true } },async () => ({ shouldNotBypassAuth: true }));
  apps.push(app);
  return { app,accept,verifier,auth,logs };
}
const post = (app: ReturnType<typeof buildApp>,extra = {}) => app.inject({ method: 'POST',url: '/api/health/ingest',headers,payload: body,...extra });

describe('inactive SQL health composition in the existing backend',() => {
  it('keeps both paths absent by default and preserves public health/user authentication',async () => {
    const { app,accept,verifier,auth } = fixture({ enabled: false });
    expect((await post(app)).statusCode).toBe(401);
    expect((await post(app,{ headers: { ...headers,authorization: 'Bearer a.b.c' } })).statusCode).toBe(404);
    expect((await app.inject('/health')).statusCode).toBe(200);
    expect(accept).not.toHaveBeenCalled(); expect(verifier).not.toHaveBeenCalled(); expect(auth).toHaveBeenCalledTimes(1);
  });
  it('accepts only on the exact scoped paths, returning SQL pending, never processed',async () => {
    const { app,accept,verifier,auth,logs } = fixture();
    const response = await post(app);
    expect(response.statusCode).toBe(202); expect(response.json()).toEqual(receipt);
    expect(response.headers['cache-control']).toBe('no-store'); expect(auth).not.toHaveBeenCalled();
    expect(verifier).toHaveBeenCalledOnce();
    expect(accept).toHaveBeenCalledWith('upload',capability,{ automationId: 'synthetic-automation',sessionId: 'synthetic-session' },Buffer.from(body),expect.any(AbortSignal),sha256(token));
    expect((await app.inject({ url: '/synthetic-owner-route',headers })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST',url: '/synthetic-opt-in',headers })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET',url: '/api/health/ingest',headers })).statusCode).toBe(401);
    expect((await app.inject({ url: '/synthetic-owner-route',headers: { authorization: 'Bearer a.b.c' } })).statusCode).toBe(200);
    expect(logs.join('')).not.toContain(token); expect(logs.join('')).not.toContain('synthetic_private_marker');
    expect(logs.join('')).not.toContain('synthetic-session'); expect(logs.join('')).not.toContain('synthetic-automation');
  });
  it.each([
    { ...capability,revoked: true },{ ...capability,expiresAt: '2000-01-01T00:00:00Z' },
    { ...capability,ownerObjectId: '22222222-2222-4222-8222-222222222222' },{ ...capability,permissions: ['health-heartbeat'] },null,
  ])('rejects invalid/revoked/expired/foreign or wrong-scope devices before persistence %#',async value => {
    const { app,accept } = fixture({ verifier: async () => value as HealthCapability | null });
    expect((await post(app)).statusCode).toBe(403); expect(accept).not.toHaveBeenCalled();
  });
  it('rejects human JWTs, malformed identity/checksums and query credentials',async () => {
    const { app,accept } = fixture();
    expect((await post(app,{ headers: { ...headers,authorization: 'Bearer a.b.c' } })).statusCode).toBe(403);
    expect((await post(app,{ headers: { ...headers,'session-id': '' } })).statusCode).toBe(400);
    expect((await post(app,{ headers: { ...headers,checksum: '0'.repeat(64) } })).statusCode).toBe(409);
    expect((await post(app,{ url: '/api/health/ingest?token=synthetic' })).statusCode).toBe(400);
    expect(accept).not.toHaveBeenCalled();
  });
  it('retains source-compatible bodyless heartbeat without ingest permission',async () => {
    const { app,accept } = fixture({ verifier: async () => ({ ...capability,permissions: ['health-heartbeat'] }) });
    const response = await app.inject({ method: 'POST',url: '/api/health/heartbeat',headers: { authorization: `Bearer ${token}`,'shortcut-name': 'Synthetic shortcut' } });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual(receipt);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(accept.mock.calls[0]?.[0]).toBe('heartbeat');
    expect(accept.mock.calls[0]?.[3]).toEqual(Buffer.from(JSON.stringify({ shortcutName: 'Synthetic shortcut',checkedFeeds: ['metrics','workouts'] })));
  });
  it('does not acknowledge until persistence resolves and sanitizes database failures',async () => {
    let commit!: (value: HealthReceipt) => void;
    const accept = vi.fn(() => new Promise<HealthReceipt>(resolve => { commit = resolve; }));
    const { app } = fixture({ buffer: { owner: capability.ownerObjectId,accept } });
    let answered = false;
    const pending = post(app).then(response => { answered = true; return response; });
    await vi.waitFor(() => expect(accept).toHaveBeenCalledOnce());
    expect(answered).toBe(false); commit(receipt); expect((await pending).statusCode).toBe(202);
    for (const error of [new HealthUnavailable(),new Error('synthetic_sql_private_detail')]) {
      const failed = fixture({ buffer: { owner: capability.ownerObjectId,accept: async () => { throw error; } } });
      const result = await post(failed.app);
      expect(result.statusCode).toBe(503); expect(result.json()).toEqual({ error: 'Health acceptance unavailable' });
      expect(failed.logs.join('')).not.toContain('synthetic_sql_private_detail');
    }
    const conflict = fixture({ buffer: { owner: capability.ownerObjectId,accept: async () => { throw new HealthConflict(); } } });
    expect((await post(conflict.app)).statusCode).toBe(409);
  });
  it('rate-limits invalid credentials before any verifier/database call and ignores spoofed forwarding',async () => {
    const { app,verifier,accept } = fixture({ ratePolicy: { perClient: 1,perInstance: 2,windowMs: 60000 },verifier: vi.fn(async () => null) });
    const first = await post(app,{ headers: { ...headers,'x-forwarded-for': '192.0.2.1' } });
    expect(first.statusCode).toBe(403);
    const second = await post(app,{ headers: { ...headers,'x-forwarded-for': '192.0.2.2' } });
    expect(second.statusCode).toBe(429); expect(second.headers['retry-after']).toBeDefined();
    expect(verifier).toHaveBeenCalledOnce(); expect(accept).not.toHaveBeenCalled();
  });
  it('keeps the 8 MiB ingress limit scoped to health and rejects malformed bytes',async () => {
    const { app,accept } = fixture();
    expect((await post(app,{ payload: `"${'x'.repeat(healthUploadLimit)}"` })).statusCode).toBe(413);
    expect((await post(app,{ payload: Buffer.from([0xff,0xfe]) })).statusCode).toBe(400);
    expect(accept).not.toHaveBeenCalled();
    const ownerHeaders = { authorization: 'Bearer a.b.c','content-type': 'application/json' };
    expect((await app.inject({ method: 'POST',url: '/synthetic-owner-json',headers: ownerHeaders,payload: '{"synthetic":true}' })).json()).toEqual({ body: { synthetic: true } });
    expect((await app.inject({ method: 'POST',url: '/synthetic-owner-json',headers: ownerHeaders,payload: `"${'x'.repeat(1024 * 1024)}"` })).statusCode).toBe(413);
  });
  it('bounds active SQL acceptance requests and releases slots after completion',async () => {
    const commits: Array<(value: HealthReceipt) => void> = [];
    const accept = vi.fn<HealthBuffer['accept']>(() => new Promise(resolve => { commits.push(resolve); }));
    const { app } = fixture({ buffer: { owner: capability.ownerObjectId,accept } });
    const pending = Array.from({ length: 8 },() => post(app).then(response => response));
    await vi.waitFor(() => expect(accept).toHaveBeenCalledTimes(8));
    expect((await post(app)).statusCode).toBe(429);
    commits.forEach(commit => commit(receipt));
    expect((await Promise.all(pending)).every(response => response.statusCode === 202)).toBe(true);
    accept.mockResolvedValue(receipt);
    expect((await post(app)).statusCode).toBe(202);
  });
  it('propagates shutdown to an active acceptance and returns no successful receipt',async () => {
    const controller = new AbortController();
    const accept = vi.fn<HealthBuffer['accept']>((_kind,_capability,_identity,_body,signal) => new Promise((_resolve,reject) => {
      signal.addEventListener('abort',() => reject(new HealthUnavailable()),{ once: true });
    }));
    const { app } = fixture({ shutdownSignal: controller.signal,buffer: { owner: capability.ownerObjectId,accept } });
    const pending = post(app).then(response => response);
    await vi.waitFor(() => expect(accept).toHaveBeenCalledOnce());
    controller.abort();
    expect((await pending).statusCode).toBe(503);
  });
  it('fails closed on missing configuration, shutdown and owner mismatch',async () => {
    for (const options of [{ buffer: undefined },{ verifier: undefined },{ shutdownSignal: AbortSignal.abort() }]) {
      expect((await post(fixture(options).app)).statusCode).toBe(503);
    }
    expect(() => fixture({ buffer: { owner: '22222222-2222-4222-8222-222222222222',accept: async () => receipt } })).toThrow('owner mismatch');
  });
  it('keeps credential lifecycle routes owner-authenticated, no-store and one-time revealed',async () => {
    const lifecycle = new SqlHealthCapabilities({} as ConstructorParameters<typeof SqlHealthCapabilities>[0],config.auth.ownerObjectId);
    const getStatus = vi.fn(async () => ({ state: 'empty' as const,expiresAt: null }));
    const prepare = vi.fn((input: Parameters<SqlHealthCapabilities['prepare']>[0]) => lifecycle.prepare(input));
    const create = vi.fn(async () => ({ state: 'issued' as const }));
    const rotateCurrent = vi.fn(async () => ({ state: 'issued' as const }));
    const revokeCurrent = vi.fn(async () => ({ state: 'revoked' as const }));
    const capabilities = { status: getStatus,prepare,create,rotateCurrent,revokeCurrent } as unknown as SqlHealthCapabilities;
    const auth = vi.fn(async (value: string) => ({
      objectId: value === 'header.foreign.signature' ? '22222222-2222-4222-8222-222222222222' : config.auth.ownerObjectId,
      tenantId: config.auth.tenantId,displayName: 'Synthetic owner',
    }));
    const sessions = new OwnerSessionService({
      store: new InMemoryOwnerSessionStore(),
      ownerObjectId: config.auth.ownerObjectId,
      tenantId: config.auth.tenantId,
    });
    const session = await sessions.create({
      ownerObjectId: config.auth.ownerObjectId,
      displayName: 'Synthetic owner',
      deviceLabel: 'Synthetic device',
    });
    const sessionHeaders = { authorization: ['Bearer',session.token].join(' ') };
    const logs: string[] = [];
    const output = new Writable({ write(chunk: Buffer,_encoding,done) { logs.push(chunk.toString()); done(); } });
    const sessionConfig = { ...config,ownerSessionEnabled: true };
    const app = buildApp(sessionConfig,createLogger(sessionConfig,undefined,output),{
      auth,ownerSessions: sessions,healthCapabilities: capabilities,healthUpload: { enabled: true },
    });
    apps.push(app);

    const anonymous = await app.inject('/api/health/upload-credential');
    expect(anonymous.statusCode).toBe(401);
    const headers = { authorization: ['Bearer','header.owner.signature'].join(' ') };
    expect((await app.inject({ url: '/api/health/upload-credential',headers: { authorization: ['Bearer','header.foreign.signature'].join(' ') } })).statusCode).toBe(403);
    const status = await app.inject({ url: '/api/health/upload-credential',headers });
    expect(status.statusCode).toBe(200);
    expect(status.headers['cache-control']).toBe('no-store');
    expect(status.json()).toEqual({ state: 'empty',expiresAt: null });

    const sessionStatus = await app.inject({ url: '/api/health/upload-credential',headers: sessionHeaders });
    expect(sessionStatus.statusCode).toBe(200);
    expect(sessionStatus.json()).toEqual({ state: 'empty',expiresAt: null });
    expect(getStatus).toHaveBeenCalledTimes(2);
    for (const action of ['create','rotate','revoke'] as const) {
      const response = await app.inject({
        method: 'POST',url: '/api/health/upload-credential',headers: sessionHeaders,payload: { action },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'Microsoft sign-in required' });
    }
    expect(prepare).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(rotateCurrent).not.toHaveBeenCalled();
    expect(revokeCurrent).not.toHaveBeenCalled();

    const issued = await app.inject({ method: 'POST',url: '/api/health/upload-credential',headers,payload: { action: 'create' } });
    expect(issued.statusCode).toBe(200);
    expect(issued.headers['cache-control']).toBe('no-store');
    expect(issued.json()).toMatchObject({ state: 'created' });
    expect(issued.json().token).toMatch(/^[A-Za-z0-9_-]{43,256}$/u);
    expect(issued.json().expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(logs.join('')).not.toContain(issued.json().token);
    expect(create).toHaveBeenCalledOnce();
    expect(auth).toHaveBeenCalled();
    expect((await app.inject({ method: 'POST',url: '/api/health/upload-credential',headers,payload: { action: 'unknown' } })).statusCode).toBe(400);

    const rotated = await app.inject({ method: 'POST',url: '/api/health/upload-credential',headers,payload: { action: 'rotate' } });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.headers['cache-control']).toBe('no-store');
    expect(rotated.json()).toMatchObject({ state: 'rotated',token: expect.stringMatching(/^[A-Za-z0-9_-]{43,256}$/u) });
    expect(rotateCurrent).toHaveBeenCalledOnce();

    rotateCurrent.mockResolvedValueOnce({ state: 'conflict' } as never);
    const conflict = await app.inject({ method: 'POST',url: '/api/health/upload-credential',headers,payload: { action: 'rotate' } });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ error: 'Health credential changed' });

    const revoked = await app.inject({ method: 'POST',url: '/api/health/upload-credential',headers,payload: { action: 'revoke' } });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.headers['cache-control']).toBe('no-store');
    expect(revoked.json()).toEqual({ state: 'revoked' });
    expect(revokeCurrent).toHaveBeenCalledOnce();
  });
});
