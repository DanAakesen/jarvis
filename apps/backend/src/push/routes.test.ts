import { createECDH, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.js';
import type { ProactiveItem, PushStore, StoredPushSubscription } from '../database/push-store.js';
import { installAuthentication } from '../auth/hook.js';
import type { TokenVerifier, UserPrincipal } from '../auth/verify.js';
import { registerPushRoutes, type PushRouteDependencies } from './routes.js';
import type { VapidKeyPair, WebPushResult } from './webpush.js';

const owner = 'd5b41c2f-33f4-4b4f-9a52-09346e50c8dd';
const itemId = 'd5b41c2f-33f4-4b4f-9a52-09346e50c8de';
const otherItemId = 'd5b41c2f-33f4-4b4f-9a52-09346e50c8df';
const authorization = ['Bearer', ['test', 'fixture', 'signature'].join('.')].join(' ');
const user: UserPrincipal = {
  objectId: owner,
  tenantId: '802efa29-17f2-4a79-8f5f-38f087aed96a',
  displayName: 'Fixture user',
};
const keys: VapidKeyPair = { publicKey: 'public-fixture', privateKey: 'private-fixture' };
const item: ProactiveItem = {
  id: itemId,
  kind: 'test',
  title: 'Jarvis',
  body: 'New item',
  category: null,
  urgency: 'normal',
  dueAt: null,
  evidence: [],
  state: 'new',
  snoozedUntil: null,
  feedback: null,
  runId: null,
  todoAdded: false,
  language: null,
  createdAt: '2026-10-17T22:00:00.000Z',
};

function subscription(): StoredPushSubscription {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    id: randomUUID(),
    endpoint: 'https://web.push.apple.com/device/fixture',
    p256dh: ecdh.getPublicKey(undefined, 'uncompressed').toString('base64url'),
    auth: Buffer.alloc(16, 4).toString('base64url'),
  };
}

function storeFixture(subscriptions: StoredPushSubscription[] = []) {
  let storedKeys: VapidKeyPair | undefined;
  let itemSequence = 0;
  let openedAt: string | undefined;
  let openedWrites = 0;
  const store: PushStore = {
    readVapidKey: vi.fn(async () => storedKeys),
    insertVapidKey: vi.fn(async (value) => { storedKeys ??= value; }),
    upsertSubscription: vi.fn(async (_owner, value) => {
      const existing = subscriptions.find((entry) => entry.endpoint === value.endpoint);
      if (existing) Object.assign(existing, value);
      else subscriptions.push({ id: randomUUID(), ...value });
    }),
    deleteSubscription: vi.fn(async (requestOwner, endpoint) => {
      const index = subscriptions.findIndex((entry) => entry.endpoint === endpoint && requestOwner === owner);
      if (index >= 0) subscriptions.splice(index, 1);
    }),
    listSubscriptions: vi.fn(async (requestOwner) => requestOwner === owner ? [...subscriptions] : []),
    removeSubscription: vi.fn(async (id) => {
      const index = subscriptions.findIndex((entry) => entry.id === id);
      if (index >= 0) subscriptions.splice(index, 1);
    }),
    recordSubscriptionResult: vi.fn(async () => {}),
    createTestItem: vi.fn(async () => ({ ...item, id: ++itemSequence === 1 ? itemId : randomUUID() })),
    updateItemDelivery: vi.fn(async () => {}),
    readItem: vi.fn(async (requestOwner, id) => {
      if (requestOwner !== owner || id !== itemId) return undefined;
      if (openedAt === undefined) {
        openedAt = '2026-10-17T22:01:00.000Z';
        openedWrites++;
      }
      return item;
    }),
  };
  return {
    store,
    subscriptions,
    get openedWrites() { return openedWrites; },
    set keys(value: VapidKeyPair | undefined) { storedKeys = value; },
  };
}

const success: WebPushResult = { attempted: 1, accepted: true, statusCode: 201, removed: false };
const tokenVerifier: TokenVerifier = async () => user;
const apps: ReturnType<typeof Fastify>[] = [];

async function appFixture(
  enabled: boolean,
  dependencies: () => PushRouteDependencies,
) {
  const app = Fastify({ logger: false });
  apps.push(app);
  installAuthentication(app, loadConfig(), tokenVerifier);
  registerPushRoutes(app, enabled, dependencies);
  await app.ready();
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('default-off push routes', () => {
  it('leaves routes absent without evaluating the store factory or sending requests', async () => {
    const factory = vi.fn(() => { throw new Error('must stay inactive'); });
    const app = await appFixture(false, factory);
    const response = await app.inject({
      method: 'GET',
      url: '/push/config',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(404);
    expect(factory).not.toHaveBeenCalled();
  });

  it('creates a VAPID key on first need, re-reads a concurrent winner and returns only its public half', async () => {
    const fixture = storeFixture();
    const winner = { publicKey: 'winner-public', privateKey: 'winner-private' };
    const originalInsert = fixture.store.insertVapidKey;
    const insert = vi.fn(async () => {
      fixture.keys = winner;
      throw new Error('simulated unique-key race');
    });
    Object.assign(fixture.store, { insertVapidKey: insert });
    const generateKeys = vi.fn(() => keys);
    const app = await appFixture(true, () => ({
      store: fixture.store,
      publicOrigin: 'https://jarvis.example',
      generateKeys,
    }));
    const headers = { authorization };
    const first = await app.inject({ method: 'GET', url: '/push/config', headers });
    const second = await app.inject({ method: 'GET', url: '/push/config', headers });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ publicKey: winner.publicKey });
    expect(second.json()).toEqual({ publicKey: winner.publicKey });
    expect(generateKeys).toHaveBeenCalledTimes(1);
    expect(fixture.store.readVapidKey).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([first.body, second.body])).not.toContain(winner.privateKey);
    expect(originalInsert).not.toHaveBeenCalled();
  });
});

