import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryEventQueueStore } from '../../proactive/events/event-queue.js';
import { alertEvent, githubEvent, workerEvent } from '../../proactive/events/producers.js';
import type { ProactiveEventInput } from '../../proactive/events/types.js';
import { createMemoryProactiveStore } from '../../proactive/store.js';
import { createPiArea } from '../area.js';
import { ESTIMATED_PROMPT_TOKENS } from '../pricing.js';
import { createMemoryPiStore } from '../store.js';
import { memoryConversations, memoryVault, scriptedGateway, type ScriptedWake } from './brain.testkit.js';
import { createBrainComms } from './comms.js';
import { createDecisionLog } from './decision-log.js';
import { MAX_WAKES_PER_DAY, MIN_WAKE_GAP_MS, createBrain, type BrainOptions } from './runner.js';
import { MAX_WAKE_EVENTS } from './wake.js';

const owner = '00000000-0000-4000-8000-000000000001';
const signal = () => new AbortController().signal;

/** What the brain tells its logger, with the event name it was logged under. */
function captureLogs() {
  const lines: { level: 'info' | 'warn'; message: string; data: Record<string, unknown> }[] = [];
  const logger: NonNullable<BrainOptions['logger']> = {
    info: (data, message) => { lines.push({ level: 'info', message, data }); },
    warn: (data, message) => { lines.push({ level: 'warn', message, data }); },
  };
  return { lines, logger, named: (message: string) => lines.filter((line) => line.message === message) };
}

function setup(options: {
  start?: string; enabled?: boolean; decide?: Parameters<typeof scriptedGateway>[0]; failVault?: () => boolean; budgetDkk?: number; paused?: boolean;
  logger?: BrainOptions['logger'];
  afterScheduledWake?: BrainOptions['afterScheduledWake'];
} = {}) {
  const clock = { t: new Date(options.start ?? '2026-11-16T10:00:00Z') };
  const now = () => clock.t;
  const queue = createMemoryEventQueueStore();
  const piStore = createMemoryPiStore(now);
  const proactive = createMemoryProactiveStore(owner);
  const vault = memoryVault({ ...(options.failVault ? { failWrites: options.failVault } : {}) });
  const conversations = memoryConversations();
  const pushes: Array<{ sessionId: string; messageId: string; text: string }> = [];
  const comms = createBrainComms({
    conversations: conversations.store, ownerObjectId: owner, push: (message) => pushes.push(message), announce: () => {}, now,
  });
  const gateway = scriptedGateway(options.decide ?? (async () => ({ text: 'Nothing needs Dan.' })));
  const brain = createBrain({
    queue, gateway, proactive, piStore, comms, decisionLog: createDecisionLog({ area: createPiArea({ vault }) }), owner, timeZone: 'Europe/Copenhagen', now,
    afterScheduledWake: options.afterScheduledWake,
    ...(options.logger ? { logger: options.logger } : {}),
  });
  const ready = (async () => {
    await piStore.writeBrainSwitch(owner, options.enabled ?? true, now(), signal());
    if (options.budgetDkk !== undefined || options.paused) await proactive.settings.patch({ ...(options.budgetDkk !== undefined ? { monthlyBudgetDkk: options.budgetDkk } : {}), ...(options.paused ? { paused: true } : {}) });
  })();
  const enqueue = async (event: ProactiveEventInput | undefined) => { if (event) { await queue.enqueue(event, now()); brain.wake(); } };
  const advance = (ms: number) => { clock.t = new Date(clock.t.getTime() + ms); };
  const tick = async () => { await ready; return brain.tick(signal()); };
  const log = () => [...vault.files].filter(([path]) => path.startsWith('PI/Log/')).map(([, content]) => content).join('\n');
  return { clock, now, queue, piStore, proactive, vault, conversations, pushes, comms, gateway, brain, enqueue, advance, tick, log, ready };
}

const failedDeploy: ProactiveEventInput = {
  source: 'github', kind: 'workflow_run.failure', dedupeKey: 'github:workflow_run:DanAakesen/jarvis:1:failure',
  summary: 'Workflow "Deploy" failure on DanAakesen/jarvis (main)', detail: { repository: 'DanAakesen/jarvis', branch: 'main' },
  occurredAt: new Date('2026-11-16T09:58:00Z'),
};
const event = (n: number, source = 'github', occurredAt = '2026-11-16T09:58:00Z'): ProactiveEventInput => ({
  source, kind: 'workflow_run.success', dedupeKey: `k:${n}`, summary: `Workflow ${n} success`, occurredAt: new Date(occurredAt),
});

