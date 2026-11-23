import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { createProactiveScheduler } from '../scheduler.js';
import { registerProactiveRoutes } from '../routes.js';
import { createMemoryProactiveStore } from '../store.js';
import { createMemoryOutreachStore } from './outreach-store.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-15T02:00:00.000Z');

async function build(caller: string | null = OWNER) {
  const app = Fastify();
  app.decorateRequest('principal', null);
  app.addHook('onRequest', async (request) => {
    (request as unknown as { principal: unknown }).principal = caller ? { objectId: caller } : null;
  });
  const store = createMemoryProactiveStore(OWNER);
  const outreach = createMemoryOutreachStore();
  registerProactiveRoutes(app as never, {
    store, ownerObjectId: OWNER, todoWritesEnabled: false, alertsEnabled: true, pushEnabled: true,
    databaseAvailable: false, registerItemDetail: true, now: () => NOW, outreach,
  });
  await app.ready();
  const item = await store.items.upsertFinding({
    dedupeKey: 'outreach:b:0', title: 'Deploy failed', body: 'Main is red', category: 'status', suggestionScope: 'unknown',
    urgency: 'normal', dueAt: null, evidence: [], runId: null,
  });
  const record = await outreach.create({
    decision: { eventIds: ['e'], tier: 'medium', title: 'Deploy failed', body: 'Main is red', why: 'w', category: 'status' },
    batchId: 'b', itemId: item.id,
  }, NOW);
  return { app, store, outreach, item, record };
}

