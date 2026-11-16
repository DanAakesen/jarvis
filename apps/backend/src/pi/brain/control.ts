import { budgetState, type BudgetState } from '../../proactive/budget.js';
import type { ProactiveStore } from '../../proactive/store.js';
import { copenhagenDayStart, monthKey } from '../../proactive/time.js';
import { brainTurnKinds, type PiStore } from '../store.js';

export interface BrainStatus {
  /** True when the brain is wired into this backend (PI configured, proactive path and queue present). */
  readonly available: boolean;
  /** The owner's test switch. Off until he turns it on; the brain wakes only while it is on. */
  readonly enabled: boolean;
  readonly updatedAt: string | null;
  readonly paused: boolean;
  readonly budget: { readonly limitDkk: number; readonly spentDkk: number; readonly state: BudgetState };
  readonly month: { readonly wakes: number; readonly costDkk: number };
  readonly today: { readonly messages: number };
  readonly lastWake: null | { readonly at: string; readonly totalMs: number; readonly inputTokens: number; readonly cachedTokens: number; readonly outputTokens: number; readonly costDkk: number; readonly outcome: string };
  /** Decision-log entries not yet in the vault; retried on every tick. */
  readonly logPending: number;
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
  /** Present once the brain is wired; its wake is called when the owner turns the switch on. */
  readonly brain: () => { wake(): void; readonly pendingLogs: number } | undefined;
}): BrainControl {
  async function read(signal: AbortSignal): Promise<BrainStatus> {
    const now = options.now();
    const [state, settings, spent, month, last, today] = await Promise.all([
      options.store.readBrainSwitch(options.owner, signal),
      options.proactive.settings.read(),
      options.proactive.spend.monthTotal(monthKey(now)),
      options.store.spendSince(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), brainTurnKinds, signal),
      options.store.lastTurn(brainTurnKinds, signal),
      options.store.messagesSince(copenhagenDayStart(now), signal),
    ]);
    const brain = options.brain();
    return {
      available: brain !== undefined, enabled: state.enabled, updatedAt: state.updatedAt?.toISOString() ?? null, paused: settings.paused,
      budget: { limitDkk: settings.monthlyBudgetDkk, spentDkk: Number(spent.toFixed(4)), state: budgetState(settings.monthlyBudgetDkk, spent) },
      month: { wakes: month.turns, costDkk: Number(month.costDkk.toFixed(4)) },
      today: { messages: today.count },
      lastWake: last ? {
        at: last.at.toISOString(), totalMs: last.totalMs, inputTokens: last.inputTokens, cachedTokens: last.cachedTokens,
        outputTokens: last.outputTokens, costDkk: last.costDkk, outcome: last.outcome,
      } : null,
      logPending: brain?.pendingLogs ?? 0,
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
