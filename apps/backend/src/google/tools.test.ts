import type { FastifyRequest } from 'fastify';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { coreModule } from '../core/index.js';
import { ToolFailure, ToolRefusal } from '../core/tool-registry.js';
import { GoogleApiError, type GoogleApiClient } from './api-client.js';
import { createGoogleModule } from './tools.js';

type Json = Record<string, unknown>;
interface Call { readonly method: string; readonly path: string }

const now = () => new Date('2026-11-23T07:15:00Z');
const danMessage = { id: '101', sessionId: '7', role: 'dan', text: 'Please do it.', model: null, at: new Date('2026-11-23T07:00:00Z') };
const event = (id: string, summary: string | undefined, from: string, to: string, extra: Json = {}): Json => ({
  id, ...(summary === undefined ? {} : { summary }),
  start: { dateTime: `2026-11-23T${from}:00+01:00` }, end: { dateTime: `2026-11-23T${to}:00+01:00` }, ...extra,
});

/**
 * A Google client with a scripted calendar and mailbox: it lists and finds the events it is given, an unknown id is "not found",
 * and `fail` can make a request fail (`nth` counts the requests with that method and path).
 */
function scriptedGoogle(options: { events?: Json[]; fail?: (call: Call, nth: number) => GoogleApiError | undefined } = {}) {
  const events = options.events ?? [];
  const calls: Call[] = [];
  const client: GoogleApiClient = {
    async request(_api, path, { method = 'GET' }) {
      const call = { method, path: path.split('?')[0]! };
      calls.push(call);
      const failure = options.fail?.(call, calls.filter((other) => other.method === method && other.path === call.path).length);
      if (failure) throw failure;
      if (method !== 'GET') return { id: 'written' };
      if (call.path === '/calendars/primary/events') return { items: events };
      if (call.path === '/users/me/labels') return { labels: [{ id: 'Label_1', name: 'Travel' }] };
      const found = events.find((item) => call.path.endsWith(`/${String(item.id)}`));
      if (!found) throw new GoogleApiError('not-found', 404);
      return found;
    },
  };
  return { client, calls };
}

/** One tool call as the dispatcher reports it: the result, a refusal or a failure. */
function tools(options: Parameters<typeof scriptedGoogle>[0] = {}) {
  const { client, calls } = scriptedGoogle(options);
  const module = createGoogleModule(client, { timeZone: 'Europe/Copenhagen', now });
  const request = (message: typeof danMessage | null) => ({
    headers: {}, principal: { objectId: 'owner' }, agentPrincipal: null, log: { error() {} },
    ...(message ? { jarvisConversationMessage: message } : {}),
  }) as unknown as FastifyRequest;
  const call = async (name: string, input: Json, message: typeof danMessage | null = danMessage) => {
    try {
      return { outcome: 'ok', result: await module.tools.find((tool) => tool.name === name)!.execute(input, request(message), AbortSignal.timeout(5_000)) };
    } catch (error) {
      if (error instanceof ToolRefusal) return { outcome: 'refused', result: { refused: error.message } };
      if (error instanceof ToolFailure) return { outcome: 'error', result: { error: error.message } };
      throw error;
    }
  };
  return { call, calls };
}

const writes = (calls: readonly Call[]) => calls.filter((call) => call.method !== 'GET');
const throttled = () => new GoogleApiError('throttled', 429);