describe('authenticated push routes', () => {
  it('upserts valid subscriptions and makes deletion idempotent', async () => {
    const fixture = storeFixture();
    const app = await appFixture(true, () => ({ store: fixture.store, publicOrigin: 'https://jarvis.example' }));
    const headers = { authorization };
    const body = {
      endpoint: 'https://web.push.apple.com/device/fixture',
      keys: {
        p256dh: subscription().p256dh,
        auth: Buffer.alloc(16, 8).toString('base64url'),
      },
      expirationTime: 123,
    };
    for (let index = 0; index < 2; index++) {
      expect((await app.inject({ method: 'PUT', url: '/push/subscription', headers, payload: body })).statusCode).toBe(204);
    }
    expect(fixture.subscriptions).toHaveLength(1);
    expect(fixture.store.upsertSubscription).toHaveBeenCalledTimes(2);
    expect(fixture.store.upsertSubscription).toHaveBeenCalledWith(owner, {
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
    });
    for (let index = 0; index < 2; index++) {
      expect((await app.inject({
        method: 'DELETE',
        url: '/push/subscription',
        headers,
        payload: { endpoint: body.endpoint },
      })).statusCode).toBe(204);
    }
    expect(fixture.store.deleteSubscription).toHaveBeenCalledTimes(2);
  });

  it('returns the stable invalid_subscription error for both subscription routes', async () => {
    const fixture = storeFixture();
    const app = await appFixture(true, () => ({ store: fixture.store, publicOrigin: 'https://jarvis.example' }));
    const headers = { authorization };
    for (const response of [
      await app.inject({
        method: 'PUT',
        url: '/push/subscription',
        headers,
        payload: { endpoint: 'http://push.apple.com/device/test', keys: {} },
      }),
      await app.inject({
        method: 'DELETE',
        url: '/push/subscription',
        headers,
        payload: { endpoint: 'https://example.com/subscription' },
      }),
    ]) {
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid_subscription' });
    }
    expect(fixture.store.upsertSubscription).not.toHaveBeenCalled();
    expect(fixture.store.deleteSubscription).not.toHaveBeenCalled();
  });

  it('returns no_subscription without an item or send when no subscription exists', async () => {
    const fixture = storeFixture();
    const send = vi.fn(async () => success);
    const app = await appFixture(true, () => ({
      store: fixture.store,
      publicOrigin: 'https://jarvis.example',
      send,
    }));
    const response = await app.inject({
      method: 'POST',
      url: '/push/test',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'no_subscription' });
    expect(fixture.store.createTestItem).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('creates an exact generic payload and returns provider counts without exposing signing material', async () => {
    const fixture = storeFixture([subscription()]);
    const send = vi.fn(async (_subscription, payload) => {
      expect(JSON.parse(payload.toString('utf8'))).toEqual({
        v: 1,
        title: 'Jarvis',
        body: 'New item',
        itemId,
      });
      return success;
    });
    const app = await appFixture(true, () => ({
      store: fixture.store,
      publicOrigin: 'https://jarvis.example',
      generateKeys: () => keys,
      send,
    }));
    const response = await app.inject({
      method: 'POST',
      url: '/push/test',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      itemId,
      delivery: { attempted: 1, accepted: 1, failed: 0 },
    });
    expect(response.body).not.toContain(keys.privateKey);
    expect(fixture.store.updateItemDelivery).toHaveBeenCalledWith(itemId, 'accepted', 201);
    expect(send.mock.calls[0]?.[4]).toBe('user_test');
  });

  it('enforces one test per ten seconds and thirty in a rolling day', async () => {
    const fixture = storeFixture([subscription()]);
    let now = 0;
    const send = vi.fn(async () => success);
    const app = await appFixture(true, () => ({
      store: fixture.store,
      publicOrigin: 'https://jarvis.example',
      now: () => now,
      generateKeys: () => keys,
      send,
    }));
    const headers = { authorization };
    const test = () => app.inject({ method: 'POST', url: '/push/test', headers });
    expect((await test()).statusCode).toBe(200);
    expect((await test()).statusCode).toBe(429);
    now += 10_000;
    expect((await test()).statusCode).toBe(200);
    for (let count = 2; count < 30; count++) {
      now += 10_000;
      expect((await test()).statusCode).toBe(200);
    }
    now += 10_000;
    const limited = await test();
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: 'rate_limited' });
    expect(fixture.store.createTestItem).toHaveBeenCalledTimes(30);
    expect(send).toHaveBeenCalledTimes(30);
  });

  it('returns identical 404s for missing and non-owned items and sets openedAt once', async () => {
    const fixture = storeFixture();
    const app = await appFixture(true, () => ({ store: fixture.store, publicOrigin: 'https://jarvis.example' }));
    const headers = { authorization };
    const foundFirst = await app.inject({ method: 'GET', url: `/proactive/items/${itemId}`, headers });
    const foundAgain = await app.inject({ method: 'GET', url: `/proactive/items/${itemId}`, headers });
    expect(foundFirst.json()).toEqual(item);
    expect(foundAgain.json()).toEqual(item);
    expect(fixture.openedWrites).toBe(1);
    const missing = await app.inject({ method: 'GET', url: `/proactive/items/${randomUUID()}`, headers });
    const notOwned = await app.inject({ method: 'GET', url: `/proactive/items/${otherItemId}`, headers });
    expect(missing.statusCode).toBe(404);
    expect(notOwned.statusCode).toBe(404);
    expect(missing.body).toBe(notOwned.body);
    expect(missing.json()).toEqual({ error: 'not_found' });
  });
});
