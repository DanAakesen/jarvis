import { createECDH } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PushStore, StoredPushSubscription } from '../database/push-store.js';
import { encryptWebPushPayload, generateVapidKeyPair, sendWebPush, type VapidKeyPair, type WebPushResult } from '../push/webpush.js';
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
  it('builds the v2 final payload while preserving routing metadata', () => {
    expect(buildPushPayload(request).toString()).toBe(
      `{"v":2,"title":"2 time-critical items need you","body":"+2 more","itemId":"${itemId}","kind":"alert","count":2,"lang":"en"}`,
    );
  });

  it.each([
    ['en', '2026-10-20T08:30:00Z', '2026-10-20T08:00:00Z', 'Todo due at 10:30'],
    ['da', '2026-10-20T08:30:00Z', '2026-10-20T08:00:00Z', 'Todo forfalder kl. 10:30'],
    ['en', '2026-10-20T07:30:00Z', '2026-10-20T08:00:00Z', 'Todo was due at 09:30'],
    ['da', '2026-10-20T07:30:00Z', '2026-10-20T08:00:00Z', 'Todo forfaldt kl. 09:30'],
    ['en', '2026-10-20T08:00:00Z', '2026-10-20T08:00:00Z', 'Todo was due at 10:00'],
    ['da', '2026-10-20T08:00:00Z', '2026-10-20T08:00:00Z', 'Todo forfaldt kl. 10:00'],
    ['en', '2026-10-19T19:30:00Z', '2026-10-20T05:00:00Z', 'Todo was due yesterday at 21:30'],
    ['da', '2026-10-19T19:30:00Z', '2026-10-20T05:00:00Z', 'Todo forfaldt i går kl. 21:30'],
    ['en', '2026-01-20T08:30:00Z', '2026-01-20T08:00:00Z', 'Todo due at 09:30'],
    ['da', '2026-01-20T08:30:00Z', '2026-01-20T08:00:00Z', 'Todo forfalder kl. 09:30'],
    ['en', '2026-10-19T22:30:00Z', '2026-10-20T05:00:00Z', 'Todo was due at 00:30'],
    ['da', '2026-10-19T22:30:00Z', '2026-10-20T05:00:00Z', 'Todo forfaldt kl. 00:30'],
    ['en', '2026-10-25T00:30:00Z', '2026-10-25T06:00:00Z', 'Todo was due at 02:30'],
    ['da', '2026-10-25T01:30:00Z', '2026-10-25T06:00:00Z', 'Todo forfaldt kl. 02:30'],
  ] as const)('composes single %s reminder at %s relative to %s', (language, dueAt, now, title) => {
    const payload = JSON.parse(buildPushPayload({
      ...request, kind: 'due_soon', count: 1, language,
      details: [{ title: 'Synthetic task', dueAt }],
    }, new Date(now)).toString());
    expect(payload).toMatchObject({ title, body: 'Synthetic task', kind: 'due_soon', count: 1, lang: language });
    expect(payload.title).not.toContain('Jarvis');
  });

  it.each([
    ['en', 'Time-critical', '2026-10-20T08:30:00Z', 'Synthetic deadline · 10:30'],
    ['da', 'Tidskritisk', '2026-10-20T08:30:00Z', 'Synthetic deadline · 10:30'],
    ['en', 'Time-critical', null, 'Synthetic deadline'],
    ['da', 'Tidskritisk', null, 'Synthetic deadline'],
    ['en', 'Time-critical', 'invalid', 'Synthetic deadline'],
  ] as const)('composes single %s alert with optional due time %s', (language, title, dueAt, body) => {
    expect(JSON.parse(buildPushPayload({
      ...request, count: 1, language, details: [{ title: 'Synthetic deadline', dueAt }],
    }).toString())).toMatchObject({ title, body });
  });

  it.each([
    ['due_soon', 'en', '5 todos are due within the hour'],
    ['due_soon', 'da', '5 todos forfalder inden for en time'],
    ['overdue', 'en', '5 todos are overdue'],
    ['overdue', 'da', '5 todos er forfaldne'],
    ['mixed', 'en', '5 todos need your attention'],
    ['mixed', 'da', '5 todos kræver din opmærksomhed'],
    ['alert', 'en', '5 time-critical items need you'],
    ['alert', 'da', '5 tidskritiske ting kræver din opmærksomhed'],
  ] as const)('retains the %s %s count headline and bounded details', (kind, language, title) => {
    const payload = JSON.parse(buildPushPayload({
      ...request, count: 5, kind, language,
      details: [
        { title: 'Synthetic later', dueAt: '2026-10-20T10:00:00Z' },
        { title: 'Synthetic earlier', dueAt: '2026-10-20T08:00:00Z' },
        { title: 'Synthetic middle', dueAt: '2026-10-20T09:00:00Z' },
      ],
    }).toString());
    const lines = kind === 'alert'
      ? ['Synthetic later', 'Synthetic earlier', 'Synthetic middle']
      : ['10:00 Synthetic earlier', '11:00 Synthetic middle', '12:00 Synthetic later'];
    expect(payload).toMatchObject({ title, body: [...lines, `+2 ${language === 'da' ? 'flere' : 'more'}`].join('\n') });
  });

  it.each(['en', 'da'] as const)('sanitizes controls and bounds Unicode lines, total body, and encrypted record in %s', (language) => {
    const privateTitle = `  Synthetic\u0000\u0001\u007f\u0085\u202e\u200b\n\t  ${'🧪'.repeat(150)} `;
    const payload = buildPushPayload({
      ...request, kind: 'mixed', language, count: 99,
      details: Array.from({ length: 6 }, (_, index) => ({ title: privateTitle, dueAt: `2026-10-20T${10 + index}:00:00Z` })),
    });
    const content = JSON.parse(payload.toString());
    expect(Array.from(content.title).length).toBeLessThanOrEqual(60);
    expect(Array.from(content.body).length).toBeLessThanOrEqual(240);
    expect(content.body.split('\n')).toHaveLength(4);
    for (const line of content.body.split('\n')) {
      expect(Array.from(line).length).toBeLessThanOrEqual(80);
      expect(line).not.toMatch(/[\p{Cc}\p{Cf}\p{Cs}]/u);
      expect(line).not.toMatch(/ {2}/u);
    }
    expect(content.body).toContain('🧪…');
    expect(content.body).toContain(`+96 ${language === 'da' ? 'flere' : 'more'}`);
    expect(payload.length + 1 + 16).toBeLessThanOrEqual(4096);
    expect(() => encryptWebPushPayload(subscription('record-bound'), payload)).not.toThrow();
  });

  it('preserves an alert due time when truncating its Unicode title', () => {
    const payload = JSON.parse(buildPushPayload({
      ...request, count: 1, details: [{ title: '🧪'.repeat(100), dueAt: '2026-10-20T08:00:00Z' }],
    }).toString());
    expect(Array.from(payload.body)).toHaveLength(80);
    expect(payload.body).toMatch(/… · 10:00$/u);
    expect(payload.body).not.toMatch(/\p{Cs}/u);
  });

  it.each(['en', 'da'] as const)('collapses all private line breaks and controls into a safe single %s detail line', (language) => {
    const payload = JSON.parse(buildPushPayload({
      ...request, language, count: 1,
      details: [{ title: ' \tSynthetic \u0000 \u202e  safe\nsecond\r\nline\u2028third\ud800 ', dueAt: null }],
    }).toString());
    expect(payload.body).toBe('Synthetic safe second line third');
    expect(payload.title).toBe(language === 'da' ? 'Tidskritisk' : 'Time-critical');
  });

  it.each([2, 3, 4])('fits %s-item bodies with long Unicode details without losing the overflow line', (count) => {
    const payload = JSON.parse(buildPushPayload({
      ...request, kind: 'overdue', count,
      details: Array.from({ length: Math.min(3, count) }, () => ({ title: '🧪'.repeat(100), dueAt: '2026-10-20T08:00:00Z' })),
    }).toString());
    expect(Array.from(payload.body).length).toBeLessThanOrEqual(240);
    expect(payload.body.split('\n')).toHaveLength(Math.min(3, count) + (count > 3 ? 1 : 0));
    expect(payload.body.split('\n').every((line: string) => Array.from(line).length <= 80)).toBe(true);
    if (count > 3) expect(payload.body).toMatch(/\n\+1 more$/u);
  });

  it.each(['en', 'da'] as const)('falls back safely with absent, empty, or invalid %s reminder details', (language) => {
    for (const details of [undefined, [], [{ title: '\u0000\n ', dueAt: null }], [{ title: '', dueAt: 'invalid' }]]) {
      const payload = JSON.parse(buildPushPayload({
        ...request, kind: 'due_soon', count: 1, language, details,
      }).toString());
      expect(payload).toMatchObject({
        title: language === 'da' ? 'En todo forfalder inden for en time' : 'A todo is due within the hour',
        body: '',
      });
    }
  });

  it('uses the injected sender clock for composition, not wall-clock time', async () => {
    const fixture = storeFixture([subscription('clock')]);
    const send = vi.fn<(subscription: StoredPushSubscription, payload: Buffer) => Promise<WebPushResult>>(async () =>
      ({ attempted: 1, accepted: true, statusCode: 201, removed: false }));
    const sender = createSystemPushSender({
      store: fixture.store, ownerObjectId: owner, publicOrigin: 'https://jarvis.example',
      now: () => new Date('2026-10-20T08:00:00Z'), send,
    });
    await sender({
      ...request, kind: 'due_soon', count: 1,
      details: [{ title: 'Synthetic clock task', dueAt: '2026-10-20T08:30:00Z' }],
    }, new AbortController().signal);
    expect(JSON.parse(send.mock.calls[0]![1].toString()))
      .toMatchObject({ title: 'Todo due at 10:30', body: 'Synthetic clock task' });
  });

  it.each([false, true])('keeps details out of outcomes, logs and persisted results (throw=%s)', async (throws) => {
    const canary = 'SYNTHETIC_PUSH_DETAIL_CANARY';
    const fixture = storeFixture([subscription('privacy')]);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const sender = createSystemPushSender({
      store: fixture.store, ownerObjectId: owner, publicOrigin: 'https://jarvis.example',
      now: () => new Date('2026-10-20T08:00:00Z'), logger,
      send: async (_subscription, payload) => {
        expect(payload.toString()).toContain(canary);
        if (throws) throw new Error(canary);
        return { attempted: 1, accepted: true, statusCode: 201, removed: false };
      },
    });
    const result = await sender({ ...request, count: 1, details: [{ title: canary, dueAt: null }] }, new AbortController().signal);
    expect(result.status).toBe(throws ? 'failed' : 'sent');
    expect(JSON.stringify({ result, logs: [logger.info.mock.calls, logger.warn.mock.calls],
      writes: [fixture.result.mock.calls, fixture.remove.mock.calls] })).not.toContain(canary);
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