describe('finding free time', () => {
  it('ignores events Dan declined and events that were cancelled', async () => {
    const declined = event('declined', 'Budget review', '14:00', '15:00', { attendees: [{ email: 'dan@example.com', self: true, responseStatus: 'declined' }] });
    const cancelled = event('cancelled', 'Cancelled workshop', '15:00', '16:00', { status: 'cancelled' });
    const { call } = tools({ events: [event('dentist', 'Dentist', '11:00', '12:00'), declined, cancelled] });
    expect(await call('calendar_find_free_slots', { startDateTime: '2026-11-23T09:00:00+01:00', endDateTime: '2026-11-23T17:00:00+01:00', durationMinutes: 60 }))
      .toMatchObject({ outcome: 'ok', result: { slots: [
        { start: '2026-11-23T08:00:00.000Z', end: '2026-11-23T10:00:00.000Z' }, { start: '2026-11-23T11:00:00.000Z', end: '2026-11-23T16:00:00.000Z' },
      ] } });
  });

  it('still blocks the time of an event saved without a title', async () => {
    const { call } = tools({ events: [event('untitled', undefined, '10:00', '11:00'), event('lunch', 'Lunch', '13:00', '14:00')] });
    expect(await call('calendar_find_free_slots', { startDateTime: '2026-11-23T09:00:00+01:00', endDateTime: '2026-11-23T12:00:00+01:00', durationMinutes: 30 }))
      .toMatchObject({ outcome: 'ok', result: { slots: [
        { start: '2026-11-23T08:00:00.000Z', end: '2026-11-23T09:00:00.000Z' }, { start: '2026-11-23T10:00:00.000Z', end: '2026-11-23T11:00:00.000Z' },
      ] } });
  });
});

describe('repeating a write', () => {
  const create = { subject: 'Dentist', startDateTime: '2026-11-26T14:00:00+01:00', endDateTime: '2026-11-26T14:45:00+01:00' };
  const batch = {
    events: [
      { subject: 'Train to Aarhus', startDateTime: '2026-12-04T08:12:00+01:00', endDateTime: '2026-12-04T10:55:00+01:00' },
      { subject: 'Dinner with Lars', startDateTime: '2026-12-04T19:00:00+01:00', endDateTime: '2026-12-04T21:30:00+01:00' },
    ],
  };

  it('tries again when Google refused the first attempt before changing anything', async () => {
    const { call, calls } = tools({ fail: (item, nth) => (item.method === 'POST' && nth === 1 ? throttled() : undefined) });
    expect(await call('calendar_create_event', create))
      .toMatchObject({ outcome: 'error', result: { error: 'Google is rate-limiting requests. Try again shortly.' } });
    expect(await call('calendar_create_event', create)).toMatchObject({ outcome: 'ok', result: { status: 'completed' } });
    expect(writes(calls)).toHaveLength(2);
  });

  it('does not send again when the first attempt may have gone through', async () => {
    const { call, calls } = tools({ fail: (item, nth) => (item.method === 'POST' && nth === 1 ? new GoogleApiError('uncertain', 500) : undefined) });
    const first = await call('calendar_create_event', create);
    expect(first.outcome).toBe('error');
    expect(await call('calendar_create_event', create)).toEqual(first);
    expect(writes(calls)).toHaveLength(1);
  });

  it('does not send again after it succeeded', async () => {
    const { call, calls } = tools();
    const mail = { to: ['maria.jensen@example.com'], subject: 'Lunch', body: 'See you at one.' };
    const first = await call('mail_send', mail);
    expect(first).toMatchObject({ outcome: 'ok', result: { status: 'completed' } });
    expect(first.result).not.toHaveProperty('confirmationCode');
    expect(await call('mail_send', mail)).toEqual(first);
    expect(writes(calls)).toHaveLength(1);
  });

  it('tries a batch again when none of its events was created', async () => {
    const { call, calls } = tools({ fail: (item, nth) => (item.method === 'POST' && nth === 1 ? throttled() : undefined) });
    expect(await call('calendar_create_events', batch)).toMatchObject({
      outcome: 'ok',
      result: {
        status: 'partial',
        detail: '0 of 2 calendar events were created. The batch stopped; no automatic retry will run. Verify unverified events before trying again.',
        items: [{ status: 'failed' }, { status: 'not_attempted' }],
      },
    });
    expect(await call('calendar_create_events', batch)).toMatchObject({ outcome: 'ok', result: { status: 'completed' } });
    expect(writes(calls)).toHaveLength(3);
  });

  it('does not create the events of a batch again when its first attempt may have gone through', async () => {
    const { call, calls } = tools({ fail: (item, nth) => (item.method === 'POST' && nth === 1 ? new GoogleApiError('uncertain', 500) : undefined) });
    const first = await call('calendar_create_events', batch);
    expect(first).toMatchObject({ result: { status: 'partial', items: [
      { status: 'unverified', detail: 'The result is unverified. Check the calendar before trying again.' }, { status: 'not_attempted' },
    ] } });
    expect(await call('calendar_create_events', batch)).toEqual(first);
    expect(writes(calls)).toHaveLength(1);
  });

  it('does not create the events of a partly created batch twice', async () => {
    const { call, calls } = tools({ fail: (item, nth) => (item.method === 'POST' && nth === 2 ? throttled() : undefined) });
    const first = await call('calendar_create_events', batch);
    expect(first).toMatchObject({ result: { status: 'partial', items: [{ status: 'completed' }, { status: 'failed' }] } });
    expect(await call('calendar_create_events', batch)).toEqual(first);
    expect(writes(calls)).toHaveLength(2);
  });

  it('says plainly when too many changes were made in the last ten minutes', async () => {
    const { call } = tools();
    for (let index = 0; index < 50; index += 1) {
      expect(await call('calendar_create_event', { ...create, subject: `Booking ${index}` })).toMatchObject({ outcome: 'ok' });
    }
    expect(await call('calendar_create_event', { ...create, subject: 'One too many' })).toMatchObject({
      outcome: 'refused',
      result: { refused: 'Too many calendar and mail changes were requested in the last 10 minutes (the limit is 50). Wait a few minutes and try again.' },
    });
  });
});

