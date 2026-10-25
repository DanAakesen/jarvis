import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundJobHandle } from '../core/jobs.js';
import { estimateCost } from './budget.js';
import {
  createProactiveEngine, jobReasons, LEASE_HEARTBEAT_MS, modelDedupeKey,
  proactiveJobLabel, RUN_DEADLINE_MS, SOURCE_TIMEOUT_MS,
  type FindingsStoredContext, type ProactiveEngineOptions,
} from './engine.js';
import type { ProactiveModel, ProactiveModelInput, ProactiveModelResult } from './model.js';
import { createMemoryProactiveStore } from './store.js';
import { sourceIds, type RunSummary, type SourceContext, type SourceFact, type SourceId, type SourceResult } from './types.js';

const NOW = '2026-10-20T10:00:00.000Z';
const usage = { model: 'gpt-4.1', inputTokens: 400, outputTokens: 80 };

function fact(overrides: Partial<SourceFact> = {}): SourceFact {
  return {
    ref: 'provider-private-id', kind: 'todo', label: 'Todo list',
    text: 'Prepare meeting notes', observedAt: NOW, dueAt: '2026-10-20T11:00:00.000Z',
    ...overrides,
  };
}

function source(id: SourceId = 'todos', facts: SourceFact[] = [fact()]) {
  return {
    id, label: id,
    read: vi.fn(async (context: SourceContext): Promise<SourceResult> => ({
      source: id, state: 'ok', reason: null, facts, observedAt: context.now.toISOString(),
    })),
  };
}

