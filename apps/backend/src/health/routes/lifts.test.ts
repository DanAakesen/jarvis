import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../config.js';
import { installAuthentication } from '../../auth/hook.js';
import { ToolFailure } from '../../core/tool-registry.js';
import { liftRoutes } from './lifts.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const owner = config.auth.ownerObjectId;
const foreign = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const key = '44444444-4444-4444-8444-444444444444';
const entry = {
  id, exerciseName: 'Bench press', weightKg: 80, reps: 4, sets: 3,
  performedAt: '2026-10-30T12:00:00.000Z', deletedAt: null as string | null, updatedAt: '2026-10-30T12:00:00.000Z', revision: 1,
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
    findByIdempotencyKey: vi.fn(async () => null as typeof entry | null),
    history: vi.fn(async () => ({ items: [entry], next: null })),
    create: vi.fn(async () => ({ entry, replayed: false })),
    update: vi.fn(async () => entry),
    delete: vi.fn(async () => ({ ...entry, deletedAt: '2026-10-30T13:00:00.000Z' })),
  };
  const access = vi.fn(() => store);
  const model = vi.fn(async () => JSON.stringify({ exerciseName: 'Bench press', weightKg: 80, reps: 3, sets: null, question: null }));
  void app.register(liftRoutes(access, model));
  return { app, store, access, model };
}

afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

