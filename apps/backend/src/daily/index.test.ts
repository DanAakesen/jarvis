import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { coreModule } from '../core/index.js';
import type { TokenVerifier } from '../auth/verify.js';
import { createDailyModules } from './index.js';
import { resolveDailyOwner } from './owner.js';
import { createDailyChanges } from './revisions.js';
import type { DailyData } from './query.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const owner = config.auth.ownerObjectId;
const agent = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const apps: ReturnType<typeof buildApp>[] = [];
const headers = (kind = 'owner') => ({ authorization: `Bearer ${kind}.e30.sig` });
const auth: TokenVerifier = async (token) => {
  const kind = token.split('.')[0];
  if (kind === 'agent') return { kind: 'jarvis-agent', objectId: agent, tenantId: config.auth.tenantId };
  if (kind === 'runner') return { kind: 'jarvis-runner', objectId: other, tenantId: config.auth.tenantId };
  return { objectId: kind === 'other' ? other : owner.toUpperCase(), tenantId: config.auth.tenantId, displayName: 'Synthetic user' };
};
function fixture(enabled?: boolean) {
  const app = buildApp(config, undefined, { auth, modules: [coreModule, ...createDailyModules(enabled)] });
  apps.push(app);
  return app;
}
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('Daily integration contract', () => {
  it('defaults off and preserves the existing health route and tool catalogue', async () => {
    const baseline = buildApp(config, undefined, { auth, modules: [coreModule] });
    apps.push(baseline);
    for (const app of [fixture(), fixture(false)]) {
      expect((await app.inject('/health')).json()).toEqual((await baseline.inject('/health')).json());
      expect((await app.inject({ url: '/tools', headers: headers() })).json()).toEqual(
        (await baseline.inject({ url: '/tools', headers: headers() })).json(),
      );
      expect((await app.inject({ url: '/daily/capabilities', headers: headers() })).statusCode).toBe(404);
    }
    expect(createDailyModules()).toEqual([]);
    expect(createDailyModules(false)).toEqual([]);
  });

  it('maps the existing authenticated user and distinct hosted-agent identity to one server owner', async () => {
    const app = fixture(true);
    // Synthetic test route exercises the helper used by future Daily data services.
    app.get('/synthetic-daily-owner', { config: { jarvisAgent: true } }, async (request) => ({ owner: resolveDailyOwner(request) }));
    for (const kind of ['owner', 'agent']) {
      expect((await app.inject({ url: '/synthetic-daily-owner', headers: headers(kind) })).json()).toEqual({ owner });
      const response = await app.inject({ url: '/daily/capabilities', headers: headers(kind) });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toMatchObject({ stage: 'contract-only', pages: [], tools: [], reservedViewIds: { status: 'daily-status' } });
      expect(JSON.stringify(response.json())).not.toContain(owner);
      expect(JSON.stringify(response.json())).not.toContain(agent);
    }
  });

  it('rejects unauthenticated, non-owner and coding-runner access', async () => {
    const app = fixture(true);
    expect((await app.inject('/daily/capabilities')).statusCode).toBe(401);
    for (const kind of ['other', 'runner']) {
      expect((await app.inject({ url: '/daily/capabilities', headers: headers(kind) })).statusCode).toBe(403);
    }
  });

  it('never accepts a caller-supplied owner or source owner', async () => {
    const app = fixture(true);
    for (const field of ['owner', 'ownerId', 'sourceOwnerId']) {
      expect((await app.inject({ url: `/daily/capabilities?${field}=${other}`, headers: headers() })).statusCode).toBe(400);
    }
  });
  it('requires an explicit internal store factory rather than enabling writes with read-only data', async () => {
    const data: DailyData = { query: { query: vi.fn() }, changes: createDailyChanges() };
    const internal = vi.fn(() => ({ intake: vi.fn(), lookupSaved: vi.fn(), log: vi.fn(), correct: vi.fn(), remove: vi.fn() }));
    expect(createDailyModules(false, data, undefined, internal)).toEqual([]);
    expect(createDailyModules(true, data)[0]!.tools.map(tool => tool.name)).toEqual(['daily_query']);
    expect(() => createDailyModules(true, undefined, undefined, internal)).toThrow('shared Daily data');
    const app = buildApp(config, undefined, { auth, modules: [coreModule, ...createDailyModules(true, data, undefined, internal)] });
    apps.push(app);
    const response = await app.inject({ url: '/daily/capabilities', headers: headers() });
    expect(response.json()).toMatchObject({ stage: 'internal-nutrition-rehearsal', pages: [], tools: ['daily_query', 'daily_food', 'daily_food_review'] });
    expect(internal).not.toHaveBeenCalled();
    const catalogue = (await app.inject({ url: '/tools', headers: headers() })).json();
    expect(JSON.stringify(catalogue)).toContain('daily_food');
    expect(JSON.stringify(catalogue)).toContain('daily_food_review');
  });
});
