import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../config.js';
import { installAuthentication } from '../../auth/hook.js';
import { ToolFailure } from '../../core/tool-registry.js';
import { workoutRoutes } from './workouts.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const owner = config.auth.ownerObjectId;
const foreign = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const key = '44444444-4444-4444-8444-444444444444';
const entry = {
  id, sessionType: 'cardio', title: null, startedAt: '2026-10-30T12:00:00.000Z', durationMinutes: 30, note: null,
  deletedAt: null, updatedAt: '2026-10-30T12:00:00.000Z', revision: 1, vault: 'pending',
};
const apps: FastifyInstance[] = [];
const headers = (kind = 'owner') => ({ authorization: ['Bearer', `${kind}.a.b`].join(' ') });

function fixture() {
  const app = Fastify(); apps.push(app);
  app.decorate('ownerObjectId', owner);
  app.setErrorHandler((error: FastifyError, _request, reply) => reply.code(error.statusCode ?? 502).send({ error: 'Denied or unavailable' }));
  installAuthentication(app, config, async token => {
    if (token.startsWith('agent.')) return { kind: 'jarvis-agent', objectId: foreign, tenantId: config.auth.tenantId };
    if (token.startsWith('runner.')) return { kind: 'jarvis-runner', objectId: foreign, tenantId: config.auth.tenantId };
    if (token.startsWith('connector.')) return {
      kind: 'jarvis-daily-connector', objectId: owner, tenantId: config.auth.tenantId, clientId: foreign, scopes: ['Daily.Nutrition.Read'],
    };
    return { objectId: token.startsWith('other.') ? foreign : owner, tenantId: config.auth.tenantId, displayName: 'Synthetic' };
  });
    const store = {
    history: vi.fn(async () => ({ items: [entry] })),
    create: vi.fn(async () => ({ entry, replayed: false })),
    update: vi.fn(async () => entry),
    delete: vi.fn(async () => ({ ...entry, deletedAt: '2026-10-30T13:00:00.000Z' })),
  };
  const access = vi.fn(() => store);
  void app.register(workoutRoutes(access));
  return { app, store, access };
}

afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

describe('POST /daily/workouts', () => {
  it('creates a validated workout, reports the pending vault copy and is no-store', async () => {
    const f = fixture();
    const response = await f.app.inject({ method: 'POST', url: '/daily/workouts', headers: headers(), payload: { idempotencyKey: key, sessionType: 'cardio', durationMinutes: 30 } });
    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json().entry.vault).toBe('pending');
    expect(f.store.create).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: key, sessionType: 'cardio', durationMinutes: 30 }), expect.any(AbortSignal));
  });

  it('answers 200 for an idempotent replay', async () => {
    const f = fixture();
    f.store.create.mockResolvedValueOnce({ entry, replayed: true });
    expect((await f.app.inject({ method: 'POST', url: '/daily/workouts', headers: headers(), payload: { idempotencyKey: key, sessionType: 'cardio' } })).statusCode).toBe(200);
  });

  it.each([
    ['missing key', { sessionType: 'cardio' }],
    ['bad type', { idempotencyKey: key, sessionType: 'x' }],
    ['unknown field', { idempotencyKey: key, sessionType: 'cardio', owner: foreign }],
  ])('rejects %s without writing', async (_label, payload) => {
    const f = fixture();
    expect((await f.app.inject({ method: 'POST', url: '/daily/workouts', headers: headers(), payload })).statusCode).toBe(400);
    expect(f.store.create).not.toHaveBeenCalled();
  });

  it('returns a sanitized unavailable response', async () => {
    const f = fixture();
    f.store.create.mockRejectedValueOnce(new ToolFailure('Workout could not be saved.'));
    const response = await f.app.inject({ method: 'POST', url: '/daily/workouts', headers: headers(), payload: { idempotencyKey: key, sessionType: 'cardio' } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Workout could not be saved.' });
  });
});

describe('GET /daily/workouts', () => {
  it('lists recent workouts with a bounded day window', async () => {
    const f = fixture();
    const response = await f.app.inject({ method: 'GET', url: '/daily/workouts?days=14&limit=20', headers: headers() });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(f.store.history).toHaveBeenCalledWith({ limit: 20, days: 14 }, expect.any(AbortSignal));
    await f.app.inject({ method: 'GET', url: '/daily/workouts', headers: headers() });
    expect(f.store.history).toHaveBeenLastCalledWith({ limit: 50 }, expect.any(AbortSignal));
  });

  it.each(['days=5', 'limit=0', 'limit=101', 'limit=x', 'owner=foreign', 'days=7&days=14'])('rejects %s', async query => {
    const f = fixture();
    expect((await f.app.inject({ method: 'GET', url: `/daily/workouts?${query}`, headers: headers() })).statusCode).toBe(400);
    expect(f.store.history).not.toHaveBeenCalled();
  });

  it('is owner-only', async () => {
    const f = fixture();
    expect((await f.app.inject({ method: 'GET', url: '/daily/workouts' })).statusCode).toBe(401);
    for (const kind of ['other', 'agent', 'runner', 'connector']) {
      expect((await f.app.inject({ method: 'GET', url: '/daily/workouts', headers: headers(kind) })).statusCode).toBe(403);
    }
    expect(f.access).not.toHaveBeenCalled();
  });
});

describe('PATCH and DELETE /daily/workouts/:id', () => {
  it('updates, soft-deletes and reports missing entries', async () => {
    const f = fixture();
    const updated = await f.app.inject({ method: 'PATCH', url: `/daily/workouts/${id}`, headers: headers(), payload: { durationMinutes: 40 } });
    expect(updated.statusCode).toBe(200);
    expect(f.store.update).toHaveBeenCalledWith(id, { durationMinutes: 40 }, expect.any(AbortSignal));
    expect((await f.app.inject({ method: 'DELETE', url: `/daily/workouts/${id}`, headers: headers() })).json().entry.deletedAt).toBeTruthy();
    f.store.delete.mockResolvedValueOnce(null as never);
    expect((await f.app.inject({ method: 'DELETE', url: `/daily/workouts/${id}`, headers: headers() })).statusCode).toBe(404);
  });

  it('rejects service identities, malformed ids and query selectors', async () => {
    const f = fixture();
    for (const kind of ['other', 'agent', 'runner', 'connector']) {
      expect((await f.app.inject({ method: 'DELETE', url: `/daily/workouts/${id}`, headers: headers(kind) })).statusCode).toBe(403);
    }
    expect((await f.app.inject({ method: 'PATCH', url: '/daily/workouts/nope', headers: headers(), payload: { note: 'x' } })).statusCode).toBe(400);
    expect((await f.app.inject({ method: 'PATCH', url: `/daily/workouts/${id}?x=1`, headers: headers(), payload: { note: 'x' } })).statusCode).toBe(400);
    expect(f.access).not.toHaveBeenCalled();
  });
});
