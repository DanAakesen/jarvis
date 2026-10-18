import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceCommand } from '@jarvis/contracts';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { ConversationHistoryPage, ConversationMessage, ConversationStore } from '../core/conversation-store.js';
import { coreModule } from '../core/index.js';
import type { ToolCallRecord } from '../core/tool-calls.js';
import { runModelToolCall } from '../core/tool-origin.js';
import { WorkspaceCommandBroker } from '../core/workspace-commands.js';
import type { BackendModule } from '../modules.js';
import { calendarTurnContext, executeRealtimeToolCall, resolveCalendarReply } from '../voice/realtime.js';
import type { GoogleApiClient } from './api-client.js';
import { createGoogleModule } from './tools.js';

/**
 * Offline end-to-end check of the flow Dan tried live in #885: find hotel bookings in Gmail, show them on screen, stage
 * both in the calendar, approve with a plain reply and see them in the calendar. Gmail and Calendar are in-memory fakes
 * and every name, address and date is synthetic. Each channel reaches the backend the way it does in production: typed
 * chat calls /tools/* as the Jarvis agent, and voice runs the model's tool calls on the owner's session inside the
 * relay's call scope, while the relay answers a reply to a staged change itself from backend state.
 */

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const ownerId = config.auth.ownerObjectId;
const agentAuthorization = ['Bearer', 'header.agent.signature'].join(' ');
const ownerAuthorization = ['Bearer', 'header.user.signature'].join(' ');

const bookings = [
  {
    id: 'gmail-id-alpha', subject: 'Booking confirmed: Synthetic Hotel Alpha', sender: 'Synthetic Hotel Alpha',
    address: 'reservations@alpha.example.test', received: Date.UTC(2026, 9, 5, 9, 30),
    body: 'private-alpha-body Your stay is booked. Booking reference ALPHA-4821.',
  },
  {
    id: 'gmail-id-beta', subject: 'Booking confirmed: Synthetic Hotel Beta', sender: 'Synthetic Hotel Beta',
    address: 'reservations@beta.example.test', received: Date.UTC(2026, 9, 6, 11, 15),
    body: 'private-beta-body Your stay is booked. Booking reference BETA-7305.',
  },
] as const;

const hotelStays = [
  {
    subject: 'Hotel stay: Synthetic Hotel Alpha', startDateTime: '2027-11-12T15:00:00+01:00',
    endDateTime: '2027-11-15T11:00:00+01:00', attendees: [],
  },
  {
    subject: 'Hotel stay: Synthetic Hotel Beta', startDateTime: '2027-11-20T16:00:00+01:00',
    endDateTime: '2027-11-22T12:00:00+01:00', attendees: [],
  },
];

const createdBodies = [
  {
    summary: 'Hotel stay: Synthetic Hotel Alpha',
    start: { dateTime: '2027-11-12T14:00:00.000Z', timeZone: 'UTC' },
    end: { dateTime: '2027-11-15T10:00:00.000Z', timeZone: 'UTC' },
  },
  {
    summary: 'Hotel stay: Synthetic Hotel Beta',
    start: { dateTime: '2027-11-20T15:00:00.000Z', timeZone: 'UTC' },
    end: { dateTime: '2027-11-22T11:00:00.000Z', timeZone: 'UTC' },
  },
];

const hotelsView = {
  version: 1,
  title: 'Hotels found',
  renderer: 'list',
  source: { id: 'now', status: 'complete' },
  data: {
    items: [
      { title: 'Synthetic Hotel Alpha', description: 'Check-in 12 Nov, check-out 15 Nov' },
      { title: 'Synthetic Hotel Beta', description: 'Check-in 20 Nov, check-out 22 Nov' },
    ],
  },
} as const;

type Channel = 'chat' | 'voice';
type Reply = { tool: string; outcome: 'ok' | 'refused' | 'error'; result: Record<string, unknown>; confirmation: string };
type ScreenView = {
  title: string;
  renderer: string;
  source: { status: string };
  data: { content?: string; items?: { title: string; description?: string }[] };
};
type CalendarEvent = {
  id: string;
  summary: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
};