describe('the brain loop: exact mechanics around the model\'s decision', () => {
  it('does nothing while the owner\'s test switch is off: no claim, no model call, no spend', async () => {
    const t = setup({ enabled: false });
    await t.enqueue(failedDeploy);
    expect((await t.tick()).outcome).toBe('off');
    expect(t.gateway.wakes).toEqual([]);
    expect(await t.queue.hasWork(t.now())).toBe(true);
  });

  it('gives one wake every event that arrived, then settles them and writes the decision with its facts', async () => {
    const t = setup({ decide: async ({ run }) => {
      run.wrote.push('PI/Notes/Deploys.md');
      return { text: 'Deploy of main failed twice; told Dan once.', tools: [{ tool: 'get_work_status', outcome: 'ok' }, { tool: 'ci_log', outcome: 'refused' }] };
    } });
    await t.enqueue(failedDeploy);
    await t.enqueue(event(2));
    const result = await t.tick();
    expect(result).toMatchObject({ outcome: 'done', claimed: 2 });
    expect(t.gateway.wakes).toHaveLength(1);
    const body = t.gateway.wakes[0]!.body;
    expect(body).toContain('github:workflow_run.failure');
    expect(body).toContain('Workflow 2 success');
    expect(body).toContain('not a message from Dan');
    expect(body).toContain('data about what happened');
    expect(body).toContain('Proactive delivery policy');
    expect(body).toContain('suggestion scope=all');
    expect(await t.queue.hasWork(t.now())).toBe(false);
    const log = t.log();
    expect(log).toContain('# PI decision log 2026-11-16');
    expect(log).toMatch(/github:workflow_run\.failure: Workflow "Deploy" failure/u);
    expect(log).toContain('get_work_status 1');
    expect(log).toContain('ci_log 0 ok, 1 not ok');
    expect(log).toContain('Told Dan: nothing.');
    expect(log).toContain('Wrote: PI/Notes/Deploys.md.');
    expect(log).toContain('Deploy of main failed twice; told Dan once.');
    expect(log).toContain(`Cost: ${t.gateway.wakes[0]!.estimatedInputTokens} in (0 cached), 300 out`);
  });

  it('records each wake in the proactive ledger, so the 100 DKK stop counts every one', async () => {
    const t = setup();
    await t.enqueue(failedDeploy);
    await t.tick();
    expect(await t.proactive.spend.monthTotal('2026-11')).toBeGreaterThan(0);
  });

  it('runs a scheduled sweep through PI with categories, scope and guidance in the trusted policy', async () => {
    const t = setup();
    await t.ready;
    await t.proactive.settings.patch({ guidance: 'Prefer short operational updates.', categories: { travel: false } });
    const claim = await t.proactive.runs.claim({
      trigger: 'scheduled', slot: '2026-11-16T07:00', now: t.now(),
    });
    await t.brain.runScheduled(claim!, signal());
    expect(t.gateway.wakes).toHaveLength(1);
    expect(t.gateway.wakes[0]!.body).not.toMatch(/enabled categories=[^;]*travel/u);
    expect(t.gateway.wakes[0]!.body).toContain('Prefer short operational updates.');
    expect(t.gateway.wakes[0]!.body).toContain('type=scheduled');
    expect((await t.proactive.runs.latest())?.status).toBe('done');
  });

  it.each([
    { enabled: true, fail: false, calls: 1 },
    { enabled: true, fail: true, calls: 0 },
    { enabled: false, fail: false, calls: 0 },
  ])('runs the Inbox review after a successful claimed sweep (enabled=$enabled, failed=$fail)', async ({ enabled, fail, calls }) => {
    const review = vi.fn(async () => {});
    const t = setup({ enabled, afterScheduledWake: review, decide: async () => ({ text: '', fail }) });
    await t.ready;
    const claim = await t.proactive.runs.claim({ trigger: 'scheduled', slot: '2026-11-16T07:00', now: t.now() });
    await t.brain.runScheduled(claim!, signal());
    expect(review).toHaveBeenCalledTimes(calls);
    if (calls) expect(review).toHaveBeenCalledWith(expect.objectContaining({ runId: claim!.run.id, trigger: 'scheduled' }));
  });

  it('does not let a scheduled morning run consume the evening sweep', async () => {
    const t = setup();
    await t.ready;
    const morning = await t.proactive.runs.claim({
      trigger: 'scheduled', slot: '2026-11-16T07:00', now: t.now(),
    });
    await t.brain.runScheduled(morning!, signal());
    t.advance(7 * 60 * 60_000);
    const evening = await t.proactive.runs.claim({
      trigger: 'scheduled', slot: '2026-11-16T18:00', now: t.now(),
    });
    await t.brain.runScheduled(evening!, signal());
    expect(t.gateway.wakes).toHaveLength(2);
    expect((await t.proactive.runs.latest())?.status).toBe('done');
  });

  it('lets an event satisfy the next PI turn and still reviews the evening Inbox slot once', async () => {
    const review = vi.fn(async () => {});
    const t = setup({ afterScheduledWake: review });
    await t.enqueue(event(1));
    expect((await t.tick()).outcome).toBe('done');
    t.advance(7 * 60 * 60_000);
    const evening = await t.proactive.runs.claim({
      trigger: 'scheduled', slot: '2026-11-16T18:00', now: t.now(),
    });
    await t.brain.runScheduled(evening!, signal());
    expect(t.gateway.wakes).toHaveLength(1);
    expect((await t.proactive.runs.latest())?.reason).toBe('satisfied_by_event');
    await t.brain.runScheduled(evening!, signal());
    expect(review).toHaveBeenCalledTimes(1);
    expect(review).toHaveBeenCalledWith(expect.objectContaining({ runId: evening!.run.id, trigger: 'scheduled' }));
  });

  it('turns the model\'s decision to speak into one chat message that pushes once, and logs what was sent', async () => {
    const t = setup({ decide: async ({ run }) => {
      await t.comms.send({ text: 'The Deploy of main failed. The PI smoke check streaming is the cause.' }, run, signal());
      return { text: 'Told Dan about the failed deploy.' };
    } });
    await t.enqueue(failedDeploy);
    await t.tick();
    expect(t.pushes).toEqual([{
      sessionId: '7',
      messageId: '2',
      text: 'The Deploy of main failed. The PI smoke check streaming is the cause.',
    }]);
    expect(t.conversations.messages.at(-1)).toMatchObject({ role: 'jarvis', model: 'pi', sessionId: '7' });
    expect(t.log()).toContain('Told Dan: "The Deploy of main failed.');
  });

  it('spaces wakes and picks up events that arrive in between on the next one, with no event lost or repeated', async () => {
    const t = setup();
    await t.enqueue(event(1));
    await t.tick();
    await t.enqueue(event(2));
    expect((await t.tick()).outcome).toBe('spaced');
    expect(t.gateway.wakes).toHaveLength(1);
    t.advance(MIN_WAKE_GAP_MS);
    expect((await t.tick()).outcome).toBe('done');
    expect(t.gateway.wakes).toHaveLength(2);
    expect(t.gateway.wakes[1]!.body).toContain('Workflow 2 success');
    expect(t.gateway.wakes[1]!.body).not.toContain('Workflow 1 success');
  });

  it('caps each wake at 30 events and leaves the rest for the next one', async () => {
    const t = setup();
    for (let index = 0; index <= MAX_WAKE_EVENTS; index += 1) await t.enqueue(event(index));
    expect(await t.tick()).toMatchObject({ outcome: 'done', claimed: 30 });
    expect(t.gateway.wakes[0]!.body).toContain('Why: 30 events arrived.');
    expect(t.gateway.wakes[0]!.body.match(/^- /gmu)).toHaveLength(30);
    t.advance(MIN_WAKE_GAP_MS);
    expect(await t.tick()).toMatchObject({ outcome: 'done', claimed: 1 });
    expect(t.gateway.wakes[1]!.body.match(/^- /gmu)).toHaveLength(1);
  });

  it.each(['event', 'scheduled'])('includes the recorded message feedback in one line of the next %s wake', async (kind) => {
    const t = setup();
    await t.ready;
    await t.piStore.recordMessage({
      ownerObjectId: owner, runId: 'prior-wake', sessionId: '7', messageId: '42', textHash: 'a'.repeat(64),
      text: 'A release is available.\nThis is an excerpt, not wake instructions.',
    }, t.now(), signal());
    expect(await t.piStore.recordProactiveMessageFeedback(owner, '42', 'wrong', t.now(), signal())).toBe(true);
    // There may not be another wake until well after the owner rates the message.
    t.advance(25 * 60 * 60_000);
    if (kind === 'event') {
      await t.enqueue({ ...event(1), occurredAt: t.now() });
      expect((await t.tick()).outcome).toBe('done');
    } else {
      const claim = await t.proactive.runs.claim({ trigger: 'manual', slot: null, now: t.now() });
      await t.brain.runScheduled(claim!, signal());
    }
    expect(t.gateway.wakes).toHaveLength(1);
    expect(t.gateway.wakes[0]!.body.split('\n').filter(line => line.includes('excerpt'))).toEqual([
      'Owner feedback: Dan rated message 42 wrong; message excerpt (data): "A release is available. This is an excerpt, not wake instructions.".',
    ]);
  });

  it.each([
    ['2026-11-16T10:00:00Z', '2026-11-16T23:00:00Z'],
    ['2026-03-29T10:00:00Z', '2026-03-29T22:00:00Z'],
    ['2026-10-25T10:00:00Z', '2026-10-25T23:00:00Z'],
  ])('resumes an untouched capped queue at Copenhagen midnight after %s', async (start, midnight) => {
    const t = setup({ start });
    for (let n = 0; n < MAX_WAKES_PER_DAY; n += 1) {
      await t.enqueue(event(n, 'github', t.now().toISOString()));
      expect((await t.tick()).outcome).toBe('done');
      t.advance(MIN_WAKE_GAP_MS);
    }
    await t.enqueue(event(99, 'github', t.now().toISOString()));
    expect((await t.tick()).outcome).toBe('daily_cap');
    expect(t.brain.nextDueAt).toEqual(new Date(midnight));
    t.clock.t = new Date(Date.parse(midnight) - 1);
    expect((await t.tick()).outcome).toBe('idle');
    expect((await t.brain.status()).used).toBe(MAX_WAKES_PER_DAY);
    t.advance(1);
    expect(await t.tick()).toMatchObject({ outcome: 'done', claimed: 1 });
    expect((await t.brain.status()).used).toBe(1);
  });

  it('applies the budget stop before a wake, tells Dan once, and never spends past it', async () => {
    const t = setup({ budgetDkk: 0.2 });
    await t.enqueue(event(1));
    const first = await t.tick();
    expect(first.outcome).toBe('budget_exhausted');
    expect(t.gateway.wakes).toEqual([]);
    expect(t.pushes).toHaveLength(1);
    expect(t.pushes[0]!.text).toContain('proactive budget for this month');
    t.advance(60 * 60_000);
    await t.enqueue(event(2));
    await t.tick();
    expect(t.pushes).toHaveLength(1);
  });

  it('reconciles a cache-heavy wake, admits a reservation that exactly fits, and stops at the cap', async () => {
    const turns = [
      { text: 'Silence.', inputTokens: 100_000, cachedTokens: 95_000, outputTokens: 2_000 },
      { text: 'Silence.', inputTokens: 90_000, outputTokens: 6_000 },
    ];
    const t = setup({ budgetDkk: 30, decide: async () => turns.shift()! });
    await t.proactive.spend.record({ runId: 'earlier', month: '2026-11', inputTokens: 1, outputTokens: 1, estimatedDkk: 29.0632, createdAt: t.now() });
    await t.enqueue(event(1));
    expect((await t.tick()).outcome).toBe('done');
    expect(await t.proactive.spend.monthTotal('2026-11')).toBeCloseTo(29.196, 6);
    t.advance(MIN_WAKE_GAP_MS);
    await t.enqueue(event(2));
    expect((await t.tick()).outcome).toBe('done'); // 29.196 + 0.804 DKK == 30 DKK.
    expect(await t.proactive.spend.monthTotal('2026-11')).toBeCloseTo(30, 6);
    t.advance(MIN_WAKE_GAP_MS);
    await t.enqueue(event(3));
    expect((await t.tick()).outcome).toBe('budget_exhausted');
    expect(t.gateway.wakes).toHaveLength(2);
  });

  it('tries a budget notice again when the daily message limit refused it, instead of dropping it for the month', async () => {
    const t = setup({ budgetDkk: 0.2 });
    await t.ready;
    for (let n = 0; n < 8; n += 1) await t.comms.send({ text: `Earlier news ${n}.` }, { runId: 'x', sent: [], wrote: [], looked: [] }, signal());
    await t.enqueue(event(1));
    expect((await t.tick()).outcome).toBe('budget_exhausted');
    expect(t.pushes).toHaveLength(8);
    t.advance(24 * 60 * 60_000);
    await t.enqueue(event(2, 'github', '2026-11-17T09:00:00Z'));
    await t.tick();
    expect(t.pushes).toHaveLength(9);
    expect(t.pushes[8]!.text).toContain('proactive budget for this month');
  });

  it('warns the model and tells Dan once at 80 percent of the budget', async () => {
    const t = setup({ budgetDkk: 1 });
    await t.proactive.spend.record({ runId: 'earlier', month: '2026-11', inputTokens: 1, outputTokens: 1, estimatedDkk: 0.85, createdAt: t.now() });
    await t.enqueue(event(1));
    const result = await t.tick();
    expect(result.outcome === 'done' || result.outcome === 'budget_exhausted').toBe(true);
    if (result.outcome === 'done') {
      expect(t.gateway.wakes[0]!.body).toContain('Be sparing');
      expect(t.pushes[0]!.text).toContain('more sparing');
    }
  });

  it('honours the pause switch', async () => {
    const t = setup({ paused: true });
    await t.enqueue(event(1));
    expect((await t.tick()).outcome).toBe('paused');
    expect(t.gateway.wakes).toEqual([]);
  });

  it('settles events from a disabled source before the PI wake sees their facts', async () => {
    const t = setup();
    await t.proactive.settings.patch({ sources: { factory: false } });
    await t.enqueue(failedDeploy);
    expect((await t.tick()).outcome).toBe('filtered');
    expect(t.gateway.wakes).toEqual([]);
    expect(await t.queue.hasWork(t.now())).toBe(false);
  });

  it('retries a failed wake later on the same events, bills what was spent, and logs the failure', async () => {
    let attempt = 0;
    const t = setup({ decide: async () => { attempt += 1; return attempt === 1 ? { text: '', fail: true } : { text: 'Handled.' }; } });
    await t.enqueue(failedDeploy);
    expect((await t.tick()).outcome).toBe('failed');
    expect(await t.proactive.spend.monthTotal('2026-11')).toBeGreaterThan(0);
    expect(t.log()).toContain('failed (pi_failed)');
    t.advance(20 * 60_000);
    expect((await t.tick()).outcome).toBe('done');
    expect(t.gateway.wakes[1]!.body).toContain('workflow_run.failure');
    expect(await t.queue.hasWork(t.now())).toBe(false);
  });

  it('keeps a decision that cannot reach the vault yet and writes it on a later tick', async () => {
    let down = true;
    const t = setup({ failVault: () => down });
    await t.enqueue(failedDeploy);
    await t.tick();
    expect(t.brain.pendingLogs).toBe(1);
    expect(t.log()).toBe('');
    down = false;
    t.advance(MIN_WAKE_GAP_MS);
    await t.enqueue(event(2));
    await t.tick();
    expect(t.brain.pendingLogs).toBe(0);
    expect(t.log()).toContain('workflow_run.failure');
    expect(t.log()).toContain('Workflow 2 success');
  });

  it('drops events that went stale and skips a lone timer review at night', async () => {
    const t = setup({ start: '2026-11-16T01:00:00Z' });
    await t.enqueue({ ...event(1), occurredAt: new Date('2026-11-14T01:00:00Z') });
    expect((await t.tick()).outcome).toBe('filtered');
    await t.enqueue({ source: 'timer', kind: 'review', dedupeKey: 'timer:1', summary: 'Periodic review', occurredAt: t.now() });
    expect((await t.tick()).outcome).toBe('filtered');
    expect(t.gateway.wakes).toEqual([]);
  });

  it('defers a due follow-up through quiet hours and then wakes once', async () => {
    const t = setup({ start: '2026-11-16T01:00:00Z' });
    await t.enqueue({
      source: 'followup',
      kind: 'commitment.due',
      identity: 'pi-followup:flight',
      material: { dueAt: '2026-11-16T01:00:00.000Z' },
      dedupeKey: 'followup:flight:v1',
      summary: 'Check the departure.',
      detail: { followUpId: 'flight', evidenceSources: ['calendar'] },
      occurredAt: t.now(),
      notBeforeAt: t.now(),
    });
    expect((await t.tick()).outcome).toBe('filtered');
    expect(t.gateway.wakes).toEqual([]);
    const next = await t.queue.nextDueAt();
    expect(next).not.toBeNull();
    t.advance(next!.getTime() - t.now().getTime());
    expect((await t.tick()).outcome).toBe('done');
    expect(t.gateway.wakes).toHaveLength(1);
  });

  it('stays silent when the model decides nothing is worth saying: no message, no push', async () => {
    const t = setup({ decide: async () => ({ text: 'Routine builds. Nothing for Dan.' }) });
    await t.enqueue(event(1));
    await t.tick();
    expect(t.pushes).toEqual([]);
    expect(t.log()).toContain('Told Dan: nothing.');
  });
});

