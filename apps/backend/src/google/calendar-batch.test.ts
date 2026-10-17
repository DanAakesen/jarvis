import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationMessage } from '../core/conversation-store.js';
import { confirmToolCall } from '../core/tool-calls.js';
import { ToolRefusal } from '../core/tool-registry.js';
import { GoogleApiError, type GoogleApiClient } from './api-client.js';
import { PendingGoogleActions } from './pending-actions.js';
import { createGoogleModule } from './tools.js';

const hotels = [
  {
    subject: 'Hotel stay: Synthetic Hotel Alpha',
    startDateTime: '2027-06-14T15:00:00+02:00', endDateTime: '2027-06-15T11:00:00+02:00',
  },
  {
    subject: 'Hotel stay: Synthetic Hotel Beta',
    startDateTime: '2027-12-09T16:00:00+01:00', endDateTime: '2027-12-10T12:00:00+01:00',
  },
];
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function fixture(request: GoogleApiClient['request'], signal = new AbortController().signal) {
  let now = 1_000;
  let latest: ConversationMessage = {
    id: '10', sessionId: '1', role: 'dan', text: 'Add both hotels.',
    model: null, at: new Date(now),
  };
  const pending = new PendingGoogleActions(() => now);
  const googleModule = createGoogleModule({ request }, { timeZone: 'Europe/Copenhagen', pendingActions: pending });
  const app = Fastify({ logger: false });
  app.decorateRequest('principal', null);
  app.decorateRequest('jarvisConversationMessage', null);
  app.addHook('onRequest', async (req) => {
    req.principal = { objectId: 'synthetic-dan', tenantId: 'synthetic-tenant', displayName: 'Dan' };
    req.jarvisConversationMessage = latest;
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ToolRefusal) {
      return reply.send({ outcome: 'refused', result: { refused: error.message } });
    }
    throw error;
  });
  for (const tool of googleModule.tools.filter((tool) => [
    'calendar_create_event', 'calendar_create_events', 'calendar_get_pending_change', 'calendar_confirm_change',
  ].includes(tool.name))) {
    app.post(`/${tool.name}`, { schema: { body: tool.inputSchema } }, async (req) => {
      const result = await tool.execute(req.body, req, signal);
      return { outcome: 'ok', result, confirmation: confirmToolCall(tool.name, 'ok', result) };
    });
  }
  apps.push(app);
  return {
    pending,
    call: (tool: string, payload: object = {}) => app.inject({ method: 'POST', url: `/${tool}`, payload }),
    reply: (text: string, sessionId = '1') => {
      now += 1;
      latest = { ...latest, id: String(Number(latest.id) + 1), text, sessionId, at: new Date(now) };
    },
  };
}

