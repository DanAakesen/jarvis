import { createECDH } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PushStore, StoredPushSubscription } from '../database/push-store.js';
import { generateVapidKeyPair, sendWebPush, type VapidKeyPair, type WebPushResult } from '../push/webpush.js';
import { buildPushPayload, createSystemPushSender } from './push-delivery.js';

const owner = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const keys: VapidKeyPair = { publicKey: 'synthetic-public', privateKey: 'synthetic-private' };

function subscription(id: string): StoredPushSubscription {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    id,
    endpoint: `https://push.example.test/device/${id}`,
    p256dh: ecdh.getPublicKey(undefined, 'uncompressed').toString('base64url'),
    auth: Buffer.alloc(16, 7).toString('base64url'),
  };
}

function storeFixture(subscriptions: StoredPushSubscription[]) {
  const store = {
    readVapidKey: vi.fn(async () => keys),
    insertVapidKey: vi.fn(async () => {}),
    listSubscriptions: vi.fn(async () => subscriptions),
    removeSubscription: vi.fn(async () => {}),
    recordSubscriptionResult: vi.fn(async () => {}),
    updateItemDelivery: vi.fn(async () => {}),
  } as unknown as PushStore;
  return { store, list: vi.mocked(store.listSubscriptions), remove: vi.mocked(store.removeSubscription), result: vi.mocked(store.recordSubscriptionResult) };
}

const request = {
  kind: 'alert' as const, count: 2, language: 'en' as const, itemId, origin: 'proactive_alert' as const,
};

describe('shared proactive push delivery', () => {
  it('builds the exact generic JSON payload without private text', () => {
    expect(buildPushPayload(request).toString()).toBe(
      `{"v":1,"title":"Jarvis","body":"New item","itemId":"${itemId}","kind":"alert","count":2,"lang":"en"}`,
    );
  });

  it('guards system sends during quiet hours before subscription, key, or network access', async () => {
    const fixture = storeFixture([subscription('one')]);
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 201 }));
    const sender = createSystemPushSender({
      store: fixture.store,
      ownerObjectId: owner,
      publicOrigin: 'https://jarvis.example',
      now: () => new Date('2026-10-20T20:30:00.000Z'),
      transport: { fetch: fetchMock, now: () => 0, sleep: async () => {} },
      logger: { info: vi.fn(), warn: vi.fn() },
    });
    await expect(sender(request, new AbortController().signal)).resolves.toEqual({
      status: 'skipped', reason: 'quiet_hours', attempted: 0, accepted: 0, statusCode: null,
    });
    expect(fixture.list).not.toHaveBeenCalled();
    expect(fixture.store.readVapidKey).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the M1 user-test origin unaffected by quiet hours', async () => {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 201 }));
    const outcome = await sendWebPush({
      endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/synthetic',
      p256dh: ecdh.getPublicKey(undefined, 'uncompressed').toString('base64url'),
      auth: Buffer.alloc(16, 7).toString('base64url'),
    }, Buffer.from('synthetic'), generateVapidKeyPair(), 'https://jarvis.example', 'user_test', {
      fetch: fetchMock,
      now: () => Date.parse('2026-10-20T20:30:00.000Z'),
      sleep: async () => {},
    });
    expect(outcome).toMatchObject({ accepted: true, statusCode: 201 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('counts accepted subscriptions once and removes 410 subscriptions', async () => {
    const first = subscription('accepted');
    const gone = subscription('gone');
    const fixture = storeFixture([first, gone]);
    const send = vi.fn(async (current: StoredPushSubscription): Promise<WebPushResult> => current.id === 'gone'
      ? { attempted: 1, accepted: false, statusCode: 410, removed: true }
      : { attempted: 1, accepted: true, statusCode: 202, removed: false });
    const sender = createSystemPushSender({
      store: fixture.store,
      ownerObjectId: owner,
      publicOrigin: 'https://jarvis.example',
      now: () => new Date('2026-10-20T08:00:00.000Z'),
      generateKeys: () => keys,
      send,
    });
    await expect(sender(request, new AbortController().signal)).resolves.toEqual({
      status: 'sent', reason: null, attempted: 2, accepted: 1, statusCode: 202,
    });
    expect(fixture.remove).toHaveBeenCalledExactlyOnceWith(gone.id);
    expect(fixture.result).toHaveBeenCalledExactlyOnceWith(first.id, true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('maps provider rejection, transient failure, no subscriptions, and abort to safe outcomes', async () => {
    const rejectedStore = storeFixture([subscription('rejected')]);
    const rejected = createSystemPushSender({
      store: rejectedStore.store, ownerObjectId: owner, publicOrigin: 'https://jarvis.example',
      now: () => new Date('2026-10-20T08:00:00.000Z'), generateKeys: () => keys,
      send: async () => ({ attempted: 1, accepted: false, statusCode: 400, removed: false }),
    });
    await expect(rejected(request, new AbortController().signal)).resolves.toMatchObject({
      status: 'failed', reason: 'provider_rejected', attempted: 1, statusCode: 400,
    });

    const unavailableStore = storeFixture([subscription('unavailable')]);
    const unavailable = createSystemPushSender({
      store: unavailableStore.store, ownerObjectId: owner, publicOrigin: 'https://jarvis.example',
      now: () => new Date('2026-10-20T08:00:00.000Z'), generateKeys: () => keys,
      send: async () => ({ attempted: 1, accepted: false, statusCode: null, removed: false }),
    });
    await expect(unavailable(request, new AbortController().signal)).resolves.toMatchObject({
      status: 'failed', reason: 'provider_unavailable',
    });

    const emptyStore = storeFixture([]);
    const empty = createSystemPushSender({
      store: emptyStore.store, ownerObjectId: owner, publicOrigin: 'https://jarvis.example',
      now: () => new Date('2026-10-20T08:00:00.000Z'), generateKeys: () => keys,
    });
    await expect(empty(request, new AbortController().signal)).resolves.toMatchObject({
      status: 'skipped', reason: 'no_subscription',
    });
    expect(emptyStore.store.readVapidKey).not.toHaveBeenCalled();

    const abortStore = storeFixture([subscription('aborted')]);
    const abortSender = createSystemPushSender({
      store: abortStore.store, ownerObjectId: owner, publicOrigin: 'https://jarvis.example',
      now: () => new Date('2026-10-20T08:00:00.000Z'),
    });
    const controller = new AbortController();
    controller.abort();
    await expect(abortSender(request, controller.signal)).resolves.toMatchObject({
      status: 'skipped', reason: 'aborted',
    });
    expect(abortStore.list).not.toHaveBeenCalled();
  });
});
