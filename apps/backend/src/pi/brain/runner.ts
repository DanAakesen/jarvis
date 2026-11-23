import { randomUUID } from 'node:crypto';
import {
  budgetState, canRunWithinBudget, effectiveProactiveBudget,
} from '../../proactive/budget.js';
import type { EventQueueStore } from '../../proactive/events/event-queue.js';
import { MAX_EVENT_ATTEMPTS } from '../../proactive/events/rules.js';
import { eventSourceSwitches, type QueuedEvent } from '../../proactive/events/types.js';
import type { ProactiveStore } from '../../proactive/store.js';
import {
  isQuietHour, latestSlotAtOrBefore, localSlotInstant, monthKey, nextCopenhagenDayStart, nextSlotAfter,
} from '../../proactive/time.js';
import { sourceIds, type FindingsStoredContext } from '../../proactive/types.js';
import { proactiveSettingsRevision } from '../../proactive/preferences.js';
import { PI_WAKE_PREFLIGHT_DKK } from '../pricing.js';
import type { PiBrainRun } from '../turns.js';
import type { PiGateway } from '../gateway.js';
import type { PiProactiveEvidence, PiStore } from '../store.js';
import { BrainCommsRefusal, type BrainComms } from './comms.js';
import type { DecisionLog, DecisionRecord } from './decision-log.js';
import type { BrainLogReason, BrainTickOutcome } from './outcomes.js';
import { MAX_WAKE_EVENTS, formatWake } from './wake.js';
import {
  DEFAULT_BACKGROUND_TURNS_PER_DAY,
  MIN_WAKE_GAP_MS,
  createPiBackgroundSlotService,
  type PiBackgroundSlotService,
} from '../activation-slots.js';

/** Exact cost guards. One wake covers many events; wakes are spaced and counted. */
export { MIN_WAKE_GAP_MS } from '../activation-slots.js';
export const MAX_WAKES_PER_DAY = DEFAULT_BACKGROUND_TURNS_PER_DAY;
const LEASE_MS = 6 * 60_000;
const HOUR_MS = 60 * 60_000;
const RETRY_MS = 5 * 60_000;
const timerMaxAgeMs = HOUR_MS;
const defaultMaxAgeMs = 24 * HOUR_MS;
const maxPendingLogs = 24;
/** A diagnostic read must never hold up a tick, a wake or startup. */
const diagnosticReadMs = 5_000;

async function bounded<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Diagnostic read timed out')), ms);
      timer.unref();
    })]);
  } finally { clearTimeout(timer); }
}

type LogFields = Record<string, string | number | boolean>;

export interface BrainOptions {
  readonly queue: EventQueueStore;
  readonly gateway: Pick<PiGateway, 'runBrain'>;
  readonly proactive: Pick<ProactiveStore, 'settings' | 'spend' | 'runs'>;
  readonly piStore: Pick<PiStore, 'readBrainSwitch' | 'latestProactiveMessageFeedback'>;
  readonly comms: BrainComms;
  readonly decisionLog: DecisionLog;
  readonly owner: string;
  readonly timeZone: string;
  readonly now: () => Date;
  readonly newRunId?: () => string;
  readonly logger?: { info?: (data: LogFields, message: string) => void; warn?: (data: LogFields, message: string) => void } | undefined;
  /** Sections a wake carries besides events, such as open watches that are due. */
  readonly extras?: {
    /** When something besides the queue is due, so the wake is not missed. */
    nextDueAt(signal: AbortSignal): Promise<Date | null>;
    sections(now: Date, signal: AbortSignal): Promise<{ sections: readonly string[]; lines: readonly string[]; due: readonly string[] }>;
    /** After a wake: what it cost, and what woke it, so each watch looked at can be given its share. */
    afterRun(input: { runId: string; costDkk: number; events: number; run: PiBrainRun; due: readonly string[] }, signal: AbortSignal): Promise<void>;
  } | undefined;
  readonly afterScheduledWake?: ((context: FindingsStoredContext) => Promise<void>) | undefined;
  readonly slots?: PiBackgroundSlotService | undefined;
}

export interface BrainTick {
  /** Why nothing ran, or `done` / `failed` after a wake. `idle` and `active_activation` returned before the queue was read. */
  readonly outcome: BrainTickOutcome | 'idle' | 'active_activation';
  readonly claimed: number;
  readonly runId?: string | undefined;
}

