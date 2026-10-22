import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FindingsStoredContext } from './engine.js';
import { createProactiveAlertHook, proactiveAlertKey } from './alerts.js';
import { createMemoryAlertLedgerStore } from './alert-ledger.js';
import { createMemoryProactiveStore } from './store.js';
import { createSystemPushSender, type SystemPushOutcome, type SystemPushRequest } from './push-delivery.js';
import type { Item } from './types.js';
import type { PushStore } from '../database/push-store.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-10-20T08:00:00.000Z');
const subscription = {
  id: '33333333-3333-4333-8333-333333333333',
  endpoint: 'https://push.example.test/device/synthetic',
  p256dh: 'synthetic',
  auth: 'synthetic',
};

function makeContext(
  findings: FindingsStoredContext['findings'],
  overrides: Partial<FindingsStoredContext> = {},
): FindingsStoredContext {
  return {
    runId: RUN,
    trigger: 'scheduled',
    now: NOW,
    signal: new AbortController().signal,
    findings,
    facts: [],
    sources: [],
    ...overrides,
  };
}

function setup(options: {
  now?: () => Date;
  subscriptionList?: typeof subscription[];
  send?: (request: SystemPushRequest, signal: AbortSignal) => Promise<SystemPushOutcome>;
  logger?: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
} = {}) {
  const store = createMemoryProactiveStore(OWNER);
  const ledger = createMemoryAlertLedgerStore();
  for (const method of ['get', 'countSent', 'upsert'] as const) {
    const original = ledger[method].bind(ledger);
    vi.spyOn(ledger, method).mockImplementation((...args) => original(...args) as never);
  }
  const pushStore = {
    listSubscriptions: vi.fn(async () => options.subscriptionList ?? [subscription]),
    readVapidKey: vi.fn(async () => ({ publicKey: 'synthetic', privateKey: 'synthetic' })),
    insertVapidKey: vi.fn(async () => {}),
    removeSubscription: vi.fn(async () => {}),
    recordSubscriptionResult: vi.fn(async () => {}),
    updateItemDelivery: vi.fn(async () => {}),
  };
  const send = vi.fn(options.send ?? (async () => ({
    status: 'sent', reason: null, attempted: 1, accepted: 1, statusCode: 202,
  } satisfies SystemPushOutcome)));
  const logger = options.logger ?? { info: vi.fn(), warn: vi.fn() };
  const hook = createProactiveAlertHook({
    store,
    pushStore,
    ownerObjectId: OWNER,
    ledger,
    send,
    now: options.now ?? (() => new Date(NOW)),
    logger,
  });
  return { store, ledger, pushStore, send, logger, hook };
}

async function saveFinding(
  store: ReturnType<typeof createMemoryProactiveStore>,
  key: string,
  category: NonNullable<Item['category']> = 'deadline',
  overrides: Partial<Parameters<typeof store.items.upsertFinding>[0]> = {},
) {
  const item = await store.items.upsertFinding({
    dedupeKey: key,
    title: 'Synthetic alert title',
    body: 'Synthetic alert body.',
    category,
    urgency: 'time_critical',
    dueAt: null,
    evidence: [],
    runId: RUN,
    language: 'en',
    ...overrides,
  });
  return { ...item, dedupeKey: key };
}

function contextFor(items: readonly (Item & { dedupeKey: string })[], overrides: Partial<FindingsStoredContext> = {}) {
  return makeContext(items.map((item) => ({
    itemId: item.id,
    dedupeKey: item.dedupeKey,
    category: item.category!,
    urgency: item.urgency,
    dueAt: item.dueAt,
    language: item.language ?? 'en',
  })), overrides);
}

afterEach(() => { vi.restoreAllMocks(); });