describe('POST /health/lifts/capture', () => {
  it('saves via the owner lift store and returns the agreed discriminated response', async () => {
    const f = fixture();
    const response = await f.app.inject({ method: 'POST', url: '/health/lifts/capture', headers: headers(),
      payload: { idempotencyKey: key, text: 'Log bench 80 kg for 3 reps' } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({ status: 'saved', entry, replayed: false });
    expect(f.store.create).toHaveBeenCalledWith(expect.objectContaining({ reps: 3, sets: 1 }), expect.any(AbortSignal));
  });

  it('returns needsDetails without saving and replays existing keys without a model', async () => {
    const f = fixture();
    f.model.mockResolvedValueOnce(JSON.stringify({ exerciseName: 'Bench', weightKg: null, reps: 3, sets: null, question: 'How much weight?' }));
    const payload = { idempotencyKey: key, text: 'Log bench, 3 reps' };
    expect((await f.app.inject({ method: 'POST', url: '/health/lifts/capture', headers: headers(), payload })).json())
      .toEqual({ status: 'needsDetails', question: 'How much weight?' });
    expect(f.store.create).not.toHaveBeenCalled();
    f.store.findByIdempotencyKey.mockResolvedValueOnce(entry);
    expect((await f.app.inject({ method: 'POST', url: '/health/lifts/capture', headers: headers(),
      payload: { ...payload, text: 'changed text' } })).json()).toEqual({ status: 'saved', entry, replayed: true });
    expect(f.model).toHaveBeenCalledOnce();
  });

  it('rejects absent/non-owner/service identities before model or storage access', async () => {
    const f = fixture();
    const payload = { idempotencyKey: key, text: 'Bench 80 kg 3 reps' };
    expect((await f.app.inject({ method: 'POST', url: '/health/lifts/capture', payload })).statusCode).toBe(401);
    for (const kind of ['other', 'agent', 'runner', 'connector']) {
      expect((await f.app.inject({ method: 'POST', url: '/health/lifts/capture', headers: headers(kind), payload })).statusCode).toBe(403);
    }
    expect(f.access).not.toHaveBeenCalled(); expect(f.model).not.toHaveBeenCalled();
  });

  it('returns an explicit failure for a deleted idempotent entry without parsing or recreating it', async () => {
    const f = fixture();
    f.store.findByIdempotencyKey.mockResolvedValueOnce({ ...entry, deletedAt: '2026-11-10T12:00:00.000Z' });
    const response = await f.app.inject({ method: 'POST', url: '/health/lifts/capture', headers: headers(),
      payload: { idempotencyKey: key, text: 'Bench 80 kg 3 reps' } });
    expect(response.statusCode).toBe(410);
    expect(response.json()).toEqual({ error: 'This lift was deleted. Check history before starting a new lift.', code: 'lift_deleted' });
    expect(f.model).not.toHaveBeenCalled(); expect(f.store.create).not.toHaveBeenCalled();
  });

  it.each([
    { idempotencyKey: 'not-a-uuid', text: 'Bench 80 kg 3 reps' },
    { idempotencyKey: key, text: '' }, { idempotencyKey: key, text: ' ' },
    { idempotencyKey: key, text: 'x'.repeat(2001) }, { idempotencyKey: key, text: 'x\u0000y' },
    { idempotencyKey: key, text: 'Bench', owner }, { text: 'Bench' },
  ])('rejects invalid bounded input without parsing (%j)', async payload => {
    const f = fixture();
    expect((await f.app.inject({ method: 'POST', url: '/health/lifts/capture', headers: headers(), payload })).statusCode).toBe(400);
    expect(f.access).not.toHaveBeenCalled(); expect(f.model).not.toHaveBeenCalled();
  });

  it('rejects selectors/oversized bodies and sanitizes model failures', async () => {
    const f = fixture();
    const payload = { idempotencyKey: key, text: 'Bench 80 kg 3 reps' };
    expect((await f.app.inject({ method: 'POST', url: '/health/lifts/capture?owner=x', headers: headers(), payload })).statusCode).toBe(400);
    expect((await f.app.inject({ method: 'POST', url: '/health/lifts/capture', headers: headers(),
      payload: { ...payload, text: 'x'.repeat(20_000) } })).statusCode).toBe(413);
    f.model.mockRejectedValueOnce(new Error('private provider detail'));
    const response = await f.app.inject({ method: 'POST', url: '/health/lifts/capture', headers: headers(), payload });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Lift parsing is unavailable. Retry with the same idempotency key.' });
    expect(f.store.create).not.toHaveBeenCalled();
  });
});

describe('POST /health/lifts', () => {
  it('creates a normalized owner lift with a bounded body and no-store response', async () => {
    const f = fixture();
    const response = await f.app.inject({
      method: 'POST', url: '/health/lifts', headers: headers(),
      payload: { idempotencyKey: key, exerciseName: ' Bench press ', weightKg: 80, reps: 4, sets: 3 },
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(f.store.create).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: key, exerciseName: 'Bench press', exerciseKey: 'bench press', weightKg: 80, reps: 4, sets: 3,
    }), expect.any(AbortSignal));
  });

  it.each([
    ['missing key', { exerciseName: 'Squat', weightKg: 100, reps: 5, sets: 3 }],
    ['unknown field', { idempotencyKey: key, exerciseName: 'Squat', weightKg: 100, reps: 5, sets: 3, owner: foreign }],
    ['bad weight', { idempotencyKey: key, exerciseName: 'Squat', weightKg: 1000.01, reps: 5, sets: 3 }],
    ['bad repetitions', { idempotencyKey: key, exerciseName: 'Squat', weightKg: 100, reps: 0, sets: 3 }],
  ])('rejects %s without writing', async (_label, payload) => {
    const f = fixture();
    expect((await f.app.inject({ method: 'POST', url: '/health/lifts', headers: headers(), payload })).statusCode).toBe(400);
    expect(f.store.create).not.toHaveBeenCalled();
  });

  it('returns a sanitized unavailable response', async () => {
    const f = fixture();
    f.store.create.mockRejectedValueOnce(new ToolFailure('Lift could not be saved.'));
    const response = await f.app.inject({
      method: 'POST', url: '/health/lifts', headers: headers(),
      payload: { idempotencyKey: key, exerciseName: 'Squat', weightKg: 100, reps: 5, sets: 3 },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Lift could not be saved.' });
  });
});

describe('PATCH and DELETE /health/lifts/:id', () => {
  it('updates validated values and soft-deletes an existing entry', async () => {
    const f = fixture();
    const updated = await f.app.inject({ method: 'PATCH', url: `/health/lifts/${id}`, headers: headers(), payload: { weightKg: 82.5 } });
    expect(updated.statusCode).toBe(200);
    expect(f.store.update).toHaveBeenCalledWith(id, { weightKg: 82.5 }, expect.any(AbortSignal));
    const removed = await f.app.inject({ method: 'DELETE', url: `/health/lifts/${id}`, headers: headers() });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().entry.deletedAt).toBeTruthy();
  });

  it('rejects missing and service identities before storage', async () => {
    const f = fixture();
    expect((await f.app.inject({ method: 'POST', url: '/health/lifts', payload: {} })).statusCode).toBe(401);
    for (const kind of ['other', 'agent', 'runner', 'connector']) {
      expect((await f.app.inject({ method: 'DELETE', url: `/health/lifts/${id}`, headers: headers(kind) })).statusCode).toBe(403);
    }
    expect(f.access).not.toHaveBeenCalled();
  });

  it('rejects query selectors and malformed ids', async () => {
    const f = fixture();
    expect((await f.app.inject({ method: 'POST', url: '/health/lifts?owner=foreign', headers: headers(), payload: {} })).statusCode).toBe(400);
    expect((await f.app.inject({ method: 'PATCH', url: '/health/lifts/nope', headers: headers(), payload: { reps: 4 } })).statusCode).toBe(400);
    expect(f.access).not.toHaveBeenCalled();
  });
});
