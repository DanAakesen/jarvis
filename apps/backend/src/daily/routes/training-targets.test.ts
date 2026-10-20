import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../config.js';
import { installAuthentication } from '../../auth/hook.js';
import { ToolFailure } from '../../core/tool-registry.js';
import { emptyTrainingTargets, trainingTargetBounds, type StoredTrainingTargets, type TrainingTargetsPatch } from '../training/targets.js';
import { trainingTargetsRoutes } from './training-targets.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const owner = config.auth.ownerObjectId;
const foreign = '22222222-2222-4222-8222-222222222222';
const url = '/daily/training-targets';
const apps: FastifyInstance[] = [];
const headers = (kind = 'owner') => ({ authorization: ['Bearer', `${kind}.a.b`].join(' ') });
const readback: StoredTrainingTargets = { targets: { ...emptyTrainingTargets }, updatedAt: null };

function fixture() {
  const app = Fastify(); apps.push(app);
  app.decorate('ownerObjectId', owner);
  app.setErrorHandler((error: FastifyError, _request, reply) => reply.code(error.statusCode ?? 502).send({ error: 'Denied or unavailable' }));
  installAuthentication(app, config, async (token) => {
    if (token.startsWith('agent.')) return { kind: 'jarvis-agent', objectId: foreign, tenantId: config.auth.tenantId };
    if (token.startsWith('runner.')) return { kind: 'jarvis-runner', objectId: foreign, tenantId: config.auth.tenantId };
    if (token.startsWith('connector.')) return {
      kind: 'jarvis-daily-connector', objectId: owner, tenantId: config.auth.tenantId, clientId: foreign, scopes: ['Daily.Nutrition.Read'],
    };
    return { objectId: token.startsWith('other.') ? foreign : owner, tenantId: config.auth.tenantId, displayName: 'Synthetic' };
  });
  const store = {
    read: vi.fn(async () => readback),
    write: vi.fn(async (patch: TrainingTargetsPatch) => ({
      targets: { ...emptyTrainingTargets, ...patch }, updatedAt: '2026-10-17T10:00:00.000Z',
    })),
  };
  const access = vi.fn(() => store);
  void app.register(trainingTargetsRoutes(access));
  return { app, store, access };
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('GET /daily/training-targets', () => {
  it('returns the owner targets, missing state and server bounds without caching', async () => {
    const f = fixture();
    const response = await f.app.inject({ url, headers: headers() });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      targets: emptyTrainingTargets, missing: ['gymSessionsPerWeek', 'runSessionsPerWeek', 'dailySteps'],
      updatedAt: null, bounds: trainingTargetBounds,
    });
  });

  it('returns an unavailable response without disclosing store details', async () => {
    const f = fixture();
    f.store.read.mockRejectedValueOnce(new ToolFailure('Training targets are unavailable.'));
    const response = await f.app.inject({ url, headers: headers() });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Training targets are unavailable.' });
  });
});

describe('PATCH /daily/training-targets', () => {
  it('applies only named fields and supports clearing a value', async () => {
    const f = fixture();
    const response = await f.app.inject({ method: 'PATCH', url, headers: headers(), payload: { gymSessionsPerWeek: 3, dailySteps: null } });
    expect(response.statusCode).toBe(200);
    expect(f.store.write).toHaveBeenCalledWith({ gymSessionsPerWeek: 3, dailySteps: null }, expect.any(AbortSignal));
  });

  it.each([
    ['empty', {}],
    ['unknown', { other: 4 }],
    ['owner override', { dailySteps: 5, owner: foreign }],
    ['fraction', { dailySteps: 5.5 }],
    ['out of range', { runSessionsPerWeek: 22 }],
  ])('rejects %s without a write', async (_label, payload) => {
    const f = fixture();
    const response = await f.app.inject({ method: 'PATCH', url, headers: headers(), payload });
    expect(response.statusCode).toBe(400);
    expect(f.store.write).not.toHaveBeenCalled();
  });
});

describe('training target route authority', () => {
  it('denies callers without owner authority before accessing storage', async () => {
    const f = fixture();
    expect((await f.app.inject({ url })).statusCode).toBe(401);
    for (const kind of ['other', 'agent', 'runner', 'connector']) {
      expect((await f.app.inject({ url, headers: headers(kind) })).statusCode).toBe(403);
      expect((await f.app.inject({ method: 'PATCH', url, headers: headers(kind), payload: { dailySteps: 5 } })).statusCode).toBe(403);
    }
    expect(f.access).not.toHaveBeenCalled();
  });

  it('rejects caller-supplied selectors and query strings', async () => {
    const f = fixture();
    expect((await f.app.inject({ url: `${url}?owner=${foreign}`, headers: headers() })).statusCode).toBe(400);
    expect(f.access).not.toHaveBeenCalled();
  });
});
