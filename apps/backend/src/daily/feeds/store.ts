import sql from 'mssql';
import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { resolveDailyFeedOwner } from '../owner.js';
import { canonicalJson, instant, text } from '../nutrition/model.js';
import { ToolFailure, ToolRefusal } from '../../core/tool-registry.js';
import { classifyGmailThread, mergeOrders, orderIdentityKey, threadRevives, type Thread, type Order, type Waiting } from './attention.js';
import { validateCalendarRange, weekCalendar, weekEvent, type CalendarRange } from './calendars.js';
import { createDailyChanges, type DailyChangeSink } from '../revisions.js';

export type FeedSource = 'Gmail' | 'GoogleCalendar';
export interface FeedItem { type: 'thread' | 'order_update' | 'event'; id: string; title: string; content: Thread | Order | Record<string, unknown> }
export interface SourceAttempt { source: FeedSource; status: 'ok' | 'error'; items: FeedItem[]; errorCode: string | null }
export interface RefreshRun { runId: string; capturedAt: string; calendarRange?: CalendarRange; sources: SourceAttempt[] }
export interface SourceView { source: FeedSource; status: 'Missing' | 'Stale' | 'Current'; capturedAt: string | null; attemptedAt: string | null; error: string | null; items: FeedItem[]; range?: CalendarRange | null }
export interface FeedSuppression {
  type: 'thread' | 'order'; key: string; suppressedAt: string;
  messageId: string | null; incomingAt: string | null; orderUpdatedAt: string | null;
}
export const feedRevision = (value: FeedItem | FeedSuppression): string => createHash('sha256').update(canonicalJson(value)).digest('hex');
function suppressionRecord(type: 'thread' | 'order', row: Record<string, unknown>): FeedSuppression {
  return { type, key: row[type === 'thread' ? 'thread_id' : 'order_key'] as string, suppressedAt: row.suppressed_at as string,
    messageId: type === 'thread' ? row.suppressed_message_id as string : null,
    incomingAt: type === 'thread' ? row.suppressed_incoming_at as string | null : null,
    orderUpdatedAt: type === 'order' ? row.suppressed_order_updated_at as string | null : null };
}
const key = (column: string, parameter: string) => `${column}=@${parameter} AND DATALENGTH(${column})=DATALENGTH(@${parameter})`;
const sources: FeedSource[] = ['Gmail','GoogleCalendar'];
export const MAX_SOURCE_ITEMS = 1000;
export const MAX_SOURCE_BYTES = 480 * 1024;
/** Fixed two-source envelope: each subtree keeps canonicalJson's 10000-node /
 * 16-depth guards. Aggregate bounds are their sum plus five envelope nodes
 * (20005 nodes / depth 18), not nutrition's smaller single-tree budget.
 * Called after run shape validation; bytes remain identical for prior runs. */
