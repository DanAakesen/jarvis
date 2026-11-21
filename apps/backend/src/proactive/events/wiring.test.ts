import { describe, expect, it, vi } from 'vitest';
import { createMemoryProactiveStore } from '../store.js';
import type { EventQueueStore } from './event-queue.js';
import { alertEvent, githubEvent, workerEvent } from './producers.js';
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

  it('queues the same events once the sources are on again', async () => {
    const { sink, store, wake, queue } = build();
    await store.settings.patch({ sources: { factory: false, calendar: false } });
    await sink.enqueue(release);
    await store.settings.patch({ sources: { factory: true, calendar: true } });
    wake.mockClear();

    await sink.enqueue(release);
    await sink.enqueue(clash);
    expect(await queue.hasSource('github')).toBe(true);
    expect(await queue.hasSource('calendar')).toBe(true);
    expect(wake).toHaveBeenCalledTimes(2);
    expect((await queue.claim(NOW, 10, 60_000)).map(({ kind }) => kind).sort()).toEqual(['calendar.clash', 'release.published']);
  });
});
