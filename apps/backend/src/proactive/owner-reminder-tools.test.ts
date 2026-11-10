import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryOwnerReminderStore } from './owner-reminder-store.js';
import { createOwnerReminderTool } from './owner-reminder-tools.js';

const owner = '11111111-1111-4111-8111-111111111111';
const now = new Date('2026-10-23T08:00:00.000Z');
const dueDateOnly = '- [ ] Synthetic task 📅 2027-01-01';

function fixture(content = dueDateOnly, channel: 'chat' | 'voice' | 'phone' = 'chat') {
  const store = createMemoryOwnerReminderStore();
  const vault = {
    tree: vi.fn(async () => [{ path: 'Personal/Inbox.md', sha: 'a'.repeat(40) }]),
    read: vi.fn(async () => ({ path: 'Personal/Inbox.md', sha: 'a'.repeat(40), content })),
  };
  const tool = createOwnerReminderTool({ ownerObjectId: owner, store, vault, now: () => new Date(now) });
  const request = (text: string, id: string, objectId = owner) => ({
    principal: { objectId },
    agentPrincipal: null,
    jarvisConversationMessage: { id, sessionId: 'session-1', role: 'dan', text, at: now },
    server: {
      conversationStore: {
        getSession: async () => ({ id: 'session-1', channel, language: 'en', startedAt: now, endedAt: null }),
      },
    },
  } as unknown as FastifyRequest);
  const signal = new AbortController().signal;
  return { tool, store, vault, request, signal };
}

const tomorrowAtTwo = '2026-10-24T12:00:00.000Z';

