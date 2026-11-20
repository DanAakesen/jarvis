import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type {
  ClaimedReplyNotificationDelivery,
  ReplyNotificationApprovalClaim,
  ReplyNotificationDiagnostics,
  ReplyNotificationStore,
} from '../database/reply-notification-store.js';
import type { ApprovalNotificationSender } from './approval-notifications.js';
import { createApprovalNotificationDispatcher } from './approval-notifications.js';
import {
  createReplyNotificationWorker,
  replyNotificationMaxAttempts,
  replyNotificationPayload,
  replyNotificationRetryAt,
  safeReplyNotificationPreview,
  serializeReplyNotificationEvidence,
} from './reply-notifications.js';

interface FixtureDelivery extends ClaimedReplyNotificationDelivery {
  state: 'pending' | 'sending' | 'accepted' | 'failed' | 'expired' | 'invalid_token';
  nextAttemptAt: number;
  claimToken: string;
  result: string | null;
}

class DurableReplyStoreFixture implements ReplyNotificationStore {
  readonly approvals = new Set<string>();
  readonly approvalClaims: ReplyNotificationApprovalClaim[] = [];
  readonly deliveries: FixtureDelivery[];

  constructor(deliveries: FixtureDelivery[]) {
    this.deliveries = deliveries;
  }

  async claimApproval(input: ReplyNotificationApprovalClaim): Promise<boolean> {
    if (this.approvals.has(input.confirmationId)) return false;
    this.approvals.add(input.confirmationId);
    this.approvalClaims.push(input);
    return true;
  }

  async claimDue(
    _owner: string,
    claimToken: string,
    now: Date,
    _leaseUntil: Date,
    limit = 20,
  ): Promise<ClaimedReplyNotificationDelivery[]> {
    for (const delivery of this.deliveries) {
      if (delivery.state === 'pending' && delivery.expiresAt <= now) {
        delivery.state = 'expired';
        delivery.result = 'expired';
      }
    }
    const due = this.deliveries.filter((delivery) =>
      delivery.state === 'pending' && delivery.nextAttemptAt <= now.getTime());
    return due.slice(0, limit).map((delivery) => {
      delivery.state = 'sending';
      delivery.claimToken = claimToken;
      delivery.attemptCount += 1;
      return { ...delivery, claimToken };
    });
  }

  async accepted(id: string, claimToken: string): Promise<void> {
    this.finish(id, claimToken, 'accepted', 'accepted');
  }

  async retry(id: string, claimToken: string, nextAttemptAt: Date): Promise<void> {
    const delivery = this.delivery(id, claimToken);
    delivery.state = 'pending';
    delivery.nextAttemptAt = nextAttemptAt.getTime();
    delivery.result = 'transient';
  }

  async failed(id: string, claimToken: string, result: 'provider_rejected' | 'retry_exhausted'): Promise<void> {
    this.finish(id, claimToken, 'failed', result);
  }

  async expired(id: string, claimToken: string): Promise<void> {
    this.finish(id, claimToken, 'expired', 'expired');
  }

  async invalidateRegistration(
    _owner: string,
    registrationId: string,
    deliveryId: string,
    claimToken: string,
  ): Promise<void> {
    this.delivery(deliveryId, claimToken);
    for (const delivery of this.deliveries) {
      if (delivery.registrationId === registrationId &&
          (delivery.state === 'pending' || delivery.state === 'sending')) {
        delivery.state = 'invalid_token';
        delivery.result = 'apns_invalid_token';
      }
    }
  }

  async diagnostics(): Promise<ReplyNotificationDiagnostics> {
    return {
      pending: this.deliveries.filter((row) => row.state === 'pending' || row.state === 'sending').length,
      accepted: this.deliveries.filter((row) => row.state === 'accepted').length,
      failed: this.deliveries.filter((row) => row.state === 'failed').length,
      expired: this.deliveries.filter((row) => row.state === 'expired').length,
      invalidToken: this.deliveries.filter((row) => row.state === 'invalid_token').length,
      lastFailureAt: null,
    };
  }

  private delivery(id: string, claimToken: string): FixtureDelivery {
    const delivery = this.deliveries.find((candidate) =>
      candidate.id === id && candidate.claimToken === claimToken);
    if (!delivery) throw new Error('Stale fixture lease');
    return delivery;
  }

  private finish(
    id: string,
    claimToken: string,
    state: FixtureDelivery['state'],
    result: string,
  ): void {
    const delivery = this.delivery(id, claimToken);
    delivery.state = state;
    delivery.result = result;
  }
}

function delivery(overrides: Partial<FixtureDelivery> = {}): FixtureDelivery {
  return {
    id: randomUUID(),
    claimToken: '',
    registrationId: randomUUID(),
    deviceToken: 'ab'.repeat(32),
    sessionId: '41',
    messageId: '42',
    notificationId: 'reply-42',
    preview: 'Design review moved to 10:30',
    expiresAt: new Date('2026-11-20T05:00:00.000Z'),
    attemptCount: 0,
    state: 'pending',
    nextAttemptAt: Date.parse('2026-11-20T04:00:00.000Z'),
    result: null,
    ...overrides,
  };
}

const logger = () => ({ info: vi.fn(), warn: vi.fn() });

