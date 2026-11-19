import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { createPiAuth } from '../../auth/pi-credential.js';
import { loadConfig } from '../../config.js';
import { ConfigurationError } from '../../configuration-error.js';
import { createEventPath } from '../../proactive/events/wiring.js';
import { createMemoryProactiveStore } from '../../proactive/store.js';
import { createPiRoutes } from '../routes.js';
import { createMemoryPiStore } from '../store.js';
import { createPiTurnRegistry } from '../turns.js';
import { createBrainControl } from './control.js';

const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
const ownerToken = 'owner.token.fixture';
const otherToken = 'other.token.fixture';
const bearer = (value: string) => `${['Bear', 'er'].join('')} ${value}`;
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function setup(options: { wired?: boolean } = {}) {
  const now = () => new Date('2026-11-16T10:00:00Z');
  const piStore = createMemoryPiStore(now);
  const proactive = createMemoryProactiveStore(config.auth.ownerObjectId);
  let woken = 0;
  const control = createBrainControl({
    owner: config.auth.ownerObjectId, store: piStore, proactive, now,
    situation: {
      async read() {
        return {
          state: null, revision: 0, hash: null, policyRevision: 'a'.repeat(64),
          staleSources: [], missingSources: [], disabledSources: [], freshSources: [], asOf: null, updatedAt: null, lastActivation: null,
        };
      },
    } as never,
    brain: () => options.wired === false ? undefined : {
      wake: () => { woken += 1; },
      pendingLogs: 2,
      async status() {
        return {
          used: 0, allowed: 12, remaining: 12, lastAt: null, nextAllowedAt: null, quiet: false,
          queue: { pending: 0, leased: 0, retrying: 0 },
        };
      },
    },
  });
  const app = buildApp(config, undefined, {
    modules: [{ id: 'pi', tools: [], registerRoutes: createPiRoutes({
      gateway: { stream: async function* () {} } as never, registry: createPiTurnRegistry(), auth: createPiAuth(config.auth.tenantId, 'A'.repeat(43)),
      monthlyCapDkk: 250, brain: control,
    }) }],
    auth: async (token) => {
      if (token === otherToken) return { objectId: '99999999-9999-4999-8999-999999999999', tenantId: config.auth.tenantId, displayName: 'Other' };
      if (token !== ownerToken) throw new Error('rejected');
      return { objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Owner' };
    },
  });
  apps.push(app);
  const call = (method: 'GET' | 'PUT', token: string, payload?: unknown) => app.inject({
    method, url: '/pi/brain', headers: { authorization: bearer(token), 'content-type': 'application/json' }, ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return { call, piStore, proactive, woken: () => woken };
}

describe('the brain test switch', () => {
  it('is off until the owner turns it on, and reports budget, spend and what is pending', async () => {
    const { call, piStore, proactive } = setup();
    await proactive.spend.record({ runId: 'r', month: '2026-11', inputTokens: 1, outputTokens: 1, estimatedDkk: 82, createdAt: new Date('2026-11-10T00:00:00Z') });
    await piStore.recordTurn({ kind: 'brain', messageId: null, model: 'm', inputTokens: 12000, cachedTokens: 9000, outputTokens: 100, costDkk: 0.12, firstTextMs: 900, totalMs: 4000, outcome: 'ok' }, new AbortController().signal);
    const body = (await call('GET', ownerToken)).json();
    expect(body).toMatchObject({
      available: true, enabled: false, paused: false, logPending: 2,
      budget: { limitDkk: 100, spentDkk: 82, state: 'warn' }, month: { wakes: 1, costDkk: 0.12 }, today: { messages: 0 },
      lastWake: { inputTokens: 12000, cachedTokens: 9000, outputTokens: 100, costDkk: 0.12, outcome: 'ok' },
    });
  });

  it('saves the switch, wakes the brain when it goes on, and is the owner\'s alone', async () => {
    const { call, woken } = setup();
    expect((await call('PUT', otherToken, { enabled: true })).statusCode).toBe(403);
    expect((await call('GET', otherToken)).statusCode).toBe(403);
    expect((await call('PUT', ownerToken, { enabled: 'yes' })).statusCode).toBe(400);
    expect((await call('PUT', ownerToken, { enabled: true })).json()).toMatchObject({ enabled: true });
    expect(woken()).toBe(1);
    expect((await call('GET', ownerToken)).json()).toMatchObject({ enabled: true });
    expect((await call('PUT', ownerToken, { enabled: false })).json()).toMatchObject({ enabled: false });
    expect(woken()).toBe(1);
  });

  it('says plainly when the brain is not wired on this backend', async () => {
    const { call } = setup({ wired: false });
    expect((await call('GET', ownerToken)).json()).toMatchObject({ available: false, enabled: false });
  });
});

describe('who reads the event queue', () => {
  const base = { ownerObjectId: config.auth.ownerObjectId, store: createMemoryProactiveStore(), sources: [], now: () => new Date() };

  it('refuses to run the old one-shot pipeline and the brain together, because two readers would split the events', () => {
    expect(() => createEventPath({ ...base, enabled: true, brain: () => ({ wake() {}, async start() {}, async tick() {} }) })).toThrow(ConfigurationError);
  });

  it('feeds the queue to the brain, wakes it when a producer enqueues, and has no outreach store of the old pipeline', async () => {
    let woken = 0;
    let given: unknown;
    const path = createEventPath({ ...base, enabled: false, brain: (queue) => { given = queue; return { wake() { woken += 1; }, async start() {}, async tick() { return 'brain'; } }; } })!;
    expect(given).toBeDefined();
    expect(path.outreach).toBeUndefined();
    await path.sink.enqueue({ source: 'worker', kind: 'task.done', dedupeKey: 'w:1', summary: 'Task 1 is done.', occurredAt: new Date() });
    expect(woken).toBe(1);
    expect(await path.tick(new AbortController().signal)).toBe('brain');
  });

  it('builds nothing when neither is on', () => {
    expect(createEventPath({ ...base, enabled: false })).toBeUndefined();
  });
});
