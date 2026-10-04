import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentPrincipal } from '../auth/verify.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { ConversationHistoryPage, ConversationMessage, ConversationStore } from '../core/conversation-store.js';
import { coreModule } from '../core/index.js';
import type { ToolCallRecord } from '../core/tool-calls.js';
import type { GraphClient } from './graph-client.js';
import { createOutlookModule } from './tools.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const graphHeaders = { authorization: ['Bea', 'rer a.b.c'].join('') };
const agent: AgentPrincipal = {
  kind: 'jarvis-agent',
  objectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  tenantId: config.auth.tenantId,
};
const apps: ReturnType<typeof buildApp>[] = [];

function conversationMessage(id: string, text: string, at = new Date()): ConversationMessage {
  return { id, sessionId: '1', role: 'dan', text, model: null, at };
}

function appFor(
  graph: GraphClient,
  options: { readonly now?: () => Date; readonly message?: ConversationMessage } = {},
) {
  let latest = options.message ?? conversationMessage('42', 'Move my meeting.');
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
  const app = buildApp(config, undefined, {
    modules: [coreModule, createOutlookModule(graph, {
      mailboxObjectId: config.auth.ownerObjectId,
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

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('Outlook tools', () => {
  it('reads the configured local calendar day and handles a daylight-saving boundary', async () => {
    const graph = { request: vi.fn(async () => ({ value: [] })) };
    const { app } = appFor(graph, { now: () => new Date('2026-03-29T12:00:00Z') });
    const response = await app.inject({
      method: 'POST',
      url: '/tools/calendar_today_agenda',
      headers: { ...graphHeaders, 'x-jarvis-message-id': '42' },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result).toMatchObject({ timeZone: 'Europe/Copenhagen', events: [], truncated: false });
    const path = graph.request.mock.calls[0]?.[0];
    const query = new URL(path ?? '', 'https://graph.microsoft.com').searchParams;
    expect(query.get('startDateTime')).toBe('2026-03-28T23:00:00.000Z');
    expect(query.get('endDateTime')).toBe('2026-03-29T22:00:00.000Z');
  });

  it('finds free slots across overlapping events', async () => {
    const graph = {
      request: vi.fn(async () => ({
        value: [
          { id: 'one', subject: 'One', start: { dateTime: '2026-10-05T10:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-10-05T10:30:00', timeZone: 'UTC' } },
          { id: 'two', subject: 'Two', start: { dateTime: '2026-10-05T10:20:00', timeZone: 'UTC' }, end: { dateTime: '2026-10-05T11:00:00', timeZone: 'UTC' } },
        ],
      })),
    };
    const { app } = appFor(graph);
    const response = await app.inject({
      method: 'POST',
      url: '/tools/calendar_find_free_slots',
      headers: { ...graphHeaders, 'x-jarvis-message-id': '42' },
      payload: {
        startDateTime: '2026-10-05T09:00:00Z',
        endDateTime: '2026-10-05T12:00:00Z',
        durationMinutes: 30,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result.slots).toEqual([
      { start: '2026-10-05T09:00:00.000Z', end: '2026-10-05T10:00:00.000Z' },
      { start: '2026-10-05T11:00:00.000Z', end: '2026-10-05T12:00:00.000Z' },
    ]);
  });

  it('does not move a meeting until a later, exact Dan confirmation and redacts stored calls', async () => {
    const graph = {
      request: vi.fn(async (path: string, options: { method?: string }) => {
        if (!options.method) {
          return {
            id: 'event-1',
            subject: 'Planning',
            start: { dateTime: '2026-10-04T13:00:00', timeZone: 'UTC' },
            end: { dateTime: '2026-10-04T14:00:00', timeZone: 'UTC' },
          };
        }
        return {};
      }),
    };
    const { app, records, setLatest } = appFor(graph);
    const headers = { ...graphHeaders, 'x-jarvis-message-id': '42' };
    const staged = await app.inject({
      method: 'POST',
      url: '/tools/calendar_move_event',
      headers,
      payload: {
        eventId: 'event-1',
        startDateTime: '2026-10-05T15:00:00+02:00',
        endDateTime: '2026-10-05T16:00:00+02:00',
      },
    });
    const confirmationCode = staged.json().result.confirmationCode as string;

    expect(staged.json()).toMatchObject({ outcome: 'ok', result: { status: 'awaiting_confirmation' } });
    expect(confirmationCode).toMatch(/^\d{8}$/u);
    expect(graph.request).toHaveBeenCalledOnce();
    expect(records[0]).toMatchObject({
      tool: 'calendar_move_event',
      arguments: { redacted: true },
      result: { redacted: true },
    });

    const sameTurn = await app.inject({
      method: 'POST',
      url: '/tools/calendar_confirm_change',
      headers,
      payload: { confirmationCode },
    });
    expect(sameTurn.json()).toMatchObject({ outcome: 'refused' });
    expect(graph.request).toHaveBeenCalledOnce();

    setLatest(conversationMessage('43', `confirm ${confirmationCode}`, new Date(Date.now() + 10_000)));
    const confirmed = await app.inject({
      method: 'POST',
      url: '/tools/calendar_confirm_change',
      headers: { ...graphHeaders, 'x-jarvis-message-id': '43' },
      payload: { confirmationCode },
    });
    expect(confirmed.json()).toMatchObject({ outcome: 'ok', result: { status: 'completed' } });
    expect(graph.request).toHaveBeenCalledTimes(2);
    expect(graph.request.mock.calls[1]?.[1]).toMatchObject({
      method: 'PATCH',
      body: {
        start: { dateTime: '2026-10-05T13:00:00.000', timeZone: 'UTC' },
        end: { dateTime: '2026-10-05T14:00:00.000', timeZone: 'UTC' },
      },
    });
    expect(records[1]).toMatchObject({
      tool: 'calendar_confirm_change',
      arguments: { redacted: true },
      result: { redacted: true },
    });
  });

  it('passes bounded mail content to summarisation but never records bodies', async () => {
    const graph = {
      request: vi.fn(async () => ({
        value: [{
          id: 'message-1',
          subject: 'A private subject',
          from: { emailAddress: { name: 'Sender', address: 'sender@example.com' } },
          receivedDateTime: '2026-10-04T12:00:00Z',
          body: { contentType: 'text', content: 'PRIVATE MAIL BODY' },
        }],
      })),
    };
    const { app, records } = appFor(graph);
    const response = await app.inject({
      method: 'POST',
      url: '/tools/mail_search',
      headers: { ...graphHeaders, 'x-jarvis-message-id': '42' },
      payload: { query: 'meeting' },
    });

    expect(response.json().result.messages[0].body).toBe('PRIVATE MAIL BODY');
    expect(records[0]).toMatchObject({
      arguments: { redacted: true },
      result: { redacted: true },
    });
    expect(JSON.stringify(records)).not.toContain('PRIVATE MAIL BODY');
  });

  it('sends only after an exact confirmation in a later Dan message', async () => {
    const graph = { request: vi.fn(async () => ({})) };
    const { app, setLatest } = appFor(graph);
    const staged = await app.inject({
      method: 'POST',
      url: '/tools/mail_send',
      headers: { ...graphHeaders, 'x-jarvis-message-id': '42' },
      payload: {
        to: ['dan@example.com'],
        subject: 'A test',
        body: 'The private message body.',
      },
    });
    const confirmationCode = staged.json().result.confirmationCode as string;
    expect(graph.request).not.toHaveBeenCalled();

    setLatest(conversationMessage('43', `confirm ${confirmationCode}`, new Date(Date.now() + 10_000)));
    const confirmed = await app.inject({
      method: 'POST',
      url: '/tools/mail_confirm_action',
      headers: { ...graphHeaders, 'x-jarvis-message-id': '43' },
      payload: { confirmationCode },
    });
    expect(confirmed.json()).toMatchObject({ outcome: 'ok', result: { status: 'completed' } });
    expect(graph.request).toHaveBeenCalledOnce();
    expect(graph.request.mock.calls[0]?.[0]).toContain('/sendMail');
    expect(graph.request.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
  });
});
