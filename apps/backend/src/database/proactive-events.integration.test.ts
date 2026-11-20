import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDatabaseConfig } from './config.js';
import { createProactiveEventStore } from './proactive-event-store.js';
import { createProactiveOutreachStore } from './proactive-outreach-store.js';
import { createNowCardChannel, createPushChannel } from '../proactive/events/channels.js';
import { createEventPipeline } from '../proactive/events/pipeline.js';
import { createMemoryProactiveStore } from '../proactive/store.js';

const configuration = loadDatabaseConfig();
if (!configuration || process.env.NODE_ENV !== 'test' || configuration.server !== '127.0.0.1') {
  throw new Error('Database integration tests require an isolated loopback SQL Server test configuration');
}
const database = `jarvis_ci_${randomUUID().replaceAll('-', '')}`;
const administrator = new sql.ConnectionPool({ ...configuration, database: 'master' });
const pool = new sql.ConnectionPool({ ...configuration, database });
const owner = randomUUID();
const now = new Date('2026-11-15T10:00:00.000Z');

beforeAll(async () => {
  await administrator.connect();
  await administrator.request().batch(`CREATE DATABASE [${database}];`);
  await pool.connect();
  await pool.request().batch(await readFile(new URL('../../../../db/migrations/0080_proactive_events.sql', import.meta.url), 'utf8'));
  await pool.request().batch(`ALTER TABLE dbo.proactive_event_batches ADD
    activation_type varchar(10) NOT NULL DEFAULT 'event',
    satisfied_slot nvarchar(16) NULL;
    ALTER TABLE dbo.proactive_events ADD
      identity_key nvarchar(200) NULL,
      material_hash char(64) NULL,
      not_before_at datetime2(7) NULL;`);
  await pool.request().batch(`CREATE UNIQUE INDEX UX_proactive_events_owner_active_identity_test
      ON dbo.proactive_events (owner_object_id, identity_key)
      WHERE identity_key IS NOT NULL AND processed_at IS NULL;`);
});
afterAll(async () => {
  await pool.close();
  if (administrator.connected) {
    await administrator.request().batch(`IF DB_ID(N'${database}') IS NOT NULL BEGIN
      ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
      DROP DATABASE [${database}]; END;`);
  }
  await administrator.close();
});

const event = (key: string, extra: Record<string, unknown> = {}) => ({
  source: 'github', kind: 'workflow_run.failure', dedupeKey: key, summary: 'Deploy failed',
  detail: { repository: 'DanAakesen/jarvis', ...extra }, occurredAt: now,
});

