import { createHash, randomUUID } from 'node:crypto';
import type { UsageStore } from '../../core/usage.js';
import { canRunWithinBudget, estimateCost } from '../budget.js';
import { automaticProactiveWorkAllowed } from '../policy.js';
import type { ProactiveStore } from '../store.js';
import { copenhagenDayStart, monthKey } from '../time.js';
import { sourceIds, type ProactiveSettings, type ProactiveSource, type SourceId } from '../types.js';
import { deliverThroughChannels } from './channels.js';
import type { FeedbackLine } from './event-prompt.js';
import type { EventQueueStore } from './event-queue.js';
import type { OutreachStore } from './outreach-store.js';
import type { EventReasoner } from './reasoner.js';
import { applyRules } from './rules.js';
import type { OutreachChannel, OutreachDecision, OutreachTier, QueuedEvent } from './types.js';

export const BATCH_SIZE = 10;
export const MAX_MODEL_BATCHES_PER_DAY = 12;
export const MAX_PUSHES_PER_DAY = 6;
const LEASE_MS = 3 * 60_000;
const SOURCE_TIMEOUT_MS = 20_000;
const FEEDBACK_WINDOW_MS = 30 * 24 * 60 * 60_000;
const RETENTION_MS = 45 * 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;
/** Vault and backend memory plus the state of plans and repos: context the model judges events against. */
const contextSourceIds: readonly SourceId[] = ['todos', 'calendar', 'factory', 'notes', 'memory', 'health', 'nutrition'];
/** Health numbers change all day; they inform the model but must not make every timer review look new. */
const volatileSourceIds: readonly string[] = ['health', 'nutrition'];
const urgencyForTier = { low: 'fyi', medium: 'normal', high: 'time_critical' } as const;

export interface EventPipelineLogger {
  info?: (data: Record<string, string | number>, message: string) => void;
  warn?: (data: Record<string, string | number>, message: string) => void;
}

export interface EventPipelineOptions {
  queue: EventQueueStore;
  outreach: OutreachStore;
  store: Pick<ProactiveStore, 'settings' | 'items' | 'spend'>;
  reasoner: EventReasoner;
  contextSources: readonly ProactiveSource[];
  channels: readonly OutreachChannel[];
  usageStore?: Pick<UsageStore, 'recordFoundryUsage'>;
  now: () => Date;
  logger?: EventPipelineLogger;
}

