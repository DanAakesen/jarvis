import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './logging.js';

const staticOrigin = 'https://fixture.azurestaticapps.net';
const config = loadConfig({ STATIC_WEB_APP_ORIGIN: staticOrigin });
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function fixture() {
  const records: string[] = [];
  const sink = { trackTrace: vi.fn(), flush: vi.fn(async () => {}), shutdown: vi.fn(async () => {}) };
  const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
  const app = buildApp(config, createLogger(config, sink, output), { auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan Aakesen' }) });
  apps.push(app);
  return { app, records, sink };
}

describe('Fastify backend', () => {
  it('returns a real 200 health response without credentials', async () => {
    const { app } = fixture();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
  it.each(['http://localhost:5173', staticOrigin])('allows only the approved origin %s', async (origin) => {
    const { app } = fixture();
    const response = await app.inject({ url: '/health', headers: { origin } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.headers.vary).toContain('Origin');
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });
  it.each(['https://unexpected.example', 'null', 'http://localhost:5174', 'http://127.0.0.1:5173', staticOrigin + '.evil.example', staticOrigin + '/', staticOrigin + ',http://localhost:5173'])('denies an unexpected origin %s', async (origin) => {
    const { app } = fixture();
    const response = await app.inject({ url: '/health', headers: { origin } });
    expect(response.statusCode).toBe(403);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('supports authenticated API preflight from the web origin', async () => {
    const { app } = fixture();
    const response = await app.inject({ method: 'OPTIONS', url: '/health', headers: { origin: staticOrigin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization,content-type,last-event-id' } });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(staticOrigin);
    expect(response.headers['access-control-allow-headers']).toBe('Authorization, Content-Type, Last-Event-ID');
  });
  it('rejects disallowed or malformed preflight', async () => {
    const { app } = fixture();
    expect((await app.inject({ method: 'OPTIONS', url: '/health', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'OPTIONS', url: '/health', headers: { origin: staticOrigin } })).statusCode).toBe(400);
  });
  it('exports structured request logs without inbound secrets or provider error text', async () => {
    const { app, records, sink } = fixture();
    app.get('/failure', async () => { throw new Error('provider-secret https://example.com?token=error-secret'); });
    const headers = { authorization: 'Bearer a.b.c', cookie: 'session=cookie-secret', 'x-request-id': 'request-id-secret' };
    const health = await app.inject({ url: '/health?token=query-secret', headers });
    const missing = await app.inject({ url: '/path-secret?token=missing-secret', headers });
    const failure = await app.inject({ url: '/failure?token=error-query-secret', headers });
    expect(health.statusCode).toBe(200);
    expect(missing.json()).toEqual({ error: 'Not found' });
    expect(failure.statusCode).toBe(500);
    expect(failure.json()).toEqual({ error: 'Internal server error' });
    const exported = JSON.stringify(sink.trackTrace.mock.calls);
    for (const text of [records.join(''), exported, missing.body, failure.body]) {
      expect(text).not.toMatch(/secret|Bearer|https:\/\/example/);
    }
    const completed = records.map((record) => JSON.parse(record)).filter((record) => record.msg === 'request.completed');
    expect(completed).toHaveLength(3);
    expect(completed[0]).toMatchObject({ service: 'jarvis-backend', method: 'GET', route: '/health', statusCode: 200, responseTime: expect.any(Number), reqId: expect.stringMatching(/^[\da-f-]{36}$/) });
    expect(sink.trackTrace).toHaveBeenCalledWith(expect.objectContaining({ message: 'request.failed', severity: 'Error', properties: expect.objectContaining({ statusCode: 500 }) }));
  });
  it('does not echo parser errors or request bodies', async () => {
    const { app, records } = fixture();
    const response = await app.inject({ method: 'POST', url: '/health', headers: { authorization: 'Bearer a.b.c', 'content-type': 'application/json' }, payload: '{"secret":"body-secret"' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Invalid request' });
    expect(records.join('')).not.toContain('body-secret');
  });
});
