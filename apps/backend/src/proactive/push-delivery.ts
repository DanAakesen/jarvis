import { generateVapidKeyPair, sendWebPush, type PushSendOrigin, type VapidKeyPair, type WebPushResult, type WebPushTransport } from '../push/webpush.js';
import type { PushStore, StoredPushSubscription } from '../database/push-store.js';
import { isQuietHour } from './time.js';

export type SystemPushKind = 'alert' | 'due_soon' | 'overdue' | 'mixed';

export interface SystemPushRequest {
  kind: SystemPushKind;
  count: number;
  language: 'da' | 'en';
  itemId: string;
  origin: 'proactive_alert' | 'proactive_reminder';
}

export interface SystemPushOutcome {
  status: 'sent' | 'failed' | 'skipped';
  reason: string | null;
  attempted: number;
  accepted: number;
  statusCode: number | null;
}

export interface SystemPushLogger {
  info?: (data: Record<string, string | number>, message: string) => void;
  warn?: (data: Record<string, string | number>, message: string) => void;
}

type PushDeliveryStore = Pick<PushStore, 'readVapidKey' | 'insertVapidKey' | 'removeSubscription' | 'recordSubscriptionResult'>;
type PushSend = (
  subscription: StoredPushSubscription,
  payload: Buffer,
  keys: VapidKeyPair,
  publicOrigin: string,
  origin: PushSendOrigin,
  transport: WebPushTransport,
  signal?: AbortSignal,
) => Promise<WebPushResult>;

export function buildPushPayload(request: SystemPushRequest): Buffer {
  return Buffer.from(JSON.stringify({
    v: 1,
    title: 'Jarvis',
    body: 'New item',
    itemId: request.itemId,
    kind: request.kind,
    count: request.count,
    lang: request.language,
  }));
}

export function createVapidKeyLoader(
  store: Pick<PushDeliveryStore, 'readVapidKey' | 'insertVapidKey'>,
  generateKeys: () => VapidKeyPair = generateVapidKeyPair,
): () => Promise<VapidKeyPair> {
  let keyPromise: Promise<VapidKeyPair> | undefined;
  return () => {
    if (keyPromise) return keyPromise;
    const pending = (async () => {
      const stored = await store.readVapidKey();
      if (stored) return stored;
      const generated = generateKeys();
      try {
        await store.insertVapidKey(generated);
      } catch {
        // A concurrent process may have inserted the singleton key first.
      }
      const winner = await store.readVapidKey();
      if (!winner) throw new Error('Push signing key is unavailable');
      return winner;
    })().catch((error: unknown) => {
      if (keyPromise === pending) keyPromise = undefined;
      throw error;
    });
    keyPromise = pending;
    return pending;
  };
}

export async function deliverToSubscriptions(input: {
  store: Pick<PushDeliveryStore, 'removeSubscription' | 'recordSubscriptionResult'>;
  subscriptions: readonly StoredPushSubscription[];
  payload: Buffer;
  keys: VapidKeyPair;
  publicOrigin: string;
  origin: PushSendOrigin;
  transport: WebPushTransport;
  send: PushSend;
  signal?: AbortSignal;
}): Promise<WebPushResult[]> {
  return Promise.all(input.subscriptions.map(async (subscription) => {
    if (input.signal?.aborted) return { attempted: 0, accepted: false, statusCode: null, removed: false };
    const result = await input.send(
      subscription, input.payload, input.keys, input.publicOrigin, input.origin, input.transport, input.signal,
    );
    if (result.removed) await input.store.removeSubscription(subscription.id);
    else await input.store.recordSubscriptionResult(subscription.id, result.accepted);
    return result;
  }));
}

export function createSystemPushSender(dependencies: {
  store: PushStore;
  ownerObjectId: string;
  publicOrigin: string;
  now?: () => Date;
  transport?: WebPushTransport;
  generateKeys?: () => VapidKeyPair;
  send?: PushSend;
  logger?: SystemPushLogger;
}): (request: SystemPushRequest, signal: AbortSignal) => Promise<SystemPushOutcome> {
  const now = dependencies.now ?? (() => new Date());
  const transport = dependencies.transport ?? {
    fetch,
    now: () => now().getTime(),
    sleep: (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
  };
  const send = dependencies.send ?? sendWebPush;
  const getKeys = createVapidKeyLoader(dependencies.store, dependencies.generateKeys);
  const log = (level: 'info' | 'warn', data: Record<string, string | number>) => {
    try { dependencies.logger?.[level]?.(data, 'push.system'); } catch { /* Logging cannot change delivery. */ }
  };

  return async (request, signal) => {
    const startedAt = now().getTime();
    const outcome = (status: SystemPushOutcome['status'], reason: string | null,
      attempted = 0, accepted = 0, statusCode: number | null = null): SystemPushOutcome => {
      log(status === 'failed' ? 'warn' : 'info', {
        reason: reason ?? 'none', attempted, accepted,
        durationMs: Math.max(0, now().getTime() - startedAt),
      });
      return { status, reason, attempted, accepted, statusCode };
    };

    if (signal.aborted) return outcome('skipped', 'aborted');
    if (isQuietHour(now())) return outcome('skipped', 'quiet_hours');
    try {
      const subscriptions = await dependencies.store.listSubscriptions(dependencies.ownerObjectId);
      if (subscriptions.length === 0) return outcome('skipped', 'no_subscription');
      if (signal.aborted) return outcome('skipped', 'aborted');
      const keys = await getKeys();
      if (signal.aborted) return outcome('skipped', 'aborted');
      const deliveries = await deliverToSubscriptions({
        store: dependencies.store,
        subscriptions,
        payload: buildPushPayload(request),
        keys,
        publicOrigin: dependencies.publicOrigin,
        origin: request.origin,
        transport,
        send,
        signal,
      });
      const accepted = deliveries.filter(({ accepted: didAccept }) => didAccept).length;
      const attempted = deliveries.reduce((total, delivery) => total + delivery.attempted, 0);
      const statusCode = deliveries.find(({ accepted: didAccept }) => didAccept)?.statusCode ??
        deliveries.find(({ statusCode: status }) => status !== null)?.statusCode ?? null;
      if (accepted > 0) return outcome('sent', null, attempted, accepted, statusCode);
      if (signal.aborted) return outcome('skipped', 'aborted', attempted, accepted, statusCode);
      if (deliveries.length > 0 && deliveries.every(({ removed }) => removed)) {
        return outcome('skipped', 'no_subscription', attempted, accepted, statusCode);
      }
      const rejected = deliveries.some(({ statusCode: status }) =>
        status !== null && status !== 404 && status !== 410 && status !== 429 && status < 500);
      return outcome('failed', rejected ? 'provider_rejected' : 'provider_unavailable', attempted, accepted, statusCode);
    } catch {
      return outcome('failed', 'provider_unavailable');
    }
  };
}