/** In-memory Gmail and Calendar. Anything the flow has no reason to ask for is recorded and answered with an error. */
function fakeGoogle() {
  const events: CalendarEvent[] = [];
  const writes: Omit<CalendarEvent, 'id'>[] = [];
  const unexpected: string[] = [];
  const request: GoogleApiClient['request'] = async (api, path, options) => {
    const method = options.method ?? 'GET';
    if (api === 'gmail' && method === 'GET') {
      if (path.includes('?q=')) return { messages: bookings.map(({ id }) => ({ id })) };
      const booking = bookings.find(({ id }) => path === `/users/me/messages/${id}?format=full`);
      if (booking) {
        return {
          id: booking.id,
          internalDate: String(booking.received),
          snippet: 'Booking confirmed',
          payload: {
            headers: [
              { name: 'Subject', value: booking.subject },
              { name: 'From', value: `${booking.sender} <${booking.address}>` },
            ],
            mimeType: 'text/plain',
            body: { data: Buffer.from(booking.body).toString('base64url') },
          },
        };
      }
    }
    if (api === 'calendar' && method === 'POST' && path === '/calendars/primary/events') {
      const body = options.body as Omit<CalendarEvent, 'id'>;
      writes.push(structuredClone(body));
      events.push({ id: `event-${events.length + 1}`, ...structuredClone(body) });
      return { id: `event-${events.length}` };
    }
    if (api === 'calendar' && method === 'GET' && path.startsWith('/calendars/primary/events?')) {
      const params = new URL(path, 'https://calendar.example.test').searchParams;
      const from = Date.parse(params.get('timeMin') ?? '');
      const until = Date.parse(params.get('timeMax') ?? '');
      return {
        items: events
          .filter(({ start, end }) => Date.parse(start.dateTime) < until && Date.parse(end.dateTime) > from)
          .sort((left, right) => Date.parse(left.start.dateTime) - Date.parse(right.start.dateTime))
          .slice(0, Number(params.get('maxResults') ?? 50)),
      };
    }
    unexpected.push(`${method} ${api} ${path}`);
    throw new Error(`Unexpected ${method} ${api} request.`);
  };
  return { request, writes, unexpected };
}

function danMessage(id: number, text: string): ConversationMessage {
  return { id: String(id), sessionId: '1', role: 'dan', text, model: null, at: new Date(Date.now() + 60_000) };
}

function viewOf(command: WorkspaceCommand | undefined): ScreenView | undefined {
  if (!command || (command.operation !== 'create' && command.operation !== 'update')) return undefined;
  return command.view as unknown as ScreenView;
}

function visibleText(view: ScreenView | undefined): string {
  if (!view) return '';
  const { content, items } = view.data;
  return [view.title, content ?? '', ...(items ?? []).flatMap(({ title, description }) => [title, description ?? ''])]
    .join('\n');
}

const apps: ReturnType<typeof buildApp>[] = [];
const tabs: { close: () => void }[] = [];

