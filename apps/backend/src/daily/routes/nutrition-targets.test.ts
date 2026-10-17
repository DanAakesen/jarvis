import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../config.js';
import { installAuthentication } from '../../auth/hook.js';
import { ToolFailure, ToolRefusal } from '../../core/tool-registry.js';
import {
  emptyNutritionTargets, nutritionTargetBounds,
  type NutritionTargets, type NutritionTargetsPatch, type StoredNutritionTargets,
} from '../nutrition/targets.js';
import { nutritionTargetsRoutes } from './nutrition-targets.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const owner = config.auth.ownerObjectId;
const foreign = '22222222-2222-4222-8222-222222222222';
// Synthetic placeholders. They are not anyone's real figures.
const at = '2026-10-17T10:00:00.000Z';
const url = '/daily/nutrition-targets';
const apps: FastifyInstance[] = [];
const headers = (kind = 'owner') => ({ authorization: `Bearer ${kind}.synthetic.signature` });

function stored(targets: Partial<NutritionTargets> = {}): StoredNutritionTargets {
  const merged: NutritionTargets = { ...emptyNutritionTargets, ...targets };
  return { targets: merged, updatedAt: Object.values(merged).some((value) => value !== null) ? at : null };
}

function newApp() {
  const app = Fastify(); apps.push(app);
  app.decorate('ownerObjectId', owner);
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    reply.code(error.statusCode ?? 502).send({ error: 'Denied or unavailable' });
  });
  return app;
}

function fixture(initial: StoredNutritionTargets = stored()) {
  const app = newApp();
  installAuthentication(app, config, async (token) => {
    if (token.startsWith('agent.')) return { kind: 'jarvis-agent', objectId: foreign, tenantId: config.auth.tenantId };
    if (token.startsWith('runner.')) return { kind: 'jarvis-runner', objectId: foreign, tenantId: config.auth.tenantId };
    if (token.startsWith('connector.')) {
      return { kind: 'jarvis-daily-connector', objectId: owner, tenantId: config.auth.tenantId, clientId: foreign, scopes: ['Daily.Nutrition.Read'] };
    }
    return { objectId: token.startsWith('other.') ? foreign : owner, tenantId: config.auth.tenantId, displayName: 'Synthetic' };
  });
  const store = {
    read: vi.fn<(signal: AbortSignal) => Promise<StoredNutritionTargets>>(async () => initial),
    write: vi.fn<(patch: NutritionTargetsPatch, signal: AbortSignal) => Promise<StoredNutritionTargets>>(
      async (patch) => stored({ ...initial.targets, ...patch })),
  };
  const access = vi.fn(() => store);
  void app.register(nutritionTargetsRoutes(access));
  return { app, store, access };
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('GET /daily/nutrition-targets', () => {
  it('reads the owner targets with their bounds, uncached', async () => {
    const f = fixture(stored({ restingKcal: 1750, proteinGrams: 110 }));
    const response = await f.app.inject({ url, headers: headers() });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      targets: { restingKcal: 1750, deficitKcal: null, proteinGrams: 110 },
      missing: ['deficitKcal'],
      updatedAt: at,
      bounds: nutritionTargetBounds,
    });
    expect(f.store.read).toHaveBeenCalledOnce();
    expect(f.store.read.mock.calls[0]![0]).toBeInstanceOf(AbortSignal);
  });

  it('reports every target as missing, never a default, when nothing is stored', async () => {
    const f = fixture();
    expect((await f.app.inject({ url, headers: headers() })).json()).toMatchObject({
      targets: { restingKcal: null, deficitKcal: null, proteinGrams: null },
      missing: ['restingKcal', 'deficitKcal', 'proteinGrams'],
      updatedAt: null,
    });
  });

  it('shows a store failure as unavailable with its safe message', async () => {
    const f = fixture();
    f.store.read.mockRejectedValueOnce(new ToolFailure('Nutrition targets are unavailable.'));
    const response = await f.app.inject({ url, headers: headers() });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Nutrition targets are unavailable.' });
  });
});

