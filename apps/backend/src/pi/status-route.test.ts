import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createPiAuth } from '../auth/pi-credential.js';
import { loadConfig } from '../config.js';
import { createPiGateway } from './gateway.js';
import { createPiRoutes } from './routes.js';
import { createMemoryPiStore } from './store.js';
import { createPiTurnRegistry } from './turns.js';

const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
const ownerToken = 'owner.token.fixture';
const otherToken = 'other.token.fixture';
const bearer = (value: string) => `${['Bear', 'er'].join('')} ${value}`;
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function setup(options: { configured?: boolean } = {}) {
  const now = () => new Date('2026-11-16T10:00:00Z');
  const store = createMemoryPiStore(now);
  const registry = createPiTurnRegistry();
  const gateway = options.configured === false ? undefined : createPiGateway({
    projectEndpoint: 'https://acct.services.ai.azure.com/api/projects/proj', agentName: 'jarvis-pi', owner: config.auth.ownerObjectId,
    monthlyCapDkk: 250, timeZone: 'Europe/Copenhagen', store, registry, activations: {} as never, getToken: async () => 'token',
    context: async () => '', now, fetcher: (async () => { throw new Error('The status route must never call the model.'); }) as typeof fetch,
  });
  const app = buildApp(config, undefined, {
    modules: [{ id: 'pi', tools: [], registerRoutes: createPiRoutes({
      gateway, registry, auth: createPiAuth(config.auth.tenantId, 'A'.repeat(43)), monthlyCapDkk: 250,
    }) }],
    auth: async (token) => {
      if (token === otherToken) return { objectId: '99999999-9999-4999-8999-999999999999', tenantId: config.auth.tenantId, displayName: 'Other' };
      if (token !== ownerToken) throw new Error('rejected');
      return { objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Owner' };
    },
  });
  apps.push(app);
  const status = (token: string) => app.inject({ method: 'GET', url: '/pi/status', headers: { authorization: bearer(token) } });
  return { store, status };
}

describe('GET /pi/status', () => {
  it('shows which kind of turn made each call, so an hourly background call can be named from the ledger', async () => {
    const { store, status } = setup();
    const turn = { messageId: null, model: 'm', inputTokens: 4_000, cachedTokens: 0, outputTokens: 5, costDkk: 0.03, firstTextMs: 900, totalMs: 1_500, outcome: 'ok' as const };
    await store.recordTurn({ ...turn, kind: 'warm' }, new AbortController().signal);
    await store.recordTurn({ ...turn, kind: 'brain', costDkk: 0.2, activationType: 'scheduled', activationSource: 'timer' }, new AbortController().signal);
    const response = await status(ownerToken);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      enabled: true, reason: null, agent: { name: 'jarvis-pi', model: expect.any(String), effort: expect.any(String) },
      month: { spentDkk: 0.03, capDkk: 250, remainingDkk: 249.97, turns: 1 },
      warm: { state: 'cold', warmedAt: null },
      lastTurn: {
        kind: 'warm', at: '2026-11-16T10:00:00.000Z', firstTextMs: 900, totalMs: 1_500, inputTokens: 4_000, cachedTokens: 0, outputTokens: 5, costDkk: 0.03,
      },
      turns: {
        last24h: { chat: { turns: 0, costDkk: 0 }, warm: { turns: 1, costDkk: 0.03 }, smoke: { turns: 0, costDkk: 0 }, brain: { turns: 1, costDkk: 0.2 } },
        recent: [
          { at: '2026-11-16T10:00:00.000Z', kind: 'brain', outcome: 'ok', inputTokens: 4_000, cachedTokens: 0, outputTokens: 5, costDkk: 0.2, totalMs: 1_500, activation: { type: 'scheduled', source: 'timer' } },
          { at: '2026-11-16T10:00:00.000Z', kind: 'warm', outcome: 'ok', inputTokens: 4_000, cachedTokens: 0, outputTokens: 5, costDkk: 0.03, totalMs: 1_500 },
        ],
      },
    });
  });

  it('is the owner\'s alone', async () => {
    const { status } = setup();
    expect((await status(otherToken)).statusCode).toBe(403);
  });

  it('keeps the same shape, empty, when PI is not set up on this backend', async () => {
    const { status } = setup({ configured: false });
    expect((await status(ownerToken)).json()).toMatchObject({
      enabled: false, reason: 'not_configured', lastTurn: null,
      turns: { last24h: { chat: { turns: 0 }, warm: { turns: 0 }, smoke: { turns: 0 }, brain: { turns: 0 } }, recent: [] },
    });
  });
});
