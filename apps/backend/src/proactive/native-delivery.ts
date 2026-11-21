import type { ApprovalNotificationPushResult, ApprovalNotificationServices } from '../push/approval-notifications.js';
import type {
  OwnerReminderDeliveryStore,
  OwnerReminderDeliverySummary,
} from './owner-reminder-store.js';
import { ownerReminderRetryAt } from './owner-reminder-store.js';
import { buildPushPayload, type SystemPushOutcome, type SystemPushRequest } from './push-delivery.js';

const nativeLeaseMs = 20_000;

function terminalOutcome(
  summary: OwnerReminderDeliverySummary,
): Pick<SystemPushOutcome,
  'status' | 'reason' | 'deliveryEvidence' | 'providerOutcome' | 'provider' | 'statusCode'> {
  const outcome = summary.providerOutcome;
  if (summary.acceptedRecipientCount > 0 && summary.pendingRecipientCount === 0) {
    return {
      status: 'sent',
      reason: null,
      deliveryEvidence: summary,
      providerOutcome: outcome ?? 'provider_accepted',
      provider: 'apns',
      statusCode: summary.providerStatusCode,
    };
  }
  const reason = outcome === 'apns_invalid_token' ||
    outcome === 'registration_removed' ||
    outcome === 'registration_expired' ||
    outcome === 'delivery_expired' ||
    outcome === 'provider_rejected' ||
    outcome === 'retry_exhausted' ||
    outcome === 'delivery_evidence_unavailable' ||
    outcome === 'provider_unavailable'
    ? outcome
    : 'delivery_failed';
  return {
    status: 'failed',
    reason,
    deliveryEvidence: summary,
    providerOutcome: outcome,
    provider: 'apns',
    statusCode: summary.providerStatusCode,
  };
}

async function deliveredOwnerReminder(
  owner: string,
  services: Pick<ApprovalNotificationServices, 'store' | 'sender'>,
  deliveries: OwnerReminderDeliveryStore,
  request: SystemPushRequest,
  signal: AbortSignal,
  now: () => Date,
): Promise<SystemPushOutcome | undefined> {
  const metadata = request.ownerReminderDelivery;
  if (!metadata) return undefined;
  const at = now();
  const queued = await deliveries.queueNativeDeliveries({
    scheduleId: metadata.scheduleId,
    claimToken: metadata.claimToken,
    occurrenceAt: metadata.occurrenceAt,
    itemId: request.itemId,
    notificationId: metadata.notificationId,
    now: at,
    expiresAt: metadata.expiresAt,
  });
  if (!queued.evidenceAvailable && queued.recipientCount === 0) return undefined;
  const { title, body } = JSON.parse(buildPushPayload(request, at).toString('utf8')) as {
    title: string;
    body: string;
  };
  const payload = Buffer.from(JSON.stringify({
    aps: {
      alert: { title, body },
      sound: 'default',
      category: 'jarvis.proactive',
      'thread-id': 'jarvis.proactive',
    },
    proactiveItemID: request.itemId,
    kind: request.kind,
    ownerReminderID: metadata.scheduleId,
  }));
  const claimed = await deliveries.claimNativeDeliveries({
    scheduleId: metadata.scheduleId,
    occurrenceAt: metadata.occurrenceAt,
    claimToken: metadata.claimToken,
    now: at,
    leaseUntil: new Date(at.getTime() + nativeLeaseMs),
  });
  let attempted = 0;
  let unresolved = false;
  for (const delivery of claimed) {
    if (signal.aborted) {
      unresolved = true;
      break;
    }
    attempted += 1;
    let result: ApprovalNotificationPushResult;
    try {
      result = await services.sender.send(
        delivery.deviceToken,
        payload,
        delivery.expiresAt.getTime(),
        AbortSignal.any([signal, AbortSignal.timeout(6000)]),
        delivery.notificationId,
      );
    } catch {
      if (signal.aborted) {
        unresolved = true;
        break;
      }
      result = { accepted: false, invalidToken: false, retryable: true };
    }
    const statusCode = result.statusCode ?? null;
    try {
      if (result.invalidToken) {
        await services.store.invalidate(owner, delivery.deviceToken, statusCode);
        await deliveries.invalidNativeDelivery(delivery.id, delivery.claimToken, statusCode);
      } else if (result.accepted) {
        if (!await deliveries.acceptedNativeDelivery(
          delivery.id, delivery.claimToken, statusCode,
        )) unresolved = true;
      } else {
        const retryAt = result.retryable === true
          ? ownerReminderRetryAt(delivery.attemptCount, now())
          : null;
        if (retryAt !== null) {
          if (!await deliveries.retryNativeDelivery(
            delivery.id, delivery.claimToken, retryAt, statusCode,
          )) unresolved = true;
        } else if (!await deliveries.failedNativeDelivery(
          delivery.id,
          delivery.claimToken,
          result.retryable === true ? 'retry_exhausted' : 'provider_rejected',
          statusCode,
        )) unresolved = true;
      }
    } catch {
      unresolved = true;
    }
  }
  const summary = await deliveries.nativeDeliverySummary(
    metadata.scheduleId,
    metadata.occurrenceAt,
  );
  if (unresolved || summary.pendingRecipientCount > 0 &&
      (summary.providerOutcome === 'in_progress' || claimed.length === 0)) {
    return {
      status: 'skipped',
      reason: 'delivery_evidence_unavailable',
      attempted,
      accepted: summary.acceptedRecipientCount,
      statusCode: summary.providerStatusCode,
      deliveryEvidence: summary,
      providerOutcome: summary.providerOutcome,
      provider: 'apns',
    };
  }
  if (summary.pendingRecipientCount > 0 && summary.nextAttemptAt !== null) {
    return {
      status: 'failed',
      reason: 'provider_unavailable',
      attempted,
      accepted: summary.acceptedRecipientCount,
      statusCode: summary.providerStatusCode,
      deliveryEvidence: summary,
      providerOutcome: summary.providerOutcome,
      provider: 'apns',
    };
  }
  const terminal = terminalOutcome(summary);
  return {
    ...terminal,
    attempted,
    accepted: summary.acceptedRecipientCount,
  };
}

