import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEventHub } from '../core/event-hub.js';
import type { SettingsStore } from '../core/settings.js';
import { TaskDispatcher } from '../factory/dispatcher.js';
import type { SandboxHeartbeat } from '../factory/heartbeat.js';
import type { TaskEventHub, TaskEventMessage } from '../factory/task-store.js';
import { createTaskStore } from './task-store.js';
import { createDispatcherStore } from './dispatcher-store.js';
import { createTaskRecoveryStore } from './recovery-store.js';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readMigrations } from './migrations.js';

const configuration = loadDatabaseConfig();
if (!configuration || process.env.NODE_ENV !== 'test' || configuration.server !== '127.0.0.1') {
  throw new Error('Dispatcher integration tests require an isolated loopback SQL Server test configuration');
}

const database = `jarvis_dispatch_${randomUUID().replaceAll('-', '')}`;
const administrator = new sql.ConnectionPool({ ...configuration, database: 'master' });
const pool = new sql.ConnectionPool({ ...configuration, database });

beforeAll(async () => {
  await administrator.connect();
  await administrator.request().batch(`CREATE DATABASE [${database}];`);
  await pool.connect();
  await applyMigrations(pool, await readMigrations());
});

afterAll(async () => {
  await pool.close();
  if (administrator.connected) {
    await administrator.request().batch(`IF DB_ID(N'${database}') IS NOT NULL BEGIN
      ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
      DROP DATABASE [${database}]; END;`);
  }
  await administrator.close();
});

async function createProject(maxParallelTasks = 1): Promise<string> {
  const project = await pool.request()
    .input('repo', sql.NVarChar(140), `DanAakesen/dispatch-${randomUUID().slice(0, 8)}`)
    .input('maxParallelTasks', sql.Int, maxParallelTasks)
    .query<{ id: string }>(`INSERT dbo.projects (name, repo, default_branch, default_agent, policy, sandbox_size, tech, max_parallel_tasks)
      OUTPUT CAST(inserted.id AS varchar(19)) AS id
      VALUES (N'Dispatch fixture', @repo, N'main', N'copilot', N'deliver_pr', N'1x2', N'node', @maxParallelTasks);`);
  const projectId = project.recordset[0]?.id;
  if (!projectId) throw new Error('Dispatcher project fixture was not created');
  return projectId;
}

async function createTask(events: TaskEventHub, title: string, projectId?: string) {
  const selectedProjectId = projectId ?? await createProject();
  const task = await createTaskStore(pool, events).create({ projectId: selectedProjectId, title, request: 'Run the task' });
  if (!task) throw new Error('Dispatcher task fixture was not created');
  return task;
}

function settings(): SettingsStore {
  return { read: vi.fn(async () => ({})), write: vi.fn(async () => {}) };
}

function heartbeat(): SandboxHeartbeat {
  return {
    track: vi.fn(), untrack: vi.fn(), setCompletionHandler: vi.fn(), hasTrackedSessions: vi.fn(() => false),
  } as unknown as SandboxHeartbeat;
}