describe('proactive event queue on SQL Server', () => {
  const queue = createProactiveEventStore(pool, owner);

  it('stores an event once per dedupe key, also under concurrent producers', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => queue.enqueue(event('same'), now)));
    expect(results.filter(({ inserted }) => inserted)).toHaveLength(1);
    expect(new Set(results.map(({ id }) => id)).size).toBe(1);
  });

  it('keeps one owner\'s events away from another owner', async () => {
    await queue.enqueue(event('mine'), now);
    const other = createProactiveEventStore(pool, randomUUID());
    expect(await other.hasWork(now)).toBe(false);
    expect(await other.claim(now, 10, 60_000)).toEqual([]);
  });

  it('leases claimed events, lets two workers claim disjoint events, and releases them on retry', async () => {
    await pool.request().query('DELETE dbo.proactive_events');
    for (let index = 0; index < 4; index += 1) await queue.enqueue(event(`lease-${index}`), new Date(now.getTime() + index));
    const [first, second] = await Promise.all([queue.claim(now, 2, 60_000), queue.claim(now, 2, 60_000)]);
    const ids = [...first!, ...second!].map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(4);
    expect(first![0]).toMatchObject({ source: 'github', kind: 'workflow_run.failure', attempts: 1, detail: { repository: 'DanAakesen/jarvis' } });
    expect(await queue.claim(now, 10, 60_000)).toEqual([]);
    const retryAt = new Date(now.getTime() + 300_000);
    await queue.retryLater([ids[0]!], retryAt);
    expect(await queue.nextDueAt()).not.toBeNull();
    expect(await queue.claim(now, 10, 60_000)).toEqual([]);
    const later = await queue.claim(new Date(retryAt.getTime() + 1), 10, 60_000);
    expect(later.find(({ id }) => id === ids[0])).toMatchObject({ attempts: 2 });
  });

  it('settles events with a free-text outcome and counts model batches and escalations', async () => {
    await pool.request().query('DELETE dbo.proactive_events');
    const a = await queue.enqueue(event('settle-a'), now);
    const b = await queue.enqueue({ ...event('settle-b'), source: 'mail', kind: 'message.new' }, now);
    const batch = randomUUID();
    await queue.claim(now, 10, 60_000);
    await queue.startBatch(batch, now, 1, { activationType: 'scheduled', satisfiedSlot: '2026-11-15T07:00' });
    await queue.startBatch(randomUUID(), new Date(now.getTime() + 1), 1, {
      activationType: 'event', satisfiedSlot: '2026-11-15T18:00',
    });
    await queue.settle([{ id: a.id, outcome: 'outreach x (medium)', batchId: batch }, { id: b.id, outcome: 'rule: stale' }], now);
    expect(await queue.hasWork(new Date(now.getTime() + 3_600_000))).toBe(false);
    const since = new Date(now.getTime() - 60_000);
    // A call that settled nothing still counts.
    expect(await queue.modelBatchesSince(since)).toBe(2);
    await expect(queue.lastBatch()).resolves.toMatchObject({
      activationType: 'event', satisfiedSlot: '2026-11-15T18:00',
    });
    expect(await queue.escalatedSince('github', since)).toBe(1);
    expect(await queue.escalatedSince('mail', since)).toBe(0);
    expect(await queue.hasSource('mail')).toBe(true);
    expect(await queue.hasSource('calendar')).toBe(false);
    const { recordset } = await pool.request().query('SELECT outcome FROM dbo.proactive_events WHERE outcome IS NOT NULL ORDER BY outcome');
    expect(recordset.map((row) => row.outcome)).toEqual(['outreach x (medium)', 'rule: stale']);
  });

  it('records baseline events as seen and purges old processed events', async () => {
    await pool.request().query('DELETE dbo.proactive_events');
    await queue.enqueue({ ...event('baseline'), baseline: true }, now);
    expect(await queue.hasWork(now)).toBe(false);
    expect(await queue.enqueue(event('baseline'), now)).toMatchObject({ inserted: false });
    expect(await queue.purge(new Date(now.getTime() - 1))).toBe(0);
    expect(await queue.purge(new Date(now.getTime() + 1))).toBe(1);
    expect(await queue.enqueue(event('baseline'), now)).toMatchObject({ inserted: true });
  });

  it('updates one active identity only for material change and holds future work until not_before_at', async () => {
    await pool.request().query('DELETE dbo.proactive_events');
    const dueAt = new Date(now.getTime() + 60_000);
    const first = await queue.enqueue({
      ...event('identity-v1'),
      identity: 'calendar-event:stable',
      material: { startsAt: dueAt.toISOString() },
      notBeforeAt: dueAt,
    }, now);
    expect(await queue.hasWork(now)).toBe(false);
    expect(await queue.enqueue({
      ...event('identity-v1'),
      identity: 'calendar-event:stable',
      material: { startsAt: dueAt.toISOString() },
      notBeforeAt: dueAt,
    }, now)).toMatchObject({ id: first.id, inserted: false });
    const changedInput = {
      ...event('identity-v2', { startsAt: new Date(dueAt.getTime() + 60_000).toISOString() }),
      identity: 'calendar-event:stable',
      material: { startsAt: new Date(dueAt.getTime() + 60_000).toISOString() },
      notBeforeAt: dueAt,
    };
    const changed = await queue.enqueue(changedInput, now);
    expect(changed.inserted).toBe(true);
    const claimed = await queue.claim(dueAt, 10, 60_000);
    expect(claimed.map(({ id }) => id)).toEqual([changed.id]);
    expect(await queue.cancel('calendar-event:stable', dueAt, 'follow-up cancelled in test')).toBe(true);
    expect(await queue.hasWork(new Date(dueAt.getTime() + 1))).toBe(false);
    expect(await queue.enqueue(changedInput, new Date(dueAt.getTime() + 1_000)))
      .toEqual({ id: changed.id, inserted: true });
  });

  it('reactivates an earlier material version after the newer version has settled', async () => {
    await pool.request().query('DELETE dbo.proactive_events');
    const original = {
      ...event('reactivate-a'),
      identity: 'calendar-event:reactivate',
      material: { startsAt: 'A' },
      notBeforeAt: now,
    };
    const changed = {
      ...event('reactivate-b'),
      identity: 'calendar-event:reactivate',
      material: { startsAt: 'B' },
      notBeforeAt: now,
    };
    const first = await queue.enqueue(original, now);
    const changedRow = await queue.enqueue(changed, now);
    const changedClaim = await queue.claim(now, 10, 60_000);
    expect(changedClaim).toMatchObject([{ id: changedRow.id }]);
    await queue.settle([{ id: changedRow.id, outcome: 'brain wake delivered' }], now);
    expect(await queue.enqueue(original, new Date(now.getTime() + 1_000)))
      .toEqual({ id: first.id, inserted: true });
    expect(await queue.claim(now, 10, 60_000)).toMatchObject([{ id: first.id }]);
  });

  it('computes the first due instant across the whole owner queue before truncating', async () => {
    await pool.request().query('DELETE dbo.proactive_events');
    const future = new Date(now.getTime() + 2 * 60 * 60_000);
    for (let index = 0; index < 205; index += 1) {
      await queue.enqueue({
        ...event(`order-${index}`),
        notBeforeAt: future,
      }, new Date(now.getTime() + index));
    }
    const earlier = new Date(now.getTime() + 1_000);
    await queue.enqueue({ ...event('order-due') }, earlier);
    expect(await queue.nextDueAt()).toEqual(earlier);
  });
});

