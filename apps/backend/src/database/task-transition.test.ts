import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createEventHub } from '../core/event-hub.js';
import { TaskDispatcher, type DispatcherStore, type TaskControlTarget } from '../factory/dispatcher.js';
import type { SandboxHeartbeat } from '../factory/heartbeat.js';
import type { TaskDetail, TaskEventMessage, TaskRuntimeVersion } from '../factory/task-store.js';
import { createTaskStore } from './task-store.js';

vi.mock('mssql', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof sql }>();
  class FakeTransaction {
    constructor(readonly parent: {
      query: (text: string, inputs: Map<string, unknown>) => Promise<unknown>;
      events: string[];
      begin?: () => void;
    }) {}
    async begin() { this.parent.events.push('begin'); this.parent.begin?.(); }
    async commit() { this.parent.events.push('commit'); }
    async rollback() { this.parent.events.push('rollback'); }
  }
  class FakeRequest {
    private readonly inputs = new Map<string, unknown>();
    constructor(private readonly transaction: FakeTransaction) {}
    input(name: string, _type: unknown, value: unknown) { this.inputs.set(name, value); return this; }
    query(text: string) { return this.transaction.parent.query(text, this.inputs); }
  }
  return { ...actual, default: { ...actual.default, Transaction: FakeTransaction, Request: FakeRequest } };
});

