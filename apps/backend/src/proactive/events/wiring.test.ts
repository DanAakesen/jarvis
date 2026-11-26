import { describe, expect, it, vi } from 'vitest';
import { createMemoryProactiveStore } from '../store.js';
import type { EventQueueStore } from './event-queue.js';
import { alertEvent, githubEvent, reminderFailureEvent, workerEvent } from './producers.js';
import type { ProactiveEventInput } from './types.js';
import { createEventPath } from './wiring.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-21T12:00:00.000Z');

const release = githubEvent({
  kind: 'release', repository: 'DanAakesen/jarvis', id: 1, tag: 'v1.0.0', name: null, prerelease: false,
  publishedAt: NOW.toISOString(), actor: null,
}, NOW)!;
const workerDone = workerEvent({
  id: '1', type: 'state_changed', source: 'backend', summary: null, payload: { to: 'Done' },
  payloadTruncated: false, at: NOW.toISOString(), taskId: 'T-1',
}, NOW)!;
const budget = alertEvent({ type: 'budget_threshold', dedupeKey: 'budget-80:2026-11', title: 'Budget at 80%', link: null }, NOW)!;
const clash: ProactiveEventInput = { source: 'calendar', kind: 'calendar.clash', dedupeKey: 'calendar:clash:x', summary: 'Two meetings overlap', occurredAt: NOW };
const failedReminder = reminderFailureEvent({
  scheduleId: '5a1d6a34-0000-4000-8000-000000000001', occurrenceAt: new Date('2026-11-21T11:00:00.000Z'),
  title: 'Send the final draft', reason: 'provider_rejected', providerOutcome: 'provider_rejected',
  attempts: 1, recipients: 1, accepted: 0,
}, NOW);

function build() {
  const store = createMemoryProactiveStore(OWNER);
  const wake = vi.fn();
  let queue: EventQueueStore | undefined;
  const path = createEventPath({
    enabled: false,
    brain: (created) => {
      queue = created;
      return { wake, start: async () => undefined, tick: async () => undefined };
    },
    ownerObjectId: OWNER, store, sources: [], now: () => NOW,
  })!;
  return { sink: path.sink, store, wake, queue: queue! };
}

describe('the event queue entrance and the Proactive source switches', () => {
  it('queues nothing from a source Dan switched off, and everything from the sources that have no switch', async () => {
    const { sink, store, wake, queue } = build();
    await store.settings.patch({ sources: { factory: false, calendar: false } });
    wake.mockClear();

    // GitHub and Worker results follow Factory.
    for (const event of [release, workerDone, clash]) await sink.enqueue(event);
    expect(await queue.hasSource('github')).toBe(false);
    expect(await queue.hasSource('worker')).toBe(false);
    expect(await queue.hasSource('calendar')).toBe(false);
    expect(wake).not.toHaveBeenCalled();

    await sink.enqueue(budget);
    expect(await queue.hasSource('alert')).toBe(true);
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('keeps GitHub context-only when Factory is on and wakes for a calendar change', async () => {
    const { sink, store, wake, queue } = build();
    await store.settings.patch({ sources: { factory: false, calendar: false } });
    await sink.enqueue(release);
    await store.settings.patch({ sources: { factory: true, calendar: true } });
    wake.mockClear();

    await sink.enqueue(release);
    await sink.enqueue(clash);
    await sink.enqueue({ ...release, source: 'alert', kind: 'deployment_failure' });
    await sink.enqueue({ ...workerDone, kind: 'task.pull_request_opened' });
    expect(await queue.hasSource('github')).toBe(false);
    expect(await queue.hasSource('calendar')).toBe(true);
    expect(wake).toHaveBeenCalledTimes(1);
    expect((await queue.claim(NOW, 10, 60_000)).map(({ kind }) => kind).sort()).toEqual(['calendar.clash']);
  });

  it('treats a source an event declares as evidence like its own: a failed reminder follows Todos, nothing else does', async () => {
    const { sink, store, wake, queue } = build();
    await store.settings.patch({ sources: { todos: false } });
    wake.mockClear();

    await sink.enqueue(failedReminder);
    expect(await queue.hasSource('reminder')).toBe(false);
    expect(wake).not.toHaveBeenCalled();
    // An alert rests on no source, so the Todos switch is none of its business.
    await sink.enqueue(budget);
    expect(await queue.hasSource('alert')).toBe(true);

    await store.settings.patch({ sources: { todos: true } });
    wake.mockClear();
    await sink.enqueue(failedReminder);
    expect(await queue.hasSource('reminder')).toBe(true);
    expect(wake).toHaveBeenCalledTimes(1);
  });
});
