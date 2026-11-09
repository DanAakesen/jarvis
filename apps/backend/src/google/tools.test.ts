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
    readRecentUserMessages: async () => [],
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

function confirmHeaders(id: string) {
  return { ...headers, 'x-jarvis-message-id': id };
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

  describe('bounded multi-event proposals', () => {

    it.each([
      [], [hotelEvents[0]], Array.from({ length: 11 }, () => hotelEvents[0]),
      [hotelEvents[0], { ...hotelEvents[1], endDateTime: '2026-11-01T00:00:00Z' }],
      [hotelEvents[0], { ...hotelEvents[1], attendees: ['not-an-email'] }],
      [hotelEvents[0], hotelEvents[0]],
    ])('validates the complete batch before any provider write: %j', async (...events) => {
      const request = vi.fn<GoogleApiClient['request']>(async () => ({}));
      const { app } = appFor(request);
      const invalid = (await app.inject({
        method: 'POST', url: '/tools/calendar_create_events', headers: confirmHeaders('42'),
        payload: { events },
      })).json();
      expect(invalid.outcome).toBe('refused');
      expect(request).not.toHaveBeenCalled();
    });

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

describe('Phone calendar events route', () => {
  const dan = { objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan' };

  function dayApp(request: GoogleApiClient['request']) {
    const app = buildApp(config, undefined, {
      modules: [coreModule, createGoogleModule({ request }, {
        timeZone: 'Europe/Copenhagen', now: () => new Date('2027-03-10T10:00:00Z'),
      })],
      auth: async () => dan,
    });
    apps.push(app);
    return app;
  }

  it('returns the primary calendar events for the requested window in the app shape', async () => {
    const request = vi.fn<GoogleApiClient['request']>(async () => ({
      items: [
        { id: 'a', summary: 'Dentist', start: { dateTime: '2027-03-10T09:00:00+01:00' }, end: { dateTime: '2027-03-10T10:00:00+01:00' }, location: 'Clinic' },
        { id: 'b', summary: 'Holiday', start: { date: '2027-03-10' }, end: { date: '2027-03-11' } },
      ],
    }));
    const response = await dayApp(request).inject({
      method: 'GET', url: '/calendar/events?from=2027-03-10T00:00:00Z&to=2027-03-11T00:00:00Z', headers,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.events).toHaveLength(2);
    expect(body.events[0]).toMatchObject({ id: 'a', subject: 'Dentist', location: 'Clinic' });
    expect(body.events[1]).toMatchObject({ id: 'b', allDay: true });
    const path = String(request.mock.calls[0]?.[1]);
    expect(path).toContain('/calendars/primary/events');
    expect(path).toContain('timeMin=2027-03-10T00%3A00%3A00.000Z');
    expect(path).not.toContain('calendarList');
  });

  it('defaults to today and rejects a bad or oversized window', async () => {
    const request = vi.fn<GoogleApiClient['request']>(async () => ({ items: [] }));
    const app = dayApp(request);
    expect((await app.inject({ method: 'GET', url: '/calendar/events', headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/calendar/events?from=tomorrow', headers })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'GET', url: '/calendar/events?from=2027-01-01T00:00:00Z&to=2027-06-01T00:00:00Z', headers,
    })).statusCode).toBe(400);
  });

  it('reports a Google failure as a bad gateway and keeps agent identities out', async () => {
    const failing = vi.fn<GoogleApiClient['request']>(async () => { throw new GoogleApiError('forbidden', 403); });
    expect((await dayApp(failing).inject({ method: 'GET', url: '/calendar/events', headers })).statusCode).toBe(502);
    const { app } = appFor(vi.fn<GoogleApiClient['request']>(async () => ({ items: [] })));
    expect((await app.inject({ method: 'GET', url: '/calendar/events', headers })).statusCode).toBe(403);
  });
});

describe('direct owner Google actions', () => {
  it.each([
    ['calendar_create_event', hotelEvents[0], 'POST'],
    ['calendar_update_event', { eventId: 'event-1', title: 'Updated' }, 'PATCH'],
    ['calendar_move_event', { eventId: 'event-1', startDateTime: hotelEvents[0].startDateTime, endDateTime: hotelEvents[0].endDateTime }, 'PATCH'],
    ['calendar_delete_event', { eventId: 'event-1' }, 'DELETE'],
    ['mail_archive', { messageId: 'message-1' }, 'POST'],
    ['mail_delete_draft', { draftId: 'draft-1' }, 'DELETE'],
    ['mail_send', { to: ['dan@example.com'], subject: 'Requested message', body: 'Synthetic body' }, 'POST'],
  ] as const)('executes %s once from the original owner request and redacts stored data', async (name, payload, method) => {
    const request = vi.fn<GoogleApiClient['request']>(async (_api, path, options) => {
      if (options?.method && options.method !== 'GET') return {};
      if (path.includes('/drafts/')) return { id: 'draft-1', message: { id: 'message-1', payload: { headers: [] } } };
      return { id: 'event-1', summary: 'Existing', start: { dateTime: '2027-01-01T12:00:00Z' }, end: { dateTime: '2027-01-01T13:00:00Z' } };
    });
    const { app, records } = appFor(request);
    const call = () => app.inject({ method: 'POST', url: `/tools/${name}`, headers: confirmHeaders('42'), payload });
    expect((await call()).json()).toMatchObject({ outcome: 'ok', result: { status: 'completed' } });
    expect((await call()).json()).toMatchObject({ outcome: 'ok', result: { status: 'completed' } });
    expect(request.mock.calls.filter(([, , options]) => options?.method === method)).toHaveLength(1);
    expect(records[0]).toMatchObject({ arguments: { redacted: true }, result: { redacted: true } });
  });

  it('sends the requested exact recipients and body without another turn', async () => {
    const request = vi.fn<GoogleApiClient['request']>(async () => ({}));
    const { app } = appFor(request);
    await app.inject({ method: 'POST', url: '/tools/mail_send', headers: confirmHeaders('42'),
      payload: { to: ['dan@example.com'], subject: 'Test', body: 'Exact body\nSecond line' } });
    const body = request.mock.calls[0]?.[2]?.body as { raw: string };
    expect(decodedMimeBody(body.raw)).toBe('Exact body\nSecond line');
  });

  it.each(['calendar_create_event', 'mail_send'])('requires verified owner provenance for %s', async (name) => {
    const request = vi.fn<GoogleApiClient['request']>(async () => ({}));
    const { app } = appFor(request);
    const payload = name === 'mail_send' ? { to: ['dan@example.com'], subject: 'Test', body: 'Test' } : hotelEvents[0];
    const response = await app.inject({ method: 'POST', url: `/tools/${name}`, headers: confirmHeaders('999'), payload });
    expect(response.json().outcome).toBe('refused');
    expect(request).not.toHaveBeenCalled();
  });

  it('creates the full requested batch and never repeats its writes on a duplicate call', async () => {
    const request = vi.fn<GoogleApiClient['request']>(async () => ({}));
    const { app } = appFor(request);
    const call = () => app.inject({ method: 'POST', url: '/tools/calendar_create_events', headers: confirmHeaders('42'), payload: { events: hotelEvents } });
    expect((await call()).json()).toMatchObject({ outcome: 'ok', result: { status: 'completed', items: [{ status: 'completed' }, { status: 'completed' }] } });
    await call();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each(['forbidden', 'uncertain'] as const)('preserves partial results and does not replay a %s batch', async (kind) => {
    const request = vi.fn<GoogleApiClient['request']>().mockResolvedValueOnce({}).mockRejectedValueOnce(new GoogleApiError(kind));
    const { app } = appFor(request);
    const call = () => app.inject({ method: 'POST', url: '/tools/calendar_create_events', headers: confirmHeaders('42'), payload: { events: hotelEvents } });
    const first = (await call()).json();
    expect(first).toMatchObject({ outcome: 'ok', result: { status: 'partial', items: [
      { status: 'completed' }, { status: kind === 'uncertain' ? 'unverified' : 'failed' },
    ] } });
    expect((await call()).json().result).toEqual(first.result);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('retains an uncertain send result so a duplicate call cannot send twice', async () => {
    const request = vi.fn<GoogleApiClient['request']>(async () => { throw new GoogleApiError('uncertain'); });
    const { app } = appFor(request);
    const call = () => app.inject({ method: 'POST', url: '/tools/mail_send', headers: confirmHeaders('42'),
      payload: { to: ['dan@example.com'], subject: 'Test', body: 'Test' } });
    expect((await call()).json().outcome).toBe('error');
    expect((await call()).json().outcome).toBe('error');
    expect(request).toHaveBeenCalledOnce();
  });
});
