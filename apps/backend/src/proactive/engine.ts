import { createHash } from 'node:crypto';
import type { BackgroundJobHandle, BackgroundJobRegistry } from '../core/jobs.js';
import type { UsageStore } from '../core/usage.js';
import { canRunWithinBudget, estimateCost } from './budget.js';
import { detectFindings, normaliseFactText } from './detect.js';
import { detectLanguage } from './language.js';
import type { ProactiveModel } from './model.js';
import { sourceLabels, type FindingInput, type ProactiveStore } from './store.js';
import { isQuietHour, monthKey } from './time.js';
import type { Item, ProactiveSource, RunSummary, SourceFact, SourceId } from './types.js';

export const RUN_DEADLINE_MS = 3 * 60_000;
export const LEASE_HEARTBEAT_MS = 60_000;
export const SOURCE_TIMEOUT_MS = 20_000;

export const jobReasons: Record<string, string> = {
  budget_exhausted: 'Monthly budget reached',
  model_unavailable: 'Summary step unavailable',
  invalid_model_output: 'Summary step rejected',
  no_sources: 'No source could be read',
  quiet_hours: 'Stopped for quiet hours',
  interrupted_by_restart: 'Interrupted by a restart',
  lease_lost: 'Another run took over',
  deadline_exceeded: 'Took too long',
  internal_error: 'Check could not be completed',
};

export function proactiveJobLabel(run: RunSummary): string {
  if (run.trigger === 'manual') return 'Proactive check (manual)';
  const slot = run.slot?.slice(-5) === '18:00' ? '18:00' : '07:00';
  return `Proactive check (${slot}${run.trigger === 'catchup' ? ', late' : ''})`;
}

type ReadFact = SourceFact & { source: SourceId };
export interface FindingsStoredContext {
  runId: string;
  trigger: RunSummary['trigger'];
  now: Date;
  signal: AbortSignal;
  findings: {
    itemId: string;
    dedupeKey: string;
    category: NonNullable<Item['category']>;
    urgency: Item['urgency'];
    dueAt: string | null;
    language: 'da' | 'en';
    suggestedTodo?: string;
  }[];
  facts: Pick<ReadFact, 'ref' | 'source' | 'kind' | 'text' | 'dueAt' | 'dueHasTime' | 'startsAt' | 'endsAt' | 'allDay'>[];
  sources: { id: SourceId; state: 'ok' | 'unavailable'; reason?: string }[];
}

export interface ProactiveEngineOptions {
  store: ProactiveStore;
  sources: readonly ProactiveSource[];
  model: ProactiveModel;
  backgroundJobs?: Pick<BackgroundJobRegistry, 'start'>;
  usageStore?: Pick<UsageStore, 'recordFoundryUsage'>;
  conversationStore?: { readRecentUserMessages(limit?: number): Promise<string[]> };
  now: () => Date;
  logger?: { warn: (data: { runId: string; reason: string }, message: string) => void };
  onFindingsStored?: readonly ((context: FindingsStoredContext) => void | Promise<void>)[];
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Run aborted'));
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort)).catch(() => {});
    if (signal.aborted) abort();
  });
}

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function modelDedupeKey(category: string, facts: readonly ReadFact[]): string {
  const hashes = facts.map((fact) => hash(JSON.stringify([
    fact.source, fact.kind, normaliseFactText(fact.text),
    fact.dueAt ?? null, fact.startsAt ?? null, fact.endsAt ?? null, fact.allDay ?? false,
  ]))).sort();
  return hash(`${category}|${hashes.join('|')}`).slice(0, 32);
}

