import { generateVapidKeyPair, sendWebPush, type PushSendOrigin, type VapidKeyPair, type WebPushResult, type WebPushTransport } from '../push/webpush.js';
import type { PushStore, StoredPushSubscription } from '../database/push-store.js';
import { dayKey, isQuietHour, localTimeLabel } from './time.js';

export type SystemPushKind = 'alert' | 'due_soon' | 'overdue' | 'mixed';

export interface SystemPushRequest {
  kind: SystemPushKind;
  count: number;
  language: 'da' | 'en';
  itemId: string;
  origin: 'proactive_alert' | 'proactive_reminder';
  details?: readonly { title: string; dueAt: string | null }[];
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

function shorten(value: string, limit: number): string {
  const points = Array.from(value);
  return points.length <= limit ? value : `${points.slice(0, limit - 1).join('')}…`;
}

function singleLine(value: string): string {
  return value.replace(/\s/gu, ' ').replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, '').replace(/ +/gu, ' ').trim();
}

function countHeadline(request: SystemPushRequest): string {
  const { kind, count, language } = request;
  const da = language === 'da';
  switch (kind) {
    case 'alert': return da ? `${count} tidskritiske ting kræver din opmærksomhed` : `${count} time-critical items need you`;
    case 'due_soon': return da
      ? count === 1 ? 'En todo forfalder inden for en time' : `${count} todos forfalder inden for en time`
      : count === 1 ? 'A todo is due within the hour' : `${count} todos are due within the hour`;
    case 'overdue': return da
      ? count === 1 ? 'En todo er forfalden' : `${count} todos er forfaldne`
      : count === 1 ? 'A todo is overdue' : `${count} todos are overdue`;
    case 'mixed': return da ? `${count} todos kræver din opmærksomhed` : `${count} todos need your attention`;
  }
}

export function buildPushPayload(request: SystemPushRequest, now = new Date()): Buffer {
  const da = request.language === 'da';
  const details = (request.details ?? []).map((detail) => ({
    title: singleLine(detail.title),
    due: detail.dueAt === null ? null : new Date(detail.dueAt),
  })).map((detail) => ({
    ...detail,
    due: detail.due && Number.isFinite(detail.due.getTime()) ? detail.due : null,
  }));
  if (request.kind !== 'alert') {
    details.sort((left, right) =>
      (left.due?.getTime() ?? Infinity) - (right.due?.getTime() ?? Infinity));
  }
  const visible = details.filter(({ title }) => title.length > 0).slice(0, Math.min(3, request.count));
  let title = countHeadline(request);
  let body: string;
  if (request.count === 1) {
    const detail = visible[0];
    if (request.kind === 'alert') {
      title = da ? 'Tidskritisk' : 'Time-critical';
    } else if (detail?.due) {
      const time = localTimeLabel(detail.due);
      if (detail.due.getTime() > now.getTime()) {
        title = da ? `Todo forfalder kl. ${time}` : `Todo due at ${time}`;
      } else if (dayKey(detail.due) === dayKey(now)) {
        title = da ? `Todo forfaldt kl. ${time}` : `Todo was due at ${time}`;
      } else {
        title = da ? `Todo forfaldt i går kl. ${time}` : `Todo was due yesterday at ${time}`;
      }
    }
    const suffix = request.kind === 'alert' && detail?.due ? ` · ${localTimeLabel(detail.due)}` : '';
    body = detail ? `${shorten(detail.title, 80 - Array.from(suffix).length)}${suffix}` : '';
  } else {
    const lines = visible.map((detail) => shorten(
      `${request.kind !== 'alert' && detail.due ? `${localTimeLabel(detail.due)} ` : ''}${detail.title}`, 80,
    ));
    const remaining = request.count - visible.length;
    const overflow = remaining > 0 ? `+${remaining} ${da ? 'flere' : 'more'}` : '';
    // Reserve the overflow line before fitting detail lines to the total body budget.
    let budget = 240 - (overflow ? Array.from(overflow).length + lines.length : Math.max(0, lines.length - 1));
    body = [...lines.map((line, index) => {
      const fitted = shorten(line, Math.min(80, budget - (lines.length - index - 1)));
      budget -= Array.from(fitted).length;
      return fitted;
    }), ...(overflow ? [overflow] : [])].join('\n');
  }
  return Buffer.from(JSON.stringify({
    v: 2,
    title: shorten(singleLine(title), 60),
    body,
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
        payload: buildPushPayload(request, now()),
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