describe('owner-requested reminder tool', () => {
  it.each([
    ['Remind me to Synthetic task tomorrow at 14:00', '2026-10-24T12:00:00Z'],
    ['Remind me to Synthetic task tomorrow at 14:00 once', '2026-10-24T14:00:00+02:00'],
    ['Mind mig om Synthetic task i morgen kl. 14:00 én gang', '2026-10-24T07:00:00-05:00'],
  ])('creates a one-time reminder and deduplicates equivalent timestamp retries: %s', async (text, fireAt) => {
    const f = fixture();
    const input = { operation: 'create', task: 'Synthetic task', fireAt, cadence: 'once' };
    const direct = f.request(text, '43');
    expect(f.tool.validateInput?.(input)).toBe(true);
    await expect(f.tool.execute(input, direct, f.signal)).resolves.toMatchObject({ created: true });
    await expect(f.tool.execute({ ...input, fireAt: tomorrowAtTwo }, direct, f.signal))
      .resolves.toMatchObject({ created: false });
    expect(f.store.snapshot()).toHaveLength(1);
    expect(f.store.snapshot()[0]).toMatchObject({ cadence: null, fireAt: new Date(tomorrowAtTwo) });
  });

  it.each(['2026-10-24T22:00:00+02:00', '2026-10-25T00:00:00+02:00',
    '2026-10-25T02:30:00+02:00', '2026-10-25T02:30:00+01:00', '2026-10-25T07:00:00+01:00'])(
    'creates, reschedules and snoozes the exact requested instant %s', async (fireAt) => {
      const f = fixture();
      await f.tool.execute({ operation: 'create', task: 'Synthetic task', fireAt },
        f.request('Remind me at that time', '90'), f.signal);
      const id = f.store.snapshot()[0]!.id;
      for (const operation of ['update', 'snooze']) {
        await f.tool.execute({ operation, id, task: 'Synthetic task', fireAt },
          f.request('Move it to that time', '91'), f.signal);
        expect((await f.store.get(id))?.fireAt).toEqual(new Date(fireAt));
      }
      expect(f.tool.description).toContain('allowed during 22:00–07:00');
    });

  it('saves a time-only request for today and rejects a past time without moving it to tomorrow', async () => {
    const f = fixture();
    await expect(f.tool.execute({ operation: 'create', task: 'Synthetic task', fireAt: '2026-10-23T15:10:00Z' },
      f.request('Remind me at 17.10', '44'), f.signal)).resolves.toMatchObject({
        reminder: { fireAt: '2026-10-23 17:10 Copenhagen time' },
      });
    await expect(f.tool.execute({ operation: 'create', task: 'Synthetic task', fireAt: '2026-10-23T07:10:00Z' },
      f.request('Remind me at 09.10', '45'), f.signal)).rejects.toThrow('future reminder time');
    expect(f.store.snapshot()).toHaveLength(1);
  });

  it('advertises the same per-operation shape and timestamp requirements that it validates', async () => {
    const f = fixture();
    const app = Fastify();
    let parsedInput: unknown;
    app.post('/', { schema: { body: f.tool.inputSchema } }, async (request) => {
      parsedInput = structuredClone(request.body);
      return { accepted: true };
    });
    const create = { operation: 'create', task: 'Synthetic task', fireAt: tomorrowAtTwo };
    const update = { ...create, operation: 'update', id: owner };
    const cases: [unknown, boolean][] = [
      [{ operation: 'read' }, true], [{ operation: 'read', task: 'Synthetic task' }, false],
      [create, true], [{ ...create, cadence: 'once' }, true], [{ ...create, id: owner }, false],
      [{ ...create, task: '   ' }, false], [{ ...create, cadence: 'once', untilTaskDone: true }, false],
      [{ ...create, fireAt: '2026-10-24T14:00:00+02:00' }, true],
      [{ ...create, fireAt: '2026-10-24T12:00:00Z' }, true],
      [{ ...create, fireAt: '2026-02-30T14:00:00Z' }, false],
      [{ ...create, fireAt: '2026-10-24T14:00:00' }, false],
      [{ operation: 'create' }, false], [update, true], [{ ...create, operation: 'update' }, false],
      [{ ...update, operation: 'snooze' }, true], [{ ...update, operation: 'snooze', cadence: 'daily' }, false],
      [{ operation: 'cancel', id: owner, task: 'Synthetic task' }, true],
      [{ operation: 'cancel', id: owner }, false], [{ ...update, operation: 'cancel' }, false],
      [{ ...create, extra: 'private-value' }, false],
    ];
    try {
      for (const [input, valid] of cases) {
        expect(f.tool.validateInput?.(input), JSON.stringify(input)).toBe(valid);
        // Strict guards run before Fastify can strip unknown fields in production.
        if (!valid && Object.hasOwn(input as object, 'extra')) continue;
        const response = await app.inject({ method: 'POST', url: '/', payload: input as object });
        expect(response.statusCode, JSON.stringify(input)).toBe(valid ? 200 : 400);
        if (valid) {
          expect(response.json()).toEqual({ accepted: true });
          expect(parsedInput).toEqual(input);
        }
      }
    } finally {
      await app.close();
    }
    expect(f.store.snapshot()).toEqual([]);
  });

  it('creates an independent date-only task reminder from a direct English request and deduplicates tool retries', async () => {
    const f = fixture();
    const direct = f.request('Remind me to Synthetic task tomorrow at 14:00 every day until done', '42');
    const input = {
      operation: 'create', task: 'Synthetic task', fireAt: tomorrowAtTwo, cadence: 'daily', untilTaskDone: true,
    };

    const first = await f.tool.execute(input, direct, f.signal);
    const retry = await f.tool.execute(input, direct, f.signal);
    expect(first).toMatchObject({
      operation: 'create',
      created: true,
      reminder: { task: 'Synthetic task', fireAt: '2026-10-24 14:00 Copenhagen time', repeat: 'every day until the task is completed' },
    });
    expect(retry).toMatchObject({ created: false });
    expect(f.store.snapshot()).toHaveLength(1);
    expect(f.store.snapshot()[0]?.fireAt.toISOString()).toBe(tomorrowAtTwo);
    expect(f.vault.read).toHaveBeenCalledOnce();
  });

  it('creates from a direct Danish voice request, lists and snoozes the same schedule, then cancels it', async () => {
    const f = fixture(dueDateOnly, 'voice');
    const created = await f.tool.execute({
      operation: 'create', task: 'Synthetic task', fireAt: tomorrowAtTwo, cadence: 'weekly', untilTaskDone: true,
    }, f.request('Mind mig om Synthetic task i morgen kl. 14:00 hver uge indtil opgaven er færdig', '50'), f.signal);
    const id = (created as { reminder: { id: string } }).reminder.id;
    expect(created).toMatchObject({ created: true });

    await expect(f.tool.execute({ operation: 'read' }, f.request('', '51'), f.signal))
      .resolves.toMatchObject({ reminders: [{ id, state: 'scheduled', repeat: 'every week until the task is completed' }] });

    await f.tool.execute({
      operation: 'snooze', id, task: 'Synthetic task', fireAt: '2026-10-25T14:00:00.000Z',
    }, f.request('Snooze my reminder for Synthetic task until 2026-10-25 at 15:00', '52'), f.signal);
    expect((await f.store.get(id))?.fireAt.toISOString()).toBe('2026-10-25T14:00:00.000Z');

    await f.tool.execute({
      operation: 'update', id, task: 'Synthetic task', fireAt: '2026-10-26T15:00:00.000Z',
    }, f.request('Change my reminder for Synthetic task to 2026-10-26 at 16:00', '53'), f.signal);
    expect((await f.store.get(id))?.fireAt.toISOString()).toBe('2026-10-26T15:00:00.000Z');

    await f.tool.execute({ operation: 'cancel', id, task: 'Synthetic task' },
      f.request('Cancel my reminder for Synthetic task', '54'), f.signal);
    expect((await f.store.get(id))?.state).toBe('cancelled');
  });

  it.each(['Set a new reminder for 17.10 to check notifications', 'Yes', 'In two minutes please', 'Mind mig om det kl. 17.10'])(
    'executes resolved conversation intent without a command sentence: %s', async (text) => {
      const f = fixture();
      const input = { operation: 'create', task: 'Synthetic task', fireAt: tomorrowAtTwo };
      await expect(f.tool.execute(input, f.request(text, '60'), f.signal)).resolves.toMatchObject({ created: true });
      await expect(f.tool.execute(input, f.request(text, '60'), f.signal)).resolves.toMatchObject({ created: false });
      expect(f.store.snapshot()).toHaveLength(1);
    });

  it.each(['2026-10-22T12:00:00Z', '2028-01-01T12:00:00Z'])(
    'retains schedule validity checks for %s', async (fireAt) => {
      const f = fixture();
      await expect(f.tool.execute({ operation: 'create', task: 'Synthetic task', fireAt },
        f.request('Set that reminder', '61'), f.signal)).rejects.toThrow();
      expect(f.store.snapshot()).toEqual([]);
    });

  it('refuses unauthorized, phone-channel and unmatched-task writes', async () => {
    const unauthorized = fixture();
    await expect(unauthorized.tool.execute({
      operation: 'create', task: 'Synthetic task', fireAt: tomorrowAtTwo,
    }, unauthorized.request('Remind me to Synthetic task tomorrow at 14:00', '70', '22222222-2222-4222-8222-222222222222'),
    unauthorized.signal)).rejects.toThrow('not authorized');

    const phone = fixture(dueDateOnly, 'phone');
    await expect(phone.tool.execute({
      operation: 'create', task: 'Synthetic task', fireAt: tomorrowAtTwo,
    }, phone.request('Remind me to Synthetic task tomorrow at 14:00', '71'), phone.signal))
      .rejects.toThrow('active chat or voice');

    const mismatch = fixture();
    await expect(mismatch.tool.execute({
      operation: 'create', task: 'Missing task', fireAt: tomorrowAtTwo,
    }, mismatch.request('Remind me to Synthetic task tomorrow at 14:00 every day until done', '72'), mismatch.signal))
      .rejects.toThrow('could not find that open task');
    expect(mismatch.store.snapshot()).toEqual([]);
  });
});
