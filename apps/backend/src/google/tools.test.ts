import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentPrincipal } from '../auth/verify.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { ConversationHistoryPage, ConversationMessage, ConversationStore } from '../core/conversation-store.js';
import { coreModule } from '../core/index.js';
import type { ToolCallRecord } from '../core/tool-calls.js';
import { GoogleApiError, type GoogleApi, type GoogleApiClient, type GoogleApiRequest } from './api-client.js';
import { createGoogleModule } from './tools.js';
import { PendingGoogleActions } from './pending-actions.js';
import { resolveCalendarReply } from '../voice/realtime.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = { authorization: ['Bea', 'rer a.b.c'].join('') };
const agent: AgentPrincipal = {
  kind: 'jarvis-agent',
  objectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  tenantId: config.auth.tenantId,
};
const apps: ReturnType<typeof buildApp>[] = [];
const hotelEvents = [
  {
    subject: 'Hotel stay: Synthetic Hotel Alpha', startDateTime: '2027-06-14T15:00:00+02:00',
    endDateTime: '2027-06-15T11:00:00+02:00', attendees: [],
  },
  {
    subject: 'Hotel stay: Synthetic Hotel Beta', startDateTime: '2027-12-09T16:00:00+01:00',
    endDateTime: '2027-12-10T12:00:00+01:00', attendees: [],
  },
];

function conversationMessage(id: string, text: string, at = new Date()): ConversationMessage {
  return { id, sessionId: '1', role: 'dan', text, model: null, at };
}

function appFor(request: GoogleApiClient['request'], options: {
  readonly now?: () => Date;
  readonly pendingActions?: PendingGoogleActions;
} = {}) {
  let latest = conversationMessage('42', 'Create an event.');
  const store: ConversationStore = {
    createSession: async () => ({
      id: '1', channel: 'chat', language: 'en', startedAt: new Date(), endedAt: null,
    }),
    getSession: async () => null,
    endSession: async () => true,
    addMessage: async () => null,
    getHistory: async (): Promise<ConversationHistoryPage> => ({ messages: [latest], nextCursor: null }),
  };
  const records: ToolCallRecord[] = [];
  const api: GoogleApiClient = { request };
  const app = buildApp(config, undefined, {
    modules: [coreModule, createGoogleModule(api, {
      timeZone: 'Europe/Copenhagen',
      ...(options.now ? { now: options.now } : {}),
      ...(options.pendingActions ? { pendingActions: options.pendingActions } : {}),
    })],
    auth: async () => agent,
    conversationStore: store,
    toolCallStore: { record: async (call) => { records.push(call); } },
  });
  apps.push(app);
  return {
    app,
    records,
    setLatest: (message: ConversationMessage) => { latest = message; },
    latestText: () => latest.text,
  };
}

/** The route chat and voice share: the backend reads the latest Dan message and decides what it means. */
function calendarReplyRoute(
  app: ReturnType<typeof buildApp>,
  latestText: () => string,
  url = '/fixture/calendar-reply',
  signal: () => AbortSignal = () => new AbortController().signal,
) {
  app.post(url, { config: { jarvisAgent: true } }, async (req) => {
    const { output } = await resolveCalendarReply(app.jarvisTools, req, signal(), latestText());
    return JSON.parse(output ?? '{"outcome":"undecided"}');
  });
}

function confirmHeaders(id: string) {
  return { ...headers, 'x-jarvis-message-id': id };
}

function confirmMessage(setLatest: (message: ConversationMessage) => void) {
  setLatest(conversationMessage('43', 'approved', new Date(Date.now() + 10_000)));
}