export function createProactiveEngine(options: ProactiveEngineOptions) {
  const { store, now } = options;
  return async function runClaim(
    claim: { run: RunSummary; generation: number },
    externalSignal?: AbortSignal,
  ): Promise<void> {
    const { run, generation } = claim;
    const controller = new AbortController();
    let reason: string | null = null;
    let status: Exclude<RunSummary['status'], 'running'> = 'failed';
    let findingCount = 0;
    let job: BackgroundJobHandle | undefined;
    let jobStarted = false;
    let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    const cancel = (code: string) => {
      if (!controller.signal.aborted) {
        reason = code;
        controller.abort();
      }
    };
    const externalAbort = () => {
      if (run.trigger === 'manual' && externalSignal?.reason === 'quiet_hours') return;
      cancel(externalSignal?.reason === 'quiet_hours' ? 'quiet_hours' : 'interrupted_by_restart');
    };
    externalSignal?.addEventListener('abort', externalAbort, { once: true });
    if (externalSignal?.aborted) externalAbort();
    const deadline = setTimeout(() => cancel('deadline_exceeded'), RUN_DEADLINE_MS);
    deadline.unref();
    const check = () => {
      if (run.trigger !== 'manual' && isQuietHour(now())) cancel('quiet_hours');
      if (controller.signal.aborted) throw new Error('Run aborted');
    };
    const current = async () => {
      check();
      if (!await abortable(store.runs.heartbeat(run.id, generation, now()), controller.signal)) {
        cancel('lease_lost');
      }
      check();
    };
    const heartbeat = () => {
      heartbeatTimer = setTimeout(() => {
        void current().then(heartbeat, () => cancel(reason ?? 'internal_error'));
      }, LEASE_HEARTBEAT_MS);
      heartbeatTimer.unref();
    };
    const watchQuiet = () => {
      quietTimer = setTimeout(() => {
        if (isQuietHour(now())) cancel('quiet_hours');
        else watchQuiet();
      }, 1_000);
      quietTimer.unref();
    };
    try {
      check();
      const settings = await abortable(store.settings.read(), controller.signal);
      check();
      if (run.trigger !== 'manual' && (settings.paused || !Object.values(settings.sources).some(Boolean))) {
        status = 'skipped';
        reason = settings.paused ? 'paused' : 'no_sources';
        return;
      }
      jobStarted = true;
      job = await abortable(
        options.backgroundJobs?.start('proactive', proactiveJobLabel(run), 1) ?? Promise.resolve(undefined),
        controller.signal,
      );
      heartbeat();
      if (run.trigger !== 'manual') watchQuiet();
      const worstCase = await abortable(options.model.worstCaseDkk(), controller.signal);
      const spent = await abortable(store.spend.monthTotal(monthKey(now())), controller.signal);
      if (settings.monthlyBudgetDkk === 0 ||
          !canRunWithinBudget(settings.monthlyBudgetDkk, spent, worstCase)) {
        reason = 'budget_exhausted';
        return;
      }
      const results = await abortable(Promise.all(
        options.sources.filter((source) => settings.sources[source.id]).map(async (source) => {
          const sourceController = new AbortController();
          const abort = () => sourceController.abort();
          controller.signal.addEventListener('abort', abort, { once: true });
          if (controller.signal.aborted) abort();
          const timeout = setTimeout(() => sourceController.abort(), SOURCE_TIMEOUT_MS);
          timeout.unref();
          try {
            const result = await abortable(
              Promise.resolve().then(() => source.read({ now: now(), signal: sourceController.signal, settings })),
              sourceController.signal,
            );
            return { ...result, source: source.id };
          } catch {
            return {
              source: source.id, state: 'unavailable' as const,
              reason: sourceController.signal.aborted ? 'source_timeout' : 'source_unavailable',
              facts: [], observedAt: now().toISOString(),
            };
          } finally {
            clearTimeout(timeout);
            controller.signal.removeEventListener('abort', abort);
          }
        }),
      ), controller.signal);
      check();
      for (const result of results) {
        await abortable(store.sources.upsert({
          id: result.source, label: sourceLabels[result.source], enabled: true,
          state: result.state, reason: result.reason, observedAt: result.observedAt,
        }), controller.signal);
      }
      if (!results.some((result) => result.state === 'ok')) {
        reason = 'no_sources';
        return;
      }
      // Refs are local to this bundle, never a persistent identity.
      const facts: ReadFact[] = results.flatMap((result) => result.state === 'ok'
        ? result.facts.map((fact, index) => ({ ...fact, ref: `${result.source}:${index}`, source: result.source }))
        : []);
      const messages = options.conversationStore
        ? await abortable(options.conversationStore.readRecentUserMessages(8), controller.signal) : [];
      const language = detectLanguage(messages);
      const deterministic = detectFindings(facts, now(), language);
      const pending: (FindingInput & { suggestedTodo?: string })[] = deterministic.map((finding) => ({
        ...finding,
        evidence: finding.evidence.map((ref) => {
          const fact = facts.find((candidate) => candidate.ref === ref)!;
          return { source: fact.source, label: fact.label, observedAt: fact.observedAt };
        }),
        language, runId: run.id,
      }));
      if (facts.length > 0) {
        check();
        // Re-check the calendar month immediately before incurring model spend.
        if (!canRunWithinBudget(settings.monthlyBudgetDkk,
          await abortable(store.spend.monthTotal(monthKey(now())), controller.signal), worstCase)) {
          reason = 'budget_exhausted';
          return;
        }
        const modelWork = Promise.resolve().then(() => options.model.summarize({
            now: now(), language, guidance: settings.guidance, deterministic, facts,
          }, controller.signal)).catch(() => ({
            findings: [], reason: 'model_unavailable' as const,
          }));
        const result = await abortable(modelWork.then(async (response) => {
          if ('usage' in response && response.usage) {
            const at = now();
            const usage = response.usage;
            const cost = estimateCost(usage.model, usage.inputTokens, usage.outputTokens);
            // Late reported usage is still accounted; late findings are never written.
            await Promise.all([
              store.spend.record({ ...usage, runId: run.id, month: monthKey(at), estimatedDkk: cost.estimatedDkk, createdAt: at }),
              options.usageStore?.recordFoundryUsage?.({ ...usage, role: 'chat', eventId: run.id }),
            ]);
          }
          return response;
        }), controller.signal);
        check();
        reason = result.reason ?? null;
        for (const finding of result.findings) {
          const cited = finding.evidence.map((ref) => facts.find((fact) => fact.ref === ref)!);
          pending.push({
            title: finding.title, body: finding.body, category: finding.category,
            urgency: finding.urgency, dueAt: finding.dueAt ?? null,
            dedupeKey: modelDedupeKey(finding.category, cited),
            evidence: cited.map((fact) => ({ source: fact.source, label: fact.label, observedAt: fact.observedAt })),
            language, runId: run.id,
            ...(finding.suggestedTodo === undefined ? {} : { suggestedTodo: finding.suggestedTodo }),
          });
        }
        if (reason && pending.length === 0) {
          status = 'failed';
          return;
        }
      }
      await current();
      const stored: FindingsStoredContext['findings'] = [];
      for (const { suggestedTodo, ...finding } of pending) {
        await current();
        let item: Item;
        try {
          item = await store.items.upsertFinding(finding, {
            runId: run.id, generation, signal: controller.signal, check, now,
          });
        } catch (error) {
          if (error instanceof Error && error.message === 'lease_lost') cancel('lease_lost');
          throw error;
        }
        findingCount++;
        stored.push({
          itemId: item.id, dedupeKey: finding.dedupeKey, category: finding.category,
          urgency: finding.urgency, dueAt: finding.dueAt, language,
          ...(suggestedTodo === undefined ? {} : { suggestedTodo }),
        });
      }
      await current();
      const context: FindingsStoredContext = {
        runId: run.id, trigger: run.trigger, now: now(), signal: controller.signal, findings: stored,
        facts: facts.map(({ ref, source, kind, text, dueAt, dueHasTime, startsAt, endsAt, allDay }) => ({
          ref, source, kind, text,
          ...(dueAt === undefined ? {} : { dueAt }),
          ...(dueHasTime === undefined ? {} : { dueHasTime }),
          ...(startsAt === undefined ? {} : { startsAt }),
          ...(endsAt === undefined ? {} : { endsAt }),
          ...(allDay === undefined ? {} : { allDay }),
        })),
        sources: results.map(({ source, state, reason: sourceReason }) => ({
          id: source, state, ...(sourceReason === null ? {} : { reason: sourceReason }),
        })),
      };
      for (const hook of options.onFindingsStored ?? []) {
        await current();
        try { await abortable(Promise.resolve().then(() => hook(context)), controller.signal); }
        catch { options.logger?.warn({ runId: run.id, reason: 'hook_failed' }, 'proactive.failed'); }
        check();
      }
      status = 'done';
    } catch {
      reason ??= 'internal_error';
    } finally {
      clearTimeout(deadline);
      clearTimeout(heartbeatTimer);
      clearTimeout(quietTimer);
      externalSignal?.removeEventListener('abort', externalAbort);
      if (controller.signal.aborted) status = reason === 'quiet_hours' ? 'cancelled' : 'failed';
      try {
        const accepted = await store.runs.finish(run.id, generation, status, reason, findingCount, now());
        if (!accepted) {
          status = 'failed';
          reason = 'lease_lost';
        }
      } catch {
        status = 'failed';
        reason = 'internal_error';
        options.logger?.warn({ runId: run.id, reason }, 'proactive.failed');
      }
      try {
        if (!jobStarted && status !== 'skipped') {
          job = await options.backgroundJobs?.start('proactive', proactiveJobLabel(run), 1);
        }
        if (job) {
          if (status === 'done' && reason === null) await job.done('proactive');
          else await job.fail(jobReasons[reason ?? 'internal_error'] ?? jobReasons.internal_error!);
        }
      } catch { options.logger?.warn({ runId: run.id, reason: 'job_update_failed' }, 'proactive.failed'); }
    }
  };
}
