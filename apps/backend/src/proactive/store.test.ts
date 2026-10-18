import { describe, expect, it } from 'vitest';
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
