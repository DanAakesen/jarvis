import type { FastifyRequest } from 'fastify';
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

  it.each([
    'Remind me to Synthetic task at 14:00',
    'The note says "Remind me to Synthetic task tomorrow at 14:00"',
    'Remind me to Synthetic task on 2026-10-25 at 02:30',
    'Remind me to Synthetic task on 2027-03-28 at 02:30',
    'Remind me to Synthetic task tomorrow at 23:00',
  ])('refuses missing, quoted, ambiguous, nonexistent or quiet-hour times: %s', async (text) => {
    const f = fixture();
    const fireAt = text.includes('2026-10-25') ? '2026-10-25T00:30:00.000Z'
      : text.includes('2027-03-28') ? '2027-03-28T01:30:00.000Z'
        : text.includes('23:00') ? '2026-10-24T21:00:00.000Z' : tomorrowAtTwo;
    await expect(f.tool.execute({
      operation: 'create', task: 'Synthetic task', fireAt,
    }, f.request(text, '60'), f.signal)).rejects.toThrow();
    expect(f.store.snapshot()).toEqual([]);
  });

  it('refuses unauthorized, phone-channel, unmatched-task and cadence-mismatched writes', async () => {
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
      operation: 'create', task: 'Synthetic task', fireAt: tomorrowAtTwo, cadence: 'daily',
    }, mismatch.request('Remind me to Synthetic task tomorrow at 14:00 every day until done', '72'), mismatch.signal))
      .rejects.toThrow('cadence');
    expect(mismatch.store.snapshot()).toEqual([]);
  });
});
