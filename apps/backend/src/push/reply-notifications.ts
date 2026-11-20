import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { containsSensitiveOwnerData, shouldRedact } from '../vault/index.js';
import type {
  ClaimedReplyNotificationDelivery,
  ReplyNotificationStore,
} from '../database/reply-notification-store.js';
import type { ApprovalNotificationSender } from './approval-notifications.js';

const replyCategory = 'jarvis.reply';
const privateReply = 'New reply from Jarvis';
const retryBackoffMs = [1_000, 5_000, 20_000, 60_000] as const;
export const replyNotificationMaxAttempts = 5;

export interface ReplyNotificationInput {
  readonly sessionId: string;
  readonly messageId: string;
  /** Retained for older callers; durable delivery never reconstructs content from this callback. */
  readonly text?: string;
}

export interface ReplyNotificationWorker {
  readonly notify: (reply: ReplyNotificationInput) => void;
  runOnce(): Promise<number>;
  start(): void;
  stop(): Promise<void>;
}

export interface ReplyNotificationWorkerOptions {
  readonly now?: () => number;
  readonly intervalMs?: number;
  readonly leaseMs?: number;
  readonly batchSize?: number;
}

export function safeReplyNotificationPreview(text: string): string {
  const line = Array.from(text, (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f) ? ' ' : character;
  }).join('').replace(/\s+/gu, ' ').trim();
  if (containsSensitiveOwnerData(line)) return privateReply;
  const characters = [...line];
  if (characters.length <= 160) return characters.join('') || privateReply;
  return `${characters.slice(0, 157).join('').trimEnd()}...`;
}

export function serializeReplyNotificationEvidence(
  evidence: Readonly<Record<string, unknown>> | undefined,
): string | null {
  if (evidence === undefined) return null;
  const serialized = JSON.stringify(evidence);
  if (serialized === undefined || Buffer.byteLength(serialized) > 8192 || shouldRedact(serialized)) {
    throw new TypeError('Invalid reply notification evidence');
  }
  return serialized;
}

export function replyNotificationPayload(
  input: Pick<ClaimedReplyNotificationDelivery, 'sessionId' | 'messageId'> & {
    readonly preview?: string;
    readonly text?: string;
  },
): Buffer {
  const preview = input.preview ?? safeReplyNotificationPreview(input.text ?? '');
  if (!validId(input.sessionId) || !validId(input.messageId) ||
      !preview.trim() || [...preview].length > 160) {
    throw new TypeError('Invalid reply notification');
  }
  return Buffer.from(JSON.stringify({
    aps: {
      alert: { title: 'Jarvis', body: preview },
      category: replyCategory,
      'thread-id': replyCategory,
      sound: 'default',
    },
    kind: 'reply',
    sessionID: input.sessionId,
    messageID: input.messageId,
  }));
}

function validId(value: string): boolean {
  return /^[1-9]\d{0,18}$/u.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n;
}

export function replyNotificationRetryAt(attemptCount: number, now: number, expiresAt: number): number | null {
  if (!Number.isInteger(attemptCount) || attemptCount < 1 || attemptCount >= replyNotificationMaxAttempts) return null;
  return Math.min(now + retryBackoffMs[attemptCount - 1]!, expiresAt);
}

export function createReplyNotificationWorker(
  owner: string,
  services: {
    readonly store: ReplyNotificationStore;
    readonly sender: ApprovalNotificationSender;
  },
  logger: Pick<FastifyBaseLogger, 'info' | 'warn'>,
  options: ReplyNotificationWorkerOptions = {},
): ReplyNotificationWorker {
  const now = options.now ?? Date.now;
  const intervalMs = options.intervalMs ?? 5_000;
  const batchSize = options.batchSize ?? 20;
  const leaseMs = options.leaseMs ?? Math.max(150_000, batchSize * 7_000);
  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | undefined;
  let rerun = false;
  let stopping = false;
  let controller = new AbortController();

  const runOnce = async (): Promise<number> => {
    const startedAt = now();
    const claimToken = randomUUID();
    const deliveries = await services.store.claimDue(
      owner,
      claimToken,
      new Date(startedAt),
      new Date(startedAt + leaseMs),
      batchSize,
    );
    let completed = 0;
    const invalidRegistrations = new Set<string>();
    for (const delivery of deliveries) {
      if (controller.signal.aborted) break;
      if (invalidRegistrations.has(delivery.registrationId)) continue;
      const payload = replyNotificationPayload(delivery);
      const expiresAt = delivery.expiresAt.getTime();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(6_000)]);
      let outcome: 'accepted' | 'retry' | 'failed' | 'expired' | 'invalid_token' = 'failed';
      let result: Awaited<ReturnType<ApprovalNotificationSender['send']>>;
      try {
        result = await services.sender.send(
          delivery.deviceToken,
          payload,
          expiresAt,
          signal,
          delivery.notificationId,
        );
      } catch {
        if (controller.signal.aborted) break;
        result = { accepted: false, invalidToken: false, retryable: true };
      }
      const statusCode = result.statusCode ?? null;
      try {
        if (result.invalidToken) {
          await services.store.invalidateRegistration(
            owner,
            delivery.registrationId,
            delivery.id,
            delivery.claimToken,
            delivery.deviceToken,
            statusCode,
          );
          invalidRegistrations.add(delivery.registrationId);
          outcome = 'invalid_token';
        } else if (result.accepted) {
          await services.store.accepted(delivery.id, delivery.claimToken, statusCode);
          outcome = 'accepted';
        } else if (expiresAt <= now()) {
          await services.store.expired(delivery.id, delivery.claimToken, statusCode);
          outcome = 'expired';
        } else if (result.retryable) {
          const retryAt = replyNotificationRetryAt(delivery.attemptCount, now(), expiresAt);
          if (retryAt === null) {
            await services.store.failed(
              delivery.id, delivery.claimToken, 'retry_exhausted', statusCode,
            );
          } else {
            await services.store.retry(
              delivery.id, delivery.claimToken, new Date(retryAt), statusCode,
            );
            outcome = 'retry';
          }
        } else {
          await services.store.failed(
            delivery.id, delivery.claimToken, 'provider_rejected', statusCode,
          );
        }
      } catch {
        logger.warn('reply_notification.persistence_unavailable');
        continue;
      }
      completed += 1;
      logger.info({
        outcome,
        attempt: delivery.attemptCount,
        ...(statusCode === null ? {} : { statusCode }),
      }, 'reply_notification.delivery_outcome');
    }
    return completed;
  };

  const run = (): void => {
    if (running) {
      rerun = true;
      return;
    }
    running = (async () => {
      try { await runOnce(); }
      catch { logger.warn('reply_notification.delivery_unavailable'); }
    })()
      .finally(() => {
        running = undefined;
        if (rerun && !stopping) {
          rerun = false;
          run();
        }
      });
  };

  return {
    notify: () => { if (!stopping) run(); },
    runOnce,
    start() {
      if (timer || stopping) return;
      controller = new AbortController();
      timer = setInterval(run, intervalMs);
      timer.unref();
      run();
    },
    async stop() {
      stopping = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      controller.abort();
      await running;
      stopping = false;
    },
  };
}