export function canonicalFeedRun(run: RefreshRun): string {
  text(run.runId); instant(run.capturedAt);
  if (Object.keys(run).some((field) => !['runId','capturedAt','calendarRange','sources'].includes(field)) || !Array.isArray(run.sources) || run.sources.length !== 2 ||
      new Set(run.sources.map((source) => source.source)).size !== 2 || run.sources.some((source) => !sources.includes(source.source))) throw new TypeError('Both in-scope sources required');
  if (run.calendarRange !== undefined) validateCalendarRange(run.calendarRange);
  const range = run.calendarRange === undefined ? '' : `"calendarRange":${canonicalJson(run.calendarRange)},`;
  return `{${range}"capturedAt":${canonicalJson(run.capturedAt)},"runId":${canonicalJson(run.runId)},"sources":[${run.sources.map((source) => canonicalJson(source)).join(',')}]}`;
}
/** Reserve room for both sources and run metadata; reject independently before SQL. */
export function boundedSource(source: SourceAttempt, capturedAt?: string): SourceAttempt {
  const exceeded = (): SourceAttempt => ({ source: source.source,status: 'error',items: [],errorCode: 'coverage-limit' });
  try {
    if (source.items.length > MAX_SOURCE_ITEMS || Buffer.byteLength(canonicalJson(source), 'utf8') > MAX_SOURCE_BYTES ||
        source.items.some((item) => Buffer.byteLength(canonicalJson(item.content), 'utf8') > 32000)) return exceeded();
  } catch { return exceeded(); }
  if (capturedAt !== undefined) {
    const other: SourceAttempt = { source: source.source === 'Gmail' ? 'GoogleCalendar' : 'Gmail',status: 'ok',items: [],errorCode: null };
    try { validate({ runId: 'source-preflight',capturedAt,sources: [source,other] }); }
    catch { return { source: source.source,status: 'error',items: [],errorCode: 'invalid-response' }; }
  }
  return source;
}
function validate(run: RefreshRun): void {
  text(run.runId); instant(run.capturedAt);
  if (Object.keys(run).some((field) => !['runId','capturedAt','calendarRange','sources'].includes(field)) || !Array.isArray(run.sources) || run.sources.length !== 2 || new Set(run.sources.map((source) => source.source)).size !== 2) throw new TypeError('Both in-scope sources must report independently');
  for (const source of run.sources) {
    if (Object.keys(source).some((field) => !['source','status','items','errorCode'].includes(field))) throw new TypeError('Invalid source fields');
    if (!sources.includes(source.source) || !['ok','error'].includes(source.status) || !Array.isArray(source.items) || source.items.length > MAX_SOURCE_ITEMS || Buffer.byteLength(canonicalJson(source), 'utf8') > MAX_SOURCE_BYTES ||
        source.status === 'error' && source.items.length !== 0 || source.status === 'ok' && source.errorCode !== null || source.status === 'error' && source.errorCode === null) throw new TypeError('Invalid source attempt');
    if (source.errorCode !== null && !['scope-denied','connection-expired','incomplete','semantic-unavailable','invalid-response','provider-unavailable','coverage-limit','busy','refresh-limited'].includes(source.errorCode)) throw new TypeError('Invalid sanitized feed error');
    const identities = new Set<string>();
    for (const item of source.items) {
      if (Object.keys(item).some((field) => !['type','id','title','content'].includes(field))) throw new TypeError('Invalid item fields');
      text(item.id); if (typeof item.title !== 'string' || item.title.length > 4000) throw new TypeError('Invalid feed title');
      if (source.source === 'Gmail' ? !['thread','order_update'].includes(item.type) : item.type !== 'event') throw new TypeError('Excluded feed type');
      if (identities.has(`${item.type}:${item.id}`)) throw new TypeError('Duplicate feed identity'); identities.add(`${item.type}:${item.id}`);
      if (!item.content || typeof item.content !== 'object' || Array.isArray(item.content) || Buffer.byteLength(canonicalJson(item.content), 'utf8') > 32000) throw new TypeError('Invalid feed content');
      if (item.type === 'thread') {
        const thread = item.content as Thread;
        if (thread.id !== item.id || thread.threadId !== item.id || thread.type !== 'thread') throw new TypeError('Thread identity mismatch');
        text(thread.latestMessageId); instant(thread.latestMessageAt);
        if (thread.latestIncomingAt !== null) instant(thread.latestIncomingAt);
        classifyGmailThread(thread, run.capturedAt);
      }
      if (item.type === 'order_update') { const order = item.content as Order; if (order.id !== item.id) throw new TypeError('Order identity mismatch'); mergeOrders([order]); }
      if (item.type === 'event') {
        const event = item.content as Record<string,unknown>;
        if (event.id !== item.id || event.type !== 'event' || typeof event.allDay !== 'boolean' || Object.keys(event).some((field) => !['calendarId','id','title','calendarName','location','status','start','end','type','providerEventId','startsAt','endsAt','allDay'].includes(field))) throw new TypeError('Invalid calendar DTO');
        text(event.calendarId,1024); instant(event.startsAt); instant(event.endsAt);
        if (Date.parse(event.endsAt) <= Date.parse(event.startsAt)) throw new TypeError('Invalid event range');
      }
    }
  }
  if (Buffer.byteLength(canonicalFeedRun(run), 'utf8') > 1024 * 1024) throw new TypeError('Feed run exceeds limits');
}
/** Existing owner-local snapshots and suppressions; no provider writes. */
export class DailyFeedStore {
  private readonly changes = createDailyChanges();
  private constructor(private readonly pool: sql.ConnectionPool, private readonly owner: string, private readonly now: () => string, changes?: DailyChangeSink) {
    if (changes) this.changes.subscribe(change => changes.publish(change));
  }
  static forRequest(pool: sql.ConnectionPool, request: FastifyRequest, now = () => new Date().toISOString(), changes?: DailyChangeSink): DailyFeedStore {
    return new DailyFeedStore(pool, resolveDailyFeedOwner(request), now, changes);
  }
  private request(parent: sql.ConnectionPool | sql.Transaction): sql.Request { return (parent instanceof sql.Transaction ? new sql.Request(parent) : new sql.Request(parent)).input('owner', sql.UniqueIdentifier, this.owner); }
  private async query(request: sql.Request, query: string, signal: AbortSignal) {
    const cancel = () => request.cancel(); signal.addEventListener('abort', cancel, { once: true });
    try { signal.throwIfAborted(); return await request.query<Record<string, unknown>>(query); } finally { signal.removeEventListener('abort', cancel); }
  }
  private async transaction<T>(signal: AbortSignal, action: (transaction: sql.Transaction, changed: () => void) => Promise<T>): Promise<T> {
    const transaction = new sql.Transaction(this.pool);
    let changed = false;
    let result: T;
    try {
      signal.throwIfAborted(); await transaction.begin();
      const resource = `daily-feeds:${this.owner.toLowerCase()}`;
      await this.query(new sql.Request(transaction).input('resource',sql.NVarChar(255),resource), "DECLARE @result int; EXEC @result=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000; IF @result<0 THROW 51001,'Feed owner lock unavailable',1;",signal);
      result = await action(transaction, () => { changed = true; }); signal.throwIfAborted(); await transaction.commit();
    }
    catch (error) { await transaction.rollback().catch(() => undefined); if (signal.aborted) throw signal.reason; if (error instanceof ToolRefusal || error instanceof ToolFailure) throw error; throw new ToolFailure('Feed persistence failed; retry the same operation key. No record/provider diagnostics are exposed.'); }
    if (changed) this.changes.publish({ owner: this.owner, sources: ['daily.feed'] });
    return result;
  }
  async ingest(input: RefreshRun, signal: AbortSignal): Promise<void> {
    validate(input); input = structuredClone(input);
    const checksum = createHash('sha256').update(canonicalFeedRun(input)).digest('hex'); const now = this.now(); instant(now);
    await this.transaction(signal, async (transaction, changed) => {
      const existing = (await this.query(this.request(transaction).input('id', sql.NVarChar(256), input.runId),
        'SELECT id,checksum FROM daily.attention_runs WITH (UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner AND idempotency_key=@id;', signal)).recordset[0];
      if (existing) { if (existing.id !== input.runId || existing.checksum !== checksum) throw new ToolRefusal('Refresh operation key conflicts with prior content.'); return; }
      changed();
      await this.query(this.request(transaction).input('id', sql.NVarChar(256), input.runId).input('captured', sql.NVarChar(64), input.capturedAt).input('now', sql.NVarChar(64), now)
        .input('checksum', sql.NVarChar(256), checksum).input('statuses', sql.NVarChar(sql.MAX), canonicalJson({
          ...Object.fromEntries(input.sources.map((source) => [source.source,source.status])),
          ...(input.calendarRange ? { calendarRange: input.calendarRange } : {}),
        })),
        `INSERT daily.attention_runs(owner_object_id,id,idempotency_key,mode,captured_at,received_at,checksum,status,source_status_json,completed_at)
         VALUES(@owner,@id,@id,N'manual',@captured,@now,@checksum,N'completed',@statuses,@now);`, signal);
      for (const source of input.sources) {
        const snapshot = createHash('sha256').update(canonicalJson([this.owner,input.runId,source.source])).digest('hex');
        await this.query(this.request(transaction).input('snapshot', sql.NVarChar(256), snapshot).input('run', sql.NVarChar(256), input.runId).input('source', sql.NVarChar(256), source.source)
          .input('status', sql.NVarChar(256), source.status).input('captured', sql.NVarChar(64), input.capturedAt).input('now', sql.NVarChar(64), now)
          .input('count', sql.BigInt, source.items.length).input('checksum', sql.NVarChar(256), createHash('sha256').update(canonicalJson(source)).digest('hex')).input('error', sql.NVarChar(256), source.errorCode),
          `INSERT daily.attention_source_snapshots(owner_object_id,id,run_id,source,status,captured_at,received_at,item_count,checksum,error_code)
           VALUES(@owner,@snapshot,@run,@source,@status,@captured,@now,@count,@checksum,@error);`, signal);
        const current = source.source === 'Gmail' && source.status === 'ok' ? (await this.query(this.request(transaction),
          "SELECT TOP (1) id FROM daily.attention_source_snapshots WHERE owner_object_id=@owner AND source=N'Gmail' AND status=N'ok' ORDER BY CONVERT(datetimeoffset,captured_at) DESC,CONVERT(datetimeoffset,received_at) DESC,id DESC;",signal)).recordset[0]?.id === snapshot : false;
        for (const item of source.items) {
          const content = item.content as unknown as Record<string,unknown>;
          await this.query(this.request(transaction).input('snapshot', sql.NVarChar(256), snapshot).input('source', sql.NVarChar(256), source.source).input('type', sql.NVarChar(256), item.type)
            .input('id', sql.NVarChar(256), item.id).input('title', sql.NVarChar(sql.MAX), item.title).input('content', sql.NVarChar(sql.MAX), canonicalJson(item.content))
            .input('start',sql.NVarChar(64),item.type === 'event' ? content.startsAt ?? null : null).input('end',sql.NVarChar(64),item.type === 'event' ? content.endsAt ?? null : null)
            .input('allDay',sql.Bit,item.type === 'event' ? content.allDay ?? null : null).input('state',sql.NVarChar(256),item.type === 'thread' ? content.semanticState : item.type === 'order_update' ? content.status : content.status ?? null),
            'INSERT daily.attention_items(owner_object_id,snapshot_id,source,item_type,stable_id,title,content_json,starts_at,ends_at,is_all_day,state) VALUES(@owner,@snapshot,@source,@type,@id,@title,@content,@start,@end,@allDay,@state);', signal);
          if (item.type === 'thread' && current) {
            const thread = item.content as Thread;
            const saved = (await this.query(this.request(transaction).input('id', sql.NVarChar(256), item.id),
              `SELECT suppressed_message_id,suppressed_incoming_at FROM daily.gmail_suppressions WITH (UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner AND ${key('thread_id','id')} AND revived_at IS NULL;`, signal)).recordset[0];
            if (saved && threadRevives(thread,{ messageId: saved.suppressed_message_id as string, incomingAt: saved.suppressed_incoming_at as string | null })) {
              await this.query(this.request(transaction).input('id', sql.NVarChar(256), item.id).input('now', sql.NVarChar(64), now), `UPDATE daily.gmail_suppressions SET revived_at=@now,updated_at=@now WHERE owner_object_id=@owner AND ${key('thread_id','id')};`, signal);
            }
          }
        }
      }
    });
  }
  private async latest(source: FeedSource, parent: sql.ConnectionPool | sql.Transaction, signal: AbortSignal): Promise<SourceView> {
    const read = (success: boolean) => this.query(this.request(parent).input('source', sql.NVarChar(256),source),
      `SELECT TOP (1) s.id,s.status,s.captured_at,s.error_code,r.source_status_json FROM daily.attention_source_snapshots s
       ${parent instanceof sql.Transaction ? 'WITH (UPDLOCK,HOLDLOCK)' : ''}
       JOIN daily.attention_runs r ${parent instanceof sql.Transaction ? 'WITH (UPDLOCK,HOLDLOCK)' : ''}
         ON r.owner_object_id=s.owner_object_id AND r.id=s.run_id
       WHERE s.owner_object_id=@owner AND s.source=@source ${success ? "AND s.status=N'ok'" : ''}
       ORDER BY CONVERT(datetimeoffset,s.captured_at) DESC,CONVERT(datetimeoffset,s.received_at) DESC,s.id DESC;`, signal);
    const attempt = (await read(false)).recordset[0]; const success = (await read(true)).recordset[0]; let items: FeedItem[] = [];
    if (success) {
      const rows = (await this.query(this.request(parent).input('snapshot', sql.NVarChar(256),success.id),
        'SELECT TOP (1001) item_type,stable_id,title,content_json FROM daily.attention_items WHERE owner_object_id=@owner AND snapshot_id=@snapshot ORDER BY item_type,stable_id;', signal)).recordset;
      if (rows.length > 1000) throw new ToolFailure('Stored feed exceeds limits.');
      items = rows.map((row) => ({ type: row.item_type as FeedItem['type'], id: row.stable_id as string, title: row.title as string, content: JSON.parse(row.content_json as string) }));
    }
    const now = this.now(); instant(now);
    let range: CalendarRange | null = null;
    if (source === 'GoogleCalendar' && success?.source_status_json) {
      try {
        const metadata = JSON.parse(success.source_status_json as string) as Record<string, unknown>;
        if (metadata.calendarRange) {
          validateCalendarRange(metadata.calendarRange);
          range = metadata.calendarRange as CalendarRange;
        }
      } catch { range = null; }
    }
    return { source, status: !attempt ? 'Missing' : attempt.status !== 'ok' || !success || Date.parse(now) - Date.parse(success.captured_at as string) > 18 * 3600000 ? 'Stale' : 'Current',
      capturedAt: success?.captured_at as string | undefined ?? null, attemptedAt: attempt?.captured_at as string | undefined ?? null,
      error: attempt?.error_code as string | undefined ?? null, items, range };
  }
  async sources(signal: AbortSignal): Promise<SourceView[]> {
    try { return await this.transaction(signal,async (transaction) => { const views: SourceView[] = []; for (const source of sources) views.push(await this.latest(source,transaction,signal)); return views; }); }
    catch { if (signal.aborted) throw signal.reason; throw new ToolFailure('Feed read failed; no private diagnostics are exposed.'); }
  }
  async completed(runId: string, signal: AbortSignal): Promise<boolean> {
    text(runId);
    try { return (await this.query(this.request(this.pool).input('id',sql.NVarChar(256),runId),`SELECT id FROM daily.attention_runs WHERE owner_object_id=@owner AND ${key('id','id')};`,signal)).recordset.length > 0; }
    catch { if (signal.aborted) throw signal.reason; throw new ToolFailure('Refresh state unavailable.'); }
  }
  async attention(signal: AbortSignal): Promise<{ sources: SourceView[]; waiting: Waiting[]; orders: Order[] }>;
  async attention(signal: AbortSignal, includeHidden: true): Promise<{
    sources: SourceView[]; waiting: (Waiting & { hidden: boolean; suppressionKey: string })[];
    orders: (Order & { hidden: boolean; suppressionKey: string })[]; suppressions: FeedSuppression[];
  }>;
  async attention(signal: AbortSignal, includeHidden = false): Promise<{
    sources: SourceView[]; waiting: Waiting[]; orders: Order[];
    suppressions?: FeedSuppression[];
  }> {
    return this.transaction(signal,async (transaction) => {
    const views: SourceView[] = []; for (const source of sources) views.push(await this.latest(source,transaction,signal)); const items = views[0]!.items;
    views[1]!.items = views[1]!.items.filter((item) => { const event = item.content as Record<string,unknown>; return event.status !== 'cancelled' && !weekCalendar(String(event.calendarName || '')) && !weekEvent(item.title); });
    const hiddenThreads = (await this.query(this.request(transaction),'SELECT TOP (1001) thread_id FROM daily.gmail_suppressions WHERE owner_object_id=@owner AND revived_at IS NULL;',signal)).recordset;
    const hiddenOrders = (await this.query(this.request(transaction),'SELECT TOP (1001) order_key FROM daily.order_suppressions WHERE owner_object_id=@owner;',signal)).recordset;
    if (hiddenThreads.length > 1000 || hiddenOrders.length > 1000) throw new ToolFailure('Suppression range exceeds limits.');
    const threadKeys = new Set(hiddenThreads.map((row) => row.thread_id)); const orderKeys = new Set(hiddenOrders.map((row) => row.order_key as string));
    const waiting = items.filter((item) => item.type === 'thread')
      .map((item) => classifyGmailThread(item.content as Thread,this.now())).filter((item) => item !== null);
    if (!includeHidden) return { sources: views, waiting: waiting.filter(item => !threadKeys.has(item.thread.id)),
      orders: mergeOrders(items.filter((item) => item.type === 'order_update').map((item) => item.content as Order),orderKeys) };
    const suppressions = await this.readSuppressions(transaction, signal);
    return { sources: views,
      waiting: waiting.map(item => ({ ...item, hidden: threadKeys.has(item.thread.id), suppressionKey: item.thread.id })),
      orders: mergeOrders(items.filter((item) => item.type === 'order_update').map((item) => item.content as Order))
        .map(order => ({ ...order, hidden: orderKeys.has(orderIdentityKey(order)), suppressionKey: orderIdentityKey(order) })),
      suppressions };
    });
  }
  private target(view: SourceView, type: 'thread' | 'order', id: string): FeedItem {
    if (type === 'thread') {
      const item = view.items.find(item => item.type === 'thread' && item.id === id);
      if (item && classifyGmailThread(item.content as Thread, this.now())) return item;
    } else {
      const order = mergeOrders(view.items.filter(item => item.type === 'order_update').map(item => item.content as Order)).find(order => order.id === id);
      if (order && orderIdentityKey(order)) return { type: 'order_update', id: order.id, title: `${order.company} order ${order.orderNumber}`, content: order };
    }
    throw new ToolRefusal('Only an active owned attention item with an exact suppression identity can be suppressed.');
  }
  async suppressionTarget(type: 'thread' | 'order', id: string, signal: AbortSignal): Promise<FeedItem> {
    text(id);
    if (!['thread','order'].includes(type)) throw new TypeError('Invalid suppression type');
    return this.transaction(signal, async transaction => this.target(await this.latest('Gmail', transaction, signal), type, id));
  }
  private async readSuppressions(transaction: sql.Transaction, signal: AbortSignal): Promise<FeedSuppression[]> {
    const threads = (await this.query(this.request(transaction),
      'SELECT TOP (1001) thread_id,suppressed_message_id,suppressed_incoming_at,suppressed_at FROM daily.gmail_suppressions WHERE owner_object_id=@owner AND revived_at IS NULL ORDER BY thread_id;', signal)).recordset;
    const orders = (await this.query(this.request(transaction),
      'SELECT TOP (1001) order_key,suppressed_order_updated_at,suppressed_at FROM daily.order_suppressions WHERE owner_object_id=@owner ORDER BY order_key;', signal)).recordset;
    if (threads.length > 1000 || orders.length > 1000) throw new ToolFailure('Suppression range exceeds limits.');
    return [
      ...threads.map(row => suppressionRecord('thread', row)),
      ...orders.map(row => suppressionRecord('order', row)),
    ];
  }
  private async readSuppression(transaction: sql.Transaction, type: 'thread' | 'order', exactKey: string, signal: AbortSignal): Promise<FeedSuppression | null> {
    const table = type === 'thread' ? 'gmail_suppressions' : 'order_suppressions';
    const column = type === 'thread' ? 'thread_id' : 'order_key';
    const fields = type === 'thread' ? 'thread_id,suppressed_message_id,suppressed_incoming_at,suppressed_at' : 'order_key,suppressed_order_updated_at,suppressed_at';
    const row = (await this.query(this.request(transaction).input('id',sql.NVarChar(256),exactKey),
      `SELECT ${fields} FROM daily.${table} WHERE owner_object_id=@owner AND ${key(column,'id')} ${type === 'thread' ? 'AND revived_at IS NULL' : ''};`, signal)).recordset[0];
    return row ? suppressionRecord(type, row) : null;
  }
  async suppression(type: 'thread' | 'order', exactKey: string, signal: AbortSignal): Promise<FeedSuppression | null> {
    text(exactKey);
    if (!['thread','order'].includes(type)) throw new TypeError('Invalid suppression type');
    return this.transaction(signal, transaction => this.readSuppression(transaction, type, exactKey, signal));
  }
  private async requireSuppressionCapacity(transaction: sql.Transaction, type: 'thread' | 'order', signal: AbortSignal): Promise<void> {
    const table = type === 'thread' ? 'gmail_suppressions' : 'order_suppressions';
    const row = (await this.query(this.request(transaction),
      `SELECT COUNT_BIG(*) AS count FROM daily.${table} WHERE owner_object_id=@owner ${type === 'thread' ? 'AND revived_at IS NULL' : ''};`, signal)).recordset[0];
    if (BigInt(String(row?.count)) >= 1000n) throw new ToolRefusal('Daily suppression capacity is full for this type. Restore an existing exact suppression before adding another.');
  }
  async suppressions(signal: AbortSignal): Promise<FeedSuppression[]> {
    return this.transaction(signal, transaction => this.readSuppressions(transaction, signal));
  }
  async suppress(type: 'thread' | 'order', id: string, explicitIntent: boolean, signal: AbortSignal, expectedRevision?: string): Promise<boolean> {
    text(id); if (explicitIntent !== true) throw new ToolRefusal('Explicit trusted dismiss/received intent is required.');
    if (!['thread','order'].includes(type)) throw new TypeError('Invalid suppression type');
    return this.transaction(signal, async (transaction, changed) => {
      const item = this.target(await this.latest('Gmail',transaction,signal), type, id);
      if (expectedRevision !== undefined && feedRevision(item) !== expectedRevision) throw new ToolRefusal('The reviewed attention item changed. Read and review it again; nothing was changed by this call.');
      const now = this.now(); instant(now);
      const prior = await this.readSuppression(transaction, type, type === 'thread' ? id : orderIdentityKey(item.content as Order), signal);
      if (!prior) await this.requireSuppressionCapacity(transaction, type, signal);
      if (type === 'thread') {
        const thread = item.content as Thread;
        if (prior?.messageId === thread.latestMessageId && prior.incomingAt === thread.latestIncomingAt) return false;
        await this.query(this.request(transaction).input('id',sql.NVarChar(256),id).input('message',sql.NVarChar(256),thread.latestMessageId).input('incoming',sql.NVarChar(64),thread.latestIncomingAt).input('now',sql.NVarChar(64),now),
          `IF EXISTS(SELECT 1 FROM daily.gmail_suppressions WITH (UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner AND thread_id=@id AND DATALENGTH(thread_id)<>DATALENGTH(@id)) THROW 51001,'Exact key conflict',1;
           IF EXISTS(SELECT 1 FROM daily.gmail_suppressions WITH (UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner AND ${key('thread_id','id')})
           UPDATE daily.gmail_suppressions SET suppressed_message_id=@message,suppressed_incoming_at=@incoming,suppressed_at=@now,revived_at=NULL,updated_at=@now WHERE owner_object_id=@owner AND ${key('thread_id','id')};
           ELSE INSERT daily.gmail_suppressions(owner_object_id,thread_id,suppressed_message_id,suppressed_incoming_at,suppressed_at,updated_at) VALUES(@owner,@id,@message,@incoming,@now,@now);`,signal);
      } else {
        const order = item.content as Order; const identity = orderIdentityKey(order); text(identity);
        if (prior) return false;
        await this.query(this.request(transaction).input('id',sql.NVarChar(256),identity).input('updated',sql.NVarChar(64),order.updatedAt).input('now',sql.NVarChar(64),now),
          `IF EXISTS(SELECT 1 FROM daily.order_suppressions WITH (UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner AND order_key=@id AND DATALENGTH(order_key)<>DATALENGTH(@id)) THROW 51001,'Exact key conflict',1;
           IF NOT EXISTS(SELECT 1 FROM daily.order_suppressions WITH (UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner AND ${key('order_key','id')})
           INSERT daily.order_suppressions(owner_object_id,order_key,suppressed_order_updated_at,suppressed_at,updated_at) VALUES(@owner,@id,@updated,@now,@now);`,signal);
      }
      changed();
      return true;
    });
  }
  async clear(type: 'thread' | 'order', exactKey: string, explicitIntent: boolean, signal: AbortSignal, expectedRevision?: string): Promise<boolean> {
    text(exactKey); if (explicitIntent !== true) throw new ToolRefusal('Explicit trusted clear intent is required.');
    if (!['thread','order'].includes(type)) throw new TypeError('Invalid suppression type');
    const table = type === 'thread' ? 'gmail_suppressions' : 'order_suppressions'; const column = type === 'thread' ? 'thread_id' : 'order_key';
    return this.transaction(signal, async (transaction, changed) => {
      if (expectedRevision !== undefined) {
        const prior = await this.readSuppression(transaction, type, exactKey, signal);
        if (!prior || feedRevision(prior) !== expectedRevision) throw new ToolRefusal('The reviewed suppression changed. Read and review it again; nothing was changed by this call.');
      }
      const result = await this.query(this.request(transaction).input('id',sql.NVarChar(256),exactKey),`DELETE daily.${table} WHERE owner_object_id=@owner AND ${key(column,'id')};`,signal);
      const removed = result.rowsAffected.some(count => count > 0);
      if (removed) changed();
      return removed;
    });
  }
}
