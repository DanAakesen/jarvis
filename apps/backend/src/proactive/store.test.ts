import { describe, expect, it, vi } from 'vitest';
import { proactiveSettingsRevision, ProactiveSettingsConflictError } from './preferences.js';
import { createMemoryProactiveStore } from './store.js';

const finding = {
  dedupeKey: 'fixture:d1',
  title: 'Calendar deadline',
  body: 'Synthetic evidence only.',
  category: 'deadline' as const,
  urgency: 'normal' as const,
  dueAt: '2026-10-20T12:00:00.000Z',
  evidence: [{ source: 'calendar' as const, label: 'Calendar', observedAt: '2026-10-20T05:00:00.000Z' }],
  runId: null,
  language: 'en' as const,
};

describe('in-memory proactive stores', () => {
  it('rejects stale settings revisions and notifies work cancellation for pause/source changes', async () => {
    const store = createMemoryProactiveStore();
    const changed = vi.fn();
    store.settings.subscribePreferencesChanged(changed);
    const original = await store.settings.read();
    const revision = proactiveSettingsRevision(original);

    await store.settings.patch({ paused: true }, revision);
    await expect(store.settings.patch({ sources: { todos: false } }, revision))
      .rejects.toBeInstanceOf(ProactiveSettingsConflictError);
    expect(changed).toHaveBeenCalledOnce();
    expect(await store.settings.read()).toMatchObject({ paused: true, sources: { todos: true } });

    const latest = await store.settings.read();
    await store.settings.patch({ sources: { todos: false } }, proactiveSettingsRevision(latest));
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('atomically rejects stale feedback guards and preserves concurrent state and ratings', async () => {
    const store = createMemoryProactiveStore();
    const first = await store.items.upsertFinding(finding);
    const { state, snoozedUntil, feedback, title, body, dueAt, urgency } = first;
    const guard = { state, snoozedUntil, feedback, title, body, dueAt, urgency };
    const results = await Promise.all([
      store.items.applyFeedback(first.id, 'dismiss', undefined, guard),
      store.items.applyFeedback(first.id, 'snooze', '2026-10-24T07:00:00.000Z', guard),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await store.items.get(first.id)).toMatchObject({ state: 'dismissed' });
    await store.items.applyFeedback(first.id, 'wrong');
    expect(await store.items.applyFeedback(first.id, 'seen', undefined, guard)).toBeUndefined();
    expect(await store.items.get(first.id)).toMatchObject({ state: 'dismissed', feedback: 'wrong' });
  });

  it('lists findings by exact state as well as the Proactive page open/all filters', async () => {
    const store = createMemoryProactiveStore();
    const now = new Date('2026-10-20T05:00:00.000Z');
    const fresh = await store.items.upsertFinding(finding);
    const viewed = await store.items.upsertFinding({ ...finding, dedupeKey: 'fixture:d2' });
    const dismissed = await store.items.upsertFinding({ ...finding, dedupeKey: 'fixture:d3' });
    await store.items.applyFeedback(viewed.id, 'seen');
    await store.items.applyFeedback(dismissed.id, 'dismiss');

    expect(await store.items.list('new', 10, now)).toMatchObject([{ id: fresh.id, state: 'new' }]);
    expect(await store.items.list('seen', 10, now)).toMatchObject([{ id: viewed.id, state: 'seen' }]);
    expect(await store.items.list('open', 10, now)).toHaveLength(2);
    expect(await store.items.list('all', 10, now)).toHaveLength(3);
  });

  it('enforces stored manual limits atomically, including exact five minutes and the local day boundary', async () => {
    const store = createMemoryProactiveStore();
    const start = Date.parse('2026-10-25T21:00:00Z');
    const claimAt = (timestamp: number) => store.runs.claim({ trigger: 'manual', slot: null, now: new Date(timestamp) });
    for (let index = 0; index < 6; index++) {
      const timestamp = start + index * 5 * 60_000;
      const competing = await Promise.all([claimAt(timestamp), claimAt(timestamp)]);
      expect(competing.filter(Boolean)).toHaveLength(1);
      const claimed = competing.find(Boolean)!;
      await store.runs.finish(claimed.run.id, claimed.generation, 'done', null, 0, new Date(timestamp));
      expect(await claimAt(timestamp + 5 * 60_000 - 1)).toBeNull();
    }
    expect(await claimAt(start + 30 * 60_000)).toBeNull();
    expect(await claimAt(Date.parse('2026-10-25T23:00:00Z'))).not.toBeNull();
  });

  it('retains dismissed deduplicated findings until material timing or urgency changes', async () => {
    const store = createMemoryProactiveStore();
    const initial = await store.items.upsertFinding(finding);
    await store.items.applyFeedback(initial.id, 'dismiss');
    const identical = await store.items.upsertFinding({ ...finding, title: 'Updated title' });
    expect(identical.id).toBe(initial.id);
    expect(identical.state).toBe('dismissed');
    expect((await store.items.upsertFinding({ ...finding, urgency: 'fyi' })).state).toBe('dismissed');
    expect((await store.items.upsertFinding(finding)).state).toBe('dismissed');
    const changed = await store.items.upsertFinding({ ...finding, urgency: 'time_critical' });
    expect(changed.id).toBe(initial.id);
    expect(changed.state).toBe('new');
    await store.items.applyFeedback(initial.id, 'dismiss');
    expect((await store.items.upsertFinding(finding)).state).toBe('dismissed');
  });

  it('keeps todo-added state when a finding is upserted again', async () => {
    const store = createMemoryProactiveStore();
    const first = await store.items.upsertFinding(finding);
    await store.items.markTodoAdded([first.id]);
    expect(await store.items.get(first.id)).toMatchObject({ todoAdded: true });
    expect(await store.items.upsertFinding({ ...finding, title: 'Updated synthetic title' }))
      .toMatchObject({ id: first.id, todoAdded: true });
  });

  it('serializes claims, expires stale leases and rejects stale generations', async () => {
    const store = createMemoryProactiveStore();
    const now = new Date('2026-10-20T05:00:00.000Z');
    const slot = await store.runs.claim({ trigger: 'scheduled', slot: '2026-10-20T07:00', now });
    expect(slot).not.toBeNull();
    expect(await store.runs.running(now)).toEqual(slot!.run);
    expect(await store.runs.running(new Date(now.getTime() + 10 * 60_000))).toBeNull();
    expect(Object.keys(slot!.run)).toEqual([
      'id', 'trigger', 'slot', 'status', 'reason', 'startedAt', 'finishedAt', 'findingCount',
    ]);
    expect(await store.runs.claim({ trigger: 'manual', slot: null, now })).toBeNull();
    const later = new Date(now.getTime() + 10 * 60_000);
    const replacement = await store.runs.claim({ trigger: 'manual', slot: null, now: later });
    expect(replacement).not.toBeNull();
    expect(await store.runs.heartbeat(slot!.run.id, slot!.generation, later)).toBe(false);
    expect(await store.runs.finish(slot!.run.id, slot!.generation, 'done', null, 0, later)).toBe(false);
    expect(await store.runs.latest()).toMatchObject({ id: replacement!.run.id, status: 'running' });
  });

  it.each(['missing', 'generation', 'expired', 'finished', 'interrupted', 'mismatched'] as const)(
    'rejects a %s finding guard without inserting or changing findings', async (failure) => {
      const store = createMemoryProactiveStore();
      const now = new Date('2026-10-20T05:00:00.000Z');
      const claimed = (await store.runs.claim({ trigger: 'scheduled', slot: null, now }))!;
      const existing = await store.items.upsertFinding(finding);
      if (failure === 'finished') {
        await store.runs.finish(claimed.run.id, claimed.generation, 'done', null, 0, now);
      }
      if (failure === 'interrupted') await store.runs.markInterruptedOnStartup();
      const guard = {
        runId: failure === 'missing' ? 'missing' : claimed.run.id,
        generation: claimed.generation + (failure === 'generation' ? 1 : 0),
        signal: new AbortController().signal,
        check: () => {},
        now: () => new Date(now.getTime() + (failure === 'expired' ? 10 * 60_000 : 0)),
      };
      const input = { ...finding, runId: failure === 'mismatched' ? null : guard.runId, title: 'Must not persist' };
      await expect(store.items.upsertFinding(input, guard)).rejects.toThrow('lease_lost');
      await expect(store.items.upsertFinding({ ...input, dedupeKey: 'new' }, guard)).rejects.toThrow('lease_lost');
      expect(await store.items.list('all', 20, now)).toEqual([existing]);
    },
  );

  it('checks cancellation and policy immediately before mutation and allows a current guard', async () => {
    const store = createMemoryProactiveStore();
    const now = new Date('2026-10-20T05:00:00.000Z');
    const claimed = (await store.runs.claim({ trigger: 'scheduled', slot: null, now }))!;
    const controller = new AbortController();
    const guard = {
      runId: claimed.run.id, generation: claimed.generation,
      signal: controller.signal, check: () => {}, now: () => now,
    };
    const input = { ...finding, runId: claimed.run.id };
    await expect(store.items.upsertFinding(input, {
      ...guard, check: () => { throw new Error('quiet_hours'); },
    })).rejects.toThrow('quiet_hours');
    controller.abort(new Error('cancelled'));
    await expect(store.items.upsertFinding(input, guard)).rejects.toThrow('cancelled');
    expect(await store.items.list('all', 20, now)).toEqual([]);
    const saved = await store.items.upsertFinding(input, { ...guard, signal: new AbortController().signal });
    expect(await store.items.list('all', 20, now)).toEqual([saved]);
  });

  it('marks running jobs interrupted and keeps source/spend state owner-local', async () => {
    const store = createMemoryProactiveStore();
    const now = new Date('2026-10-20T05:00:00.000Z');
    const run = await store.runs.claim({ trigger: 'manual', slot: null, now });
    expect(await store.runs.markInterruptedOnStartup()).toBe(1);
    expect(await store.runs.finish(run!.run.id, run!.generation, 'done', null, 0, now)).toBe(false);
    await store.sources.upsert({
      id: 'calendar', label: 'Calendar', enabled: true, state: 'ok', reason: null, observedAt: now.toISOString(),
    });
    expect(await store.sources.list()).toMatchObject([{ id: 'calendar', state: 'ok' }]);
    await store.spend.record({
      runId: run!.run.id, month: '2026-10', inputTokens: 20, outputTokens: 5, estimatedDkk: 0.25, createdAt: now,
    });
    expect(await store.spend.monthTotal('2026-10')).toBe(0.25);
    expect(await store.spend.monthTotal('2026-11')).toBe(0);
  });
});
