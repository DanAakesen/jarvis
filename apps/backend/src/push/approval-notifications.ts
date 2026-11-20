import { connect, type ClientHttp2Session } from 'node:http2';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { importPKCS8, SignJWT } from 'jose';
import { ConfigurationError } from '../config.js';
import type { ApprovalNotificationRegistration, ApprovalNotificationStore } from '../database/approval-notification-store.js';
import type { ReplyNotificationStore } from '../database/reply-notification-store.js';
import type { BrowserConfirmation } from '../core/owner-interactions.js';
import { loadApnsConfig, type ApnsConfig } from './activitykit.js';
export { replyNotificationPayload } from './reply-notifications.js';
export type { ReplyNotificationInput } from './reply-notifications.js';

const deviceTokenPattern = /^(?:[0-9a-f]{2}){32,256}$/iu;
const confirmationIdPattern = /^[A-Za-z0-9_-]{43}$/u;
const approvalCategory = 'jarvis.approval';
const privateApprovalCategory = 'jarvis.approval.private';

export interface ApprovalNotificationPushResult {
  accepted: boolean;
  invalidToken: boolean;
  retryable?: boolean;
  statusCode?: number;
}

export interface ApprovalNotificationSender {
  send(
    token: string,
    payload: Buffer,
    expiresAt: number,
    signal: AbortSignal,
    notificationId?: string,
  ): Promise<ApprovalNotificationPushResult>;
}

export interface ApprovalNotificationServices {
  store: ApprovalNotificationStore;
  sender: ApprovalNotificationSender;
  replyNotifications: ReplyNotificationStore;
}

export interface ApprovalNotificationDispatcher {
  (confirmation: BrowserConfirmation): Promise<void>;
  waitForTurn(turnMessageId: string): Promise<void>;
}

export interface ApprovalNotificationDispatcherOptions {
  readonly persistenceRetryDelaysMs?: readonly number[];
  readonly reconciliationAttempts?: number;
  readonly reconciliationPollMs?: number;
}

export interface ApprovalNotificationPayloadInput extends BrowserConfirmation {
  showActions: boolean;
  timeZone: string;
}

export function loadApprovalNotificationConfig(
  env: NodeJS.ProcessEnv = process.env,
): ApnsConfig | undefined {
  const enabled = env.JARVIS_APPROVAL_NOTIFICATIONS_ENABLED;
  if (enabled === undefined || enabled === 'false') return undefined;
  if (enabled !== 'true') {
    throw new ConfigurationError('JARVIS_APPROVAL_NOTIFICATIONS_ENABLED must be true or false');
  }
  return loadApnsConfig(env);
}

export function approvalNotificationPayload(input: ApprovalNotificationPayloadInput): Buffer {
  const expiresAt = Date.parse(input.expiresAt);
  if (!confirmationIdPattern.test(input.id) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new TypeError('Invalid approval notification');
  }
  const summary = Array.from(input.summary, (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f) ? ' ' : character;
  }).join('').trim();
  const boundedSummary = [...summary].slice(0, 240).join('');
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: input.timeZone,
    timeZoneName: 'short',
  }).format(expiresAt);
  const expiry = `Expires at ${time}`;
  const body = `${boundedSummary}\n${expiry}`;
  return Buffer.from(JSON.stringify({
    aps: {
      alert: { title: 'Jarvis', body },
      category: input.showActions ? approvalCategory : privateApprovalCategory,
      'thread-id': approvalCategory,
      sound: 'default',
    },
    confirmationID: input.id,
  }));
}

