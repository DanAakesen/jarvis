import { describe, expect, it, vi } from 'vitest';
import { createMemoryProactiveStore } from '../store.js';
import type { ProactiveSource } from '../types.js';
import { createNowCardChannel, createPushChannel } from './channels.js';
import { createMemoryEventQueueStore, type EventQueueStore } from './event-queue.js';
import { createMemoryOutreachStore } from './outreach-store.js';
import { createEventPipeline, MAX_MODEL_BATCHES_PER_DAY, MAX_PUSHES_PER_DAY } from './pipeline.js';
import type { EventReasoner, ReasonerResult } from './reasoner.js';
import type { OutreachChannel, ProactiveEventInput } from './types.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-15T10:00:00.000Z');
const signal = new AbortController().signal;

function event(partial: Partial<ProactiveEventInput> = {}): ProactiveEventInput {
  return {
    source: 'github', kind: 'workflow_run.failure', dedupeKey: `k-${Math.random()}`,
    summary: 'Deploy failed on main', occurredAt: new Date(NOW.getTime() - 60_000), ...partial,
  };
}

function setup(reasonerResult: (ids: string[]) => Partial<ReasonerResult> = () => ({ decisions: [], quiet: [] })) {
  let clock = NOW;
  const queue = createMemoryEventQueueStore();
  const outreach = createMemoryOutreachStore();
  const store = createMemoryProactiveStore(OWNER);
  const reason = vi.fn(async (input: { events: { id: string }[] }): Promise<ReasonerResult> => ({
    decisions: [], quiet: [], usage: { model: 'gpt-6.1-terra', inputTokens: 5_000, outputTokens: 500 },
    ...reasonerResult(input.events.map(({ id }) => id)),
  }));
  const reasoner: EventReasoner = { worstCaseDkk: () => 0.35, reason: reason as unknown as EventReasoner['reason'] };
  const record = vi.fn(async () => true);
  const send = vi.fn(async () => ({ status: 'sent' as const, reason: null, attempted: 1, accepted: 1, statusCode: 201 }));
  const channels: OutreachChannel[] = [createNowCardChannel({ record }), createPushChannel(send)];
  const contextSource: ProactiveSource = {
    id: 'todos', label: 'Todos',
    async read() { return { source: 'todos', state: 'ok', reason: null, observedAt: NOW.toISOString(), facts: [] }; },
  };
  const pipeline = createEventPipeline({
    queue, outreach, store, reasoner, contextSources: [contextSource], channels, now: () => clock,
  });
  const enqueue = async (input: ProactiveEventInput) => {
    const result = await queue.enqueue(input, clock);
    pipeline.wake();
    return result.id;
  };
  return { queue, outreach, store, reason, record, send, pipeline, enqueue, advance: (ms: number) => { clock = new Date(clock.getTime() + ms); } };
}

