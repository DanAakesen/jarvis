import type { FoundryModelUsage } from '../core/usage.js';
import {
  budgetState, canRunWithinBudget, effectiveProactiveBudget, estimateCost,
} from '../proactive/budget.js';
import type { FindingsStoredContext } from '../proactive/types.js';
import type { ProactiveStore } from '../proactive/store.js';
import { dayKey, monthKey } from '../proactive/time.js';
import { highestFoundryTokenCosts } from '../core/usage-pricing.js';
import type { MissedCaptureAudit } from './audit.js';
import type { InboxNudgePass, NudgeDelivery, ProactiveReactions } from './nudge.js';
import { AUDIT_DAY_KEY, WEEKLY_WEEK_KEY, type InboxOpsStore, type InboxSpendKind } from './ops.js';

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

function copenhagenHourAndWeekday(at: Date): { hour: number; sunday: boolean } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Copenhagen', hour: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(at).map(({ type, value }) => [type, value]));
  return { hour: Number(parts.hour), sunday: parts.weekday === 'Sun' };
}

/**
 * The inbox work of a proactive run as an `onFindingsStored` hook: it runs once per claimed run (so the existing slot lease,
 * quiet hours, pause switch and monthly budget gate apply), and records what it spent in the shared ledger and, by kind, in
 * the inbox's own ledger. The slot review always goes first. The daily missed-capture audit (18:00 run) and the weekly
 * deep review (first Sunday run) only run while the month is under the 80% warning, so they stop first when money is short.
 */
export function createInboxNudgeHook(options: {
  readonly pass: (context: FindingsStoredContext) => InboxNudgePass;
  readonly audit?: MissedCaptureAudit | undefined;
  readonly ops?: InboxOpsStore | undefined;
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
    const signal = context.signal;
    const settings = await options.store.settings.read();
    if (settings.paused || !settings.sources.notes) {
      log({ outcome: 'disabled' });
      return;
    }
    const today = dayKey(at);
    if (today !== spendDay) { spendDay = today; spentToday = 0; }
    if (options.ops) {
      const rows = await options.ops.spendSince(today, signal).catch(() => []);
      spentToday = Math.max(spentToday, rows.filter((row) => row.day === today).reduce((sum, row) => sum + row.estimatedDkk, 0));
    }
    const month = monthKey(at);
    const worstCase = highestFoundryTokenCosts(worstCaseTokens.input, worstCaseTokens.output);
    const worstCaseDkk = worstCase.inputDkk + worstCase.outputDkk;
    let spentMonth = await options.store.spend.monthTotal(month);

    // ok is false when the budget or the daily ceiling says stop; otherwise value is what the work returned.
    const stage = async <T>(kind: InboxSpendKind, work: () => Promise<T>): Promise<{ ok: boolean; value?: T }> => {
      if (spentToday >= INBOX_DAILY_CEILING_DKK) { log({ outcome: 'daily_ceiling' }); return { ok: false }; }
      const budgetLimit = effectiveProactiveBudget(settings.monthlyBudgetDkk);
      if (budgetLimit === 0 || !canRunWithinBudget(budgetLimit, spentMonth, worstCaseDkk)) {
        log({ outcome: 'budget_exhausted' });
        return { ok: false };
      }
      options.takeUsage();
      let value: T | undefined;
      try {
        value = await work();
      } finally {
        const used = options.takeUsage();
        let dkk = 0;
        let input = 0;
        let output = 0;
        for (const usage of used) {
          const cost = estimateCost(usage.model, usage.inputTokens, usage.outputTokens);
          dkk += cost.estimatedDkk; input += usage.inputTokens; output += usage.outputTokens;
          try {
            await options.store.spend.record({
              runId: context.runId, month, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
              estimatedDkk: cost.estimatedDkk, createdAt: options.now(),
            });
          } catch { log({ outcome: 'spend_not_recorded' }); }
        }
        spentToday += dkk;
        spentMonth += dkk;
        if (used.length > 0 && options.ops) {
          await options.ops.addSpend(today, kind, { calls: used.length, inputTokens: input, outputTokens: output, estimatedDkk: dkk }, new AbortController().signal)
            .catch(() => log({ outcome: 'spend_not_recorded' }));
        }
      }
      return { ok: true, value: value as T };
    };
    // Finished means done, or genuinely nothing to look at. A failed attempt (model down, invalid answer) stays due.
    const finished = (outcome: { status: string; reason?: string } | undefined) =>
      outcome?.status === 'done' || outcome?.reason === 'nothing_to_review';

    const slot = await stage('review', () => options.pass(context).run(signal, 'slot'));
    if (!slot.ok) return;
    const nudgedThisRun = slot.value?.status === 'done' && slot.value.nudged !== null;
    if (budgetState(effectiveProactiveBudget(settings.monthlyBudgetDkk), spentMonth) !== 'ok' || !options.ops) return;

    const { hour, sunday } = copenhagenHourAndWeekday(at);
    if (options.audit && hour >= 18 && await options.ops.getState(AUDIT_DAY_KEY, signal).catch(() => today) !== today) {
      const audit = await stage('audit', () => options.audit!.run(signal));
      if (!audit.ok) return;
      if (finished(audit.value)) await options.ops.setState(AUDIT_DAY_KEY, today, signal).catch(() => undefined);
    }
    if (budgetState(effectiveProactiveBudget(settings.monthlyBudgetDkk), spentMonth) !== 'ok') return;
    if (sunday && await options.ops.getState(WEEKLY_WEEK_KEY, signal).catch(() => today) !== today) {
      // One nudge per run: if the slot review already reached Dan, the weekly review only tidies and learns.
      const weekly = await stage('weekly', () => options.pass(context).run(signal, 'weekly', { nudge: !nudgedThisRun }));
      if (!weekly.ok) return;
      if (finished(weekly.value)) await options.ops.setState(WEEKLY_WEEK_KEY, today, signal).catch(() => undefined);
    }
  };
}