/** Reuse owner device registrations and the APNs alert transport; no second token registration flow. */
export function createNativeProactiveDelivery(
  owner: string,
  services: Pick<ApprovalNotificationServices, 'store' | 'sender'>,
  now: () => Date,
  ownerDeliveries?: OwnerReminderDeliveryStore,
) {
  return {
    async hasRecipients(): Promise<boolean> { return (await services.store.list(owner)).length > 0; },
    async send(request: SystemPushRequest, signal: AbortSignal): Promise<SystemPushOutcome | undefined> {
      if (request.ownerReminderDelivery) {
        if (!ownerDeliveries) {
          return {
            status: 'failed',
            reason: 'delivery_evidence_unavailable',
            attempted: 0,
            accepted: 0,
            statusCode: null,
          };
        }
        try {
          return await deliveredOwnerReminder(
            owner,
            services,
            ownerDeliveries,
            request,
            signal,
            now,
          );
        } catch {
          return {
            status: 'skipped',
            reason: 'delivery_evidence_unavailable',
            attempted: 0,
            accepted: 0,
            statusCode: null,
          };
        }
      }
      const registrations = await services.store.list(owner);
      if (!registrations.length) return undefined; // Web Push remains the fallback when no native device is registered.
      const { title, body } = JSON.parse(buildPushPayload(request, now()).toString('utf8')) as { title: string; body: string };
      const payload = Buffer.from(JSON.stringify({ aps: { alert: { title, body }, sound: 'default',
        category: 'jarvis.proactive', 'thread-id': 'jarvis.proactive' },
        proactiveItemID: request.itemId, kind: request.kind }));
      const results = await Promise.all(registrations.map(async registration => {
        if (signal.aborted) return false;
        try {
          const result = await services.sender.send(registration.deviceToken, payload,
            now().getTime() + 3600000, signal);
          if (result.invalidToken) await services.store.invalidate(
            owner,
            registration.deviceToken,
            result.statusCode ?? null,
          );
          return result.accepted;
        } catch { return false; }
      }));
      const accepted = results.filter(Boolean).length;
      return { status: accepted ? 'sent' : signal.aborted ? 'skipped' : 'failed',
        reason: accepted ? null : signal.aborted ? 'aborted' : 'provider_unavailable',
        attempted: registrations.length, accepted, statusCode: accepted ? 200 : null,
        provider: 'apns' };
    },
  };
}