export async function createApprovalNotificationSender(
  config: ApnsConfig,
  now: () => number = Date.now,
  open: typeof connect = connect,
): Promise<ApprovalNotificationSender> {
  let key: Awaited<ReturnType<typeof importPKCS8>>;
  try {
    key = await importPKCS8(config.signingKey, 'ES256');
    await new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).sign(key);
  } catch {
    throw new ConfigurationError('APNS_SIGNING_KEY must be an ES256 PKCS8 private key');
  }
  let cached: { token: string; at: number } | undefined;
  const authority = config.environment === 'sandbox'
    ? 'https://api.sandbox.push.apple.com'
    : 'https://api.push.apple.com';
  return {
    async send(token, payload, expiresAt, signal, notificationId) {
      signal.throwIfAborted();
      if (!deviceTokenPattern.test(token)) throw new TypeError('Invalid APNs device token');
      if (!Buffer.isBuffer(payload) || payload.length === 0 || payload.length > 4096) {
        throw new TypeError('Invalid APNs notification payload');
      }
      if (notificationId !== undefined &&
          (notificationId.length < 1 || notificationId.length > 64 ||
            !/^[A-Za-z0-9_.:-]+$/u.test(notificationId))) {
        throw new TypeError('Invalid APNs notification identity');
      }
      const at = now();
      if (expiresAt <= at) return { accepted: false, invalidToken: false };
      if (!cached || at < cached.at || at - cached.at >= 50 * 60_000) {
        cached = {
          token: await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: config.keyId })
            .setIssuer(config.teamId).setIssuedAt(Math.floor(at / 1000)).sign(key),
          at,
        };
      }
      return new Promise<ApprovalNotificationPushResult>((resolve) => {
        let session: ClientHttp2Session | undefined;
        let settled = false;
        const finish = (result?: ApprovalNotificationPushResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          signal.removeEventListener('abort', abort);
          session?.destroy();
          if (result) resolve(result);
          else resolve({ accepted: false, invalidToken: false, retryable: true });
        };
        const abort = () => { finish(); };
        const timeout = setTimeout(abort, 5000);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) return finish();
        try {
          session = open(authority);
          session.on('error', abort);
          session.on('close', () => { if (!settled) finish(); });
          const stream = session.request({
            ':method': 'POST',
            ':path': `/3/device/${token}`,
            authorization: `bearer ${cached!.token}`,
            'apns-topic': 'com.danaakesen.jarvis',
            'apns-push-type': 'alert',
            'apns-priority': '10',
            'apns-expiration': String(Math.floor(expiresAt / 1000)),
            'content-type': 'application/json',
            ...(notificationId === undefined ? {} : { 'apns-collapse-id': notificationId }),
          });
          let status = 0;
          let length = 0;
          const chunks: Buffer[] = [];
          stream.on('response', (headers) => { status = Number(headers[':status']); });
          stream.on('error', abort);
          stream.on('aborted', abort);
          stream.on('data', (chunk: Buffer) => {
            length += chunk.length;
            if (length > 4096) finish();
            else chunks.push(chunk);
          });
          stream.on('end', () => {
            let reason: unknown;
            try { reason = (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { reason?: unknown }).reason; }
            catch { /* Successful APNs responses have no body. */ }
            finish({
              accepted: status === 200,
              invalidToken: status === 410 || status === 400 &&
                ['BadDeviceToken', 'DeviceTokenNotForTopic'].includes(String(reason)),
              statusCode: status,
              ...(status === 429 || status >= 500 && status <= 599 ? { retryable: true } : {}),
            });
          });
          stream.end(payload);
        } catch { finish(); }
      });
    },
  };
}