describe('proactive alert hook', () => {
  it('does nothing for manual runs, pre-aborted signals, paused settings, and quiet hours', async () => {
    const fixture = setup();
    const item = await saveFinding(fixture.store, 'manual');
    await fixture.hook(contextFor([item], { trigger: 'manual' }));
    expect(fixture.pushStore.listSubscriptions).not.toHaveBeenCalled();
    expect(fixture.ledger.get).not.toHaveBeenCalled();
    expect(fixture.send).not.toHaveBeenCalled();

    const controller = new AbortController();
    controller.abort();
    const settingsRead = vi.spyOn(fixture.store.settings, 'read');
    await fixture.hook(contextFor([item], { signal: controller.signal }));
    expect(settingsRead).not.toHaveBeenCalled();

    await fixture.store.settings.patch({ paused: true });
    await fixture.hook(contextFor([item]));
    expect(fixture.pushStore.listSubscriptions).not.toHaveBeenCalled();
    expect(fixture.ledger.get).not.toHaveBeenCalled();
    expect(fixture.send).not.toHaveBeenCalled();

    await fixture.store.settings.patch({ paused: false });
    let calls = 0;
    fixture.hook = createProactiveAlertHook({
      store: fixture.store,
      pushStore: fixture.pushStore,
      ownerObjectId: OWNER,
      ledger: fixture.ledger,
      send: fixture.send,
      now: () => new Date(calls++ === 0 ? '2026-10-20T19:59:00.000Z' : '2026-10-20T20:00:00.000Z'),
    });
    await fixture.hook(contextFor([item], { now: new Date('2026-10-20T19:59:00.000Z') }));
    expect(fixture.pushStore.listSubscriptions).not.toHaveBeenCalled();
    expect(fixture.ledger.get).not.toHaveBeenCalled();
    expect(fixture.send).not.toHaveBeenCalled();
  });

  it('logs and stops when there is no subscription before touching the ledger', async () => {
    const fixture = setup({ subscriptionList: [] });
    const item = await saveFinding(fixture.store, 'unsubscribed');
    await fixture.hook(contextFor([item]));
    expect(fixture.pushStore.listSubscriptions).toHaveBeenCalledOnce();
    expect(fixture.ledger.get).not.toHaveBeenCalled();
    expect(fixture.send).not.toHaveBeenCalled();
    expect(fixture.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runId: RUN, reason: 'no_subscription', count: 1 }),
      'proactive.alert',
    );
  });

  it('maps only permitted time-critical categories and bundles deterministically by due date then key', async () => {
    const fixture = setup();
    const noDue = await saveFinding(fixture.store, 'd', 'travel', { dueAt: null, language: 'da' });
    const tiedLaterKey = await saveFinding(fixture.store, 'b', 'clash', { dueAt: '2026-10-20T09:00:00.000Z' });
    const tiedFirstKey = await saveFinding(fixture.store, 'a', 'deadline', { dueAt: '2026-10-20T09:00:00.000Z', language: 'da' });
    const modelCategory = await saveFinding(fixture.store, 'model', 'prep', { dueAt: '2026-10-20T07:00:00.000Z' });
    const normalUrgency = await saveFinding(fixture.store, 'normal', 'deadline', { urgency: 'normal' });
    const undatedDigest = await saveFinding(fixture.store, 'digest', 'todo', {
      urgency: 'normal', dueAt: null,
    });
    await fixture.hook(contextFor([
      noDue, tiedLaterKey, tiedFirstKey, modelCategory, normalUrgency, undatedDigest,
    ], { trigger: 'catchup' }));

    expect(fixture.send).toHaveBeenCalledOnce();
    expect(fixture.send).toHaveBeenCalledWith({
      kind: 'alert', count: 3, language: 'da', itemId: tiedFirstKey.id, origin: 'proactive_alert',
      details: [tiedFirstKey, tiedLaterKey, noDue].map(({ title, dueAt }) => ({ title, dueAt })),
    }, expect.any(AbortSignal));
    expect(await fixture.ledger.get(proactiveAlertKey('deadline_24h', 'a'))).toMatchObject({ status: 'sent' });
    expect(await fixture.ledger.get(proactiveAlertKey('calendar_clash', 'b'))).toMatchObject({ status: 'sent' });
    expect(await fixture.ledger.get(proactiveAlertKey('travel_disruption', 'd'))).toMatchObject({ status: 'sent' });
    expect(await fixture.ledger.get(proactiveAlertKey('deadline_24h', 'model'))).toBeUndefined();
    expect(await fixture.ledger.get(proactiveAlertKey('deadline_24h', 'normal'))).toBeUndefined();
    expect(await fixture.ledger.get(proactiveAlertKey('deadline_24h', 'digest'))).toBeUndefined();
    expect(fixture.pushStore.updateItemDelivery).toHaveBeenCalledTimes(3);
    expect(fixture.pushStore.updateItemDelivery).toHaveBeenCalledWith(tiedFirstKey.id, 'accepted', 202);
    expect(fixture.pushStore.updateItemDelivery).toHaveBeenCalledWith(tiedLaterKey.id, 'accepted', 202);
    expect(fixture.pushStore.updateItemDelivery).toHaveBeenCalledWith(noDue.id, 'accepted', 202);
    expect(await fixture.ledger.countSent('2026-10-20')).toBe(1);
  });

  it('re-reads item states immediately before sending and drops seen, snoozed and dismissed findings', async () => {
    const fixture = setup();
    const turnedSeen = await saveFinding(fixture.store, 'changed');
    const seen = await saveFinding(fixture.store, 'seen');
    const snoozed = await saveFinding(fixture.store, 'snoozed');
    const dismissed = await saveFinding(fixture.store, 'dismissed');
    const stillNew = await saveFinding(fixture.store, 'new');
    await fixture.store.items.applyFeedback(seen.id, 'seen');
    await fixture.store.items.applyFeedback(snoozed.id, 'snooze', '2026-10-20T09:00:00.000Z');
    await fixture.store.items.applyFeedback(dismissed.id, 'dismiss');
    const getMany = fixture.store.items.getMany.bind(fixture.store.items);
    vi.spyOn(fixture.store.items, 'getMany').mockImplementation(async (ids) => {
      await fixture.store.items.applyFeedback(turnedSeen.id, 'seen');
      return getMany(ids);
    });
    await fixture.hook(contextFor([turnedSeen, seen, snoozed, dismissed, stillNew]));
    expect(fixture.store.items.getMany).toHaveBeenCalledOnce();
    expect(fixture.send).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1, itemId: stillNew.id }), expect.any(AbortSignal),
    );
    expect(fixture.pushStore.updateItemDelivery).toHaveBeenCalledOnce();
  });

  it('sends one alert per key, retries one failure, then settles the key', async () => {
    const failing = setup({ send: async () => ({
      status: 'failed', reason: 'provider_unavailable', attempted: 1, accepted: 0, statusCode: 503,
    }) });
    const item = await saveFinding(failing.store, 'retry-once');
    await failing.hook(contextFor([item]));
    await failing.hook(contextFor([item], { runId: '44444444-4444-4444-8444-444444444444' }));
    expect(failing.send).toHaveBeenCalledTimes(2);
    expect(await failing.ledger.get(proactiveAlertKey('deadline_24h', 'retry-once')))
      .toMatchObject({ status: 'failed', attempts: 2, reason: 'provider_unavailable' });
    expect(failing.pushStore.updateItemDelivery).toHaveBeenCalledTimes(2);
    expect(failing.pushStore.updateItemDelivery).toHaveBeenCalledWith(item.id, 'failed', 503);

    const success = setup();
    const sent = await saveFinding(success.store, 'one-time');
    await success.hook(contextFor([sent]));
    await success.hook(contextFor([sent], { runId: '55555555-5555-4555-8555-555555555555' }));
    expect(success.send).toHaveBeenCalledOnce();
    expect(await success.ledger.get(proactiveAlertKey('deadline_24h', 'one-time'))).toMatchObject({
      status: 'sent', attempts: 1,
    });
  });

  it.each([
    { now: '2026-10-25T17:00:00.000Z', day: '2026-10-25', next: '2026-10-26T17:00:00.000Z' },
    { now: '2027-03-28T16:00:00.000Z', day: '2027-03-28', next: '2027-03-29T16:00:00.000Z' },
  ])('enforces the daily cap per Copenhagen day across DST boundary $day', async ({ now, day, next }) => {
    const fixture = setup({ now: () => new Date(now) });
    for (let index = 0; index < 3; index++) {
      await fixture.ledger.upsert({
        alertKey: `${index}`.padStart(32, '0'),
        class: 'deadline_24h',
        itemId: randomUUID(),
        runId: randomUUID(),
        dayKey: day,
        status: 'sent',
        reason: null,
      });
    }
    const item = await saveFinding(fixture.store, `cap-${day}`);
    await fixture.hook(contextFor([item]));
    expect(fixture.send).not.toHaveBeenCalled();
    expect(await fixture.ledger.get(proactiveAlertKey('deadline_24h', `cap-${day}`))).toBeUndefined();
    fixture.hook = createProactiveAlertHook({
      store: fixture.store,
      pushStore: fixture.pushStore,
      ownerObjectId: OWNER,
      ledger: fixture.ledger,
      send: fixture.send,
      now: () => new Date(next),
    });
    await fixture.hook(contextFor([item]));
    expect(fixture.send).toHaveBeenCalledOnce();
  });

  it('sends only the stored title, not source/body/evidence, and keeps content out of logs and ledger', async () => {
    const canary = 'SYNTHETIC_PRIVATE_CANARY_7f31';
    const fixture = setup();
    const payloads: Buffer[] = [];
    const item = await saveFinding(fixture.store, 'canary', 'deadline', {
      title: `${canary} title`, body: `${canary} body`,
      evidence: [{ source: 'todos', label: `${canary} evidence`, observedAt: NOW.toISOString() }],
    });
    const context = contextFor([item], {
      facts: [{
        ref: 'synthetic-ref', source: 'todos', kind: 'todo', text: `${canary} todo text`,
      }],
      findings: contextFor([item]).findings.map((finding) => ({ ...finding, suggestedTodo: `${canary} suggested todo` })),
    });
    const systemSender = createSystemPushSender({
      store: fixture.pushStore as unknown as PushStore,
      ownerObjectId: OWNER,
      publicOrigin: 'https://jarvis.example',
      now: () => new Date(NOW),
      generateKeys: () => ({ publicKey: 'synthetic', privateKey: 'synthetic' }),
      send: async (_sub, payload) => {
        payloads.push(Buffer.from(payload));
        return { attempted: 1, accepted: true, statusCode: 202, removed: false };
      },
      logger: fixture.logger,
    });
    const hook = createProactiveAlertHook({
      store: fixture.store,
      pushStore: fixture.pushStore,
      ownerObjectId: OWNER,
      ledger: fixture.ledger,
      send: systemSender,
      now: () => new Date(NOW),
      logger: fixture.logger,
    });
    await hook(context);
    expect(payloads).toHaveLength(1);
    expect(JSON.parse(payloads[0]!.toString()).body).toBe(`${canary} title`);
    for (const suffix of ['body', 'evidence', 'todo text', 'suggested todo']) {
      expect(payloads[0]!.toString()).not.toContain(`${canary} ${suffix}`);
    }
    expect(JSON.stringify(vi.mocked(fixture.ledger.upsert).mock.calls)).not.toContain(canary);
    expect(JSON.stringify(fixture.pushStore.updateItemDelivery.mock.calls)).not.toContain(canary);
    expect(JSON.stringify(fixture.logger.info.mock.calls)).not.toContain(canary);
    expect(JSON.stringify(fixture.logger.warn.mock.calls)).not.toContain(canary);
    expect(fixture.send).not.toHaveBeenCalled();

    const throwing = setup();
    const throwingItem = await saveFinding(throwing.store, 'store-failure');
    vi.spyOn(throwing.store.settings, 'read').mockRejectedValue(new Error(canary));
    await expect(throwing.hook(contextFor([throwingItem]))).resolves.toBeUndefined();
    expect(throwing.send).not.toHaveBeenCalled();
    expect(JSON.stringify(throwing.logger.warn.mock.calls)).not.toContain(canary);
  });

  it('reads no more than three stored details without marking loaded or seen', async () => {
    const fixture = setup();
    const items = await Promise.all(Array.from({ length: 5 }, (_, index) =>
      saveFinding(fixture.store, `detail-${index}`, 'deadline', {
        title: `Synthetic stored title ${index}`, dueAt: `2026-10-20T${10 + index}:00:00Z`,
      })));
    const get = vi.spyOn(fixture.store.items, 'get');
    const feedback = vi.spyOn(fixture.store.items, 'applyFeedback');
    await fixture.hook(contextFor([...items].reverse()));
    expect(get.mock.calls).toEqual(items.slice(0, 3).map(({ id }) => [id, false]));
    expect(feedback).not.toHaveBeenCalled();
    expect(fixture.send).toHaveBeenCalledWith(expect.objectContaining({
      count: 5, details: items.slice(0, 3).map(({ title, dueAt }) => ({ title, dueAt })),
    }), expect.any(AbortSignal));
    expect((await fixture.store.items.list('all', 10, NOW)).every(({ state }) => state === 'new')).toBe(true);
  });

  it.each(['missing', 'throw'] as const)('still sends a headline when detail lookup is %s', async (failure) => {
    const fixture = setup();
    const item = await saveFinding(fixture.store, 'detail-unavailable');
    const get = vi.spyOn(fixture.store.items, 'get');
    if (failure === 'missing') get.mockResolvedValue(undefined);
    else get.mockRejectedValue(new Error('SYNTHETIC_PRIVATE_DETAIL_ERROR'));
    await fixture.hook(contextFor([item]));
    expect(fixture.send).toHaveBeenCalledWith(expect.objectContaining({ count: 1, details: [] }), expect.any(AbortSignal));
    expect(await fixture.ledger.get(proactiveAlertKey('deadline_24h', 'detail-unavailable'))).toMatchObject({ status: 'sent' });
    expect(JSON.stringify([fixture.logger.info.mock.calls, fixture.logger.warn.mock.calls, vi.mocked(fixture.ledger.upsert).mock.calls]))
      .not.toContain('SYNTHETIC_PRIVATE_DETAIL_ERROR');
  });

  it('never persists or logs a thrown sender error containing push details', async () => {
    const canary = 'SYNTHETIC_PRIVATE_SEND_ERROR';
    const fixture = setup({ send: async (request) => { throw new Error(request.details![0]!.title); } });
    const item = await saveFinding(fixture.store, 'send-error', 'deadline', { title: canary });
    await expect(fixture.hook(contextFor([item]))).resolves.toBeUndefined();
    expect(fixture.ledger.upsert).not.toHaveBeenCalled();
    expect(fixture.pushStore.updateItemDelivery).not.toHaveBeenCalled();
    expect(JSON.stringify([fixture.logger.info.mock.calls, fixture.logger.warn.mock.calls])).not.toContain(canary);
  });
});