afterEach(async () => {
  for (const tab of tabs.splice(0)) tab.close();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function harness(channel: Channel) {
  const broker = new WorkspaceCommandBroker();
  const google = fakeGoogle();
  const records: ToolCallRecord[] = [];
  const delivered: WorkspaceCommand[] = [];
  let latest = danMessage(100, 'Good morning.');

  const voiceRoutes: BackendModule = {
    id: 'voice-probe', tools: [],
    registerRoutes: async (instance) => {
      // A model tool call as the relay runs it: the owner's session, Dan's latest message, inside the call scope.
      instance.post('/test/voice', async (request) => {
        const { name, args } = request.body as { name: string; args: Record<string, unknown> };
        request.jarvisConversationMessage = latest;
        try {
          return JSON.parse(await runModelToolCall(request, () => executeRealtimeToolCall({
            type: 'response.function_call_arguments.done', name, call_id: `call-${latest.id}-${name}`,
            arguments: JSON.stringify(args),
          }, instance.jarvisTools, request, new AbortController().signal)));
        } finally {
          delete request.jarvisConversationMessage;
        }
      });
      // The relay answers a reply to a staged change from backend state, outside any model call.
      instance.post('/test/voice-reply', async (request) => {
        request.jarvisConversationMessage = latest;
        try {
          const { output } = await resolveCalendarReply(
            instance.jarvisTools, request, new AbortController().signal, latest.text,
          );
          return JSON.parse(output ?? '{"outcome":"undecided"}');
        } finally {
          delete request.jarvisConversationMessage;
        }
      });
    },
  };

  const store: ConversationStore = {
    createSession: async () => ({ id: '1', channel: 'chat', language: 'en', startedAt: new Date(), endedAt: null }),
    getSession: async () => null,
    readRecentUserMessages: async () => [],
    endSession: async () => true,
    addMessage: async () => null,
    getHistory: async (): Promise<ConversationHistoryPage> => ({ messages: [latest], nextCursor: null }),
  };

  const app = buildApp(config, undefined, {
    modules: [coreModule, createGoogleModule({ request: google.request }, { timeZone: 'Europe/Copenhagen' }), voiceRoutes],
    auth: async (token) => token === 'header.user.signature'
      ? { objectId: ownerId, tenantId: config.auth.tenantId, displayName: 'Dan' }
      : { kind: 'jarvis-agent', objectId: 'b331004a-777a-4e53-b7b0-40bf9ab3b9ef', tenantId: config.auth.tenantId },
    conversationStore: store,
    toolCallStore: { record: async (entry) => { records.push(entry); } },
    workspaceCommands: broker,
  });
  apps.push(app);

  // A signed-in browser tab that applies every command it is sent.
  const tab = broker.connect(ownerId, (event, data) => {
    if (event === 'workspace-command') {
      delivered.push(data.command);
      queueMicrotask(() => { broker.acknowledge(ownerId, tab.sessionId, data.command.commandId, true); });
    }
    return true;
  });
  tabs.push(tab);

  const say = (text: string) => { latest = danMessage(Number(latest.id) + 1, text); };

  /** A tool call the model makes while answering Dan's latest message. */
  const call = async (tool: string, args: Record<string, unknown>): Promise<Reply> => {
    const response = channel === 'chat'
      ? await app.inject({
        method: 'POST', url: `/tools/${tool}`, payload: args,
        headers: { authorization: agentAuthorization, 'x-jarvis-message-id': latest.id },
      })
      : await app.inject({
        method: 'POST', url: '/test/voice', payload: { name: tool, args },
        headers: { authorization: ownerAuthorization },
      });
    expect(response.statusCode).toBe(200);
    return response.json();
  };

  /** The same tool call made from the owner's own browser session instead of by Jarvis. */
  const ownerBrowser = async (tool: string, args: Record<string, unknown>): Promise<Reply> => {
    const response = await app.inject({
      method: 'POST', url: `/tools/${tool}`, payload: args,
      headers: { authorization: ownerAuthorization, 'x-jarvis-message-id': latest.id },
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  };

  const relayReply = async (): Promise<Reply> => {
    expect(calendarTurnContext(true, latest.text).followup).toBe(true);
    const response = await app.inject({
      method: 'POST', url: '/test/voice-reply', payload: {}, headers: { authorization: ownerAuthorization },
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  };

  /** Where Dan's reply to a staged change is looked up: the model's read tool in chat, the relay in voice. */
  const pending = (): Promise<Reply> => channel === 'chat' ? call('calendar_get_pending_change', {}) : relayReply();

  /** Dan's approval or decline: in chat the model reads the pending change and confirms it with the staged code. */
  const answer = async (code: string, expected: 'approve' | 'decline'): Promise<Reply> => {
    if (channel === 'voice') return relayReply();
    const read = await call('calendar_get_pending_change', {});
    expect(read.result).toMatchObject({ status: 'awaiting_confirmation', confirmationCode: code, reply: expected });
    return call('calendar_confirm_change', { confirmationCode: code });
  };

  const onScreen = (viewId: string) =>
    delivered.filter((command) => 'viewId' in command && command.viewId === viewId);

  // Screen delivery is best effort and asynchronous, so wait for the create and the focus that follows it.
  const screen = async (viewId: string) => {
    await vi.waitFor(() => {
      expect(onScreen(viewId).map(({ operation }) => operation)).toEqual(['create', 'focus']);
    }, { timeout: 2000 });
    return viewOf(onScreen(viewId)[0]);
  };

  return { google, records, delivered, say, call, ownerBrowser, pending, answer, screen };
}

describe.each(['chat', 'voice'] as const)('hotel booking flow in %s', (channel) => {
  it('finds the bookings, shows them, stages both events and creates them only after a later plain yes', async () => {
    const jarvis = harness(channel);
    const { google, delivered } = jarvis;

    jarvis.say('Find hotel bookings in my Gmail for next month.');
    const found = await jarvis.call('mail_search', { query: 'hotel booking confirmation' });
    expect(found).toMatchObject({ outcome: 'ok', result: { truncated: false, messages: [
      {
        subject: 'Booking confirmed: Synthetic Hotel Alpha',
        from: { name: 'Synthetic Hotel Alpha', address: 'reservations@alpha.example.test' },
      },
      {
        subject: 'Booking confirmed: Synthetic Hotel Beta',
        from: { name: 'Synthetic Hotel Beta', address: 'reservations@beta.example.test' },
      },
    ] } });
    if (channel === 'voice') {
      // Voice has no visible answer, so the lookup opens a clean list of its own: no raw result, ids or message bodies.
      const list = await jarvis.screen('google-101');
      expect(list).toMatchObject({ title: 'Mail results', renderer: 'list', source: { status: 'complete' } });
      expect(list?.data.items).toEqual([
        {
          title: 'Booking confirmed: Synthetic Hotel Alpha',
          description: expect.stringMatching(/^Synthetic Hotel Alpha \u00b7 \d{1,2} Oct 2026$/u),
        },
        {
          title: 'Booking confirmed: Synthetic Hotel Beta',
          description: expect.stringMatching(/^Synthetic Hotel Beta \u00b7 \d{1,2} Oct 2026$/u),
        },
      ]);
      expect(visibleText(list)).not.toMatch(/[{}[\]]|private-|gmail-id-/u);
    }

    jarvis.say('Show them on screen.');
    const shown = await jarvis.call('workspace_command', {
      commandId: 'hotels-create', operation: 'create', viewId: 'hotels-found', view: hotelsView,
    });
    expect(shown).toMatchObject({ outcome: 'ok', result: { type: 'generated-view', view: hotelsView } });
    expect(delivered.find(({ commandId }) => commandId === 'hotels-create')).toMatchObject({
      operation: 'create', viewId: 'hotels-found', view: hotelsView,
    });

    jarvis.say('Stage them in my calendar.');
    const staged = await jarvis.call('calendar_create_events', { events: hotelStays });
    expect(staged).toMatchObject({ outcome: 'ok', result: {
      status: 'awaiting_confirmation',
      confirmationCode: expect.stringMatching(/^\d{8}$/u),
      items: [
        { summary: expect.stringContaining('Synthetic Hotel Alpha') },
        { summary: expect.stringContaining('Synthetic Hotel Beta') },
      ],
    } });
    const { confirmationCode: code, summary } = staged.result as { confirmationCode: string; summary: string };
    expect(summary).toContain('12 November 2027 at 15:00');
    expect(summary).toContain('20 November 2027 at 16:00');
    expect(google.writes).toEqual([]);
    if (channel === 'voice') {
      const proposal = await jarvis.screen('google-103');
      expect(proposal).toMatchObject({ title: 'Calendar', renderer: 'text', data: { content: summary } });
      expect(JSON.stringify(proposal)).not.toContain(code);
    }
    // The message that staged the change can never approve it, even with the right code.
    expect(await jarvis.call('calendar_confirm_change', { confirmationCode: code })).toMatchObject({ outcome: 'refused' });
    expect(google.writes).toEqual([]);

    jarvis.say('Is it created?');
    expect((await jarvis.pending()).result).toMatchObject({
      status: 'awaiting_confirmation', summary, confirmationCode: code, reply: null,
    });
    // A later message that is not an approval cannot confirm it either.
    expect(await jarvis.call('calendar_confirm_change', { confirmationCode: code })).toMatchObject({ outcome: 'refused' });
    expect(google.writes).toEqual([]);

    jarvis.say('yes');
    const approved = await jarvis.answer(code, 'approve');
    expect(approved).toMatchObject({
      outcome: 'ok',
      result: { status: 'completed', summary, items: [{ status: 'completed' }, { status: 'completed' }] },
      confirmation: expect.stringContaining('calendar'),
    });
    expect(google.writes).toEqual(createdBodies);
    if (channel === 'voice') {
      const done = visibleText(await jarvis.screen('google-105'));
      expect(done).toContain('Done.');
      expect(done).toContain('Synthetic Hotel Alpha');
      expect(done).toContain('Synthetic Hotel Beta');
    }

    // A repeated yes reaches the model, which looks for a pending change and finds nothing left to approve.
    jarvis.say('yes');
    expect((await jarvis.call('calendar_get_pending_change', {})).result)
      .toMatchObject({ status: 'none', lastChange: { status: 'completed', summary } });
    expect(await jarvis.call('calendar_confirm_change', { confirmationCode: code })).toMatchObject({ outcome: 'refused' });
    expect(google.writes).toHaveLength(2);

    jarvis.say('Show me my calendar for November.');
    const listed = await jarvis.call('calendar_list_events', { start: '2027-11-01', end: '2027-11-30' });
    expect(listed).toMatchObject({ outcome: 'ok', result: { truncated: false, events: [
      { subject: 'Hotel stay: Synthetic Hotel Alpha', start: '2027-11-12T14:00:00.000Z', end: '2027-11-15T10:00:00.000Z' },
      { subject: 'Hotel stay: Synthetic Hotel Beta', start: '2027-11-20T15:00:00.000Z', end: '2027-11-22T11:00:00.000Z' },
    ] } });
    if (channel === 'voice') {
      const agenda = await jarvis.screen('google-107');
      expect(agenda).toMatchObject({ title: 'Calendar', renderer: 'text' });
      expect(visibleText(agenda)).toContain('Hotel stay: Synthetic Hotel Alpha');
      expect(visibleText(agenda)).toContain('Hotel stay: Synthetic Hotel Beta');
      expect(visibleText(agenda)).not.toContain('event-');
    }

    jarvis.say('Close the hotel list.');
    expect(await jarvis.call('workspace_command', {
      commandId: 'hotels-close', operation: 'close', viewId: 'hotels-found',
    })).toMatchObject({ outcome: 'ok', result: { applied: true, operation: 'close' } });
    expect(delivered.find(({ commandId }) => commandId === 'hotels-close')).toMatchObject({
      operation: 'close', viewId: 'hotels-found',
    });

    expect(google.unexpected).toEqual([]);
    expect(JSON.stringify(delivered)).not.toMatch(/private-|gmail-id-/u);
    expect(JSON.stringify(delivered)).not.toContain(code);
    if (channel === 'chat') {
      expect(jarvis.records.length).toBeGreaterThan(0);
      for (const record of jarvis.records) {
        expect([record.arguments, record.result]).toEqual([{ redacted: true }, { redacted: true }]);
      }
      expect(JSON.stringify(jarvis.records)).not.toContain(code);
    }
  });

  it('creates nothing when Dan declines the staged events', async () => {
    const jarvis = harness(channel);

    jarvis.say('Stage them in my calendar.');
    const staged = await jarvis.call('calendar_create_events', { events: hotelStays });
    expect(staged).toMatchObject({ outcome: 'ok', result: { status: 'awaiting_confirmation' } });
    const { confirmationCode: code } = staged.result as { confirmationCode: string };
    if (channel === 'voice') await jarvis.screen('google-101');

    jarvis.say('no');
    expect(await jarvis.answer(code, 'decline')).toMatchObject({ outcome: 'ok', result: { status: 'cancelled' } });
    if (channel === 'voice') expect(visibleText(await jarvis.screen('google-102'))).toContain('Cancelled');
    expect(await jarvis.call('calendar_confirm_change', { confirmationCode: code })).toMatchObject({ outcome: 'refused' });

    jarvis.say('Show me my calendar for November.');
    expect(await jarvis.call('calendar_list_events', { start: '2027-11-01', end: '2027-11-30' }))
      .toMatchObject({ outcome: 'ok', result: { events: [] } });
    if (channel === 'voice') expect(visibleText(await jarvis.screen('google-103'))).toContain('No events in this period.');
    expect(jarvis.google.writes).toEqual([]);
    expect(jarvis.google.unexpected).toEqual([]);
  });
});

describe('who may create views in the hotel booking flow', () => {
  it('refuses the owner browser, shows nothing for it, and still lets Jarvis put the list on screen', async () => {
    const jarvis = harness('chat');

    jarvis.say('Show them on screen.');
    expect(await jarvis.ownerBrowser('workspace_command', {
      commandId: 'browser-create', operation: 'create', viewId: 'browser-view', view: hotelsView,
    })).toMatchObject({ outcome: 'refused' });
    expect(jarvis.delivered).toEqual([]);

    expect(await jarvis.call('workspace_command', {
      commandId: 'jarvis-create', operation: 'create', viewId: 'hotels-found', view: hotelsView,
    })).toMatchObject({ outcome: 'ok', result: { type: 'generated-view', view: hotelsView } });
    expect(jarvis.delivered.map(({ commandId }) => commandId)).toEqual(['jarvis-create']);
  });
});