describe('outreach thumbs', () => {
  it('stores a thumbs rating with a note and mirrors it onto the finding', async () => {
    const { app, store, outreach, item, record } = await build();
    const response = await app.inject({ method: 'POST', url: `/proactive/outreach/${record.id}/feedback`, payload: { rating: 'down', note: 'too noisy' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ rating: 'down', ratingNote: 'too noisy' });
    expect((await outreach.get(record.id))?.rating).toBe('down');
    expect((await store.items.get(item.id, false))?.feedback).toBe('wrong');
    await app.close();
  });

  it('keeps the outreach rating in step when the finding is rated on the Proactive page', async () => {
    const { app, outreach, item, record } = await build();
    const response = await app.inject({ method: 'POST', url: `/proactive/items/${item.id}/feedback`, payload: { action: 'useful' } });
    expect(response.statusCode).toBe(200);
    expect((await outreach.get(record.id))?.rating).toBe('up');
    await app.close();
  });

  it('lists recent outreach for the owner', async () => {
    const { app, record } = await build();
    const response = await app.inject({ method: 'GET', url: '/proactive/outreach?limit=5' });
    expect(response.json().outreach).toMatchObject([{ id: record.id, tier: 'medium', rating: null }]);
    await app.close();
  });

  it.each([
    ['an invalid rating', { rating: 'maybe' }, 400],
    ['an unknown field', { rating: 'up', extra: 1 }, 400],
    ['a control character in the note', { rating: 'up', note: 'a\nb' }, 400],
  ])('rejects %s', async (_label, payload, status) => {
    const { app, record } = await build();
    expect((await app.inject({ method: 'POST', url: `/proactive/outreach/${record.id}/feedback`, payload })).statusCode).toBe(status);
    await app.close();
  });

  it('answers 404 for an unknown outreach and 403 for anyone but the owner', async () => {
    const { app, record } = await build();
    expect((await app.inject({ method: 'POST', url: '/proactive/outreach/22222222-2222-4222-8222-222222222222/feedback', payload: { rating: 'up' } })).statusCode).toBe(404);
    await app.close();
    const stranger = await build('99999999-9999-4999-8999-999999999999');
    expect((await stranger.app.inject({ method: 'POST', url: `/proactive/outreach/${record.id}/feedback`, payload: { rating: 'up' } })).statusCode).toBe(403);
    expect((await stranger.app.inject({ method: 'GET', url: '/proactive/outreach' })).statusCode).toBe(403);
    await stranger.app.close();
  });
});

describe('proactive PI policy', () => {
  it('keeps the combined allowance in 1-12 and the hard spend cap at 100 DKK', async () => {
    const { app } = await build();
    const current = (await app.inject({ method: 'GET', url: '/proactive/settings' })).json();
    expect(current.backgroundTurnsPerDay).toBe(12);
    const tooMany = await app.inject({
      method: 'PATCH', url: '/proactive/settings',
      payload: { backgroundTurnsPerDay: 13, expectedRevision: current.revision },
    });
    expect(tooMany.statusCode).toBe(400);
    const overBudget = await app.inject({
      method: 'PATCH', url: '/proactive/settings',
      payload: { monthlyBudgetDkk: 101, expectedRevision: current.revision },
    });
    expect(overBudget.statusCode).toBe(400);
    const saved = await app.inject({
      method: 'PATCH', url: '/proactive/settings',
      payload: { backgroundTurnsPerDay: 4, expectedRevision: current.revision },
    });
    expect(saved.json()).toMatchObject({ backgroundTurnsPerDay: 4 });
    await app.close();
  });

  it('wakes an active consumer when the combined allowance changes', async () => {
    const store = createMemoryProactiveStore(OWNER);
    const changed = vi.fn();
    store.settings.subscribePreferencesChanged(changed);
    await store.settings.patch({ backgroundTurnsPerDay: 5 });
    expect(changed).toHaveBeenCalledTimes(1);
  });
});

describe('scheduler event tick', () => {
  it('runs the event pipeline on every tick, also during quiet hours, without touching the 07:00 and 18:00 slots', async () => {
    const store = createMemoryProactiveStore(OWNER);
    const run = vi.fn(async () => undefined);
    const onTick = vi.fn(async () => undefined);
    const scheduler = createProactiveScheduler({ store, now: () => NOW, run, onTick });
    await scheduler.tick();
    await scheduler.tick();
    expect(onTick).toHaveBeenCalledTimes(2);
    expect(run).not.toHaveBeenCalled();
    await scheduler.stop();
  });

  it('still starts the 07:00 check when it is due', async () => {
    const store = createMemoryProactiveStore(OWNER);
    const run = vi.fn(async () => undefined);
    const onTick = vi.fn(async () => undefined);
    const scheduler = createProactiveScheduler({ store, now: () => new Date('2026-11-15T06:00:30.000Z'), run, onTick });
    await scheduler.tick();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(onTick).toHaveBeenCalledTimes(1);
    await scheduler.stop();
  });

  it('survives a failing event pipeline and says where it failed and what was thrown', async () => {
    const store = createMemoryProactiveStore(OWNER);
    const warn = vi.fn();
    class RequestError extends Error {}
    const scheduler = createProactiveScheduler({
      store, now: () => NOW, run: vi.fn(), onTick: async () => { throw new RequestError('private message'); }, logger: { warn },
    });
    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith({ reason: 'internal_error', stage: 'event_tick', errorClass: 'RequestError' }, 'proactive.failed');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
    await scheduler.stop();
  });
});

describe('scheduler failures: where they happen, what was thrown, and what still runs', () => {
  const SLOT_TIME = new Date('2026-11-15T06:00:30.000Z');
  class RequestError extends Error {}
  const setup = (run?: () => Promise<void>) => {
    const store = createMemoryProactiveStore(OWNER);
    const warn = vi.fn();
    const onTick = vi.fn(async () => undefined);
    const scheduler = createProactiveScheduler({ store, now: () => SLOT_TIME, ...(run ? { run } : {}), onTick, logger: { warn } });
    return { store, warn, onTick, scheduler };
  };

  it('records a run that throws as failed and logs it with its class, where it used to leave no line at all', async () => {
    const { store, warn, scheduler } = setup(async () => { throw new TypeError('private message'); });
    await scheduler.tick();
    await vi.waitFor(async () => expect(await store.runs.latest()).toMatchObject({ status: 'failed', reason: 'internal_error' }));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({ reason: 'internal_error', stage: 'run', errorClass: 'TypeError' }, 'proactive.failed');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
    await scheduler.stop();
  });

  it('logs a failure that could not be recorded either as its own stage', async () => {
    const { store, warn, scheduler } = setup(async () => { throw new TypeError('private message'); });
    store.runs.finish = async () => { throw new RequestError('private message'); };
    await scheduler.tick();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
    expect(warn.mock.calls.map(([fields]) => fields)).toEqual([
      { reason: 'internal_error', stage: 'run', errorClass: 'TypeError' },
      { reason: 'internal_error', stage: 'run_finish', errorClass: 'RequestError' },
    ]);
    await scheduler.stop();
  });

  it('does not log a run that was cancelled by quiet hours or a restart as a failure', async () => {
    const { warn, scheduler, store } = setup(async () => { await new Promise((_resolve, reject) => setTimeout(() => reject(new Error('aborted')), 20)); });
    await scheduler.tick();
    await scheduler.stop();
    expect(warn).not.toHaveBeenCalled();
    expect(await store.runs.latest()).toMatchObject({ status: 'cancelled', reason: 'interrupted_by_restart' });
  });

  it('claims the slot again on the next tick when the claim failed, so one database hiccup does not cost the day\'s sweep', async () => {
    const run = vi.fn(async () => undefined);
    const { store, warn, scheduler } = setup(run);
    const claim = store.runs.claim.bind(store.runs);
    let failures = 1;
    store.runs.claim = async (input) => {
      if (failures-- > 0) throw new RequestError('private message');
      return claim(input);
    };
    await scheduler.tick();
    expect(warn).toHaveBeenCalledWith({ reason: 'internal_error', stage: 'slot', errorClass: 'RequestError' }, 'proactive.failed');
    expect(run).not.toHaveBeenCalled();
    await scheduler.tick();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    await scheduler.tick();
    await scheduler.tick();
    expect(run).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    await scheduler.stop();
  });

  it('logs an unreadable setting as a slot failure and still gives the event tick its turn', async () => {
    const { store, warn, onTick, scheduler } = setup(vi.fn(async () => undefined));
    store.settings.read = async () => { throw new RequestError('private message'); };
    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith({ reason: 'internal_error', stage: 'slot', errorClass: 'RequestError' }, 'proactive.failed');
    expect(onTick).toHaveBeenCalledTimes(1);
    await scheduler.stop();
  });

  it('keeps ticking after a failed startup write instead of staying stopped for the life of the process, and says so', async () => {
    const { store, warn, onTick, scheduler } = setup(vi.fn(async () => undefined));
    store.runs.markInterruptedOnStartup = async () => { throw new RequestError('private message'); };
    await scheduler.start();
    expect(warn).toHaveBeenCalledWith({ reason: 'internal_error', stage: 'startup', errorClass: 'RequestError' }, 'proactive.failed');
    expect(onTick).toHaveBeenCalledTimes(1);
    await scheduler.tick();
    expect(onTick).toHaveBeenCalledTimes(2);
    await scheduler.stop();
  });

  it('claims no slot when nothing is there to run it, and still ticks the events', async () => {
    const { store, onTick, scheduler } = setup();
    await scheduler.tick();
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(await store.runs.latest()).toBeNull();
    await scheduler.stop();
  });
});

describe('a manual check that fails', () => {
  async function manual(options: { run: () => Promise<void>; breakFinish?: boolean }) {
    const app = Fastify();
    app.decorateRequest('principal', null);
    app.addHook('onRequest', async (request) => { (request as unknown as { principal: unknown }).principal = { objectId: OWNER }; });
    const store = createMemoryProactiveStore(OWNER);
    if (options.breakFinish) store.runs.finish = async () => { throw new Error('private message'); };
    const warn = vi.spyOn(app.log, 'warn');
    registerProactiveRoutes(app as never, {
      store, ownerObjectId: OWNER, todoWritesEnabled: false, alertsEnabled: true, pushEnabled: true,
      databaseAvailable: false, registerItemDetail: true, now: () => NOW, run: options.run,
    });
    await app.ready();
    return { app, store, warn };
  }

  it('is recorded as failed and logged with its stage and class', async () => {
    const { app, store, warn } = await manual({ run: async () => { throw new TypeError('private message'); } });
    expect((await app.inject({ method: 'POST', url: '/proactive/runs' })).statusCode).toBe(202);
    await vi.waitFor(async () => expect(await store.runs.latest()).toMatchObject({ status: 'failed', reason: 'internal_error' }));
    expect(warn).toHaveBeenCalledWith({ reason: 'internal_error', stage: 'manual_run', errorClass: 'TypeError' }, 'proactive.failed');
    await app.close();
  });

  it('logs a failure that could not be recorded as its own stage', async () => {
    const { app, warn } = await manual({ run: async () => { throw new TypeError('private message'); }, breakFinish: true });
    expect((await app.inject({ method: 'POST', url: '/proactive/runs' })).statusCode).toBe(202);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith({ reason: 'internal_error', stage: 'manual_run_finish', errorClass: 'Error' }, 'proactive.failed'));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
    await app.close();
  });
});
