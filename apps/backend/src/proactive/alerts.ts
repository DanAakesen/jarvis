import { createHash } from 'node:crypto';
import type { PushStore, StoredPushSubscription } from '../database/push-store.js';
import type { ProactiveStore } from './store.js';
import type { FindingsStoredContext } from './engine.js';
import type { AlertClass, AlertLedgerStore } from './alert-ledger.js';
import { dayKey, isQuietHour } from './time.js';
import type { SystemPushOutcome, SystemPushRequest } from './push-delivery.js';

const findingClass: Partial<Record<string, AlertClass>> = {
  deadline: 'deadline_24h',
  clash: 'calendar_clash',
  travel: 'travel_disruption',
};

interface AlertCandidate {
  itemId: string;
  dedupeKey: string;
  dueAt: string | null;
  alertClass: AlertClass;
  language: 'da' | 'en';
}

export interface ProactiveAlertLogger {
  info?: (data: { runId: string; count?: number; durationMs?: number; classes?: string; reason: string }, message: string) => void;
  warn?: (data: { runId: string; count?: number; durationMs?: number; classes?: string; reason: string }, message: string) => void;
}

export interface ProactiveAlertHookOptions {
  store: Pick<ProactiveStore, 'settings' | 'items'>;
  pushStore: Pick<PushStore, 'listSubscriptions' | 'updateItemDelivery'>;
  ownerObjectId: string;
  ledger: AlertLedgerStore;
  send: (request: SystemPushRequest, signal: AbortSignal) => Promise<SystemPushOutcome>;
  now: () => Date;
  logger?: ProactiveAlertLogger;
}

function compareCandidates(left: AlertCandidate, right: AlertCandidate): number {
  const leftDue = left.dueAt === null ? Number.POSITIVE_INFINITY : Date.parse(left.dueAt);
  const rightDue = right.dueAt === null ? Number.POSITIVE_INFINITY : Date.parse(right.dueAt);
  const leftTime = Number.isFinite(leftDue) ? leftDue : Number.POSITIVE_INFINITY;
  const rightTime = Number.isFinite(rightDue) ? rightDue : Number.POSITIVE_INFINITY;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left.dedupeKey < right.dedupeKey ? -1 : left.dedupeKey > right.dedupeKey ? 1 : 0;
}

function alertKey(alertClass: AlertClass, dedupeKey: string): string {
  return createHash('sha256').update(`alert|${alertClass}|${dedupeKey}`).digest('hex').slice(0, 32);
}

function safeLog(
  logger: ProactiveAlertLogger | undefined,
  level: 'info' | 'warn',
  data: Parameters<NonNullable<ProactiveAlertLogger['info']>>[0],
) {
  try { logger?.[level]?.(data, 'proactive.alert'); } catch { /* Logging cannot change the run. */ }
}

