import { describe, expect, it, vi } from 'vitest';
import type { GithubWebhookMapping } from '../../github/webhook-mapping.js';
import type { ProactiveSource, SourceFact } from '../types.js';
import { createMemoryEventQueueStore } from './event-queue.js';
import { alertEvent, factEvent, githubEvent } from './producers.js';
import { createSourceChangePoller, createTimerProducer, detectCostSpike } from './scheduled-producers.js';
import type { ProactiveEventInput } from './types.js';

const NOW = new Date('2026-11-15T10:00:00.000Z');

describe('GitHub and alert producers', () => {
  const workflow: GithubWebhookMapping = {
    kind: 'workflow_run', repository: 'DanAakesen/jarvis', id: 42, name: 'Deploy', event: 'push', branch: 'main',
    headSha: 'a'.repeat(40), runNumber: 7, pullRequestNumbers: [], status: 'completed', conclusion: 'failure',
    startedAt: null, completedAt: '2026-11-15T09:59:00.000Z', deploymentWorkflow: true,
  };

  it('turns a finished workflow into one stable event per run and conclusion', () => {
    const event = githubEvent(workflow, NOW)!;
    expect(event).toMatchObject({ source: 'github', kind: 'workflow_run.failure', dedupeKey: 'github:workflow_run:DanAakesen/jarvis:42:failure' });
    expect(event.summary).toContain('Deploy');
    expect(event.occurredAt.toISOString()).toBe('2026-11-15T09:59:00.000Z');
    expect(githubEvent({ ...workflow, status: 'in_progress', conclusion: null }, NOW)).toBeUndefined();
  });

  it('maps deployment results and ignores pull requests, pushes and issue labels', () => {
    expect(githubEvent({ kind: 'deployment_status', repository: 'DanAakesen/jarvis', id: 9, sha: 'b'.repeat(40), environment: 'production', status: 'failure', at: NOW.toISOString() }, NOW))
      .toMatchObject({ kind: 'deployment_status.failure' });
    expect(githubEvent({ kind: 'push', repository: 'DanAakesen/jarvis', ref: 'refs/heads/main', sha: 'c'.repeat(40), at: NOW.toISOString() }, NOW)).toBeUndefined();
    expect(githubEvent({ kind: 'issue_labeled', repository: 'DanAakesen/jarvis', number: 1, label: 'Jarvis' }, NOW)).toBeUndefined();
  });

  it('queues activity alerts but never its own outreach cards', () => {
    expect(alertEvent({ type: 'budget_threshold', dedupeKey: 'budget-80:2026-11', title: 'Monthly Azure budget reached 80%', link: null }, NOW))
      .toMatchObject({ source: 'alert', kind: 'budget_threshold', dedupeKey: 'alert:budget-80:2026-11' });
    expect(alertEvent({ type: 'proactive_outreach', dedupeKey: 'outreach:x', title: 'Hi', link: null }, NOW)).toBeUndefined();
  });
});

describe('cost spike detection', () => {
  const day = (offset: number, costDkk: number) => ({ costDkk, at: new Date(NOW.getTime() - offset * 86_400_000).toISOString() });
  it('flags a day far above the weekly average', () => {
    const entries = [day(0, 40), ...[1, 2, 3, 4, 5, 6, 7].map((offset) => day(offset, 2))];
    const spike = detectCostSpike(entries, NOW)!;
    expect(spike.todayDkk).toBe(40);
    expect(spike.usualDkk).toBeCloseTo(2, 5);
  });
  it('ignores normal days, small amounts and missing costs', () => {
    expect(detectCostSpike([day(0, 6), day(1, 2)], NOW)).toBeUndefined();
    expect(detectCostSpike([day(0, 40), ...[1, 2, 3, 4, 5, 6, 7].map((offset) => day(offset, 20))], NOW)).toBeUndefined();
    expect(detectCostSpike([{ costDkk: null, at: NOW.toISOString() }], NOW)).toBeUndefined();
  });
});

