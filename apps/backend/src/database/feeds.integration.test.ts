import { createHash,randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readMigrations } from './migrations.js';
import { DailyFeedStore,MAX_SOURCE_BYTES,canonicalFeedRun,feedRevision,type RefreshRun,type FeedItem } from '../daily/feeds/store.js';
import { createDailyChanges } from '../daily/revisions.js';
import { canonicalJson } from '../daily/nutrition/model.js';
import type { Thread, Order } from '../daily/feeds/attention.js';
import { DailyFeedRefresh } from '../daily/feeds/refresh.js';
import type { DailyCalendarFeed } from '../daily/feeds/calendars.js';
import { DailyGmailFeed } from '../daily/feeds/gmail.js';
import type { GoogleApiClient } from '../google/api-client.js';

const config = loadDatabaseConfig();
if (!config || process.env.NODE_ENV !== 'test' || config.server !== '127.0.0.1') throw new Error('Feed tests require isolated loopback SQL Server');
const database = `jarvis_feeds_ci_${randomUUID().replaceAll('-','')}`;
const admin = new sql.ConnectionPool({ ...config,database: 'master' }); const pool = new sql.ConnectionPool({ ...config,database });
const owner = '11111111-1111-4111-8111-111111111111'; const other = '22222222-2222-4222-8222-222222222222';
const request = (id = owner) => ({ server: { ownerObjectId: id },principal: { objectId: id } }) as unknown as FastifyRequest;
const now = '2026-10-12T12:00:00Z'; const signal = () => new AbortController().signal;
const store = (id = owner,clock = () => now) => DailyFeedStore.forRequest(pool,request(id),clock);
const thread: Thread = { type: 'thread',id: '01',threadId: '01',title: 'Synthetic question',latestMessageId: 'message-01',latestMessageAt: '2026-10-09T10:00:00Z',latestIncomingAt: '2026-10-09T10:00:00Z',latestDirection: 'incoming',senderName: null,senderEmail: 'sender@example.invalid',senderIsHuman: true,excludedCategory: null,semanticState: 'new_question',semanticEvidence: 'Synthetic factual question.',sentRequestAt: null,waitingSince: null,snippet: null,labels: [] };
const order: Order = { id: 'order:syntheticshop:12345',company: 'Synthetic Shop Ltd',orderNumber: '12345',status: 'shipped',statusLabel: 'Shipped',deliveryDetail: null,updatedAt: '2026-10-09T10:00:00Z' };
const item = (content: Thread | Order): FeedItem => ({ id: content.id,type: 'threadId' in content ? 'thread' : 'order_update',title: 'Synthetic',content });
const run = (runId: string,items: FeedItem[] = [item(thread)],capturedAt = now): RefreshRun => ({ runId,capturedAt,sources: [{ source: 'Gmail',status: 'ok',items,errorCode: null },{ source: 'GoogleCalendar',status: 'ok',items: [],errorCode: null }] });
beforeAll(async () => { await admin.connect(); await admin.request().batch(`CREATE DATABASE [${database}];`); await pool.connect(); await applyMigrations(pool,(await readMigrations()).filter(({ name }) => name === '0041_daily_owner_schema.sql')); });
beforeEach(async () => { await pool.request().batch('DELETE daily.attention_items; DELETE daily.attention_source_snapshots; DELETE daily.attention_runs; DELETE daily.gmail_suppressions; DELETE daily.order_suppressions;'); });
afterAll(async () => { await pool.close(); if (admin.connected) await admin.request().batch(`IF DB_ID(N'${database}') IS NOT NULL BEGIN ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}]; END;`); await admin.close(); });
describe('Daily feed snapshots and suppressions on real isolated SQL Server', () => {
  it('rejects invalid manual ranges before storage/provider work without creating a failed run', async () => {
    await store().ingest(run('retained'),signal());
    const refresh = vi.fn(); const read = vi.fn(); const storeFor = vi.fn(() => store());
    const runner = new DailyFeedRefresh({ refresh } as unknown as DailyCalendarFeed,{ read } as unknown as DailyGmailFeed,storeFor);
    await expect(runner.refresh(request(),'invalid',{ from: now,to: now },true,signal())).rejects.toThrow('limits');
    for (const operation of [refresh,read,storeFor]) expect(operation).not.toHaveBeenCalled();
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM daily.attention_runs')).recordset[0].count).toBe(1);
    expect((await store().sources(signal()))[0]).toMatchObject({ status: 'Current',items: [{ id: thread.id }] });
  });
  it('retains distinct numberless deliveries and suppresses only the exact owned delivery key', async () => {
    const left = { ...order,id: 'numberless-left',orderNumber: null,deliveryDetail: 'Door A' };
    const right = { ...left,id: 'numberless-right',deliveryDetail: 'Door B' };
    await store().ingest(run('numberless',[item(left),item(right)]),signal());
    await store(other).ingest(run('numberless',[item(left),item(right)]),signal());
    expect((await store().attention(signal())).orders.map((row) => row.id)).toEqual([left.id,right.id]);
    await store().suppress('order',left.id,true,signal());
    expect((await store().attention(signal())).orders.map((row) => row.id)).toEqual([right.id]);
    expect((await store(other).attention(signal())).orders).toHaveLength(2);
    await store().clear('order','synthetic shop:door a',true,signal());
    expect((await store().attention(signal())).orders).toHaveLength(2);
  });
  it('persists SENT-alias direction without falsely reviving incoming-only suppression', async () => {
    await store().ingest(run('initial'),signal()); await store().suppress('thread',thread.id,true,signal());
    const message = (id: string,at: string,from: string,labels: string[] = []) => ({ id,internalDate: String(Date.parse(at)),labelIds: labels,
      payload: { mimeType: 'text/plain',headers: [{ name: 'From',value: from },{ name: 'Subject',value: 'Synthetic question' }],body: { data: Buffer.from('Synthetic request').toString('base64url') } } });
    const read = vi.fn<GoogleApiClient['request']>(async (_api,path) => path.endsWith('/profile') ? { emailAddress: 'self@example.invalid',historyId: '100' }
      : path.includes('format=full') ? { id: thread.id,messages: [
        message('alias-sent','2026-10-10T10:00:00Z','alias@example.invalid',[...Array.from({ length: 30 },(_,i) => `LABEL_${i}`),'SENT']),
        message(thread.latestMessageId,thread.latestMessageAt,'sender@example.invalid'),message('primary-sent','2026-10-07T10:00:00Z','self@example.invalid'),
      ] } : { threads: [{ id: thread.id }] });
    const mail = await new DailyGmailFeed({ request: read },{ strictSchema: true,toolFree: true,complete: async () => ({
      semanticState: 'awaiting_reply',semanticEvidence: 'Synthetic unanswered request.',senderIsHuman: true,excludedCategory: null,
      sentRequestAt: '2026-10-07T10:00:00.000Z',waitingSince: null,
    }) }).read(request(),now,signal());
    expect(mail.status).toBe('ok'); expect(mail.threads[0]).toMatchObject({ latestDirection: 'outgoing',latestIncomingAt: '2026-10-09T10:00:00.000Z' });
    const input = run('alias',mail.threads.map(item),'2026-10-12T12:01:00Z');
    await store(owner,() => input.capturedAt).ingest(input,signal()); await store(other,() => input.capturedAt).ingest(input,signal());
    expect((await store().attention(signal())).waiting).toEqual([]);
    expect((await store(other).attention(signal())).waiting[0]?.bucket).toBe('waiting_on_others');
    expect((await pool.request().query('SELECT revived_at FROM daily.gmail_suppressions')).recordset[0].revived_at).toBeNull();
  });
  it.each(['items','bytes','nodes'])('persists healthy Gmail and retains last calendar snapshot on calendar %s overflow', async (limit) => {
    const initial = run('initial'); initial.sources[1]!.items = [{ type: 'event',id: 'synthetic:retained',title: 'Retained synthetic',content: {
      type: 'event',id: 'synthetic:retained',calendarId: 'synthetic',allDay: true,startsAt: '2026-10-12T00:00:00Z',endsAt: '2026-10-13T00:00:00Z',
    } }];
    await store().ingest(initial,signal());
    const capturedAt = '2026-10-12T12:01:00.000Z';
    const events = Array.from({ length: limit === 'items' ? 1001 : limit === 'nodes' ? 600 : 100 },(_,i) => ({ calendarId: 'synthetic',id: String(i),title: limit === 'bytes' ? '界'.repeat(2000) : 'Synthetic',start: { date: '2026-10-12' },end: { date: '2026-10-13' } }));
    const refresh = new DailyFeedRefresh({ refresh: async () => ({ status: 'complete',freshness: 'fresh',issues: [],events }) } as unknown as DailyCalendarFeed,
      { read: async () => ({ status: 'ok',capturedAt,threads: [thread],orders: [],error: null }) } as unknown as DailyGmailFeed,
      () => store(owner,() => capturedAt),() => Date.parse(capturedAt));
    await refresh.refresh(request(),`overflow-${limit}`,{ from: '2026-10-12T00:00:00Z',to: '2026-10-13T00:00:00Z' },true,signal());
    const views = await store(owner,() => capturedAt).sources(signal());
    expect(views[0]).toMatchObject({ status: 'Current',capturedAt,items: [{ id: '01' }] });
    expect(views[1]).toMatchObject({ status: 'Stale',capturedAt: now,attemptedAt: capturedAt,error: 'coverage-limit',items: [{ id: 'synthetic:retained' }] });
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM daily.attention_runs')).recordset[0].count).toBe(2);
  });
  it('commits two individually valid large source trees and retains checksum/replay compatibility', async () => {
    const input = run('combined',Array.from({ length: 120 },(_,i) => item({ ...thread,id: `thread-${i}`,threadId: `thread-${i}`,
      labels: Array.from({ length: 30 },(_,label) => `synthetic-${label}`) })));
    input.sources[1]!.items = Array.from({ length: 350 },(_,i) => ({ type: 'event',id: `synthetic:${i}`,title: 'Synthetic',content: {
      type: 'event',id: `synthetic:${i}`,calendarId: 'synthetic',providerEventId: String(i),title: 'Synthetic',calendarName: 'Synthetic',location: null,status: 'confirmed',
      start: { date: '2026-10-12' },end: { date: '2026-10-13' },startsAt: '2026-10-12T00:00:00Z',endsAt: '2026-10-13T00:00:00Z',allDay: true,
    } }));
    for (const source of input.sources) {
      expect(() => canonicalJson(source)).not.toThrow(); expect(Buffer.byteLength(canonicalJson(source),'utf8')).toBeLessThan(MAX_SOURCE_BYTES);
    }
    expect(() => canonicalJson(input)).toThrow('JSON exceeds limits');
    expect(Buffer.byteLength(canonicalFeedRun(input),'utf8')).toBeLessThan(1024 * 1024);
    await store().ingest(input,signal()); await store().ingest(input,signal());
    const views = await store().sources(signal());
    expect(views.map((view) => view.status)).toEqual(['Current','Current']);
    expect(views.map((view) => view.items.length)).toEqual([120,350]);
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM daily.attention_runs')).recordset[0].count).toBe(1);
    expect((await pool.request().query('SELECT checksum FROM daily.attention_runs')).recordset[0].checksum).toBe(createHash('sha256').update(canonicalFeedRun(input)).digest('hex'));
    const small = run('compatible'); await store().ingest(small,signal());
    const saved = (await pool.request().input('id',sql.NVarChar(256),small.runId).query('SELECT checksum FROM daily.attention_runs WHERE id=@id')).recordset[0];
    expect(saved.checksum).toBe(createHash('sha256').update(canonicalJson(small)).digest('hex'));
  });
  it('commits concurrent duplicate runs once per owner and refuses changed checksums/padded keys', async () => {
    expect((await store().sources(signal())).map((source) => source.status)).toEqual(['Missing','Missing']);
    await Promise.all(Array.from({ length: 6 },() => store().ingest(run('01'),signal())));
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM daily.attention_runs')).recordset[0].count).toBe(1);
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM daily.attention_source_snapshots')).recordset[0].count).toBe(2);
    await expect(store().ingest(run('01',[]),signal())).rejects.toThrow('conflicts');
    await expect(store().ingest(run('01 '),signal())).rejects.toThrow('conflicts');
    expect(await store().completed('01 ',signal())).toBe(false);
    await store(other).ingest(run('01'),signal()); expect((await store(other).attention(signal())).waiting).toHaveLength(1);
  });
  it('selects latest attempts and successes independently, preserving stale success and exact 18-hour boundary', async () => {
    await store().ingest(run('first'),signal());
    expect((await store(owner,() => '2026-10-13T06:00:00Z').sources(signal()))[0]?.status).toBe('Current');
    expect((await store(owner,() => '2026-10-13T06:00:00.001Z').sources(signal()))[0]?.status).toBe('Stale');
    const failed = run('failed',[],'2026-10-12T12:30:00Z'); failed.sources[0] = { source: 'Gmail',status: 'error',items: [],errorCode: 'semantic-unavailable' };
    await store(owner,() => failed.capturedAt).ingest(failed,signal());
    const view = (await store(owner,() => failed.capturedAt).sources(signal()))[0]!;
    expect(view).toMatchObject({ status: 'Stale',capturedAt: now,attemptedAt: failed.capturedAt,error: 'semantic-unavailable',items: [{ id: '01' }] });
    await store().ingest(run('backdated',[],'2026-10-11T23:00:00-02:00'),signal());
    expect((await store().sources(signal()))[0]?.items).toHaveLength(1);
    expect((await store(owner,() => failed.capturedAt).sources(signal()))[1]?.status).toBe('Current');
  });
  it('requires explicit intent, retains suppression history and revives only newer incoming activity', async () => {
    await store().ingest(run('first'),signal());
    await expect(store().suppress('thread','01',false,signal())).rejects.toThrow('Explicit');
    await store().suppress('thread','01',true,signal()); await store().suppress('thread','01',true,signal());
    expect((await store().attention(signal())).waiting).toEqual([]);
    await store().ingest(run('outgoing',[item({ ...thread,latestMessageId: 'outgoing-02',latestDirection: 'outgoing',sentRequestAt: '2026-10-07T10:00:00Z' })],'2026-10-12T12:01:00Z'),signal());
    expect((await store().attention(signal())).waiting).toEqual([]);
    const incoming = { ...thread,latestMessageId: 'incoming-03',latestIncomingAt: '2026-10-10T10:00:00Z',latestMessageAt: '2026-10-10T10:00:00Z' };
    await store().ingest(run('incoming',[item(incoming)],'2026-10-12T12:02:00Z'),signal());
    expect((await store().attention(signal())).waiting).toHaveLength(1);
    const saved = (await pool.request().query('SELECT * FROM daily.gmail_suppressions')).recordset[0];
    expect(saved).toMatchObject({ suppressed_message_id: thread.latestMessageId,revived_at: now });
    await store().suppress('thread','01',true,signal());
    await store(other).clear('thread','01',true,signal()); expect((await store().attention(signal())).waiting).toEqual([]);
    await store().clear('thread','01 ',true,signal()); expect((await store().attention(signal())).waiting).toEqual([]);
    await store().clear('thread','01',true,signal()); await store().clear('thread','01',true,signal());
    expect((await store().attention(signal())).waiting).toHaveLength(1);
  });
  it('round-trips a hidden thread and its exact restore key in the existing SQL store', async () => {
    await store().ingest(run('hide-restore'),signal());
    await store().suppress('thread',thread.id,true,signal());
    const hidden = await store().attention(signal(),true);
    expect(hidden.waiting).toMatchObject([{ thread: { id: thread.id }, hidden: true, suppressionKey: thread.id }]);
    expect(hidden.suppressions).toMatchObject([{ type: 'thread', key: thread.id }]);
    expect(await store().clear('thread',thread.id,true,signal())).toBe(true);
    expect((await store().attention(signal(),true)).waiting).toMatchObject([{ thread: { id: thread.id }, hidden: false }]);
    expect(await store().clear('thread',thread.id,true,signal())).toBe(false);
  });
  it('retains the requested calendar range with the successful snapshot in existing run metadata', async () => {
    const calendarRange = { from: '2026-10-11T00:00:00Z', to: '2026-10-13T00:00:00Z' };
    await store().ingest({ ...run('calendar-range',[]), calendarRange },signal());
    expect((await store().sources(signal()))[1]).toMatchObject({ status: 'Current', range: calendarRange });
    expect(canonicalFeedRun(run('legacy-range-shape'))).not.toContain('calendarRange');
  });
  it('keeps source IDs distinct from owner-local order suppression keys and never auto-revives same-key updates', async () => {
    await store().ingest(run('first',[item(order)]),signal()); await store(other).ingest(run('first',[item(order)]),signal());
    await Promise.all([store().suppress('order',order.id,true,signal()),store().suppress('order',order.id,true,signal())]);
    expect((await store().attention(signal())).orders).toEqual([]); expect((await store(other).attention(signal())).orders[0]?.id).toBe(order.id);
    const next = { ...order,status: 'delayed',updatedAt: '2026-10-10T10:00:00Z' };
    const different = { ...order,id: 'order:syntheticshop:67890',orderNumber: '67890' };
    await store().ingest(run('later',[item(next),item(different)],'2026-10-12T12:01:00Z'),signal());
    expect((await store().attention(signal())).orders.map((order) => order.id)).toEqual([different.id]);
    const saved = (await pool.request().query('SELECT order_key,suppressed_order_updated_at,revived_at FROM daily.order_suppressions')).recordset[0];
    expect(saved).toMatchObject({ order_key: 'synthetic shop:12345',suppressed_order_updated_at: order.updatedAt,revived_at: null });
    await store().clear('order',saved.order_key,true,signal()); expect((await store().attention(signal())).orders).toHaveLength(2);
    await store().ingest(run('terminal',[item({ ...next,status: 'received' })],'2026-10-12T12:02:00Z'),signal());
    expect((await store().attention(signal())).orders).toEqual([]);
    await expect(store().suppress('order',order.id,true,signal())).rejects.toThrow('active');
  });
  it('rejects excluded sources/types and another owner or coding runner before SQL', async () => {
    await expect(store().ingest({ ...run('bad'),sources: [{ source: 'TickTick',status: 'ok',items: [],errorCode: null },run('bad').sources[1]!] } as unknown as RefreshRun,signal())).rejects.toThrow();
    await expect(store().ingest(run('bad',[{ ...item(thread),type: 'task' } as unknown as FeedItem]),signal())).rejects.toThrow('Excluded');
    expect(() => DailyFeedStore.forRequest(pool,{ ...request(),principal: { objectId: other } } as FastifyRequest)).toThrow();
    expect(() => DailyFeedStore.forRequest(pool,{ ...request(),runnerPrincipal: { kind: 'jarvis-runner' } } as unknown as FastifyRequest)).toThrow();
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM daily.attention_runs')).recordset[0].count).toBe(0);
  });
  it('publishes only acknowledged new feed commits, isolating replay, no-op, failure and listener failure', async () => {
    const changes = createDailyChanges(); const events: unknown[] = [];
    changes.subscribe(change => { events.push(change); });
    changes.subscribe(() => { throw new Error('Synthetic disconnected listener'); });
    const current = DailyFeedStore.forRequest(pool, request(), () => now, changes);
    await current.ingest(run('notify'), signal()); await current.ingest(run('notify'), signal());
    expect(events).toEqual([{ owner, sources: ['daily.feed'] }]);
    await expect(current.ingest(run('notify', []), signal())).rejects.toThrow('conflicts');
    expect(await current.suppress('thread', thread.id, true, signal())).toBe(true);
    expect(await current.suppress('thread', thread.id, true, signal())).toBe(false);
    expect(await current.clear('thread', 'missing', true, signal())).toBe(false);
    expect(await current.clear('thread', thread.id, true, signal())).toBe(true);
    expect(events).toHaveLength(3);
    expect((await current.attention(signal())).waiting).toHaveLength(1);
  });
  it('rechecks native-reviewed targets and exact suppression revisions inside owner transactions', async () => {
    await store().ingest(run('review-initial', [item(thread), item(order)]), signal());
    const selected = await store().suppressionTarget('thread', thread.id, signal());
    const updated = { ...thread, latestMessageId: 'new-message', latestMessageAt: '2026-10-10T10:00:00Z', latestIncomingAt: '2026-10-10T10:00:00Z' };
    await store().ingest(run('review-new', [item(updated), item(order)], '2026-10-12T12:01:00Z'), signal());
    await expect(store().suppress('thread', thread.id, true, signal(), feedRevision(selected))).rejects.toThrow('changed');
    expect(await store().suppressions(signal())).toEqual([]);
    const reviewedOrder = await store().suppressionTarget('order', order.id, signal());
    expect(await store().suppress('order', order.id, true, signal(), feedRevision(reviewedOrder))).toBe(true);
    const saved = (await store().suppressions(signal()))[0]!;
    expect(saved).toMatchObject({ type: 'order', key: 'synthetic shop:12345', messageId: null });
    expect(await store(other).suppressions(signal())).toEqual([]);
    expect(await store().clear('order', order.id, true, signal())).toBe(false);
    await expect(store().clear('order', saved.key, true, signal(), '0'.repeat(64))).rejects.toThrow('changed');
    expect(await store().clear('order', saved.key, true, signal(), feedRevision(saved))).toBe(true);
    await expect(store().clear('order', saved.key, true, signal(), feedRevision(saved))).rejects.toThrow('changed');
    expect(await store().suppressions(signal())).toEqual([]);
  });
  it('does not suppress an old active order update after its merged order became terminal', async () => {
    const terminal = { ...order, id: 'terminal-update', status: 'delivered', updatedAt: '2026-10-10T10:00:00Z' };
    await store().ingest(run('terminal-review', [item(order), item(terminal)]), signal());
    expect((await store().attention(signal())).orders).toEqual([]);
    await expect(store().suppressionTarget('order', order.id, signal())).rejects.toThrow('active');
    await expect(store().suppress('order', order.id, true, signal())).rejects.toThrow('active');
    expect(await store().suppressions(signal())).toEqual([]);
  });
  it.each(['thread', 'order'] as const)('bounds %s suppression additions at1000 without blocking exact restoration or updates', async type => {
    const seed = async (ids: string[]) => {
      const table = type === 'thread' ? 'gmail_suppressions' : 'order_suppressions';
      const columns = type === 'thread' ? 'thread_id,suppressed_message_id,suppressed_incoming_at' : 'order_key,suppressed_order_updated_at';
      const values = type === 'thread' ? 'id,N\'old-message\',@now' : 'id,@now';
      await pool.request().input('owner', sql.UniqueIdentifier, owner).input('now', sql.NVarChar(64), now)
        .input('ids', sql.NVarChar(sql.MAX), JSON.stringify(ids))
        .query(`INSERT daily.${table}(owner_object_id,${columns},suppressed_at,updated_at)
          SELECT @owner,${values},@now,@now FROM OPENJSON(@ids) WITH (id nvarchar(256) '$');`);
    };
    const existingId = type === 'thread' ? thread.id : 'synthetic shop:12345';
    await seed([existingId, ...Array.from({ length: 999 }, (_, index) => `synthetic-capacity-${index}`)]);
    const newcomer = type === 'thread' ? { ...thread, id: 'new-thread', threadId: 'new-thread' }
      : { ...order, id: 'new-order', orderNumber: 'another' };
    await store().ingest(run('capacity', [item(thread), item(order), item(newcomer)]), signal());
    const changes = createDailyChanges(); const notify = vi.fn();
    changes.subscribe(notify);
    const current = DailyFeedStore.forRequest(pool, request(), () => now, changes);
    const selected = await current.suppressionTarget(type, newcomer.id, signal());
    await expect(current.suppress(type, newcomer.id, true, signal(), feedRevision(selected))).rejects.toThrow('capacity');
    expect(notify).not.toHaveBeenCalled();
    expect(await current.suppressions(signal())).toHaveLength(1000);
    expect((await current.attention(signal()))[type === 'thread' ? 'waiting' : 'orders']).toHaveLength(1);
    const existingProducerId = type === 'thread' ? thread.id : order.id;
    expect(await current.suppress(type, existingProducerId, true, signal())).toBe(type === 'thread');
    const saved = await current.suppression(type, existingId, signal());
    expect(saved?.key).toBe(existingId);
    expect(await store(other).suppression(type, existingId, signal())).toBeNull();
    expect(await current.clear(type, existingId, true, signal(), feedRevision(saved!))).toBe(true);
    expect(await current.suppress(type, newcomer.id, true, signal(), feedRevision(selected))).toBe(true);
    expect(await current.suppressions(signal())).toHaveLength(1000);

    // A previously imported oversized set must not trap its known-key recovery path.
    await seed(['synthetic-overflow']);
    await expect(current.suppressions(signal())).rejects.toThrow('limits');
    const overflow = await current.suppression(type, 'synthetic-overflow', signal());
    expect(overflow).not.toBeNull();
    expect(await current.clear(type, 'synthetic-overflow', true, signal(), feedRevision(overflow!))).toBe(true);
    expect(await current.suppressions(signal())).toHaveLength(1000);
  });
});