function summary(input: ProactiveModelInput): ProactiveModelResult {
  return {
    findings: [{
      title: 'Prepare for the meeting', body: 'Review the meeting notes.',
      category: 'prep', urgency: 'normal', evidence: [input.facts[0]!.ref],
      suggestedTodo: 'Review meeting notes',
    }],
    usage,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(overrides: Partial<ProactiveEngineOptions> = {}) {
  const events: string[] = [];
  const store = createMemoryProactiveStore();
  const todoSource = source();
  const readSource = todoSource.read.getMockImplementation()!;
  todoSource.read.mockImplementation(async (context) => {
    events.push('source');
    return readSource(context);
  });
  const model = {
    worstCaseDkk: vi.fn(async () => { events.push('budget:estimate'); return 0.25; }),
    summarize: vi.fn(async (input: ProactiveModelInput, signal: AbortSignal) => {
      signal.throwIfAborted();
      events.push('model');
      return summary(input);
    }),
  } satisfies ProactiveModel;
  const job = {
    jobId: 'test-job',
    progress: vi.fn(async () => {}),
    done: vi.fn(async () => { events.push('job:done'); }),
    setResultDelivery: vi.fn(async () => {}),
    fail: vi.fn(async () => { events.push('job:fail'); }),
  } satisfies BackgroundJobHandle;
  const start = vi.fn(async () => { events.push('job:start'); return job; });
  const recordFoundryUsage = vi.fn(async () => { events.push('usage'); });
  const warn = vi.fn();
  const readSettings = store.settings.read.bind(store.settings);
  vi.spyOn(store.settings, 'read').mockImplementation(async () => {
    events.push('settings');
    return readSettings();
  });
  const upsert = store.items.upsertFinding.bind(store.items);
  vi.spyOn(store.items, 'upsertFinding').mockImplementation(async (finding, guard) => {
    events.push(`item:${finding.category}`);
    return upsert(finding, guard);
  });
  const record = store.spend.record.bind(store.spend);
  vi.spyOn(store.spend, 'record').mockImplementation(async (input) => {
    events.push('spend');
    return record(input);
  });
  const monthTotal = store.spend.monthTotal.bind(store.spend);
  vi.spyOn(store.spend, 'monthTotal').mockImplementation(async (month) => {
    events.push('budget:spent');
    return monthTotal(month);
  });
  const sourceStatus = store.sources.upsert.bind(store.sources);
  vi.spyOn(store.sources, 'upsert').mockImplementation(async (input) => {
    events.push('source:status');
    return sourceStatus(input);
  });
  const finish = store.runs.finish.bind(store.runs);
  vi.spyOn(store.runs, 'finish').mockImplementation(async (...args) => {
    events.push('finish');
    return finish(...args);
  });
  const options: ProactiveEngineOptions = {
    store, sources: [todoSource], model, backgroundJobs: { start },
    usageStore: { recordFoundryUsage }, now: () => new Date(), logger: { warn }, ...overrides,
  };
  const engine = createProactiveEngine(options);
  async function claim(
    trigger: RunSummary['trigger'] = 'manual',
    slot = trigger === 'manual' ? null : '2026-10-20T07:00',
  ) {
    const claimed = await store.runs.claim({
      trigger, slot, now: new Date(),
    });
    expect(claimed).not.toBeNull();
    return claimed!;
  }
  async function run(
    trigger: RunSummary['trigger'] = 'manual',
    slot?: string,
  ) {
    await engine(await claim(trigger, slot));
    return store.runs.latest();
  }
  return { store, events, todoSource, model, job, start, recordFoundryUsage, warn, engine, claim, run };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('proactive engine pipeline', () => {
  it('does not generate travel findings from mail/calendar evidence after travel is disabled', async () => {
    const mail = source('mail', [fact({ kind: 'mail', text: 'Flight and hotel reservation details' })]);
    const fixture = setup({ sources: [mail] });
    await fixture.store.settings.patch({ categories: { travel: false } });

    expect(await fixture.run()).toMatchObject({ status: 'done', findingCount: 0 });
    expect(fixture.model.summarize).not.toHaveBeenCalled();
    expect(await fixture.store.items.list('all', 20, new Date())).toEqual([]);
  });

  it('filters model-generated cross-category suggestions even when cited facts are otherwise allowed', async () => {
    const fixture = setup({ sources: [source('todos', [fact({ dueAt: '2026-10-25T11:00:00.000Z' })])] });
    await fixture.store.settings.patch({ categories: { travel: false } });
    fixture.model.summarize.mockImplementation(async (input) => ({
      findings: [{
        title: 'Review hotel options',
        body: 'Compare the travel booking.',
        category: 'prep',
        urgency: 'normal',
        evidence: [input.facts[0]!.ref],
      }],
      usage,
    }));

    expect(await fixture.run()).toMatchObject({ status: 'done', findingCount: 0 });
    expect(await fixture.store.items.list('all', 20, new Date())).toEqual([]);
  });

  it('keeps only exactly personal findings under personal-only scope', async () => {
    const todos = source('todos', [
      fact({ ref: 'personal', text: 'Family appointment', taskScope: 'personal', dueAt: '2026-10-25T11:00:00.000Z' }),
      fact({ ref: 'work', text: 'Client agenda', taskScope: 'work', dueAt: '2026-10-25T11:00:00.000Z' }),
      fact({ ref: 'unknown', text: 'Prepare meeting notes', dueAt: '2026-10-25T11:00:00.000Z' }),
      fact({ ref: 'mixed', text: 'Family work trip', taskScope: 'personal', dueAt: '2026-10-25T11:00:00.000Z' }),
    ]);
    const fixture = setup({ sources: [todos] });
    await fixture.store.settings.patch({ suggestionScope: 'personal' });
    fixture.model.summarize.mockImplementation(async (input) => ({
      findings: input.facts.map((item) => ({
        title: `Prepare ${item.text}`,
        body: item.text,
        category: 'prep',
        urgency: 'normal',
        evidence: [item.ref],
      })),
      usage,
    }));

    expect(await fixture.run()).toMatchObject({ status: 'done', findingCount: 1 });
    expect(fixture.model.summarize.mock.calls[0]![0].facts).toHaveLength(1);
    expect(await fixture.store.items.list('all', 20, new Date())).toMatchObject([
      { suggestionScope: 'personal', body: 'Family appointment' },
    ]);
  });

  it('filters deterministic findings by personal-only scope', async () => {
    const todos = source('todos', [
      fact({ text: 'Family appointment', taskScope: 'personal' }),
      fact({ text: 'Client agenda', taskScope: 'work' }),
      fact({ text: 'Prepare meeting notes' }),
      fact({ text: 'Family work trip', taskScope: 'personal' }),
    ]);
    const fixture = setup({ sources: [todos] });
    await fixture.store.settings.patch({ suggestionScope: 'personal' });
    fixture.model.summarize.mockResolvedValue({ findings: [], usage });

    expect(await fixture.run()).toMatchObject({ status: 'done', findingCount: 1 });
    expect(fixture.model.summarize.mock.calls[0]![0].facts.map(({ text }) => text)).toEqual(['Family appointment']);
    expect(await fixture.store.items.list('all', 20, new Date())).toMatchObject([
      { category: 'deadline', suggestionScope: 'personal' },
    ]);
  });

  it('cancels in-flight work on preference changes without deleting prior findings', async () => {
    const sourceStarted = deferred<void>();
    const pendingRead = deferred<SourceResult>();
    const todos = source();
    todos.read.mockImplementation(async () => {
      sourceStarted.resolve();
      return pendingRead.promise;
    });
    const fixture = setup({ sources: [todos] });
    const previous = await fixture.store.items.upsertFinding({
      dedupeKey: 'previous:travel', title: 'Previous travel item', body: 'Synthetic.',
      category: 'travel', suggestionScope: 'personal', urgency: 'normal', dueAt: null,
      evidence: [], runId: null, language: 'en',
    });
    const claimed = await fixture.claim();
    const running = fixture.engine(claimed);
    await sourceStarted.promise;
    await fixture.store.settings.patch({ categories: { travel: false } });
    await running;
    pendingRead.resolve({
      source: 'todos', state: 'ok', reason: null, facts: [fact({ text: 'Flight to Copenhagen' })], observedAt: NOW,
    });

    expect(await fixture.store.runs.latest()).toMatchObject({ status: 'cancelled', reason: 'preferences_changed' });
    expect(await fixture.store.items.get(previous.id)).toBeUndefined();
    await fixture.store.settings.patch({ categories: { travel: true } });
    expect(await fixture.store.items.get(previous.id)).toMatchObject({ id: previous.id });
    expect(await fixture.store.items.list('all', 20, new Date())).toHaveLength(1);
  });

  it('deduplicates unchanged undated-task digests per Copenhagen day and adds one for a changed set', async () => {
    const fixture = setup();
    let undated = [
      fact({ ref: 'todo:first', text: 'Prepare notes', dueAt: null }),
      fact({ ref: 'todo:second', text: 'Send report', dueAt: null }),
    ];
    fixture.todoSource.read.mockImplementation(async ({ now }) => ({
      source: 'todos', state: 'ok', reason: null, facts: undated, observedAt: now.toISOString(),
    }));
    fixture.model.summarize.mockResolvedValue({ findings: [] });

    expect(await fixture.run('scheduled', '2026-10-20T07:00'))
      .toMatchObject({ status: 'done', findingCount: 1 });
    const first = (await fixture.store.items.list('all', 20, new Date()))
      .filter(({ category }) => category === 'todo');
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      title: 'Tasks without due dates',
      body: '2 open high-priority tasks have no due date: "Prepare notes"; "Send report".',
      urgency: 'normal', dueAt: null,
    });

    expect(await fixture.run('scheduled', '2026-10-20T18:00'))
      .toMatchObject({ status: 'done', findingCount: 1 });
    expect((await fixture.store.items.list('all', 20, new Date()))
      .filter(({ category }) => category === 'todo')).toHaveLength(1);

    undated = [
      undated[0]!,
      fact({ ref: 'todo:third', text: 'Book travel', dueAt: null }),
    ];
    expect(await fixture.run()).toMatchObject({ status: 'done', findingCount: 1 });
    const changed = (await fixture.store.items.list('all', 20, new Date()))
      .filter(({ category }) => category === 'todo');
    expect(changed).toHaveLength(2);
    expect(changed.find(({ id }) => id !== first[0]!.id)).toMatchObject({
      body: '2 open high-priority tasks have no due date: "Book travel"; "Prepare notes".',
      urgency: 'normal', dueAt: null,
    });
  });

  it('accounts spend, stores every finding, runs hooks, then finishes the run and job', async () => {
    const hook = vi.fn(async (context: FindingsStoredContext) => {
      fixture.events.push('hook');
      expect(await fixture.store.runs.latest()).toMatchObject({ status: 'running' });
      expect(await fixture.store.items.list('all', 20, new Date())).toHaveLength(2);
      expect(context).toMatchObject({
        trigger: 'manual', now: new Date(NOW),
        findings: [
          { category: 'deadline', urgency: 'time_critical', language: 'en' },
          { category: 'prep', urgency: 'normal', suggestedTodo: 'Review meeting notes' },
        ],
        sources: [{ id: 'todos', state: 'ok' }],
        facts: [{ ref: 'todos:0', source: 'todos', kind: 'todo', text: 'Prepare meeting notes' }],
      });
      expect(context.signal.aborted).toBe(false);
      expect(context.facts[0]).not.toHaveProperty('label');
      expect(context.facts[0]).not.toHaveProperty('observedAt');
      for (const finding of context.findings) {
        expect(await fixture.store.items.get(finding.itemId)).toMatchObject({ runId: context.runId });
      }
    });
    const fixture = setup({ onFindingsStored: [hook] });
    const run = await fixture.run();
    expect(run).toMatchObject({ status: 'done', reason: null, findingCount: 2, finishedAt: NOW });
    expect(fixture.start).toHaveBeenCalledExactlyOnceWith('proactive', 'Proactive check (manual)', 1);
    expect(fixture.model.summarize).toHaveBeenCalledTimes(1);
    expect(fixture.model.summarize.mock.calls[0]![0]).toMatchObject({
      deterministic: [{ category: 'deadline' }], facts: [{ ref: 'todos:0' }],
    });
    expect(fixture.store.spend.record).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      ...usage, runId: run!.id, month: '2026-10', createdAt: new Date(NOW),
      estimatedDkk: estimateCost(usage.model, usage.inputTokens, usage.outputTokens).estimatedDkk,
    }));
    expect(fixture.recordFoundryUsage).toHaveBeenCalledExactlyOnceWith({
      ...usage, role: 'chat', eventId: run!.id,
    });
    expect(fixture.events).toEqual([
      'settings', 'job:start', 'budget:estimate', 'budget:spent', 'source', 'source:status',
      'budget:spent', 'model', 'spend', 'usage',
      'item:deadline', 'item:prep', 'hook', 'finish', 'job:done',
    ]);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(fixture.job.done).toHaveBeenCalledExactlyOnceWith('proactive');
    expect(fixture.job.fail).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('continues hooks in registration order after a hook throws without undoing stored findings', async () => {
    const first = vi.fn(() => { fixture.events.push('hook:1'); throw new Error('private hook detail'); });
    const second = vi.fn(() => { fixture.events.push('hook:2'); });
    const fixture = setup({ onFindingsStored: [first, second] });
    expect(await fixture.run()).toMatchObject({ status: 'done', reason: null, findingCount: 2 });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(second.mock.calls[0]).toEqual(first.mock.calls[0]);
    expect(fixture.events.slice(-5)).toEqual(['item:prep', 'hook:1', 'hook:2', 'finish', 'job:done']);
    expect(fixture.warn).toHaveBeenCalledExactlyOnceWith({
      runId: (await fixture.store.runs.latest())!.id, reason: 'hook_failed',
    }, 'proactive.failed');
    expect(await fixture.store.items.list('all', 20, new Date())).toHaveLength(2);
  });

  it.each([0, 0.2])('refuses a %.1f DKK budget before source reads or model spend', async (budget) => {
    const hook = vi.fn();
    const fixture = setup({ onFindingsStored: [hook] });
    await fixture.store.settings.patch({ monthlyBudgetDkk: budget });
    expect(await fixture.run()).toMatchObject({ status: 'failed', reason: 'budget_exhausted', findingCount: 0 });
    expect(fixture.todoSource.read).not.toHaveBeenCalled();
    expect(fixture.model.summarize).not.toHaveBeenCalled();
    expect(fixture.store.spend.record).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
    expect(fixture.job.fail).toHaveBeenCalledExactlyOnceWith('Monthly budget reached');
  });

  it('includes existing spend when checking worst-case affordability', async () => {
    const fixture = setup();
    await fixture.store.settings.patch({ monthlyBudgetDkk: 1 });
    await fixture.store.spend.record({
      runId: 'previous', month: '2026-10', inputTokens: 1, outputTokens: 1,
      estimatedDkk: 0.8, createdAt: new Date(),
    });
    expect(await fixture.run()).toMatchObject({ reason: 'budget_exhausted', status: 'failed' });
    expect(fixture.model.summarize).not.toHaveBeenCalled();
  });

  it('rechecks spend after sources return and before invoking the model', async () => {
    const fixture = setup();
    vi.spyOn(fixture.store.spend, 'monthTotal').mockResolvedValueOnce(0).mockResolvedValueOnce(100);
    expect(await fixture.run()).toMatchObject({ status: 'failed', reason: 'budget_exhausted' });
    expect(fixture.todoSource.read).toHaveBeenCalledTimes(1);
    expect(fixture.model.summarize).not.toHaveBeenCalled();
    expect(fixture.store.items.upsertFinding).not.toHaveBeenCalled();
  });

  it('records rejected response usage both proactively and globally as chat usage', async () => {
    const fixture = setup();
    fixture.model.summarize.mockResolvedValue({
      findings: [], reason: 'invalid_model_output', usage,
    });
    expect(await fixture.run()).toMatchObject({
      status: 'done', reason: 'invalid_model_output', findingCount: 1,
    });
    expect(fixture.store.spend.record).toHaveBeenCalledTimes(1);
    expect(await fixture.store.spend.monthTotal('2026-10')).toBeGreaterThan(0);
    expect(fixture.recordFoundryUsage).toHaveBeenCalledWith(expect.objectContaining({ ...usage, role: 'chat' }));
    expect(fixture.job.fail).toHaveBeenCalledExactlyOnceWith('Summary step rejected');
    expect(fixture.job.done).not.toHaveBeenCalled();
  });

  it.each(['result', 'throw'] as const)('keeps deterministic findings when the model is unavailable (%s)', async (mode) => {
    const hook = vi.fn();
    const fixture = setup({ onFindingsStored: [hook] });
    if (mode === 'throw') fixture.model.summarize.mockRejectedValue(new Error('private model error'));
    else fixture.model.summarize.mockResolvedValue({ findings: [], reason: 'model_unavailable' });
    expect(await fixture.run()).toMatchObject({
      status: 'done', reason: 'model_unavailable', findingCount: 1,
    });
    expect(await fixture.store.items.list('all', 20, new Date())).toMatchObject([{ category: 'deadline' }]);
    expect(fixture.store.spend.record).not.toHaveBeenCalled();
    expect(hook).toHaveBeenCalledTimes(1);
    expect(fixture.job.fail).toHaveBeenCalledExactlyOnceWith('Summary step unavailable');
  });

  it('fails a rejected model-only result while retaining billed usage', async () => {
    const fixture = setup({ sources: [source('news', [fact({ kind: 'news', dueAt: null })])] });
    fixture.model.summarize.mockResolvedValue({ findings: [], reason: 'invalid_model_output', usage });
    expect(await fixture.run()).toMatchObject({
      status: 'failed', reason: 'invalid_model_output', findingCount: 0,
    });
    expect(fixture.store.spend.record).toHaveBeenCalledTimes(1);
    expect(fixture.recordFoundryUsage).toHaveBeenCalledTimes(1);
    expect(fixture.store.items.upsertFinding).not.toHaveBeenCalled();
  });

  it('finishes an empty successful source without model calls or spend', async () => {
    const hook = vi.fn();
    const fixture = setup({ sources: [source('todos', [])], onFindingsStored: [hook] });
    expect(await fixture.run()).toMatchObject({ status: 'done', reason: null, findingCount: 0 });
    expect(fixture.model.summarize).not.toHaveBeenCalled();
    expect(fixture.store.spend.record).not.toHaveBeenCalled();
    expect(fixture.recordFoundryUsage).not.toHaveBeenCalled();
    expect(hook).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ facts: [], findings: [] }));
    expect(fixture.job.done).toHaveBeenCalledExactlyOnceWith('proactive');
  });

  it.each(['scheduled', 'catchup'] as const)('skips %s work with every source disabled, without starting a job', async (trigger) => {
    const fixture = setup();
    await fixture.store.settings.patch({ sources: Object.fromEntries(sourceIds.map((id) => [id, false])) });
    expect(await fixture.run(trigger)).toMatchObject({ status: 'skipped', reason: 'no_sources', findingCount: 0 });
    expect(fixture.start).not.toHaveBeenCalled();
    expect(fixture.model.worstCaseDkk).not.toHaveBeenCalled();
    expect(fixture.todoSource.read).not.toHaveBeenCalled();
  });

  it('skips paused scheduled work but permits a manual check', async () => {
    const fixture = setup();
    await fixture.store.settings.patch({ paused: true });
    expect(await fixture.run('scheduled')).toMatchObject({ status: 'skipped', reason: 'paused' });
    expect(fixture.start).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + 1);
    expect(await fixture.run()).toMatchObject({ status: 'done', findingCount: 2 });
    expect(fixture.model.summarize).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['pause', { paused: true }],
    ['Todo source disable', { sources: { todos: false } }],
  ] as const)('cancels scheduled work when %s changes during a source read', async (_label, patch) => {
    const fixture = setup();
    const read = fixture.todoSource.read.getMockImplementation()!;
    fixture.todoSource.read.mockImplementation(async (context) => {
      await fixture.store.settings.patch(patch);
      return read(context);
    });

    await fixture.engine(await fixture.claim('scheduled'));

    expect(fixture.model.summarize).not.toHaveBeenCalled();
    expect(await fixture.store.items.list('all', 10, new Date())).toEqual([]);
    expect(await fixture.store.runs.latest()).toMatchObject({
      status: 'cancelled', reason: 'preferences_changed', findingCount: 0,
    });
  });
});

