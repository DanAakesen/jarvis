import { randomUUID } from 'node:crypto';
import { budgetState, canRunWithinBudget, estimateCost } from '../../proactive/budget.js';
import type { EventQueueStore } from '../../proactive/events/event-queue.js';
import { MAX_EVENT_ATTEMPTS } from '../../proactive/events/rules.js';
import type { QueuedEvent } from '../../proactive/events/types.js';
import type { ProactiveStore } from '../../proactive/store.js';
import { copenhagenDayStart, isQuietHour, monthKey } from '../../proactive/time.js';
import { PI_MODEL } from '../definition.js';
import type { PiBrainRun } from '../turns.js';
import type { PiGateway } from '../gateway.js';
import type { PiStore } from '../store.js';
import { BrainCommsRefusal, type BrainComms } from './comms.js';
import type { DecisionLog, DecisionRecord } from './decision-log.js';
import { MAX_WAKE_EVENTS, formatWake } from './wake.js';

/** Exact cost guards. One wake covers many events; wakes are spaced and counted. */
export const MIN_WAKE_GAP_MS = 10 * 60_000;
export const MAX_WAKES_PER_DAY = 12;
const LEASE_MS = 6 * 60_000;
const HOUR_MS = 60 * 60_000;
const RETRY_MS = 5 * 60_000;
const timerMaxAgeMs = HOUR_MS;
const defaultMaxAgeMs = 24 * HOUR_MS;
/** What one wake may cost at worst, for the budget check before it starts: a long prompt and a long answer at the model's price. */
const worstCaseInputTokens = 90_000;
const worstCaseOutputTokens = 6_000;
const maxPendingLogs = 24;

export interface BrainOptions {
  readonly queue: EventQueueStore;
  readonly gateway: Pick<PiGateway, 'runBrain'>;
  readonly proactive: Pick<ProactiveStore, 'settings' | 'spend'>;
  readonly piStore: Pick<PiStore, 'readBrainSwitch'>;
  readonly comms: BrainComms;
  readonly decisionLog: DecisionLog;
  readonly owner: string;
  readonly timeZone: string;
  readonly now: () => Date;
  readonly newRunId?: () => string;
  readonly logger?: { info?: (data: Record<string, string | number>, message: string) => void; warn?: (data: Record<string, string | number>, message: string) => void } | undefined;
  /** Sections a wake carries besides events, such as open watches that are due. */
  readonly extras?: {
    /** When something besides the queue is due, so the wake is not missed. */
    nextDueAt(signal: AbortSignal): Promise<Date | null>;
    sections(now: Date, signal: AbortSignal): Promise<{ sections: readonly string[]; lines: readonly string[]; due: readonly string[] }>;
    /** After a wake: what it cost, and what woke it, so each watch looked at can be given its share. */
    afterRun(input: { runId: string; costDkk: number; events: number; run: PiBrainRun; due: readonly string[] }, signal: AbortSignal): Promise<void>;
  } | undefined;
}

export interface BrainTick {
  /** Why nothing ran, or `done` / `failed` after a wake. */
  readonly outcome: string;
  readonly claimed: number;
  readonly runId?: string | undefined;
}

/**
 * The brain loop on the PI agent: trigger (the 30 s ticker finds events in the queue, a timer review or a due watch),
 * context (the agent reads the vault, the session and its signals through tools), decide, act through tools, evaluate, decide
 * whether and how to tell Dan, and log the decision. Everything that must be exact is here and not in the model: the owner's
 * switch, the pause, the budget stop, the spacing and daily count of wakes, event admission, retries and the decision log.
 * What the events mean and what to do about them is the model's decision.
 */
