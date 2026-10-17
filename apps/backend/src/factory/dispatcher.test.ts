import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventHub } from '../core/event-hub.js';
import type { SettingsStore } from '../core/settings.js';
import { FoundryClientError, type CancelAcknowledgement, type InvocationSnapshot } from '../foundry/client.js';
import { SandboxHeartbeat } from './heartbeat.js';
import { canTransitionTask } from './task-lifecycle.js';
import {
  TaskDispatcher, type DispatchClaim, type DispatcherOptions, type DispatcherStore, type StaleRunningTask,
  type TaskControlTarget,
} from './dispatcher.js';
import type { TaskRecoveryStore } from './recovery-store.js';
import type { TaskEventHub, TaskEventMessage, TaskRecord, TaskRuntimeVersion, TaskStore } from './task-store.js';

const task: DispatchClaim = {
  taskId: '42',
  executionGeneration: '1',
  projectId: '7',
  title: 'Fix the bug',
  request: 'Find and fix it',
  agent: 'codex',
  modelOverride: 'gpt-5.4',
  reasoningOverride: 'high',
  attemptCount: 1,
  nextAttemptAt: null,
  sandboxSize: '1x2',
  tech: 'node',
  repository: 'DanAakesen/jarvis',
  defaultBranch: 'main',
  branch: 'jarvis/task-42',
};

const controlTask: TaskRecord = {
  id: '42',
  projectId: '7',
  originMessageId: null,
  title: 'Fix the bug',
  request: 'Find and fix it',
  source: 'board',
  agent: 'codex',
  modelOverride: 'gpt-5.4',
  reasoningOverride: 'high',
  state: 'Running',
  activity: null,
  priority: 0,
  attemptCount: 1,
  nextAttemptAt: null,
  branch: 'jarvis/task-42',
  createdAt: '2026-10-03T12:00:00.000Z',
  startedAt: '2026-10-03T12:00:00.000Z',
  finishedAt: null,
};

const controlTarget: TaskControlTarget = {
  taskId: '42',
  executionGeneration: '1',
  agent: 'codex',
  request: 'Find and fix it',
  modelOverride: 'gpt-5.4',
  reasoningOverride: 'high',
  sandboxSessionId: '53',
  foundrySessionId: 'session-1',
  agentName: 'jarvis-runner-base-1x2',
  invocationId: 'invocation-1',
  latestTurnId: '71',
  sandboxSize: '1x2',
  image: 'jarvis-runner:latest',
  sessionStatus: 'Active',
  repository: 'DanAakesen/jarvis',
  defaultBranch: 'main',
  branch: 'jarvis/task-42',
};

function harness(
  store: DispatcherStore,
  startTask = vi.fn(async () => ({
  invocationId: 'invocation-1', sessionId: 'session-1', status: 'queued' as const, agent: 'codex' as const,
  })),
  taskRecord: TaskRecord = controlTask,
  options: DispatcherOptions = {},
  hasTrackedSessions = false,
) {
  const events: TaskEventHub = createEventHub<TaskEventMessage>();
  const transition = vi.fn(async (
    _id: string,
    state: TaskRecord['state'],
  ) => ({
    kind: 'ok' as const, task: { ...taskRecord, state },
  }));
  let currentState = taskRecord.state;
  const tasks = {
    get: vi.fn(async () => ({ ...taskRecord, state: currentState, events: [], usage: [] })),
    transition: vi.fn(async (
      id: string,
      state: TaskRecord['state'],
      completionVerified = false,
    ) => {
      if (currentState !== state && !canTransitionTask(currentState, state, completionVerified)) {
        return { kind: 'invalid-transition' as const };
      }
      currentState = state;
      return transition(id, state);
    }),
    recordEvent: vi.fn(),
  } as unknown as TaskStore;
  const settings: SettingsStore = { read: vi.fn(async () => ({
    'codex.model': '"gpt-5.5"', 'codex.reasoning_effort': '"medium"',
  })), write: vi.fn(async () => {}) };
  const tracked = { value: hasTrackedSessions };
  const track = vi.fn(() => { tracked.value = true; });
  const untrack = vi.fn<(sandboxSessionId: string) => void>(() => { tracked.value = false; });
  const setCompletionHandler = vi.fn();
  const heartbeat = {
    track, untrack, setCompletionHandler, hasTrackedSessions: () => tracked.value,
  } as unknown as SandboxHeartbeat;
  const steer = vi.fn(async () => ({
    invocationId: 'invocation-steer', sessionId: 'session-1', status: 'queued' as const, agent: 'codex' as const,
  }));
  const pause = vi.fn(async () => ({
    sessionId: 'session-1', status: 'pausing' as const, pausedInvocationId: 'invocation-1',
  }));
  const resume = vi.fn(async () => ({
    invocationId: 'invocation-resume', sessionId: 'session-1', status: 'queued' as const, agent: 'codex' as const,
  }));
  const cancel = vi.fn(async (invocationId: string): Promise<CancelAcknowledgement> => ({ invocationId, status: 'cancelled' }));
  const deleteSession = vi.fn(async () => {});
  const status = vi.fn(async (invocationId: string): Promise<InvocationSnapshot> => ({
    invocationId,
    sessionId: 'session-1',
    status: 'running',
    agent: 'codex',
    startedAt: 1,
    finishedAt: null,
    events: [],
    result: null,
    error: null,
  }));
  const clientFor = vi.fn(() => ({ startTask, steer, pause, resume, cancel, deleteSession, status }));
  const dispatcher = new TaskDispatcher(store, tasks, settings, clientFor, heartbeat, events, options);
  return {
    dispatcher, events, settings, tasks, heartbeat, startTask, transition, track, untrack, clientFor, steer, pause, resume,
    cancel, deleteSession, status,
  };
}