describe('proactive source failures', () => {
  it('isolates thrown sources and ignores disabled sources while processing successful evidence', async () => {
    const failed = source('calendar');
    failed.read.mockRejectedValue(new Error('private provider error'));
    const disabled = source('x');
    const good = source('todos');
    const fixture = setup({ sources: [failed, disabled, good] });
    expect(await fixture.run()).toMatchObject({ status: 'done', findingCount: 2 });
    expect(disabled.read).not.toHaveBeenCalled();
    expect(await fixture.store.sources.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'calendar', state: 'unavailable', reason: 'source_unavailable' }),
      expect.objectContaining({ id: 'todos', state: 'ok', reason: null }),
    ]));
    expect(fixture.model.summarize.mock.calls[0]![0].facts).toHaveLength(1);
    expect(fixture.model.summarize.mock.calls[0]![0].facts[0]!.ref).toBe('todos:0');
  });

  it('times out a noncooperative source and continues with successful sources', async () => {
    const stalled = source('calendar');
    const pending = deferred<SourceResult>();
    stalled.read.mockReturnValue(pending.promise);
    const fixture = setup({ sources: [stalled, source()] });
    const running = fixture.engine(await fixture.claim());
    await vi.advanceTimersByTimeAsync(SOURCE_TIMEOUT_MS - 1);
    expect(fixture.model.summarize).not.toHaveBeenCalled();
    const signal = stalled.read.mock.calls[0]![0].signal;
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await running;
    expect(signal.aborted).toBe(true);
    expect(await fixture.store.runs.latest()).toMatchObject({ status: 'done', findingCount: 2 });
    expect(await fixture.store.sources.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'calendar', reason: 'source_timeout', state: 'unavailable' }),
    ]));
    pending.resolve({ source: 'calendar', state: 'ok', reason: null, observedAt: NOW, facts: [fact()] });
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.model.summarize).toHaveBeenCalledTimes(1);
    expect(fixture.store.items.upsertFinding).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails with no_sources when every source fails, without a model call or hooks', async () => {
    const failed = source();
    failed.read.mockRejectedValue(new Error('unavailable'));
    const hook = vi.fn();
    const fixture = setup({ sources: [failed], onFindingsStored: [hook] });
    expect(await fixture.run()).toMatchObject({ status: 'failed', reason: 'no_sources', findingCount: 0 });
    expect(fixture.model.summarize).not.toHaveBeenCalled();
    expect(fixture.store.spend.record).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
    expect(fixture.job.fail).toHaveBeenCalledExactlyOnceWith('No source could be read');
  });

  it('retains no_sources and fails the job while storing a mirror finding', async () => {
    const failed = source();
    failed.read.mockRejectedValue(new Error('unavailable'));
    const hook = vi.fn();
    const fixture = setup({
      sources: [failed], onFindingsStored: [hook],
      vaultMirrorStatusReader: { read: async () => ({ state: 'needs-attention', lastSuccessAt: null }) },
    });
    expect(await fixture.run()).toMatchObject({ status: 'done', reason: 'no_sources', findingCount: 1 });
    expect(await fixture.store.items.list('all', 10, new Date())).toHaveLength(1);
    expect(fixture.model.summarize).not.toHaveBeenCalled();
    expect(fixture.store.spend.record).not.toHaveBeenCalled();
    expect(hook).toHaveBeenCalledOnce();
    expect(fixture.job.done).not.toHaveBeenCalled();
    expect(fixture.job.fail).toHaveBeenCalledExactlyOnceWith('No source could be read');
  });
});