export function createBrain(options: BrainOptions) {
  const { queue, proactive, now } = options;
  const log = (level: 'info' | 'warn', data: Record<string, string | number>) => {
    try { options.logger?.[level]?.(data, 'pi.brain'); } catch { /* Logging cannot change a wake. */ }
  };
  let nextWorkAt: Date | null = null;
  let lastWakeAt = 0;
  let running: Promise<BrainTick> | undefined;
  const pendingLogs: DecisionRecord[] = [];
  const notified = new Set<string>();

  const wake = (at: Date) => { if (nextWorkAt === null || at < nextWorkAt) nextWorkAt = at; };

  async function flushLogs(signal: AbortSignal): Promise<void> {
    while (pendingLogs.length > 0) {
      try { await options.decisionLog.write(pendingLogs[0]!, signal); } catch {
        log('warn', { reason: 'decision_log_pending', pending: pendingLogs.length });
        return;
      }
      pendingLogs.shift();
    }
  }

  /** One exact notice per month and state, as a chat message, so a stopped brain is never silent. */
  async function notifyBudget(state: 'warn' | 'exhausted', spent: number, limit: number, signal: AbortSignal): Promise<void> {
    const key = `${monthKey(now())}:${state}`;
    if (notified.has(key)) return;
    notified.add(key);
    const text = state === 'warn'
      ? `PI has used ${spent.toFixed(0)} of its ${limit.toFixed(0)} DKK proactive budget this month. I will be more sparing.`
      : `PI has used its ${limit.toFixed(0)} DKK proactive budget for this month, so it has stopped looking on its own. Chat still works. You can raise the budget in the proactive settings, or it starts again next month.`;
    try { await options.comms.send({ text }, { runId: 'budget', sent: [], wrote: [], looked: [] }, signal); } catch (error) {
      // Kept only once Dan has it (or already had exactly this today); any other refusal or failure is tried again on a later tick.
      if (!(error instanceof BrainCommsRefusal && error.reason === 'duplicate')) notified.delete(key);
      log('warn', { reason: 'budget_notice_failed' });
    }
  }

  async function runTick(signal: AbortSignal): Promise<BrainTick> {
    const current = now();
    const result = (outcome: string, claimed = 0, runId?: string): BrainTick => ({ outcome, claimed, runId });
    await flushLogs(signal);
    const state = await options.piStore.readBrainSwitch(options.owner, signal);
    if (!state.enabled) return result('off');
    const settings = await proactive.settings.read();
    if (settings.paused) return result('paused');
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
    const sinceLast = current.getTime() - lastWakeAt;
    if (sinceLast < MIN_WAKE_GAP_MS) { wake(new Date(lastWakeAt + MIN_WAKE_GAP_MS)); return result('spaced'); }
    if (await queue.modelBatchesSince(copenhagenDayStart(current)) >= MAX_WAKES_PER_DAY) {
      wake(new Date(copenhagenDayStart(current).getTime() + 36 * HOUR_MS));
      return result('daily_cap');
    }
    const month = monthKey(current);
    const spent = await proactive.spend.monthTotal(month);
    const worstCase = estimateCost(PI_MODEL, worstCaseInputTokens, worstCaseOutputTokens).estimatedDkk;
    if (settings.monthlyBudgetDkk <= 0 || !canRunWithinBudget(settings.monthlyBudgetDkk, spent, worstCase)) {
      wake(new Date(current.getTime() + HOUR_MS));
      await notifyBudget('exhausted', spent, settings.monthlyBudgetDkk, signal);
      return result('budget_exhausted');
    }
    const budgetNote = budgetState(settings.monthlyBudgetDkk, spent) === 'warn'
      ? `The proactive budget is ${Math.round((spent / settings.monthlyBudgetDkk) * 100)} percent used this month (${spent.toFixed(0)} of ${settings.monthlyBudgetDkk.toFixed(0)} DKK). Be sparing: look at what matters, skip what can wait.`
      : undefined;
    if (budgetNote) await notifyBudget('warn', spent, settings.monthlyBudgetDkk, signal);

    const claimed = queueDue ? await queue.claim(current, MAX_WAKE_EVENTS, LEASE_MS) : [];
    if (claimed.length === MAX_WAKE_EVENTS) wake(current);
    const survivors: QueuedEvent[] = [];
    const settled: { id: string; outcome: string }[] = [];
    for (const event of claimed) {
      const maxAge = event.source === 'timer' ? timerMaxAgeMs : defaultMaxAgeMs;
      if (event.attempts > MAX_EVENT_ATTEMPTS) settled.push({ id: event.id, outcome: 'gave up after retries' });
      else if (current.getTime() - event.occurredAt.getTime() > maxAge) settled.push({ id: event.id, outcome: 'stale' });
      else survivors.push(event);
    }
    // A timer review alone is not worth waking at night; the evening or morning one covers it.
    const timerOnly = survivors.length > 0 && survivors.every((event) => event.source === 'timer');
    if (timerOnly && isQuietHour(current) && !extraNow) {
      settled.push(...survivors.map(({ id }) => ({ id, outcome: 'timer review skipped in quiet hours' })));
      survivors.length = 0;
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
    // Counted before the call, so a failing or crashing wake still uses up the daily allowance.
    await queue.startBatch(runId, current, survivors.length);
    lastWakeAt = current.getTime();
    const outcome = await options.gateway.runBrain({
      runId, body: formatWake({ runId, now: current, timeZone: options.timeZone, events: survivors, sections: extra.sections, budgetNote }),
    }, signal);
    const at = now();
    if (outcome.usage.inputTokens > 0 || outcome.usage.outputTokens > 0) {
      // Spent is spent, whether or not the answer was usable: the tokens were billed.
      await proactive.spend.record({
        runId, month: monthKey(at), inputTokens: outcome.usage.inputTokens, outputTokens: outcome.usage.outputTokens,
        estimatedDkk: outcome.costDkk, createdAt: at,
      }).catch(() => log('warn', { reason: 'spend_record_failed' }));
    }
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
    log(outcome.ok ? 'info' : 'warn', {
      reason: outcome.ok ? 'done' : (outcome.error?.code ?? outcome.outcome), events: survivors.length, sent: outcome.run.sent.length,
      tools: outcome.toolResults.length, costDkk: Number(outcome.costDkk.toFixed(4)),
    });
    return result(outcome.ok ? 'done' : 'failed', claimed.length, runId);
  }

  return {
    /** A producer queued something, or the owner turned the switch on: look at the queue on the next tick. */
    wake: () => wake(now()),
    /** Reads the queue once at startup, so work left by a restart is picked up. */
    async start(): Promise<void> {
      const due = await queue.nextDueAt();
      if (due) wake(due);
      const extraDue = options.extras ? await options.extras.nextDueAt(AbortSignal.timeout(15_000)).catch(() => 'retry' as const) : null;
      if (extraDue === 'retry') wake(new Date(now().getTime() + RETRY_MS));
      else if (extraDue) wake(extraDue);
    },
    /** One pass. Idle without a database read when nothing is due. */
    tick(signal: AbortSignal): Promise<BrainTick> {
      if (running) return running;
      if (nextWorkAt === null || nextWorkAt > now()) return Promise.resolve({ outcome: 'idle', claimed: 0 });
      nextWorkAt = null;
      running = runTick(signal).then(async (tick) => {
        // Another wake may have replaced a later deadline; read the queue again so no event is lost. Blocked outcomes keep their own deadline.
        if (!['off', 'paused', 'budget_exhausted', 'daily_cap', 'spaced'].includes(tick.outcome)) {
          const due = await queue.nextDueAt().catch(() => null);
          if (due) wake(new Date(Math.max(due.getTime(), lastWakeAt + MIN_WAKE_GAP_MS)));
          const extraDue = options.extras ? await options.extras.nextDueAt(signal).catch(() => 'retry' as const) : null;
          if (extraDue === 'retry') wake(new Date(now().getTime() + RETRY_MS));
          else if (extraDue) wake(new Date(Math.max(extraDue.getTime(), lastWakeAt + MIN_WAKE_GAP_MS)));
        }
        return tick;
      }, (error: unknown) => {
        // An interrupted pass leaves its claims leased; look again once the lease has lapsed.
        wake(new Date(now().getTime() + LEASE_MS + 1_000));
        throw error;
      }).finally(() => { running = undefined; });
      return running;
    },
    get pendingLogs() { return pendingLogs.length; },
  };
}

export type Brain = ReturnType<typeof createBrain>;