export interface TickResult {
  /** Why nothing reached the model, or `done` after a model call. */
  outcome: string;
  claimed: number;
  dropped: number;
  outreach: number;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createEventPipeline(options: EventPipelineOptions) {
  const { queue, outreach, store, reasoner, now } = options;
  let running: Promise<TickResult> | undefined;
  // The database is only read when something is due, so serverless SQL can still auto-pause.
  let nextWorkAt: Date | null = null;
  let lastTimerFingerprint: string | undefined;
  let lastPurge = 0;
  const log = (level: 'info' | 'warn', data: Record<string, string | number>) => {
    try { options.logger?.[level]?.(data, 'proactive.events'); } catch { /* Logging cannot change the run. */ }
  };

  function wake(at: Date) {
    if (nextWorkAt === null || at < nextWorkAt) nextWorkAt = at;
  }

  async function readContext(settings: ProactiveSettings, signal: AbortSignal) {
    const results = await Promise.all(options.contextSources
      .filter((source) => contextSourceIds.includes(source.id) && settings.sources[source.id])
      .map(async (source) => {
        const timeout = AbortSignal.any([signal, AbortSignal.timeout(SOURCE_TIMEOUT_MS)]);
        try {
          const result = await source.read({ now: now(), signal: timeout, settings });
          return result.state === 'ok' ? result.facts.map((fact) => ({ ...fact, source: source.id })) : [];
        } catch { return []; }
      }));
    return results.flat().map((fact, index) => ({
      ref: `${fact.source}:${index}`, source: fact.source, label: fact.label, text: fact.text,
    }));
  }

  async function runTick(signal: AbortSignal): Promise<TickResult> {
    const current = now();
    const result = (outcome: string, claimed = 0, dropped = 0, outreachCount = 0): TickResult =>
      ({ outcome, claimed, dropped, outreach: outreachCount });
    const settings = await store.settings.read();
    if (!automaticProactiveWorkAllowed(settings)) return result('paused');
    if (!await queue.hasWork(current)) {
      if (current.getTime() - lastPurge > 24 * HOUR_MS) {
        lastPurge = current.getTime();
        await queue.purge(new Date(current.getTime() - RETENTION_MS));
      }
      return result('empty');
    }
    if (await queue.modelBatchesSince(copenhagenDayStart(current)) >= MAX_MODEL_BATCHES_PER_DAY) {
      wake(copenhagenDayStart(new Date(copenhagenDayStart(current).getTime() + 36 * HOUR_MS)));
      return result('daily_cap');
    }
    const worstCase = reasoner.worstCaseDkk();
    const withinBudget = async () => settings.monthlyBudgetDkk > 0 && canRunWithinBudget(
      settings.monthlyBudgetDkk, await store.spend.monthTotal(monthKey(now())), worstCase);
    if (!await withinBudget()) {
      wake(new Date(current.getTime() + HOUR_MS));
      return result('budget_exhausted');
    }

    const claimed = await queue.claim(current, BATCH_SIZE, LEASE_MS);
    if (claimed.length === 0) return result('empty');
    if (claimed.length === BATCH_SIZE) wake(current);
    const escalated = new Map<string, number>();
    const survivors: QueuedEvent[] = [];
    const settled: { id: string; outcome: string }[] = [];
    for (const event of claimed) {
      if (!escalated.has(event.source)) {
        escalated.set(event.source, await queue.escalatedSince(event.source, new Date(current.getTime() - HOUR_MS)));
      }
      const verdict = applyRules(event, {
        now: current,
        sourceEnabled: !(sourceIds as readonly string[]).includes(event.source) || settings.sources[event.source as SourceId],
        escalatedLastHour: escalated.get(event.source)! + survivors.filter(({ source }) => source === event.source).length,
      });
      if (verdict.keep) survivors.push(event);
      else settled.push({ id: event.id, outcome: `rule: ${verdict.reason}` });
    }
    const dropped = settled.length;
    if (settled.length) await queue.settle(settled, current);
    if (survivors.length === 0) return result('filtered', claimed.length, dropped);

    const facts = await readContext(settings, signal);
    let reviewedFingerprint: string | undefined;
    if (survivors.every((event) => event.source === 'timer')) {
      const fingerprint = digest(JSON.stringify(facts
        .filter(({ source }) => !volatileSourceIds.includes(source)).map(({ source, text }) => [source, text]).sort()));
      if (fingerprint === lastTimerFingerprint) {
        await queue.settle(survivors.map(({ id }) => ({ id, outcome: 'rule: context_unchanged' })), now());
        return result('filtered', claimed.length, dropped + survivors.length);
      }
      // Remembered only once the review has been handled; a failed attempt must be able to run again.
      reviewedFingerprint = fingerprint;
    }
    // The month may have turned or another path may have spent budget while the context was read.
    if (!await withinBudget()) {
      const retryAt = new Date(now().getTime() + 15 * 60_000);
      await queue.retryLater(survivors.map(({ id }) => id), retryAt);
      wake(retryAt);
      return result('budget_exhausted', claimed.length, dropped);
    }

    const recent = await outreach.recent(20, new Date(current.getTime() - FEEDBACK_WINDOW_MS));
    const feedback: FeedbackLine[] = recent.map((entry) => ({
      title: entry.title, tier: entry.tier, rating: entry.rating, note: entry.ratingNote,
      hoursAgo: Math.max(0, Math.round((current.getTime() - Date.parse(entry.createdAt)) / HOUR_MS)),
    }));
    const batchId = randomUUID();
    // Counted before the call, so a failing or crashing model call still uses up the daily allowance.
    await queue.startBatch(batchId, now(), survivors.length);
    const response = await reasoner.reason({
      now: current, guidance: settings.guidance, events: survivors, facts, feedback,
    }, signal);
    if (response.usage) {
      const at = now();
      const usage = response.usage;
      const cost = estimateCost(usage.model, usage.inputTokens, usage.outputTokens);
      // Spend is recorded even when the answer is unusable: the tokens were billed.
      await Promise.all([
        store.spend.record({ ...usage, runId: batchId, month: monthKey(at), estimatedDkk: cost.estimatedDkk, createdAt: at }),
        options.usageStore?.recordFoundryUsage?.({ ...usage, role: 'chat', eventId: batchId }),
      ]);
    }
    if (response.reason) {
      const attempts = Math.max(...survivors.map(({ attempts: count }) => count));
      const retryAt = new Date(now().getTime() + attempts * 5 * 60_000);
      await queue.retryLater(survivors.map(({ id }) => id), retryAt);
      wake(retryAt);
      log('warn', { reason: response.reason, events: survivors.length });
      return result(response.reason, claimed.length, dropped);
    }

    const covered = new Set<string>();
    const settlements: { id: string; outcome: string; batchId: string }[] = [];
    for (const quiet of response.quiet) {
      covered.add(quiet.eventId);
      settlements.push({ id: quiet.eventId, outcome: `quiet: ${quiet.why}`, batchId });
    }
    let delivered = 0;
    const retry: string[] = [];
    for (const [index, decision] of response.decisions.entries()) {
      decision.eventIds.forEach((id) => covered.add(id));
      try {
        const outcome = await deliver(decision, batchId, index, signal);
        if (outcome.kind === 'quiet') {
          decision.eventIds.forEach((id) => settlements.push({ id, outcome: `quiet: ${outcome.reason}`, batchId }));
        } else {
          delivered += 1;
          decision.eventIds.forEach((id) => settlements.push({ id, outcome: `outreach ${outcome.id} (${outcome.tier})`, batchId }));
        }
      } catch {
        log('warn', { reason: 'delivery_failed', events: decision.eventIds.length });
        retry.push(...decision.eventIds);
      }
    }
    for (const event of survivors) {
      if (!covered.has(event.id)) settlements.push({ id: event.id, outcome: 'quiet: no_decision', batchId });
    }
    await queue.settle(settlements, now());
    if (retry.length) {
      const retryAt = new Date(now().getTime() + 5 * 60_000);
      await queue.retryLater(retry, retryAt);
      wake(retryAt);
    }
    if (reviewedFingerprint !== undefined) lastTimerFingerprint = reviewedFingerprint;
    log('info', { reason: 'done', events: survivors.length, outreach: delivered, dropped });
    return result('done', claimed.length, dropped, delivered);
  }

  async function deliver(decision: OutreachDecision, batchId: string, index: number, signal: AbortSignal):
  Promise<{ kind: 'quiet'; reason: string } | { kind: 'sent'; id: string; tier: OutreachTier }> {
    const at = now();
    // A fixed daily push budget keeps the model from nagging; the surplus still shows as a card.
    const pushCapped = decision.tier !== 'low' &&
      await outreach.pushesSince(copenhagenDayStart(at)) >= MAX_PUSHES_PER_DAY;
    const tier: OutreachTier = pushCapped ? 'low' : decision.tier;
    let itemId: string;
    try {
      const item = await store.items.upsertFinding({
        dedupeKey: `outreach:${batchId}:${index}`, title: decision.title, body: decision.body,
        category: decision.category, suggestionScope: 'unknown', urgency: urgencyForTier[tier],
        dueAt: null, evidence: [], runId: null,
      });
      itemId = item.id;
    } catch (error) {
      if (error instanceof Error && error.message === 'finding_not_allowed') return { kind: 'quiet', reason: 'not_allowed_by_preferences' };
      throw error;
    }
    const record = await outreach.create({ decision: { ...decision, tier }, batchId, itemId }, at);
    const delivery = await deliverThroughChannels(options.channels, tier, record, signal);
    if (pushCapped) delivery.push({ channel: 'push', status: 'skipped', reason: 'daily_push_cap' });
    const pushed = delivery.some(({ channel, status }) => channel === 'push' && status === 'sent');
    // The message is out; a bookkeeping failure must not make a retry send it again.
    await outreach.recordDelivery(record.id, delivery, pushed ? now() : null)
      .catch(() => log('warn', { reason: 'delivery_record_failed' }));
    return { kind: 'sent', id: record.id, tier };
  }

  return {
    /** A producer queued something: look at the queue on the next tick. */
    wake: () => wake(now()),
    /** Reads the queue once at startup, so work left by a restart is picked up. */
    async start(): Promise<void> {
      const due = await queue.nextDueAt();
      if (due) wake(due);
    },
    /** One pass: filter, reason, deliver. Idle without a database read when nothing is due. */
    tick(signal: AbortSignal): Promise<TickResult> {
      if (running) return running;
      if (nextWorkAt === null || nextWorkAt > now()) return Promise.resolve({ outcome: 'idle', claimed: 0, dropped: 0, outreach: 0 });
      nextWorkAt = null;
      running = runTick(signal).then(async (outcome) => {
        // Another wake may have replaced a later deadline (a deferred retry); read the queue again so none is lost.
        // Blocked outcomes keep the single deadline they set, or they would spin on work they may not do.
        if (!['paused', 'budget_exhausted', 'daily_cap'].includes(outcome.outcome)) {
          const due = await queue.nextDueAt().catch(() => null);
          if (due) wake(due);
        }
        return outcome;
      }, (error: unknown) => {
        // An interrupted pass leaves its claims leased; look again once the lease has lapsed.
        wake(new Date(now().getTime() + LEASE_MS + 1_000));
        throw error;
      }).finally(() => { running = undefined; });
      return running;
    },
  };
}
