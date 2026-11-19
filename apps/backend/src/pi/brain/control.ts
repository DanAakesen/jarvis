import { budgetState, effectiveProactiveBudget, type BudgetState } from '../../proactive/budget.js';
import type { ProactiveStore } from '../../proactive/store.js';
import { copenhagenDayStart, monthKey } from '../../proactive/time.js';
import { brainTurnKinds, type PiStore } from '../store.js';
import type { PiBackgroundSlotStatus } from '../activation-slots.js';
import type { PiSituationService } from '../situation.js';

export interface BrainStatus {
  /** True when the brain is wired into this backend (PI configured, proactive path and queue present). */
  readonly available: boolean;
  /** The owner's Background PI switch. Off until he turns it on; the brain wakes only while it is on. */
  readonly enabled: boolean;
  readonly updatedAt: string | null;
  readonly paused: boolean;
  readonly budget: { readonly limitDkk: number; readonly spentDkk: number; readonly state: BudgetState };
  readonly month: { readonly wakes: number; readonly costDkk: number };
  readonly today: { readonly messages: number; readonly usedTurns: number; readonly allowedTurns: number };
  readonly lastWake: null | { readonly at: string; readonly totalMs: number; readonly inputTokens: number; readonly cachedTokens: number; readonly outputTokens: number; readonly costDkk: number; readonly outcome: string };
  /** Decision-log entries not yet in the vault; retried on every tick. */
  readonly logPending: number;
  readonly slots: PiBackgroundSlotStatus;
  readonly situation: {
    readonly revision: number;
    readonly asOf: string | null;
    readonly updatedAt: string | null;
    readonly staleSources: readonly string[];
    readonly missingSources: readonly string[];
    readonly disabledSources: readonly string[];
  };
  readonly cost: {
    readonly coldSweepMinDkk: 0.14;
    readonly coldSweepMaxDkk: 0.28;
    readonly representativeToolTurnDkk: 0.17;
    readonly preflightWorstCaseDkk: 0.79;
    readonly estimatedDayMinDkk: number;
    readonly estimatedDayMaxDkk: number;
    readonly estimatedThirtyDayMinDkk: number;
    readonly estimatedThirtyDayMaxDkk: number;
  };
}

export interface BrainControl {
  read(signal: AbortSignal): Promise<BrainStatus>;
  write(enabled: boolean, signal: AbortSignal): Promise<BrainStatus>;
}

export function createBrainControl(options: {
  readonly owner: string;
  readonly store: Pick<PiStore, 'readBrainSwitch' | 'writeBrainSwitch' | 'spendSince' | 'lastTurn' | 'messagesSince'>;
  readonly proactive: Pick<ProactiveStore, 'settings' | 'spend'>;
  readonly now: () => Date;
  readonly situation: PiSituationService;
  /** Present once the brain is wired; its wake is called when the owner turns the switch on. */
  readonly brain: () => {
    wake(): void;
    readonly pendingLogs: number;
    status(): Promise<PiBackgroundSlotStatus>;
  } | undefined;
}): BrainControl {
  async function read(signal: AbortSignal): Promise<BrainStatus> {
    const now = options.now();
    const brain = options.brain();
    const [state, settings, spent, month, last, today, situation, slots] = await Promise.all([
      options.store.readBrainSwitch(options.owner, signal),
      options.proactive.settings.read(),
      options.proactive.spend.monthTotal(monthKey(now)),
      options.store.spendSince(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), brainTurnKinds, signal),
      options.store.lastTurn(brainTurnKinds, signal),
      options.store.messagesSince(copenhagenDayStart(now), signal),
      options.situation.read(signal),
      brain ? brain.status() : Promise.resolve({
        used: 0, allowed: 12, remaining: 12, lastAt: null, lastActivationType: null,
        lastSatisfiedSlot: null, nextAllowedAt: null, quiet: false,
        queue: { pending: 0, leased: 0, retrying: 0 },
      } as const),
    ]);
    return {
      available: brain !== undefined, enabled: state.enabled, updatedAt: state.updatedAt?.toISOString() ?? null, paused: settings.paused,
      budget: {
        limitDkk: effectiveProactiveBudget(settings.monthlyBudgetDkk),
        spentDkk: Number(spent.toFixed(4)),
        state: budgetState(effectiveProactiveBudget(settings.monthlyBudgetDkk), spent),
      },
      month: { wakes: month.turns, costDkk: Number(month.costDkk.toFixed(4)) },
      today: { messages: today.count, usedTurns: slots.used, allowedTurns: slots.allowed },
      lastWake: last ? {
        at: last.at.toISOString(), totalMs: last.totalMs, inputTokens: last.inputTokens, cachedTokens: last.cachedTokens,
        outputTokens: last.outputTokens, costDkk: last.costDkk, outcome: last.outcome,
      } : null,
      logPending: brain?.pendingLogs ?? 0,
      slots,
      situation: {
        revision: situation.revision,
        asOf: situation.asOf,
        updatedAt: situation.updatedAt,
        staleSources: situation.staleSources,
        missingSources: situation.missingSources,
        disabledSources: situation.disabledSources,
      },
      cost: {
        coldSweepMinDkk: 0.14,
        coldSweepMaxDkk: 0.28,
        representativeToolTurnDkk: 0.17,
        preflightWorstCaseDkk: 0.79,
        estimatedDayMinDkk: Number((slots.allowed * 0.14).toFixed(2)),
        estimatedDayMaxDkk: Number((slots.allowed * 0.28).toFixed(2)),
        estimatedThirtyDayMinDkk: Number((slots.allowed * 0.14 * 30).toFixed(2)),
        estimatedThirtyDayMaxDkk: Math.min(100, Number((slots.allowed * 0.28 * 30).toFixed(2))),
      },
    };
  }
  return {
    read,
    async write(enabled, signal) {
      await options.store.writeBrainSwitch(options.owner, enabled, options.now(), signal);
      if (enabled) options.brain()?.wake();
      return read(signal);
    },
  };
}