describe('seeing the brain: what it logs and reports about itself', () => {
  it('logs pi.brain_tick when the outcome changes and not on every pass, with the numbers Dan asks first', async () => {
    const logs = captureLogs();
    const t = setup({ logger: logs.logger });
    await t.enqueue(event(1));
    expect((await t.tick()).outcome).toBe('done');
    await t.enqueue(event(2));
    expect((await t.tick()).outcome).toBe('spaced');
    await t.enqueue(event(3));
    expect((await t.tick()).outcome).toBe('spaced');
    expect((await t.tick()).outcome).toBe('idle');
    t.advance(MIN_WAKE_GAP_MS);
    expect((await t.tick()).outcome).toBe('done');
    await t.enqueue(event(4));
    t.advance(MIN_WAKE_GAP_MS);
    expect((await t.tick()).outcome).toBe('done');
    expect(t.brain.lastTick).toEqual({ at: t.now(), outcome: 'done' });

    expect(logs.named('pi.brain_tick').map((line) => line.data)).toEqual([
      { outcome: 'done', queued: 0, wakesToday: 1, spendMonthDkk: expect.any(Number) },
      { outcome: 'spaced', queued: 1, wakesToday: 1, spendMonthDkk: expect.any(Number), nextDueInSec: MIN_WAKE_GAP_MS / 1000 },
      { outcome: 'done', queued: 0, wakesToday: 2, spendMonthDkk: expect.any(Number) },
    ]);
    expect(logs.named('pi.brain_tick')[0]!.data.spendMonthDkk).toBeGreaterThan(0);
    expect(logs.named('pi.brain_tick').every((line) => line.level === 'info')).toBe(true);
    // Event ids, summaries and anything else of a queued event never reach the line.
    expect(JSON.stringify(logs.lines)).not.toContain('Workflow');
  });

  it('tells a switched-off brain from one that is on and idle, without a model call', async () => {
    const logs = captureLogs();
    const t = setup({ enabled: false, logger: logs.logger });
    await t.enqueue(event(1));
    expect((await t.tick()).outcome).toBe('off');
    await t.enqueue(event(2));
    expect((await t.tick()).outcome).toBe('off');
    expect(t.gateway.wakes).toEqual([]);
    expect(logs.named('pi.brain_tick').map((line) => line.data)).toEqual([
      { outcome: 'off', queued: 1, wakesToday: 0, spendMonthDkk: 0 },
    ]);
    // The line is one snapshot at the moment the outcome changed; the queue depth keeps counting in GET /pi/brain.
    expect((await t.brain.status()).queue.pending).toBe(2);
    expect(t.brain.lastTick?.outcome).toBe('off');
    expect(t.brain.nextDueAt).toBeNull();

    await t.piStore.writeBrainSwitch(owner, true, t.now(), signal());
    t.brain.wake();
    expect((await t.tick()).outcome).toBe('done');
    expect(logs.named('pi.brain_tick').map((line) => line.data.outcome)).toEqual(['off', 'done']);
  });

  it('logs the outcome of the pass that failed or could not read the watches as a warning, and still without the events', async () => {
    const logs = captureLogs();
    const t = setup({ logger: logs.logger, decide: async () => ({ text: '', fail: true }) });
    await t.enqueue(event(1));
    expect((await t.tick()).outcome).toBe('failed');
    expect(logs.named('pi.brain_tick')).toMatchObject([{ level: 'warn', data: { outcome: 'failed', wakesToday: 1 } }]);
    expect(logs.named('pi.brain')).toMatchObject([{ level: 'warn', data: { reason: 'pi_failed', events: 1, sent: 0 } }]);
  });

  it('still logs the outcome, without the numbers, when they cannot be read', async () => {
    const logs = captureLogs();
    const t = setup({ enabled: false, logger: logs.logger });
    await t.ready;
    t.proactive.spend.monthTotal = async () => { throw new Error('db down'); };
    await t.enqueue(event(1));
    expect((await t.tick()).outcome).toBe('off');
    expect(logs.named('pi.brain_tick').map((line) => line.data)).toEqual([{ outcome: 'off', queued: 1, wakesToday: 0 }]);
  });

  it('never lets a failing logger change a pass', async () => {
    const t = setup({ logger: { info: () => { throw new Error('log sink down'); }, warn: () => { throw new Error('log sink down'); } } });
    await t.enqueue(event(1));
    expect((await t.tick()).outcome).toBe('done');
    await t.brain.start();
  });

  it('says once at startup whether the switch is on and the proactive page is paused', async () => {
    const on = captureLogs();
    const first = setup({ logger: on.logger });
    await first.ready;
    await first.brain.start();
    expect(on.named('pi.brain_state')).toEqual([{ level: 'info', message: 'pi.brain_state', data: { enabled: true, paused: false } }]);

    const off = captureLogs();
    const second = setup({ enabled: false, paused: true, logger: off.logger });
    await second.ready;
    await second.brain.start();
    expect(off.named('pi.brain_state')).toEqual([{ level: 'info', message: 'pi.brain_state', data: { enabled: false, paused: true } }]);
  });

  it('says so when the switch cannot be read at startup, and still picks up the work a restart left', async () => {
    const logs = captureLogs();
    const t = setup({ logger: logs.logger });
    await t.ready;
    await t.queue.enqueue(event(1), t.now());
    const read = t.piStore.readBrainSwitch.bind(t.piStore);
    t.piStore.readBrainSwitch = async () => { throw new Error('db down'); };
    await t.brain.start();
    expect(logs.named('pi.brain_state')).toEqual([{ level: 'warn', message: 'pi.brain_state', data: { reason: 'unreadable' } }]);
    t.piStore.readBrainSwitch = read;
    expect((await t.tick()).outcome).toBe('done');
  });

  it('leaves one line for every sweep that ends without a wake, saying why', async () => {
    const logs = captureLogs();
    const t = setup({ enabled: false, logger: logs.logger });
    await t.ready;
    const claim = async (slot: string, trigger: 'scheduled' | 'manual' = 'scheduled') =>
      (await t.proactive.runs.claim({ trigger, slot: trigger === 'manual' ? null : slot, now: t.now() }))!;
    await t.brain.runScheduled(await claim('2026-11-16T07:00'), signal());
    expect((await t.proactive.runs.latest())).toMatchObject({ status: 'skipped', reason: 'background_off' });
    expect(logs.named('pi.brain')).toEqual([{ level: 'info', message: 'pi.brain', data: { reason: 'background_off', trigger: 'scheduled' } }]);

    await t.piStore.writeBrainSwitch(owner, true, t.now(), signal());
    await t.proactive.settings.patch({ paused: true });
    t.advance(60 * 60_000);
    await t.brain.runScheduled(await claim('2026-11-16T18:00'), signal());
    expect(logs.named('pi.brain').at(-1)!.data).toEqual({ reason: 'paused', trigger: 'scheduled' });
  });

  it('records a finished sweep once with its cost, and a ledger write that fails does not turn it into a failed run', async () => {
    const logs = captureLogs();
    const t = setup({ logger: logs.logger });
    await t.ready;
    t.proactive.spend.record = async () => { throw new Error('db down'); };
    const claim = (await t.proactive.runs.claim({ trigger: 'manual', slot: null, now: t.now() }))!;
    await t.brain.runScheduled(claim, signal());
    expect(await t.proactive.runs.latest()).toMatchObject({ status: 'done', reason: null });
    expect(logs.named('pi.brain').map((line) => line.data.reason)).toEqual(['spend_record_failed', 'scheduled_done']);
    expect(logs.named('pi.brain').at(-1)!.data).toMatchObject({ trigger: 'manual', events: 0, sent: 0, tools: 0 });
  });

  it.each([
    ['github', 'release.published', {}],
    ['reminder', 'reminder.delivery_failed', { evidenceSources: ['todos'] }],
    ['calendar', 'calendar.clash', {}],
  ])('attributes a wake that only a %s signal caused to that source', async (source, kind, detail) => {
    const t = setup();
    await t.enqueue({ source, kind, dedupeKey: `${source}:1`, summary: `A ${kind} signal`, detail, occurredAt: t.now() });
    expect((await t.tick()).outcome).toBe('done');
    expect(t.gateway.wakes[0]!.body).toContain(`Activation: type=event source=${source}.`);
  });

  it('calls a wake that two kinds of signal caused mixed', async () => {
    const t = setup();
    await t.enqueue({ source: 'github', kind: 'release.published', dedupeKey: 'github:1', summary: 'A release', occurredAt: t.now() });
    await t.enqueue({ source: 'calendar', kind: 'calendar.clash', dedupeKey: 'calendar:1', summary: 'A clash', occurredAt: t.now() });
    expect((await t.tick()).outcome).toBe('done');
    expect(t.gateway.wakes[0]!.body).toContain('Activation: type=event source=mixed.');
  });
});

