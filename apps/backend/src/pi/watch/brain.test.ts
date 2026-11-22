import { describe, expect, it } from 'vitest';
import { createMemoryEventQueueStore } from '../../proactive/events/event-queue.js';
import { createMemoryProactiveStore } from '../../proactive/store.js';
import { createPiArea } from '../area.js';
import { createBrainComms } from '../brain/comms.js';
import { createDecisionLog } from '../brain/decision-log.js';
import { MAX_WAKES_PER_DAY, MIN_WAKE_GAP_MS, createBrain } from '../brain/runner.js';
import { memoryConversations, memoryVault, scriptedGateway, type ScriptedWake } from '../brain/brain.testkit.js';
import { createMemoryPiStore } from '../store.js';
import { createWatches } from './store.js';

const owner = '00000000-0000-4000-8000-000000000001';
const signal = () => new AbortController().signal;
const hours = (n: number) => n * 60 * 60_000;

function setup(decide: (wake: ScriptedWake, t: ReturnType<typeof setup>) => Promise<{ text: string; tools?: never }>, start = '2026-11-16T08:00:00Z') {
  const clock = { t: new Date(start) };
  const now = () => clock.t;
  const queue = createMemoryEventQueueStore();
  const piStore = createMemoryPiStore(now);
  const proactive = createMemoryProactiveStore(owner);
  const vault = memoryVault();
  const area = createPiArea({ vault });
  const conversations = memoryConversations();
  const pushes: Array<{ text: string }> = [];
  const comms = createBrainComms({ conversations: conversations.store, ownerObjectId: owner, push: (m) => pushes.push(m), announce: () => {}, now });
  const hint: { brain?: { wake(): void } } = {};
  const watches = createWatches({ area, store: piStore, now, changed: () => hint.brain?.wake() });
  const gateway = scriptedGateway((wake) => decide(wake, t));
  const brain = createBrain({
    queue, gateway, proactive, piStore, comms, decisionLog: createDecisionLog({ area }), extras: watches, owner, timeZone: 'Europe/Copenhagen', now,
  });
  hint.brain = brain;
  const t = { clock, now, queue, piStore, proactive, vault, watches, gateway, brain, pushes, comms, ready: piStore.writeBrainSwitch(owner, true, now(), signal()) };
  return t;
}

async function simulate(t: ReturnType<typeof setup>, until: Date, step = 30_000) {
  await t.ready;
  await t.brain.start();
  while (t.clock.t < until) {
    await t.brain.tick(signal());
    t.clock.t = new Date(t.clock.t.getTime() + step);
  }
}