describe('timer producer', () => {
  it('queues one review per slot and a spend event when spend spikes', async () => {
    const sink = { enqueue: vi.fn<(event: ProactiveEventInput) => Promise<void>>(async () => undefined) };
    const usageStore = { list: vi.fn(async () => ({
      entries: [{ costDkk: 50, at: NOW.toISOString() }], totalEntries: '1',
    })) } as never;
    const timer = createTimerProducer({ sink, usageStore, now: () => NOW });
    await timer.fire(new Date('2026-11-15T06:00:00.000Z'));
    const kinds = sink.enqueue.mock.calls.map(([event]) => `${event.source}:${event.kind}`);
    expect(kinds).toEqual(['timer:review', 'cost:spike.daily']);
    expect(sink.enqueue.mock.calls[0]![0].dedupeKey).toBe('timer:review:2026-11-15T06:00:00.000Z');
  });
});

describe('mail and calendar change poller', () => {
  const fact = (text: string, extra: Partial<SourceFact> = {}): SourceFact => ({
    ref: 'x', kind: 'mail', label: 'Mail', text, observedAt: NOW.toISOString(), ...extra,
  });
  const source = (id: 'mail' | 'calendar', facts: () => SourceFact[]): ProactiveSource => ({
    id, label: id, async read() { return { source: id, state: 'ok', reason: null, observedAt: NOW.toISOString(), facts: facts() }; },
  });

  it('baselines a source seen for the first time, then queues only new facts', async () => {
    const queue = createMemoryEventQueueStore();
    const sink = { enqueue: vi.fn(async (event: ProactiveEventInput) => { await queue.enqueue(event, NOW); }) };
    let facts = [fact('From Anna: Invoice'), fact('From Bo: Lunch?')];
    const poller = createSourceChangePoller({ sources: [source('mail', () => facts)], sink, queue, now: () => NOW });
    await poller.poll();
    expect(sink.enqueue.mock.calls.every(([event]) => event.baseline === true)).toBe(true);
    expect(await queue.hasWork(NOW)).toBe(false);
    sink.enqueue.mockClear();
    await poller.poll();
    expect(sink.enqueue).not.toHaveBeenCalled();
    facts = [...facts, fact('From Cy: Contract deadline Friday')];
    await poller.poll();
    expect(sink.enqueue).toHaveBeenCalledTimes(1);
    expect(sink.enqueue.mock.calls[0]![0]).toMatchObject({ source: 'mail', kind: 'message.new' });
    expect(sink.enqueue.mock.calls[0]![0].baseline).not.toBe(true);
    expect(await queue.hasWork(NOW)).toBe(true);
  });

  it('treats a moved calendar entry as a new event and does not baseline a known source', async () => {
    const queue = createMemoryEventQueueStore();
    await queue.enqueue({ source: 'calendar', kind: 'event.new_or_changed', dedupeKey: 'old', summary: 's', occurredAt: NOW }, NOW);
    const sink = { enqueue: vi.fn(async (event: ProactiveEventInput) => { await queue.enqueue(event, NOW); }) };
    let start = '2026-11-16T09:00:00.000Z';
    const poller = createSourceChangePoller({
      sources: [source('calendar', () => [fact('Planning', { kind: 'event', startsAt: start, endsAt: '2026-11-16T10:00:00.000Z' })])],
      sink, queue, now: () => NOW,
    });
    await poller.poll();
    start = '2026-11-17T09:00:00.000Z';
    await poller.poll();
    expect(sink.enqueue).toHaveBeenCalledTimes(2);
    expect(sink.enqueue.mock.calls[1]![0].dedupeKey).not.toBe(sink.enqueue.mock.calls[0]![0].dedupeKey);
    expect(sink.enqueue.mock.calls[1]![0].detail).toMatchObject({ startsAt: '2026-11-17T09:00:00.000Z' });
    expect(factEvent('calendar', fact('x'), NOW).occurredAt).toEqual(NOW);
  });

  it('skips an unavailable source without throwing', async () => {
    const queue = createMemoryEventQueueStore();
    const sink = { enqueue: vi.fn() };
    const unavailable: ProactiveSource = { id: 'mail', label: 'Mail', async read() { throw new Error('down'); } };
    const poller = createSourceChangePoller({ sources: [unavailable], sink, queue, now: () => NOW });
    await expect(poller.poll()).resolves.toBeUndefined();
    expect(sink.enqueue).not.toHaveBeenCalled();
  });
});
