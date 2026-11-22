import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerProactive } from './composition.js';
import { createMemoryProactiveStore } from './store.js';
import type { EventConsumer } from './events/wiring.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
// 07:00 in Copenhagen on 16 November 2026.
const SLOT_TIME = new Date('2026-11-16T06:00:30.000Z');

type SweepClaim = Parameters<NonNullable<EventConsumer['runScheduled']>>[0];

async function build(options: { brain?: (runScheduled: (claim: SweepClaim) => Promise<void>) => EventConsumer; run?: (claim: SweepClaim) => Promise<void> }) {
  const app = Fastify();
  app.decorateRequest('principal', null);
  app.addHook('onRequest', async (request) => { (request as unknown as { principal: unknown }).principal = { objectId: OWNER }; });
  const store = createMemoryProactiveStore(OWNER);
  // A sweep that ends normally leaves its run row finished, as the brain does.
  const finishing = async (claim: SweepClaim) => { await store.runs.finish(claim.run.id, claim.generation, 'done', null, 0, SLOT_TIME); };
  const runScheduled = vi.fn(options.run ?? finishing);
  const warn = vi.fn();
  registerProactive(app as never, {
    enabled: true, ownerObjectId: OWNER, store, now: () => SLOT_TIME, logger: { warn, info: vi.fn(), error: vi.fn() } as never,
    ...(options.brain ? { brain: () => options.brain!(runScheduled) } : {}),
  });
  await app.ready();
  return { app, store, runScheduled, warn };
}

const brainWith = (runScheduled: (claim: SweepClaim) => Promise<void>): EventConsumer => ({
  wake() {}, async start() {}, async tick() {}, runScheduled,
});

describe('proactive composition: the brain is the only scheduled path', () => {
  it('starts the 07:00 sweep through the brain and nothing else', async () => {
    const { app, store, runScheduled } = await build({ brain: brainWith });
    await vi.waitFor(() => expect(runScheduled).toHaveBeenCalledTimes(1));
    expect(runScheduled.mock.calls[0]![0].run).toMatchObject({ slot: '2026-11-16T07:00', trigger: 'scheduled' });
    expect((await store.runs.latest())?.slot).toBe('2026-11-16T07:00');
    await app.close();
  });

  it('answers Check now through the brain', async () => {
    const { app, runScheduled } = await build({ brain: brainWith });
    await vi.waitFor(() => expect(runScheduled).toHaveBeenCalledTimes(1));
    await vi.waitFor(async () => expect((await app.inject({ method: 'POST', url: '/proactive/runs' })).statusCode).toBe(202));
    await vi.waitFor(() => expect(runScheduled).toHaveBeenCalledTimes(2));
    expect(runScheduled.mock.calls[1]![0].run).toMatchObject({ slot: null, trigger: 'manual' });
    await app.close();
  });

  it('claims no slot and refuses Check now when there is no brain to run it', async () => {
    const { app, store } = await build({});
    expect(await store.runs.latest()).toBeNull();
    const response = await app.inject({ method: 'POST', url: '/proactive/runs' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'not_available' });
    await app.close();
  });

  it('logs a sweep that throws with its stage and class, through the logger it was given', async () => {
    class RequestError extends Error {}
    const { app, store, warn } = await build({ brain: brainWith, run: async () => { throw new RequestError('private message'); } });
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith({ reason: 'internal_error', stage: 'run', errorClass: 'RequestError' }, 'proactive.failed'));
    await vi.waitFor(async () => expect(await store.runs.latest()).toMatchObject({ status: 'failed', reason: 'internal_error' }));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
    await app.close();
  });
});