describe('PATCH /daily/nutrition-targets', () => {
  it('saves only the named targets for the signed-in owner and returns the stored view', async () => {
    const f = fixture(stored({ deficitKcal: 350 }));
    const response = await f.app.inject({ method: 'PATCH', url, headers: headers(), payload: { restingKcal: 1750, proteinGrams: null } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({
      targets: { restingKcal: 1750, deficitKcal: 350, proteinGrams: null }, missing: ['proteinGrams'], bounds: nutritionTargetBounds,
    });
    expect(f.store.write).toHaveBeenCalledOnce();
    expect(f.store.write.mock.calls[0]![0]).toEqual({ restingKcal: 1750, proteinGrams: null });
    expect(f.store.write.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['an empty change', {}],
    ['a list', []],
    ['an unknown target', { bmr: 1700 }],
    ['an owner override', { restingKcal: 1750, owner: foreign }],
    ['a numeric string', { restingKcal: '1750' }],
    ['a fractional value', { restingKcal: 1750.5 }],
    ['an out-of-range value', { restingKcal: 987654 }],
    ['a poisoned prototype', JSON.parse('{"__proto__":{"restingKcal":1750}}') as unknown],
  ])('refuses %s without writing', async (_label, payload) => {
    const f = fixture();
    const response = await f.app.inject({ method: 'PATCH', url, headers: headers(), payload: payload as never });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('987654');
    expect(f.store.write).not.toHaveBeenCalled();
  });

  it('refuses a request with no body', async () => {
    const f = fixture();
    expect((await f.app.inject({ method: 'PATCH', url, headers: headers() })).statusCode).toBe(400);
    expect(f.store.write).not.toHaveBeenCalled();
  });

  it('refuses an oversized body before reading it into the parser', async () => {
    const f = fixture();
    const response = await f.app.inject({ method: 'PATCH', url, headers: headers(), payload: { restingKcal: 1750, padding: 'x'.repeat(2048) } });
    expect(response.statusCode).toBe(413);
    expect(f.store.write).not.toHaveBeenCalled();
  });

  it('shows a refused or failed save with its safe message and never a raw database error', async () => {
    const f = fixture();
    f.store.write.mockRejectedValueOnce(new ToolFailure('Nutrition targets could not be saved. Read them to check the current values before retrying.'));
    const failed = await f.app.inject({ method: 'PATCH', url, headers: headers(), payload: { restingKcal: 1750 } });
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toEqual({ error: 'Nutrition targets could not be saved. Read them to check the current values before retrying.' });
    f.store.write.mockRejectedValueOnce(new ToolRefusal('Not allowed.'));
    const refused = await f.app.inject({ method: 'PATCH', url, headers: headers(), payload: { restingKcal: 1750 } });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toEqual({ error: 'Not allowed.' });
  });
});

describe('nutrition targets route authority', () => {
  it('asks an anonymous caller to sign in before anything is read', async () => {
    const f = fixture();
    expect((await f.app.inject({ url })).statusCode).toBe(401);
    expect((await f.app.inject({ method: 'PATCH', url, payload: { restingKcal: 1750 } })).statusCode).toBe(401);
    expect(f.access).not.toHaveBeenCalled();
  });

  it.each(['other', 'agent', 'runner', 'connector'])('denies a %s caller on both methods without touching the store', async (kind) => {
    const f = fixture();
    expect((await f.app.inject({ url, headers: headers(kind) })).statusCode).toBe(403);
    expect((await f.app.inject({ method: 'PATCH', url, headers: headers(kind), payload: { restingKcal: 1750 } })).statusCode).toBe(403);
    expect(f.access).not.toHaveBeenCalled();
  });

  it.each(['GET', 'PATCH'] as const)('refuses any query string on %s, including an owner selector', async (method) => {
    const f = fixture();
    const response = await f.app.inject({
      method, url: `${url}?owner=${foreign}`, headers: headers(), ...(method === 'PATCH' ? { payload: { restingKcal: 1750 } } : {}),
    });
    expect(response.statusCode).toBe(400);
    expect(f.access).not.toHaveBeenCalled();
  });

  it('refuses an agent or connector principal by itself, even if routing ever let one through', async () => {
    const app = newApp();
    for (const name of [
      'principal', 'agentPrincipal', 'runnerPrincipal', 'pcBridgePrincipal', 'phoneEventGridPrincipal', 'deployPrincipal',
      'dailyConnectorPrincipal', 'nutritionExportPrincipal',
    ]) app.decorateRequest(name, null);
    app.addHook('onRequest', async (request) => {
      const kind = request.headers['x-test-principal'];
      if (kind === 'agent') Object.assign(request, { agentPrincipal: { kind: 'jarvis-agent', objectId: foreign, tenantId: config.auth.tenantId } });
      else if (kind === 'connector') Object.assign(request, { dailyConnectorPrincipal: { kind: 'jarvis-daily-connector', objectId: owner } });
      else Object.assign(request, { principal: { objectId: owner } });
    });
    const access = vi.fn();
    void app.register(nutritionTargetsRoutes(access));
    for (const kind of ['agent', 'connector']) {
      expect((await app.inject({ url, headers: { 'x-test-principal': kind } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'PATCH', url, headers: { 'x-test-principal': kind }, payload: { restingKcal: 1750 } })).statusCode).toBe(403);
    }
    expect(access).not.toHaveBeenCalled();
  });
});
