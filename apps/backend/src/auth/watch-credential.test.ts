import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type BuildAppOptions } from '../app.js';
import { loadConfig } from '../config.js';
import { createLogger } from '../logging.js';
import type { HealthBuffer, HealthCredentialVerifier } from '../health/health-upload/contracts.js';
import { AuthenticationDenied } from './verify.js';
import { WatchCredentials, type WatchCredentialStore, watchCredentialPath, watchTranscriptionPath } from './watch-credential.js';

const config = loadConfig({});
const authorization = (token: string) => `${['Bear', 'er'].join('')} ${token}`;
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  vi.useRealTimers();
});

function fixture(options: BuildAppOptions = {}) {
  let row: { owner: string; hash: Buffer; expiresAt: Date } | null = null;
  const store: WatchCredentialStore = {
    rotate: vi.fn(async (owner, hash) => {
      row = { owner, hash, expiresAt: new Date(Date.now() + 86_400_000) };
      return row.expiresAt;
    }),
    verify: vi.fn(async (owner, hash) =>
      row !== null && row.owner === owner && row.hash.equals(hash) && row.expiresAt.getTime() > Date.now()),
    revoke: vi.fn(async () => { row = null; }),
  };
  const records: string[] = [];
  const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
  const credentials = new WatchCredentials(store, config.auth.ownerObjectId);
  const auth = vi.fn(async (token: string) => {
    if (token !== 'owner.fixture.token') throw new AuthenticationDenied(401);
    return { objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan' };
  });
  const transcribe = vi.fn(async () => 'private speech');
  const app = buildApp(config, createLogger(config, undefined, output), {
    auth, watchCredentials: credentials, watchTranscriber: transcribe, ...options,
  });
  apps.push(app);
  const headers = { authorization: authorization('owner.fixture.token') };
  const issue = () => app.inject({ method: 'POST', url: watchCredentialPath, headers });
  return { app, store, credentials, transcribe, auth, headers, issue, records };
}

describe('Watch-only credential boundary', () => {
  it('issues only with normal owner auth, persists only hashes, expires, rotates and revokes across service instances', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const f = fixture();
    expect((await f.app.inject({ method: 'POST', url: watchCredentialPath })).statusCode).toBe(401);
    const issued = await f.issue();
    expect(issued.statusCode).toBe(200);
    expect(issued.headers['cache-control']).toBe('no-store');
    const { credential, expiresAt } = issued.json<{ credential: string; expiresAt: string }>();
    expect(credential).toMatch(/^jw\.[A-Za-z0-9_-]{43}$/u);
    expect(new Date(expiresAt).getTime() - Date.now()).toBe(86_400_000);
    expect(f.store.rotate).toHaveBeenLastCalledWith(config.auth.ownerObjectId, createHash('sha256').update(credential).digest());
    expect((await f.app.inject({
      method: 'POST', url: watchTranscriptionPath, headers: f.headers, payload: { audio: 'AAA=' },
    })).statusCode).toBe(200);
    const restarted = new WatchCredentials(f.store, config.auth.ownerObjectId);
    expect(await restarted.verify(credential)).toBe(true);
    const transcribe = () => f.app.inject({
      method: 'POST', url: watchTranscriptionPath, headers: { authorization: authorization(credential) }, payload: { audio: 'AAA=' },
    });
    expect((await transcribe()).statusCode).toBe(200);
    vi.setSystemTime(new Date(expiresAt));
    expect((await transcribe()).statusCode).toBe(401);
    const next = (await f.issue()).json<{ credential: string }>().credential;
    expect(next).not.toBe(credential);
    expect(await restarted.verify(credential)).toBe(false);
    expect(await restarted.verify(next)).toBe(true);
    expect((await f.app.inject({ method: 'DELETE', url: watchCredentialPath, headers: f.headers })).statusCode).toBe(204);
    expect(await restarted.verify(next)).toBe(false);
    expect(f.records.join('')).not.toContain(credential);
    expect(f.records.join('')).not.toContain(next);
    expect(f.records.join('')).not.toContain('private speech');
    expect(f.records.join('')).toContain('"stage":"credential_verified"');
  });

  it('logs request acceptance before credential verification using request-relative timings', async () => {
    const f = fixture();
    const { credential } = (await f.issue()).json<{ credential: string }>();
    let entered!: () => void;
    let finish!: (valid: boolean) => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    vi.mocked(f.store.verify).mockImplementation(() => {
      entered();
      return new Promise<boolean>(resolve => { finish = resolve; });
    });
    const pending = Promise.resolve(f.app.inject({
      method: 'POST', url: watchTranscriptionPath,
      headers: { authorization: authorization(credential) }, payload: { audio: 'AAA=' },
    }));
    await started;
    const stages = () => f.records.map(record => JSON.parse(record) as {
      msg?: string; stage?: string; durationMs?: number; reqId?: string;
    }).filter(record => record.msg === 'watch_transcription.stage');
    expect(stages().map(record => record.stage)).toEqual(['request_accepted']);
    finish(true);
    expect((await pending).statusCode).toBe(200);
    const [accepted, verified] = stages();
    expect(verified?.stage).toBe('credential_verified');
    expect(accepted?.reqId).toBeDefined();
    expect(verified?.reqId).toBe(accepted?.reqId);
    expect(accepted?.durationMs).toEqual(expect.any(Number));
    expect(verified?.durationMs).toBeGreaterThanOrEqual(accepted!.durationMs!);
    expect(f.records.join('')).not.toContain(credential);
    expect(f.records.join('')).not.toContain('private speech');
  });

  it('enforces the request deadline while Watch credential verification is pending', async () => {
    const f = fixture();
    const { credential } = (await f.issue()).json<{ credential: string }>();
    let entered!: () => void;
    let finish!: (valid: boolean) => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    vi.mocked(f.store.verify).mockImplementation(() => {
      entered();
      return new Promise<boolean>(resolve => { finish = resolve; });
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pending = Promise.resolve(f.app.inject({
      method: 'POST', url: watchTranscriptionPath,
      headers: { authorization: authorization(credential) }, payload: { audio: 'AAA=' },
    }));
    await started;
    await vi.advanceTimersByTimeAsync(20_000);
    const response = await pending;
    expect(response.statusCode).toBe(504);
    expect(response.json()).toEqual({ error: 'Transcription timed out' });
    finish(true);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(f.records.join('')).toContain('"stage":"credential_verified"');
    expect(f.transcribe).not.toHaveBeenCalled();
    expect(f.records.join('')).not.toContain(credential);
  });

  it('denies credential escalation, all other methods/routes, malformed and duplicate authorization', async () => {
    const f = fixture();
    const { credential } = (await f.issue()).json<{ credential: string }>();
    const headers = { authorization: authorization(credential) };
    for (const [method, url] of [
      ['POST', watchCredentialPath], ['DELETE', watchCredentialPath],
      ['GET', watchTranscriptionPath], ['HEAD', watchTranscriptionPath],
      ['OPTIONS', watchTranscriptionPath], ['PUT', watchTranscriptionPath],
      ['POST', '/watch/transcribe'], ['GET', '/status'], ['GET', '/voice'],
      ['POST', '/voice/watch/transcribe/other'], ['GET', '/tools'],
    ] as const) {
      const result = await f.app.inject({ method, url, headers });
      expect(result.statusCode, `${method} ${url}`).toBe(403);
    }
    expect((await f.app.inject({
      method: 'POST', url: watchTranscriptionPath,
      headers: { authorization: [authorization(credential), authorization('owner.fixture.token')] }, payload: { audio: 'AAA=' },
    })).statusCode).toBe(401);
    expect((await f.app.inject({
      method: 'POST', url: watchTranscriptionPath,
      headers: { authorization: authorization('jw.invalid') }, payload: { audio: 'AAA=' },
    })).statusCode).toBe(401);
    expect(f.auth).toHaveBeenCalledTimes(1);
    expect(f.transcribe).not.toHaveBeenCalled();
  });

  it('rejects non-owner and service issuance, arbitrary TTLs and store failures without leaking details', async () => {
    for (const auth of [
      async () => ({ objectId: 'other-owner', tenantId: config.auth.tenantId, displayName: 'Other' }),
      async () => ({ kind: 'jarvis-agent' as const, objectId: 'agent', tenantId: config.auth.tenantId }),
    ]) {
      const f = fixture({ auth });
      expect((await f.issue()).statusCode).toBe(403);
      expect((await f.app.inject({ method: 'DELETE', url: watchCredentialPath, headers: f.headers })).statusCode).toBe(403);
      expect(f.store.rotate).not.toHaveBeenCalled();
      expect(f.store.revoke).not.toHaveBeenCalled();
    }
    const f = fixture();
    expect((await f.app.inject({
      method: 'POST', url: watchCredentialPath, headers: f.headers, payload: { ttl: 172_800 },
    })).statusCode).toBe(400);
    expect((await f.app.inject({
      method: 'POST', url: watchCredentialPath, headers: f.headers, payload: { text: 'x'.repeat(1024) },
    })).statusCode).toBe(413);
    const { credential } = (await f.issue()).json<{ credential: string }>();
    vi.mocked(f.store.verify).mockRejectedValue(new Error('private database details'));
    expect((await f.app.inject({
      method: 'POST', url: watchTranscriptionPath, headers: { authorization: authorization(credential) }, payload: { audio: 'AAA=' },
    })).statusCode).toBe(503);
    vi.mocked(f.store.rotate).mockRejectedValue(new Error('private database details'));
    expect((await f.issue()).statusCode).toBe(503);
    vi.mocked(f.store.revoke).mockRejectedValue(new Error('private database details'));
    expect((await f.app.inject({ method: 'DELETE', url: watchCredentialPath, headers: f.headers })).statusCode).toBe(503);
    expect(f.records.join('')).not.toContain('private database details');
  });

  it('retains PCM/body, shared concurrency and transcription timeout limits for Watch credentials', async () => {
    const f = fixture();
    const { credential } = (await f.issue()).json<{ credential: string }>();
    const headers = { authorization: authorization(credential) };
    const call = (audio: string) => f.app.inject({ method: 'POST', url: watchTranscriptionPath, headers, payload: { audio } });
    expect((await call('AA==')).statusCode).toBe(400);
    expect((await call(Buffer.alloc(2_880_002).toString('base64'))).statusCode).toBe(400);
    expect((await call('A'.repeat(3_850_000))).statusCode).toBe(413);
    expect((await call(Buffer.alloc(2_880_000).toString('base64'))).statusCode).toBe(200);
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<string>(resolve => { release = () => resolve(''); });
    const both = new Promise<void>(resolve => { started = resolve; });
    let active = 0;
    f.transcribe.mockImplementation(async () => {
      if (++active === 2) started();
      return gate;
    });
    const pending = [
      Promise.resolve(call('AAA=')),
      Promise.resolve(f.app.inject({ method: 'POST', url: '/watch/transcribe', headers: f.headers, payload: { audio: 'AAA=' } })),
    ];
    try {
      await both;
      expect((await call('AAA=')).statusCode).toBe(429);
    } finally { release(); await Promise.all(pending); }
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let entered!: () => void;
    const running = new Promise<void>(resolve => { entered = resolve; });
    f.transcribe.mockImplementation(async () => { entered(); return new Promise<string>(() => {}); });
    const timeout = Promise.resolve(call('AAA='));
    await running;
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await timeout).statusCode).toBe(504);
  });

  it('bounds owner issuance after auth, with a separate bounded revocation budget', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const f = fixture();
    let credential = '';
    for (let count = 0; count < 6; count += 1) {
      const response = await f.app.inject({ method: 'POST', url: watchCredentialPath,
        headers: f.headers, remoteAddress: `192.0.2.${count + 1}` });
      expect(response.statusCode).toBe(200);
      credential = response.json<{ credential: string }>().credential;
    }
    const limitedIssue = await f.issue();
    expect(limitedIssue.statusCode).toBe(429);
    expect(Number(limitedIssue.headers['retry-after'])).toBeGreaterThan(0);
    expect(f.store.rotate).toHaveBeenCalledTimes(6);
    expect((await f.app.inject({ method: 'DELETE', url: watchCredentialPath, headers: f.headers })).statusCode).toBe(204);
    for (let count = 1; count < 30; count += 1) {
      expect((await f.app.inject({ method: 'DELETE', url: watchCredentialPath, headers: f.headers })).statusCode).toBe(204);
    }
    const limitedRevoke = await f.app.inject({ method: 'DELETE', url: watchCredentialPath, headers: f.headers });
    expect(limitedRevoke.statusCode).toBe(429);
    expect(limitedRevoke.headers['retry-after']).toBe('1');
    expect(f.store.revoke).toHaveBeenCalledTimes(30);
    vi.setSystemTime(Date.now() + 60_000);
    expect(await f.credentials.verify(credential)).toBe(false);
    expect((await f.issue()).statusCode).toBe(200);
  });

  it('stops well-formed unknown-token floods before SQL and bounds same-peer denial to one second', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const f = fixture();
    const { credential } = (await f.issue()).json<{ credential: string }>();
    const call = (token: string, remoteAddress = '192.0.2.1', forwarded = '203.0.113.1') => f.app.inject({
      method: 'POST', url: watchTranscriptionPath, remoteAddress,
      headers: { authorization: authorization(token), 'x-forwarded-for': forwarded, forwarded: `for=${forwarded}` },
      payload: { audio: 'AAA=' },
    });
    for (let count = 0; count < 30; count += 1) {
      const unknown = `jw.${Buffer.alloc(32, count).toString('base64url')}`;
      expect((await call(unknown, '192.0.2.1', `203.0.113.${count + 1}`)).statusCode).toBe(401);
    }
    const blocked = await Promise.all(Array.from({ length: 10 }, (_, count) =>
      call(`jw.${Buffer.alloc(32, count + 30).toString('base64url')}`, '192.0.2.1', `198.51.100.${count + 1}`)));
    expect(blocked.map(response => response.statusCode)).toEqual(Array(10).fill(429));
    expect(blocked.every(response => response.headers['retry-after'] === '1')).toBe(true);
    expect(f.store.verify).toHaveBeenCalledTimes(30);
    expect((await call(credential)).statusCode).toBe(429);
    expect(f.store.verify).toHaveBeenCalledTimes(30);
    expect((await call(credential, '192.0.2.2')).statusCode).toBe(200);
    vi.setSystemTime(Date.now() + 999);
    expect((await call(credential)).statusCode).toBe(429);
    vi.setSystemTime(Date.now() + 1);
    expect((await call(credential)).statusCode).toBe(200);
    expect(f.store.verify).toHaveBeenCalledTimes(32);
    expect(f.transcribe).toHaveBeenCalledTimes(2);
  });

  it('shares the authenticated hashed-credential budget across IPs without unknown-token consumption', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const f = fixture();
    const { credential } = (await f.issue()).json<{ credential: string }>();
    const call = (token: string, remoteAddress: string) => f.app.inject({
      method: 'POST', url: watchTranscriptionPath, remoteAddress,
      headers: { authorization: authorization(token) }, payload: { audio: 'AAA=' },
    });
    for (let count = 0; count < 30; count += 1) {
      expect((await call(`jw.${Buffer.alloc(32, count).toString('base64url')}`, '192.0.2.1')).statusCode).toBe(401);
      expect((await call(credential, `198.51.100.${count + 1}`)).statusCode).toBe(200);
    }
    const blocked = await call(credential, '192.0.2.2');
    expect(blocked.statusCode).toBe(429);
    expect(f.records.filter(record => record.includes('"stage":"credential_verified"'))).toHaveLength(31);
    expect(blocked.headers['retry-after']).toBe('60');
    expect(f.transcribe).toHaveBeenCalledTimes(30);
    vi.setSystemTime(Date.now() + 60_000);
    expect((await call(credential, '192.0.2.2')).statusCode).toBe(200);
    expect(f.records.join('')).not.toContain(credential);
    expect(f.records.join('')).not.toContain(createHash('sha256').update(credential).digest('hex'));
  });

  it('limits management before owner verification, without broadening auth or limiting unrelated routes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const f = fixture();
    for (const method of ['POST', 'DELETE'] as const) {
      f.auth.mockClear();
      for (let count = 0; count < 30; count += 1) {
        expect((await f.app.inject({ method, url: watchCredentialPath,
          headers: { authorization: authorization('unknown.fixture.token'), 'x-forwarded-for': `192.0.2.${count + 1}` },
        })).statusCode).toBe(401);
      }
      expect((await f.app.inject({ method, url: watchCredentialPath, headers: f.headers })).statusCode).toBe(429);
      expect(f.auth).toHaveBeenCalledTimes(30);
    }
    expect(f.store.rotate).not.toHaveBeenCalled();
    expect(f.store.revoke).not.toHaveBeenCalled();
    expect((await f.app.inject({ method: 'POST', url: '/watch/transcribe', headers: f.headers,
      payload: { audio: 'AAA=' } })).statusCode).toBe(200);
    expect((await f.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await f.app.inject({ method: 'GET', url: watchCredentialPath })).statusCode).toBe(401);
    expect((await f.app.inject({ method: 'POST', url: '/voice/watch/transcribe/other' })).statusCode).toBe(401);
    vi.setSystemTime(Date.now() + 1000);
    expect((await f.issue()).statusCode).toBe(200);
    expect((await f.app.inject({ method: 'DELETE', url: watchCredentialPath, headers: f.headers })).statusCode).toBe(204);
  });

  it('preserves nested health-upload client and instance limits before verification without sharing Watch budgets', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const verifier = vi.fn<HealthCredentialVerifier>(async () => ({
      version: 1, ownerObjectId: config.auth.ownerObjectId, deviceId: 'health-device',
      permissions: ['health-heartbeat'], expiresAt: new Date(Date.now() + 60_000).toISOString(), revoked: false,
    }));
    const accept = vi.fn<HealthBuffer['accept']>(async () => ({
      acceptanceId: 'fixture', acceptedAt: new Date().toISOString(), status: 'accepted',
      queue: 'pending', processing: 'not-confirmed', duplicate: false,
    }));
    const f = fixture({ healthUpload: {
      enabled: true, verifier, buffer: { owner: config.auth.ownerObjectId.toLowerCase(), accept },
      ratePolicy: { perClient: 2, perInstance: 4, windowMs: 60_000 },
    } });
    const { credential } = (await f.issue()).json<{ credential: string }>();
    const heartbeat = (remoteAddress: string) => f.app.inject({
      method: 'POST', url: '/api/health/heartbeat', remoteAddress,
      headers: { authorization: authorization('a'.repeat(43)) },
    });
    expect((await heartbeat('192.0.2.1')).statusCode).toBe(202);
    expect((await heartbeat('192.0.2.1')).statusCode).toBe(202);
    const clientLimited = await heartbeat('192.0.2.1');
    expect(clientLimited.statusCode).toBe(429);
    expect(clientLimited.headers['retry-after']).toBe('60');
    expect(verifier).toHaveBeenCalledTimes(2);
    expect((await heartbeat('192.0.2.2')).statusCode).toBe(202);
    const instanceLimited = await heartbeat('192.0.2.3');
    expect(instanceLimited.statusCode).toBe(429);
    expect(instanceLimited.headers['retry-after']).toBe('60');
    expect(verifier).toHaveBeenCalledTimes(3);
    expect(accept).toHaveBeenCalledTimes(3);
    expect(f.auth).toHaveBeenCalledTimes(1);
    expect((await f.app.inject({ method: 'POST', url: watchTranscriptionPath, remoteAddress: '192.0.2.1',
      headers: { authorization: authorization(credential) }, payload: { audio: 'AAA=' } })).statusCode).toBe(200);
    expect(f.store.verify).toHaveBeenCalledTimes(1);
    expect((await f.issue()).statusCode).toBe(200);
    vi.setSystemTime(Date.now() + 60_000);
    expect((await heartbeat('192.0.2.1')).statusCode).toBe(202);
  });
});