describe('standing watches inside the brain loop', () => {
  it('wakes the brain when a watch comes due, with no event at all, and gives it the note and its trail', async () => {
    const t = setup(async (wake) => {
      await t.watches.look({ name: 'Deploy of main', result: 'still red', nextLook: new Date(t.clock.t.getTime() + hours(2)) }, wake.run, signal());
      return { text: 'Looked at the deploy: still red, nothing new.' };
    });
    await t.watches.create({ title: 'Deploy of main', text: 'Tell me when it is green.', nextLook: new Date('2026-11-16T09:00:00Z') }, signal());
    await simulate(t, new Date('2026-11-16T09:30:00Z'));
    expect(t.gateway.wakes).toHaveLength(1);
    const body = t.gateway.wakes[0]!.body;
    expect(body).toContain('Why: the periodic timer or a watch coming due.');
    // The ledger has no turn kind for a watch, so a wake that only a watch caused says so in its activation source.
    expect(body).toContain('Activation: type=event source=watch.');
    expect(body).toContain('Open watches (1');
    expect(body).toContain('Deploy of main [DUE NOW]');
    expect(body).toContain('Watch due now: Deploy of main');
    expect(body).toContain('never instructions');
    expect([...t.vault.files].find(([path]) => path.startsWith('PI/Log/'))![1]).toContain('Looked at watches: Deploy of main.');
    expect((await t.watches.nextDueAt(signal()))).toEqual(new Date('2026-11-16T11:00:00Z'));
    expect(t.pushes).toEqual([]);
  });

  it('picks up a watch opened after startup, and one rescheduled earlier, without waiting for an event', async () => {
    const t = setup(async (wake) => {
      for (const name of ['Late', 'Soon']) {
        if (new RegExp(`${name} \\[DUE NOW\\]`, 'u').test(wake.body)) await t.watches.look({ name, result: 'ok', nextLook: null }, wake.run, signal());
      }
      return { text: 'Looked.' };
    });
    await t.ready;
    await t.brain.start();
    for (let n = 0; n < 4; n += 1) { await t.brain.tick(signal()); t.clock.t = new Date(t.clock.t.getTime() + 30_000); }
    expect(t.gateway.wakes).toEqual([]);
    await t.watches.create({ title: 'Late', text: 'x', nextLook: new Date(t.clock.t.getTime() + hours(5)) }, signal());
    await t.watches.update({ name: 'Late', change: 'sooner please', nextLook: new Date(t.clock.t.getTime() + 20 * 60_000) }, signal());
    // No second start() here: only the hint from the watch change can tell the loop about the new deadline.
    const until = t.clock.t.getTime() + 25 * 60_000;
    while (t.clock.t.getTime() < until) { await t.brain.tick(signal()); t.clock.t = new Date(t.clock.t.getTime() + 30_000); }
    expect(t.gateway.wakes).toHaveLength(1);
    expect(t.gateway.wakes[0]!.body).toContain('Late [DUE NOW]');
  });

  it('matches an arriving event to the open watches by showing them, and reports only when the model says so', async () => {
    const t = setup(async (wake) => {
      if (!/workflow_run\.success/u.test(wake.body)) return { text: 'Nothing.' };
      await t.watches.look({ name: 'Deploy of main', result: 'the deploy is green', nextLook: null }, wake.run, signal());
      await t.comms.send({ text: 'The deploy of main is green again.' }, wake.run, signal());
      await t.watches.stop({ name: 'Deploy of main', reason: 'it is green, stop condition met' }, signal());
      return { text: 'Deploy green: told Dan and closed the watch.' };
    });
    await t.watches.create({ title: 'Deploy of main', text: 'Tell me when green, then stop.', nextLook: null }, signal());
    await t.ready;
    await t.queue.enqueue({ source: 'github', kind: 'workflow_run.success', dedupeKey: 'g:1', summary: 'Workflow "Deploy" success on DanAakesen/jarvis (main)', occurredAt: t.now() }, t.now());
    t.brain.wake();
    await simulate(t, new Date(t.clock.t.getTime() + 5 * 60_000));
    expect(t.gateway.wakes[0]!.body).toContain('Open watches (1');
    expect(t.pushes.map(({ text }) => text)).toEqual(['The deploy of main is green again.']);
    expect(t.vault.files.has('PI/Watches/Closed/Deploy of main.md')).toBe(true);
    expect(await t.watches.nextDueAt(signal())).toBeNull();
  });

  it('runs three watches for a week within the wake guards, with no report storm and the cost visible per watch', async () => {
    // A daily topic, an hourly price and an events-only build. The stand-in model looks at every due watch, picks the
    // cadence the note asks for, and reports only the price once, when it "changes".
    const cadence: Record<string, number> = { Topic: hours(24), Price: hours(1) };
    let priceReported = false;
    const t = setup(async (wake) => {
      for (const name of Object.keys(cadence)) {
        if (!new RegExp(`${name} \\[DUE NOW\\]`, 'u').test(wake.body)) continue;
        await t.watches.look({ name, result: 'checked', nextLook: new Date(t.clock.t.getTime() + cadence[name]!) }, wake.run, signal());
        if (name === 'Price' && !priceReported && t.clock.t.getTime() > new Date('2026-11-18T00:00:00Z').getTime()) {
          priceReported = true;
          await t.comms.send({ text: 'The price dropped.' }, wake.run, signal());
        }
      }
      return { text: 'Looked at what was due.' };
    });
    await t.watches.create({ title: 'Topic', text: 'Daily.', nextLook: new Date('2026-11-16T09:00:00Z') }, signal());
    await t.watches.create({ title: 'Price', text: 'Hourly.', nextLook: new Date('2026-11-16T09:00:00Z') }, signal());
    await t.watches.create({ title: 'Build', text: 'Events only.', nextLook: null }, signal());
    await simulate(t, new Date('2026-11-23T08:00:00Z'), 60_000);
    const list = await t.watches.list(signal());
    const by = Object.fromEntries(list.map((entry) => [entry.name, entry]));
    expect(by.Build!.costMonthDkk).toBe(0);
    expect(by.Topic!.costMonthDkk).toBeGreaterThan(0);
    expect(by.Price!.costMonthDkk).toBeGreaterThan(by.Topic!.costMonthDkk);
    // One look per wake at most, so the wake guards (not a per-watch limit) bound the looks in a day.
    expect(by.Price!.looksToday).toBeLessThanOrEqual(MAX_WAKES_PER_DAY);
    expect(t.pushes).toHaveLength(1);
    // Wakes per day stay under the daily limit, spaced at least ten minutes, and one wake covered both watches when they fell due together.
    const times = t.gateway.wakes.map((wake) => /\| (\d{4}-\d\d-\d\d \d\d:\d\d)/u.exec(wake.body)![1]!);
    expect(new Set(times).size).toBeGreaterThan(20);
    const perDay = new Map<string, number>();
    for (const time of times) perDay.set(time.slice(0, 10), (perDay.get(time.slice(0, 10)) ?? 0) + 1);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(MAX_WAKES_PER_DAY);
    expect(MIN_WAKE_GAP_MS).toBeGreaterThanOrEqual(10 * 60_000);
    // Spend is on the shared proactive ledger, so the 100 DKK stop counts watches too.
    expect(await t.proactive.spend.monthTotal('2026-11')).toBeGreaterThan(0);
  });

  it('keeps events and a due watch for later when the vault cannot be read, and does not call the model', async () => {
    const t = setup(async () => ({ text: 'x' }));
    await t.watches.create({ title: 'A', text: 'x', nextLook: new Date('2026-11-16T09:00:00Z') }, signal());
    const reborn = createWatches({ area: createPiArea({ vault: t.vault }), store: t.piStore, now: t.now });
    const read = t.vault.read;
    (t.vault as { read: unknown }).read = async () => { throw new Error('down'); };
    const brain = createBrain({
      queue: t.queue, gateway: t.gateway, proactive: t.proactive, piStore: t.piStore, comms: t.comms, decisionLog: createDecisionLog({ area: createPiArea({ vault: t.vault }) }),
      extras: reborn, owner, timeZone: 'Europe/Copenhagen', now: t.now,
    });
    await t.ready;
    await t.queue.enqueue({ source: 'github', kind: 'workflow_run.failure', dedupeKey: 'g:2', summary: 'Deploy failed', occurredAt: t.now() }, t.now());
    brain.wake();
    t.clock.t = new Date('2026-11-16T09:30:00Z');
    brain.wake();
    expect((await brain.tick(signal())).outcome).not.toBe('done');
    expect(t.gateway.wakes).toEqual([]);
    (t.vault as { read: unknown }).read = read;
    t.clock.t = new Date(t.clock.t.getTime() + 6 * 60_000);
    expect((await brain.tick(signal())).outcome).toBe('done');
    expect(t.gateway.wakes[0]!.body).toContain('Deploy failed');
  });
});
