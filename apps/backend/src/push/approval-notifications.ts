import { connect, type ClientHttp2Session } from 'node:http2';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { importPKCS8, SignJWT } from 'jose';
import { ConfigurationError } from '../config.js';
import type { ApprovalNotificationRegistration, ApprovalNotificationStore } from '../database/approval-notification-store.js';
import type { BrowserConfirmation } from '../core/owner-interactions.js';
import { loadApnsConfig, type ApnsConfig } from './activitykit.js';

const deviceTokenPattern = /^(?:[0-9a-f]{2}){32,256}$/iu;
const confirmationIdPattern = /^[A-Za-z0-9_-]{43}$/u;
const approvalCategory = 'jarvis.approval';
const privateApprovalCategory = 'jarvis.approval.private';

export interface ApprovalNotificationPushResult {
  accepted: boolean;
  invalidToken: boolean;
  retryable?: boolean;
}

export interface ApprovalNotificationSender {
  send(
    token: string,
    payload: Buffer,
    expiresAt: number,
    signal: AbortSignal,
  ): Promise<ApprovalNotificationPushResult>;
}

export interface ApprovalNotificationServices {
  store: ApprovalNotificationStore;
  sender: ApprovalNotificationSender;
}

export interface ApprovalNotificationPayloadInput extends BrowserConfirmation {
  language: 'da' | 'en';
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
  const time = new Intl.DateTimeFormat(input.language === 'da' ? 'da-DK' : 'en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: input.timeZone,
    timeZoneName: 'short',
  }).format(expiresAt);
  const expiry = input.language === 'da' ? `Udløber kl. ${time}` : `Expires at ${time}`;
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
    async send(token, payload, expiresAt, signal) {
      signal.throwIfAborted();
      if (!deviceTokenPattern.test(token)) throw new TypeError('Invalid APNs device token');
      if (!Buffer.isBuffer(payload) || payload.length === 0 || payload.length > 4096) {
        throw new TypeError('Invalid APNs notification payload');
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
      return new Promise<ApprovalNotificationPushResult>((resolve, reject) => {
        let session: ClientHttp2Session | undefined;
        let settled = false;
        const finish = (result?: ApprovalNotificationPushResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          signal.removeEventListener('abort', abort);
          session?.destroy();
          if (result) resolve(result);
          else reject(new Error('APNs notification transport unavailable'));
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
  if (Object.keys(input).some((key) => !['deviceToken', 'language', 'showActions', 'timeZone'].includes(key)) ||
      typeof input.deviceToken !== 'string' || !deviceTokenPattern.test(input.deviceToken) ||
      (input.language !== 'da' && input.language !== 'en') ||
      typeof input.showActions !== 'boolean' ||
      typeof input.timeZone !== 'string' || input.timeZone.length === 0 || input.timeZone.length > 64 ||
      !validTimeZone(input.timeZone)) return;
  return {
    deviceToken: input.deviceToken.toLowerCase(),
    language: input.language,
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
): (confirmation: BrowserConfirmation) => void {
  const recentlySent = new Map<string, number>();
  return (confirmation) => {
    const time = now();
    for (const [id, at] of recentlySent) if (time - at > 10 * 60_000) recentlySent.delete(id);
    if (recentlySent.has(confirmation.id)) return;
    recentlySent.set(confirmation.id, time);
    while (recentlySent.size > 2000) recentlySent.delete(recentlySent.keys().next().value!);
    void (async () => {
      const expiresAt = Date.parse(confirmation.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= now()) return;
      const registrations = await services.store.list(owner);
      await Promise.all(registrations.map(async (registration) => {
        try {
          const result = await services.sender.send(
            registration.deviceToken,
            approvalNotificationPayload({
              ...confirmation,
              language: registration.language,
              showActions: registration.showActions,
              timeZone: registration.timeZone,
            }),
            expiresAt,
            AbortSignal.timeout(6000),
          );
          if (result.invalidToken) {
            await services.store.remove(owner, registration.deviceToken);
          } else if (!result.accepted) {
            logger.warn('approval_notification.push_not_accepted');
          }
        } catch {
          logger.warn('approval_notification.push_unavailable');
        }
      }));
    })().catch(() => logger.warn('approval_notification.delivery_unavailable'));
  };
}

export function registerApprovalNotificationRoutes<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>,
  services?: ApprovalNotificationServices,
): void {
  app.post('/ios/approval-notifications', { bodyLimit: 2048 }, async (request, reply) => {
    if (request.principal?.objectId.toLowerCase() !== app.ownerObjectId.toLowerCase()) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    if (!services) return reply.code(503).send({ error: 'approval_notifications_unavailable' });
    const registration = validateRegistration(request.body);
    if (!registration) return reply.code(400).send({ error: 'invalid_approval_notification_registration' });
    try {
      if (!await services.store.upsert(app.ownerObjectId, registration)) {
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
