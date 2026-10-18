import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FindingsStoredContext, ProactiveEngineOptions } from './engine.js';
import { registerProactive, type ProactiveCompositionOptions } from './composition.js';
import type { AlertLedgerStore } from './alert-ledger.js';
import type { PushStore } from '../database/push-store.js';
import type { SystemPushOutcome, SystemPushRequest } from './push-delivery.js';

const captured = vi.hoisted(() => ({ options: undefined as ProactiveEngineOptions | undefined }));

vi.mock('./engine.js', async () => {
  const actual = await vi.importActual<typeof import('./engine.js')>('./engine.js');
  return {
    ...actual,
    createProactiveEngine: (options: ProactiveEngineOptions) => {
      captured.options = options;
      return vi.fn(async () => {});
    },
  };
});

vi.mock('./scheduler.js', () => ({
  createProactiveScheduler: () => ({ start: vi.fn(async () => {}), stop: vi.fn(async () => {}) }),
}));

const owner = '11111111-1111-4111-8111-111111111111';
const apps: ReturnType<typeof Fastify>[] = [];

async function composition(gates: Partial<ProactiveCompositionOptions> = {}) {
  captured.options = undefined;
  const app = Fastify({ logger: false });
  apps.push(app);
  const pushStore = {
    listSubscriptions: vi.fn(async () => [{
      id: '22222222-2222-4222-8222-222222222222',
      endpoint: 'https://push.example.test/device/synthetic',
      p256dh: 'synthetic',
      auth: 'synthetic',
    }]),
    updateItemDelivery: vi.fn(async () => {}),
  } as unknown as PushStore;
  const ledger: AlertLedgerStore = {
    get: vi.fn(async () => undefined),
    countSent: vi.fn(async () => 0),
    upsert: vi.fn(async (input) => ({
      ...input, id: '33333333-3333-4333-8333-333333333333', attempts: 1,
    })),
  };
  const send = vi.fn(async (): Promise<SystemPushOutcome> => ({
    status: 'sent', reason: null, attempted: 1, accepted: 1, statusCode: 202,
  }));
  const existingHook = vi.fn(async () => {});
  registerProactive(app, {
    enabled: true,
    ownerObjectId: owner,
    now: () => new Date('2026-10-20T08:00:00.000Z'),
    alertsEnabled: true,
    pushEnabled: true,
    pushStore,
    alertLedgerStore: ledger,
    systemPushSender: send as (request: SystemPushRequest, signal: AbortSignal) => Promise<SystemPushOutcome>,
    onFindingsStored: [existingHook],
    ...gates,
  });
  await app.ready();
  return { app, pushStore, ledger, send, existingHook };
}

function context(item: { id: string }): FindingsStoredContext {
  return {
    runId: '44444444-4444-4444-8444-444444444444',
    trigger: 'scheduled',
    now: new Date('2026-10-20T08:00:00.000Z'),
    signal: new AbortController().signal,
    findings: [{
      itemId: item.id,
      dedupeKey: 'composition:deadline',
      category: 'deadline',
      urgency: 'time_critical',
      dueAt: '2026-10-20T09:00:00.000Z',
      language: 'en',
    }],
    facts: [],
    sources: [],
  };
}

afterEach(async () => {
  captured.options = undefined;
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('proactive alert composition', () => {
  it.each([
    { enabled: false },
    { pushEnabled: false },
    { alertsEnabled: false },
    { pushStore: undefined },
    { systemPushSender: undefined },
  ])('does not register an alert hook when a required gate or dependency is absent %#', async (gates) => {
    const fixture = await composition(gates);
    const options = captured.options;
    if (options) {
      const hooks = options.onFindingsStored ?? [];
      expect(hooks).toHaveLength(1);
      await Promise.all(hooks.map((hook) => hook(context({ id: '55555555-5555-4555-8555-555555555555' }))));
    }
    expect(fixture.ledger.get).not.toHaveBeenCalled();
    expect(fixture.ledger.countSent).not.toHaveBeenCalled();
    expect(fixture.ledger.upsert).not.toHaveBeenCalled();
    expect(fixture.pushStore.listSubscriptions).not.toHaveBeenCalled();
    expect(fixture.send).not.toHaveBeenCalled();
  });

  it('adds exactly one alert hook after existing hooks when all switches and dependencies exist', async () => {
    const fixture = await composition();
    const options = captured.options!;
    expect(options.onFindingsStored).toHaveLength(2);
    const item = await options.store.items.upsertFinding({
      dedupeKey: 'composition:deadline',
      title: 'Synthetic private title',
      body: 'Synthetic private body.',
      category: 'deadline',
      urgency: 'time_critical',
      dueAt: '2026-10-20T09:00:00.000Z',
      evidence: [],
      runId: '44444444-4444-4444-8444-444444444444',
      language: 'en',
    });
    await options.onFindingsStored![1]!(context(item));
    expect(fixture.ledger.get).toHaveBeenCalledOnce();
    expect(fixture.ledger.countSent).toHaveBeenCalledOnce();
    expect(fixture.pushStore.listSubscriptions).toHaveBeenCalledOnce();
    expect(fixture.send).toHaveBeenCalledOnce();
    expect(fixture.ledger.upsert).toHaveBeenCalledOnce();
  });
});