function idleStore(nextAttemptAt: string | null = null): DispatcherStore {
  const store: DispatcherStore = {
    claimNext: vi.fn(async () => ({ kind: 'idle' as const, nextAttemptAt })),
    listStaleRunning: vi.fn(async () => []),
    isCurrentStaleTask: vi.fn(async () => true),
    recordHeartbeat: vi.fn(async () => {}),
    deferClaim: vi.fn(async () => {}),
    failStart: vi.fn(async () => {}),
    recordStarted: vi.fn(async () => '53'),
    getControlTarget: vi.fn(async () => null),
    getRuntimeVersion: vi.fn(async function (this: DispatcherStore) {
      const target = await vi.mocked(this.getControlTarget).mock.results.at(-1)?.value;
      return {
        sandboxSessionId: target?.sandboxSessionId ?? null,
        foundrySessionId: target?.foundrySessionId ?? null,
        sessionStatus: target?.sessionStatus ?? null,
        latestTurnId: target?.latestTurnId ?? null,
      };
    }),
    withTaskPolicyLock: async <T>(_taskId: string, operation: () => Promise<T>): Promise<T> => operation(),
    hasPendingProjectPolicyMerge: vi.fn(async () => false),
    recordControlTurn: vi.fn(async () => true),
    recordResumedTurn: vi.fn(async () => ({
      sandboxSessionId: '54',
      executionGeneration: '1',
      foundrySessionId: 'session-1',
      agentName: 'jarvis-runner-base-1x2',
      invocationId: 'invocation-resume',
    })),
    endTaskSessions: vi.fn(async () => []),
  };
  return store;
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function invocationSnapshot(status: InvocationSnapshot['status']): InvocationSnapshot {
  return {
    invocationId: controlTarget.invocationId,
    sessionId: controlTarget.foundrySessionId,
    status,
    agent: 'codex',
    startedAt: 1,
    finishedAt: status === 'running' || status === 'queued' ? null : 2,
    workCompleted: status === 'completed',
    providerStopped: status === 'completed',
    workCommitSha: 'a'.repeat(40),
    events: [],
    result: null,
    error: null,
  };
}

function reconciliationHarness(
  status: InvocationSnapshot['status'],
  verifyDelivery: DispatcherOptions['verifyDelivery'] | null = vi.fn(async () => ({ kind: 'awaiting_policy' as const })),
  onReconciliation: DispatcherOptions['onReconciliation'] = () => {},
  sessionStatus: StaleRunningTask['sessionStatus'] = 'Active',
  hasTrackedSessions = true,
  workspaceAvailable = true,
) {
  const staleTask: StaleRunningTask = { ...controlTarget, taskId: '42', sessionStatus };
  const store: DispatcherStore = {
    ...idleStore(),
    listStaleRunning: vi.fn(async () => [staleTask]),
  };
  const recoveryStore = {
    getRunningTaskForSession: vi.fn(async () => '42'),
    claimRecovery: vi.fn(async () => ({ kind: 'invalid-transition' as const })),
  } as unknown as TaskRecoveryStore;
  const test = harness(store, undefined, controlTask, {
    reconciliationIntervalMs: 60_000,
    staleHeartbeatMs: 100,
    recoveryStore,
    onReconciliation,
    workspaceFor: vi.fn(async () => workspaceAvailable ? ({
      repository: 'DanAakesen/jarvis-test-target',
      defaultBranch: 'main',
      branch: controlTarget.branch,
    }) : null),
    ...(verifyDelivery ? { verifyDelivery } : {}),
  }, hasTrackedSessions);
  test.status.mockResolvedValue(invocationSnapshot(status));
  return { ...test, store, staleTask, verifyDelivery };
}

afterEach(() => { vi.useRealTimers(); });

function pagedReconciliationHarness(count: number) {
  const rows: StaleRunningTask[] = Array.from({ length: count }, (_, index) => ({
    ...controlTarget, taskId: String(100 + index), sessionStatus: 'Ended',
    sandboxSessionId: String(200 + index), foundrySessionId: `session-${index}`,
    invocationId: `invocation-${index}`,
  }));
  const eligible = new Set(rows.map(({ taskId }) => taskId));
  const states = new Map<string, TaskRecord['state']>(rows.map(({ taskId }) => [taskId, 'Running']));
  const errors: unknown[] = [];
  const store = idleStore();
  store.listStaleRunning = vi.fn(async (_before: Date, limit: number, afterTaskId?: string) =>
    rows.filter(({ taskId }) => eligible.has(taskId) && states.get(taskId) === 'Running'
      && BigInt(taskId) > BigInt(afterTaskId ?? '0')).slice(0, limit));
  store.isCurrentStaleTask = vi.fn(async ({ taskId }) =>
    eligible.has(taskId) && states.get(taskId) === 'Running');
  store.endTaskSessions = vi.fn(async (taskId) => rows
    .filter((row) => row.taskId === taskId).map(({ sandboxSessionId }) => sandboxSessionId));
  const test = harness(store, undefined, controlTask, {
    onError: (error) => errors.push(error),
    workspaceFor: async () => ({
      repository: 'DanAakesen/jarvis-test-target', defaultBranch: 'main', branch: controlTarget.branch,
    }),
    verifyDelivery: async () => ({ kind: 'awaiting_policy' }),
  });
  vi.mocked(test.tasks.get).mockImplementation(async (taskId) => {
    const state = states.get(taskId);
    return state ? { ...controlTask, id: taskId, state, events: [], usage: [] } : null;
  });
  vi.mocked(test.tasks.transition).mockImplementation(async (taskId, state) => {
    states.set(taskId, state);
    return { kind: 'ok', task: { ...controlTask, id: taskId, state } };
  });
  const snapshot = (invocationId: string): InvocationSnapshot => {
    const row = rows.find((candidate) => candidate.invocationId === invocationId);
    if (!row) throw new Error('Unexpected synthetic invocation');
    return { ...invocationSnapshot('completed'), invocationId, sessionId: row.foundrySessionId };
  };
  test.status.mockImplementation(async (invocationId) => snapshot(invocationId));
  const expire = (taskId: string) => test.events.publish({
    id: `expiry-${taskId}`, taskId, type: 'sandbox_idle_expired', summary: null,
    payload: { reason: 'idle_expired' }, payloadTruncated: false, source: 'backend', at: new Date().toISOString(),
  });
  return { ...test, store, rows, eligible, errors, expire, snapshot };
}

describe('task dispatcher', () => {
  it('runs one startup reconciliation but skips recurring SQL scans while no sandbox is tracked', async () => {
    vi.useFakeTimers();
    const store = idleStore();
    const test = harness(store, undefined, controlTask, { reconciliationIntervalMs: 60_000 });
    test.dispatcher.start();

    await vi.advanceTimersByTimeAsync(0);
    expect(store.listStaleRunning).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(store.listStaleRunning).toHaveBeenCalledOnce();

    await test.dispatcher.stop();
    vi.useRealTimers();
  });

  it('does not start a task twice when two dispatcher instances compete for its lease', async () => {
    let claimed = false;
    const startTask = vi.fn(async () => ({
      invocationId: 'invocation-1', sessionId: 'session-1', status: 'queued' as const, agent: 'codex' as const,
    }));
    const store: DispatcherStore = {
      ...idleStore(),
      claimNext: vi.fn(async () => {
        if (claimed) return { kind: 'idle' as const, nextAttemptAt: null };
        claimed = true;
        return { kind: 'claimed' as const, task };
      }),
    };
    const first = harness(store, startTask);
    const second = harness(store, startTask);
    first.dispatcher.start();
    second.dispatcher.start();
    await vi.waitFor(() => expect(store.claimNext).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(startTask).toHaveBeenCalledOnce());
    await flush();

    expect(startTask).toHaveBeenCalledWith({
      agent: 'codex', task: 'Find and fix it', taskId: '42', model: 'gpt-5.4', reasoning: 'high',
      repository: 'DanAakesen/jarvis', defaultBranch: 'main', branch: 'jarvis/task-42',
    });
    expect(first.track).toHaveBeenCalledOnce();
    expect(second.track).toHaveBeenCalledTimes(0);
    await Promise.all([first.dispatcher.stop(), second.dispatcher.stop()]);
  });

  it('prefers the Codex role reasoning setting while retaining legacy task fallbacks', async () => {
    const unconfiguredTask = { ...task, modelOverride: null, reasoningOverride: null };
    let claimed = false;
    const store: DispatcherStore = {
      ...idleStore(),
      claimNext: vi.fn(async () => {
        if (claimed) return { kind: 'idle' as const, nextAttemptAt: null };
        claimed = true;
        return { kind: 'claimed' as const, task: unconfiguredTask };
      }),
    };
    const test = harness(store);
    vi.mocked(test.settings.read).mockResolvedValue({
      'roles.codex.model': '"default"',
      'roles.codex.reasoning_effort': '"high"',
      'codex.model': '"gpt-5.5"',
      'codex.reasoning_effort': '"medium"',
    });
    test.dispatcher.start();

    await vi.waitFor(() => expect(test.startTask).toHaveBeenCalledOnce());
    expect(test.startTask).toHaveBeenCalledWith(expect.objectContaining({
      agent: 'codex',
      reasoning: 'high',
    }));

    await test.dispatcher.stop();
  });

  it('passes the selected Copilot model and reasoning effort to the runner', async () => {
    const copilotTask: DispatchClaim = {
      ...task,
      agent: 'copilot',
      modelOverride: null,
      reasoningOverride: null,
    };
    let claimed = false;
    const store: DispatcherStore = {
      ...idleStore(),
      claimNext: vi.fn(async () => {
        if (claimed) return { kind: 'idle' as const, nextAttemptAt: null };
        claimed = true;
        return { kind: 'claimed' as const, task: copilotTask };
      }),
    };
    const test = harness(store);
    vi.mocked(test.settings.read).mockResolvedValue({
      'roles.copilot.model': '"claude-sonnet-4.6"',
      'roles.copilot.reasoning_effort': '"high"',
    });
    test.dispatcher.start();

    await vi.waitFor(() => expect(test.startTask).toHaveBeenCalledOnce());
    expect(test.startTask).toHaveBeenCalledWith(expect.objectContaining({
      agent: 'copilot',
      model: 'claude-sonnet-4.6',
      reasoning: 'high',
    }));

    await test.dispatcher.stop();
  });

  it('does not query the store again while idle and ignores unrelated events', async () => {
    const store = idleStore();
    const { dispatcher, events } = harness(store);
    dispatcher.start();
    await vi.waitFor(() => expect(store.claimNext).toHaveBeenCalledOnce());
    events.publish({
      id: '1', taskId: '42', type: 'files_changed', summary: null, payload: null,
      payloadTruncated: false, source: 'runner', at: new Date().toISOString(),
    });
    await flush();

    expect(store.claimNext).toHaveBeenCalledOnce();
    await dispatcher.stop();
  });

  it('does not lose a task event published during an idle queue scan', async () => {
    const store = idleStore();
    const { dispatcher, events } = harness(store);
    vi.mocked(store.claimNext).mockImplementationOnce(async () => {
      events.publish({
        id: '3', taskId: '42', type: 'created', summary: null, payload: null,
        payloadTruncated: false, source: 'backend', at: new Date().toISOString(),
      });
      return { kind: 'idle', nextAttemptAt: null };
    });
    dispatcher.start();
    await vi.waitFor(() => expect(store.claimNext).toHaveBeenCalledTimes(2));
    await dispatcher.stop();
  });

  it.each(['Paused', 'NeedsAttention'])('ends and untracks active sessions on committed %s events', async (state) => {
    const store = idleStore();
    vi.mocked(store.endTaskSessions).mockResolvedValue(['53']);
    const { dispatcher, events, untrack } = harness(store);
    dispatcher.start();
    await vi.waitFor(() => expect(store.claimNext).toHaveBeenCalledOnce());
    events.publish({
      id: '2', taskId: '42', type: 'state_changed', summary: null, payload: { from: 'Running', to: state },
      payloadTruncated: false, source: 'backend', at: new Date().toISOString(),
    });
    await vi.waitFor(() => expect(untrack).toHaveBeenCalledWith('53'));
    expect(store.endTaskSessions).toHaveBeenCalledWith('42', state, false);
    await dispatcher.stop();
  });

  it('keeps a completed session-question session monitored for idle expiry', async () => {
    const store = idleStore();
    const { dispatcher, events, untrack } = harness(store);
    dispatcher.start();
    await vi.waitFor(() => expect(store.claimNext).toHaveBeenCalledOnce());
    events.publish({
      id: '4', taskId: '42', type: 'state_changed', summary: null,
      payload: { from: 'Running', to: 'NeedsAttention', reason: 'session_question' },
      payloadTruncated: false, source: 'backend', at: new Date().toISOString(),
    });
    await flush();

    expect(store.endTaskSessions).not.toHaveBeenCalled();
    expect(untrack).not.toHaveBeenCalled();
    await dispatcher.stop();
  });

  it.each([
    [new FoundryClientError('auth', 'start'), 'foundry_start_rejected'],
    [new FoundryClientError('http', 'start', 403), 'foundry_start_rejected'],
    [new FoundryClientError('http', 'start', 408), 'foundry_start_failed'],
    [new FoundryClientError('http', 'start', 500), 'foundry_start_failed'],
    [new FoundryClientError('timeout', 'start'), 'foundry_start_failed'],
    [new FoundryClientError('protocol', 'start'), 'foundry_start_failed'],
  ])('distinguishes refused start %s from uncertain remote outcomes', async (error, reason) => {
    const store = idleStore();
    vi.mocked(store.claimNext).mockResolvedValueOnce({
      kind: 'claimed', task: { ...task, attemptCount: 3 },
    });
    const { dispatcher } = harness(store, vi.fn(async () => { throw error; }));
    dispatcher.start();
    await vi.waitFor(() => expect(store.failStart).toHaveBeenCalledWith(
      expect.any(String), expect.objectContaining({ attemptCount: 3 }), null, reason,
    ));
    expect(store.recordStarted).not.toHaveBeenCalled();
    await dispatcher.stop();
  });

  it('retries a rejected Foundry start twice and then moves it to NeedsAttention', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    let retryAt: string | null = null;
    const store: DispatcherStore = {
      ...idleStore(),
      claimNext: vi.fn(async () => {
        if (attempts === 0 || (retryAt !== null && Date.parse(retryAt) <= Date.now())) {
          attempts += 1;
          retryAt = null;
          return { kind: 'claimed' as const, task: { ...task, attemptCount: attempts } };
        }
        return { kind: 'idle' as const, nextAttemptAt: retryAt };
      }),
      failStart: vi.fn(async (_owner, _task, at) => { retryAt = at; }),
    };
    const onStartFailure = vi.fn();
    const { dispatcher, startTask } = harness(
      store,
      vi.fn(async () => { throw new FoundryClientError('http', 'start', 429); }),
      controlTask,
      { onStartFailure },
    );
    dispatcher.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.failStart).toHaveBeenCalledTimes(1);
    expect(store.failStart).toHaveBeenNthCalledWith(
      1, expect.any(String), expect.objectContaining({ attemptCount: 1 }),
      new Date(Date.now() + 15_000).toISOString(), 'foundry_start_rejected',
    );

    await vi.advanceTimersByTimeAsync(15_000);
    expect(store.failStart).toHaveBeenCalledTimes(2);
    expect(store.failStart).toHaveBeenNthCalledWith(
      2, expect.any(String), expect.objectContaining({ attemptCount: 2 }),
      new Date(Date.now() + 30_000).toISOString(), 'foundry_start_rejected',
    );

    await vi.advanceTimersByTimeAsync(30_000);
    expect(store.failStart).toHaveBeenCalledTimes(3);
    expect(store.failStart).toHaveBeenNthCalledWith(
      3, expect.any(String), expect.objectContaining({ attemptCount: 3 }), null, 'foundry_start_rejected',
    );
    expect(startTask).toHaveBeenCalledTimes(3);
    expect(onStartFailure.mock.calls).toEqual([
      [{ taskId: '42', reason: 'foundry_start_rejected' }],
      [{ taskId: '42', reason: 'foundry_start_rejected' }],
      [{ taskId: '42', reason: 'foundry_start_rejected' }],
    ]);
    for (const [request] of startTask.mock.calls as unknown as [{ branch: string }][]) {
      expect(request.branch).toBe('jarvis/task-42');
    }
    await dispatcher.stop();
  });

  it('reports credential-unavailable start failures without starting Foundry', async () => {
    const store = idleStore();
    vi.mocked(store.claimNext).mockResolvedValueOnce({ kind: 'claimed', task });
    const onStartFailure = vi.fn();
    const { dispatcher, tasks, startTask } = harness(store, undefined, controlTask, { onStartFailure });
    vi.mocked(tasks.transition).mockResolvedValue({ kind: 'credential-unavailable' });
    dispatcher.start();
    await vi.waitFor(() => expect(onStartFailure).toHaveBeenCalledWith({
      taskId: '42', reason: 'credential_unavailable',
    }));
    expect(store.failStart).toHaveBeenCalledWith(expect.any(String), task, null, 'credential_unavailable');
    expect(startTask).not.toHaveBeenCalled();
    await dispatcher.stop();
  });

  it('reports accepted-session persistence failures with a fixed reason', async () => {
    const store = idleStore();
    vi.mocked(store.claimNext).mockResolvedValueOnce({ kind: 'claimed', task });
    vi.mocked(store.recordStarted).mockRejectedValue(new Error('database-secret'));
    const onStartFailure = vi.fn();
    const { dispatcher } = harness(store, undefined, controlTask, { onStartFailure });
    dispatcher.start();
    await vi.waitFor(() => expect(onStartFailure).toHaveBeenCalledWith({
      taskId: '42', reason: 'session_persistence_failed',
    }));
    expect(JSON.stringify(onStartFailure.mock.calls)).not.toContain('secret');
    await dispatcher.stop();
  });

  it('steers only a running task and tracks the accepted continuation turn', async () => {
    const store = {
      ...idleStore(),
      getControlTarget: vi.fn(async () => controlTarget),
    };
    const { dispatcher, steer, track } = harness(store);

    const result = await dispatcher.control('42', { action: 'steer', message: 'Keep the existing API.' });

    expect(steer).toHaveBeenCalledWith('session-1', 'codex', 'Keep the existing API.', { taskId: '42' });
    expect(store.recordControlTurn).toHaveBeenCalledWith(controlTarget, expect.objectContaining({
      invocationId: 'invocation-steer',
    }), 'Keep the existing API.');
    expect(track).toHaveBeenCalledWith(expect.objectContaining({ invocationId: 'invocation-steer' }));
    expect(result).toMatchObject({ kind: 'ok', task: { state: 'Running' } });
  });

  it('cancels an accepted steering turn when persistence fails', async () => {
    const store = {
      ...idleStore(),
      getControlTarget: vi.fn(async () => controlTarget),
      recordControlTurn: vi.fn(async () => { throw new Error('database unavailable'); }),
    };
    const { dispatcher, cancel, track } = harness(store);

    const result = await dispatcher.control('42', { action: 'steer', message: 'Keep the existing API.' });

    expect(result).toEqual({ kind: 'failed' });
    expect(cancel).toHaveBeenCalledWith('invocation-steer');
    expect(track).not.toHaveBeenCalled();
  });

  it('leaves a task PauseRequested until Foundry confirms the turn has stopped', async () => {
    const store = {
      ...idleStore(),
      getControlTarget: vi.fn(async () => controlTarget),
    };
    const { dispatcher, pause, transition } = harness(store);

    const result = await dispatcher.control('42', { action: 'pause' });

    expect(pause).toHaveBeenCalledWith('session-1');
    expect(transition).toHaveBeenCalledWith('42', 'PauseRequested');
    expect(result).toMatchObject({ kind: 'ok', task: { state: 'PauseRequested' } });
  });

  it('resumes a paused task in the existing Foundry session and registers its new turn', async () => {
    const pausedTarget = { ...controlTarget, sessionStatus: 'Idle' as const };
    const store = {
      ...idleStore(),
      getControlTarget: vi.fn(async () => pausedTarget),
    };
    const { dispatcher, resume, track, transition } = harness(store, undefined, { ...controlTask, state: 'Paused' });

    const result = await dispatcher.control('42', { action: 'resume' });

    expect(resume).toHaveBeenCalledWith('session-1', {
      agent: 'codex', task: 'Find and fix it', taskId: '42', model: 'gpt-5.4', reasoning: 'high',
      repository: 'DanAakesen/jarvis', defaultBranch: 'main', branch: 'jarvis/task-42',
    });

    expect(store.recordResumedTurn).toHaveBeenCalledWith(pausedTarget, expect.objectContaining({
      invocationId: 'invocation-resume',
    }));
    expect(transition).toHaveBeenCalledWith('42', 'Running');
    expect(track).toHaveBeenCalledWith(expect.objectContaining({ invocationId: 'invocation-resume' }));
    expect(result).toMatchObject({ kind: 'ok', task: { state: 'Running' } });
  });

  it('uses the persisted branch rather than regenerating it for resumed work', async () => {
    const pausedTarget = { ...controlTarget, branch: 'jarvis/retained-task', defaultBranch: 'develop', sessionStatus: 'Idle' as const };
    const store = { ...idleStore(), getControlTarget: vi.fn(async () => pausedTarget) };
    const { dispatcher, resume } = harness(store, undefined, { ...controlTask, state: 'Paused' });
    await expect(dispatcher.control('42', { action: 'resume' })).resolves.toMatchObject({ kind: 'ok' });
    expect(resume).toHaveBeenCalledWith('session-1', expect.objectContaining({
      repository: 'DanAakesen/jarvis', defaultBranch: 'develop', branch: 'jarvis/retained-task',
    }));
  });

  it('cancels a paused task and deletes its Foundry session', async () => {
    const pausedTarget = { ...controlTarget, sessionStatus: 'Idle' as const };
    const store = {
      ...idleStore(),
      getControlTarget: vi.fn(async () => pausedTarget),
    };
    const { dispatcher, cancel, deleteSession } = harness(store, undefined, { ...controlTask, state: 'Paused' });

    const result = await dispatcher.control('42', { action: 'cancel' });

    expect(result).toMatchObject({ kind: 'ok', task: { state: 'Cancelled' } });
    expect(cancel).not.toHaveBeenCalled();
    expect(store.endTaskSessions).toHaveBeenCalledWith('42', 'Cancelled');
    expect(deleteSession).toHaveBeenCalledWith('session-1');
  });

  it.each(['Active', 'Idle'] as const)('cancels only the owned %s attention session and awaits cleanup', async (sessionStatus) => {
    const target = { ...controlTarget, sessionStatus };
    let endSessions!: (ids: string[]) => void;
    let deleted!: () => void;
    const store = {
      ...idleStore(),
      getControlTarget: vi.fn(async () => target),
      endTaskSessions: vi.fn(() => new Promise<string[]>((resolve) => { endSessions = resolve; })),
    };
    const test = harness(store, undefined, { ...controlTask, state: 'NeedsAttention' });
    test.deleteSession.mockImplementation(() => new Promise<void>((resolve) => { deleted = resolve; }));
    let settled = false;
    const result = test.dispatcher.control('42', { action: 'cancel' }).then((value) => {
      settled = true;
      return value;
    });
    await flush();
    expect(store.endTaskSessions).toHaveBeenCalledWith('42', 'Cancelled');
    expect(test.cancel.mock.calls).toEqual(sessionStatus === 'Active' ? [['invocation-1']] : []);
    expect(test.deleteSession).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    endSessions(['53']);
    await flush();
    expect(test.deleteSession.mock.calls).toEqual([['session-1']]);
    expect(settled).toBe(false);
    deleted();
    await expect(result).resolves.toMatchObject({ kind: 'ok', task: { state: 'Cancelled' } });
    expect(test.untrack.mock.calls.every(([id]) => id === '53')).toBe(true);
    expect(test.startTask).not.toHaveBeenCalled();
    expect(test.steer).not.toHaveBeenCalled();
    expect(test.resume).not.toHaveBeenCalled();
  });

  it('deletes a completed attention session without cancelling its old invocation', async () => {
    const store = {
      ...idleStore(),
      getControlTarget: vi.fn(async () => ({ ...controlTarget, invocationId: '' })),
    };
    const test = harness(store, undefined, { ...controlTask, state: 'NeedsAttention' });
    await expect(test.dispatcher.control('42', { action: 'cancel' }))
      .resolves.toMatchObject({ kind: 'ok', task: { state: 'Cancelled' } });
    expect(test.cancel).not.toHaveBeenCalled();
    expect(test.deleteSession).toHaveBeenCalledWith('session-1');
  });

  it.each(['crashed', 'idle_expired', 'done', 'cancelled', 'idle'] as const)(
    'cancels attention after recorded session end %s without contacting another runtime', async (latestSessionEndReason) => {
      const test = harness(idleStore(), undefined, { ...controlTask, state: 'NeedsAttention', latestSessionEndReason });
      await expect(test.dispatcher.control('42', { action: 'cancel' }))
        .resolves.toMatchObject({ kind: 'ok', task: { state: 'Cancelled' } });
      expect(test.clientFor).not.toHaveBeenCalled();
    },
  );

  it('refuses attention cancellation when its runtime is unknown, even with an open PR', async () => {
    const store = idleStore();
    vi.mocked(store.getRuntimeVersion).mockResolvedValue({
      sandboxSessionId: '53', foundrySessionId: 'session-1', sessionStatus: 'Ended', latestTurnId: '71',
    });
    const test = harness(store, undefined, {
      ...controlTask, state: 'NeedsAttention', latestSessionEndReason: null,
      pullRequest: { number: 3, url: 'https://github.com/DanAakesen/jarvis-test-target/pull/3', state: 'open' },
    });
    await expect(test.dispatcher.control('42', { action: 'cancel' })).resolves.toEqual({
      kind: 'unavailable', reason: 'No task runtime session or completed delivery evidence could be found',
    });
    expect(test.transition).not.toHaveBeenCalled();
    expect(store.endTaskSessions).not.toHaveBeenCalled();
    expect(test.clientFor).not.toHaveBeenCalled();
  });

  it('cancels pre-start attention with a trusted absent runtime without contacting a provider', async () => {
    const runtime: TaskRuntimeVersion = {
      sandboxSessionId: null, foundrySessionId: null, sessionStatus: null, latestTurnId: null,
    };
    const store = idleStore();
    vi.mocked(store.getRuntimeVersion).mockResolvedValue(runtime);
    const test = harness(store, undefined, {
      ...controlTask, state: 'NeedsAttention', attemptCount: 3, latestSessionEndReason: null,
    });

    await expect(test.dispatcher.control('42', { action: 'cancel' }))
      .resolves.toMatchObject({ kind: 'ok', task: { state: 'Cancelled' } });
    expect(test.tasks.transition).toHaveBeenCalledWith(
      '42', 'Cancelled', false, undefined, undefined, 'NeedsAttention', runtime,
    );
    expect(store.endTaskSessions).toHaveBeenCalledWith('42', 'Cancelled');
    expect(test.clientFor).not.toHaveBeenCalled();
    expect(test.untrack).not.toHaveBeenCalled();
  });

  it.each((['missing', 'session', 'foundry', 'status', 'turn'] as const).flatMap(
    (field) => ([null, 'done'] as const).map((latestSessionEndReason) => ({ field, latestSessionEndReason })),
  ))(
    'rejects pre-start attention with $field runtime and end reason $latestSessionEndReason', async ({
      field, latestSessionEndReason,
    }) => {
      const store = idleStore();
      vi.mocked(store.getRuntimeVersion).mockResolvedValue(field === 'missing' ? null : {
        sandboxSessionId: field === 'session' ? '53' : null,
        foundrySessionId: field === 'foundry' ? 'session-1' : null,
        sessionStatus: field === 'status' ? 'Ended' : null,
        latestTurnId: field === 'turn' ? '71' : null,
      });
      const test = harness(store, undefined, {
        ...controlTask, state: 'NeedsAttention', latestSessionEndReason,
      });

      await expect(test.dispatcher.control('42', { action: 'cancel' }))
        .resolves.toMatchObject({ kind: field === 'missing' ? 'invalid-transition' : 'unavailable' });
      expect(test.tasks.transition).not.toHaveBeenCalled();
      expect(store.endTaskSessions).not.toHaveBeenCalled();
      expect(test.clientFor).not.toHaveBeenCalled();
      expect(test.untrack).not.toHaveBeenCalled();
    },
  );

  it('rejects pre-start attention when a live target does not match captured absence', async () => {
    const store = { ...idleStore(), getControlTarget: vi.fn(async () => controlTarget) };
    vi.mocked(store.getRuntimeVersion).mockResolvedValue({
      sandboxSessionId: null, foundrySessionId: null, sessionStatus: null, latestTurnId: null,
    });
    const test = harness(store, undefined, {
      ...controlTask, state: 'NeedsAttention', latestSessionEndReason: null,
    });

    await expect(test.dispatcher.control('42', { action: 'cancel' }))
      .resolves.toMatchObject({ kind: 'invalid-transition' });
    expect(test.tasks.transition).not.toHaveBeenCalled();
    expect(store.endTaskSessions).not.toHaveBeenCalled();
    expect(test.clientFor).not.toHaveBeenCalled();
  });

  it('refuses attention cancellation while a policy merge is pending', async () => {
    const store = {
      ...idleStore(),
      getControlTarget: vi.fn(async () => controlTarget),
      hasPendingProjectPolicyMerge: vi.fn(async () => true),
    };
    const test = harness(store, undefined, { ...controlTask, state: 'NeedsAttention' });
    await expect(test.dispatcher.control('42', { action: 'cancel' })).resolves.toMatchObject({ kind: 'invalid-transition' });
    expect(test.cancel).not.toHaveBeenCalled();
    expect(test.transition).not.toHaveBeenCalled();
    expect(store.endTaskSessions).not.toHaveBeenCalled();
    expect(test.deleteSession).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'end', 'delete'] as const)('reports attention %s failure without false success', async (failure) => {
    const onError = vi.fn();
    const store = { ...idleStore(), getControlTarget: vi.fn(async () => controlTarget) };
    const test = harness(store, undefined, { ...controlTask, state: 'NeedsAttention' }, { onError });
    const error = new Error('synthetic cleanup failure');
    if (failure === 'cancel') test.cancel.mockRejectedValue(error);
    if (failure === 'end') vi.mocked(store.endTaskSessions).mockRejectedValue(error);
    if (failure === 'delete') test.deleteSession.mockRejectedValue(error);
    await expect(test.dispatcher.control('42', { action: 'cancel' })).resolves.toEqual({
      kind: 'failed',
      reason: failure === 'cancel'
        ? 'Task runtime could not be reached to cancel the active invocation'
        : 'Task is Cancelled, but sandbox cleanup could not be completed',
    });
    if (failure === 'cancel') {
      expect(test.transition).not.toHaveBeenCalled();
      expect(store.endTaskSessions).not.toHaveBeenCalled();
      expect(test.deleteSession).not.toHaveBeenCalled();
    } else {
      expect(test.deleteSession).toHaveBeenCalledWith('session-1');
      expect(onError).toHaveBeenCalledWith(error);
    }
  });

  it.each(['running', 'queued', 'cancelling', 'unknown', 'failed', 'completed', 'needs_attention'] as const)(
    'refuses a non-cancelled attention acknowledgement (%s)', async (status) => {
      const store = { ...idleStore(), getControlTarget: vi.fn(async () => controlTarget) };
      const test = harness(store, undefined, { ...controlTask, state: 'NeedsAttention' });
      vi.mocked(test.clientFor().cancel).mockResolvedValue({ invocationId: 'invocation-1', status });
      await expect(test.dispatcher.control('42', { action: 'cancel' })).resolves.toMatchObject({ kind: 'failed' });
      expect(test.transition).not.toHaveBeenCalled();
      expect(store.endTaskSessions).not.toHaveBeenCalled();
      expect(test.deleteSession).not.toHaveBeenCalled();
    },
  );

  it('refuses an acknowledgement for a different invocation', async () => {
    const store = { ...idleStore(), getControlTarget: vi.fn(async () => controlTarget) };
    const test = harness(store, undefined, { ...controlTask, state: 'NeedsAttention' });
    test.cancel.mockResolvedValue({ invocationId: 'unrelated-invocation', status: 'cancelled' });
    await expect(test.dispatcher.control('42', { action: 'cancel' })).resolves.toMatchObject({ kind: 'failed' });
    expect(test.transition).not.toHaveBeenCalled();
    expect(test.deleteSession).not.toHaveBeenCalled();
  });

  it('rechecks the owned attention invocation under the policy lock', async () => {
    let locked = false;
    const current = { ...controlTarget, invocationId: 'current-invocation' };
    const store = {
      ...idleStore(),
      getControlTarget: vi.fn(async () => locked ? current : controlTarget),
      withTaskPolicyLock: async <T>(_taskId: string, operation: () => Promise<T>): Promise<T> => {
        locked = true;
        try { return await operation(); }
        finally { locked = false; }
      },
    };
    const test = harness(store, undefined, { ...controlTask, state: 'NeedsAttention' });
    test.cancel.mockImplementation(async (invocationId) => {
      expect(locked).toBe(true);
      return { invocationId, status: 'cancelled' };
    });
    await expect(test.dispatcher.control('42', { action: 'cancel' })).resolves.toMatchObject({ kind: 'ok' });
    expect(test.cancel.mock.calls).toEqual([['current-invocation']]);
    expect(test.deleteSession.mock.calls).toEqual([['session-1']]);
  });

  it('does not cancel a target belonging to another task', async () => {
    const store = { ...idleStore(), getControlTarget: vi.fn(async () => ({ ...controlTarget, taskId: '99' })) };
    const test = harness(store, undefined, { ...controlTask, state: 'NeedsAttention' });
    await expect(test.dispatcher.control('42', { action: 'cancel' })).resolves.toMatchObject({ kind: 'unavailable' });
    expect(test.cancel).not.toHaveBeenCalled();
    expect(test.transition).not.toHaveBeenCalled();
    expect(test.deleteSession).not.toHaveBeenCalled();
  });

  it('rejects attention cancellation when its state changes before the policy lock', async () => {
    const store = { ...idleStore(), getControlTarget: vi.fn(async () => controlTarget) };
    const test = harness(store, undefined, { ...controlTask, state: 'NeedsAttention' });
    vi.mocked(test.tasks.get)
      .mockResolvedValueOnce({ ...controlTask, state: 'NeedsAttention', events: [], usage: [] })
      .mockResolvedValue({ ...controlTask, state: 'Running', events: [], usage: [] });
    await expect(test.dispatcher.control('42', { action: 'cancel' })).resolves.toMatchObject({ kind: 'invalid-transition' });
    expect(test.cancel).not.toHaveBeenCalled();
    expect(test.transition).not.toHaveBeenCalled();
    expect(test.deleteSession).not.toHaveBeenCalled();
  });

  it('does not end or delete a replacement session after the cancellation wait', async () => {
    const store = {
      ...idleStore(),
      getControlTarget: vi.fn(async () => controlTarget),
    };
    const test = harness(store, undefined, { ...controlTask, state: 'NeedsAttention' });
    test.cancel.mockImplementation(async (invocationId) => {
      store.getControlTarget.mockResolvedValue({ ...controlTarget, sandboxSessionId: '99', foundrySessionId: 'replacement' });
      return { invocationId, status: 'cancelled' };
    });
    await expect(test.dispatcher.control('42', { action: 'cancel' })).resolves.toMatchObject({ kind: 'invalid-transition' });
    expect(test.transition).not.toHaveBeenCalled();
    expect(store.endTaskSessions).not.toHaveBeenCalled();
    expect(test.deleteSession).not.toHaveBeenCalled();
  });

  it('requires the attention state atomically at transition and does not clean up if recovery won', async () => {
    const store = { ...idleStore(), getControlTarget: vi.fn(async () => controlTarget) };
    const test = harness(store, undefined, { ...controlTask, state: 'NeedsAttention' });
    vi.mocked(test.tasks.transition).mockResolvedValue({ kind: 'invalid-transition' });
    await expect(test.dispatcher.control('42', { action: 'cancel' })).resolves.toMatchObject({ kind: 'invalid-transition' });
    expect(test.tasks.transition).toHaveBeenCalledWith('42', 'Cancelled', false, undefined, undefined, 'NeedsAttention', {
      sandboxSessionId: '53', foundrySessionId: 'session-1', latestTurnId: '71', sessionStatus: 'Active',
    });
    expect(store.endTaskSessions).not.toHaveBeenCalled();
    expect(test.deleteSession).not.toHaveBeenCalled();
  });

  it.each(['missing', 'session', 'runtime', 'status', 'turn'] as const)(
    'rejects an incoherent attention snapshot (%s) before runtime side effects', async (change) => {
      const store = { ...idleStore(), getControlTarget: vi.fn(async () => controlTarget) };
      vi.mocked(store.getRuntimeVersion).mockResolvedValue(change === 'missing' ? null : {
        sandboxSessionId: change === 'session' ? '99' : '53',
        foundrySessionId: change === 'runtime' ? 'replacement' : 'session-1',
        sessionStatus: change === 'status' ? 'Ended' : 'Active',
        latestTurnId: change === 'turn' ? '100' : '71',
      });
      const test = harness(store, undefined, { ...controlTask, state: 'NeedsAttention' });
      await expect(test.dispatcher.control('42', { action: 'cancel' }))
        .resolves.toMatchObject({ kind: 'invalid-transition' });
      expect(test.cancel).not.toHaveBeenCalled();
      expect(test.transition).not.toHaveBeenCalled();
      expect(store.endTaskSessions).not.toHaveBeenCalled();
      expect(test.deleteSession).not.toHaveBeenCalled();
    },
  );

  it.each(['Starting', 'Active', 'Idle'] as const)(
    'rejects an absent control target if its captured runtime is still %s', async (sessionStatus) => {
      const store = idleStore();
      vi.mocked(store.getRuntimeVersion).mockResolvedValue({
        sandboxSessionId: '99', foundrySessionId: 'replacement', sessionStatus, latestTurnId: '100',
      });
      const test = harness(store, undefined, {
        ...controlTask, state: 'NeedsAttention', latestSessionEndReason: 'idle_expired',
      });
      await expect(test.dispatcher.control('42', { action: 'cancel' }))
        .resolves.toMatchObject({ kind: 'invalid-transition' });
      expect(test.clientFor).not.toHaveBeenCalled();
      expect(test.transition).not.toHaveBeenCalled();
      expect(store.endTaskSessions).not.toHaveBeenCalled();
    },
  );

  it.each(['pause', 'resume', 'steer'] as const)('does not enable %s for an active attention task', async (action) => {
    const store = { ...idleStore(), getControlTarget: vi.fn(async () => controlTarget) };
    const test = harness(store, undefined, { ...controlTask, state: 'NeedsAttention' });
    await expect(test.dispatcher.control('42', action === 'steer' ? { action, message: 'Synthetic' } : { action }))
      .resolves.toMatchObject({ kind: 'invalid-transition' });
    expect(test.clientFor).not.toHaveBeenCalled();
    expect(test.transition).not.toHaveBeenCalled();
  });

  it('serializes running-task cancellation with project-policy merges', async () => {
    const sequence: string[] = [];
    const store = {
      ...idleStore(),
      getControlTarget: vi.fn(async () => controlTarget),
      withTaskPolicyLock: vi.fn(async (_taskId: string, operation: () => Promise<unknown>) => {
        sequence.push('lock-start');
        const result = await operation();
        sequence.push('lock-end');
        return result;
      }),
    };
    const { dispatcher, cancel, transition } = harness(store);
    cancel.mockImplementation(async (invocationId) => {
      sequence.push('cancel');
      return { invocationId, status: 'cancelled' as const };
    });
    transition.mockImplementation(async (_taskId, state) => {
      sequence.push('transition');
      return { kind: 'ok' as const, task: { ...controlTask, state } };
    });

    await dispatcher.control('42', { action: 'cancel' });

    expect(sequence).toEqual(['lock-start', 'cancel', 'transition', 'lock-end']);
  });

  it('refuses cancellation while an accepted merge awaits its signed webhook', async () => {
    const store = {
      ...idleStore(),
      getControlTarget: vi.fn(async () => controlTarget),
      hasPendingProjectPolicyMerge: vi.fn(async () => true),
    };
    const { dispatcher, cancel, transition } = harness(store);

    await expect(dispatcher.control('42', { action: 'cancel' })).resolves.toEqual({
      kind: 'invalid-transition', reason: 'Delivery is finishing; try again when it completes',
    });

    expect(cancel).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
  });

  it('reports a failed Foundry session deletion after cancelling the task', async () => {
    const pausedTarget = { ...controlTarget, sessionStatus: 'Idle' as const };
    const store = {
      ...idleStore(),
      getControlTarget: vi.fn(async () => pausedTarget),
    };
    const { dispatcher, deleteSession, transition } = harness(store, undefined, { ...controlTask, state: 'Paused' });
    deleteSession.mockRejectedValue(new Error('Foundry unavailable'));

    await expect(dispatcher.control('42', { action: 'cancel' })).resolves.toEqual({
      kind: 'failed', reason: 'Task is Cancelled, but sandbox cleanup could not be completed',
    });

    expect(transition).toHaveBeenCalledWith('42', 'Cancelled');
    expect(store.endTaskSessions).toHaveBeenCalledWith('42', 'Cancelled');
  });

  it('cancels a Ready task without contacting Foundry and rejects disallowed states', async () => {
    const store = idleStore();
    const readyHarness = harness(store, undefined, { ...controlTask, state: 'Ready' });
    const result = await readyHarness.dispatcher.control('42', { action: 'cancel' });
    expect(result).toMatchObject({ kind: 'ok', task: { state: 'Cancelled' } });
    expect(readyHarness.cancel).not.toHaveBeenCalled();

    const doneHarness = harness(store, undefined, { ...controlTask, state: 'Done' });
    expect(await doneHarness.dispatcher.control('42', { action: 'pause' }))
      .toEqual({ kind: 'invalid-transition', reason: 'Task is already Done' });
  });

  it.each([null, { ...controlTarget, invocationId: '' }])(
    'cancels a finishing task without cancelling a completed invocation (%s)', async (target) => {
      const store = { ...idleStore(), getControlTarget: vi.fn(async () => target) };
      const { dispatcher, cancel, transition } = harness(store, undefined, {
        ...controlTask, latestSessionEndReason: 'done',
      });
      await expect(dispatcher.control('42', { action: 'cancel' }))
        .resolves.toMatchObject({ kind: 'ok', task: { state: 'Cancelled' } });
      expect(cancel).not.toHaveBeenCalled();
      expect(transition).toHaveBeenCalledWith('42', 'Cancelled');
      expect(store.endTaskSessions).toHaveBeenCalledWith('42', 'Cancelled');
    },
  );

  it.each(['cancel', 'pause', 'steer'] as const)('explains finishing delivery for %s while a merge is pending', async (action) => {
    const store = { ...idleStore(), hasPendingProjectPolicyMerge: vi.fn(async () => true) };
    const { dispatcher, cancel, pause, steer, transition } = harness(store);
    await expect(dispatcher.control('42', action === 'steer' ? { action, message: 'Stop' } : { action }))
      .resolves.toEqual({ kind: 'invalid-transition', reason: 'Delivery is finishing; try again when it completes' });
    expect(cancel).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    expect(steer).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
  });

  it('pauses a finishing task without contacting its completed invocation', async () => {
    const store = { ...idleStore(), getControlTarget: vi.fn(async () => ({ ...controlTarget, invocationId: '' })) };
    const { dispatcher, pause, cancel, transition } = harness(store);
    await expect(dispatcher.control('42', { action: 'pause' }))
      .resolves.toMatchObject({ kind: 'ok', task: { state: 'Paused' } });
    expect(transition.mock.calls.map(([, state]) => state)).toEqual(['PauseRequested', 'Paused']);
    expect(pause).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(store.endTaskSessions).toHaveBeenCalledWith('42', 'Paused');
  });

  it('refuses pause of an ended finishing session rather than creating an unresumable task', async () => {
    const store = idleStore();
    const { dispatcher, transition } = harness(store, undefined, { ...controlTask, latestSessionEndReason: 'done' });
    await expect(dispatcher.control('42', { action: 'pause' })).resolves.toEqual({
      kind: 'invalid-transition', reason: 'Delivery is finishing; try again when it completes',
    });
    expect(transition).not.toHaveBeenCalled();
    expect(store.endTaskSessions).not.toHaveBeenCalled();
  });

  it('reports unreachable cancellation without changing state or exposing provider errors', async () => {
    const store = { ...idleStore(), getControlTarget: vi.fn(async () => controlTarget) };
    const { dispatcher, cancel, transition } = harness(store);
    cancel.mockRejectedValue(new Error('private provider response'));
    await expect(dispatcher.control('42', { action: 'cancel' })).resolves.toEqual({
      kind: 'failed', reason: 'Task runtime could not be reached to cancel the active invocation',
    });

    expect(transition).not.toHaveBeenCalled();
    expect(store.endTaskSessions).not.toHaveBeenCalled();
  });

  it('reports missing runtime evidence accurately rather than claiming delivery is complete', async () => {
    const { dispatcher, transition } = harness(idleStore());
    await expect(dispatcher.control('42', { action: 'cancel' })).resolves.toEqual({
      kind: 'unavailable', reason: 'No task runtime session or completed delivery evidence could be found',
    });
    expect(transition).not.toHaveBeenCalled();
  });

  it('rechecks the active turn under the policy lock before cancelling its invocation', async () => {
    const store = {
      ...idleStore(),
      getControlTarget: vi.fn()
        .mockResolvedValueOnce(controlTarget)
        .mockResolvedValue({ ...controlTarget, invocationId: null }),
    };
    const { dispatcher, cancel } = harness(store);
    await expect(dispatcher.control('42', { action: 'cancel' }))
      .resolves.toMatchObject({ kind: 'ok', task: { state: 'Cancelled' } });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('allows cancellation with an open PR and an already-ended session', async () => {
    const { dispatcher, cancel } = harness(idleStore(), undefined, {
      ...controlTask, pullRequest: { number: 1, url: 'https://github.com/DanAakesen/jarvis/pull/1', state: 'open' },
    });
    await expect(dispatcher.control('42', { action: 'cancel' }))
      .resolves.toMatchObject({ kind: 'ok', task: { state: 'Cancelled' } });
    expect(cancel).not.toHaveBeenCalled();
  });

  it.each(['Done', 'Cancelled'] as const)('rejects repeated cancellation with terminal state %s', async (state) => {
    const store = idleStore();
    const { dispatcher, transition } = harness(store, undefined, { ...controlTask, state });
    await expect(dispatcher.control('42', { action: 'cancel' })).resolves.toEqual({
      kind: 'invalid-transition', reason: `Task is already ${state}`,
    });
    expect(store.getControlTarget).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
  });
});

describe('task crash recovery', () => {
  it('skips delivery when cancellation already changed the task state', async () => {
    const recoveryStore: TaskRecoveryStore = {
      getRunningTaskForSession: vi.fn(async () => '42'),
      claimRecovery: vi.fn(async () => ({ kind: 'invalid-transition' })),
    };
    const cancelledTask = { ...controlTask, state: 'Cancelled' as const };
    const tasks = {
      get: vi.fn(async () => ({ ...cancelledTask, events: [], usage: [] })),
      transition: vi.fn(),
      recordEvent: vi.fn(),
    } as unknown as TaskStore;
    const lock = vi.fn(async (_taskId: string, operation: () => Promise<unknown>) => operation());
    const store = { ...idleStore(), withTaskPolicyLock: lock };
    const settings: SettingsStore = { read: vi.fn(async () => ({})), write: vi.fn(async () => {}) };
    let completionHandler: ((sandbox: {
      sandboxSessionId: string;
      executionGeneration: string;
      foundrySessionId: string;
      agentName: string;
      invocationId: string;
    }) => Promise<boolean>) | undefined;
    const heartbeat = {
      setCompletionHandler: vi.fn((handler: typeof completionHandler) => { completionHandler = handler; }),
      untrack: vi.fn(),
    } as unknown as SandboxHeartbeat;
    const verifyDelivery = vi.fn(async () => ({ kind: 'awaiting_policy' as const }));
    new TaskDispatcher(
      store,
      tasks,
      settings,
      () => ({ startTask: vi.fn(), steer: vi.fn(), pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(), deleteSession: vi.fn() }),
      heartbeat,
      createEventHub<TaskEventMessage>(),
      {
        recoveryStore,
        workspaceFor: vi.fn(async () => ({
          repository: 'DanAakesen/jarvis',
          defaultBranch: 'main',
          branch: 'jarvis/task-42',
        })),
        verifyDelivery,
      },
    );

    await expect(completionHandler?.({
      sandboxSessionId: '53',
      executionGeneration: '1',
      foundrySessionId: 'session-1',
      agentName: 'runner',
      invocationId: 'invocation-1',
    })).resolves.toBe(true);

    expect(lock).not.toHaveBeenCalled();
    expect(tasks.get).toHaveBeenCalledOnce();
    expect(verifyDelivery).not.toHaveBeenCalled();
  });

  it.each(['recover', 'steer'] as const)(
    'continues an idle-expired Running task via %s in a new sandbox on its existing branch',
    async (action) => {
    const idleExpiredTask: TaskRecord = {
      ...controlTask, state: 'Running', latestSessionEndReason: 'idle_expired',
    };
    const recoveryStore: TaskRecoveryStore = {
      getRunningTaskForSession: vi.fn(async () => null),
      claimRecovery: vi.fn(async () => ({ kind: 'claimed', task })),
    };
    const startTask = vi.fn(async () => ({
      invocationId: 'continued-invocation',
      sessionId: 'continued-session',
      status: 'queued' as const,
      agent: 'codex' as const,
    }));
    const { dispatcher, transition, track, tasks, steer } = harness(idleStore(), startTask, idleExpiredTask, {
      recoveryStore,
      workspaceFor: vi.fn(async (current) => ({
        repository: 'DanAakesen/jarvis',
        defaultBranch: 'main',
        branch: current.branch!,
      })),
    });

    await expect(dispatcher.control('42', action === 'steer'
      ? { action, message: 'Keep the existing API.' }
      : { action }))
      .resolves.toMatchObject({ kind: 'ok', task: { state: 'Running' } });

    expect(transition).toHaveBeenCalledWith('42', 'NeedsAttention');
    expect(recoveryStore.claimRecovery).toHaveBeenCalledOnce();
    expect(startTask).toHaveBeenCalledWith(expect.objectContaining({
      repository: 'DanAakesen/jarvis',
      defaultBranch: 'main',
      branch: idleExpiredTask.branch,
      taskId: '42',
    }));
    expect(steer).not.toHaveBeenCalled();
    if (action === 'steer') {
      expect(startTask).toHaveBeenCalledWith(expect.objectContaining({
        task: expect.stringContaining('New steering message:\nKeep the existing API.'),
      }));
      expect(tasks.recordEvent).toHaveBeenCalledWith({
        taskId: '42', type: 'steered', summary: 'Keep the existing API.',
        payload: { message: 'Keep the existing API.' }, source: 'dan',
      });
    }
    expect(track).toHaveBeenCalledWith(expect.objectContaining({
      invocationId: 'continued-invocation',
      foundrySessionId: 'continued-session',
    }));
  });

  it.each([true, false])('restarts a crashed task from its branch and gates completion on GitHub evidence (%s)', async (deliveryVerified) => {
    vi.useFakeTimers();
    let state: TaskRecord['state'] = 'Running';
    const branch = 'jarvis/task-42';
    const record: TaskRecord = { ...controlTask, branch };
    const timeline = [
      {
        id: '1', type: 'steered', summary: 'Keep the API compatible.',
        payload: { message: 'Keep the API compatible.' }, payloadTruncated: false,
        source: 'dan' as const, at: '2026-10-04T12:00:00.000Z',
      },
      {
        id: '2', type: 'agent_output', summary: 'The branch contains the initial fix.',
        payload: null, payloadTruncated: false, source: 'runner' as const, at: '2026-10-04T12:01:00.000Z',
      },
    ];
    const events = createEventHub<TaskEventMessage>();
    const publishState = (from: TaskRecord['state'], to: TaskRecord['state'], reason?: string) => events.publish({
      id: String(Date.now()), taskId: '42', type: 'state_changed',
      summary: 'Task state changed', payload: { from, to, ...(reason ? { reason } : {}) }, payloadTruncated: false,
      source: 'backend', at: '2026-10-04T12:02:00.000Z',
    });
    let target: TaskControlTarget = {
      ...controlTarget, taskId: '42', sandboxSessionId: 'old-sandbox',
      foundrySessionId: 'old-session', invocationId: 'old-invocation',
    };
    const activeTasks = {
      get: vi.fn(async () => ({ ...record, state, events: timeline, usage: [] })),
      list: vi.fn(async () => state === 'Running' ? [{ ...record, state }] : []),
      recordEvent: vi.fn(async () => ({ id: '3' } as never)),
      transition: vi.fn(async (
        _id: string,
        next: TaskRecord['state'],
        completionVerified = false,
        eventReason?: string,
      ) => {
        if (next === 'Done' && !completionVerified) return { kind: 'invalid-transition' as const };
        const previous = state;
        state = next;
        publishState(previous, next, eventReason);
        return { kind: 'ok' as const, task: { ...record, state } };
      }),
    } as unknown as TaskStore;
    const store: DispatcherStore = {
      ...idleStore(),
      getControlTarget: vi.fn(async () => target),
      recordStarted: vi.fn(async (_owner, _task, runnerName, accepted) => {
        target = {
          ...controlTarget,
          taskId: '42',
          sandboxSessionId: 'recovered-sandbox',
          foundrySessionId: accepted.sessionId,
          agentName: runnerName,
          invocationId: accepted.invocationId,
        };
        return 'recovered-sandbox';
      }),
      endTaskSessions: vi.fn(async () => [target.sandboxSessionId]),
    };
    const recoveryStore: TaskRecoveryStore = {
      getRunningTaskForSession: vi.fn(async () => '42'),
      claimRecovery: vi.fn(async () => {
        state = 'Running';
        publishState('NeedsAttention', 'Running');
        return { kind: 'claimed', task };
      }),
    };
    const startedRequests: unknown[] = [];
    const startTask = vi.fn(async (request: unknown) => {
      startedRequests.push(request);
      return {
        invocationId: 'recovered-invocation',
        sessionId: 'recovered-session',
        status: 'queued' as const,
        agent: 'codex' as const,
      };
    });
    const settings: SettingsStore = { read: vi.fn(async () => ({})), write: vi.fn(async () => {}) };
    let statusCount = 0;
    const heartbeatStore = {
      listRunning: vi.fn(async () => [{
        executionGeneration: '1',
        sandboxSessionId: 'old-sandbox', foundrySessionId: 'old-session',
        agentName: 'jarvis-runner-base-1x2', invocationId: 'old-invocation',
      }]),
      recordHeartbeat: vi.fn(async () => {}),
      markNeedsAttention: vi.fn(async () => {
        state = 'NeedsAttention';
        publishState('Running', 'NeedsAttention');
        return 'crashed' as const;
      }),
      resolvePause: vi.fn(async () => false),
    };
    const heartbeat = new SandboxHeartbeat(
      heartbeatStore,
      () => ({
        status: vi.fn(async (invocationId: string) => {
          if (invocationId === 'old-invocation') {
            statusCount += 1;
            throw new FoundryClientError('http', 'status', 404);
          }
          return {
            invocationId: 'recovered-invocation',
            sessionId: 'recovered-session',
            status: 'completed' as const,
            workCompleted: true,
            providerStopped: true,
            workCommitSha: 'a'.repeat(40),
            agent: 'codex' as const,
            startedAt: 1,
            finishedAt: 2,
            events: [],
            result: null,
            error: null,
          };
        }),
      }),
      { intervalMs: 60_000, failureConfirmMs: 30 },
    );
    const verifyDelivery = vi.fn(async () => deliveryVerified
      ? { kind: 'awaiting_policy' as const }
      : { kind: 'refused' as const, reason: 'GitHub could not open the task pull request.' });
    const options: DispatcherOptions = {
      recoveryStore,
      workspaceFor: vi.fn(async (current) => ({
        repository: 'DanAakesen/jarvis',
        defaultBranch: 'main',
        branch: current.branch!,
      })),
      verifyDelivery,
    };
    const dispatcher = new TaskDispatcher(
      store, activeTasks, settings,
      () => ({
        startTask, steer: vi.fn(), pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(), deleteSession: vi.fn(),
        status: vi.fn(async () => invocationSnapshot('running')),
      }),
      heartbeat, events, options,
    );

    dispatcher.start();
    await heartbeat.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30);
    expect(statusCount).toBe(2);
    expect(state).toBe('NeedsAttention');

    await expect(dispatcher.control('42', { action: 'recover' }))
      .resolves.toMatchObject({ kind: 'ok', task: { state: 'Running' } });
    await vi.advanceTimersByTimeAsync(0);

    expect(startTask).toHaveBeenCalledOnce();
    expect(startedRequests[0]).toMatchObject({
      repository: 'DanAakesen/jarvis',
      defaultBranch: 'main',
      branch,
      taskId: '42',
    });
    expect((startedRequests[0] as { task: string }).task).toContain('Original task:\nFind and fix it');
    expect((startedRequests[0] as { task: string }).task).toContain('Keep the API compatible.');
    expect((startedRequests[0] as { task: string }).task).toContain('The branch contains the initial fix.');
    expect(verifyDelivery).toHaveBeenCalledWith({
      repository: 'DanAakesen/jarvis', defaultBranch: 'main', branch,
    }, expect.objectContaining({ id: '42', title: 'Fix the bug' }), expect.any(Function));
    expect(state).toBe(deliveryVerified ? 'Running' : 'NeedsAttention');
    if (deliveryVerified) {
      expect(activeTasks.transition).not.toHaveBeenCalled();
    } else {
      expect(activeTasks.transition).toHaveBeenCalledWith('42', 'NeedsAttention', false, 'pull_request_open_refused');
      expect(activeTasks.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: 'pull_request_open_refused',
        summary: 'GitHub could not open the task pull request.',
        payload: { reason: 'GitHub could not open the task pull request.' },
      }));
      const refusalCleanup = vi.mocked(store.endTaskSessions).mock.calls
        .filter(([id, sessionState]) => id === '42' && sessionState === 'NeedsAttention');
      expect(refusalCleanup.slice(-2).map(([, , invocationCompleted]) => invocationCompleted)).toEqual([true, true]);
    }
    expect(store.endTaskSessions).toHaveBeenCalledWith(
      '42',
      deliveryVerified ? 'Done' : 'NeedsAttention',
      true,
    );

    await Promise.all([dispatcher.stop(), heartbeat.stop()]);
  });

  it('reconciles a lost completion event and preserves a valid awaiting-policy state', async () => {
    vi.useFakeTimers();
    const decisions: unknown[] = [];
    const test = reconciliationHarness('completed', undefined, (decision) => decisions.push(decision));
    const { dispatcher } = test;

    dispatcher.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(test.status).toHaveBeenCalledWith('invocation-1', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(test.store.recordHeartbeat).toHaveBeenCalledWith('53', 'invocation-1', true);
    expect(test.tasks.recordEvent).toHaveBeenCalledWith({
      taskId: '42',
      type: 'runner_completion_verified',
      summary: 'Backend verified the current runner reached its final completed state',
      payload: {
        executionGeneration: '1',
        sandboxSessionId: '53', foundrySessionId: 'session-1', invocationId: 'invocation-1',
        workCommitSha: 'a'.repeat(40),
      },
      source: 'backend',
    });
    expect(vi.mocked(test.tasks.recordEvent).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(test.verifyDelivery!).mock.invocationCallOrder[0]!);
    expect(test.verifyDelivery).toHaveBeenCalledWith(
      { repository: 'DanAakesen/jarvis-test-target', defaultBranch: 'main', branch: 'jarvis/task-42' },
      expect.objectContaining({ id: '42', title: 'Fix the bug' }),
      expect.any(Function),
    );
    expect(test.tasks.transition).not.toHaveBeenCalled();
    expect(test.store.endTaskSessions).toHaveBeenCalledWith('42', 'Done', true);
    await expect(test.tasks.get('42', 1, 0)).resolves.toMatchObject({ state: 'Running' });
    expect(decisions).toContainEqual(expect.objectContaining({
      taskId: '42', status: 'completed', decision: 'awaiting_policy',
    }));
    await dispatcher.stop();
  });

  it('moves a completed task to NeedsAttention when delivery is unavailable', async () => {
    vi.useFakeTimers();
    const refusal = 'The task repository or branch could not be verified.';
    const test = reconciliationHarness('completed', null, undefined, 'Ended', true, false);

    test.dispatcher.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(test.verifyDelivery).toBeNull();
    expect(test.tasks.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'pull_request_open_refused',
      summary: refusal,
      payload: { reason: refusal },
    }));
    expect(test.tasks.transition).toHaveBeenCalledWith('42', 'NeedsAttention', false, 'pull_request_open_refused');
    await test.dispatcher.stop();
  });

  it.each(['missing', 'malformed'] as const)(
    'holds an unbound completed invocation without manufacturing proof: %s', async (control) => {
      vi.useFakeTimers();
      const test = reconciliationHarness('completed');
      const snapshot = invocationSnapshot('completed');
      if (control === 'missing') delete snapshot.workCommitSha;
      else snapshot.workCommitSha = 'not-a-commit';
      test.status.mockResolvedValue(snapshot);
      test.dispatcher.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(test.verifyDelivery).not.toHaveBeenCalled();
      expect(test.tasks.recordEvent).not.toHaveBeenCalledWith(expect.objectContaining({
        type: 'runner_completion_verified',
      }));
      expect(test.tasks.transition).toHaveBeenCalledWith(
        '42', 'NeedsAttention', false, 'unverified_completion', expect.stringContaining('commit-bound'),
      );
      expect(test.store.endTaskSessions).toHaveBeenCalledWith('42', 'NeedsAttention', true);
      await test.dispatcher.stop();
    },
  );

  it.each(['heartbeat', 'reconciliation'] as const)(
    'preserves unverified completed lifecycle in explicit and event cleanup: %s', async (route) => {
      vi.useFakeTimers();
      const test = reconciliationHarness('completed');
      const snapshot = invocationSnapshot('completed');
      delete snapshot.workCommitSha;
      test.status.mockResolvedValue(snapshot);
      if (route === 'heartbeat') vi.mocked(test.store.listStaleRunning).mockResolvedValue([]);
      const transition = vi.mocked(test.tasks.transition).getMockImplementation();
      if (!transition) throw new Error('Transition fixture is unavailable');
      vi.mocked(test.tasks.transition).mockImplementation(async (...args) => {
        const result = await transition(...args);
        if (result.kind === 'ok') test.events.publish({
          id: 'unverified-transition', taskId: args[0], type: 'state_changed',
          summary: 'Task state changed', source: 'backend', at: new Date().toISOString(),
          payload: { from: 'Running', to: args[1], reason: args[3] },
          payloadTruncated: false,
        });
        return result;
      });
      test.dispatcher.start();
      await vi.advanceTimersByTimeAsync(0);
      if (route === 'heartbeat') {
        const onCompleted = vi.mocked(test.heartbeat.setCompletionHandler).mock.calls[0]?.[0];
        if (!onCompleted) throw new Error('Completion fixture is unavailable');
        await expect(onCompleted(controlTarget)).resolves.toBe(true);
      }
      const cleanup = vi.mocked(test.store.endTaskSessions).mock.calls
        .filter(([taskId, state]) => taskId === '42' && state === 'NeedsAttention');
      expect(cleanup).toHaveLength(2);
      expect(cleanup.map(([, , invocationCompleted]) => invocationCompleted)).toEqual([true, true]);
      expect(test.verifyDelivery).not.toHaveBeenCalled();
      expect(test.tasks.recordEvent).not.toHaveBeenCalledWith(expect.objectContaining({
        type: 'runner_completion_verified',
      }));
      await expect(test.tasks.get('42', 1, 0)).resolves.toMatchObject({ state: 'NeedsAttention' });
      await test.dispatcher.stop();
    },
  );

  it('uses current-generation stopped-writer proof without bypassing GitHub or project policy', async () => {
    vi.useFakeTimers();
    const test = reconciliationHarness('failed');
    test.status.mockResolvedValue({
      ...invocationSnapshot('failed'), workCompleted: true, providerStopped: true,
      error: 'Runner finalization timed out: credential_persist', cleanupPhases: ['credential_persist'],
    });
    test.dispatcher.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(test.tasks.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'runner_completion_verified', source: 'backend',
      payload: {
        executionGeneration: '1', sandboxSessionId: '53', foundrySessionId: 'session-1',
        invocationId: 'invocation-1', completionKind: 'work_completed_writer_stopped',
        workCommitSha: 'a'.repeat(40),
        cleanupPhases: ['credential_persist'],
      },
    }));
    expect(test.verifyDelivery).toHaveBeenCalledOnce();
    expect(test.verifyDelivery).toHaveBeenCalledWith(
      expect.any(Object), expect.objectContaining({ workCommitSha: 'a'.repeat(40) }), expect.any(Function),
    );
    expect(test.tasks.transition).not.toHaveBeenCalled();
    expect(test.store.endTaskSessions).toHaveBeenCalledWith('42', 'Done', true);
    await test.dispatcher.stop();
  });

  it('preserves delivered-work proof but refuses Done when GitHub cannot verify the artifact', async () => {
    vi.useFakeTimers();
    const test = reconciliationHarness('failed', vi.fn(async () => ({
      kind: 'refused', reason: 'The current branch could not be verified.',
    })));
    test.status.mockResolvedValue({
      ...invocationSnapshot('failed'), workCompleted: true, providerStopped: true,
      error: 'Runner finalization timed out: publisher_close', cleanupPhases: ['publisher_close'],
    });
    test.dispatcher.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(test.verifyDelivery).toHaveBeenCalledOnce();
    expect(test.tasks.transition).toHaveBeenCalledWith('42', 'NeedsAttention', false, 'pull_request_open_refused');
    expect(test.store.endTaskSessions).not.toHaveBeenCalledWith('42', 'Done', true);
    await test.dispatcher.stop();
  });

  it('rejects stopped-writer proof from an obsolete execution before recording or using it', async () => {
    vi.useFakeTimers();
    const test = reconciliationHarness('failed');
    test.status.mockResolvedValue({
      ...invocationSnapshot('failed'), workCompleted: true, providerStopped: true,
      error: 'Runner finalization timed out: event_delivery', cleanupPhases: ['event_delivery'],
    });
    vi.mocked(test.store.isCurrentStaleTask).mockResolvedValue(false);
    test.dispatcher.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(test.tasks.recordEvent).not.toHaveBeenCalled();
    expect(test.verifyDelivery).not.toHaveBeenCalled();
    expect(test.tasks.transition).not.toHaveBeenCalled();
    await test.dispatcher.stop();
  });

  it('wakes one idle reconciliation from the persisted expiry event with no tracked session', async () => {
    vi.useFakeTimers();
    const test = reconciliationHarness('completed', undefined, undefined, 'Ended', true);
    vi.mocked(test.store.listStaleRunning).mockResolvedValueOnce([]);

    test.dispatcher.start();
    await vi.advanceTimersByTimeAsync(0);
    test.untrack('53');
    expect(test.heartbeat.hasTrackedSessions()).toBe(false);
    expect(test.store.listStaleRunning).toHaveBeenCalledOnce();

    test.events.publish({
      id: 'expiry-1', taskId: '42', type: 'sandbox_idle_expired', summary: null,
      payload: { reason: 'idle_expired', invocationId: 'invocation-1' },
      payloadTruncated: false, source: 'backend', at: new Date().toISOString(),
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(test.store.listStaleRunning).toHaveBeenCalledTimes(2);
    expect(test.status).toHaveBeenCalledOnce();
    expect(test.verifyDelivery).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(test.store.listStaleRunning).toHaveBeenCalledTimes(2);
    await test.dispatcher.stop();
  });

  it('drains eleven coalesced idle expiries without revisiting awaiting-policy rows', async () => {
    vi.useFakeTimers();
    const test = pagedReconciliationHarness(11);
    vi.mocked(test.store.listStaleRunning).mockResolvedValueOnce([]);
    test.dispatcher.start();
    await vi.advanceTimersByTimeAsync(0);
    test.rows.forEach(({ taskId }) => test.expire(taskId));
    await vi.advanceTimersByTimeAsync(25);

    expect(test.heartbeat.hasTrackedSessions()).toBe(false);
    expect(test.status.mock.calls.map(([id]) => id)).toEqual(test.rows.map(({ invocationId }) => invocationId));
    expect(test.store.listStaleRunning).toHaveBeenCalledTimes(4);
    expect(test.errors).toEqual([]);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(test.store.listStaleRunning).toHaveBeenCalledTimes(4);
    await test.dispatcher.stop();
  });

  it('advances past five failed rows instead of starving later idle expiries', async () => {
    vi.useFakeTimers();
    const test = pagedReconciliationHarness(8);
    let failLocks = true;
    test.store.withTaskPolicyLock = async (taskId, operation) => {
      if (failLocks && BigInt(taskId) < 105n) throw new Error('Synthetic policy lock failure');
      return operation();
    };
    test.dispatcher.start();
    await vi.advanceTimersByTimeAsync(25);

    expect(test.status.mock.calls.map(([id]) => id)).toEqual(test.rows.map(({ invocationId }) => invocationId));
    expect(test.errors).toHaveLength(5);
    expect(test.tasks.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      taskId: '107', type: 'runner_completion_verified',
    }));
    expect(test.store.listStaleRunning).toHaveBeenCalledTimes(2);
    failLocks = false;
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 25);
    expect(test.status).toHaveBeenCalledTimes(16);
    expect(test.store.listStaleRunning).toHaveBeenCalledTimes(4);
    expect(test.errors).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(test.store.listStaleRunning).toHaveBeenCalledTimes(4);
    await test.dispatcher.stop();
  });

  it('rescans an earlier task that expires while a later page is in flight', async () => {
    vi.useFakeTimers();
    const test = pagedReconciliationHarness(7);
    test.eligible.delete('100');
    vi.mocked(test.store.listStaleRunning).mockResolvedValueOnce([]);
    let release: ((snapshot: InvocationSnapshot) => void) | undefined;
    test.status.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    test.dispatcher.start();
    await vi.advanceTimersByTimeAsync(0);
    test.expire('101');
    await vi.advanceTimersByTimeAsync(0);
    expect(test.status).toHaveBeenCalledTimes(5);
    test.eligible.add('100');
    test.expire('100');
    release?.(test.snapshot(test.rows[1]!.invocationId));
    await vi.advanceTimersByTimeAsync(25);

    for (const row of test.rows) {
      expect(test.status).toHaveBeenCalledWith(row.invocationId, expect.any(Object));
    }
    expect(test.errors).toEqual([]);
    const scans = vi.mocked(test.store.listStaleRunning).mock.calls.length;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(test.store.listStaleRunning).toHaveBeenCalledTimes(scans);
    await test.dispatcher.stop();
  });

  it('retries a failed idle scan at the existing interval without a hot loop', async () => {
    vi.useFakeTimers();
    const test = pagedReconciliationHarness(8);
    vi.mocked(test.store.listStaleRunning).mockRejectedValueOnce(new Error('Synthetic SQL outage'));
    test.dispatcher.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(test.store.listStaleRunning).toHaveBeenCalledOnce();
    expect(test.errors).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4 * 60_000 + 25);
    expect(test.status).toHaveBeenCalledTimes(8);
    expect(test.store.listStaleRunning).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(test.store.listStaleRunning).toHaveBeenCalledTimes(3);
    await test.dispatcher.stop();
  });

  it('does not schedule the next backlog page after stopping', async () => {
    vi.useFakeTimers();
    const test = pagedReconciliationHarness(8);
    let release: ((snapshot: InvocationSnapshot) => void) | undefined;
    test.status.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    test.dispatcher.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(test.status).toHaveBeenCalledTimes(5);
    const stopping = test.dispatcher.stop();
    release?.(test.snapshot(test.rows[0]!.invocationId));
    await stopping;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(test.store.listStaleRunning).toHaveBeenCalledOnce();
    expect(test.status).toHaveBeenCalledTimes(5);
  });

  it.each([
    ['cancelled', 'Cancelled' as const],
    ['recovered into a newer invocation', 'Running' as const],
  ])('ignores a late completed result after the task is %s', async (_race, state) => {
    vi.useFakeTimers();
    const test = reconciliationHarness('completed');
    let finishStatus: ((snapshot: InvocationSnapshot) => void) | undefined;
    test.status.mockImplementationOnce(() => new Promise((resolve) => { finishStatus = resolve; }));

    test.dispatcher.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(test.status).toHaveBeenCalledOnce();
    if (state === 'Cancelled') {
      await test.tasks.transition('42', state);
    } else {
      await test.tasks.transition('42', 'NeedsAttention');
      await test.tasks.transition('42', 'Running');
    }
    vi.mocked(test.store.isCurrentStaleTask).mockResolvedValue(false);
    finishStatus?.(invocationSnapshot('completed'));
    await test.dispatcher.stop();

    expect(test.verifyDelivery).not.toHaveBeenCalled();
    expect(test.tasks.recordEvent).not.toHaveBeenCalled();
    expect(test.tasks.transition).toHaveBeenCalledTimes(state === 'Cancelled' ? 1 : 2);
    expect(test.store.recordHeartbeat).not.toHaveBeenCalled();
  });

  it('leaves an active runner Running and refreshes its heartbeat on startup and schedule', async () => {
    vi.useFakeTimers();
    const test = reconciliationHarness('running');

    test.dispatcher.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(test.store.listStaleRunning).toHaveBeenCalledOnce();
    expect(test.store.recordHeartbeat).toHaveBeenCalledWith('53', 'invocation-1', false);
    expect(test.verifyDelivery).not.toHaveBeenCalled();
    expect(test.tasks.recordEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'runner_completion_verified',
    }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(test.store.listStaleRunning).toHaveBeenCalledTimes(2);
    expect(test.status).toHaveBeenCalledTimes(2);
    await expect(test.tasks.get('42', 1, 0)).resolves.toMatchObject({ state: 'Running' });
    await test.dispatcher.stop();
  });

  it('moves a stale task with a failed runner to NeedsAttention with a visible reason', async () => {
    vi.useFakeTimers();
    const test = reconciliationHarness('failed');

    test.dispatcher.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(test.verifyDelivery).not.toHaveBeenCalled();
    expect(test.tasks.recordEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'runner_completion_verified',
    }));
    expect(test.tasks.transition).toHaveBeenCalledWith(
      '42',
      'NeedsAttention',
      false,
      'foundry_failed',
      'Foundry reports that the task runner failed. Review its task history, then recover the task.',
    );
    await expect(test.tasks.get('42', 1, 0)).resolves.toMatchObject({ state: 'NeedsAttention' });
    await test.dispatcher.stop();
  });

  it('moves a completed task to NeedsAttention when GitHub cannot verify its PR', async () => {
    vi.useFakeTimers();
    const refusal = 'GitHub could not verify or open the task pull request. Check repository access and retry the task.';
    const test = reconciliationHarness('completed', vi.fn(async () => ({ kind: 'refused' as const, reason: refusal })));

    test.dispatcher.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(test.tasks.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'pull_request_open_refused',
      summary: refusal,
      payload: { reason: refusal },
    }));
    expect(test.tasks.transition).toHaveBeenCalledWith('42', 'NeedsAttention', false, 'pull_request_open_refused');
    await expect(test.tasks.get('42', 1, 0)).resolves.toMatchObject({ state: 'NeedsAttention' });
    await test.dispatcher.stop();
  });
});