/** The last pass that read the queue since this backend started. */
export interface BrainTickRecord {
  readonly at: Date;
  readonly outcome: BrainTickOutcome;
}

type RanTick = BrainTick & { readonly outcome: BrainTickOutcome };

/** A claimed run of the 07:00 or 18:00 sweep, or of an owner's Check now. */
type SweepClaim = { run: { id: string; slot: string | null; trigger: 'scheduled' | 'catchup' | 'manual' }; generation: number };

/**
 * The brain loop on the PI agent: trigger (the 30 s ticker finds events in the queue, a timer review or a due watch),
 * context (the agent reads the vault, the session and its signals through tools), decide, act through tools, evaluate, decide
 * whether and how to tell Dan, and log the decision. Everything that must be exact is here and not in the model: the owner's
 * switch, the pause, the budget stop, the spacing and daily count of wakes, event admission, retries and the decision log.
 * What the events mean and what to do about them is the model's decision.
 */
export function createBrain(options: BrainOptions) {
  const { queue, proactive, now } = options;
  const emit = (level: 'info' | 'warn', message: 'pi.brain' | 'pi.brain_tick' | 'pi.brain_state', data: LogFields) => {
    try { options.logger?.[level]?.(data, message); } catch { /* Logging cannot change a wake. */ }
  };
  const log = (level: 'info' | 'warn', data: LogFields & { reason: BrainLogReason }) => emit(level, 'pi.brain', data);
  let nextWorkAt: Date | null = null;
  let lastWakeAt = 0;
  let lastTick: BrainTickRecord | null = null;
  let running: Promise<BrainTick> | undefined;
  let scheduledActive = false;
  const slots = options.slots ?? createPiBackgroundSlotService({ queue, proactive: options.proactive, now });
  const pendingLogs: DecisionRecord[] = [];
  const notified = new Set<string>();

  const wake = (at: Date) => { if (nextWorkAt === null || at < nextWorkAt) nextWorkAt = at; };
  const activationEvidence = (events: readonly QueuedEvent[]): PiProactiveEvidence[] =>
    events.flatMap((event) => eventSourceSwitches(event).map((source) => ({
      source,
      ref: event.id,
      identity: event.identity ?? event.dedupeKey,
      label: event.summary,
      observedAt: event.occurredAt.toISOString(),
      verifiedAt: event.receivedAt.toISOString(),
      origin: 'event',
      materialHash: event.materialHash ?? null,
    })));
  const policyNote = (settings: Awaited<ReturnType<ProactiveStore['settings']['read']>>): string => {
    const enabledCategories = Object.entries(settings.categories)
      .filter(([, enabled]) => enabled).map(([category]) => category);
    const enabledSources = sourceIds.filter((source) => settings.sources[source]);
    return [
      `enabled sources=${enabledSources.join(',') || 'none'}`,
      `enabled categories=${enabledCategories.join(',') || 'none'}`,
      `suggestion scope=${settings.suggestionScope}`,
      `guidance=${JSON.stringify(settings.guidance)}`,
      'message_dan must carry category, Personal/Work/unknown scope and every evidence source.',
    ].join('; ');
  };

  async function flushLogs(signal: AbortSignal): Promise<void> {
    while (pendingLogs.length > 0) {
      try { await options.decisionLog.write(pendingLogs[0]!, signal); } catch {
        log('warn', { reason: 'decision_log_pending', pending: pendingLogs.length });
        return;
      }
      pendingLogs.shift();
    }
  }

  async function feedbackForWake(signal: AbortSignal) {
    try {
      return await bounded(options.piStore.latestProactiveMessageFeedback(
        options.owner, AbortSignal.any([signal, AbortSignal.timeout(diagnosticReadMs)]),
      ), diagnosticReadMs);
    } catch {
      log('warn', { reason: 'feedback_unavailable' });
      return undefined;
    }
  }

  /** One exact notice per month and state, as a chat message, so a stopped brain is never silent. */
  async function notifyBudget(state: 'warn' | 'exhausted', spent: number, limit: number, signal: AbortSignal): Promise<void> {
    const key = `${monthKey(now())}:${state}`;
    if (notified.has(key)) return;
    notified.add(key);
    const text = state === 'warn'
      ? `I've used ${spent.toFixed(0)} of my ${limit.toFixed(0)} DKK proactive budget this month, so I'll be more sparing.`
      : `I've used my ${limit.toFixed(0)} DKK proactive budget for this month, so I've stopped looking on my own. Chat still works. You can raise the budget in the proactive settings, or I'll start again next month.`;
    try { await options.comms.send({
      text,
      evidence: [{
        source: 'proactive-budget',
        ref: `budget:${monthKey(now())}`,
        identity: `proactive-budget:${monthKey(now())}`,
        label: 'Proactive budget ledger',
        observedAt: now().toISOString(),
        verifiedAt: now().toISOString(),
        origin: 'event',
      }],
      followUpIds: [],
    }, { runId: 'budget', sent: [], wrote: [], looked: [] }, signal); } catch (error) {
      // Kept only once Dan has it (or already had exactly this today); any other refusal or failure is tried again on a later tick.
      if (!(error instanceof BrainCommsRefusal && error.reason === 'duplicate')) notified.delete(key);
      log('warn', { reason: 'budget_notice_failed' });
    }
  }

  /** What Dan asks first about a tick: how many events wait, how many wakes today, what the month has cost. */
  async function tickSnapshot(): Promise<LogFields> {
    const [slotStatus, spent] = await bounded(Promise.allSettled([
      slots.status(), proactive.spend.monthTotal(monthKey(now())),
    ]), diagnosticReadMs);
    return {
      ...(slotStatus.status === 'fulfilled' ? { queued: slotStatus.value.queue.pending, wakesToday: slotStatus.value.used } : {}),
      ...(spent.status === 'fulfilled' ? { spendMonthDkk: Number(spent.value.toFixed(4)) } : {}),
    };
  }

  /** One `pi.brain_tick` when the outcome differs from the pass before (the first pass after startup counts), never one per 30 s. */
  async function recordTick(outcome: BrainTickOutcome): Promise<void> {
    try {
      const changed = lastTick?.outcome !== outcome;
      lastTick = { at: now(), outcome };
      if (!changed) return;
      let snapshot: LogFields = {};
      try { snapshot = await tickSnapshot(); } catch { /* The outcome is worth a line without the numbers. */ }
      const dueInMs = nextWorkAt === null ? undefined : nextWorkAt.getTime() - now().getTime();
      emit(outcome === 'failed' || outcome === 'watches_unavailable' ? 'warn' : 'info', 'pi.brain_tick', {
        outcome, ...snapshot, ...(dueInMs === undefined ? {} : { nextDueInSec: Math.max(0, Math.round(dueInMs / 1000)) }),
      });
    } catch { /* Logging cannot change a tick. */ }
  }

  /** Said once at startup, so "off" can be told from "on and idle" without waiting for an event. */
  async function logState(): Promise<void> {
    try {
      const signal = AbortSignal.timeout(diagnosticReadMs);
      const [state, settings] = await bounded(Promise.all([
        options.piStore.readBrainSwitch(options.owner, signal), options.proactive.settings.read(),
      ]), diagnosticReadMs);
      emit('info', 'pi.brain_state', { enabled: state.enabled, paused: settings.paused });
    } catch {
      emit('warn', 'pi.brain_state', { reason: 'unreadable' });
    }
  }

  async function runTick(signal: AbortSignal): Promise<RanTick> {
    const current = now();
    const result = (outcome: BrainTickOutcome, claimed = 0, runId?: string): RanTick => ({ outcome, claimed, runId });
    await flushLogs(signal);
    const state = await options.piStore.readBrainSwitch(options.owner, signal);
    if (!state.enabled) return result('off');
    const settings = await proactive.settings.read();
    if (settings.paused) return result('paused');
    if (!Object.values(settings.sources).some(Boolean)) return result('no_sources');
    const queueDue = await queue.hasWork(current);
    let extraDue: Date | null = null;
    if (options.extras) {
      try { extraDue = await options.extras.nextDueAt(signal); } catch {
        // The vault could not be read, so what is due is unknown: look again in a few minutes, without a model call.
        wake(new Date(current.getTime() + RETRY_MS));
        log('warn', { reason: 'watches_unavailable' });
      }
    }
    const extraNow = extraDue !== null && extraDue <= current;
    if (!queueDue && !extraNow) return result('empty');
    const slotStatus = await slots.status();
    const persistedLastWakeAt = slotStatus.lastAt === null ? 0 : Date.parse(slotStatus.lastAt);
    lastWakeAt = Math.max(lastWakeAt, persistedLastWakeAt);
    const sinceLast = current.getTime() - lastWakeAt;
    if (lastWakeAt > 0 && sinceLast < MIN_WAKE_GAP_MS) {
      wake(new Date(lastWakeAt + MIN_WAKE_GAP_MS));
      return result('spaced');
    }
    if (slotStatus.used >= slotStatus.allowed) {
      wake(nextCopenhagenDayStart(current));
      return result('daily_cap');
    }
    const month = monthKey(current);
    const spent = await proactive.spend.monthTotal(month);
    const budgetLimit = effectiveProactiveBudget(settings.monthlyBudgetDkk);
    if (budgetLimit <= 0 || !canRunWithinBudget(budgetLimit, spent, PI_WAKE_PREFLIGHT_DKK)) {
      wake(new Date(current.getTime() + HOUR_MS));
      await notifyBudget('exhausted', spent, budgetLimit, signal);
      return result('budget_exhausted');
    }
    const budgetNote = budgetState(budgetLimit, spent) === 'warn'
      ? `The proactive budget is ${Math.round((spent / budgetLimit) * 100)} percent used this month (${spent.toFixed(0)} of ${budgetLimit.toFixed(0)} DKK). Be sparing: look at what matters, skip what can wait.`
      : undefined;
    if (budgetNote) await notifyBudget('warn', spent, budgetLimit, signal);

    const claimed = queueDue ? await queue.claim(current, MAX_WAKE_EVENTS, LEASE_MS) : [];
    if (claimed.length === MAX_WAKE_EVENTS) wake(current);
    const survivors: QueuedEvent[] = [];
    const settled: { id: string; outcome: string; reopenable?: boolean }[] = [];
    for (const event of claimed) {
      const maxAge = event.source === 'timer' ? timerMaxAgeMs : defaultMaxAgeMs;
      if (event.attempts > MAX_EVENT_ATTEMPTS) settled.push({ id: event.id, outcome: 'gave up after retries' });
      else if (eventSourceSwitches(event).some((source) => !settings.sources[source])) {
        settled.push({ id: event.id, outcome: 'source disabled', reopenable: true });
      }
      else if (current.getTime() - event.occurredAt.getTime() > maxAge) {
        settled.push({ id: event.id, outcome: 'stale', reopenable: true });
      }
      else survivors.push(event);
    }
    // A timer review alone is not worth waking at night; the evening or morning one covers it.
    const timerOnly = survivors.length > 0 && survivors.every((event) => event.source === 'timer');
    if (timerOnly && isQuietHour(current) && !extraNow) {
      settled.push(...survivors.map(({ id }) => ({ id, outcome: 'timer review skipped in quiet hours' })));
      survivors.length = 0;
    }
    const deferredFollowUps = isQuietHour(current) && !extraNow
      ? survivors.filter((event) => event.source === 'followup')
      : [];
    if (deferredFollowUps.length > 0) {
      const retryAt = nextSlotAfter(current).at;
      await queue.retryLater(deferredFollowUps.map(({ id }) => id), retryAt);
      for (const event of deferredFollowUps) {
        const index = survivors.findIndex(({ id }) => id === event.id);
        if (index >= 0) survivors.splice(index, 1);
      }
      wake(retryAt);
    }
    if (settled.length > 0) await queue.settle(settled, current);
    if (survivors.length === 0 && !extraNow) return result('filtered', claimed.length);

    let extra: { sections: readonly string[]; lines: readonly string[]; due: readonly string[] } = { sections: [], lines: [], due: [] };
    if (options.extras) {
      try { extra = await options.extras.sections(current, signal); } catch {
        // Without the open watches a wake would miss what the events are about; keep the events and try again shortly.
        const retryAt = new Date(current.getTime() + RETRY_MS);
        if (survivors.length > 0) await queue.retryLater(survivors.map(({ id }) => id), retryAt);
        wake(retryAt);
        log('warn', { reason: 'watches_unavailable' });
        return result('watches_unavailable', claimed.length);
      }
    }
    const runId = (options.newRunId ?? randomUUID)();
    const sourceNames = [...new Set(survivors.map(({ source }) => source))];
    const activationType = sourceNames.length > 0 && sourceNames.every((source) => source === 'timer')
      ? 'scheduled' as const
      : 'event' as const;
    const activationSource = sourceNames.length === 1
      ? sourceNames[0]!
      // Woken by nothing but a due watch: the ledger says so, since a watch look is not a ledger kind of its own.
      : sourceNames.length === 0 && extra.due.length > 0 ? 'watch' : 'mixed';
    const slotKey = activationType === 'event' ? nextSlotAfter(current).key : null;
    // Counted before the call, so a failing or crashing wake still uses up the combined daily allowance.
    const reservation = await slots.reserve({
      runId,
      eventCount: survivors.length,
      activationType,
      satisfiedSlot: slotKey,
      allowQuiet: activationType === 'event',
      policyRevision: proactiveSettingsRevision(settings),
      worstCaseDkk: PI_WAKE_PREFLIGHT_DKK,
    });
    if (!reservation.allowed) {
      const retryAt = reservation.status.nextAllowedAt
        ? new Date(reservation.status.nextAllowedAt)
        : new Date(current.getTime() + HOUR_MS);
      await queue.retryLater(survivors.map(({ id }) => id), retryAt);
      wake(retryAt);
      return result(reservation.reason, claimed.length);
    }
    lastWakeAt = current.getTime();
    const outcome = await options.gateway.runBrain({
      runId,
      activationType,
      activationSource,
      slotKey,
      evidence: activationEvidence(survivors),
      body: formatWake({
        runId, activationType, activationSource,
        now: current, timeZone: options.timeZone, events: survivors, sections: extra.sections,
        policyNote: policyNote(settings), budgetNote, feedback: await feedbackForWake(signal),
      }),
    }, signal);
    const at = now();
    // Reconcile the provisional worst case even when the provider returned zero tokens.
    await proactive.spend.record({
      runId, month: monthKey(at), inputTokens: outcome.usage.inputTokens, outputTokens: outcome.usage.outputTokens,
      estimatedDkk: outcome.costDkk, createdAt: at,
    }).catch(() => log('warn', { reason: 'spend_record_failed' }));
    await options.extras?.afterRun({ runId, costDkk: outcome.costDkk, events: survivors.length, run: outcome.run, due: extra.due }, signal)
      .catch(() => log('warn', { reason: 'watch_cost_not_recorded' }));
    if (outcome.ok) {
      await queue.settle(survivors.map(({ id }) => ({ id, outcome: `brain wake ${runId.slice(0, 8)}`, batchId: runId })), at);
    } else {
      const attempts = Math.max(1, ...survivors.map(({ attempts: count }) => count));
      const retryAt = new Date(at.getTime() + attempts * 5 * 60_000);
      if (survivors.length > 0) await queue.retryLater(survivors.map(({ id }) => id), retryAt);
      wake(new Date(Math.max(retryAt.getTime(), at.getTime() + MIN_WAKE_GAP_MS)));
    }
    const record: DecisionRecord = {
      runId, at, events: survivors, extra: extra.lines, result: outcome, errorMessage: outcome.error?.code,
    };
    if (pendingLogs.length < maxPendingLogs) pendingLogs.push(record);
    await flushLogs(signal);
    const failedReason: BrainLogReason = outcome.error?.code ?? (outcome.outcome === 'ok' ? 'failed' : outcome.outcome);
    log(outcome.ok ? 'info' : 'warn', {
      reason: outcome.ok ? 'done' : failedReason, events: survivors.length, sent: outcome.run.sent.length,
      tools: outcome.toolResults.length, costDkk: Number(outcome.costDkk.toFixed(4)),
    });
    return result(outcome.ok ? 'done' : 'failed', claimed.length, runId);
  }

  /** A sweep that ends without a wake: the run row says why, and so does one log line. */
  async function finishWithoutWake(claim: SweepClaim, status: 'failed' | 'skipped', reason: BrainLogReason): Promise<boolean> {
    const finished = await proactive.runs.finish(claim.run.id, claim.generation, status, reason, 0, now());
    log(status === 'failed' ? 'warn' : 'info', { reason, trigger: claim.run.trigger });
    return finished;
  }

  async function reviewInbox(claim: SweepClaim, signal: AbortSignal) {
    if (signal.aborted || !options.afterScheduledWake) return;
    await options.afterScheduledWake({
      runId: claim.run.id, trigger: claim.run.trigger, now: now(), signal, facts: [], sources: [], findings: [],
    }).catch(() => log('warn', { reason: 'inbox_review_failed' }));
  }

  async function runScheduledOnce(claim: SweepClaim, signal: AbortSignal = new AbortController().signal): Promise<void> {
    const state = await options.piStore.readBrainSwitch(options.owner, signal);
    if (!state.enabled) { await finishWithoutWake(claim, 'skipped', 'background_off'); return; }
    const settings = await options.proactive.settings.read();
    if (settings.paused) { await finishWithoutWake(claim, 'skipped', 'paused'); return; }
    if (!Object.values(settings.sources).some(Boolean)) { await finishWithoutWake(claim, 'skipped', 'no_sources'); return; }
    const current = now();
    const slot = await slots.status();
    if (claim.run.slot && slot.lastAt && slot.lastActivationType === 'event') {
      const currentSlotAt = localSlotInstant(claim.run.slot);
      const previousSlotAt = latestSlotAtOrBefore(new Date(currentSlotAt.getTime() - 1)).at;
      if (slot.lastSatisfiedSlot === claim.run.slot &&
          Date.parse(slot.lastAt) > previousSlotAt.getTime()) {
        // The event already used this slot's PI turn. Its independent Inbox review is still due.
        if (await finishWithoutWake(claim, 'skipped', 'satisfied_by_event')) await reviewInbox(claim, signal);
        return;
      }
    }
    if (slot.used >= slot.allowed) { await finishWithoutWake(claim, 'skipped', 'daily_cap'); return; }
    if (slot.lastAt && current.getTime() - Date.parse(slot.lastAt) < MIN_WAKE_GAP_MS) {
      await finishWithoutWake(claim, 'skipped', 'satisfied_by_recent_activation');
      return;
    }
    const spent = await options.proactive.spend.monthTotal(monthKey(current));
    const budgetLimit = effectiveProactiveBudget(settings.monthlyBudgetDkk);
    if (budgetLimit <= 0 || !canRunWithinBudget(budgetLimit, spent, PI_WAKE_PREFLIGHT_DKK)) {
      await notifyBudget('exhausted', spent, budgetLimit, signal);
      await finishWithoutWake(claim, 'skipped', 'budget_exhausted');
      return;
    }
    const budgetNote = budgetState(budgetLimit, spent) === 'warn'
      ? `The proactive budget is ${Math.round((spent / budgetLimit) * 100)} percent used this month. Be sparing.`
      : undefined;
    let extra: { sections: readonly string[]; lines: readonly string[]; due: readonly string[] } = {
      sections: [], lines: [], due: [],
    };
    if (options.extras) {
      try { extra = await options.extras.sections(current, signal); }
      catch {
        await finishWithoutWake(claim, 'failed', 'situation_sources_unavailable');
        return;
      }
    }
    const reservation = await slots.reserve({
      runId: claim.run.id,
      eventCount: 0,
      activationType: 'scheduled',
      satisfiedSlot: claim.run.slot,
      allowQuiet: claim.run.trigger === 'manual',
      policyRevision: proactiveSettingsRevision(settings),
      worstCaseDkk: PI_WAKE_PREFLIGHT_DKK,
    });
    if (!reservation.allowed) {
      await finishWithoutWake(claim, 'skipped', reservation.reason === 'spaced'
        ? 'satisfied_by_recent_activation'
        : reservation.reason);
      return;
    }
    const outcome = await options.gateway.runBrain({
      runId: claim.run.id,
      activationType: 'scheduled',
      activationSource: claim.run.trigger === 'manual' ? 'manual' : 'timer',
      slotKey: claim.run.slot,
      body: formatWake({
        runId: claim.run.id,
        activationType: 'scheduled',
        activationSource: claim.run.trigger === 'manual' ? 'manual' : 'timer',
        now: current,
        timeZone: options.timeZone,
        events: [],
        sections: extra.sections,
        policyNote: policyNote(settings),
        feedback: await feedbackForWake(signal),
        budgetNote,
      }),
    }, signal);
    const at = now();
    // As on the tick path: a ledger write that fails is logged, it does not turn a wake that happened into a failed run.
    await options.proactive.spend.record({
      runId: claim.run.id,
      month: monthKey(at),
      inputTokens: outcome.usage.inputTokens,
      outputTokens: outcome.usage.outputTokens,
      estimatedDkk: outcome.costDkk,
      createdAt: at,
    }).catch(() => log('warn', { reason: 'spend_record_failed' }));
    await options.extras?.afterRun({
      runId: claim.run.id, costDkk: outcome.costDkk, events: 0, run: outcome.run, due: extra.due,
    }, signal).catch(() => log('warn', { reason: 'watch_cost_not_recorded' }));
    if (pendingLogs.length < maxPendingLogs) {
      pendingLogs.push({
        runId: claim.run.id,
        at,
        events: [],
        extra: extra.lines,
        result: outcome,
        errorMessage: outcome.error?.code,
      });
    }
    await flushLogs(signal);
    const failedReason: BrainLogReason = outcome.error?.code ?? (outcome.outcome === 'ok' ? 'failed' : outcome.outcome);
    const finished = await proactive.runs.finish(claim.run.id, claim.generation, outcome.ok ? 'done' : 'failed', outcome.ok ? null : failedReason, 0, now());
    if (finished && outcome.ok) await reviewInbox(claim, signal);
    log(outcome.ok ? 'info' : 'warn', {
      reason: outcome.ok ? 'scheduled_done' : failedReason,
      trigger: claim.run.trigger,
      events: 0,
      sent: outcome.run.sent.length,
      tools: outcome.toolResults.length,
      costDkk: Number(outcome.costDkk.toFixed(4)),
    });
  }

  async function runScheduled(claim: SweepClaim, signal: AbortSignal = new AbortController().signal): Promise<void> {
    if (running || scheduledActive) {
      await finishWithoutWake(claim, 'skipped', 'satisfied_by_active_activation');
      return;
    }
    scheduledActive = true;
    try { await runScheduledOnce(claim, signal); }
    finally { scheduledActive = false; }
  }

  return {
    /** A producer queued something, or the owner turned the switch on: look at the queue on the next tick. */
    wake: () => wake(now()),
    /** The exact same PI path for a 07:00/18:00 sweep or an owner-requested Check now. */
    runScheduled,
    async enabled(signal: AbortSignal): Promise<boolean> {
      const [state, settings] = await Promise.all([
        options.piStore.readBrainSwitch(options.owner, signal),
        options.proactive.settings.read(),
      ]);
      return state.enabled && !settings.paused;
    },
    async status() { return slots.status(); },
    /** Reads the queue once at startup, so work left by a restart is picked up, and says whether the owner's switch is on. */
    async start(): Promise<void> {
      await logState();
      const due = await queue.nextDueAt();
      if (due) wake(due);
      const extraDue = options.extras ? await options.extras.nextDueAt(AbortSignal.timeout(15_000)).catch(() => 'retry' as const) : null;
      if (extraDue === 'retry') wake(new Date(now().getTime() + RETRY_MS));
      else if (extraDue) wake(extraDue);
    },
    /** One pass. Idle without a database read when nothing is due. */
    tick(signal: AbortSignal): Promise<BrainTick> {
      if (scheduledActive) return Promise.resolve({ outcome: 'active_activation', claimed: 0 });
      if (running) return running;
      if (nextWorkAt === null || nextWorkAt > now()) return Promise.resolve({ outcome: 'idle', claimed: 0 });
      nextWorkAt = null;
      running = runTick(signal).then(async (tick): Promise<BrainTick> => {
        // Another wake may have replaced a later deadline; read the queue again so no event is lost. Blocked outcomes keep their own deadline.
        if (!['off', 'paused', 'budget_exhausted', 'daily_cap', 'spaced'].includes(tick.outcome)) {
          const due = await queue.nextDueAt().catch(() => null);
          if (due) wake(new Date(Math.max(due.getTime(), lastWakeAt + MIN_WAKE_GAP_MS)));
          const extraDue = options.extras ? await options.extras.nextDueAt(signal).catch(() => 'retry' as const) : null;
          if (extraDue === 'retry') wake(new Date(now().getTime() + RETRY_MS));
          else if (extraDue) wake(new Date(Math.max(extraDue.getTime(), lastWakeAt + MIN_WAKE_GAP_MS)));
        }
        await recordTick(tick.outcome);
        return tick;
      }, (error: unknown) => {
        // An interrupted pass leaves its claims leased; look again once the lease has lapsed.
        wake(new Date(now().getTime() + LEASE_MS + 1_000));
        throw error;
      }).finally(() => { running = undefined; });
      return running;
    },
    get pendingLogs() { return pendingLogs.length; },
    /** The last pass that read the queue since this backend started, or null. */
    get lastTick(): BrainTickRecord | null { return lastTick; },
    /** When the brain looks again, or null when nothing is scheduled. */
    get nextDueAt(): Date | null { return nextWorkAt; },
  };
}

export type Brain = ReturnType<typeof createBrain>;
