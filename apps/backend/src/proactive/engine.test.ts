import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProactiveEngine, LEASE_HEARTBEAT_MS, type ProactiveEngineOptions } from './engine.js';
import { createMemoryProactiveStore } from './store.js';
import type { ProactiveSource } from './types.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-15T10:00:00.000Z');
class RequestError extends Error {}

const model = { worstCaseDkk: async () => 0.1, summarize: async () => ({ findings: [] }) };
const todos: ProactiveSource = {
  id: 'todos', label: 'Todos',
  read: async () => ({ source: 'todos', state: 'ok', reason: null, facts: [], observedAt: NOW.toISOString() }),
};

async function setup(options: Partial<ProactiveEngineOptions> = {}) {
  const store = createMemoryProactiveStore(OWNER);
  const warn = vi.fn();
  const run = createProactiveEngine({ store, sources: [todos], model, now: () => NOW, logger: { warn }, ...options });
  const claim = (await store.runs.claim({ trigger: 'manual', slot: null, now: NOW }))!;
  return { store, warn, run, claim };
}

describe('the old proactive engine says where it failed and what was thrown', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('logs a finish write that failed with its stage and class, and leaves the run running until its lease lapses', async () => {
    const { store, warn, run, claim } = await setup();
    store.runs.finish = async () => { throw new RequestError('private message'); };
    await run(claim);
    expect(warn.mock.calls).toEqual([[
      { runId: claim.run.id, reason: 'internal_error', stage: 'run_finish', errorClass: 'RequestError' }, 'proactive.failed',
    ]]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
    expect(await store.runs.latest()).toMatchObject({ status: 'running' });
  });

  it('records a run that threw as failed and logs it, where it used to leave no line at all', async () => {
    const { store, warn, run, claim } = await setup();
    store.settings.read = async () => { throw new RequestError('private message'); };
    await run(claim);
    expect(warn.mock.calls).toEqual([[
      { runId: claim.run.id, reason: 'internal_error', stage: 'run', errorClass: 'RequestError' }, 'proactive.failed',
    ]]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
    expect(await store.runs.latest()).toMatchObject({ status: 'failed', reason: 'internal_error' });
  });

  it('logs a hook that threw with its class and still finishes the run', async () => {
    const { store, warn, run, claim } = await setup({ onFindingsStored: [async () => { throw new TypeError('private message'); }] });
    await run(claim);
    expect(warn.mock.calls).toEqual([[
      { runId: claim.run.id, reason: 'hook_failed', errorClass: 'TypeError' }, 'proactive.failed',
    ]]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
    expect(await store.runs.latest()).toMatchObject({ status: 'done' });
  });

  it('logs a heartbeat that failed and stops the run, instead of ending it without a line', async () => {
    vi.useFakeTimers();
    const { store, warn, run, claim } = await setup({ model: { ...model, worstCaseDkk: () => new Promise<number>(() => {}) } });
    store.runs.heartbeat = async () => { throw new RequestError('private message'); };
    const finished = run(claim);
    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS);
    await finished;
    expect(warn.mock.calls).toEqual([[
      { runId: claim.run.id, reason: 'internal_error', stage: 'heartbeat', errorClass: 'RequestError' }, 'proactive.failed',
    ]]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
    expect(await store.runs.latest()).toMatchObject({ status: 'failed', reason: 'internal_error' });
  });

  it('does not log a run that was stopped on purpose as a failure', async () => {
    const { store, warn, run, claim } = await setup();
    await run(claim, AbortSignal.abort('interrupted_by_restart'));
    expect(warn).not.toHaveBeenCalled();
    expect(await store.runs.latest()).toMatchObject({ reason: 'interrupted_by_restart' });
  });
});