export function createProactiveAlertHook(options: ProactiveAlertHookOptions) {
  return async function onFindingsStored(context: FindingsStoredContext): Promise<void> {
    if (context.trigger !== 'scheduled' && context.trigger !== 'catchup') return;
    let startedAt = 0;
    const duration = () => {
      try { return Math.max(0, options.now().getTime() - startedAt); } catch { return 0; }
    };
    const log = (reason: string, count?: number, classes?: string, level: 'info' | 'warn' = 'info') => {
      safeLog(options.logger, level, {
        runId: context.runId,
        ...(count === undefined ? {} : { count }),
        ...(classes === undefined ? {} : { classes }),
        durationMs: duration(),
        reason,
      });
    };
    try {
      startedAt = options.now().getTime();
      if (context.signal.aborted) {
        log('aborted');
        return;
      }
      const settings = await options.store.settings.read();
      if (settings.paused) {
        log('paused');
        return;
      }
      if (context.signal.aborted) {
        log('aborted');
        return;
      }
      const currentTime = options.now();
      if (isQuietHour(currentTime)) {
        log('quiet_hours');
        return;
      }
      const candidates: AlertCandidate[] = context.findings.flatMap((finding) => {
        const alertClass = findingClass[finding.category];
        return finding.urgency === 'time_critical' && alertClass
          ? [{
            itemId: finding.itemId,
            dedupeKey: finding.dedupeKey,
            dueAt: finding.dueAt,
            alertClass,
            language: finding.language,
          }]
          : [];
      }).sort(compareCandidates).slice(0, 99);
      if (candidates.length === 0) return;
      const subscriptions: StoredPushSubscription[] = await options.pushStore.listSubscriptions(options.ownerObjectId);
      if (subscriptions.length === 0) {
        log('no_subscription', candidates.length, [...new Set(candidates.map(({ alertClass }) => alertClass))].sort().join(','));
        return;
      }
      const ledgerTime = options.now();
      if (isQuietHour(ledgerTime)) {
        log('quiet_hours', candidates.length);
        return;
      }
      if (context.signal.aborted) {
        log('aborted', candidates.length);
        return;
      }
      const keyed = await Promise.all(candidates.map(async (candidate) => ({
        candidate,
        key: alertKey(candidate.alertClass, candidate.dedupeKey),
        previous: await options.ledger.get(alertKey(candidate.alertClass, candidate.dedupeKey)),
      })));
      const unsettled = keyed.filter(({ previous }) =>
        !previous || (previous.status === 'failed' && previous.attempts < 2));
      if (unsettled.length === 0) return;
      const currentDay = dayKey(ledgerTime);
      if (await options.ledger.countSent(currentDay) >= 3) {
        log('daily_cap', unsettled.length, [...new Set(unsettled.map(({ candidate }) => candidate.alertClass))].sort().join(','));
        return;
      }
      if (context.signal.aborted) {
        log('aborted', unsettled.length);
        return;
      }
      const states = await options.store.items.getMany(unsettled.map(({ candidate }) => candidate.itemId));
      const newIds = new Set(states.filter(({ state }) => state === 'new').map(({ id }) => id.toLowerCase()));
      const active = unsettled.filter(({ candidate }) => newIds.has(candidate.itemId.toLowerCase()));
      if (active.length === 0 || context.signal.aborted) {
        if (context.signal.aborted) log('aborted', unsettled.length);
        return;
      }
      const mostUrgent = active[0]!.candidate;
      const details = await Promise.all(active.slice(0, 3).map(async ({ candidate }) => {
        try {
          const item = await options.store.items.get(candidate.itemId, false);
          return item ? { title: item.title, dueAt: item.dueAt } : undefined;
        } catch {
          return undefined;
        }
      }));
      if (context.signal.aborted) {
        log('aborted', active.length);
        return;
      }
      const request: SystemPushRequest = {
        kind: 'alert',
        count: active.length,
        language: mostUrgent.language ?? 'en',
        itemId: mostUrgent.itemId,
        origin: 'proactive_alert',
        details: details.filter((detail) => detail !== undefined),
      };
      const outcome = await options.send(request, context.signal);
      const classes = [...new Set(active.map(({ candidate }) => candidate.alertClass))].sort().join(',');
      const ledgerStatus = outcome.status === 'sent' ? 'sent' : 'failed';
      const results = await Promise.allSettled(active.flatMap(({ candidate, key }) => [
        options.pushStore.updateItemDelivery(candidate.itemId, ledgerStatus === 'sent' ? 'accepted' : 'failed', outcome.statusCode),
        options.ledger.upsert({
          alertKey: key,
          class: candidate.alertClass,
          itemId: candidate.itemId,
          runId: context.runId,
          dayKey: dayKey(options.now()),
          status: ledgerStatus,
          reason: outcome.reason,
        }),
      ]));
      const writeFailed = results.some(({ status }) => status === 'rejected');
      log(writeFailed ? 'ledger_or_delivery_failed' : outcome.reason ?? 'sent',
        active.length, classes, writeFailed || ledgerStatus === 'failed' ? 'warn' : 'info');
    } catch {
      log('hook_failed', undefined, undefined, 'warn');
    }
  };
}

export { alertKey as proactiveAlertKey };