describe('calendar batch module boundary', () => {
  it.each([2, 10])('stages all %s immutable summaries and writes only once after later approval', async (count) => {
    const request = vi.fn<GoogleApiClient['request']>(async () => ({ id: 'synthetic-created' }));
    const f = fixture(request);
    const events = count === 2 ? structuredClone(hotels) : Array.from({ length: count }, (_, index) => ({
      ...hotels[0], subject: `Synthetic hotel ${index + 1}`,
    }));
    const stage = (await f.call('calendar_create_events', { events })).json();
    expect(stage.outcome).toBe('ok');
    expect(stage.result.items).toHaveLength(count);
    if (count === 2) {
      expect(stage.result.summary).toContain('14 June 2027 at 15:00');
      expect(stage.result.summary).toContain('09 December 2027 at 16:00');
      expect(stage.result.summary).toContain('Europe/Copenhagen local time');
    }
    events[0]!.subject = 'Changed outside the captured proposal';
    expect(request).not.toHaveBeenCalled();
    const confirm = () => f.call('calendar_confirm_change', {
      confirmationCode: stage.result.confirmationCode,
    });
    expect((await confirm()).json().outcome).toBe('refused');
    f.reply('yes');
    const result = (await confirm()).json();
    expect(result).toMatchObject({ outcome: 'ok', result: { status: 'completed' } });
    expect(result.result.items.every((item: { status: string }) => item.status === 'completed')).toBe(true);
    expect(request).toHaveBeenCalledTimes(count);
    expect(JSON.stringify(request.mock.calls)).not.toContain('Changed outside');
    expect((await confirm()).json().outcome).toBe('refused');
    expect((await f.call('calendar_get_pending_change')).json().result.lastChange.summary)
      .toBe(stage.result.summary);
    expect(request).toHaveBeenCalledTimes(count);
  });

  it.each(['invalid-time', 'invalid-attendee', 'duplicate', 'one', 'eleven'])(
    'rejects %s without replacing an existing single-event proposal', async (invalid) => {
      const request = vi.fn<GoogleApiClient['request']>(async () => ({}));
      const f = fixture(request);
      const original = (await f.call('calendar_create_event', hotels[0]!)).json();
      const events = invalid === 'one' ? [hotels[0]] : invalid === 'eleven'
        ? Array.from({ length: 11 }, (_, index) => ({ ...hotels[0], subject: `Hotel ${index}` }))
        : invalid === 'duplicate' ? [hotels[0], hotels[0]]
        : [hotels[0], { ...hotels[1], ...(invalid === 'invalid-time'
          ? { endDateTime: '2027-12-01T00:00:00Z' } : { attendees: ['invalid-email'] }) }];
      const response = await f.call('calendar_create_events', { events });
      expect(response.statusCode === 400 || response.json().outcome === 'refused').toBe(true);
      expect((await f.call('calendar_get_pending_change')).json().result.confirmationCode)
        .toBe(original.result.confirmationCode);
      expect(request).not.toHaveBeenCalled();
      expect(f.pending.size).toBe(1);
    },
  );

  it.each(['forbidden', 'uncertain', 'unexpected', 'interrupted'] as const)(
    'preserves completed items, reports %s honestly and never replays them', async (kind) => {
      const abort = new AbortController();
      const request = vi.fn<GoogleApiClient['request']>()
        .mockResolvedValueOnce({ id: 'first-created' })
        .mockImplementationOnce(async () => {
          if (kind === 'interrupted') abort.abort();
          throw kind === 'unexpected' || kind === 'interrupted'
            ? new Error('Synthetic unclassified failure') : new GoogleApiError(kind);
        });
      const f = fixture(request, abort.signal);
      const events = [...hotels, { ...hotels[1], subject: 'Third synthetic hotel' }];
      const staged = (await f.call('calendar_create_events', { events })).json();
      f.reply('approved');
      const confirm = () => f.call('calendar_confirm_change', {
        confirmationCode: staged.result.confirmationCode,
      });
      const result = (await confirm()).json();
      expect(result).toMatchObject({ outcome: 'ok', result: { status: 'partial', items: [
        { status: 'completed' },
        { status: kind === 'forbidden' ? 'failed' : 'unverified' },
        { status: 'not_attempted' },
      ] } });
      expect(result.confirmation).toContain('1 of 3');
      expect(result.confirmation).not.toContain('Done:');
      expect((await confirm()).json().outcome).toBe('refused');
      expect(request).toHaveBeenCalledTimes(2);
      expect((await f.call('calendar_get_pending_change')).json().result.lastChange.items)
        .toEqual(result.result.items);
    },
  );

  it.each(['no', 'other-session'])('does not write after %s and preserves session boundaries', async (reply) => {
    const request = vi.fn<GoogleApiClient['request']>(async () => ({}));
    const f = fixture(request);
    const staged = (await f.call('calendar_create_events', { events: hotels })).json();
    f.reply(reply === 'no' ? 'no' : 'yes', reply === 'no' ? '1' : '2');
    const result = (await f.call('calendar_confirm_change', {
      confirmationCode: staged.result.confirmationCode,
    })).json();
    expect(result).toMatchObject(reply === 'no'
      ? { outcome: 'ok', result: { status: 'cancelled' } }
      : { outcome: 'refused' });
    expect(request).not.toHaveBeenCalled();
    expect(f.pending.size).toBe(reply === 'no' ? 0 : 1);
    expect(f.pending.pendingCalendarChange()).not.toHaveProperty('lastChange');
    expect(new PendingGoogleActions().pendingCalendarChange()).not.toHaveProperty('lastChange');
  });
});