describe('dispatcher SQL coordination', () => {
  it.each(['Active', 'Ended'] as const)('exposes finishing delivery and cancels a completed turn in an %s session', async (sessionStatus) => {
    const events = createEventHub<TaskEventMessage>();
    const taskStore = createTaskStore(pool, events);
    const store = createDispatcherStore(pool, events);
    const task = await createTask(events, 'Finishing delivery cancellation');
    try {
      expect((await taskStore.transition(task.id, 'Running')).kind).toBe('ok');
      const session = await pool.request()
        .input('taskId', sql.BigInt, BigInt(task.id))
        .input('status', sql.NVarChar(8), sessionStatus)
        .input('foundrySessionId', sql.NVarChar(255), `finishing-${sessionStatus}-${randomUUID()}`)
        .query<{ id: string }>(`INSERT dbo.sandbox_sessions
        (task_id, foundry_session_id, agent_version, agent_name, size, image, status, ended_at, end_reason)
        OUTPUT CAST(inserted.id AS varchar(19)) AS id
        VALUES (@taskId, @foundrySessionId, N'1', N'jarvis-runner-base-1x2', N'1x2', N'fixture', @status,
          CASE WHEN @status = N'Ended' THEN SYSUTCDATETIME() ELSE NULL END,
          CASE WHEN @status = N'Ended' THEN N'done' ELSE NULL END);`);
      const sessionId = session.recordset[0]!.id;
      await pool.request()
        .input('sessionId', sql.BigInt, BigInt(sessionId))
        .query(`INSERT dbo.sandbox_turns (sandbox_session_id, invocation_id, mode, acp_session_id, status, ended_at)
        VALUES (@sessionId, N'finishing-invocation', N'task', N'fixture-acp', N'completed', SYSUTCDATETIME());`);
      const cancel = vi.fn();
      const deleteSession = vi.fn(async () => {});
      const dispatcher = new TaskDispatcher(store, taskStore, settings(), () => ({
        startTask: vi.fn(), steer: vi.fn(), pause: vi.fn(), resume: vi.fn(), cancel, deleteSession, status: vi.fn(),
      }), heartbeat(), events);
      expect(await taskStore.get(task.id, 1, 0)).toMatchObject({ state: 'Running', activity: 'Finishing delivery' });
      expect(await taskStore.list({ limit: 100, offset: 0 })).toContainEqual(
        expect.objectContaining({ id: task.id, activity: 'Finishing delivery' }),
      );
      expect((await taskStore.getRunningContext()).runningTasks).toContainEqual(
        expect.objectContaining({ id: task.id, activity: 'Finishing delivery' }),
      );
      await expect(dispatcher.control(task.id, { action: 'cancel' }))
        .resolves.toMatchObject({ kind: 'ok', task: { state: 'Cancelled' } });
      expect(cancel).not.toHaveBeenCalled();
      expect(await taskStore.get(task.id, 1, 0)).toMatchObject({ state: 'Cancelled', activity: null });
      await expect(dispatcher.control(task.id, { action: 'cancel' }))
        .resolves.toEqual({ kind: 'invalid-transition', reason: 'Task is already Cancelled' });
      const ended = await pool.request()
        .input('sessionId', sql.BigInt, BigInt(sessionId))
        .query<{ status: string }>('SELECT status FROM dbo.sandbox_sessions WHERE id = @sessionId;');
      expect(ended.recordset).toEqual([{ status: 'Ended' }]);
      await pool.request()
        .input('taskId', sql.BigInt, BigInt(task.id))
        .input('foundrySessionId', sql.NVarChar(255), `new-finishing-${sessionStatus}-${randomUUID()}`)
        .query(`UPDATE dbo.tasks SET state = N'Running' WHERE id = @taskId;
          INSERT dbo.sandbox_sessions
            (task_id, foundry_session_id, agent_version, agent_name, size, image, status, started_at)
          VALUES (@taskId, @foundrySessionId, N'1', N'jarvis-runner-base-1x2', N'1x2', N'fixture',
            N'Active', SYSUTCDATETIME());`);
      expect(await taskStore.get(task.id, 1, 0)).toMatchObject({ activity: null });
    } finally {
      await pool.request()
        .input('taskId', sql.BigInt, BigInt(task.id))
        .input('projectId', sql.BigInt, BigInt(task.projectId))
        .input('link', sql.NVarChar(100), `task:${task.id}`)
        .query(`SET XACT_ABORT ON;
          BEGIN TRANSACTION;
          DELETE dbo.usage WHERE task_id = @taskId;
          DELETE dbo.task_events WHERE task_id = @taskId;
          DELETE dbo.sandbox_turns WHERE sandbox_session_id IN (
            SELECT id FROM dbo.sandbox_sessions WHERE task_id = @taskId);
          DELETE dbo.sandbox_sessions WHERE task_id = @taskId;
          DELETE dbo.task_status_notifications WHERE task_id = @taskId;
          DELETE dbo.activity WHERE link = @link;
          DELETE dbo.tasks WHERE id = @taskId;
          DELETE dbo.projects WHERE id = @projectId;
          COMMIT TRANSACTION;`);
    }
  });

  it('updates a Ready task model and publishes only the committed change event', async () => {
    const events = createEventHub<TaskEventMessage>();
    const published: TaskEventMessage[] = [];
    events.subscribe((event) => published.push(event));
    const taskStore = createTaskStore(pool, events);
    const task = await createTask(events, 'Model selection');
    try {
      const updated = await taskStore.updateModelConfig(task.id, {
        agent: 'codex', modelOverride: 'default', reasoningOverride: 'default',
      });

      expect(updated).toMatchObject({
        kind: 'ok',
        task: { id: task.id, state: 'Ready', agent: 'codex', modelOverride: 'default', reasoningOverride: 'default' },
      });
      expect(published.at(-1)).toMatchObject({
        taskId: task.id,
        type: 'model_changed',
        summary: 'Coding agent settings changed',
        payload: { agent: 'codex', model: 'default', reasoning: 'default' },
      });
      expect((await taskStore.get(task.id, 5, 0))?.modelOverride).toBe('default');
      expect((await pool.request()
        .input('link', sql.NVarChar(100), `task:${task.id}`)
        .input('kind', sql.NVarChar(64), 'model_changed')
        .query<{ count: number }>(`SELECT COUNT(*) AS count FROM dbo.activity
          WHERE link = @link AND kind = @kind;`)).recordset).toEqual([{ count: 1 }]);

      await pool.request().input('taskId', sql.BigInt, BigInt(task.id))
        .query(`UPDATE dbo.tasks SET state = N'Running' WHERE id = @taskId;`);
      const eventCount = published.length;
      expect(await taskStore.updateModelConfig(task.id, {
        agent: 'copilot', modelOverride: null, reasoningOverride: null,
      })).toEqual({ kind: 'not-ready' });
      expect(published).toHaveLength(eventCount);
    } finally {
      await pool.request().input('taskId', sql.BigInt, BigInt(task.id))
        .query(`UPDATE dbo.tasks SET state = N'Done' WHERE id = @taskId;`);
    }
  });

  it('lists only stale Running tasks with an active or completed session', async () => {
    const events = createEventHub<TaskEventMessage>();
    const taskStore = createTaskStore(pool, events);
    const store = createDispatcherStore(pool, events);
    const addRunningInvocation = async (
      title: string,
      sessionStatus: 'Active' | 'Ended',
      endReason: string | null,
      stale: boolean,
      turnStatus: 'running' | 'completed',
    ) => {
      const task = await createTask(events, title);
      expect((await taskStore.transition(task.id, 'Running')).kind).toBe('ok');
      const foundrySessionId = `reconcile-${randomUUID()}`;
      const invocationId = `reconcile-invocation-${randomUUID()}`;
      const session = await pool.request()
        .input('taskId', sql.BigInt, BigInt(task.id))
        .input('foundrySessionId', sql.NVarChar(255), foundrySessionId)
        .input('status', sql.NVarChar(8), sessionStatus)
        .input('endReason', sql.NVarChar(32), endReason)
        .input('startedAt', sql.DateTime2(7), new Date(Date.now() - (stale ? 10 : 0) * 60_000))
        .input('heartbeatAt', sql.DateTime2(7), stale ? new Date(Date.now() - 10 * 60_000) : null)
        .query<{ sandboxSessionId: string }>(`INSERT dbo.sandbox_sessions
          (task_id, foundry_session_id, agent_version, agent_name, size, image, status,
            started_at, last_heartbeat_at, ended_at, end_reason)
          OUTPUT CAST(inserted.id AS varchar(19)) AS sandboxSessionId
          VALUES (@taskId, @foundrySessionId, N'active', N'jarvis-runner-base-1x2', N'1x2',
            N'jarvis-runner-base-1x2', @status, @startedAt, @heartbeatAt,
            CASE WHEN @status = N'Ended' THEN SYSUTCDATETIME() ELSE NULL END, @endReason);`);
      const sandboxSessionId = session.recordset[0]?.sandboxSessionId;
      if (!sandboxSessionId) throw new Error('Stale-task session fixture was not created');
      await pool.request()
        .input('sandboxSessionId', sql.BigInt, BigInt(sandboxSessionId))
        .input('foundrySessionId', sql.NVarChar(255), foundrySessionId)
        .input('invocationId', sql.NVarChar(255), invocationId)
        .input('status', sql.NVarChar(16), turnStatus)
        .query(`INSERT dbo.sandbox_turns (sandbox_session_id, invocation_id, mode, acp_session_id, status,
            ended_at)
          VALUES (@sandboxSessionId, @invocationId, N'task', @foundrySessionId, @status,
            CASE WHEN @status = N'completed' THEN SYSUTCDATETIME() ELSE NULL END);`);
      return { task, sandboxSessionId };
    };

    const fixtures: Awaited<ReturnType<typeof addRunningInvocation>>[] = [];
    try {
      const staleActive = await addRunningInvocation('Stale active invocation', 'Active', null, true, 'running');
      fixtures.push(staleActive);
      const staleCompleted = await addRunningInvocation('Stale completed invocation', 'Ended', 'done', true, 'completed');
      fixtures.push(staleCompleted);
      const freshActive = await addRunningInvocation('Fresh active invocation', 'Active', null, false, 'running');
      fixtures.push(freshActive);

      const stale = await store.listStaleRunning(new Date(Date.now() - 5 * 60_000), 5);
      expect(stale.map(({ taskId }) => taskId)).toEqual(expect.arrayContaining([
        staleActive.task.id, staleCompleted.task.id,
      ]));
      expect(stale).toHaveLength(2);
      expect(stale.find(({ taskId }) => taskId === staleActive.task.id)?.sessionStatus).toBe('Active');
      expect(stale.find(({ taskId }) => taskId === staleCompleted.task.id)?.sessionStatus).toBe('Ended');
    } finally {
      for (const { task } of fixtures) {
        await taskStore.transition(task.id, 'NeedsAttention');
        await store.endTaskSessions(task.id, 'NeedsAttention');
      }
    }
  });

  it('persists the workspace branch with the lease and retains it across deferred and rejected starts', async () => {
    const events = createEventHub<TaskEventMessage>();
    const taskStore = createTaskStore(pool, events);
    const task = await createTask(events, 'Persisted workspace');
    const store = createDispatcherStore(pool, events);
    const first = await store.claimNext('workspace-owner', 120, 3);
    if (first.kind !== 'claimed') throw new Error('Workspace fixture was not claimed');
    expect(first.task).toMatchObject({
      taskId: task.id, defaultBranch: 'main', branch: `jarvis/task-${task.id}`,
      repository: expect.stringMatching(/^DanAakesen\/dispatch-/),
    });
    expect((await taskStore.get(task.id, 1, 0))?.branch).toBe(first.task.branch);
    await store.deferClaim('wrong-owner', first.task, 0);
    expect(await store.claimNext('competing-owner', 120, 3)).toMatchObject({ kind: 'idle' });
    await store.deferClaim('workspace-owner', first.task, 0);
    const deferred = await store.claimNext('workspace-owner', 120, 3);
    if (deferred.kind !== 'claimed') throw new Error('Deferred workspace fixture was not claimed');
    expect(deferred.task.branch).toBe(first.task.branch);
    expect(deferred.task.attemptCount).toBe(1);
    expect((await taskStore.transition(task.id, 'Running')).kind).toBe('ok');
    await store.failStart('workspace-owner', deferred.task, new Date(Date.now() - 1000).toISOString(), 'rejected');
    const retry = await store.claimNext('workspace-owner', 120, 3);
    if (retry.kind !== 'claimed') throw new Error('Retry workspace fixture was not claimed');
    expect(retry.task.branch).toBe(first.task.branch);
    expect(retry.task.attemptCount).toBe(2);
    await store.failStart('workspace-owner', retry.task, null, 'test_cleanup');
  });

  it('reuses a pre-existing branch when a task is reclaimed for a fresh session', async () => {
    const events = createEventHub<TaskEventMessage>();
    const taskStore = createTaskStore(pool, events);
    const task = await createTask(events, 'Retained workspace');
    await pool.request().input('taskId', sql.BigInt, BigInt(task.id))
      .query(`UPDATE dbo.tasks SET branch = N'jarvis/existing-recovery-branch' WHERE id = @taskId;`);
    const store = createDispatcherStore(pool, events);
    const claim = await store.claimNext('recovery-owner', 120, 3);
    if (claim.kind !== 'claimed') throw new Error('Recovery workspace fixture was not claimed');
    expect(claim.task.branch).toBe('jarvis/existing-recovery-branch');
    expect((await taskStore.get(task.id, 1, 0))?.branch).toBe(claim.task.branch);
    await store.failStart('recovery-owner', claim.task, null, 'test_cleanup');
  });

  it.each(['Running', 'PauseRequested'] as const)('records a session question and needs-attention state atomically from %s', async (state) => {
    const events = createEventHub<TaskEventMessage>();
    const taskStore = createTaskStore(pool, events);
    const task = await createTask(events, 'Agent question');
    await taskStore.transition(task.id, 'Running');
    if (state === 'PauseRequested') await taskStore.transition(task.id, state);
    const delivered: TaskEventMessage[] = [];
    const unsubscribe = events.subscribe((event) => delivered.push(event));
    const question = {
      taskId: task.id, type: 'session_question', source: 'runner' as const,
      summary: 'Which implementation should I use?',
      payload: { invocationId: 'question-turn', eventIndex: 1, data: { question: 'Which implementation should I use?' } },
    };
    await taskStore.recordEvent(question);
    expect(delivered.map(({ type }) => type)).toEqual(['session_question', 'state_changed']);
    expect(delivered[0]?.summary).toBe('Which implementation should I use?');
    expect(delivered[1]?.payload).toEqual({ from: state, to: 'NeedsAttention', reason: 'session_question' });
    expect((await taskStore.get(task.id, 10, 0))?.state).toBe('NeedsAttention');
    await taskStore.recordEvent(question);
    expect(delivered.map(({ type }) => type)).toEqual(['session_question', 'state_changed', 'session_question']);
    unsubscribe();
  });

  it('does not restart or change a cancelled task on a late runner question', async () => {
    const events = createEventHub<TaskEventMessage>();
    const taskStore = createTaskStore(pool, events);
    const task = await createTask(events, 'Late agent question');
    await taskStore.transition(task.id, 'Cancelled');
    const delivered: TaskEventMessage[] = [];
    const unsubscribe = events.subscribe((event) => delivered.push(event));
    await taskStore.recordEvent({
      taskId: task.id, type: 'session_question', source: 'runner',
      payload: { data: { question: 'Late question' } },
    });
    expect(delivered.map(({ type }) => type)).toEqual(['session_question']);
    expect((await taskStore.get(task.id, 1, 0))?.state).toBe('Cancelled');
    unsubscribe();
  });

  it('starts a ready task once when two dispatcher instances race for it', async () => {
    const events = createEventHub<TaskEventMessage>();
    const taskStore = createTaskStore(pool, events);
    const task = await createTask(events, 'Competing dispatchers');
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => { resolveStarted = resolve; });
    const unsubscribe = events.subscribe((event) => {
      if (event.type === 'sandbox_started') resolveStarted();
    });
    const startFirst = vi.fn(async (request: import('../foundry/client.js').TaskRequest) => {
      expect((await taskStore.get(task.id, 1, 0))?.branch).toBe(request.branch);
      expect(request.branch).toBe(`jarvis/task-${task.id}`);
      return { invocationId: 'invocation-first', sessionId: 'session-first', status: 'queued' as const, agent: 'copilot' as const };
    });
    const startSecond = vi.fn(async (request: import('../foundry/client.js').TaskRequest) => {
      expect((await taskStore.get(task.id, 1, 0))?.branch).toBe(request.branch);
      expect(request.branch).toBe(`jarvis/task-${task.id}`);
      return { invocationId: 'invocation-second', sessionId: 'session-second', status: 'queued' as const, agent: 'copilot' as const };
    });
    const first = new TaskDispatcher(
      createDispatcherStore(pool, events), taskStore, settings(),
      () => ({ startTask: startFirst, deleteSession: vi.fn(async () => {}) }), heartbeat(), events,
    );
    const second = new TaskDispatcher(
      createDispatcherStore(pool, events), taskStore, settings(),
      () => ({ startTask: startSecond, deleteSession: vi.fn(async () => {}) }), heartbeat(), events,
    );

    first.start();
    second.start();
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        started,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('Timed out waiting for sandbox start')), 15_000);
        }),
      ]);
    } finally { clearTimeout(timeout); }
    await Promise.all([first.stop(), second.stop()]);
    unsubscribe();

    expect(startFirst.mock.calls.length + startSecond.mock.calls.length).toBe(1);
    expect((await pool.request().query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM dbo.sandbox_sessions WHERE foundry_session_id IN (N'session-first', N'session-second');`,
    )).recordset[0]?.count).toBe(1);
    expect((await taskStore.transition(task.id, 'Cancelled')).kind).toBe('ok');
    await createDispatcherStore(pool, events).endTaskSessions(task.id, 'Cancelled');
  });

  it('claims a NeedsAttention task once and persists its recovered sandbox session', async () => {
    const events = createEventHub<TaskEventMessage>();
    const taskStore = createTaskStore(pool, events);
    const task = await createTask(events, 'Recover crashed task');
    const branch = `jarvis/task-${task.id}`;
    await pool.request()
      .input('taskId', sql.BigInt, BigInt(task.id))
      .input('branch', sql.NVarChar(255), branch)
      .query(`UPDATE dbo.tasks SET branch = @branch WHERE id = @taskId;`);
    expect((await taskStore.transition(task.id, 'Running')).kind).toBe('ok');
    expect((await taskStore.transition(task.id, 'NeedsAttention')).kind).toBe('ok');

    const recoveryStore = createTaskRecoveryStore(pool, events);
    const ownerOne = randomUUID();
    const ownerTwo = randomUUID();
    const [first, second] = await Promise.all([
      recoveryStore.claimRecovery(task.id, ownerOne, 120),
      recoveryStore.claimRecovery(task.id, ownerTwo, 120),
    ]);
    const claim = first.kind === 'claimed' ? first : second.kind === 'claimed' ? second : undefined;
    const owner = first.kind === 'claimed' ? ownerOne : ownerTwo;
    if (!claim) throw new Error('The recovery claim was not acquired');
    expect(claim).toMatchObject({ kind: 'claimed', task: { taskId: task.id } });
    expect([first.kind, second.kind].filter((kind) => kind === 'claimed')).toHaveLength(1);

    const dispatcherStore = createDispatcherStore(pool, events);
    const sandboxSessionId = await dispatcherStore.recordStarted(owner, claim.task, 'jarvis-runner-base-1x2', {
      sessionId: `recovered-${task.id}`,
      invocationId: `recovered-invocation-${task.id}`,
    });
    expect((await taskStore.get(task.id, 10, 0))?.state).toBe('Running');
    expect(await dispatcherStore.endTaskSessions(task.id, 'Cancelled')).toEqual([sandboxSessionId]);
    expect((await taskStore.transition(task.id, 'Cancelled')).kind).toBe('ok');
  });

  it('reuses the Foundry session and accumulates sandbox usage across pause and resume', async () => {
    const events = createEventHub<TaskEventMessage>();
    const taskStore = createTaskStore(pool, events);
    const task = await createTask(events, 'Pause and resume');
    await pool.request().input('taskId', sql.BigInt, BigInt(task.id))
      .query(`UPDATE dbo.tasks SET branch = N'jarvis/persisted-resume-branch' WHERE id = @taskId;`);
    expect((await taskStore.transition(task.id, 'Running')).kind).toBe('ok');

    const foundrySessionId = `resume-${randomUUID()}`;
    const initialInvocationId = `turn-${randomUUID()}`;
    const inserted = await pool.request()
      .input('taskId', sql.BigInt, BigInt(task.id))
      .input('foundrySessionId', sql.NVarChar(255), foundrySessionId)
      .query<{ sandboxSessionId: string }>(`INSERT dbo.sandbox_sessions
        (task_id, foundry_session_id, agent_version, agent_name, size, image, status, started_at)
        OUTPUT CAST(inserted.id AS varchar(19)) AS sandboxSessionId
        VALUES (@taskId, @foundrySessionId, N'active', N'runner', N'1x2', N'runner', N'Active',
          DATEADD(minute, -2, SYSUTCDATETIME()));`);
    const sandboxSessionId = inserted.recordset[0]?.sandboxSessionId;
    if (!sandboxSessionId) throw new Error('Resume fixture was not created');
    await pool.request()
      .input('sessionId', sql.BigInt, BigInt(sandboxSessionId))
      .input('invocationId', sql.NVarChar(255), initialInvocationId)
      .query(`INSERT dbo.sandbox_turns (sandbox_session_id, invocation_id, mode, acp_session_id, status)
        VALUES (@sessionId, @invocationId, N'task', N'acp-initial', N'running');`);
    const store = createDispatcherStore(pool, events);
    const target = await store.getControlTarget(task.id);
    if (!target) throw new Error('Active session was not available for steering');
    expect(target).toMatchObject({ defaultBranch: 'main', branch: 'jarvis/persisted-resume-branch' });
    let publishedSteeringEvent: TaskEventMessage | undefined;
    const unsubscribe = events.subscribe((event) => {
      if (event.type === 'steered') publishedSteeringEvent = event;
    });
    expect(await store.recordControlTurn(target, {
      sessionId: foundrySessionId,
      invocationId: `turn-${randomUUID()}`,
      status: 'queued',
      agent: 'copilot',
    }, 'Use the existing task branch.')).toBe(true);
    unsubscribe();
    expect(publishedSteeringEvent).toMatchObject({
      type: 'steered',
      summary: 'Use the existing task branch.',
      source: 'dan',
      payload: { message: 'Use the existing task branch.' },
    });
    const currentTarget = await store.getControlTarget(task.id);
    if (!currentTarget) throw new Error('Steering turn was not persisted');
    let publishedLargeSteeringEvent: TaskEventMessage | undefined;
    const unsubscribeLarge = events.subscribe((event) => {
      if (event.type === 'steered' && event.payloadTruncated) publishedLargeSteeringEvent = event;
    });
    expect(await store.recordControlTurn(currentTarget, {
      sessionId: foundrySessionId,
      invocationId: `turn-${randomUUID()}`,
      status: 'queued',
      agent: 'copilot',
    }, 'x'.repeat(5_000))).toBe(true);
    unsubscribeLarge();
    expect(publishedLargeSteeringEvent).toMatchObject({ type: 'steered', source: 'dan', payload: null, payloadTruncated: true });

    expect((await taskStore.transition(task.id, 'PauseRequested')).kind).toBe('ok');
    expect((await taskStore.transition(task.id, 'Paused')).kind).toBe('ok');
    await store.endTaskSessions(task.id, 'Paused');
    const firstUsage = await pool.request()
      .input('sessionId', sql.BigInt, BigInt(sandboxSessionId))
      .query<{ quantity: number }>(`SELECT quantity FROM dbo.usage
        WHERE sandbox_session_id = @sessionId AND source = N'sandbox' AND metric = N'minutes';`);
    expect(firstUsage.recordset[0]?.quantity).toBeGreaterThan(0);

    expect((await taskStore.transition(task.id, 'Running')).kind).toBe('ok');
    const resumeTarget = await store.getControlTarget(task.id);
    if (!resumeTarget) throw new Error('Paused session was not available for resume');
    const resumed = await store.recordResumedTurn(resumeTarget, {
      sessionId: foundrySessionId,
      invocationId: `turn-${randomUUID()}`,
      status: 'queued',
      agent: 'copilot',
    });
    expect(resumed.sandboxSessionId).toBe(sandboxSessionId);
    expect((await taskStore.transition(task.id, 'PauseRequested')).kind).toBe('ok');
    expect((await taskStore.transition(task.id, 'Paused')).kind).toBe('ok');
    await store.endTaskSessions(task.id, 'Paused');

    const persisted = await pool.request()
      .input('sessionId', sql.BigInt, BigInt(sandboxSessionId))
      .input('foundrySessionId', sql.NVarChar(255), foundrySessionId)
      .query<{ sessions: number; usageRows: number; quantity: number }>(`SELECT
        (SELECT COUNT(*) FROM dbo.sandbox_sessions WHERE foundry_session_id = @foundrySessionId) AS sessions,
        (SELECT COUNT(*) FROM dbo.usage WHERE sandbox_session_id = @sessionId
          AND source = N'sandbox' AND metric = N'minutes') AS usageRows,
        (SELECT quantity FROM dbo.usage WHERE sandbox_session_id = @sessionId
          AND source = N'sandbox' AND metric = N'minutes') AS quantity;`);
    expect(persisted.recordset[0]).toMatchObject({ sessions: 1, usageRows: 1 });
    expect(persisted.recordset[0]?.quantity).toBeGreaterThan(firstUsage.recordset[0]?.quantity ?? 0);

    expect((await taskStore.transition(task.id, 'Cancelled')).kind).toBe('ok');
    await store.endTaskSessions(task.id, 'Cancelled');
    const ended = await pool.request()
      .input('sessionId', sql.BigInt, BigInt(sandboxSessionId))
      .query<{ status: string; endReason: string }>(`SELECT status, end_reason AS endReason
        FROM dbo.sandbox_sessions WHERE id = @sessionId;`);
    expect(ended.recordset[0]).toEqual({ status: 'Ended', endReason: 'cancelled' });
  });

  it('does not add a crashed sandbox interval to usage more than once', async () => {
    const events = createEventHub<TaskEventMessage>();
    const taskStore = createTaskStore(pool, events);
    const task = await createTask(events, 'Finalize crashed sandbox usage');
    expect((await taskStore.transition(task.id, 'Running')).kind).toBe('ok');

    const foundrySessionId = `crash-${randomUUID()}`;
    const inserted = await pool.request()
      .input('taskId', sql.BigInt, BigInt(task.id))
      .input('foundrySessionId', sql.NVarChar(255), foundrySessionId)
      .query<{ sandboxSessionId: string }>(`INSERT dbo.sandbox_sessions
        (task_id, foundry_session_id, agent_version, agent_name, size, image, status, started_at)
        OUTPUT CAST(inserted.id AS varchar(19)) AS sandboxSessionId
        VALUES (@taskId, @foundrySessionId, N'active', N'runner', N'1x2', N'runner', N'Active',
          DATEADD(minute, -1, SYSUTCDATETIME()));`);
    const sandboxSessionId = inserted.recordset[0]?.sandboxSessionId;
    if (!sandboxSessionId) throw new Error('Crash fixture was not created');
    await pool.request()
      .input('sessionId', sql.BigInt, BigInt(sandboxSessionId))
      .input('invocationId', sql.NVarChar(255), `turn-${randomUUID()}`)
      .query(`INSERT dbo.sandbox_turns (sandbox_session_id, invocation_id, mode, acp_session_id, status)
        VALUES (@sessionId, @invocationId, N'task', N'acp-crash', N'running');`);
    expect((await taskStore.transition(task.id, 'NeedsAttention')).kind).toBe('ok');

    const store = createDispatcherStore(pool, events);
    await store.endTaskSessions(task.id, 'NeedsAttention');
    const first = await pool.request()
      .input('sessionId', sql.BigInt, BigInt(sandboxSessionId))
      .query<{ quantity: number }>(`SELECT quantity FROM dbo.usage
        WHERE sandbox_session_id = @sessionId AND source = N'sandbox' AND metric = N'minutes';`);
    await store.endTaskSessions(task.id, 'NeedsAttention');
    const second = await pool.request()
      .input('sessionId', sql.BigInt, BigInt(sandboxSessionId))
      .query<{ quantity: number }>(`SELECT quantity FROM dbo.usage
        WHERE sandbox_session_id = @sessionId AND source = N'sandbox' AND metric = N'minutes';`);

    expect(first.recordset[0]?.quantity).toBeGreaterThan(0);
    expect(second.recordset[0]?.quantity).toBe(first.recordset[0]?.quantity);
  });

  it('ends a completed invocation without recording a crash when delivery needs attention', async () => {
    const events = createEventHub<TaskEventMessage>();
    const taskStore = createTaskStore(pool, events);
    const task = await createTask(events, 'Completed turn without delivery');
    expect((await taskStore.transition(task.id, 'Running')).kind).toBe('ok');
    const foundrySessionId = `completed-${randomUUID()}`;
    const inserted = await pool.request()
      .input('taskId', sql.BigInt, BigInt(task.id))
      .input('foundrySessionId', sql.NVarChar(255), foundrySessionId)
      .query<{ sandboxSessionId: string }>(`INSERT dbo.sandbox_sessions
        (task_id, foundry_session_id, agent_version, agent_name, size, image, status)
        OUTPUT CAST(inserted.id AS varchar(19)) AS sandboxSessionId
        VALUES (@taskId, @foundrySessionId, N'active', N'runner', N'1x2', N'runner', N'Active');`);
    const sandboxSessionId = inserted.recordset[0]?.sandboxSessionId;
    if (!sandboxSessionId) throw new Error('Completed session fixture was not created');
    await pool.request()
      .input('sandboxSessionId', sql.BigInt, BigInt(sandboxSessionId))
      .input('invocationId', sql.NVarChar(255), `completed-turn-${randomUUID()}`)
      .query(`INSERT dbo.sandbox_turns (sandbox_session_id, invocation_id, mode, acp_session_id, status)
        VALUES (@sandboxSessionId, @invocationId, N'task', N'completed-acp', N'running');`);
    expect((await taskStore.transition(task.id, 'NeedsAttention')).kind).toBe('ok');

    const store = createDispatcherStore(pool, events);
    expect(await store.endTaskSessions(task.id, 'NeedsAttention', true)).toEqual([sandboxSessionId]);
    const result = await pool.request()
      .input('sandboxSessionId', sql.BigInt, BigInt(sandboxSessionId))
      .query<{ taskState: string; sessionStatus: string; endReason: string; turnStatus: string }>(`SELECT
        task.state AS taskState, session.status AS sessionStatus, session.end_reason AS endReason, turn.status AS turnStatus
        FROM dbo.sandbox_sessions AS session
        INNER JOIN dbo.tasks AS task ON task.id = session.task_id
        INNER JOIN dbo.sandbox_turns AS turn ON turn.sandbox_session_id = session.id
        WHERE session.id = @sandboxSessionId;`);
    expect(result.recordset).toEqual([{
      taskState: 'NeedsAttention', sessionStatus: 'Ended', endReason: 'done', turnStatus: 'completed',
    }]);
  });

  it('honors global limits and per-project limits using active leases', async () => {
    const events = createEventHub<TaskEventMessage>();
    const firstTask = await createTask(events, 'Global limit one');
    const secondTask = await createTask(events, 'Global limit two');
    const first = createDispatcherStore(pool, events);
    const second = createDispatcherStore(pool, events);

    const firstClaim = await first.claimNext('global-owner-one', 120, 3);
    expect(firstClaim).toMatchObject({ kind: 'claimed', task: { taskId: firstTask.id } });
    expect(await second.claimNext('global-owner-two', 120, 3)).toMatchObject({ kind: 'idle' });
    if (firstClaim.kind !== 'claimed') throw new Error('Global fixture was not claimed');
    await first.failStart('global-owner-one', firstClaim.task, null, 'test_cleanup');
    const secondClaim = await second.claimNext('global-owner-two', 120, 3);
    expect(secondClaim).toMatchObject({ kind: 'claimed', task: { taskId: secondTask.id } });
    if (secondClaim.kind !== 'claimed') throw new Error('Second global fixture was not claimed');
    await second.failStart('global-owner-two', secondClaim.task, null, 'test_cleanup');

    await pool.request().query(`INSERT dbo.settings (scope, [key], value)
      VALUES (N'global', N'global.max_parallel_tasks', N'2');`);
    const projectId = await createProject(1);
    const projectTaskOne = await createTask(events, 'Project limit one', projectId);
    const projectTaskTwo = await createTask(events, 'Project limit two', projectId);
    const projectClaim = await first.claimNext('project-owner-one', 120, 3);
    expect(projectClaim).toMatchObject({ kind: 'claimed', task: { taskId: projectTaskOne.id } });
    expect(await second.claimNext('project-owner-two', 120, 3)).toMatchObject({ kind: 'idle' });
    if (projectClaim.kind !== 'claimed') throw new Error('Project fixture was not claimed');
    await first.failStart('project-owner-one', projectClaim.task, null, 'test_cleanup');
    const nextProjectClaim = await second.claimNext('project-owner-two', 120, 3);
    expect(nextProjectClaim).toMatchObject({ kind: 'claimed', task: { taskId: projectTaskTwo.id } });
    if (nextProjectClaim.kind !== 'claimed') throw new Error('Second project fixture was not claimed');
    await second.failStart('project-owner-two', nextProjectClaim.task, null, 'test_cleanup');
  });

  it('makes no recurring SQL claims after the initial empty scan', async () => {
    const events = createEventHub<TaskEventMessage>();
    const store = createDispatcherStore(pool, events);
    const claimNext = vi.spyOn(store, 'claimNext');
    const dispatcher = new TaskDispatcher(
      store, createTaskStore(pool, events), settings(),
      () => ({ startTask: vi.fn(), deleteSession: vi.fn() }), heartbeat(), events,
    );

    dispatcher.start();
    await vi.waitFor(() => expect(claimNext).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(claimNext).toHaveBeenCalledOnce();
    await dispatcher.stop();
  });

  it('keeps a pause-requested task within project capacity and prevents backend sleep', async () => {
    const events = createEventHub<TaskEventMessage>();
    const taskStore = createTaskStore(pool, events);
    const projectId = await createProject(1);
    const pausingTask = await createTask(events, 'Pause request holds capacity', projectId);
    const queuedTask = await createTask(events, 'Wait until pause is confirmed', projectId);
    expect((await taskStore.transition(pausingTask.id, 'Running')).kind).toBe('ok');
    expect((await taskStore.transition(pausingTask.id, 'PauseRequested')).kind).toBe('ok');

    expect(await taskStore.withNoActiveTasks(async () => 'scaled down')).toEqual({ kind: 'active' });
    expect(await createDispatcherStore(pool, events).claimNext('pause-capacity-owner', 120, 3))
      .toMatchObject({ kind: 'idle' });
    expect((await taskStore.get(queuedTask.id, 1, 0))?.state).toBe('Ready');
  });
});
