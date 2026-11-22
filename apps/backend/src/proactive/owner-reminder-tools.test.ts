import type { FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createMemoryOwnerReminderStore } from './owner-reminder-store.js';
import { createOwnerReminderTool } from './owner-reminder-tools.js';

const owner = randomUUID();
const now = new Date('2026-11-20T10:00:00.000Z');
const taskTitle = 'Send the final draft';

function vault() {
  const path = 'Personal/Tasks.md';
  const content = `- [ ] ${taskTitle} 🆔 reminder-tool-task`;
  return {
    tree: async () => [{ path, sha: 'fixture-sha', size: Buffer.byteLength(content) }],
    read: async () => ({ path, sha: 'fixture-sha', content }),
  };
}

function ownerRequest(): FastifyRequest {
  return {
    headers: {},
    principal: { objectId: owner },
    agentPrincipal: null,
    jarvisConversationMessage: {
      id: '41',
      sessionId: '7',
      role: 'dan',
      text: 'Remind me in five minutes to send the final draft.',
    },
    server: {
      conversationStore: {
        getSession: async () => ({ endedAt: null, channel: 'chat' }),
      },
    },
  } as unknown as FastifyRequest;
}

describe('owner_reminders delivery evidence', () => {
  it('confirms only persistence at creation, not device delivery', async () => {
    const store = createMemoryOwnerReminderStore();
    const tool = createOwnerReminderTool({
      ownerObjectId: owner,
      store,
      vault: vault() as never,
      now: () => now,
    });
    const result = await tool.execute({
      operation: 'create',
      task: taskTitle,
      fireAt: '2026-11-20T10:05:00.000Z',
    }, ownerRequest(), AbortSignal.timeout(1_000)) as {
      created: boolean;
      reminder: Record<string, unknown>;
      confirmation: string;
    };

    expect(result.created).toBe(true);
    expect(result.confirmation).toContain('saved and scheduled');
    expect(result.confirmation).toContain('Device delivery has not been attempted');
    expect(result.reminder).toMatchObject({
      state: 'scheduled',
      attempts: 0,
      providerOutcome: null,
      deviceAcknowledgement: 'unavailable',
      deliveryEvidence: 'not_attempted',
    });
  });

  it('explains the durable retry state and provider outcome on follow-up read', async () => {
    const store = createMemoryOwnerReminderStore();
    const tool = createOwnerReminderTool({
      ownerObjectId: owner,
      store,
      vault: vault() as never,
      now: () => now,
    });
    const created = await tool.execute({
      operation: 'create',
      task: taskTitle,
      fireAt: '2026-11-20T10:05:00.000Z',
    }, ownerRequest(), AbortSignal.timeout(1_000)) as { reminder: { id: string } };
    const [claimed] = await store.claimDue(
      new Date('2026-11-20T10:05:00.000Z'),
      1,
      120_000,
    );
    await store.finishClaim(claimed!.id, claimed!.claimToken!, {
      state: 'retrying',
      reason: 'provider_unavailable',
      sendAttempts: 1,
      nextAttemptAt: new Date('2026-11-20T10:10:00.000Z'),
      lastDelivery: 'retrying',
      lastProviderOutcome: 'provider_unavailable',
      lastProviderStatusCode: 503,
      recipientCount: 1,
      acceptedRecipientCount: 0,
    });

    const read = await tool.execute(
      { operation: 'read' },
      ownerRequest(),
      AbortSignal.timeout(1_000),
    ) as {
      reminders: Array<Record<string, unknown>>;
      deliveryNote: string;
    };
    expect(created.reminder.id).toBe(read.reminders[0]?.id);
    expect(read.reminders[0]).toMatchObject({
      state: 'retrying',
      delivery: 'retrying',
      reason: 'provider_unavailable',
      attempts: 1,
      recipients: 1,
      acceptedRecipients: 0,
      providerOutcome: 'provider_unavailable',
      providerStatusCode: 503,
      nextActionAt: '2026-11-20 11:10 Copenhagen time',
      nextRetryAt: '2026-11-20 11:10 Copenhagen time',
      deviceAcknowledgement: 'unavailable',
      deliveryEvidence: 'durable',
    });
    expect(read.reminders[0]?.recovery).toMatch(/retry.*11:10/u);
    expect(read.deliveryNote).toMatch(/Scheduling is separate/u);
  });

  it('saves every reminder one message asks for, and answers "already saved" only for the same request', async () => {
    const store = createMemoryOwnerReminderStore();
    const path = 'Personal/Tasks.md';
    const content = `- [ ] ${taskTitle} 🆔 reminder-tool-task\n- [ ] Book the train 🆔 reminder-tool-train`;
    const tool = createOwnerReminderTool({
      ownerObjectId: owner,
      store,
      vault: {
        tree: async () => [{ path, sha: 'fixture-sha', size: Buffer.byteLength(content) }],
        read: async () => ({ path, sha: 'fixture-sha', content }),
      } as never,
      now: () => now,
    });
    const ask = (task: string, fireAt: string) => tool.execute(
      { operation: 'create', task, fireAt }, ownerRequest(), AbortSignal.timeout(1_000),
    ) as Promise<{ created: boolean; reminder: { id: string; task: string } }>;

    const draft = await ask(taskTitle, '2026-11-20T10:05:00.000Z');
    const train = await ask('Book the train', '2026-11-20T11:00:00.000Z');
    const repeat = await ask(taskTitle, '2026-11-20T10:05:00.000Z');

    expect([draft.created, train.created, repeat.created]).toEqual([true, true, false]);
    expect(train.reminder.task).toBe('Book the train');
    expect(repeat.reminder.id).toBe(draft.reminder.id);
    expect(await store.list(20)).toHaveLength(2);
  });

  it('takes the same instant in another offset for a retry, not a second reminder', async () => {
    const store = createMemoryOwnerReminderStore();
    const tool = createOwnerReminderTool({ ownerObjectId: owner, store, vault: vault() as never, now: () => now });
    const ask = (fireAt: string) => tool.execute(
      { operation: 'create', task: taskTitle, fireAt }, ownerRequest(), AbortSignal.timeout(1_000),
    ) as Promise<{ created: boolean; reminder: { id: string } }>;

    const first = await ask('2026-11-20T10:05:00.000Z');
    const retry = await ask('2026-11-20T11:05:00+01:00');
    const spelled = await ask('2026-11-20T10:05:00Z');

    expect([first.created, retry.created, spelled.created]).toEqual([true, false, false]);
    expect(retry.reminder.id).toBe(first.reminder.id);
    expect(spelled.reminder.id).toBe(first.reminder.id);
    expect(await store.list(20)).toHaveLength(1);
  });

  it('returns an actionable invalid-token reason rather than an unexplained row', async () => {
    const store = createMemoryOwnerReminderStore();
    const { schedule } = await store.create({
      idempotencyKey: 'd'.repeat(64),
      taskIdentity: 'e'.repeat(64),
      taskTitle,
      fireAt: now,
      localTime: '11:00',
      anchorDate: null,
      cadence: null,
      untilTaskDone: false,
    }, new Date(now.getTime() - 300_000));
    const [claimed] = await store.claimDue(now, 1, 120_000);
    await store.finishClaim(schedule.id, claimed!.claimToken!, {
      state: 'suppressed',
      reason: 'apns_invalid_token',
      sendAttempts: 1,
      lastDelivery: 'suppressed',
      lastProviderOutcome: 'apns_invalid_token',
      lastProviderStatusCode: 410,
      recipientCount: 1,
      acceptedRecipientCount: 0,
    });
    const read = await createOwnerReminderTool({
      ownerObjectId: owner,
      store,
      vault: vault() as never,
      now: () => now,
    }).execute({ operation: 'read' }, ownerRequest(), AbortSignal.timeout(1_000)) as {
      reminders: Array<Record<string, unknown>>;
    };

    expect(read.reminders[0]).toMatchObject({
      state: 'suppressed',
      reason: 'apns_invalid_token',
      providerOutcome: 'apns_invalid_token',
      providerStatusCode: 410,
    });
    expect(read.reminders[0]?.recovery).toMatch(/registers a new notification token/u);
  });

  it('says evidence is unavailable when a due reminder has no recorded attempt', async () => {
    const store = createMemoryOwnerReminderStore();
    await store.create({
      idempotencyKey: 'f'.repeat(64),
      taskIdentity: 'a'.repeat(64),
      taskTitle,
      fireAt: new Date(now.getTime() - 300_000),
      localTime: '10:55',
      anchorDate: null,
      cadence: null,
      untilTaskDone: false,
    }, new Date(now.getTime() - 600_000));
    const read = await createOwnerReminderTool({
      ownerObjectId: owner,
      store,
      vault: vault() as never,
      now: () => now,
    }).execute({ operation: 'read' }, ownerRequest(), AbortSignal.timeout(1_000)) as {
      reminders: Array<Record<string, unknown>>;
    };

    expect(read.reminders[0]).toMatchObject({
      state: 'scheduled',
      attempts: 0,
      deliveryEvidence: 'not_attempted',
    });
    expect(read.reminders[0]?.recovery).toMatch(/no delivery attempt is recorded.*evidence is unavailable/u);
  });
  it('returns a cancelled reminder with no next retry and a cancellation reason', async () => {
    const store = createMemoryOwnerReminderStore();
    const tool = createOwnerReminderTool({
      ownerObjectId: owner,
      store,
      vault: vault() as never,
      now: () => now,
    });
    const created = await tool.execute({
      operation: 'create',
      task: taskTitle,
      fireAt: '2026-11-20T10:05:00.000Z',
    }, ownerRequest(), AbortSignal.timeout(1_000)) as { reminder: { id: string } };
    const [claimed] = await store.claimDue(new Date('2026-11-20T10:05:00.000Z'), 1, 120_000);
    await store.finishClaim(claimed!.id, claimed!.claimToken!, {
      state: 'retrying',
      reason: 'provider_unavailable',
      sendAttempts: 1,
      nextAttemptAt: new Date('2026-11-20T10:10:00.000Z'),
      lastDelivery: 'retrying',
      lastProviderOutcome: 'provider_unavailable',
    });

    const result = await tool.execute({
      operation: 'cancel',
      id: created.reminder.id,
      task: taskTitle,
    }, ownerRequest(), AbortSignal.timeout(1_000)) as { cancelled: boolean; reminder: Record<string, unknown> };

    expect(result.cancelled).toBe(true);
    expect(result.reminder).toMatchObject({
      state: 'cancelled',
      reason: 'cancelled',
      nextRetryAt: null,
      nextActionAt: null,
      recovery: 'The reminder is cancelled.',
    });
  });
});
