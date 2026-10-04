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
  return { track: vi.fn(), untrack: vi.fn() } as unknown as SandboxHeartbeat;
}

describe('dispatcher SQL coordination', () => {
  it('starts a ready task once when two dispatcher instances race for it', async () => {
    const events = createEventHub<TaskEventMessage>();
    const taskStore = createTaskStore(pool, events);
    const task = await createTask(events, 'Competing dispatchers');
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => { resolveStarted = resolve; });
    const unsubscribe = events.subscribe((event) => {
      if (event.type === 'sandbox_started') resolveStarted();
    });
    const startFirst = vi.fn(async () => ({
      invocationId: 'invocation-first', sessionId: 'session-first', status: 'queued' as const, agent: 'copilot' as const,
    }));
    const startSecond = vi.fn(async () => ({
      invocationId: 'invocation-second', sessionId: 'session-second', status: 'queued' as const, agent: 'copilot' as const,
    }));
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

  it('reuses the Foundry session and accumulates sandbox usage across pause and resume', async () => {
    const events = createEventHub<TaskEventMessage>();
    const taskStore = createTaskStore(pool, events);
    const task = await createTask(events, 'Pause and resume');
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
