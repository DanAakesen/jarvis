import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventHub } from '../core/event-hub.js';
import type { SettingsStore } from '../core/settings.js';
import { FoundryClientError } from '../foundry/client.js';
import { SandboxHeartbeat } from './heartbeat.js';
import { TaskDispatcher, type DispatchClaim, type DispatcherOptions, type DispatcherStore, type TaskControlTarget } from './dispatcher.js';
import type { TaskRecoveryStore } from './recovery-store.js';
import type { TaskEventHub, TaskEventMessage, TaskRecord, TaskStore } from './task-store.js';

const task: DispatchClaim = {
  taskId: '42',
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
  agent: 'codex',
  request: 'Find and fix it',
  modelOverride: 'gpt-5.4',
  reasoningOverride: 'high',
  sandboxSessionId: '53',
  foundrySessionId: 'session-1',
  agentName: 'jarvis-runner-base-1x2',
  invocationId: 'invocation-1',
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
) {
  const events: TaskEventHub = createEventHub<TaskEventMessage>();
  const transition = vi.fn(async (_id: string, state: TaskRecord['state']) => ({
    kind: 'ok' as const, task: { ...taskRecord, state },
  }));
  const tasks = {
    get: vi.fn(async () => ({ ...taskRecord, events: [], usage: [] })),
    transition,
  } as unknown as TaskStore;
  const settings: SettingsStore = { read: vi.fn(async () => ({
    'codex.model': '"gpt-5.5"', 'codex.reasoning_effort': '"medium"',
  })), write: vi.fn(async () => {}) };
  const track = vi.fn();
  const untrack = vi.fn();
  const setCompletionHandler = vi.fn();
  const heartbeat = { track, untrack, setCompletionHandler } as unknown as SandboxHeartbeat;
  const steer = vi.fn(async () => ({
    invocationId: 'invocation-steer', sessionId: 'session-1', status: 'queued' as const, agent: 'codex' as const,
  }));
  const pause = vi.fn(async () => ({
    sessionId: 'session-1', status: 'pausing' as const, pausedInvocationId: 'invocation-1',
  }));
  const resume = vi.fn(async () => ({
    invocationId: 'invocation-resume', sessionId: 'session-1', status: 'queued' as const, agent: 'codex' as const,
  }));
  const cancel = vi.fn(async (invocationId: string) => ({ invocationId, status: 'cancelled' as const }));
  const deleteSession = vi.fn(async () => {});
  const clientFor = vi.fn(() => ({ startTask, steer, pause, resume, cancel, deleteSession }));
  const dispatcher = new TaskDispatcher(store, tasks, settings, clientFor, heartbeat, events, options);
  return { dispatcher, events, settings, startTask, transition, track, untrack, clientFor, steer, pause, resume, cancel, deleteSession };
}

function idleStore(nextAttemptAt: string | null = null): DispatcherStore {
  return {
    claimNext: vi.fn(async () => ({ kind: 'idle' as const, nextAttemptAt })),
    deferClaim: vi.fn(async () => {}),
    failStart: vi.fn(async () => {}),
    recordStarted: vi.fn(async () => '53'),
    getControlTarget: vi.fn(async () => null),
    withTaskPolicyLock: vi.fn(async (_taskId: string, operation: () => Promise<unknown>) => operation()),
    hasPendingProjectPolicyMerge: vi.fn(async () => false),
    recordControlTurn: vi.fn(async () => true),
    recordResumedTurn: vi.fn(async () => ({
      sandboxSessionId: '54',
      foundrySessionId: 'session-1',
      agentName: 'jarvis-runner-base-1x2',
      invocationId: 'invocation-resume',
    })),
    endTaskSessions: vi.fn(async () => []),
  };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

afterEach(() => { vi.useRealTimers(); });

describe('task dispatcher', () => {
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
    expect(store.endTaskSessions).toHaveBeenCalledWith('42', state);
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
    const { dispatcher, startTask } = harness(
      store,
      vi.fn(async () => { throw new FoundryClientError('http', 'start', 429); }),
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
      3, expect.any(String), expect.objectContaining({ attemptCount: 3 }), null, 'foundry_start_failed',
    );
    expect(startTask).toHaveBeenCalledTimes(3);
    for (const [request] of startTask.mock.calls as unknown as [{ branch: string }][]) {
      expect(request.branch).toBe('jarvis/task-42');
    }
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

    await expect(dispatcher.control('42', { action: 'cancel' })).resolves.toEqual({ kind: 'invalid-transition' });

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

    await expect(dispatcher.control('42', { action: 'cancel' })).resolves.toEqual({ kind: 'failed' });

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
      .toEqual({ kind: 'invalid-transition' });
  });
});

describe('task crash recovery', () => {
  it('continues an idle-expired Running task in a new sandbox on its existing branch', async () => {
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
    const { dispatcher, transition, track } = harness(idleStore(), startTask, idleExpiredTask, {
      recoveryStore,
      workspaceFor: vi.fn(async (current) => ({
        repository: 'DanAakesen/jarvis',
        defaultBranch: 'main',
        branch: current.branch!,
      })),
    });

    await expect(dispatcher.control('42', { action: 'recover' }))
      .resolves.toMatchObject({ kind: 'ok', task: { state: 'Running' } });

    expect(transition).toHaveBeenCalledWith('42', 'NeedsAttention');
    expect(recoveryStore.claimRecovery).toHaveBeenCalledOnce();
    expect(startTask).toHaveBeenCalledWith(expect.objectContaining({
      repository: 'DanAakesen/jarvis',
      defaultBranch: 'main',
      branch: idleExpiredTask.branch,
      taskId: '42',
    }));
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
    const publishState = (from: TaskRecord['state'], to: TaskRecord['state']) => events.publish({
      id: String(Date.now()), taskId: '42', type: 'state_changed',
      summary: 'Task state changed', payload: { from, to }, payloadTruncated: false,
      source: 'backend', at: '2026-10-04T12:02:00.000Z',
    });
    let target: TaskControlTarget = {
      ...controlTarget, taskId: '42', sandboxSessionId: 'old-sandbox',
      foundrySessionId: 'old-session', invocationId: 'old-invocation',
    };
    const activeTasks = {
      get: vi.fn(async () => ({ ...record, state, events: timeline, usage: [] })),
      list: vi.fn(async () => state === 'Running' ? [{ ...record, state }] : []),
      transition: vi.fn(async (_id: string, next: TaskRecord['state'], completionVerified = false) => {
        if (next === 'Done' && !completionVerified) return { kind: 'invalid-transition' as const };
        const previous = state;
        state = next;
        publishState(previous, next);
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
        sandboxSessionId: 'old-sandbox', foundrySessionId: 'old-session',
        agentName: 'jarvis-runner-base-1x2', invocationId: 'old-invocation',
      }]),
      recordHeartbeat: vi.fn(async () => {}),
      markNeedsAttention: vi.fn(async () => {
        state = 'NeedsAttention';
        publishState('Running', 'NeedsAttention');
        return true;
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
    const verifyDelivery = vi.fn(async () => deliveryVerified);
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
      () => ({ startTask, steer: vi.fn(), pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(), deleteSession: vi.fn() }),
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
    });
    expect(state).toBe(deliveryVerified ? 'Done' : 'NeedsAttention');
    expect(activeTasks.transition).toHaveBeenCalledWith('42', deliveryVerified ? 'Done' : 'NeedsAttention', deliveryVerified);

    await Promise.all([dispatcher.stop(), heartbeat.stop()]);
  });
});