function validateRegistration(value: unknown): ApprovalNotificationRegistration | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['deviceToken', 'showActions', 'timeZone'].includes(key)) ||
      typeof input.deviceToken !== 'string' || !deviceTokenPattern.test(input.deviceToken) ||
      typeof input.showActions !== 'boolean' ||
      typeof input.timeZone !== 'string' || input.timeZone.length === 0 || input.timeZone.length > 64 ||
      !validTimeZone(input.timeZone)) return;
  return {
    deviceToken: input.deviceToken.toLowerCase(),
    showActions: input.showActions,
    timeZone: input.timeZone,
  };
}

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function createApprovalNotificationDispatcher(
  owner: string,
  services: ApprovalNotificationServices,
  logger: Pick<FastifyBaseLogger, 'warn'>,
  now: () => number = Date.now,
  options: ApprovalNotificationDispatcherOptions = {},
): ApprovalNotificationDispatcher {
  const inFlightByTurn = new Map<string, Set<Promise<void>>>();
  const acceptedPendingPersistence = new Map<string, Set<string>>();
  const persistenceRetryDelaysMs = options.persistenceRetryDelaysMs ?? [0, 50, 200, 750];
  const reconciliationAttempts = options.reconciliationAttempts ?? 90;
  const reconciliationPollMs = options.reconciliationPollMs ?? 100;

  const persist = async (write: () => Promise<void>): Promise<boolean> => {
    for (let attempt = 0; attempt <= persistenceRetryDelaysMs.length; attempt += 1) {
      try {
        await write();
        return true;
      } catch {
        logger.warn('approval_notification.persistence_unavailable');
        const delay = persistenceRetryDelaysMs[attempt];
        if (delay !== undefined) {
          await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, delay)));
        }
      }
    }
    return false;
  };

  const deliver = async (confirmation: BrowserConfirmation): Promise<void> => {
    try {
      const expiresAt = Date.parse(confirmation.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= now()) return;
      const claim = await services.replyNotifications.claimApproval({
        owner,
        confirmationId: confirmation.id,
        turnMessageId: confirmation.turnMessageId ?? null,
        expiresAt: new Date(expiresAt),
      });
      if (!claim.claimed) return;
      await Promise.all(claim.deliveries.map(async (registration) => {
        let result: ApprovalNotificationPushResult;
        try {
          result = await services.sender.send(
            registration.deviceToken,
            approvalNotificationPayload({
              ...confirmation,
              showActions: registration.showActions,
              timeZone: registration.timeZone,
            }),
            expiresAt,
            AbortSignal.timeout(6000),
            confirmation.id,
          );
        } catch {
          logger.warn('approval_notification.push_unavailable');
          await persist(() =>
            services.replyNotifications.approvalFailed(
              owner,
              confirmation.id,
              registration.registrationId,
              'transport_unavailable',
              null,
            ),
          );
          return;
        }
        if (result.invalidToken) {
          await persist(() =>
            services.replyNotifications.approvalInvalidToken(
              owner,
              confirmation.id,
              registration.registrationId,
              registration.deviceToken,
              result.statusCode ?? null,
            ),
          );
        } else if (result.accepted) {
          const acceptedTurn = confirmation.turnMessageId;
          const persistenceKey = `${confirmation.id}:${registration.registrationId}`;
          if (acceptedTurn !== undefined) {
            const pending = acceptedPendingPersistence.get(acceptedTurn) ?? new Set<string>();
            pending.add(persistenceKey);
            acceptedPendingPersistence.set(acceptedTurn, pending);
          }
          const saved = await persist(() =>
            services.replyNotifications.approvalAccepted(
              owner, confirmation.id, registration.registrationId, result.statusCode ?? null,
            ),
          );
          if (saved && acceptedTurn !== undefined) {
            const pending = acceptedPendingPersistence.get(acceptedTurn);
            pending?.delete(persistenceKey);
            if (pending?.size === 0) acceptedPendingPersistence.delete(acceptedTurn);
          }
        } else {
          await persist(() =>
            services.replyNotifications.approvalFailed(
              owner,
              confirmation.id,
              registration.registrationId,
              'provider_rejected',
              result.statusCode ?? null,
            ),
          );
          logger.warn('approval_notification.push_not_accepted');
        }
      }));
    } catch {
      logger.warn('approval_notification.delivery_unavailable');
    }
  };

  const dispatch = ((confirmation: BrowserConfirmation) => {
    const operation = deliver(confirmation);
    const turnMessageId = confirmation.turnMessageId;
    if (turnMessageId !== undefined) {
      const operations = inFlightByTurn.get(turnMessageId) ?? new Set<Promise<void>>();
      operations.add(operation);
      inFlightByTurn.set(turnMessageId, operations);
      void operation.finally(() => {
        operations.delete(operation);
        if (operations.size === 0) inFlightByTurn.delete(turnMessageId);
      });
    }
    return operation;
  }) as ApprovalNotificationDispatcher;

  dispatch.waitForTurn = async (turnMessageId: string): Promise<void> => {
    for (let attempt = 0; attempt < reconciliationAttempts; attempt += 1) {
      const operations = inFlightByTurn.get(turnMessageId);
      if (operations?.size) {
        await Promise.allSettled([...operations]);
        continue;
      }
      if (acceptedPendingPersistence.has(turnMessageId)) {
        logger.warn('approval_notification.accepted_outcome_unavailable');
        throw new Error('Approval notification outcome could not be reconciled');
      }
      try {
        if (await services.replyNotifications.reconciliationComplete(
          owner, turnMessageId,
        )) return;
      } catch {
        logger.warn('approval_notification.persistence_unavailable');
        throw new Error('Approval notification reconciliation is unavailable');
      }
      await new Promise<void>((resolve) => setTimeout(resolve, reconciliationPollMs));
    }
    logger.warn('approval_notification.reconciliation_timeout');
    throw new Error('Approval notification reconciliation timed out');
  };

  return dispatch;
}

export function registerApprovalNotificationRoutes<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>,
  services?: Pick<ApprovalNotificationServices, 'store' | 'sender'>,
): void {
  app.post('/ios/approval-notifications', { bodyLimit: 2048 }, async (request, reply) => {
    if (request.principal?.objectId.toLowerCase() !== app.ownerObjectId.toLowerCase()) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    if (!services) return reply.code(503).send({ error: 'approval_notifications_unavailable' });
    const registration = validateRegistration(request.body);
    if (!registration) return reply.code(400).send({ error: 'invalid_approval_notification_registration' });
    try {
      const outcome = await services.store.upsert(app.ownerObjectId, registration);
      if (outcome === 'invalid_token') {
        return reply.code(410).send({ error: 'approval_notification_token_rejected' });
      }
      if (outcome === 'device_limit') {
        return reply.code(429).send({ error: 'approval_notification_device_limit' });
      }
      return reply.code(204).send();
    } catch {
      request.log.warn('approval_notification.registration_unavailable');
      return reply.code(503).send({ error: 'approval_notifications_unavailable' });
    }
  });
  app.delete<{ Body: { deviceToken?: unknown } }>('/ios/approval-notifications', async (request, reply) => {
    if (request.principal?.objectId.toLowerCase() !== app.ownerObjectId.toLowerCase()) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    if (!services) return reply.code(503).send({ error: 'approval_notifications_unavailable' });
    const token = request.body?.deviceToken;
    if (typeof token !== 'string' || !deviceTokenPattern.test(token)) {
      return reply.code(400).send({ error: 'invalid_approval_notification_registration' });
    }
    try {
      await services.store.remove(app.ownerObjectId, token.toLowerCase());
      return reply.code(204).send();
    } catch {
      request.log.warn('approval_notification.registration_unavailable');
      return reply.code(503).send({ error: 'approval_notifications_unavailable' });
    }
  });
}