describe('event pipeline on SQL Server', () => {
  it('runs an event from the queue to a pushed outreach, a Now card and a rating', async () => {
    await pool.request().query('DELETE dbo.proactive_events; DELETE dbo.proactive_outreach;');
    const queue = createProactiveEventStore(pool, owner);
    const outreach = createProactiveOutreachStore(pool, owner);
    const pushes: unknown[] = [];
    const cards: unknown[] = [];
    const pipeline = createEventPipeline({
      queue, outreach, store: createMemoryProactiveStore(owner), now: () => now, contextSources: [],
      reasoner: {
        worstCaseDkk: () => 0.35,
        async reason(input) {
          return {
            decisions: [{ eventIds: [input.events[0]!.id], tier: 'high', title: 'Deploy failed', body: 'Main is red.', why: 'blocks work', category: 'status' }],
            quiet: input.events.slice(1).map((entry) => ({ eventId: entry.id, why: 'duplicate' })),
            usage: { model: 'gpt-6.1-terra', inputTokens: 5_000, outputTokens: 500 },
          };
        },
      },
      channels: [
        createNowCardChannel({ async record(alert) { cards.push(alert); return true; } }),
        createPushChannel(async (request) => { pushes.push(request); return { status: 'sent', reason: null, attempted: 1, accepted: 1, statusCode: 201 }; }),
      ],
    });
    await queue.enqueue({ ...event('e2e-1'), occurredAt: new Date(now.getTime() - 60_000) }, now);
    await queue.enqueue({ ...event('e2e-2'), kind: 'workflow_run.success' }, now);
    await queue.enqueue({ ...event('e2e-3'), occurredAt: new Date(now.getTime() - 30_000) }, now);
    pipeline.wake();
    const result = await pipeline.tick(new AbortController().signal);
    expect(result).toMatchObject({ outcome: 'done', claimed: 3, dropped: 1, outreach: 1 });
    expect(pushes).toHaveLength(1);
    expect(cards).toHaveLength(0);
    const [row] = await outreach.recent(5, new Date(0));
    expect(row).toMatchObject({ tier: 'high', rating: null, delivery: [{ channel: 'push', status: 'sent' }] });
    expect(row?.pushedAt).not.toBeNull();
    const { recordset } = await pool.request().query('SELECT outcome FROM dbo.proactive_events ORDER BY outcome');
    expect(recordset.map((entry) => String(entry.outcome).split(' ')[0])).toEqual(['outreach', 'quiet:', 'rule:']);
    expect(await queue.hasWork(new Date(now.getTime() + 86_400_000))).toBe(false);
  });
});

describe('proactive outreach ledger on SQL Server', () => {
  const outreach = createProactiveOutreachStore(pool, owner);
  const itemId = randomUUID();
  const decision = {
    eventIds: ['e1'], tier: 'medium' as const, title: 'Deploy failed', body: 'Main is red.', why: 'blocks work',
    category: 'status' as const,
  };

  it('creates, delivers, rates and reads back an outreach, including from the linked item', async () => {
    await pool.request().query('DELETE dbo.proactive_outreach');
    const created = await outreach.create({ decision, batchId: randomUUID(), itemId }, now);
    expect(created).toMatchObject({ tier: 'medium', rating: null, itemId, eventIds: ['e1'], delivery: [] });
    await outreach.recordDelivery(created.id, [{ channel: 'push', status: 'sent', reason: null }], now);
    expect(await outreach.pushesSince(new Date(now.getTime() - 1_000))).toBe(1);
    expect((await outreach.rate(created.id, 'down', 'too noisy'))).toMatchObject({ rating: 'down', ratingNote: 'too noisy' });
    expect(await outreach.rateByItem(itemId, 'up')).toBe(true);
    expect(await outreach.rateByItem(randomUUID(), 'up')).toBe(false);
    const [row] = await outreach.recent(5, new Date(now.getTime() - 1_000));
    expect(row).toMatchObject({ id: created.id, rating: 'up', delivery: [{ channel: 'push', status: 'sent' }] });
    expect(await createProactiveOutreachStore(pool, randomUUID()).get(created.id)).toBeUndefined();
  });

  it('rejects a tier outside low, medium and high', async () => {
    await expect(outreach.create({ decision: { ...decision, tier: 'urgent' as never }, batchId: randomUUID(), itemId: null }, now)).rejects.toThrow();
  });

  it('refuses rollback while outreach exists and drops both tables once it does not', async () => {
    const down = await readFile(new URL('../../../../db/migrations/down/0080_proactive_events.sql', import.meta.url), 'utf8');
    await expect(pool.request().batch(down)).rejects.toThrow('durable evidence');
    await pool.request().query('DELETE dbo.proactive_outreach');
    await pool.request().batch(down);
    const { recordset } = await pool.request().query(`SELECT COUNT(*) AS tables FROM sys.tables WHERE name LIKE N'proactive_%';`);
    expect(recordset[0]?.tables).toBe(0);
  });
});
