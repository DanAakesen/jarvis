import { Writable } from 'node:stream';
import { ContainerClient } from '@azure/storage-blob';
import sql from 'mssql';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type BuildAppOptions } from './app.js';
import { loadConfig } from './config.js';
import { ConversationAttachmentStore } from './database/conversation-attachment-store.js';
import { createLogger } from './logging.js';

const staticOrigin = 'https://fixture.azurestaticapps.net';
const config = loadConfig({ STATIC_WEB_APP_ORIGIN: staticOrigin });
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.useRealTimers();
});

function fixture(options: BuildAppOptions = {}) {
  const records: string[] = [];
  const sink = { trackTrace: vi.fn(), flush: vi.fn(async () => {}), shutdown: vi.fn(async () => {}) };
  const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
  const app = buildApp(config, createLogger(config, sink, output), {
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan Aakesen' }),
    ...options,
  });
  apps.push(app);
  return { app, records, sink };
}

function attachmentStoreFixture() {
  const store = new ConversationAttachmentStore({
    pool: new sql.ConnectionPool({ server: 'fixture.invalid', database: 'fixture' }),
    container: new ContainerClient('https://fixture.blob.core.windows.net/attachments'),
    storageAccount: 'fixturestore',
    artifacts: { privateReadUrl: async () => 'https://fixture.invalid/unused' },
    retentionDays: 30,
  });
  const cleanupExpired = vi.spyOn(store, 'cleanupExpired').mockResolvedValue(0);
  return { store, cleanupExpired };
}

describe('Fastify backend', () => {
  it('owns one attachment cleanup timer independently of post-listen re-embedding', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { store, cleanupExpired } = attachmentStoreFixture();
    const onEmbeddingModelChanged = vi.fn(async () => {});
    const { app } = fixture({ conversationAttachments: store, onEmbeddingModelChanged });

    expect(cleanupExpired).not.toHaveBeenCalled();
    await app.listen({ port: 0, host: '127.0.0.1' });
    expect(cleanupExpired).toHaveBeenCalledExactlyOnceWith(100);
    await app.onEmbeddingModelChanged?.(app.backgroundJobs);
    await app.onEmbeddingModelChanged?.(app.backgroundJobs);
    expect(onEmbeddingModelChanged).toHaveBeenCalledTimes(2);
    expect((await app.inject({ url: '/health' })).statusCode).toBe(200);

    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(cleanupExpired).toHaveBeenCalledTimes(2);
    await app.close();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(cleanupExpired).toHaveBeenCalledTimes(2);
  });
  it('starts cleanup without re-embedding and reports failures without private details', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { store, cleanupExpired } = attachmentStoreFixture();
    cleanupExpired.mockRejectedValue(new Error('private attachment storage details'));
    const { app, records, sink } = fixture({ conversationAttachments: store });

    await app.ready();
    await Promise.resolve();
    expect(cleanupExpired).toHaveBeenCalledExactlyOnceWith(100);
    expect(records.join('')).toContain('conversation_attachments.cleanup_failed');
    expect(JSON.stringify(sink.trackTrace.mock.calls)).toContain('conversation_attachments.cleanup_failed');
    expect(records.join('')).not.toContain('private attachment storage details');
    expect(JSON.stringify(sink.trackTrace.mock.calls)).not.toContain('private attachment storage details');
    expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
    await app.close();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(cleanupExpired).toHaveBeenCalledOnce();
  });
  it('reports the in-memory database wait without querying SQL or caching status', async () => {
    let waking = true;
    const databaseStatus = vi.fn(() => waking);
    const app = buildApp(config, undefined, {
      databaseStatus,
      auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan Aakesen' }),
    });
    apps.push(app);
    const headers = { authorization: `${['Bear', 'er'].join('')} ${['a', 'b', 'c'].join('.')}` };
    const response = await app.inject({ url: '/database/status', headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ waking: true });
    expect(response.headers['cache-control']).toBe('no-store');
    waking = false;
    expect((await app.inject({ url: '/database/status', headers })).json()).toEqual({ waking: false });
    expect(databaseStatus).toHaveBeenCalledTimes(2);
  });
  it('does not expose database status to unauthenticated requests', async () => {
    const { app } = fixture();
    const response = await app.inject({ url: '/database/status' });
    expect(response.statusCode).toBe(401);
  });
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
    app.post('/failure/:name', async () => { throw new Error('provider-secret https://example.com?token=error-secret'); });
    const headers = { authorization: 'Bearer a.b.c', cookie: 'session=cookie-secret', 'x-request-id': 'request-id-secret' };
    const health = await app.inject({ url: '/health?token=query-secret', headers });
    const missing = await app.inject({ url: '/path-secret?token=missing-secret', headers });
    const failure = await app.inject({
      method: 'POST', url: '/failure/path-secret?token=error-query-secret',
      headers: { ...headers, 'x-private-header': 'header-secret' },
      payload: { private: 'body-secret' },
    });
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
    const started = records.map((record) => JSON.parse(record)).filter((record) => record.msg === 'request.started');
    expect(started).toHaveLength(3);
    expect(started.find((record) => record.route === '/failure/:name')).toMatchObject({
      method: 'POST', route: '/failure/:name', reqId: expect.stringMatching(/^[\da-f-]{36}$/),
    });
    expect(sink.trackTrace).toHaveBeenCalledWith(expect.objectContaining({
      message: 'request.failed', severity: 'Error',
      properties: expect.objectContaining({ statusCode: 500, route: '/failure/:name', kind: 'internal' }),
    }));
    expect(records.map((record) => JSON.parse(record)).find((record) => record.msg === 'request.failed'))
      .toMatchObject({ route: '/failure/:name', kind: 'internal', statusCode: 500 });
  });
  it('does not echo parser errors or request bodies', async () => {
    const { app, records } = fixture();
    const response = await app.inject({ method: 'POST', url: '/health', headers: { authorization: 'Bearer a.b.c', 'content-type': 'application/json' }, payload: '{"secret":"body-secret"' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Invalid request' });
    expect(records.join('')).not.toContain('body-secret');
  });
});