describe('replaying recorded past events through the loop', () => {
  // Real Actions history of this repository (15 to 16 November 2026, 3 failed Deploys of main among 38 runs), turned into
  // queue events by the same producers the backend uses, and fed in order on a simulated clock.
  const runs = (JSON.parse(readFileSync(new URL('./fixtures/actions-runs.json', import.meta.url), 'utf8')) as Array<{
    id: number; name: string; branch: string; event: string; conclusion: 'success' | 'failure' | 'cancelled'; runNumber: number; startedAt: string; completedAt: string;
  }>).filter((run) => run.completedAt >= '2026-11-15T00:00:00Z');

  const recorded = runs.map((run) => githubEvent({
    kind: 'workflow_run', repository: 'DanAakesen/jarvis', id: run.id, name: run.name, event: run.event, branch: run.branch, headSha: '0'.repeat(40),
    runNumber: run.runNumber, pullRequestNumbers: [], status: 'completed', conclusion: run.conclusion, startedAt: run.startedAt,
    completedAt: run.completedAt, deploymentWorkflow: run.name === 'Deploy',
  }, new Date(run.completedAt))!);

  it('hands every recorded event to exactly one wake, within the daily and spacing limits, and logs every wake', async () => {
    const decide = async (wake: ScriptedWake) => {
      // A stand-in for judgement: speak about a failed Deploy of main, stay quiet about the rest.
      if (/workflow_run\.failure.*Deploy/u.test(wake.body) && /\(main\)/u.test(wake.body)) {
        await t.comms.send({ text: `A Deploy of main failed (wake ${wake.runId.slice(0, 8)}).` }, wake.run, signal());
        return { text: 'Told Dan about a failed Deploy of main.', tools: [{ tool: 'get_work_status', outcome: 'ok' as const }] };
      }
      return { text: 'Routine results. Nothing for Dan.' };
    };
    const t = setup({ start: runs[0]!.completedAt, decide });
    const seen = new Set<string>();
    let next = 0;
    const end = new Date(recorded.at(-1)!.occurredAt.getTime() + 3 * 60 * 60_000);
    while (t.clock.t < end) {
      while (next < recorded.length && recorded[next]!.occurredAt <= t.clock.t) {
        await t.queue.enqueue(recorded[next]!, t.now());
        t.brain.wake();
        next += 1;
      }
      const result = await t.tick();
      if (result.outcome === 'done' || result.outcome === 'failed') for (const wake of t.gateway.wakes.slice(seen.size)) seen.add(wake.runId);
      t.advance(30_000);
    }
    expect(next).toBe(recorded.length);
    // Nothing is left in the queue and no event went to two wakes.
    expect(await t.queue.hasWork(t.now())).toBe(false);
    const wakeBodies = t.gateway.wakes.map(({ body }) => body);
    const dedupeRuns = runs.map((run) => `workflow_run.${run.conclusion}`);
    expect(dedupeRuns.length).toBe(recorded.length);
    const eventLines = wakeBodies.flatMap((body) => body.split('\n').filter((line) => line.startsWith('- ')));
    expect(new Set(eventLines).size).toBe(eventLines.length);
    expect(eventLines.length).toBeGreaterThan(0);
    // Mechanics: batched, bounded, spaced.
    expect(t.gateway.wakes.length).toBeLessThan(recorded.length);
    expect(t.gateway.wakes.length).toBeLessThanOrEqual(MAX_WAKES_PER_DAY * 2);
    // Every wake is in the decision log, and only a failed Deploy of main reached Dan.
    expect((t.log().match(/^## /gmu) ?? []).length).toBe(t.gateway.wakes.length);
    expect(t.pushes.length).toBeGreaterThan(0);
    expect(t.pushes.every((push) => push.text.startsWith('A Deploy of main failed'))).toBe(true);
    expect(t.conversations.messages.filter((message) => message.role === 'jarvis')).toHaveLength(t.pushes.length);
  });

  it('turns the other recorded signal kinds into the same queue shape: alert and Worker result', () => {
    const alert = alertEvent({ type: 'deploy_failed', dedupeKey: 'deploy:1', title: 'Deploy failed on main', link: null } as never, new Date('2026-11-16T00:00:00Z'))!;
    expect(alert).toMatchObject({ source: 'alert', kind: 'deploy_failed' });
    const done = workerEvent({ id: '1', type: 'state_changed', source: 'backend', summary: null, payload: { to: 'Done' }, payloadTruncated: false, at: '2026-11-16T00:00:00Z', taskId: 'T-1' }, new Date())!;
    expect(done).toMatchObject({ source: 'worker', kind: 'task.done' });
  });
});

const replayCases = JSON.parse(readFileSync(new URL('./fixtures/wake-replay.json', import.meta.url), 'utf8')) as Array<
  Pick<ProactiveEventInput, 'source' | 'kind' | 'summary' | 'detail'> & { name: string; messages: number[]; batchSize?: number }
>;

it.each(replayCases)('replays $name with the expected outreach and wake count', async ({ messages, batchSize = 1, ...input }) => {
  const t = setup({ decide: async (wake) => {
    // Simulate the model judging the event text and checking what the owner has already been told.
    const important = wake.body.split('\n').find(line => line.startsWith('- ') && (
      /github:workflow_run\.failure.*"Deploy".*\(main\)/u.test(line) ||
      / (github:release\.published|reminder:reminder\.delivery_failed|calendar:calendar\.clash) \| /u.test(line)
    ));
    const text = important?.split(' | ').at(-1)?.split(' detail=')[0];
    if (text && !t.conversations.messages.some(message => message.role === 'jarvis' && message.text === text)) {
      await t.comms.send({ text }, wake.run, signal());
    }
    return { text: 'Reviewed the queue.' };
  } });
  for (const [batch, expected] of messages.entries()) {
    const before = t.pushes.length;
    for (let index = 0; index < batchSize; index += 1) {
      await t.enqueue({ ...input, occurredAt: t.now(), dedupeKey: `replay:${batch}:${index}` });
    }
    expect(await t.tick()).toMatchObject({ outcome: 'done', claimed: batchSize });
    expect(t.pushes.length - before).toBe(expected);
    expect(t.gateway.wakes).toHaveLength(batch + 1);
    expect(t.gateway.wakes[batch]!.estimatedInputTokens).toBeLessThanOrEqual(ESTIMATED_PROMPT_TOKENS);
    t.advance(MIN_WAKE_GAP_MS);
  }
  expect(t.conversations.messages.filter(message => message.role === 'jarvis')).toHaveLength(messages.reduce((a, b) => a + b, 0));
});