describe('refusals and failures in plain English', () => {
  const create = { subject: 'Lunch', startDateTime: '2026-11-26T12:00:00+01:00', endDateTime: '2026-11-26T13:00:00+01:00' };

  it('refuses and sends nothing when Dan’s own message cannot be verified', async () => {
    const { call, calls } = tools();
    expect(await call('calendar_create_event', create, null)).toMatchObject({
      outcome: 'refused',
      result: { refused: 'A verified Dan message is required for this Google action.' },
    });
    expect(calls).toEqual([]);
  });

  it.each([
    ['an event that ends before it starts', 'calendar_create_event', { ...create, startDateTime: create.endDateTime, endDateTime: create.startDateTime }, 'The end time must be after the start time.'],
    ['an event longer than 14 days', 'calendar_create_event', { ...create, endDateTime: '2026-12-20T12:00:00+01:00' }, 'The time window can be at most 14 days long.'],
    ['a range that ends before it starts', 'calendar_list_events', { start: '2026-11-25', end: '2026-11-23' }, 'The end must be after the start.'],
    ['a range longer than 62 days', 'calendar_list_events', { start: '2026-11-23', end: '2027-03-01' }, 'The calendar range can be at most 62 days long.'],
    ['the same event twice in one batch', 'calendar_create_events', { events: [create, create] }, 'The request contains the same calendar event more than once. Nothing was created.'],
    ['a batch of one event', 'calendar_create_events', { events: [create] }, 'Provide between 2 and 10 calendar events in one request.'],
  ])('tells which rule %s broke', async (_what, tool, input, refused) => {
    expect(await tools().call(tool, input)).toMatchObject({ outcome: 'refused', result: { refused } });
  });

  it.each([
    ['calendar_update_event', { eventId: 'gone', title: 'New title' }, 'That calendar event could not be found.'],
    ['calendar_move_event', { eventId: 'gone', startDateTime: '2026-11-26T15:00:00+01:00', endDateTime: '2026-11-26T16:00:00+01:00' }, 'That calendar event could not be found.'],
    ['calendar_delete_event', { eventId: 'gone' }, 'That calendar event could not be found.'],
    ['mail_update_draft', { draftId: 'gone', to: ['maria.jensen@example.com'], subject: 'Lunch', body: 'See you.' }, 'That Gmail draft could not be found.'],
    ['mail_delete_draft', { draftId: 'gone' }, 'That Gmail draft could not be found.'],
    ['mail_draft_reply', { messageId: 'gone', replyBody: 'Thanks.' }, 'That Gmail message could not be found.'],
    ['mail_archive', { messageId: 'gone' }, 'That Gmail message could not be found.'],
    ['mail_label', { messageId: 'gone', add: ['Travel'] }, 'That Gmail message could not be found.'],
  ])('%s names what could not be found', async (tool, input, error) => {
    const { call } = tools({ fail: (item) => (item.path === '/users/me/messages/gone/modify' ? new GoogleApiError('not-found', 404) : undefined) });
    expect(await call(tool, input)).toMatchObject({ outcome: 'error', result: { error } });
  });
});