describe('event pipeline', () => {
  it('stays idle and reads nothing while nothing is queued', async () => {
    const { pipeline, queue } = setup();
    const hasWork = vi.spyOn(queue, 'hasWork');
    const claim = vi.spyOn(queue, 'claim');
    expect((await pipeline.tick(signal)).outcome).toBe('idle');
    expect(hasWork).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });

  it('filters routine events without a model call', async () => {
    const { pipeline, enqueue, reason, queue } = setup();
    await enqueue(event({ kind: 'workflow_run.success' }));
    await enqueue(event({ kind: 'deployment_status.success' }));
    const result = await pipeline.tick(signal);
    expect(result).toMatchObject({ outcome: 'filtered', claimed: 2, dropped: 2 });
    expect(reason).not.toHaveBeenCalled();
    expect(await queue.hasWork(NOW)).toBe(false);
  });

  it('sends a low-tier decision to the Now feed only', async () => {
    const { pipeline, enqueue, record, send, outreach } = setup((ids) => ({
      decisions: [{ eventIds: ids, tier: 'low', title: 'Deploy failed', body: 'Main is red again.', why: 'blocks work', category: 'status' }],
    }));
    await enqueue(event());
    const result = await pipeline.tick(signal);
    expect(result).toMatchObject({ outcome: 'done', outreach: 1 });
    expect(record).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    const [row] = await outreach.recent(5, new Date(0));
    expect(row).toMatchObject({ tier: 'low', rating: null });
    expect(row?.delivery).toEqual([{ channel: 'now_card', status: 'sent', reason: null }]);
  });

  it.each(['medium', 'high'] as const)('pushes a %s-tier decision and does not add a Now card', async (tier) => {
    const { pipeline, enqueue, record, send, outreach } = setup((ids) => ({
      decisions: [{ eventIds: ids, tier, title: 'Prod down', body: 'Deploy failed.', why: 'urgent', category: 'status' }],
    }));
    await enqueue(event());
    await pipeline.tick(signal);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({ kind: 'insight', bypassQuietHours: true, count: 1 });
    expect(record).not.toHaveBeenCalled();
    const [row] = await outreach.recent(5, new Date(0));
    expect(row?.pushedAt).not.toBeNull();
  });

  it('downgrades pushes to a card once the daily push budget is used', async () => {
    const { pipeline, enqueue, send, record, advance } = setup((ids) => ({
      decisions: ids.map((id) => ({ eventIds: [id], tier: 'medium' as const, title: 'Note', body: 'Body', why: 'why', category: 'status' as const })),
    }));
    for (let index = 0; index < MAX_PUSHES_PER_DAY + 1; index += 1) {
      await enqueue(event());
      advance(1_000);
      await pipeline.tick(signal);
    }
    expect(send).toHaveBeenCalledTimes(MAX_PUSHES_PER_DAY);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('records quiet and uncovered events with the model\'s reason and never delivers', async () => {
    const { pipeline, enqueue, send, record, queue } = setup((ids) => ({
      quiet: [{ eventId: ids[0]!, why: 'routine' }],
    }));
    await enqueue(event());
    await enqueue(event());
    const result = await pipeline.tick(signal);
    expect(result).toMatchObject({ outcome: 'done', claimed: 2, outreach: 0 });
    expect(await queue.hasWork(new Date(NOW.getTime() + 3_600_000))).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('keeps events and retries later when the model is unavailable, but still records billed tokens', async () => {
    const { pipeline, enqueue, store, advance, reason } = setup();
    reason.mockResolvedValueOnce({ decisions: [], quiet: [], reason: 'invalid_model_output', usage: { model: 'gpt-6.1-terra', inputTokens: 1_000_000, outputTokens: 0 } });
    await enqueue(event());
    expect((await pipeline.tick(signal)).outcome).toBe('invalid_model_output');
    expect(await store.spend.monthTotal('2026-11')).toBeCloseTo(6.5785, 3);
    expect((await pipeline.tick(signal)).outcome).toBe('idle');
    advance(6 * 60_000);
    expect((await pipeline.tick(signal)).outcome).toBe('done');
  });

  it('stops at the hard monthly budget without calling the model', async () => {
    const { pipeline, enqueue, store, reason } = setup();
    await store.settings.patch({ monthlyBudgetDkk: 100 });
    await store.spend.record({ runId: 'r', month: '2026-11', inputTokens: 0, outputTokens: 0, estimatedDkk: 99.9, createdAt: NOW });
    await enqueue(event());
    expect((await pipeline.tick(signal)).outcome).toBe('budget_exhausted');
    expect(reason).not.toHaveBeenCalled();
  });

  it('stops after the daily model-call cap', async () => {
    const { pipeline, enqueue, reason, advance } = setup();
    for (let index = 0; index < MAX_MODEL_BATCHES_PER_DAY; index += 1) {
      await enqueue(event());
      advance(1_000);
      await pipeline.tick(signal);
    }
    await enqueue(event());
    expect((await pipeline.tick(signal)).outcome).toBe('daily_cap');
    expect(reason).toHaveBeenCalledTimes(MAX_MODEL_BATCHES_PER_DAY);
  });

  it('skips a timer review when the context has not changed', async () => {
    const { pipeline, enqueue, reason, advance } = setup();
    await enqueue(event({ source: 'timer', kind: 'review', dedupeKey: 't1', occurredAt: NOW }));
    expect((await pipeline.tick(signal)).outcome).toBe('done');
    advance(6 * 60 * 60_000);
    await enqueue(event({ source: 'timer', kind: 'review', dedupeKey: 't2', occurredAt: new Date(NOW.getTime() + 6 * 60 * 60_000) }));
    expect((await pipeline.tick(signal)).outcome).toBe('filtered');
    expect(reason).toHaveBeenCalledTimes(1);
  });

  it('does nothing while the owner has paused proactive work', async () => {
    const { pipeline, enqueue, store, reason } = setup();
    await store.settings.patch({ paused: true });
    await enqueue(event());
    expect((await pipeline.tick(signal)).outcome).toBe('paused');
    expect(reason).not.toHaveBeenCalled();
  });
});

describe('queue', () => {
  const at = NOW;
  const check = async (queue: EventQueueStore) => {
    const first = await queue.enqueue(event({ dedupeKey: 'same' }), at);
    const second = await queue.enqueue(event({ dedupeKey: 'same' }), at);
    expect(first.inserted).toBe(true);
    expect(second).toEqual({ id: first.id, inserted: false });
  };
  it('ignores a duplicate dedupe key', async () => { await check(createMemoryEventQueueStore()); });
  it('records baseline events as already seen', async () => {
    const queue = createMemoryEventQueueStore();
    await queue.enqueue(event({ baseline: true }), at);
    expect(await queue.hasWork(at)).toBe(false);
    expect(await queue.hasSource('github')).toBe(true);
  });
  it('leases claimed events so a second claim finds nothing', async () => {
    const queue = createMemoryEventQueueStore();
    await queue.enqueue(event(), at);
    expect(await queue.claim(at, 10, 60_000)).toHaveLength(1);
    expect(await queue.claim(at, 10, 60_000)).toHaveLength(0);
    expect(await queue.claim(new Date(at.getTime() + 61_000), 10, 60_000)).toMatchObject([{ attempts: 2 }]);
  });
  it('rejects a malformed source or an empty summary', async () => {
    const queue = createMemoryEventQueueStore();
    await expect(queue.enqueue(event({ source: 'Bad Source' }), at)).rejects.toThrow('source');
    await expect(queue.enqueue(event({ summary: '  ' }), at)).rejects.toThrow('summary');
  });
});
