import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentPrincipal } from '../auth/verify.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { ConversationHistoryPage, ConversationMessage, ConversationStore } from '../core/conversation-store.js';
import { coreModule } from '../core/index.js';
import type { ToolCallRecord } from '../core/tool-calls.js';
import { GoogleApiError, type GoogleApi, type GoogleApiClient, type GoogleApiRequest } from './api-client.js';
import { createGoogleModule } from './tools.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = { authorization: ['Bea', 'rer a.b.c'].join('') };
const agent: AgentPrincipal = {
  kind: 'jarvis-agent',
  objectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  tenantId: config.auth.tenantId,
};
const apps: ReturnType<typeof buildApp>[] = [];

function conversationMessage(id: string, text: string, at = new Date()): ConversationMessage {
  return { id, sessionId: '1', role: 'dan', text, model: null, at };
}

function appFor(request: GoogleApiClient['request'], options: { readonly now?: () => Date } = {}) {
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
  };
}

function confirmHeaders(id: string) {
  return { ...headers, 'x-jarvis-message-id': id };
}

function confirmMessage(setLatest: (message: ConversationMessage) => void, code: string) {
  setLatest(conversationMessage('43', `confirm ${code}`, new Date(Date.now() + 10_000)));
}

function decodedMimeBody(raw: string): string {
  const mime = Buffer.from(raw, 'base64url').toString('utf8');
  const encodedBody = mime.split('\r\n\r\n').at(-1) ?? '';
  return Buffer.from(encodedBody.replaceAll('\r\n', ''), 'base64').toString('utf8');
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('Google Calendar and Gmail tools', () => {
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
      { start: '2026-10-05T09:00:00.000Z', end: '2026-10-05T10:00:00.000Z' },
      { start: '2026-10-05T11:00:00.000Z', end: '2026-10-05T12:00:00.000Z' },
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

  it.each(['yes', 'no', 'yes and move it later'])('returns a tool refusal for %s without a pending calendar action', async (reply) => {
    const request = vi.fn<GoogleApiClient['request']>();
    const { app, setLatest } = appFor(request);
    setLatest(conversationMessage('43', reply, new Date(Date.now() + 10_000)));
    const response = await app.inject({
      method: 'POST', url: '/tools/calendar_confirm_change', headers: confirmHeaders('43'),
      payload: { confirmationCode: '12345678' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ outcome: 'refused', result: { refused: expect.stringContaining('No calendar change was made') } });
    expect(request).not.toHaveBeenCalled();
  });

  it('cancels a staged calendar creation without writing to Google', async () => {
    const request = vi.fn<GoogleApiClient['request']>();
    const { app, setLatest } = appFor(request);
    const staged = await app.inject({
      method: 'POST', url: '/tools/calendar_create_event', headers: confirmHeaders('42'),
      payload: { subject: 'Meeting', start: '2026-06-23T10:00:00+02:00', end: '2026-06-23T11:00:00+02:00' },
    });
    setLatest(conversationMessage('43', 'cancel', new Date(Date.now() + 10_000)));
    const response = await app.inject({
      method: 'POST', url: '/tools/calendar_confirm_change', headers: confirmHeaders('43'),
      payload: { confirmationCode: staged.json().result.confirmationCode },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ outcome: 'ok', result: { status: 'cancelled' } });
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

    confirmMessage(setLatest, code);
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

    confirmMessage(setLatest, code);
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

    confirmMessage(setLatest, code);
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
    confirmMessage(setLatest, code);
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
    confirmMessage(setLatest, code);
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

    confirmMessage(setLatest, code);
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