// Argument validation, and the explanation the tools add to it, belong to the dispatcher.
describe('refusals of invalid arguments through the dispatcher', () => {
  const config = loadConfig({});
  const app = buildApp(config, pino({ level: 'silent' }), {
    modules: [coreModule, createGoogleModule(scriptedGoogle().client, { timeZone: 'Europe/Copenhagen', now })],
    auth: async () => ({ kind: 'jarvis-agent', objectId: 'b331004a-777a-4e53-b7b0-40bf9ab3b9ef', tenantId: config.auth.tenantId }),
    toolCallStore: { record: async () => {} },
  });
  beforeAll(async () => { await app.ready(); });
  afterAll(async () => { await app.close(); });

  const refusal = async (tool: string, payload: Json) => {
    const response = await app.inject({
      method: 'POST', url: `/tools/${tool}`, payload,
      headers: { authorization: ['Bearer', 'header.agent.signature'].join(' '), 'x-jarvis-message-id': '101' },
    });
    return response.json() as { outcome: string; result: { refused?: string } };
  };
  const invalid = (explanation: string) => ({ outcome: 'refused', result: { refused: `Invalid arguments: ${explanation} Retry with arguments matching the tool schema.` } });
  const offset = (field: string) => `${field} needs a date and time with a UTC offset (time zone), for example 2026-11-26T14:00:00+01:00 or 2026-11-26T13:00:00Z.`;
  const hour = (time: string) => `2026-11-26T${time}`;

  it.each([
    ['a local time', 'calendar_create_event', { subject: 'Lunch', startDateTime: hour('12:00:00'), endDateTime: hour('13:00:00+01:00') }, offset('startDateTime')],
    ['a move to a local time', 'calendar_move_event', { eventId: 'x', startDateTime: hour('15:00:00+01:00'), endDateTime: hour('16:00:00') }, offset('endDateTime')],
    ['the second event of a batch', 'calendar_create_events', {
      events: [
        { subject: 'Lunch', startDateTime: hour('12:00:00+01:00'), endDateTime: hour('13:00:00+01:00') },
        { subject: 'Dinner', startDateTime: hour('19:00:00+01:00'), endDateTime: hour('21:00:00') },
      ],
    }, offset('events.1.endDateTime')],
    ['a local time to search from', 'calendar_next_event', { after: hour('12:00:00') }, offset('after')],
    ['a range given as local times', 'calendar_list_events', { start: hour('00:00:00'), end: '2026-11-27T00:00:00' },
      'start must be a date such as 2026-11-26, or a date and time with a UTC offset (time zone) such as 2026-11-26T14:00:00+01:00.'],
  ])('asks for a UTC offset after %s', async (_what, tool, payload, explanation) => {
    expect(await refusal(tool, payload)).toMatchObject(invalid(explanation));
  });

  it('asks for something to change when calendar_update_event is given only an id', async () => {
    expect(await refusal('calendar_update_event', { eventId: 'lunch' }))
      .toMatchObject(invalid('Give at least one field to change besides eventId: title, startDateTime with endDateTime, location, attendees or description.'));
  });
});
