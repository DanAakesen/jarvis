import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { installConditionalGet } from './conditional-get.js';

async function build() {
  const app = Fastify();
  installConditionalGet(app);
  app.get('/status', async () => ({ ok: true }));
  app.get('/other', async () => ({ ok: true }));
  app.get('/usage', async (_request, reply) => reply.code(500).send({ error: 'boom' }));
  app.post('/settings', async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('conditional GET', () => {
  it('adds a stable ETag to cacheable GET routes', async () => {
    const app = await build();
    const first = await app.inject({ method: 'GET', url: '/status' });
    const second = await app.inject({ method: 'GET', url: '/status' });
    expect(first.statusCode).toBe(200);
    expect(first.headers.etag).toMatch(/^"[A-Za-z0-9_-]{27}"$/);
    expect(second.headers.etag).toBe(first.headers.etag);
    expect(first.headers['cache-control']).toBe('private, no-cache');
    expect(first.json()).toEqual({ ok: true });
  });

  it('answers 304 without a body when If-None-Match matches', async () => {
    const app = await build();
    const etag = (await app.inject({ method: 'GET', url: '/status' })).headers.etag as string;
    const hit = await app.inject({ method: 'GET', url: '/status', headers: { 'if-none-match': etag } });
    expect(hit.statusCode).toBe(304);
    expect(hit.body).toBe('');
    expect(hit.headers.etag).toBe(etag);
    const weak = await app.inject({ method: 'GET', url: '/status', headers: { 'if-none-match': `W/${etag}` } });
    expect(weak.statusCode).toBe(304);
    const miss = await app.inject({ method: 'GET', url: '/status', headers: { 'if-none-match': '"other"' } });
    expect(miss.statusCode).toBe(200);
    expect(miss.json()).toEqual({ ok: true });
  });

  it('leaves other routes, methods and error responses alone', async () => {
    const app = await build();
    expect((await app.inject({ method: 'GET', url: '/other' })).headers.etag).toBeUndefined();
    expect((await app.inject({ method: 'POST', url: '/settings' })).headers.etag).toBeUndefined();
    const failed = await app.inject({ method: 'GET', url: '/usage' });
    expect(failed.statusCode).toBe(500);
    expect(failed.headers.etag).toBeUndefined();
  });
});