function decodedMimeBody(raw: string): string {
  const mime = Buffer.from(raw, 'base64url').toString('utf8');
  const encodedBody = mime.split('\r\n\r\n').at(-1) ?? '';
  return Buffer.from(encodedBody.replaceAll('\r\n', ''), 'base64').toString('utf8');
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('Google Calendar and Gmail tools', () => {
  it('keeps an unmarked fixture route closed to agent identities before handler or provider execution', async () => {
    const request = vi.fn<GoogleApiClient['request']>(async () => ({ items: [] }));
    const { app } = appFor(request);
    const handler = vi.fn(async () => ({}));
    app.post('/fixture/calendar-agent-denied', handler);
    const response = await app.inject({
      method: 'POST', url: '/fixture/calendar-agent-denied', headers: confirmHeaders('42'), payload: {},
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Forbidden' });
    expect(handler).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('grounds a real read/stage/later-approval/repeated-yes flow in actual tool receipts', async () => {
    const request = vi.fn<GoogleApiClient['request']>(async (_api, _path, options) =>
      options.method === 'POST' ? { id: 'fixture-created-event' } : { items: [] });
    const { app, records, setLatest, latestText } = appFor(request);
    calendarReplyRoute(app, latestText);
    const reply = (id: string) => app.inject({
      method: 'POST', url: '/fixture/calendar-reply', headers: confirmHeaders(id), payload: {},
    });
    const read = await app.inject({
      method: 'POST', url: '/tools/calendar_list_events', headers: confirmHeaders('42'),
      payload: { start: '2027-12-09', end: '2027-12-10' },
    });
    expect(read.json()).toMatchObject({ outcome: 'ok', result: { events: [], timeZone: 'Europe/Copenhagen' } });
    const staged = (await app.inject({
      method: 'POST', url: '/tools/calendar_create_event', headers: confirmHeaders('42'),
      payload: {
        subject: 'Synthetic hotel reservation',
        startDateTime: '2027-12-09T16:00:00+01:00', endDateTime: '2027-12-10T12:00:00+01:00',
        attendees: ['guest@example.test'],
      },
    })).json();
    expect(staged).toMatchObject({ outcome: 'ok', result: {
      status: 'awaiting_confirmation', confirmationCode: expect.stringMatching(/^[0-9]{8}$/u),
      summary: 'Create "Synthetic hotel reservation" from 09 December 2027 at 16:00 to 10 December 2027 at 12:00 (Europe/Copenhagen local time); attendees: guest@example.test.',
    } });
    expect(request).toHaveBeenCalledOnce();
    expect(records[1]?.result).toEqual({ redacted: true });
    setLatest(conversationMessage('42', 'yes', new Date(Date.now() + 10_000)));
    expect((await reply('42')).json()).toMatchObject({ outcome: 'refused' });
    setLatest(conversationMessage('43', 'Is it created?', new Date(Date.now() + 11_000)));
    expect((await reply('43')).json()).toMatchObject({ result: {
      status: 'awaiting_confirmation', summary: staged.result.summary, reply: null,
    } });
    expect(request).toHaveBeenCalledOnce();
    setLatest(conversationMessage('44', 'go ahead', new Date(Date.now() + 12_000)));
    expect((await reply('44')).json()).toMatchObject({ outcome: 'ok', result: {
      status: 'completed', summary: staged.result.summary,
    } });
    expect(request).toHaveBeenLastCalledWith('calendar', '/calendars/primary/events', expect.objectContaining({
      method: 'POST', body: {
        summary: 'Synthetic hotel reservation',
        start: { dateTime: '2027-12-09T15:00:00.000Z', timeZone: 'UTC' },
        end: { dateTime: '2027-12-10T11:00:00.000Z', timeZone: 'UTC' },
        attendees: [{ email: 'guest@example.test' }],
      },
    }));
    setLatest(conversationMessage('45', 'yes', new Date(Date.now() + 13_000)));
    expect((await reply('45')).json()).toMatchObject({ outcome: 'ok', result: { status: 'none' } });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each(['expired', 'cancelled', 'provider-failed'] as const)(
    'does not repeat a write after an actual %s stage', async (state) => {
      let now = Date.now();
      const request = vi.fn<GoogleApiClient['request']>(async () => { throw new GoogleApiError('uncertain'); });
      const { app, setLatest, latestText } = appFor(request, { pendingActions: new PendingGoogleActions(() => now) });
      calendarReplyRoute(app, latestText);
      const stage = await app.inject({
        method: 'POST', url: '/tools/calendar_create_event', headers: confirmHeaders('42'),
        payload: { subject: 'Fixture', startDateTime: '2027-12-09T16:00:00+01:00', endDateTime: '2027-12-10T12:00:00+01:00' },
      });
      expect(stage.json().result.status).toBe('awaiting_confirmation');
      if (state === 'expired') now += 600_000;
      setLatest(conversationMessage('43', state === 'cancelled' ? 'no' : 'yes', new Date(now + 1)));
      const first = await app.inject({
        method: 'POST', url: '/fixture/calendar-reply', headers: confirmHeaders('43'), payload: {},
      });
      expect(first.json()).toMatchObject(state === 'provider-failed'
        ? { outcome: 'error' }
        : { outcome: 'ok', result: { status: state === 'expired' ? 'none' : 'cancelled' } });
      setLatest(conversationMessage('44', 'yes', new Date(now + 2)));
      const repeated = await app.inject({
        method: 'POST', url: '/fixture/calendar-reply', headers: confirmHeaders('44'), payload: {},
      });
      expect(repeated.json()).toMatchObject({ result: { status: 'none' } });
      expect(request).toHaveBeenCalledTimes(state === 'provider-failed' ? 1 : 0);
    },
  );

  it('makes read-only calendar tools reflex-safe and keeps their audit data sensitive', () => {
    const module = createGoogleModule(
      { request: vi.fn(async () => ({ items: [] })) },
      { timeZone: 'Europe/Copenhagen' },
    );
    for (const name of ['calendar_today_agenda', 'calendar_list_events', 'calendar_next_event']) {
      expect(module.tools.find((tool) => tool.name === name)).toMatchObject({
        reflexSafe: true,
        sensitive: true,
      });
    }
  });

  it('shows a reconnect message when Google credentials have expired', async () => {
    const request = vi.fn(async () => { throw new GoogleApiError('credentials-expired'); });
    const { app } = appFor(request);
    const response = await app.inject({
      method: 'POST',
      url: '/tools/calendar_today_agenda',
      headers: confirmHeaders('42'),
      payload: {},
    });
    expect(response.json()).toMatchObject({
      outcome: 'error',
      result: { error: 'Google credentials have expired. Dan must reconnect Google before using calendar or mail.' },
    });
  });

  it('reads the configured local calendar day across a daylight-saving boundary', async () => {
    const request = vi.fn(async () => ({ items: [] }));
    const { app } = appFor(request, { now: () => new Date('2026-03-29T12:00:00Z') });
    const response = await app.inject({
      method: 'POST',
      url: '/tools/calendar_today_agenda',
      headers: confirmHeaders('42'),
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().result).toMatchObject({
      timeZone: 'Europe/Copenhagen',
      events: [],
      truncated: false,
    });
    const path = request.mock.calls[0]?.[1] ?? '';
    const query = new URL(path, 'https://www.googleapis.com/calendar/v3').searchParams;
    expect(query.get('timeMin')).toBe('2026-03-28T23:00:00.000Z');
    expect(query.get('timeMax')).toBe('2026-03-29T22:00:00.000Z');
  });

  it('lists a local week across pages and maps text search to Google query', async () => {
    const request = vi.fn(async (...args: [GoogleApi, string, GoogleApiRequest]) => {
      const query = new URL(args[1], 'https://www.googleapis.com/calendar/v3').searchParams;
      return query.get('pageToken') === 'next-page'
        ? {
            items: [{
              id: 'event-2', summary: 'Dentist',
              start: { dateTime: '2026-10-08T08:00:00+02:00' },
              end: { dateTime: '2026-10-08T09:00:00+02:00' },
            }],
          }
        : {
            items: [{
              id: 'event-1', summary: 'Planning',
              start: { dateTime: '2026-10-05T10:00:00+02:00' },
              end: { dateTime: '2026-10-05T11:00:00+02:00' },
            }],
            nextPageToken: 'next-page',
          };
    });
    const { app, records } = appFor(request);
    const response = await app.inject({
      method: 'POST',
      url: '/tools/calendar_list_events',
      headers: confirmHeaders('42'),
      payload: { start: '2026-10-05', end: '2026-10-11', query: 'dentist', maxResults: 100 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result).toMatchObject({
      timeZone: 'Europe/Copenhagen',
      events: [
        { id: 'event-1', start: '2026-10-05T08:00:00.000Z' },
        { id: 'event-2', start: '2026-10-08T06:00:00.000Z' },
      ],
      truncated: false,
    });
    expect(request).toHaveBeenCalledTimes(2);
    const firstQuery = new URL(request.mock.calls[0]![1], 'https://www.googleapis.com/calendar/v3').searchParams;
    const secondQuery = new URL(request.mock.calls[1]![1], 'https://www.googleapis.com/calendar/v3').searchParams;
    expect(firstQuery.get('timeMin')).toBe('2026-10-04T22:00:00.000Z');
    expect(firstQuery.get('timeMax')).toBe('2026-10-11T22:00:00.000Z');
    expect(firstQuery.get('q')).toBe('dentist');
    expect(secondQuery.get('pageToken')).toBe('next-page');
    expect(records[0]).toMatchObject({
      arguments: { redacted: true },
      result: { redacted: true },
    });
  });

  it('returns no events for an empty range', async () => {
    const request = vi.fn(async () => ({ items: [] }));
    const { app } = appFor(request);
    const response = await app.inject({
      method: 'POST',
      url: '/tools/calendar_list_events',
      headers: confirmHeaders('42'),
      payload: { start: '2026-10-12', end: '2026-10-12' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().result).toMatchObject({ events: [], truncated: false });
  });

  it('refuses calendar ranges longer than 62 days before calling Google', async () => {
    const request = vi.fn(async () => ({ items: [] }));
    const { app } = appFor(request);
    const response = await app.inject({
      method: 'POST',
      url: '/tools/calendar_list_events',
      headers: confirmHeaders('42'),
      payload: { start: '2026-10-01', end: '2026-12-02' },
    });
    expect(response.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: 'The requested calendar range must be positive and no longer than 62 days.' },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves multi-day all-day event dates without converting them to UTC', async () => {
    const request = vi.fn(async () => ({
      items: [{
        id: 'holiday', summary: 'Holiday',
        start: { date: '2026-10-05' },
        end: { date: '2026-10-08' },
      }],
    }));
    const { app } = appFor(request);
    const response = await app.inject({
      method: 'POST',
      url: '/tools/calendar_list_events',
      headers: confirmHeaders('42'),
      payload: { start: '2026-10-05', end: '2026-10-08' },
    });
    expect(response.json().result.events).toEqual([{
      id: 'holiday',
      subject: 'Holiday',
      start: '2026-10-05',
      end: '2026-10-08',
      allDay: true,
    }]);
  });

  it('finds the next non-declined event on a later day', async () => {
    const request = vi.fn(async (...args: [GoogleApi, string, GoogleApiRequest]) => {
      const query = new URL(args[1], 'https://www.googleapis.com/calendar/v3').searchParams;
      return query.get('pageToken') === 'next-page'
        ? {
            items: [{
              id: 'next-event', summary: 'Planning',
              start: { dateTime: '2026-10-06T10:00:00+02:00' },
              end: { dateTime: '2026-10-06T11:00:00+02:00' },
            }],
          }
        : {
            items: [{
              id: 'declined', summary: 'Declined',
              start: { dateTime: '2026-10-05T15:00:00+02:00' },
              end: { dateTime: '2026-10-05T16:00:00+02:00' },
              attendees: [{ self: true, responseStatus: 'declined' }],
            }],
            nextPageToken: 'next-page',
          };
    });
    const { app } = appFor(request, { now: () => new Date('2026-10-05T12:00:00Z') });
    const response = await app.inject({
      method: 'POST',
      url: '/tools/calendar_next_event',
      headers: confirmHeaders('42'),
      payload: {},
    });

    expect(response.json().result).toMatchObject({
      timeZone: 'Europe/Copenhagen',
      event: { id: 'next-event', start: '2026-10-06T08:00:00.000Z' },
      truncated: false,
    });
    expect(request).toHaveBeenCalledTimes(2);
    const query = new URL(request.mock.calls[0]![1], 'https://www.googleapis.com/calendar/v3').searchParams;
    expect(query.get('timeMin')).toBe('2026-10-05T12:00:00.000Z');
    expect(query.get('timeMax')).toBe('2026-12-04T12:00:00.000Z');
  });

  it('reports additional calendar pages even when the first page is short', async () => {
    const request = vi.fn(async () => ({
      items: [{
        id: 'event-1',
        summary: 'Planning',
        start: { dateTime: '2026-10-05T10:00:00Z' },
        end: { dateTime: '2026-10-05T11:00:00Z' },
      }],
      nextPageToken: 'next-page',
    }));
    const { app } = appFor(request);
    const response = await app.inject({
      method: 'POST',
      url: '/tools/calendar_today_agenda',
      headers: confirmHeaders('42'),
      payload: {},
    });
    expect(response.json().result).toMatchObject({ truncated: true });
  });

  it('finds free slots around overlapping Google Calendar events', async () => {
    const request = vi.fn(async () => ({
      items: [
        {
          id: 'one', summary: 'One',
          start: { dateTime: '2026-10-05T10:00:00Z' },
          end: { dateTime: '2026-10-05T10:30:00Z' },
        },
        {
          id: 'two', summary: 'Two',
          start: { dateTime: '2026-10-05T10:20:00Z' },
          end: { dateTime: '2026-10-05T11:00:00Z' },
        },
      ],
    }));
    const { app } = appFor(request);
    const response = await app.inject({
      method: 'POST',
      url: '/tools/calendar_find_free_slots',
      headers: confirmHeaders('42'),
      payload: {
        startDateTime: '2026-10-05T09:00:00Z',
        endDateTime: '2026-10-05T12:00:00Z',
        durationMinutes: 30,
      },
    });
    expect(response.json().result.slots).toEqual([
      {
        start: '2026-10-05T09:00:00.000Z', end: '2026-10-05T10:00:00.000Z',
        startLocal: '05 October 2026 at 11:00', endLocal: '05 October 2026 at 12:00',
      },
      {
        start: '2026-10-05T11:00:00.000Z', end: '2026-10-05T12:00:00.000Z',
        startLocal: '05 October 2026 at 13:00', endLocal: '05 October 2026 at 14:00',
      },
    ]);
  });

  it('creates a calendar event only after a later short approval and redacts persisted data', async () => {
    const request = vi.fn(async () => ({}));
    const { app, records, setLatest } = appFor(request);
    const staged = await app.inject({
      method: 'POST',
      url: '/tools/calendar_create_event',
      headers: confirmHeaders('42'),
      payload: {
        subject: 'Private planning meeting',
        startDateTime: '2026-10-05T15:00:00+02:00',
        endDateTime: '2026-10-05T16:00:00+02:00',
        attendees: ['dan@example.com'],
      },
    });
    const code = staged.json().result.confirmationCode as string;

    expect(staged.json()).toMatchObject({ outcome: 'ok', result: { status: 'awaiting_confirmation' } });
    expect(request).not.toHaveBeenCalled();
    expect(records[0]).toMatchObject({
      arguments: { redacted: true },
      result: { redacted: true },
    });

    setLatest(conversationMessage('43', 'yes', new Date(Date.now() + 10_000)));
    const confirmed = await app.inject({
      method: 'POST',
      url: '/tools/calendar_confirm_change',
      headers: confirmHeaders('43'),
      payload: { confirmationCode: code },
    });
    expect(confirmed.json()).toMatchObject({ outcome: 'ok', result: { status: 'completed' } });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toBe('calendar');
    expect(request.mock.calls[0]?.[1]).toBe('/calendars/primary/events');
    expect(request.mock.calls[0]?.[2]).toMatchObject({
      method: 'POST',
      body: {
        summary: 'Private planning meeting',
        start: { dateTime: '2026-10-05T13:00:00.000Z', timeZone: 'UTC' },
        attendees: [{ email: 'dan@example.com' }],
      },
    });
  });

  describe('bounded multi-event proposals', () => {
    it('accepts the ten-event upper bound without executing anything before approval', async () => {
      const request = vi.fn<GoogleApiClient['request']>(async () => ({ id: 'synthetic-event' }));
      const { app, setLatest } = appFor(request);
      const events = Array.from({ length: 10 }, (_, index) => ({
        ...hotelEvents[0], subject: `Synthetic booking ${index + 1}`,
      }));
      const staged = (await app.inject({
        method: 'POST', url: '/tools/calendar_create_events', headers: confirmHeaders('42'),
        payload: { events },
      })).json();
      expect(staged.outcome).toBe('ok');
      expect(staged.result.items).toHaveLength(10);
      for (const event of events) expect(staged.result.summary).toContain(event.subject);
      expect(request).not.toHaveBeenCalled();
      confirmMessage(setLatest);
      const confirmed = (await app.inject({
        method: 'POST', url: '/tools/calendar_confirm_change', headers: confirmHeaders('43'),
        payload: { confirmationCode: staged.result.confirmationCode },
      })).json();
      expect(confirmed.result.status).toBe('completed');
      expect(confirmed.result.items).toHaveLength(10);
      expect(request).toHaveBeenCalledTimes(10);
    });

    it('stages both hotels immutably and creates exactly both after one later approval', async () => {
      const request = vi.fn<GoogleApiClient['request']>(async () => ({ id: 'synthetic-event' }));
      const { app, records, setLatest } = appFor(request);
      const staged = (await app.inject({
        method: 'POST', url: '/tools/calendar_create_events', headers: confirmHeaders('42'),
        payload: { events: hotelEvents },
      })).json();
      expect(staged).toMatchObject({ outcome: 'ok', result: {
        status: 'awaiting_confirmation', items: [
          { summary: expect.stringContaining('Synthetic Hotel Alpha') },
          { summary: expect.stringContaining('Synthetic Hotel Beta') },
        ],
      } });
      expect(staged.result.summary).toContain('14 June 2027 at 15:00');
      expect(staged.result.summary).toContain('09 December 2027 at 16:00');
      expect(staged.result.summary).toContain('Europe/Copenhagen local time');
      expect(staged.result.summary).toContain('attendees: none');
      expect(request).not.toHaveBeenCalled();
      setLatest(conversationMessage('42', 'approved', new Date(Date.now() + 10_000)));
      const confirm = (id: string) => app.inject({
        method: 'POST', url: '/tools/calendar_confirm_change', headers: confirmHeaders(id),
        payload: { confirmationCode: staged.result.confirmationCode },
      });
      expect((await confirm('42')).json().outcome).toBe('refused');
      expect(request).not.toHaveBeenCalled();
      confirmMessage(setLatest);
      const confirmed = (await confirm('43')).json();
      expect(confirmed).toMatchObject({ outcome: 'ok', result: {
        status: 'completed', summary: staged.result.summary,
        items: [{ status: 'completed' }, { status: 'completed' }],
      } });
      expect(request.mock.calls.map((call) => call[2].body)).toEqual([
        {
          summary: hotelEvents[0]!.subject,
          start: { dateTime: '2027-06-14T13:00:00.000Z', timeZone: 'UTC' },
          end: { dateTime: '2027-06-15T09:00:00.000Z', timeZone: 'UTC' },
        },
        {
          summary: hotelEvents[1]!.subject,
          start: { dateTime: '2027-12-09T15:00:00.000Z', timeZone: 'UTC' },
          end: { dateTime: '2027-12-10T11:00:00.000Z', timeZone: 'UTC' },
        },
      ]);
      expect((await confirm('43')).json().outcome).toBe('refused');
      setLatest(conversationMessage('44', 'yes', new Date(Date.now() + 11_000)));
      expect((await confirm('44')).json().outcome).toBe('refused');
      const recovered = (await app.inject({
        method: 'POST', url: '/tools/calendar_get_pending_change', headers: confirmHeaders('44'),
        payload: {},
      })).json();
      expect(recovered.result).toMatchObject({
        status: 'none', lastChange: { status: 'completed', summary: staged.result.summary },
      });
      expect(request).toHaveBeenCalledTimes(2);
      expect(records.every((record) => JSON.stringify(record.result) === '{"redacted":true}')).toBe(true);
    });

    it.each([
      [], [hotelEvents[0]], Array.from({ length: 11 }, () => hotelEvents[0]),
      [hotelEvents[0], { ...hotelEvents[1], endDateTime: '2026-11-01T00:00:00Z' }],
      [hotelEvents[0], { ...hotelEvents[1], attendees: ['not-an-email'] }],
      [hotelEvents[0], hotelEvents[0]],
    ])('validates every batch item before replacing any pending stage: %j', async (...events) => {
      const request = vi.fn<GoogleApiClient['request']>(async () => ({}));
      const { app } = appFor(request);
      const original = (await app.inject({
        method: 'POST', url: '/tools/calendar_create_event', headers: confirmHeaders('42'),
        payload: hotelEvents[0],
      })).json();
      const invalid = (await app.inject({
        method: 'POST', url: '/tools/calendar_create_events', headers: confirmHeaders('42'),
        payload: { events },
      })).json();
      expect(invalid.outcome).toBe('refused');
      const pending = (await app.inject({
        method: 'POST', url: '/tools/calendar_get_pending_change', headers: confirmHeaders('42'),
        payload: {},
      })).json();
      expect(pending.result.confirmationCode).toBe(original.result.confirmationCode);
      expect(request).not.toHaveBeenCalled();
    });

    it.each(['no', 'yes and move the second', 'Is it created?', 'expired', 'other-session'])(
      'does not execute a batch for %s', async (reply) => {
        let now = Date.now();
        const request = vi.fn<GoogleApiClient['request']>(async () => ({}));
        const { app, setLatest } = appFor(request, {
          pendingActions: new PendingGoogleActions(() => now),
        });
        const stage = (await app.inject({
          method: 'POST', url: '/tools/calendar_create_events', headers: confirmHeaders('42'),
          payload: { events: hotelEvents },
        })).json();
        if (reply === 'expired') now += 600_000;
        setLatest({
          ...conversationMessage('43', ['expired', 'other-session'].includes(reply) ? 'yes' : reply,
            new Date(now + 10_000)),
          sessionId: reply === 'other-session' ? '2' : '1',
        });
        const confirm = (await app.inject({
          method: 'POST', url: '/tools/calendar_confirm_change', headers: confirmHeaders('43'),
          payload: { confirmationCode: stage.result.confirmationCode },
        })).json();
        expect(confirm.outcome).toBe(reply === 'no' ? 'ok' : 'refused');
        if (reply === 'no') expect(confirm.result.items).toMatchObject([
          { status: 'cancelled' }, { status: 'cancelled' },
        ]);
        expect(request).not.toHaveBeenCalled();
      },
    );

    it.each(['forbidden', 'uncertain', 'unexpected'] as const)(
      'keeps the first success and reports %s second result without replaying either', async (kind) => {
        const request = vi.fn<GoogleApiClient['request']>()
          .mockResolvedValueOnce({ id: 'created-first' })
          .mockRejectedValueOnce(kind === 'unexpected' ? new Error('Synthetic failure') : new GoogleApiError(kind));
        const { app, setLatest } = appFor(request);
        const staged = (await app.inject({
          method: 'POST', url: '/tools/calendar_create_events', headers: confirmHeaders('42'),
          payload: { events: [...hotelEvents, {
            ...hotelEvents[1], subject: 'Another distinct synthetic event',
          }] },
        })).json();
        confirmMessage(setLatest);
        const confirm = () => app.inject({
          method: 'POST', url: '/tools/calendar_confirm_change', headers: confirmHeaders('43'),
          payload: { confirmationCode: staged.result.confirmationCode },
        });
        const response = (await confirm()).json();
        expect(response).toMatchObject({ outcome: 'ok', result: {
          status: 'partial', items: [
            { status: 'completed' },
            { status: kind === 'forbidden' ? 'failed' : 'unverified' },
            { status: 'not_attempted' },
          ],
        } });
        expect(response.confirmation).not.toContain('Done:');
        expect(response.result.detail).toContain('1 of 3');
        expect((await confirm()).json().outcome).toBe('refused');
        expect(request).toHaveBeenCalledTimes(2);
      },
    );

    it('stops before the next batch item when execution is cancelled', async () => {
      const abort = new AbortController();
      const request = vi.fn<GoogleApiClient['request']>(async () => {
        abort.abort();
        return { id: 'first-created' };
      });
      const { app, setLatest, latestText } = appFor(request);
      calendarReplyRoute(app, latestText, '/fixture/calendar-interruption', () => abort.signal);
      await app.inject({
        method: 'POST', url: '/tools/calendar_create_events', headers: confirmHeaders('42'),
        payload: { events: hotelEvents },
      });
      confirmMessage(setLatest);
      await app.inject({
        method: 'POST', url: '/fixture/calendar-interruption', headers: confirmHeaders('43'), payload: {},
      });
      const recovered = (await app.inject({
        method: 'POST', url: '/tools/calendar_get_pending_change', headers: confirmHeaders('43'),
        payload: {},
      })).json();
      expect(recovered.result).toMatchObject({ status: 'none', lastChange: {
        status: 'partial', items: [{ status: 'completed' }, { status: 'not_attempted' }],
      } });
      expect(request).toHaveBeenCalledOnce();
    });

  });

  it.each(['yes', 'no', 'yes and move it later'])('returns a tool refusal for %s without a pending calendar action', async (reply) => {
    const request = vi.fn<GoogleApiClient['request']>();
    const { app, setLatest } = appFor(request);
    setLatest(conversationMessage('43', reply, new Date(Date.now() + 10_000)));
    const response = await app.inject({
      method: 'POST', url: '/tools/calendar_confirm_change', headers: confirmHeaders('43'),
      payload: { confirmationCode: '12345678' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ outcome: 'refused', result: { refused: expect.stringContaining('No change was made') } });
    expect(request).not.toHaveBeenCalled();
  });

  it('cancels a staged calendar creation without writing to Google', async () => {
    const request = vi.fn<GoogleApiClient['request']>();
    const { app, setLatest } = appFor(request);
    const staged = await app.inject({
      method: 'POST', url: '/tools/calendar_create_event', headers: confirmHeaders('42'),
      payload: { subject: 'Meeting', startDateTime: '2026-06-23T10:00:00+02:00', endDateTime: '2026-06-23T11:00:00+02:00' },
    });
    expect(staged.json()).toMatchObject({ outcome: 'ok', result: { status: 'awaiting_confirmation' } });
    setLatest(conversationMessage('43', 'cancel', new Date(Date.now() + 10_000)));
    const response = await app.inject({
      method: 'POST', url: '/tools/calendar_confirm_change', headers: confirmHeaders('43'),
      payload: { confirmationCode: staged.json().result.confirmationCode },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ outcome: 'ok', result: { status: 'cancelled' } });
    expect(request).not.toHaveBeenCalled();
  });

  it('recovers the original staged code on a later approval after private history is redacted', async () => {
    const request = vi.fn(async () => ({}));
    const { app, records, setLatest } = appFor(request);
    const stage = await app.inject({
      method: 'POST', url: '/tools/calendar_create_event', headers: confirmHeaders('42'),
      payload: { subject: 'Synthetic Hotel Beta stay', startDateTime: '2027-06-14T15:00:00+02:00', endDateTime: '2027-06-17T11:00:00+02:00' },
    });
    expect(stage.json()).toMatchObject({ outcome: 'ok', result: { status: 'awaiting_confirmation' } });
    expect(records[0]?.result).toEqual({ redacted: true });
    expect(request).not.toHaveBeenCalled();
    setLatest(conversationMessage('43', 'go ahead', new Date(Date.now() + 10_000)));
    const recovered = await app.inject({
      method: 'POST', url: '/tools/calendar_get_pending_change', headers: confirmHeaders('43'), payload: {},
    });
    expect(recovered.json()).toMatchObject({ outcome: 'ok', result: {
      status: 'awaiting_confirmation', confirmationCode: stage.json().result.confirmationCode,
      summary: expect.stringContaining('Synthetic Hotel Beta stay'),
    } });
    expect(records[1]?.result).toEqual({ redacted: true });
    expect(request).not.toHaveBeenCalled();
    const confirmed = await app.inject({
      method: 'POST', url: '/tools/calendar_confirm_change', headers: confirmHeaders('43'),
      payload: { confirmationCode: recovered.json().result.confirmationCode },
    });
    expect(confirmed.json()).toMatchObject({ outcome: 'ok', result: { status: 'completed' } });
    const replay = await app.inject({
      method: 'POST', url: '/tools/calendar_confirm_change', headers: confirmHeaders('43'),
      payload: { confirmationCode: recovered.json().result.confirmationCode },
    });
    expect(replay.json().outcome).toBe('refused');
    expect(request).toHaveBeenCalledOnce();
    const consumed = await app.inject({
      method: 'POST', url: '/tools/calendar_get_pending_change', headers: confirmHeaders('43'), payload: {},
    });
    expect(consumed.json()).toMatchObject({ outcome: 'ok', result: { status: 'none' } });
  });

  it('cannot recover an unstaged, failed or unverified calendar change', async () => {
    const request = vi.fn(async () => ({}));
    const { app } = appFor(request);
    const invalid = await app.inject({
      method: 'POST', url: '/tools/calendar_create_event', headers: confirmHeaders('42'),
      payload: { subject: 'Stay', startDateTime: '2027-06-17T15:00:00Z', endDateTime: '2027-06-14T11:00:00Z' },
    });
    expect(invalid.json().outcome).toBe('refused');
    const recovered = await app.inject({
      method: 'POST', url: '/tools/calendar_get_pending_change', headers: confirmHeaders('42'), payload: {},
    });
    expect(recovered.json()).toMatchObject({ outcome: 'ok', result: { status: 'none' } });
    const unverified = await app.inject({
      method: 'POST', url: '/tools/calendar_get_pending_change', headers: confirmHeaders('43'), payload: {},
    });
    expect(unverified.json().outcome).toBe('refused');
    expect(request).not.toHaveBeenCalled();
  });

  it('moves a calendar event only after confirmation', async () => {
    const request = vi.fn(async (...args: [GoogleApi, string, GoogleApiRequest]) => args[1].includes('/events/event-1')
      ? {
          id: 'event-1',
          summary: 'Planning',
          start: { dateTime: '2026-10-04T13:00:00Z' },
          end: { dateTime: '2026-10-04T14:00:00Z' },
        }
      : {});
    const { app, setLatest } = appFor(request);
    const staged = await app.inject({
      method: 'POST',
      url: '/tools/calendar_move_event',
      headers: confirmHeaders('42'),
      payload: {
        eventId: 'event-1',
        startDateTime: '2026-10-05T15:00:00+02:00',
        endDateTime: '2026-10-05T16:00:00+02:00',
      },
    });
    const code = staged.json().result.confirmationCode as string;
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[2]).not.toHaveProperty('method');

    setLatest(conversationMessage('43', 'yes', new Date(Date.now() + 10_000)));
    const confirmed = await app.inject({
      method: 'POST',
      url: '/tools/calendar_confirm_change',
      headers: confirmHeaders('43'),
      payload: { confirmationCode: code },
    });
    expect(confirmed.json()).toMatchObject({ outcome: 'ok', result: { status: 'completed' } });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[2]).toMatchObject({
      method: 'PATCH',
      body: {
        start: { dateTime: '2026-10-05T13:00:00.000Z', timeZone: 'UTC' },
        end: { dateTime: '2026-10-05T14:00:00.000Z', timeZone: 'UTC' },
      },
    });
  });

  it('updates selected calendar event fields only after confirmation and redacts them', async () => {
    const request = vi.fn(async (...args: [GoogleApi, string, GoogleApiRequest]) =>
      args[2].method === undefined
        ? {
            id: 'event-1',
            summary: 'Planning',
            start: { dateTime: '2026-10-04T13:00:00Z' },
            end: { dateTime: '2026-10-04T14:00:00Z' },
          }
        : {});
    const { app, records, setLatest } = appFor(request);
    const staged = await app.inject({
      method: 'POST',
      url: '/tools/calendar_update_event',
      headers: confirmHeaders('42'),
      payload: {
        eventId: 'event-1',
        title: 'Private project review',
        startDateTime: '2026-10-05T15:00:00+02:00',
        endDateTime: '2026-10-05T16:00:00+02:00',
        location: 'Private room',
        attendees: ['dan@example.com'],
        description: 'PRIVATE CALENDAR DESCRIPTION',
      },
    });
    const code = staged.json().result.confirmationCode as string;

    expect(staged.json()).toMatchObject({ outcome: 'ok', result: { status: 'awaiting_confirmation' } });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[2]).not.toHaveProperty('method');
    expect(records[0]).toMatchObject({
      arguments: { redacted: true },
      result: { redacted: true },
    });
    expect(JSON.stringify(records)).not.toContain('PRIVATE CALENDAR DESCRIPTION');

    setLatest(conversationMessage('43', 'yes', new Date(Date.now() + 10_000)));
    const confirmed = await app.inject({
      method: 'POST',
      url: '/tools/calendar_confirm_change',
      headers: confirmHeaders('43'),
      payload: { confirmationCode: code },
    });

    expect(confirmed.json()).toMatchObject({ outcome: 'ok', result: { status: 'completed' } });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[2]).toMatchObject({
      method: 'PATCH',
      body: {
        summary: 'Private project review',
        start: { dateTime: '2026-10-05T13:00:00.000Z', timeZone: 'UTC' },
        end: { dateTime: '2026-10-05T14:00:00.000Z', timeZone: 'UTC' },
        location: 'Private room',
        attendees: [{ email: 'dan@example.com' }],
        description: 'PRIVATE CALENDAR DESCRIPTION',
      },
    });
  });

  it('allows clearing calendar location and attendees with empty values', async () => {
    const request = vi.fn(async (...args: [GoogleApi, string, GoogleApiRequest]) =>
      args[2].method === undefined
        ? {
            id: 'event-1',
            summary: 'Planning',
            start: { dateTime: '2026-10-04T13:00:00Z' },
            end: { dateTime: '2026-10-04T14:00:00Z' },
          }
        : {});
    const { app, records, setLatest } = appFor(request);
    const staged = await app.inject({
      method: 'POST',
      url: '/tools/calendar_update_event',
      headers: confirmHeaders('42'),
      payload: { eventId: 'event-1', location: '', attendees: [] },
    });
    const code = staged.json().result.confirmationCode as string;
    expect(staged.json()).toMatchObject({ outcome: 'ok', result: { status: 'awaiting_confirmation' } });
    expect(request).toHaveBeenCalledOnce();
    setLatest(conversationMessage('43', 'yes', new Date(Date.now() + 10_000)));
    const confirmed = await app.inject({
      method: 'POST',
      url: '/tools/calendar_confirm_change',
      headers: confirmHeaders('43'),
      payload: { confirmationCode: code },
    });
    expect(confirmed.json()).toMatchObject({ outcome: 'ok', result: { status: 'completed' } });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[2]).toMatchObject({
      method: 'PATCH',
      body: { location: '', attendees: [] },
    });
    expect(records[0]).toMatchObject({
      arguments: { redacted: true },
      result: { redacted: true },
    });
  });

  it('refuses calendar time updates unless both endpoints are supplied', async () => {
    const request = vi.fn(async () => ({}));
    const { app } = appFor(request);
    const response = await app.inject({
      method: 'POST',
      url: '/tools/calendar_update_event',
      headers: confirmHeaders('42'),
      payload: { eventId: 'event-1', startDateTime: '2026-10-05T15:00:00Z' },
    });
    expect(response.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: 'startDateTime and endDateTime must be provided together.' },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('deletes a calendar event only after confirmation', async () => {
    const request = vi.fn(async (...args: [GoogleApi, string, GoogleApiRequest]) =>
      args[2].method === undefined ? { id: 'event/1', summary: 'Planning' } : {});
    const { app, records, setLatest } = appFor(request);
    const staged = await app.inject({
      method: 'POST',
      url: '/tools/calendar_delete_event',
      headers: confirmHeaders('42'),
      payload: { eventId: 'event/1' },
    });
    const code = staged.json().result.confirmationCode as string;

    expect(staged.json()).toMatchObject({ outcome: 'ok', result: { status: 'awaiting_confirmation' } });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[1]).toBe('/calendars/primary/events/event%2F1');
    expect(records[0]).toMatchObject({
      arguments: { redacted: true },
      result: { redacted: true },
    });

    setLatest(conversationMessage('43', 'yes', new Date(Date.now() + 10_000)));
    const confirmed = await app.inject({
      method: 'POST',
      url: '/tools/calendar_confirm_change',
      headers: confirmHeaders('43'),
      payload: { confirmationCode: code },
    });

    expect(confirmed.json()).toMatchObject({ outcome: 'ok', result: { status: 'completed' } });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[1]).toBe('/calendars/primary/events/event%2F1');
    expect(request.mock.calls[1]?.[2]).toMatchObject({ method: 'DELETE' });
  });

  it('sends mail only after confirmation and never persists the message body', async () => {
    const request = vi.fn(async () => ({}));
    const { app, records, setLatest } = appFor(request);
    const body = 'PRIVATE EMAIL CONTENT';
    const staged = await app.inject({
      method: 'POST',
      url: '/tools/mail_send',
      headers: confirmHeaders('42'),
      payload: { to: ['dan@example.com'], subject: 'Private subject', body },
    });

    const code = staged.json().result.confirmationCode as string;
    expect(request).not.toHaveBeenCalled();
    expect(records[0]).toMatchObject({
      arguments: { redacted: true },
      result: { redacted: true },
    });
    expect(JSON.stringify(records)).not.toContain(body);

    confirmMessage(setLatest);
    const confirmed = await app.inject({
      method: 'POST',
      url: '/tools/mail_confirm_action',
      headers: confirmHeaders('43'),
      payload: { confirmationCode: code },
    });
    expect(confirmed.json()).toMatchObject({ outcome: 'ok', result: { status: 'completed' } });
    expect(request).toHaveBeenCalledOnce();
    const raw = request.mock.calls[0]?.[2]?.body as { raw: string };
    expect(request.mock.calls[0]?.[0]).toBe('gmail');
    expect(request.mock.calls[0]?.[1]).toBe('/users/me/messages/send');
    expect(decodedMimeBody(raw.raw)).toContain(body);
  });

  it('rejects mailbox-list syntax in recipient addresses', async () => {
    const request = vi.fn(async () => ({}));
    const { app } = appFor(request);
    const response = await app.inject({
      method: 'POST',
      url: '/tools/mail_send',
      headers: confirmHeaders('42'),
      payload: { to: ['first,second@example.com'], subject: 'Test', body: 'Message' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ outcome: 'refused', result: { refused: expect.stringContaining('Invalid arguments:') } });
    expect(request).not.toHaveBeenCalled();
  });

  it('searches Gmail with bounded content and redacts persisted message details', async () => {
    const body = 'PRIVATE GMAIL BODY '.repeat(500);
    const request = vi.fn(async (...args: [GoogleApi, string, GoogleApiRequest]) =>
      args[1] === '/users/me/messages?q=planning&maxResults=5'
        ? { messages: [{ id: 'message-1' }], nextPageToken: 'next-page' }
        : {
            id: 'message-1',
            internalDate: '9999999999999999',
            snippet: 'short preview',
            payload: {
              headers: [
                { name: 'Subject', value: 'Private subject' },
                { name: 'From', value: 'Sender <sender@example.com>' },
              ],
              mimeType: 'text/plain',
              body: { data: Buffer.from(body).toString('base64url') },
            },
          });
    const { app, records } = appFor(request);
    const response = await app.inject({
      method: 'POST',
      url: '/tools/mail_search',
      headers: confirmHeaders('42'),
      payload: { query: 'planning' },
    });
    expect(response.json().result.messages[0].body).toHaveLength(6000);
    expect(response.json().result.messages[0].from.address).toBe('sender@example.com');
    expect(response.json().result.messages[0].receivedDateTime).toBe('');
    expect(response.json().result.truncated).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(records[0]).toMatchObject({
      arguments: { redacted: true },
      result: { redacted: true },
    });
    expect(JSON.stringify(records)).not.toContain('PRIVATE GMAIL BODY');
  });

  it('returns booking dates from HTML alternatives with explicit extraction status and a redacted audit', async () => {
    const request = vi.fn<GoogleApiClient['request']>(async (_api, path) => path.includes('?q=')
      ? { messages: [{ id: 'reservation' }] }
      : { id: 'reservation', snippet: 'Booking confirmed', payload: {
        mimeType: 'multipart/alternative', parts: [
          { mimeType: 'text/plain', body: { data: Buffer.from('Thank you for booking.').toString('base64url') } },
          { mimeType: 'text/html', body: { data: Buffer.from('<p>Synthetic Hotel Beta</p><p>Check-in 14 June 2027</p><p>Check-out 17 June 2027</p>').toString('base64url') } },
        ],
      } });
    const { app, records } = appFor(request);
    const result = await app.inject({ method: 'POST', url: '/tools/mail_search', headers: confirmHeaders('42'), payload: { query: 'Synthetic Hotel Beta' } });
    expect(result.json()).toMatchObject({ outcome: 'ok', result: { messages: [{
      body: 'Thank you for booking.', bodySource: 'plain-text', bodyTruncated: false,
      alternateBody: 'Synthetic Hotel Beta Check-in 14 June 2027 Check-out 17 June 2027',
      alternateBodyTruncated: false, contentWarnings: [],
    }] } });
    expect(records[0]).toMatchObject({ arguments: { redacted: true }, result: { redacted: true } });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('reports snippet-only booking extraction as incomplete', async () => {
    const request = vi.fn<GoogleApiClient['request']>(async (_api, path) => path.includes('?q=')
      ? { messages: [{ id: 'reservation' }] } : { snippet: 'Booking confirmed', payload: { mimeType: 'text/html', body: {} } });
    const { app } = appFor(request);
    const result = await app.inject({ method: 'POST', url: '/tools/mail_search', headers: confirmHeaders('42'), payload: { query: 'Synthetic Hotel Beta' } });
    expect(result.json()).toMatchObject({ outcome: 'ok', result: { messages: [{
      body: 'Booking confirmed', bodySource: 'snippet', contentWarnings: expect.arrayContaining([
        'Full message text is unavailable; a preview cannot establish missing reservation details.',
      ]),
    }] } });
  });

  it('lists bounded Gmail drafts with plain-text content', async () => {
    const body = 'PRIVATE DRAFT BODY';
    const request = vi.fn(async (...args: [GoogleApi, string, GoogleApiRequest]) =>
      args[1] === '/users/me/drafts?maxResults=5'
        ? { drafts: [{ id: 'draft-1', message: { id: 'message-1', threadId: 'thread-1' } }] }
        : {
            id: 'message-1',
            payload: {
              headers: [
                { name: 'To', value: 'dan@example.com' },
                { name: 'Subject', value: 'Private draft' },
              ],
              mimeType: 'text/plain',
              body: { data: Buffer.from(body).toString('base64url') },
            },
          });
    const { app, records } = appFor(request);
    const response = await app.inject({
      method: 'POST',
      url: '/tools/mail_list_drafts',
      headers: confirmHeaders('42'),
      payload: {},
    });

    expect(response.json().result).toEqual({
      drafts: [{
        draftId: 'draft-1',
        messageId: 'message-1',
        threadId: 'thread-1',
        to: 'dan@example.com',
        subject: 'Private draft',
        body,
        bodySource: 'plain-text',
        bodyTruncated: false,
        contentWarnings: [],
      }],
      truncated: false,
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(records[0]).toMatchObject({
      arguments: { redacted: true },
      result: { redacted: true },
    });
    expect(JSON.stringify(records)).not.toContain(body);
  });

  it('replaces a Gmail draft only after confirmation and preserves reply threading', async () => {
    const request = vi.fn(async (...args: [GoogleApi, string, GoogleApiRequest]) =>
      args[1] === '/users/me/drafts/draft-1?format=full'
        ? {
            id: 'draft-1',
            message: {
              id: 'message-1',
              threadId: 'thread-1',
              payload: { headers: [
                { name: 'Subject', value: 'Old subject' },
                { name: 'Message-ID', value: '<message@example.com>' },
              ] },
            },
          }
        : {});
    const { app, records, setLatest } = appFor(request);
    const staged = await app.inject({
      method: 'POST',
      url: '/tools/mail_update_draft',
      headers: confirmHeaders('42'),
      payload: {
        draftId: 'draft-1',
        to: ['dan@example.com'],
        subject: 'Updated subject',
        body: 'Updated draft text',
      },
    });
    const code = staged.json().result.confirmationCode as string;

    expect(staged.json()).toMatchObject({ outcome: 'ok', result: { status: 'awaiting_confirmation' } });
    expect(request).toHaveBeenCalledOnce();
    expect(records[0]).toMatchObject({
      arguments: { redacted: true },
      result: { redacted: true },
    });
    expect(JSON.stringify(records)).not.toContain('Updated draft text');

    confirmMessage(setLatest);
    const confirmed = await app.inject({
      method: 'POST',
      url: '/tools/mail_confirm_action',
      headers: confirmHeaders('43'),
      payload: { confirmationCode: code },
    });

    expect(confirmed.json()).toMatchObject({ outcome: 'ok', result: { status: 'completed' } });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[1]).toBe('/users/me/drafts/draft-1');
    expect(request.mock.calls[1]?.[2]).toMatchObject({
      method: 'PUT',
      body: { message: { threadId: 'thread-1' } },
    });
    const updateBody = request.mock.calls[1]?.[2]?.body as {
      message: { raw: string };
    };
    expect(decodedMimeBody(updateBody.message.raw)).toContain('Updated draft text');
  });

  it('refuses to replace a Gmail draft that has attachments or CC/BCC recipients', async () => {
    const request = vi.fn(async () => ({
      id: 'draft-1',
      message: {
        id: 'message-1',
        payload: {
          headers: [{ name: 'Subject', value: 'With attachment' }],
          parts: [{ filename: 'report.pdf', body: { attachmentId: 'attachment-1' } }],
        },
      },
    }));
    const { app } = appFor(request);
    const response = await app.inject({
      method: 'POST',
      url: '/tools/mail_update_draft',
      headers: confirmHeaders('42'),
      payload: {
        draftId: 'draft-1',
        to: ['dan@example.com'],
        subject: 'Updated subject',
        body: 'Updated draft text',
      },
    });

    expect(response.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: 'This draft has CC, BCC, or attachments and cannot be safely replaced.' },
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it('deletes a Gmail draft only after confirmation', async () => {
    const request = vi.fn(async (...args: [GoogleApi, string, GoogleApiRequest]) =>
      args[2].method === 'DELETE' ? {} : {
        id: 'draft-1',
        message: { id: 'message-1', payload: { headers: [{ name: 'Subject', value: 'Private draft' }] } },
      });
    const { app, records, setLatest } = appFor(request);
    const staged = await app.inject({
      method: 'POST',
      url: '/tools/mail_delete_draft',
      headers: confirmHeaders('42'),
      payload: { draftId: 'draft-1' },
    });
    const code = staged.json().result.confirmationCode as string;

    expect(staged.json()).toMatchObject({ outcome: 'ok', result: { status: 'awaiting_confirmation' } });
    expect(request).toHaveBeenCalledOnce();
    expect(records[0]).toMatchObject({
      arguments: { redacted: true },
      result: { redacted: true },
    });

    confirmMessage(setLatest);
    const confirmed = await app.inject({
      method: 'POST',
      url: '/tools/mail_confirm_action',
      headers: confirmHeaders('43'),
      payload: { confirmationCode: code },
    });

    expect(confirmed.json()).toMatchObject({ outcome: 'ok', result: { status: 'completed' } });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[1]).toBe('/users/me/drafts/draft-1');
    expect(request.mock.calls[1]?.[2]).toMatchObject({ method: 'DELETE' });
  });

  it('archives a Gmail message only after confirmation', async () => {
    const request = vi.fn(async () => ({}));
    const { app, setLatest } = appFor(request);
    const staged = await app.inject({
      method: 'POST',
      url: '/tools/mail_archive',
      headers: confirmHeaders('42'),
      payload: { messageId: 'message-1' },
    });
    const code = staged.json().result.confirmationCode as string;

    expect(request).not.toHaveBeenCalled();
    confirmMessage(setLatest);
    const confirmed = await app.inject({
      method: 'POST',
      url: '/tools/mail_confirm_action',
      headers: confirmHeaders('43'),
      payload: { confirmationCode: code },
    });

    expect(confirmed.json()).toMatchObject({ outcome: 'ok', result: { status: 'completed' } });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[1]).toBe('/users/me/messages/message-1/modify');
    expect(request.mock.calls[0]?.[2]).toMatchObject({
      method: 'POST',
      body: { removeLabelIds: ['INBOX'] },
    });
  });

  it('adds and removes named Gmail labels only after confirmation', async () => {
    const request = vi.fn(async (...args: [GoogleApi, string, GoogleApiRequest]) =>
      args[1] === '/users/me/labels'
        ? { labels: [{ id: 'Label_1', name: 'Work' }, { id: 'Label_2', name: 'Later' }] }
        : {});
    const { app, setLatest } = appFor(request);
    const staged = await app.inject({
      method: 'POST',
      url: '/tools/mail_label',
      headers: confirmHeaders('42'),
      payload: { messageId: 'message-1', add: ['Work'], remove: ['Later'] },
    });
    const code = staged.json().result.confirmationCode as string;

    expect(staged.json()).toMatchObject({ outcome: 'ok', result: { status: 'awaiting_confirmation' } });
    expect(request).toHaveBeenCalledOnce();
    confirmMessage(setLatest);
    const confirmed = await app.inject({
      method: 'POST',
      url: '/tools/mail_confirm_action',
      headers: confirmHeaders('43'),
      payload: { confirmationCode: code },
    });

    expect(confirmed.json()).toMatchObject({ outcome: 'ok', result: { status: 'completed' } });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[1]).toBe('/users/me/messages/message-1/modify');
    expect(request.mock.calls[1]?.[2]).toMatchObject({
      method: 'POST',
      body: { addLabelIds: ['Label_1'], removeLabelIds: ['Label_2'] },
    });
  });

  it('creates a Gmail reply draft only after confirmation', async () => {
    const request = vi.fn(async (...args: [GoogleApi, string, GoogleApiRequest]) => args[1].includes('/messages/message-1')
      ? {
          id: 'message-1',
          threadId: 'thread-1',
          payload: { headers: [
            { name: 'Subject', value: 'Meeting' },
            { name: 'From', value: 'Sender <sender@example.com>' },
            { name: 'Message-ID', value: '<message@example.com>' },
          ] },
        }
      : {});
    const { app, setLatest } = appFor(request);
    const staged = await app.inject({
      method: 'POST',
      url: '/tools/mail_draft_reply',
      headers: confirmHeaders('42'),
      payload: { messageId: 'message-1', replyBody: 'Hello, I can attend.' },
    });
    const code = staged.json().result.confirmationCode as string;
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[1]).toContain('/users/me/messages/message-1');

    confirmMessage(setLatest);
    const confirmed = await app.inject({
      method: 'POST',
      url: '/tools/mail_confirm_action',
      headers: confirmHeaders('43'),
      payload: { confirmationCode: code },
    });
    expect(confirmed.json()).toMatchObject({ outcome: 'ok', result: { status: 'completed' } });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[1]).toBe('/users/me/drafts');
    const draftBody = request.mock.calls[1]?.[2]?.body as {
      message: { raw: string; threadId: string };
    };
    expect(draftBody.message.threadId).toBe('thread-1');
    expect(decodedMimeBody(draftBody.message.raw)).toContain('Hello, I can attend.');
  });
});

describe('Gmail incomplete list responses', () => {
  it.each([{ messages: 'invalid' }, { messages: [{}] }, { nextPageToken: 'missing-page' }, { resultSizeEstimate: 1 }])(
    'reports malformed message lists as failures: %j', async (listing) => {
      const request = vi.fn(async () => listing);
      const { app } = appFor(request);
      const response = await app.inject({
        method: 'POST', url: '/tools/mail_search', headers: confirmHeaders('42'), payload: { query: 'reservation' },
      });
      expect(response.json()).toMatchObject({ outcome: 'error', result: {
        error: 'Gmail returned an invalid message list. Direct mail access is incomplete.',
      } });
      expect(request).toHaveBeenCalledOnce();
    },
  );
});
