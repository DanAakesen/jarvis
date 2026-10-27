import { createECDH } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PushStore } from '../database/push-store.js';
import { generateVapidKeyPair, sendWebPush } from '../push/webpush.js';
import { createMemoryAlertLedgerStore } from './alert-ledger.js';
import { createProactiveAlertHook } from './alerts.js';
import { deterministicDedupeKey } from './detect.js';
import { createProactiveEngine } from './engine.js';
import { createSystemPushSender } from './push-delivery.js';
import { createMemoryProactiveStore } from './store.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-20T08:00:00Z');

describe('deadline notification pipeline', () => {
  it.each([
    [1, 'en'], [2, 'en'], [1, 'da'], [2, 'da'],
  ] as const)('refreshes generic records and delivers %s task names and deadlines in %s', async (count, language) => {
    const store = createMemoryProactiveStore(OWNER);
    const facts = Array.from({ length: count }, (_, index) => ({
      ref: `synthetic-task-${index}`, kind: 'todo' as const, label: 'Synthetic source',
      // Same displayed name with different deadlines represents distinct tasks.
      text: 'Synthetic task', dueAt: `2026-10-20T${10 + index}:00:00.000Z`,
      observedAt: NOW.toISOString(),
    }));
    const oldItems = await Promise.all(facts.map((fact) => store.items.upsertFinding({
      title: language === 'da' ? 'Opgavefrist nærmer sig' : 'Task deadline approaching',
      body: 'SYNTHETIC_BODY_MUST_NOT_REACH_PUSH', category: 'deadline',
      urgency: 'time_critical', dueAt: fact.dueAt, evidence: [], runId: 'old-run', language,
      dedupeKey: deterministicDedupeKey('deadline', fact.text, fact.dueAt),
    })));
    const receiver = createECDH('prime256v1');
    receiver.generateKeys();
    const keys = generateVapidKeyPair();
    const subscription = {
      id: '22222222-2222-4222-8222-222222222222',
      endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/synthetic',
      p256dh: receiver.getPublicKey(undefined, 'uncompressed').toString('base64url'),
      auth: Buffer.alloc(16, 7).toString('base64url'),
    };
    const pushStore = {
      listSubscriptions: async () => [subscription], readVapidKey: async () => keys,
      insertVapidKey: async () => {}, removeSubscription: async () => {},
      recordSubscriptionResult: vi.fn(async () => {}), updateItemDelivery: vi.fn(async () => {}),
    } as unknown as PushStore;
    const logger = { info: vi.fn(), warn: vi.fn() };
    const payloads: Buffer[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      expect(new Headers(init?.headers).get('content-encoding')).toBe('aes128gcm');
      expect(Buffer.isBuffer(init?.body)).toBe(true);
      expect((init!.body as Buffer).includes(Buffer.from('Synthetic task'))).toBe(false);
      return new Response(null, { status: 201 });
    });
    const sender = createSystemPushSender({
      store: pushStore, ownerObjectId: OWNER, publicOrigin: 'https://jarvis.example',
      now: () => NOW, logger,
      transport: { fetch: fetchMock, now: () => NOW.getTime(), sleep: async () => {} },
      send: async (...args) => {
        payloads.push(Buffer.from(args[1]));
        return sendWebPush(...args);
      },
    });
    const ledger = createMemoryAlertLedgerStore();
    const hook = createProactiveAlertHook({
      store, pushStore, ledger, ownerObjectId: OWNER, send: sender, now: () => NOW, logger,
    });
    const engine = createProactiveEngine({
      store, now: () => NOW,
      sources: [{ id: 'todos', label: 'Synthetic source', read: async () => ({
        source: 'todos', state: 'ok', reason: null, observedAt: NOW.toISOString(), facts,
      }) }],
      model: { worstCaseDkk: async () => 0, summarize: async () => ({ findings: [] }) },
      conversationStore: { readRecentUserMessages: async () => [language === 'da' ? 'Jeg skal gøre det' : 'I will do that'] },
      onFindingsStored: [hook],
    });
    const claim = await store.runs.claim({ trigger: 'scheduled', slot: '2026-10-20T07:00', now: NOW });
    expect(claim).not.toBeNull();
    await engine(claim!);

    expect(await store.runs.latest()).toMatchObject({ status: 'done', findingCount: count });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(payloads).toHaveLength(1);
    expect(JSON.parse(payloads[0]!.toString())).toMatchObject({
      count, lang: language,
      body: count === 1 ? 'Synthetic task · 12:00' : '12:00 Synthetic task\n13:00 Synthetic task',
    });
    expect(payloads[0]!.toString()).not.toContain('The task');
    expect(payloads[0]!.toString()).not.toContain('Opgaven');
    expect(payloads[0]!.toString()).not.toContain('SYNTHETIC_BODY_MUST_NOT_REACH_PUSH');
    for (const old of oldItems) {
      expect(await store.items.get(old.id, false)).toMatchObject({
        id: old.id, title: 'Synthetic task', state: 'new', dueAt: old.dueAt,
      });
    }
    expect(JSON.stringify([
      logger.info.mock.calls, logger.warn.mock.calls,
      vi.mocked(pushStore.recordSubscriptionResult).mock.calls,
      vi.mocked(pushStore.updateItemDelivery).mock.calls,
    ])).not.toContain('Synthetic task');
  });
});