describe('proactive cancellation and leases', () => {
  it('waits for an interrupted finding write to roll back before finishing a quiet-hours cancellation', async () => {
    vi.setSystemTime('2026-10-20T19:59:59.000Z');
    const hook = vi.fn();
    const fixture = setup({ onFindingsStored: [hook] });
    const rollbackReleased = deferred<void>();
    const upsert = vi.mocked(fixture.store.items.upsertFinding).getMockImplementation()!;
    let cancellationStarted = false;
    vi.mocked(fixture.store.items.upsertFinding).mockImplementation(async (finding, guard) => {
      if (!guard) throw new Error('Missing finding write guard');
      const onAbort = () => { cancellationStarted = true; };
      guard.signal.addEventListener('abort', onAbort, { once: true });
      try {
        await rollbackReleased.promise;
        guard.check();
        return await upsert(finding, guard);
      } finally {
        guard.signal.removeEventListener('abort', onAbort);
      }
    });
    const claimed = await fixture.claim('scheduled');
    const running = fixture.engine(claimed);
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.store.items.upsertFinding).toHaveBeenCalledTimes(1);
    const guard = vi.mocked(fixture.store.items.upsertFinding).mock.calls[0]![1]!;
    expect(guard).toMatchObject({ runId: claimed.run.id, generation: claimed.generation });
    expect(guard.now()).toEqual(new Date('2026-10-20T19:59:59.000Z'));
    expect(guard.signal.aborted).toBe(false);
    expect(cancellationStarted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(cancellationStarted).toBe(true);
    expect(guard.signal.aborted).toBe(true);
    expect(() => guard.check()).toThrow('Run aborted');
    expect(fixture.store.runs.finish).not.toHaveBeenCalled();
    expect(await fixture.store.runs.latest()).toMatchObject({ status: 'running' });
    expect(await fixture.store.items.list('all', 20, new Date())).toEqual([]);
    expect(hook).not.toHaveBeenCalled();
    expect(fixture.job.done).not.toHaveBeenCalled();
    expect(fixture.job.fail).not.toHaveBeenCalled();
    rollbackReleased.resolve();
    await running;
    expect(await fixture.store.runs.latest()).toMatchObject({
      status: 'cancelled', reason: 'quiet_hours', findingCount: 0,
    });
    expect(await fixture.store.items.list('all', 20, new Date())).toEqual([]);
    expect(fixture.store.items.upsertFinding).toHaveBeenCalledTimes(1);
    expect(fixture.store.runs.finish).toHaveBeenCalledExactlyOnceWith(
      claimed.run.id, claimed.generation, 'cancelled', 'quiet_hours', 0, new Date('2026-10-20T20:00:00.000Z'),
    );
    expect(hook).not.toHaveBeenCalled();
    expect(fixture.job.fail).toHaveBeenCalledExactlyOnceWith('Stopped for quiet hours');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('maps a finding-write lease rejection to lease_lost without hooks or stored items', async () => {
    const hook = vi.fn();
    const fixture = setup({ onFindingsStored: [hook] });
    vi.mocked(fixture.store.items.upsertFinding).mockRejectedValueOnce(new Error('lease_lost'));
    const claimed = await fixture.claim();
    await fixture.engine(claimed);
    expect(await fixture.store.runs.latest()).toMatchObject({
      status: 'failed', reason: 'lease_lost', findingCount: 0,
    });
    expect(await fixture.store.items.list('all', 20, new Date())).toEqual([]);
    expect(fixture.store.items.upsertFinding).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ category: 'deadline', runId: claimed.run.id }),
      expect.objectContaining({ runId: claimed.run.id, generation: claimed.generation }),
    );
    expect(hook).not.toHaveBeenCalled();
    expect(fixture.store.runs.finish).toHaveBeenCalledExactlyOnceWith(
      claimed.run.id, claimed.generation, 'failed', 'lease_lost', 0, new Date(NOW),
    );
    expect(fixture.job.fail).toHaveBeenCalledExactlyOnceWith('Another run took over');
    expect(fixture.job.done).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('checks the generation before storing any findings or running hooks', async () => {
    const hook = vi.fn();
    const fixture = setup({ onFindingsStored: [hook] });
    const heartbeat = vi.spyOn(fixture.store.runs, 'heartbeat').mockResolvedValue(false);
    const claimed = await fixture.claim();
    await fixture.engine(claimed);
    expect(heartbeat).toHaveBeenCalledExactlyOnceWith(claimed.run.id, claimed.generation, new Date(NOW));
    expect(await fixture.store.runs.latest()).toMatchObject({ status: 'failed', reason: 'lease_lost', findingCount: 0 });
    expect(fixture.store.items.upsertFinding).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
    expect(fixture.job.fail).toHaveBeenCalledExactlyOnceWith('Another run took over');
  });

  it('aborts on lease loss but records late model usage once without late findings or hooks', async () => {
    const hook = vi.fn();
    const fixture = setup({ onFindingsStored: [hook] });
    const pending = deferred<ProactiveModelResult>();
    fixture.model.summarize.mockReturnValue(pending.promise);
    vi.spyOn(fixture.store.runs, 'heartbeat').mockResolvedValue(false);
    const claimed = await fixture.claim();
    const running = fixture.engine(claimed);
    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS);
    await running;
    expect(fixture.model.summarize.mock.calls[0]![1].aborted).toBe(true);
    expect(await fixture.store.runs.latest()).toMatchObject({ reason: 'lease_lost', status: 'failed' });
    expect(fixture.store.items.upsertFinding).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
    expect(fixture.store.spend.record).not.toHaveBeenCalled();
    expect(fixture.recordFoundryUsage).not.toHaveBeenCalled();
    pending.resolve(summary(fixture.model.summarize.mock.calls[0]![0]));
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.store.spend.record).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      ...usage, runId: claimed.run.id, month: '2026-10',
    }));
    expect(fixture.recordFoundryUsage).toHaveBeenCalledExactlyOnceWith({
      ...usage, role: 'chat', eventId: claimed.run.id,
    });
    expect(fixture.store.items.upsertFinding).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
    expect(fixture.store.runs.finish).toHaveBeenCalledTimes(1);
    expect(await fixture.store.runs.latest()).toMatchObject({ status: 'failed', reason: 'lease_lost', findingCount: 0 });
    expect(fixture.job.fail).toHaveBeenCalledExactlyOnceWith('Another run took over');
    expect(fixture.job.done).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('enforces the three-minute deadline and records late usage once without late findings or hooks', async () => {
    const hook = vi.fn();
    const fixture = setup({ onFindingsStored: [hook] });
    const pending = deferred<ProactiveModelResult>();
    fixture.model.summarize.mockReturnValue(pending.promise);
    const claimed = await fixture.claim();
    const running = fixture.engine(claimed);
    await vi.advanceTimersByTimeAsync(RUN_DEADLINE_MS - 1);
    expect(await fixture.store.runs.latest()).toMatchObject({ status: 'running' });
    expect(fixture.model.summarize.mock.calls[0]![1].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await running;
    expect(await fixture.store.runs.latest()).toMatchObject({
      status: 'failed', reason: 'deadline_exceeded', findingCount: 0,
    });
    expect(fixture.model.summarize.mock.calls[0]![1].aborted).toBe(true);
    expect(fixture.job.fail).toHaveBeenCalledExactlyOnceWith('Took too long');
    expect(fixture.store.spend.record).not.toHaveBeenCalled();
    expect(fixture.recordFoundryUsage).not.toHaveBeenCalled();
    pending.resolve(summary(fixture.model.summarize.mock.calls[0]![0]));
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.store.spend.record).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      ...usage, runId: claimed.run.id, month: '2026-10',
    }));
    expect(fixture.recordFoundryUsage).toHaveBeenCalledExactlyOnceWith({
      ...usage, role: 'chat', eventId: claimed.run.id,
    });
    expect(fixture.store.items.upsertFinding).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
    expect(fixture.store.runs.finish).toHaveBeenCalledTimes(1);
    expect(await fixture.store.runs.latest()).toMatchObject({
      status: 'failed', reason: 'deadline_exceeded', findingCount: 0,
    });
    expect(fixture.job.fail).toHaveBeenCalledTimes(1);
    expect(fixture.job.done).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels scheduled work at Copenhagen 22:00 without storing findings', async () => {
    vi.setSystemTime('2026-10-20T19:59:59.000Z');
    const hook = vi.fn();
    const fixture = setup({ onFindingsStored: [hook] });
    fixture.model.summarize.mockReturnValue(new Promise(() => {}));
    const running = fixture.engine(await fixture.claim('scheduled'));
    await vi.advanceTimersByTimeAsync(1_000);
    await running;
    expect(await fixture.store.runs.latest()).toMatchObject({
      status: 'cancelled', reason: 'quiet_hours', findingCount: 0,
    });
    expect(fixture.model.summarize.mock.calls[0]![1].aborted).toBe(true);
    expect(fixture.store.items.upsertFinding).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
    expect(fixture.job.fail).toHaveBeenCalledExactlyOnceWith('Stopped for quiet hours');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows a manual check to continue across Copenhagen 22:00', async () => {
    vi.setSystemTime('2026-10-20T19:59:59.000Z');
    const fixture = setup();
    const pending = deferred<ProactiveModelResult>();
    fixture.model.summarize.mockReturnValue(pending.promise);
    const running = fixture.engine(await fixture.claim());
    await vi.advanceTimersByTimeAsync(1_000);
    const [input, signal] = fixture.model.summarize.mock.calls[0]!;
    expect(signal.aborted).toBe(false);
    pending.resolve(summary(input));
    await running;
    expect(await fixture.store.runs.latest()).toMatchObject({ status: 'done', reason: null, findingCount: 2 });
    expect(fixture.job.done).toHaveBeenCalledExactlyOnceWith('proactive');
  });

  it('maps an external restart interruption to failure and aborts the model', async () => {
    const fixture = setup();
    fixture.model.summarize.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const running = fixture.engine(await fixture.claim(), controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await running;
    expect(await fixture.store.runs.latest()).toMatchObject({ status: 'failed', reason: 'interrupted_by_restart' });
    expect(fixture.model.summarize.mock.calls[0]![1].aborted).toBe(true);
    expect(fixture.store.items.upsertFinding).not.toHaveBeenCalled();
    expect(fixture.job.fail).toHaveBeenCalledExactlyOnceWith('Interrupted by a restart');
  });

  it('ignores an external quiet-hours cancellation for an in-flight manual check', async () => {
    const hook = vi.fn();
    const fixture = setup({ onFindingsStored: [hook] });
    const pending = deferred<ProactiveModelResult>();
    fixture.model.summarize.mockReturnValue(pending.promise);
    const controller = new AbortController();
    const claimed = await fixture.claim();
    const running = fixture.engine(claimed, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.model.summarize).toHaveBeenCalledTimes(1);
    controller.abort('quiet_hours');
    await vi.advanceTimersByTimeAsync(0);
    const [input, signal] = fixture.model.summarize.mock.calls[0]!;
    expect(controller.signal.aborted).toBe(true);
    expect(signal.aborted).toBe(false);
    expect(await fixture.store.runs.latest()).toMatchObject({ status: 'running' });
    expect(fixture.store.runs.finish).not.toHaveBeenCalled();
    pending.resolve(summary(input));
    await running;
    expect(await fixture.store.runs.latest()).toMatchObject({
      id: claimed.run.id, status: 'done', reason: null, findingCount: 2,
    });
    expect(hook).toHaveBeenCalledTimes(1);
    expect(fixture.store.items.upsertFinding).toHaveBeenCalledTimes(2);
    expect(fixture.store.runs.finish).toHaveBeenCalledTimes(1);
    expect(fixture.job.done).toHaveBeenCalledExactlyOnceWith('proactive');
    expect(fixture.job.fail).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not report a successful job if finishing the stale generation is rejected', async () => {
    const fixture = setup();
    vi.mocked(fixture.store.runs.finish).mockResolvedValue(false);
    await fixture.run();
    expect(fixture.job.done).not.toHaveBeenCalled();
    expect(fixture.job.fail).toHaveBeenCalledExactlyOnceWith('Another run took over');
  });

  it('does not read sources or invoke the model already inside Copenhagen quiet hours', async () => {
    vi.setSystemTime('2026-10-20T20:00:00.000Z');
    const fixture = setup();
    expect(await fixture.run('scheduled')).toMatchObject({
      status: 'cancelled', reason: 'quiet_hours', findingCount: 0,
    });
    expect(fixture.job.fail).toHaveBeenCalledExactlyOnceWith('Stopped for quiet hours');
    expect(fixture.todoSource.read).not.toHaveBeenCalled();
    expect(fixture.model.summarize).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('maps unexpected errors to a safe job failure without exposing exception text', async () => {
    const fixture = setup();
    fixture.model.worstCaseDkk.mockRejectedValue(new Error('private provider details'));
    expect(await fixture.run()).toMatchObject({
      status: 'failed', reason: 'internal_error', findingCount: 0,
    });
    expect(fixture.job.fail).toHaveBeenCalledExactlyOnceWith('Check could not be completed');
    expect(fixture.model.summarize).not.toHaveBeenCalled();
    expect(fixture.store.items.upsertFinding).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('creates a fallback failed job exactly once when settings cannot be read', async () => {
    const hook = vi.fn();
    const fixture = setup({ onFindingsStored: [hook] });
    vi.mocked(fixture.store.settings.read).mockRejectedValue(new Error('private settings error'));
    const claimed = await fixture.claim();
    await fixture.engine(claimed);
    expect(await fixture.store.runs.latest()).toMatchObject({
      id: claimed.run.id, status: 'failed', reason: 'internal_error', findingCount: 0,
    });
    expect(fixture.start).toHaveBeenCalledExactlyOnceWith('proactive', 'Proactive check (manual)', 1);
    expect(fixture.job.fail).toHaveBeenCalledExactlyOnceWith('Check could not be completed');
    expect(fixture.job.done).not.toHaveBeenCalled();
    expect(fixture.store.runs.finish).toHaveBeenCalledExactlyOnceWith(
      claimed.run.id, claimed.generation, 'failed', 'internal_error', 0, new Date(NOW),
    );
    expect(fixture.todoSource.read).not.toHaveBeenCalled();
    expect(fixture.model.worstCaseDkk).not.toHaveBeenCalled();
    expect(fixture.model.summarize).not.toHaveBeenCalled();
    expect(fixture.store.spend.record).not.toHaveBeenCalled();
    expect(fixture.recordFoundryUsage).not.toHaveBeenCalled();
    expect(fixture.store.items.upsertFinding).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
    expect(fixture.events).toEqual(['finish', 'job:start', 'job:fail']);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('finding deduplication', () => {
  it('hashes semantic evidence independently of refs, evidence order, labels, observation time and whitespace', () => {
    const first = { ...fact(), source: 'todos' as const };
    const second = { ...fact({ kind: 'mail', text: 'Meeting agenda', dueAt: null }), source: 'mail' as const };
    const key = modelDedupeKey('prep', [first, second]);
    expect(key).toMatch(/^[a-f0-9]{32}$/u);
    expect(modelDedupeKey('prep', [
      { ...second, ref: 'mail:99', observedAt: '2026-10-21T10:00:00.000Z' },
      { ...first, ref: 'todos:99', label: 'Renamed label', text: '  PREPARE  meeting\nnotes  ' },
    ])).toBe(key);
    expect(modelDedupeKey('suggestion', [first, second])).not.toBe(key);
    expect(modelDedupeKey('prep', [{ ...first, source: 'calendar' }, second])).not.toBe(key);
    expect(modelDedupeKey('prep', [{ ...first, dueAt: '2026-10-21T11:00:00.000Z' }, second])).not.toBe(key);
  });

  it('keeps dismissed repeated findings dismissed through noncritical model urgency changes', async () => {
    const fixture = setup();
    fixture.model.summarize.mockImplementation(async (input) => ({
      ...summary(input),
      findings: summary(input).findings.map((finding) => ({ ...finding, urgency: 'fyi' })),
    }));
    await fixture.run();
    const initial = await fixture.store.items.list('all', 20, new Date());
    for (const item of initial) await fixture.store.items.applyFeedback(item.id, 'dismiss');
    fixture.todoSource.read.mockResolvedValue({
      source: 'todos', state: 'ok', reason: null, observedAt: NOW,
      facts: [fact({ ref: 'new-provider-id', text: ' PREPARE  meeting notes ', label: 'Renamed source' })],
    });
    vi.setSystemTime(Date.now() + 5 * 60_000);
    await fixture.run();
    const repeated = await fixture.store.items.list('all', 20, new Date());
    expect(repeated).toHaveLength(2);
    expect(repeated.map((item) => item.id).sort()).toEqual(initial.map((item) => item.id).sort());
    expect(repeated.every((item) => item.state === 'dismissed')).toBe(true);
    fixture.model.summarize.mockImplementation(async (input) => summary(input));
    vi.setSystemTime(Date.now() + 5 * 60_000);
    await fixture.run();
    const escalated = await fixture.store.items.list('all', 20, new Date());
    expect(escalated).toHaveLength(2);
    expect(escalated.find((item) => item.category === 'deadline')).toMatchObject({ state: 'dismissed' });
    expect(escalated.find((item) => item.category === 'prep')).toMatchObject({
      id: initial.find((item) => item.category === 'prep')!.id, state: 'dismissed', urgency: 'normal',
    });
  });

  it('reopens a dismissed deterministic finding when its urgency escalates to time critical', async () => {
    const calendar = source('calendar', [
      fact({
        kind: 'event', text: 'Planning meeting', dueAt: null,
        startsAt: '2026-10-22T11:00:00.000Z', endsAt: '2026-10-22T12:00:00.000Z',
      }),
      fact({
        kind: 'event', text: 'Design review', dueAt: null,
        startsAt: '2026-10-22T11:30:00.000Z', endsAt: '2026-10-22T12:30:00.000Z',
      }),
    ]);
    const fixture = setup({ sources: [calendar] });
    expect(await fixture.run()).toMatchObject({ status: 'done', findingCount: 2 });
    const initial = await fixture.store.items.list('all', 20, new Date());
    const clash = initial.find((item) => item.category === 'clash')!;
    expect(clash).toMatchObject({ urgency: 'normal', state: 'new' });
    for (const item of initial) await fixture.store.items.applyFeedback(item.id, 'dismiss');
    vi.setSystemTime(Date.now() + 2 * 60 * 60_000);
    expect(await fixture.run()).toMatchObject({ status: 'done', findingCount: 2 });
    const escalated = await fixture.store.items.list('all', 20, new Date());
    expect(escalated).toHaveLength(2);
    expect(escalated.find((item) => item.category === 'clash')).toMatchObject({
      id: clash.id, urgency: 'time_critical', state: 'new',
    });
    expect(escalated.find((item) => item.category === 'prep')).toMatchObject({ state: 'dismissed' });
  });
});

describe('proactive background job mapping', () => {
  it.each([
    ['manual', null, 'Proactive check (manual)'],
    ['scheduled', '2026-10-20T07:00', 'Proactive check (07:00)'],
    ['scheduled', '2026-10-20T18:00', 'Proactive check (18:00)'],
    ['catchup', '2026-10-20T07:00', 'Proactive check (07:00, late)'],
    ['catchup', '2026-10-20T18:00', 'Proactive check (18:00, late)'],
  ] as const)('labels %s %s', (trigger, slot, expected) => {
    expect(proactiveJobLabel({
      id: 'run', trigger, slot, status: 'running', reason: null,
      startedAt: NOW, finishedAt: null, findingCount: 0,
    })).toBe(expected);
  });

  it('maps every stable engine failure reason to a safe job detail', () => {
    expect(jobReasons).toEqual({
      budget_exhausted: 'Monthly budget reached',
      model_unavailable: 'Summary step unavailable',
      invalid_model_output: 'Summary step rejected',
      no_sources: 'No source could be read',
      quiet_hours: 'Stopped for quiet hours',
      interrupted_by_restart: 'Interrupted by a restart',
      lease_lost: 'Another run took over',
      deadline_exceeded: 'Took too long',
      internal_error: 'Check could not be completed',
      preferences_changed: 'Suggestion preferences changed',
    });
  });
});
