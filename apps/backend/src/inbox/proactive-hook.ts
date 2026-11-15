import type { FoundryModelUsage } from '../core/usage.js';
import { canRunWithinBudget, estimateCost } from '../proactive/budget.js';
import type { FindingsStoredContext } from '../proactive/engine.js';
import type { ProactiveStore } from '../proactive/store.js';
import { dayKey, monthKey } from '../proactive/time.js';
import { highestFoundryTokenCosts } from '../core/usage-pricing.js';
import type { InboxNudgePass, NudgeDelivery, ProactiveReactions } from './nudge.js';

/** A review reads at most about 14 000 tokens and writes at most 4 096; priced at the highest known rate until measured. */
const worstCaseTokens = { input: 14_000, output: 4_096 } as const;
/** The design's inbox ceiling, inside the shared 100 DKK a month. Counted per replica. */
export const INBOX_DAILY_CEILING_DKK = 1;

/** Delivers a nudge as a proactive item (the card) and, for medium and high, as an insight push through the existing alert hook. */
export function createProactiveNudgeDelivery(
  store: Pick<ProactiveStore, 'items'>,
  context: FindingsStoredContext,
  now: () => Date,
): NudgeDelivery {
  return {
    async deliver(nudge, signal) {
      signal.throwIfAborted();
      const at = now();
      const dedupeKey = `inbox:${nudge.id}:${dayKey(at)}`;
      const item = await store.items.upsertFinding({
        dedupeKey,
        title: nudge.title,
        body: nudge.body,
        category: 'suggestion',
        suggestionScope: 'unknown',
        urgency: nudge.tier === 'low' ? 'fyi' : 'normal',
        dueAt: null,
        evidence: [{ source: 'notes', label: 'Inbox', observedAt: at.toISOString() }],
        runId: context.runId,
      });
      if (nudge.tier !== 'low') {
        // Low is a card only. Medium and high join this run's findings ahead of the others, so the existing alert hook
        // (which runs after this one) sends them as the run's one insight push within the daily push cap.
        const ref = `inbox:${nudge.id}`;
        context.facts.push({ ref, source: 'notes', kind: 'note', text: nudge.itemTitle });
        context.findings.unshift({
          modelGenerated: true,
          itemId: item.id,
          dedupeKey,
          evidenceRefs: [ref],
          category: 'suggestion',
          suggestionScope: 'unknown',
          urgency: 'normal',
          dueAt: null,
          dueHasTime: false,
          highPriority: false,
        });
      }
      return item.id;
    },
  };
}

export function createProactiveReactions(store: Pick<ProactiveStore, 'items'>): ProactiveReactions {
  return {
    async thumb(proactiveItemId) {
      const item = await store.items.get(proactiveItemId, false);
      return item?.feedback === 'useful' ? 'up' : item?.feedback === 'wrong' ? 'down' : null;
    },
  };
}

/**
 * The inbox review as an `onFindingsStored` hook: it runs once per claimed proactive run (so the existing slot lease, quiet
 * hours, pause switch and monthly budget gate apply), and records what it spent in the shared ledger.
 */
export function createInboxNudgeHook(options: {
  readonly pass: (context: FindingsStoredContext) => InboxNudgePass;
  readonly store: Pick<ProactiveStore, 'settings' | 'spend'>;
  /** Usage the model transport recorded since the last call. */
  readonly takeUsage: () => FoundryModelUsage[];
  readonly now: () => Date;
  readonly log?: (fields: { readonly outcome: string }) => void;
}) {
  let spendDay = '';
  let spentToday = 0;
  const log = options.log ?? (() => {});

  return async function onFindingsStored(context: FindingsStoredContext): Promise<void> {
    const at = options.now();
    const settings = await options.store.settings.read();
    if (settings.paused || !settings.sources.notes) {
      log({ outcome: 'disabled' });
      return;
    }
    const today = dayKey(at);
    if (today !== spendDay) { spendDay = today; spentToday = 0; }
    if (spentToday >= INBOX_DAILY_CEILING_DKK) {
      log({ outcome: 'daily_ceiling' });
      return;
    }
    const worstCase = highestFoundryTokenCosts(worstCaseTokens.input, worstCaseTokens.output);
    const spent = await options.store.spend.monthTotal(monthKey(at));
    if (settings.monthlyBudgetDkk === 0 ||
        !canRunWithinBudget(settings.monthlyBudgetDkk, spent, worstCase.inputDkk + worstCase.outputDkk)) {
      log({ outcome: 'budget_exhausted' });
      return;
    }
    options.takeUsage();
    try {
      await options.pass(context).run(context.signal);
    } finally {
      for (const usage of options.takeUsage()) {
        const cost = estimateCost(usage.model, usage.inputTokens, usage.outputTokens);
        spentToday += cost.estimatedDkk;
        try {
          await options.store.spend.record({
            runId: context.runId, month: monthKey(at), inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
            estimatedDkk: cost.estimatedDkk, createdAt: options.now(),
          });
        } catch { log({ outcome: 'spend_not_recorded' }); }
      }
    }
  };
}
