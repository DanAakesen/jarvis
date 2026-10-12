import type { FastifyRequest } from 'fastify';
import { resolveDailyOwner } from '../owner.js';
import { text } from '../nutrition/model.js';
import { DailyCalendarFeed, timedConflicts, validateCalendarRange, type CalendarRange, type CalendarEvent } from './calendars.js';
import { DailyGmailFeed } from './gmail.js';
import { DailyFeedStore, boundedSource, type FeedItem, type SourceAttempt } from './store.js';

export interface RefreshState { runId: string; state: 'running' | 'completed' | 'limited'; sources?: { source: string; status: string; error: string | null }[] }
/** Awaited manual execution; no source workflow dispatch, scheduler, tools or API routes. */
export class DailyFeedRefresh {
  private readonly running = new Map<string,string>();
  private readonly attempted = new Map<string,number>();
  constructor(private readonly calendars: DailyCalendarFeed, private readonly gmail: DailyGmailFeed,
    private readonly storeFor: (request: FastifyRequest) => DailyFeedStore, private readonly now: () => number = Date.now) {}
  async refresh(request: FastifyRequest, runId: string, range: CalendarRange, explicitIntent: boolean, signal: AbortSignal): Promise<RefreshState> {
    const owner = resolveDailyOwner(request); text(runId); signal.throwIfAborted();
    if (explicitIntent !== true) throw new TypeError('Trusted explicit manual refresh intent required');
    validateCalendarRange(range);
    const store = this.storeFor(request);
    if (await store.completed(runId,signal)) return { runId,state: 'completed' };
    const active = this.running.get(owner); if (active) return { runId: active,state: 'running' };
    const now = this.now(); const previous = this.attempted.get(owner);
    if (previous !== undefined && now - previous < 30000 || this.running.size >= 4) return { runId,state: 'limited' };
    if (!this.attempted.has(owner) && this.attempted.size >= 4) this.attempted.delete(this.attempted.keys().next().value!);
    this.attempted.set(owner,now); this.running.set(owner,runId);
    const capturedAt = new Date(now).toISOString(); const deadline = AbortSignal.any([signal,AbortSignal.timeout(60000)]);
    try {
      const [mail,calendar] = await Promise.allSettled([this.gmail.read(request,capturedAt,deadline),this.calendars.refresh(request,range,deadline)]);
      signal.throwIfAborted();
      let gmail: SourceAttempt = { source: 'Gmail',status: 'error',items: [],errorCode: 'provider-unavailable' };
      let google: SourceAttempt = { source: 'GoogleCalendar',status: 'error',items: [],errorCode: 'provider-unavailable' };
      if (mail.status === 'fulfilled') {
        const result = mail.value;
        gmail = result.status === 'ok' ? { source: 'Gmail',status: 'ok',errorCode: null,items: [
          ...result.threads.map((thread): FeedItem => ({ type: 'thread',id: thread.id,title: thread.title,content: thread })),
          ...result.orders.map((order): FeedItem => ({ type: 'order_update',id: order.id,title: `${order.company} order ${order.orderNumber}`,content: order })),
        ] } : { ...gmail,errorCode: result.error || 'invalid-response' };
      }
      if (calendar.status === 'fulfilled') {
        const result = calendar.value;
        const identityTooLong = result.events.some((event) => `${event.calendarId}:${event.id}`.length > 256);
        google = result.status === 'complete' && result.freshness === 'fresh' && !result.issues.length && !identityTooLong
          ? { source: 'GoogleCalendar',status: 'ok',errorCode: null,items: result.events.map((event): FeedItem => {
            const id = `${event.calendarId}:${event.id}`;
            const startsAt = new Date('dateTime' in event.start ? event.start.dateTime : `${event.start.date}T00:00:00.000Z`).toISOString();
            const endsAt = new Date('dateTime' in event.end ? event.end.dateTime : `${event.end.date}T00:00:00.000Z`).toISOString();
            return { type: 'event',id,title: event.title,content: { ...event,type: 'event',id,providerEventId: event.id,calendarName: event.calendarName || event.calendarId,
              startsAt,endsAt,allDay: 'date' in event.start,location: event.location ?? null,status: event.status ?? 'confirmed' } };
          }) }
          : { ...google,errorCode: identityTooLong ? 'coverage-limit' : result.issues[0]?.kind || 'incomplete' };
      }
      gmail = boundedSource(gmail,capturedAt); google = boundedSource(google,capturedAt);
      await store.ingest({ runId,capturedAt,sources: [gmail,google] },signal);
      return { runId,state: 'completed',sources: [gmail,google].map((source) => ({ source: source.source,status: source.status,error: source.errorCode })) };
    } finally { this.running.delete(owner); }
  }
  static calendarConflicts(items: readonly FeedItem[]) {
    return timedConflicts(items.filter((item) => item.type === 'event').map((item) => item.content as unknown as CalendarEvent));
  }
}