describe('attention cancellation transition persistence', () => {
  it.each(['Active', 'completed', 'Idle', 'absent'] as const)(
    'refuses replacement of the captured %s runtime even when state returns to NeedsAttention', async (initial) => {
      await ownershipRace(initial, 'session');
    },
  );

  it.each(['Active', 'completed', 'Idle', 'absent'] as const)(
    'refuses replacement of the captured %s runtime after the replacement also ended', async (initial) => {
      await ownershipRace(initial, 'ended-session');
    },
  );

  it.each(['Active', 'completed', 'Idle'] as const)(
    'refuses a newer completed turn in the same %s session', async (initial) => {
      await ownershipRace(initial, 'turn');
    },
  );

  it.each(['Running', 'Paused', 'Done', 'Cancelled'])('rolls back if %s replaced the expected attention state', async (state) => {
    const events: string[] = [];
    const query = vi.fn()
      .mockResolvedValueOnce({ recordset: [{ result: 0 }] })
      .mockResolvedValueOnce({ recordset: [{ state }] });
    const hub = createEventHub<TaskEventMessage>();
    const publish = vi.spyOn(hub, 'publish');
    const store = createTaskStore({ query, events } as unknown as sql.ConnectionPool, hub);

    await expect(store.transition('42', 'Cancelled', false, undefined, undefined, 'NeedsAttention'))
      .resolves.toEqual({ kind: 'invalid-transition' });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[0]).toContain('WITH (UPDLOCK, ROWLOCK)');
    expect(events).toEqual(['begin', 'rollback']);
    expect(publish).not.toHaveBeenCalled();
  });

  async function ownershipRace(
    initial: 'Active' | 'completed' | 'Idle' | 'absent',
    replacement: 'session' | 'ended-session' | 'turn',
  ) {
    const at = new Date('2026-10-15T04:00:00.000Z');
    const task: TaskDetail = {
      id: '42', projectId: '7', originMessageId: null, title: 'Synthetic ownership race', request: 'No live work',
      source: 'board', agent: 'copilot', modelOverride: null, reasoningOverride: null,
      state: 'NeedsAttention', activity: null, priority: 0, attemptCount: 1, nextAttemptAt: null,
      branch: 'jarvis/task-42', createdAt: at.toISOString(), startedAt: at.toISOString(), finishedAt: null,
      latestSessionEndReason: initial === 'absent' ? 'idle_expired' : null, events: [], usage: [],
    };
    const target: TaskControlTarget = {
      taskId: '42', agent: 'copilot', request: task.request, modelOverride: null, reasoningOverride: null,
      sandboxSessionId: '53', foundrySessionId: 'old-session', agentName: 'synthetic-runner',
      invocationId: initial === 'completed' ? '' : 'old-invocation', latestTurnId: '71',
      sandboxSize: '1x2', image: 'synthetic-image', sessionStatus: initial === 'Idle' ? 'Idle' : 'Active',
      repository: 'DanAakesen/jarvis-test-target', defaultBranch: 'main', branch: 'jarvis/task-42',
    };
    let runtime: TaskRuntimeVersion = {
      sandboxSessionId: '53', foundrySessionId: 'old-session', latestTurnId: '71',
      sessionStatus: initial === 'absent' ? 'Ended' : target.sessionStatus,
    };
    const expected = { ...runtime };
    let currentTarget: TaskControlTarget | null = initial === 'absent' ? null : target;
    const sequence: string[] = [];
    const query = vi.fn(async (text: string, inputs: Map<string, unknown>) => {
      if (text.includes('sp_getapplock')) return { recordset: [{ result: 0 }] };
      if (text.includes('SELECT state FROM dbo.tasks WITH (UPDLOCK, ROWLOCK)')) {
        sequence.push(`row sees ${task.state}`);
        return { recordset: [{ state: task.state }] };
      }
      if (text.includes('AS latestTurnId')) {
        sequence.push('transactional runtime read');
        return { recordset: [runtime] };
      }
      if (text.includes('UPDATE dbo.tasks SET state = @state')) {
        task.state = inputs.get('state') as TaskDetail['state'];
        return { recordset: [{ ...task, createdAt: at, startedAt: at, finishedAt: at }] };
      }
      if (text.includes('SELECT TOP (1) JSON_VALUE(payload')) return { recordset: [] };
      if (text.includes('INSERT INTO dbo.task_events')) return { recordset: [{
        id: '12', type: 'state_changed', summary: 'Task state changed',
        payload: '{"from":"NeedsAttention","to":"Cancelled"}', source: 'backend', at,
      }] };
      if (text.includes('INSERT INTO dbo.activity')) return { recordset: [] };
      throw new Error('Unexpected synthetic SQL query');
    });
    const events = createEventHub<TaskEventMessage>();
    const publish = vi.spyOn(events, 'publish');
    const tasks = {
      ...createTaskStore({
        events: sequence, query,
        begin() {
          sequence.push('recovery claimed Running', 'replacement started', 'replacement question -> NeedsAttention');
          task.state = 'Running';
          const sandboxSessionId = replacement === 'turn' ? '53' : '99';
          const foundrySessionId = replacement === 'turn' ? 'old-session' : 'new-session';
          runtime = {
            sandboxSessionId, foundrySessionId,
            latestTurnId: '100',
            sessionStatus: replacement === 'ended-session' ? 'Ended' : target.sessionStatus,
          };
          currentTarget = replacement === 'ended-session' ? null : {
            ...target, ...runtime, sandboxSessionId, foundrySessionId,
            sessionStatus: target.sessionStatus, invocationId: '',
          };
          task.state = 'NeedsAttention';
        },
      } as unknown as sql.ConnectionPool, events),
      get: vi.fn(async () => ({ ...task })),
    };
    const store: DispatcherStore = {
      claimNext: vi.fn(async () => ({ kind: 'idle' as const, nextAttemptAt: null })),
      listStaleRunning: vi.fn(async () => []), isCurrentStaleTask: vi.fn(async () => true),
      recordHeartbeat: vi.fn(async () => {}), deferClaim: vi.fn(async () => {}), failStart: vi.fn(async () => {}),
      recordStarted: vi.fn(async () => '99'),
      getControlTarget: vi.fn(async () => currentTarget),
      getRuntimeVersion: vi.fn(async () => ({ ...runtime })),
      withTaskPolicyLock: async (_taskId, operation) => operation(),
      hasPendingProjectPolicyMerge: vi.fn(async () => false), recordControlTurn: vi.fn(async () => true),
      recordResumedTurn: vi.fn(async () => target),
      endTaskSessions: vi.fn(async () => runtime.sandboxSessionId ? [runtime.sandboxSessionId] : []),
    };
    const client = {
      startTask: vi.fn(), steer: vi.fn(), pause: vi.fn(), resume: vi.fn(), status: vi.fn(),
      cancel: vi.fn(async (invocationId: string) => ({ invocationId, status: 'cancelled' as const })),
      deleteSession: vi.fn(async () => {}),
    };
    const heartbeat = {
      track: vi.fn(), untrack: vi.fn(), setCompletionHandler: vi.fn(), hasTrackedSessions: () => false,
    } as unknown as SandboxHeartbeat;
    const dispatcher = new TaskDispatcher(store, tasks, {
      read: vi.fn(async () => ({})), write: vi.fn(async () => {}),
    }, () => client, heartbeat, events);

    await expect(dispatcher.control('42', { action: 'cancel' })).resolves.toMatchObject({ kind: 'invalid-transition' });
    expect(task.state).toBe('NeedsAttention');
    expect(runtime).not.toEqual(expected);
    expect(store.endTaskSessions).not.toHaveBeenCalled();
    expect(client.deleteSession).not.toHaveBeenCalled();
    expect(client.cancel.mock.calls).toEqual(initial === 'Active' ? [['old-invocation']] : []);
    expect(publish).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([text]) => /UPDATE dbo.tasks|INSERT INTO dbo.task_events/.test(text))).toBe(false);
    expect(sequence).toContain('transactional runtime read');
    expect(sequence).toContain('recovery claimed Running');
    expect(sequence).toContain('rollback');
    expect(sequence).not.toContain('commit');
  }

  it.each(['Active', 'Idle', 'Ended', 'Crashed', null] as const)(
    'commits cancellation of an unchanged %s runtime before publishing the terminal event', async (sessionStatus) => {
      const events: string[] = [];
      const at = new Date('2026-10-15T03:00:00.000Z');
      const runtime: TaskRuntimeVersion = {
        sandboxSessionId: sessionStatus ? '53' : null, foundrySessionId: sessionStatus ? 'old-session' : null,
        latestTurnId: sessionStatus ? '71' : null, sessionStatus,
      };
      const query = vi.fn()
        .mockResolvedValueOnce({ recordset: [{ result: 0 }] })
        .mockResolvedValueOnce({ recordset: [{ state: 'NeedsAttention' }] })
        .mockResolvedValueOnce({ recordset: [runtime] })
        .mockResolvedValueOnce({ recordset: [{
          id: '42', projectId: '7', originMessageId: null, title: 'Synthetic task', request: 'Synthetic request',
          source: 'board', agent: 'copilot', modelOverride: null, reasoningOverride: null,
          state: 'Cancelled', activity: null, priority: 0, attemptCount: 1, nextAttemptAt: null,
          branch: 'jarvis/task-42', createdAt: at, startedAt: at, finishedAt: at,
        }] })
        .mockResolvedValueOnce({ recordset: [] })
        .mockResolvedValueOnce({ recordset: [{
          id: '12', type: 'state_changed', summary: 'Task state changed',
          payload: '{"from":"NeedsAttention","to":"Cancelled"}', source: 'backend', at,
        }] })
        .mockResolvedValue({ recordset: [] });
      const hub = createEventHub<TaskEventMessage>();
      const publish = vi.fn(() => { expect(events.at(-1)).toBe('commit'); });
      hub.subscribe(publish);
      const store = createTaskStore({ query, events } as unknown as sql.ConnectionPool, hub);

      await expect(store.transition('42', 'Cancelled', false, undefined, undefined, 'NeedsAttention', runtime))
        .resolves.toMatchObject({ kind: 'ok', task: { state: 'Cancelled' } });

      expect(query.mock.calls[2]?.[0]).toContain('WITH (UPDLOCK, HOLDLOCK)');
      expect(events).toEqual(['begin', 'commit']);
      expect(publish).toHaveBeenCalledOnce();
      expect(publish).toHaveBeenCalledWith(expect.objectContaining({
        taskId: '42', type: 'state_changed', payload: { from: 'NeedsAttention', to: 'Cancelled' },
      }));
    },
  );
});