describe('reply notification contract', () => {
  it('keeps the lock-screen preview concise and private for sensitive content', () => {
    expect(safeReplyNotificationPreview('  Design review\n moved   to 10:30  '))
      .toBe('Design review moved to 10:30');
    expect(safeReplyNotificationPreview(`My password is ${'x'.repeat(20)}`))
      .toBe('New reply from Jarvis');
    expect([...safeReplyNotificationPreview('x'.repeat(500))]).toHaveLength(160);
    expect(serializeReplyNotificationEvidence({ category: 'work', evidenceSources: ['calendar'] }))
      .toBe('{"category":"work","evidenceSources":["calendar"]}');
    expect(() => serializeReplyNotificationEvidence({ secret: 'private' })).toThrow('Invalid');
  });

  it('carries the exact session and message identity', () => {
    const payload = JSON.parse(replyNotificationPayload(delivery()).toString('utf8'));
    expect(payload).toMatchObject({
      kind: 'reply',
      sessionID: '41',
      messageID: '42',
      aps: {
        category: 'jarvis.reply',
        alert: { body: 'Design review moved to 10:30' },
      },
    });
  });

  it('uses bounded backoff and stops after the attempt limit', () => {
    expect(replyNotificationRetryAt(1, 1_000, 100_000)).toBe(2_000);
    expect(replyNotificationRetryAt(4, 1_000, 100_000)).toBe(61_000);
    expect(replyNotificationRetryAt(1, 1_000, 1_500)).toBe(1_500);
    expect(replyNotificationRetryAt(replyNotificationMaxAttempts, 1_000, 100_000)).toBeNull();
  });

  it('claims approval suppression by confirmation and exact turn identity', async () => {
    const store = new DurableReplyStoreFixture([]);
    const confirmationId = 'a'.repeat(43);
    const sender: ApprovalNotificationSender = {
      send: vi.fn(async () => ({ accepted: true, invalidToken: false, statusCode: 200 })),
    };
    const dispatch = createApprovalNotificationDispatcher(
      randomUUID(),
      {
        store: {
          upsert: async () => true,
          list: async () => [{
            registrationId: randomUUID(),
            deviceToken: 'ab'.repeat(32),
            showActions: true,
            timeZone: 'Europe/Copenhagen',
          }],
          remove: async () => undefined,
        },
        sender,
        replyNotifications: store,
      },
      logger(),
    );
    const confirmation = {
      id: confirmationId,
      actionKind: 'calendar_change' as const,
      summary: 'Move design review',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      turnMessageId: '41',
    };

    dispatch(confirmation);
    dispatch(confirmation);
    await vi.waitFor(() => expect(sender.send).toHaveBeenCalledTimes(1));
    expect(store.approvalClaims).toEqual([{
      owner: expect.any(String),
      confirmationId,
      turnMessageId: '41',
      expiresAt: expect.any(Date),
    }]);
  });

  it('survives a worker restart and sends the stable identity only until accepted', async () => {
    let timestamp = Date.parse('2026-11-20T04:00:00.000Z');
    const durable = new DurableReplyStoreFixture([delivery()]);
    const identities: string[] = [];
    let attempts = 0;
    const sender: ApprovalNotificationSender = {
      send: vi.fn(async (_token, _payload, _expiresAt, _signal, notificationId) => {
        attempts += 1;
        identities.push(notificationId!);
        return attempts === 1
          ? { accepted: false, invalidToken: false, retryable: true, statusCode: 503 }
          : { accepted: true, invalidToken: false, statusCode: 200 };
      }),
    };

    const first = createReplyNotificationWorker(
      randomUUID(), { store: durable, sender }, logger(), { now: () => timestamp },
    );
    expect(await first.runOnce()).toBe(1);
    expect(durable.deliveries[0]?.state).toBe('pending');
    expect(durable.deliveries[0]?.attemptCount).toBe(1);

    timestamp += 1_000;
    const restarted = createReplyNotificationWorker(
      randomUUID(), { store: durable, sender }, logger(), { now: () => timestamp },
    );
    expect(await restarted.runOnce()).toBe(1);
    expect(durable.deliveries[0]?.state).toBe('accepted');
    expect(await restarted.runOnce()).toBe(0);
    expect(identities).toEqual(['reply-42', 'reply-42']);
  });

  it('invalidates a rejected token and skips queued deliveries for that registration', async () => {
    const registrationId = randomUUID();
    const durable = new DurableReplyStoreFixture([
      delivery({ registrationId }),
      delivery({ registrationId, messageId: '43', notificationId: 'reply-43' }),
    ]);
    const send = vi.fn(async () => ({
      accepted: false,
      invalidToken: true,
      statusCode: 410,
    }));
    const worker = createReplyNotificationWorker(
      randomUUID(),
      { store: durable, sender: { send } },
      logger(),
      { now: () => Date.parse('2026-11-20T04:00:00.000Z') },
    );

    expect(await worker.runOnce()).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(durable.deliveries.map(({ state }) => state)).toEqual(['invalid_token', 'invalid_token']);
  });

  it('does not retry permanent Apple rejection or expired rows', async () => {
    const durable = new DurableReplyStoreFixture([delivery()]);
    const sender: ApprovalNotificationSender = {
      send: vi.fn(async () => ({
        accepted: false,
        invalidToken: false,
        retryable: false,
        statusCode: 403,
      })),
    };
    const worker = createReplyNotificationWorker(
      randomUUID(),
      { store: durable, sender },
      logger(),
      { now: () => Date.parse('2026-11-20T04:00:00.000Z') },
    );

    await worker.runOnce();
    await worker.runOnce();
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(durable.deliveries[0]?.state).toBe('failed');

    const expired = new DurableReplyStoreFixture([
      delivery({ expiresAt: new Date('2026-11-20T03:59:00.000Z') }),
    ]);
    expect(await createReplyNotificationWorker(
      randomUUID(), { store: expired, sender }, logger(),
      { now: () => Date.parse('2026-11-20T04:00:00.000Z') },
    ).runOnce()).toBe(0);
    expect(expired.deliveries[0]?.state).toBe('expired');
  });
});
