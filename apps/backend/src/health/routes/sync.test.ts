import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../config.js';
import { installAuthentication } from '../../auth/hook.js';
import { HealthPayloadError } from '../health/value.js';
import { deviceSyncRoutes } from './sync.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const owner = config.auth.ownerObjectId;
const foreign = '22222222-2222-4222-8222-222222222222';
const apps: FastifyInstance[] = [];
const headers = (kind = 'owner') => ({ authorization: ['Bearer', `${kind}.a.b`].join(' ') });
const payload = { samples: [{ id: 'a', metric: 'step_count', unit: 'count', start: '2026-11-04T08:00:00Z', end: '2026-11-04T08:05:00Z', value: 10 }] };

function fixture() {
  const app = Fastify(); apps.push(app);
  app.decorate('ownerObjectId', owner);
  app.setErrorHandler((error: FastifyError, _request, reply) => reply.code(error.statusCode ?? 502).send({ error: 'Denied or unavailable' }));
  installAuthentication(app, config, async token => {
    if (token.startsWith('agent.')) return { kind: 'jarvis-agent', objectId: foreign, tenantId: config.auth.tenantId };
    return { objectId: token.startsWith('other.') ? foreign : owner, tenantId: config.auth.tenantId, displayName: 'Synthetic' };
  });
  const store = { apply: vi.fn(async () => ({ status: 'applied' as const, id: 'ios-x', receivedAt: '2026-11-04T10:00:00.000Z', counts: { metrics: 1 } })) };
  const access = vi.fn(() => store);
  void app.register(deviceSyncRoutes(access));
  return { app, store, access };
}

afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

describe('POST /health/sync', () => {
  it('applies a valid batch for the owner and is no-store', async () => {
    const f = fixture();
    const response = await f.app.inject({ method: 'POST', url: '/health/sync', headers: headers(), payload: { ...payload, anchor: '2026-11-04T00:00:00Z' } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({ status: 'applied', anchor: '2026-11-04T00:00:00.000Z' });
    expect(f.store.apply).toHaveBeenCalledTimes(1);
  });

  it('reports a replay from the store', async () => {
    const f = fixture();
    f.store.apply.mockResolvedValueOnce({ status: 'replayed' as never, id: 'ios-x', receivedAt: 'r', counts: {} });
    const response = await f.app.inject({ method: 'POST', url: '/health/sync', headers: headers(), payload });
    expect(response.json().status).toBe('replayed');
  });

  it('rejects invalid input before the store and never echoes it', async () => {
    const f = fixture();
    const response = await f.app.inject({ method: 'POST', url: '/health/sync', headers: headers(), payload: { samples: [{ id: 'a', metric: 'Bad Metric!' }] } });
    expect(response.statusCode).toBe(400);
    expect(f.store.apply).not.toHaveBeenCalled();
    expect((await f.app.inject({ method: 'POST', url: '/health/sync?owner=x', headers: headers(), payload })).statusCode).toBe(400);
  });

  it('maps normaliser rejection to 400 and storage failure to 503 without detail', async () => {
    const f = fixture();
    f.store.apply.mockRejectedValueOnce(new HealthPayloadError('unsupported_unit'));
    expect((await f.app.inject({ method: 'POST', url: '/health/sync', headers: headers(), payload })).statusCode).toBe(400);
    f.store.apply.mockRejectedValueOnce(new Error('connection string leaked'));
    const failed = await f.app.inject({ method: 'POST', url: '/health/sync', headers: headers(), payload });
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain('leaked');
  });

  it('denies unauthenticated, other-user and agent callers without touching the store', async () => {
    const f = fixture();
    expect((await f.app.inject({ method: 'POST', url: '/health/sync', payload })).statusCode).toBe(401);
    expect((await f.app.inject({ method: 'POST', url: '/health/sync', headers: headers('other'), payload })).statusCode).toBe(403);
    expect([401, 403]).toContain((await f.app.inject({ method: 'POST', url: '/health/sync', headers: headers('agent'), payload })).statusCode);
    expect(f.store.apply).not.toHaveBeenCalled();
    expect(f.access).not.toHaveBeenCalled();
  });
});
