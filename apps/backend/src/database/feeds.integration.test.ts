import { createHash,randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readMigrations } from './migrations.js';
import { DailyFeedStore,MAX_SOURCE_BYTES,canonicalFeedRun,type RefreshRun,type FeedItem } from '../daily/feeds/store.js';
import { canonicalJson } from '../daily/nutrition/model.js';
import type { Thread, Order } from '../daily/feeds/attention.js';
import { DailyFeedRefresh } from '../daily/feeds/refresh.js';
import type { DailyCalendarFeed } from '../daily/feeds/calendars.js';
import type { DailyGmailFeed } from '../daily/feeds/gmail.js';

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
});
