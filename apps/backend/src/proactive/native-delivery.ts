import type { ApprovalNotificationServices } from '../push/approval-notifications.js';
import { buildPushPayload, type SystemPushOutcome, type SystemPushRequest } from './push-delivery.js';

/** Reuse owner device registrations and the APNs alert transport; no second token registration flow. */
export function createNativeProactiveDelivery(owner: string, services: ApprovalNotificationServices, now: () => Date) {
  return {
    async hasRecipients(): Promise<boolean> { return (await services.store.list(owner)).length > 0; },
    async send(request: SystemPushRequest, signal: AbortSignal): Promise<SystemPushOutcome | undefined> {
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
          if (result.invalidToken) await services.store.remove(owner, registration.deviceToken);
          return result.accepted;
        } catch { return false; }
      }));
      const accepted = results.filter(Boolean).length;
      return { status: accepted ? 'sent' : signal.aborted ? 'skipped' : 'failed',
        reason: accepted ? null : signal.aborted ? 'aborted' : 'provider_unavailable',
        attempted: registrations.length, accepted, statusCode: accepted ? 200 : null };
    },
  };
}
