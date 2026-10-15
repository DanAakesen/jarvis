import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEventHub } from '../core/event-hub.js';
import type { SettingsStore } from '../core/settings.js';
import { TaskDispatcher } from '../factory/dispatcher.js';
import { SandboxHeartbeat } from '../factory/heartbeat.js';
import type { TaskEventHub, TaskEventMessage } from '../factory/task-store.js';
import { createProjectPolicyEvaluator, type PolicyPullRequest } from '../github/project-policy.js';
import { createTaskStore } from './task-store.js';
import { createDispatcherStore } from './dispatcher-store.js';
import { createTaskRecoveryStore } from './recovery-store.js';
import { createProjectPolicyStore } from './project-policy-store.js';
import { createSandboxHeartbeatStore } from './sandbox-heartbeat-store.js';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readMigrations } from './migrations.js';

const configuration = loadDatabaseConfig();
if (!configuration || process.env.NODE_ENV !== 'test' || configuration.server !== '127.0.0.1') {
  throw new Error('Dispatcher integration tests require an isolated loopback SQL Server test configuration');
}

const database = `jarvis_dispatch_${randomUUID().replaceAll('-', '')}`;
const administrator = new sql.ConnectionPool({ ...configuration, database: 'master' });
const pool = new sql.ConnectionPool({ ...configuration, database });
const workCommitSha = 'a'.repeat(40);

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

async function completedRecoveryFixture() {
  const events = createEventHub<TaskEventMessage>();
  const tasks = createTaskStore(pool, events);
  const sessions = createDispatcherStore(pool, events);
  const policy = createProjectPolicyStore(pool);
  const task = await createTask(events, 'Recovery generation fixture');
  const foundrySessionId = `previous-session-${randomUUID()}`;
  const invocationId = `previous-invocation-${randomUUID()}`;
  expect((await tasks.transition(task.id, 'Running')).kind).toBe('ok');
  const inserted = await pool.request()
    .input('taskId', sql.BigInt, BigInt(task.id))
    .input('foundrySessionId', sql.NVarChar(255), foundrySessionId)
    .input('invocationId', sql.NVarChar(255), invocationId)
    .query<{ id: string }>(`UPDATE dbo.tasks SET branch = CONCAT(N'jarvis/task-', id) WHERE id = @taskId;
      DECLARE @session TABLE (id bigint);
      INSERT dbo.sandbox_sessions
        (task_id, foundry_session_id, agent_version, agent_name, size, image, status, end_reason, ended_at)
      OUTPUT inserted.id INTO @session
      VALUES (@taskId, @foundrySessionId, N'fixture', N'jarvis-runner-base-1x2',
        N'1x2', N'fixture', N'Ended', N'done', SYSUTCDATETIME());
      INSERT dbo.sandbox_turns (sandbox_session_id, invocation_id, mode, acp_session_id, status, ended_at)
      SELECT id, @invocationId, N'task', N'fixture', N'completed', SYSUTCDATETIME() FROM @session;
      SELECT CAST(id AS varchar(19)) AS id FROM @session;`);
  const sandboxSessionId = inserted.recordset[0]?.id;
  if (!sandboxSessionId) throw new Error('Completed recovery fixture was not inserted');
  const proof = { sandboxSessionId, foundrySessionId, invocationId, executionGeneration: '0', workCommitSha };
  await tasks.recordEvent({ taskId: task.id, type: 'runner_completion_verified', source: 'backend', payload: proof });
  await expect(policy.withActiveTask(task.id, async () => 'previous', workCommitSha)).resolves.toEqual({
    kind: 'active', value: 'previous',
  });
  expect((await tasks.transition(task.id, 'NeedsAttention')).kind).toBe('ok');
  return { events, tasks, sessions, policy, task, proof };
}

function heartbeat(): SandboxHeartbeat {
  return {
    track: vi.fn(), untrack: vi.fn(), setCompletionHandler: vi.fn(), hasTrackedSessions: vi.fn(() => false),
  } as unknown as SandboxHeartbeat;
}

describe('dispatcher SQL coordination', () => {
  it.each(['heartbeat', 'reconciliation'] as const)(
    'retains completed lifecycle without delivery proof or early events: %s', async (route) => {
      const { events, tasks, sessions, policy, task } = await completedRecoveryFixture();
      const recovery = createTaskRecoveryStore(pool, events);
      const owner = `unverified-completion-${randomUUID()}`;
      const claim = await recovery.claimRecovery(task.id, owner, 120);
      if (claim.kind !== 'claimed') throw new Error('Unverified-completion recovery was not claimed');
      const accepted = { sessionId: `legacy-session-${randomUUID()}`, invocationId: `legacy-${randomUUID()}` };
      const sandboxSessionId = await sessions.recordStarted(owner, claim.task, 'jarvis-runner-base-1x2', accepted);
      const sandbox = {
        sandboxSessionId, executionGeneration: claim.task.executionGeneration,
        foundrySessionId: accepted.sessionId, invocationId: accepted.invocationId, agentName: 'jarvis-runner-base-1x2',
      };
      const lifecycle = async () => (await pool.request()
        .input('sessionId', sql.BigInt, BigInt(sandboxSessionId))
        .input('invocationId', sql.NVarChar(255), accepted.invocationId)
        .query<{ sessionStatus: string; endReason: string | null; turnStatus: string }>(`SELECT
          session.status AS sessionStatus, session.end_reason AS endReason, turn.status AS turnStatus
          FROM dbo.sandbox_sessions AS session INNER JOIN dbo.sandbox_turns AS turn
            ON turn.sandbox_session_id = session.id
          WHERE session.id = @sessionId AND turn.invocation_id = @invocationId;`)).recordset[0];
      const errors: unknown[] = [];
      const client = {
        startTask: vi.fn(), steer: vi.fn(), pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(), deleteSession: vi.fn(),
        status: vi.fn(async () => ({
          ...accepted, status: 'completed' as const, agent: 'copilot' as const, startedAt: 1, finishedAt: 2,
          result: null, events: [], error: null,
        })),
      };
      const monitor = new SandboxHeartbeat({
        ...createSandboxHeartbeatStore(pool, events),
        listRunning: async () => route === 'heartbeat' ? [sandbox] : [],
      }, () => client, { onError: (error) => errors.push(error) });
      const verifyDelivery = vi.fn(async () => ({ kind: 'awaiting_policy' as const }));
      vi.spyOn(sessions, 'claimNext').mockResolvedValue({ kind: 'idle', nextAttemptAt: null });
      const observationTime = Date.now() + (route === 'reconciliation' ? 10 * 60_000 : 0);
      const dispatcher = new TaskDispatcher(sessions, tasks, settings(), () => client, monitor, events, {
        recoveryStore: recovery, workspaceFor: async () => claim.task, verifyDelivery,
        now: () => observationTime,
        onError: (error) => errors.push(error),
      });
      try {
        expect(await lifecycle()).toEqual({ sessionStatus: 'Active', endReason: null, turnStatus: 'running' });
        dispatcher.start();
        if (route === 'heartbeat') await monitor.start();
        await vi.waitFor(async () => {
          expect((await tasks.get(task.id, 20, 0))?.state).toBe('NeedsAttention');
          expect(await lifecycle()).toEqual({ sessionStatus: 'Ended', endReason: 'done', turnStatus: 'completed' });
          expect(monitor.hasTrackedSessions()).toBe(false);
        }, { timeout: 15_000 });
        expect(errors).toEqual([]);
        expect(verifyDelivery).not.toHaveBeenCalled();
        const detail = await tasks.get(task.id, 20, 0);
        expect(detail?.events).toContainEqual(expect.objectContaining({
          type: 'state_changed', source: 'backend',
          payload: { from: 'Running', to: 'NeedsAttention', reason: 'unverified_completion' },
        }));
        const proof = detail?.events.find((event) => event.type === 'runner_completion_verified' &&
          event.payload !== null && typeof event.payload === 'object' &&
          'invocationId' in event.payload && event.payload.invocationId === accepted.invocationId);
        expect(proof).toBeUndefined();
        const operation = vi.fn(async () => 'must not complete');
        await expect(policy.withActiveTask(task.id, operation, workCommitSha))
          .resolves.toEqual({ kind: 'awaiting_runner' });
        expect(operation).not.toHaveBeenCalled();
      } finally {
        await Promise.all([monitor.stop(), dispatcher.stop()]);
        await sessions.endTaskSessions(task.id, 'Cancelled');
        await tasks.transition(task.id, 'Cancelled');
      }
    },
  );

  it.each([
    { status: 'failed', workCompleted: true, providerStopped: true, phase: 'event_delivery',
      question: false, publishedHead: workCommitSha, expected: 'Done' },
    { status: 'failed', workCompleted: false, providerStopped: true, phase: 'event_delivery',
      question: false, publishedHead: workCommitSha, expected: 'NeedsAttention' },
    { status: 'failed', workCompleted: true, providerStopped: false, phase: 'provider_shutdown',
      question: false, publishedHead: workCommitSha, expected: 'NeedsAttention' },
    { status: 'failed', workCompleted: true, providerStopped: true, phase: 'event_delivery',
      question: true, publishedHead: workCommitSha, expected: 'NeedsAttention' },
    { status: 'failed', workCompleted: true, providerStopped: true, phase: 'event_delivery',
      question: false, publishedHead: 'b'.repeat(40), expected: 'NeedsAttention' },
    { status: 'completed', workCompleted: true, providerStopped: true, phase: 'event_delivery',
      question: false, publishedHead: workCommitSha, expected: 'Done' },
    { status: 'completed', workCompleted: true, providerStopped: true, phase: 'event_delivery',
      question: false, publishedHead: 'b'.repeat(40), expected: 'NeedsAttention' },
    { status: 'completed', workCompleted: false, providerStopped: true, phase: 'event_delivery',
      question: true, publishedHead: workCommitSha, expected: 'NeedsAttention' },
  ] as const)('SQL-gates stopped-writer completion with mocked delivery: %j', async (control) => {
    const { events, tasks, sessions, policy, task } = await completedRecoveryFixture();
    const recovery = createTaskRecoveryStore(pool, events);
    const owner = `completion-proof-${randomUUID()}`;
    const claim = await recovery.claimRecovery(task.id, owner, 120);
    if (claim.kind !== 'claimed') throw new Error('Completion-proof recovery was not claimed');
    const accepted = { sessionId: `replacement-session-${randomUUID()}`, invocationId: `replacement-${randomUUID()}` };
    const sandboxSessionId = await sessions.recordStarted(owner, claim.task, 'jarvis-runner-base-1x2', accepted);
    const sandbox = {
      sandboxSessionId, executionGeneration: claim.task.executionGeneration,
      foundrySessionId: accepted.sessionId, invocationId: accepted.invocationId, agentName: 'jarvis-runner-base-1x2',
    };
    const errors: unknown[] = [];
    const client = {
      startTask: vi.fn(), steer: vi.fn(), pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(), deleteSession: vi.fn(),
      status: vi.fn(async () => ({
        ...accepted, status: control.status, agent: 'copilot' as const, startedAt: 1, finishedAt: 2,
        result: null, events: control.question ? [{ at: 1.5, kind: 'session_question', data: {} }] : [],
        error: control.status === 'failed' ? `Runner finalization timed out: ${control.phase}` : null,
        workCompleted: control.workCompleted, providerStopped: control.providerStopped, workCommitSha,
        cleanupPhases: [control.phase],
      })),
    };
    const monitor = new SandboxHeartbeat({
      ...createSandboxHeartbeatStore(pool, events), listRunning: async () => [sandbox],
    }, () => client, { onError: (error) => errors.push(error) });
    const verifyDelivery = vi.fn(async () => {
      const eligibility = await policy.withActiveTask(task.id, async () => {
        expect((await tasks.transition(task.id, 'Done', true)).kind).toBe('ok');
      }, control.publishedHead);
      if (control.publishedHead !== workCommitSha) {
        expect(eligibility.kind).toBe('awaiting_runner');
        return { kind: 'refused' as const, reason: 'The published head does not match the current work commit.' };
      }
      expect(eligibility.kind).toBe('active');
      return { kind: 'awaiting_policy' as const };
    });
    const dispatcher = new TaskDispatcher(sessions, tasks, settings(), () => client, monitor, events, {
      recoveryStore: recovery,
      workspaceFor: async () => claim.task,
      verifyDelivery,
    });
    try {
      await monitor.start();
      await vi.waitFor(async () => {
        expect((await tasks.get(task.id, 20, 0))?.state).toBe(control.expected);
        expect(monitor.hasTrackedSessions()).toBe(false);
      }, { timeout: 15_000 });
      expect(errors).toEqual([]);
      const validRuntime = control.workCompleted && control.providerStopped && !control.question;
      expect(verifyDelivery).toHaveBeenCalledTimes(validRuntime ? 1 : 0);
      const detail = await tasks.get(task.id, 20, 0);
      const proof = detail?.events.find((event) => event.type === 'runner_completion_verified' &&
        event.payload !== null && typeof event.payload === 'object' &&
        'executionGeneration' in event.payload && event.payload.executionGeneration === claim.task.executionGeneration);
      if (validRuntime) {
        expect(proof).toMatchObject({
          source: 'backend',
          payload: {
            sandboxSessionId, foundrySessionId: accepted.sessionId, invocationId: accepted.invocationId,
            executionGeneration: '1',
            ...(control.status === 'failed' ? { completionKind: 'work_completed_writer_stopped' } : {}),
            workCommitSha,
            ...(control.status === 'failed' ? { cleanupPhases: ['event_delivery'] } : {}),
          },
        });
      } else {
        expect(proof).toBeUndefined();
      }
    } finally {
      await Promise.all([monitor.stop(), dispatcher.stop()]);
      await sessions.endTaskSessions(task.id, 'Done');
      await pool.request().input('taskId', sql.BigInt, BigInt(task.id))
        .query("UPDATE dbo.tasks SET state = N'Done' WHERE id = @taskId;");
    }
  });

  it.each(['Running', 'PauseRequested', 'NeedsAttention'] as const)(
    'records explicit failure after an early completion without inferring expiry from %s',
    async (state) => {
      const events = createEventHub<TaskEventMessage>();
      const tasks = createTaskStore(pool, events);
      const store = createSandboxHeartbeatStore(pool, events);
      const task = await createTask(events, 'Failure after early completion');
      const invocationId = `failed-invocation-${randomUUID()}`;
      try {
        expect((await tasks.transition(task.id, 'Running')).kind).toBe('ok');
        const session = await pool.request()
          .input('taskId', sql.BigInt, BigInt(task.id))
          .input('foundrySessionId', sql.NVarChar(255), `failure-session-${randomUUID()}`)
          .query<{ id: string }>(`INSERT dbo.sandbox_sessions
            (task_id, foundry_session_id, agent_version, agent_name, size, image, status)
            OUTPUT CAST(inserted.id AS varchar(19)) AS id
            VALUES (@taskId, @foundrySessionId, N'1', N'jarvis-runner-base-1x2', N'1x2', N'fixture', N'Active');`);
        const sandboxSessionId = session.recordset[0]?.id;
        if (!sandboxSessionId) throw new Error('Failure session fixture was not created');
        await pool.request()
          .input('sandboxSessionId', sql.BigInt, BigInt(sandboxSessionId))
          .input('invocationId', sql.NVarChar(255), invocationId)
          .query(`INSERT dbo.sandbox_turns (sandbox_session_id, invocation_id, mode, acp_session_id, status)
            VALUES (@sandboxSessionId, @invocationId, N'task', N'fixture-acp', N'running');`);
        await tasks.recordEvent({
          taskId: task.id, source: 'runner', type: state === 'NeedsAttention' ? 'session_question' : 'completed',
          payload: { invocationId, data: { question: 'Synthetic question' } },
        });
        if (state === 'PauseRequested') {
          expect((await tasks.transition(task.id, state)).kind).toBe('ok');
        }
        expect((await tasks.get(task.id, 1, 0))?.state).toBe(state);
        await store.recordHeartbeat(sandboxSessionId, invocationId, false);

        expect(await store.markNeedsAttention(sandboxSessionId, undefined, invocationId, true, true)).toBe('crashed');

        const after = await pool.request()
          .input('sandboxSessionId', sql.BigInt, BigInt(sandboxSessionId))
          .query<{ sessionStatus: string; endReason: string; turnStatus: string }>(`SELECT
            session.status AS sessionStatus, session.end_reason AS endReason, turn.status AS turnStatus
            FROM dbo.sandbox_sessions AS session INNER JOIN dbo.sandbox_turns AS turn
              ON turn.sandbox_session_id = session.id WHERE session.id = @sandboxSessionId;`);
        expect(after.recordset[0]).toEqual({ sessionStatus: 'Crashed', endReason: 'crashed', turnStatus: 'failed' });
        expect(await tasks.get(task.id, 10, 0)).toMatchObject({
          state: 'NeedsAttention',
          events: expect.arrayContaining([expect.objectContaining({
            type: 'state_changed', source: 'backend',
            payload: { from: state, to: 'NeedsAttention', reason: 'foundry_failed' },
          })]),
        });
        await tasks.recordEvent({ taskId: task.id, type: 'completed', source: 'runner', payload: { invocationId } });
        const late = await pool.request()
          .input('sandboxSessionId', sql.BigInt, BigInt(sandboxSessionId))
          .query<{ status: string }>('SELECT status FROM dbo.sandbox_turns WHERE sandbox_session_id = @sandboxSessionId;');
        expect(late.recordset[0]?.status).toBe('failed');
      } finally {
        await pool.request().input('taskId', sql.BigInt, BigInt(task.id))
          .query("UPDATE dbo.tasks SET state = N'Done' WHERE id = @taskId;");
      }
    },
  );

  it('serializes recovery claim behind an in-flight policy operation', async () => {
    const { events, tasks, sessions, policy, task } = await completedRecoveryFixture();
    let unlock!: () => void;
    let acquired!: () => void;
    const release = new Promise<void>((resolve) => { unlock = resolve; });
    const entered = new Promise<void>((resolve) => { acquired = resolve; });
    const policyOperation = policy.withActiveTask(task.id, async () => {
      acquired();
      await release;
      return 'previous';
    }, workCommitSha);
    let recovery: ReturnType<ReturnType<typeof createTaskRecoveryStore>['claimRecovery']> | undefined;
    try {
      await entered;
      recovery = createTaskRecoveryStore(pool, events).claimRecovery(task.id, `locked-${randomUUID()}`, 120);
      await vi.waitFor(async () => {
        const waiting = await pool.request()
          .input('resource', sql.NVarChar(255), `%jarvis.project-policy:${task.id}%`)
          .query<{ count: number }>(`SELECT COUNT(*) AS count FROM sys.dm_tran_locks
            WHERE resource_type = N'APPLICATION' AND resource_database_id = DB_ID()
              AND request_status = N'WAIT' AND resource_description LIKE @resource;`);
        expect(waiting.recordset[0]?.count).toBeGreaterThan(0);
      }, { timeout: 5_000 });
      const before = await pool.request().input('taskId', sql.BigInt, BigInt(task.id))
        .query<{ state: string; generation: string }>(`SELECT state,
          CAST(execution_generation AS varchar(19)) AS generation FROM dbo.tasks WHERE id = @taskId;`);
      expect(before.recordset[0]).toEqual({ state: 'NeedsAttention', generation: '0' });
      unlock();
      await expect(policyOperation).resolves.toEqual({ kind: 'active', value: 'previous' });
      await expect(recovery).resolves.toMatchObject({ kind: 'claimed', task: { executionGeneration: '1' } });
    } finally {
      unlock();
      await policyOperation;
      await recovery;
      await sessions.endTaskSessions(task.id, 'Cancelled');
      await tasks.transition(task.id, 'Cancelled');
    }
  });

  it.each(['pending', 'failed', 'replacement-running', 'replacement-completed'] as const)(
    'fences the previous completion generation while recovery is %s',
    async (scenario) => {
      const { events, tasks, sessions, policy, task, proof } = await completedRecoveryFixture();
      const owner = `generation-${randomUUID()}`;
      const operation = vi.fn(async () => 'current');
      try {
        const recovery = await createTaskRecoveryStore(pool, events).claimRecovery(task.id, owner, 120);
        if (recovery.kind !== 'claimed') throw new Error(`Recovery not claimed: ${recovery.kind}`);
        expect(recovery.task.executionGeneration).toBe('1');
        await expect(policy.withActiveTask(task.id, operation, workCommitSha)).resolves.toEqual({ kind: 'awaiting_runner' });
        if (scenario === 'failed') {
          await sessions.failStart(owner, recovery.task, null, 'recovery_start_failed');
          // Even a newly received proof for the old session cannot claim the new generation.
          await tasks.recordEvent({
            taskId: task.id, type: 'runner_completion_verified', source: 'backend',
            payload: { ...proof, executionGeneration: recovery.task.executionGeneration },
          });
          const retained = await pool.request().input('taskId', sql.BigInt, BigInt(task.id))
            .query<{ generation: string; leaseOwner: string | null }>(`SELECT
              CAST(execution_generation AS varchar(19)) AS generation, lease_owner AS leaseOwner
              FROM dbo.tasks WHERE id = @taskId;`);
          expect(retained.recordset[0]).toEqual({ generation: '1', leaseOwner: null });
        } else if (scenario.startsWith('replacement-')) {
          const accepted = { sessionId: `replacement-${randomUUID()}`, invocationId: `replacement-${randomUUID()}` };
          const sandboxSessionId = await sessions.recordStarted(owner, recovery.task, 'jarvis-runner-base-1x2', accepted);
          const payload = { sandboxSessionId, foundrySessionId: accepted.sessionId, invocationId: accepted.invocationId, workCommitSha };
          await tasks.recordEvent({
            taskId: task.id, type: 'runner_completion_verified', source: 'backend',
            payload: { ...payload, executionGeneration: '0' },
          });
          if (scenario === 'replacement-completed') {
            await tasks.recordEvent({
              taskId: task.id, type: 'completed', source: 'runner', payload: { invocationId: accepted.invocationId },
            });
            await expect(policy.withActiveTask(task.id, operation, workCommitSha)).resolves.toEqual({ kind: 'awaiting_runner' });
            await tasks.recordEvent({
              taskId: task.id, type: 'runner_completion_verified', source: 'backend',
              payload: { ...payload, executionGeneration: recovery.task.executionGeneration },
            });
          }
        }
        const complete = scenario === 'replacement-completed';
        await expect(policy.withActiveTask(task.id, operation, workCommitSha)).resolves.toEqual(
          complete ? { kind: 'active', value: 'current' } : { kind: 'awaiting_runner' },
        );
        expect(operation).toHaveBeenCalledTimes(complete ? 1 : 0);
      } finally {
        await sessions.endTaskSessions(task.id, 'Cancelled');
        await tasks.transition(task.id, 'Cancelled');
      }
    },
  );

  it('rejects late callbacks after a failed start and a second recovery by the same dispatcher owner', async () => {
    const { events, tasks, sessions, policy, task } = await completedRecoveryFixture();
    const owner = `reused-owner-${randomUUID()}`;
    try {
      const recoveryStore = createTaskRecoveryStore(pool, events);
      const first = await recoveryStore.claimRecovery(task.id, owner, 120);
      if (first.kind !== 'claimed') throw new Error(`First recovery not claimed: ${first.kind}`);
      await sessions.failStart(owner, first.task, null, 'recovery_start_failed');
      const second = await recoveryStore.claimRecovery(task.id, owner, 120);
      if (second.kind !== 'claimed') throw new Error(`Second recovery not claimed: ${second.kind}`);
      expect(second.task.executionGeneration).toBe('2');
      await expect(sessions.recordStarted(owner, first.task, 'jarvis-runner-base-1x2', {
        sessionId: `late-session-${randomUUID()}`, invocationId: `late-invocation-${randomUUID()}`,
      })).rejects.toThrow('Dispatcher could not persist');
      await expect(sessions.failStart(owner, first.task, null, 'late_failure'))
        .rejects.toThrow('Dispatcher could not record');
      const accepted = { sessionId: `current-session-${randomUUID()}`, invocationId: `current-invocation-${randomUUID()}` };
      const sandboxSessionId = await sessions.recordStarted(owner, second.task, 'jarvis-runner-base-1x2', accepted);
      await tasks.recordEvent({
        taskId: task.id, type: 'completed', source: 'runner', payload: { invocationId: accepted.invocationId },
      });
      await tasks.recordEvent({
        taskId: task.id, type: 'runner_completion_verified', source: 'backend',
        payload: {
          sandboxSessionId, foundrySessionId: accepted.sessionId, invocationId: accepted.invocationId,
          executionGeneration: second.task.executionGeneration,
          workCommitSha,
        },
      });
      await expect(policy.withActiveTask(task.id, async () => 'replacement', workCommitSha)).resolves.toEqual({
        kind: 'active', value: 'replacement',
      });
    } finally {
      await sessions.endTaskSessions(task.id, 'Cancelled');
      await tasks.transition(task.id, 'Cancelled');
    }
  });

  it.each(['pending', 'failed', 'replacement-completed'] as const)(
    'does not execute a deferred merge approval released while replacement start is %s',
    async (scenario) => {
      const { events, tasks, sessions, policy, task } = await completedRecoveryFixture();
      const owner = `approval-generation-${randomUUID()}`;
      const project: PolicyPullRequest = {
        taskId: task.id, taskState: 'NeedsAttention', repository: 'DanAakesen/jarvis-test-target',
        policy: 'complete_without_deployment', number: 42, state: 'open', checks: 'passed',
        headSha: 'a'.repeat(40), openedAt: new Date().toISOString(),
      };
      let releaseApproval!: () => void;
      let ready!: () => void;
      let finished!: () => void;
      const approval = new Promise<void>((resolve) => { releaseApproval = resolve; });
      const readyPromise = new Promise<void>((resolve) => { ready = resolve; });
      const finishedPromise = new Promise<void>((resolve) => { finished = resolve; });
      const issue = vi.fn(async () => 'synthetic-write-token');
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        if ((init?.method ?? 'GET') !== 'GET') throw new Error('Unexpected synthetic GitHub write');
        const url = String(input);
        if (url.endsWith('/pulls/42')) return new Response(JSON.stringify({
          state: 'open', merged: false, draft: false, head: { sha: project.headSha },
          base: { ref: 'main', sha: 'b'.repeat(40) }, mergeable: true, mergeable_state: 'clean',
        }));
        if (url.endsWith('/check-runs?per_page=100')) return new Response(JSON.stringify({
          total_count: 1, check_runs: [{
            id: 1, name: 'CI', app: { id: 12 }, status: 'completed', conclusion: 'success',
          }],
        }));
        if (url.endsWith('/status')) return new Response(JSON.stringify({ state: 'success', total_count: 0, statuses: [] }));
        if (url.endsWith('/branches/main')) return new Response(JSON.stringify({ commit: { sha: 'b'.repeat(40) } }));
        throw new Error('Unexpected synthetic GitHub read');
      });
      const readToken = async () => 'synthetic-read-token';
      const evaluator = createProjectPolicyEvaluator({
        store: { ...policy, getPullRequest: async () => project }, tasks, fetch,
        tokenIssuer: {
          issue, issueForActions: readToken, issueForChecks: readToken, issueForContents: readToken,
          issueForRepositoryRead: readToken, issueForContentsWrite: issue,
          issueForIssuesWrite: issue,
        },
        async runConfirmed<T>(_summary: string, action: () => Promise<T>): Promise<T> {
          ready();
          await approval;
          try { return await action(); }
          finally { finished(); }
        },
      });
      try {
        await evaluator.handle({
          kind: 'pull_request', repository: project.repository, number: 42, branch: `jarvis/task-${task.id}`,
          headSha: project.headSha, state: 'open', openedAt: project.openedAt, mergedAt: null,
        });
        await readyPromise;
        const recovery = await createTaskRecoveryStore(pool, events).claimRecovery(task.id, owner, 120);
        if (recovery.kind !== 'claimed') throw new Error(`Recovery not claimed: ${recovery.kind}`);
        if (scenario === 'failed') await sessions.failStart(owner, recovery.task, null, 'recovery_start_failed');
        if (scenario === 'replacement-completed') {
          const accepted = { sessionId: `approval-session-${randomUUID()}`, invocationId: `approval-${randomUUID()}` };
          const sandboxSessionId = await sessions.recordStarted(owner, recovery.task, 'jarvis-runner-base-1x2', accepted);
          await tasks.recordEvent({
            taskId: task.id, type: 'completed', source: 'runner', payload: { invocationId: accepted.invocationId },
          });
          await tasks.recordEvent({
            taskId: task.id, type: 'runner_completion_verified', source: 'backend',
            payload: {
              sandboxSessionId, foundrySessionId: accepted.sessionId, invocationId: accepted.invocationId,
              executionGeneration: recovery.task.executionGeneration, workCommitSha: 'c'.repeat(40),
            },
          });
          await expect(policy.withActiveTask(task.id, async () => 'new work', 'c'.repeat(40)))
            .resolves.toEqual({ kind: 'active', value: 'new work' });
        }
        releaseApproval();
        await finishedPromise;
        expect(issue).not.toHaveBeenCalled();
        expect(fetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
      } finally {
        releaseApproval();
        await sessions.endTaskSessions(task.id, 'Cancelled');
        await tasks.transition(task.id, 'Cancelled');
      }
    },
  );

  it.each([
    'no-runtime', 'missing', 'early-completed', 'runner-proof', 'wrong-session', 'wrong-foundry-session',
    'wrong-invocation', 'older-turn', 'newer-session', 'crashed', 'cancelled',
    'unbound-commit', 'wrong-commit', 'case-foundry-session', 'case-invocation',
    'current', 'ended', 'idle-expired',
  ] as const)('gates project policy on the current backend-verified runner: %s', async (scenario) => {
    const events = createEventHub<TaskEventMessage>();
    const tasks = createTaskStore(pool, events);
    const sessions = createDispatcherStore(pool, events);
    const policy = createProjectPolicyStore(pool);
    const task = await createTask(events, 'Verified runtime policy fixture');
    const foundrySessionId = `policy-session-${randomUUID()}`;
    const invocationId = `policy-invocation-${randomUUID()}`;
    const operation = vi.fn(async () => 'verified');
    try {
      expect((await tasks.transition(task.id, 'Running')).kind).toBe('ok');
      if (scenario === 'no-runtime') {
        await expect(policy.withActiveTask(task.id, operation, workCommitSha)).resolves.toEqual({ kind: 'awaiting_runner' });
        expect(operation).not.toHaveBeenCalled();
        return;
      }
      const inserted = await pool.request()
        .input('taskId', sql.BigInt, BigInt(task.id))
        .input('foundrySessionId', sql.NVarChar(255), foundrySessionId)
        .query<{ id: string }>(`INSERT dbo.sandbox_sessions
          (task_id, foundry_session_id, agent_version, agent_name, size, image, status, started_at)
          OUTPUT CAST(inserted.id AS varchar(19)) AS id
          VALUES (@taskId, @foundrySessionId, N'1', N'jarvis-runner-base-1x2', N'1x2', N'fixture',
            N'Active', DATEADD(minute, -2, SYSUTCDATETIME()));`);
      const sandboxSessionId = inserted.recordset[0]?.id;
      if (!sandboxSessionId) throw new Error('Policy session fixture was not created');
      await pool.request()
        .input('sandboxSessionId', sql.BigInt, BigInt(sandboxSessionId))
        .input('invocationId', sql.NVarChar(255), invocationId)
        .query(`INSERT dbo.sandbox_turns
          (sandbox_session_id, invocation_id, mode, acp_session_id, status, started_at)
          VALUES (@sandboxSessionId, @invocationId, N'task', N'fixture', N'running',
            DATEADD(minute, -2, SYSUTCDATETIME()));`);
      if (scenario !== 'missing') {
        await tasks.recordEvent({
          taskId: task.id, type: 'completed', source: 'runner', payload: { invocationId },
        });
      }
      if (scenario !== 'missing' && scenario !== 'early-completed') {
        await tasks.recordEvent({
          taskId: task.id, type: 'runner_completion_verified',
          source: scenario === 'runner-proof' ? 'runner' : 'backend',
          payload: {
            executionGeneration: '0',
            ...(scenario === 'unbound-commit' ? {} : {
              workCommitSha: scenario === 'wrong-commit' ? 'b'.repeat(40) : workCommitSha,
            }),
            sandboxSessionId: scenario === 'wrong-session' ? '0' : sandboxSessionId,
            foundrySessionId: scenario === 'wrong-foundry-session' ? 'other-session'
              : scenario === 'case-foundry-session' ? foundrySessionId.toUpperCase() : foundrySessionId,
            invocationId: scenario === 'wrong-invocation' ? 'other-invocation'
              : scenario === 'case-invocation' ? invocationId.toUpperCase() : invocationId,
          },
        });
      }
      if (scenario === 'older-turn') {
        await pool.request()
          .input('sandboxSessionId', sql.BigInt, BigInt(sandboxSessionId))
          .query(`INSERT dbo.sandbox_turns (sandbox_session_id, invocation_id, mode, acp_session_id, status)
            VALUES (@sandboxSessionId, N'newer-invocation', N'steer', N'fixture', N'running');`);
      }
      if (scenario === 'newer-session') {
        await pool.request().input('taskId', sql.BigInt, BigInt(task.id))
          .query(`INSERT dbo.sandbox_sessions
            (task_id, foundry_session_id, agent_version, agent_name, size, image, status)
            VALUES (@taskId, N'newer-foundry-session', N'1', N'jarvis-runner-base-1x2', N'1x2', N'fixture', N'Active');`);
      }
      if (scenario === 'crashed' || scenario === 'ended' || scenario === 'idle-expired') {
        await pool.request()
          .input('sandboxSessionId', sql.BigInt, BigInt(sandboxSessionId))
          .input('status', sql.NVarChar(8), scenario === 'crashed' ? 'Crashed' : 'Ended')
          .input('reason', sql.NVarChar(32), scenario === 'crashed' ? 'crashed' : scenario === 'ended' ? 'done' : 'idle_expired')
          .query(`UPDATE dbo.sandbox_sessions SET status = @status, end_reason = @reason,
            ended_at = SYSUTCDATETIME() WHERE id = @sandboxSessionId;`);
      }
      if (scenario === 'cancelled') expect((await tasks.transition(task.id, 'Cancelled')).kind).toBe('ok');
      const eligible = scenario === 'current' || scenario === 'ended' || scenario === 'idle-expired';

      await expect(policy.withActiveTask(task.id, operation, workCommitSha)).resolves.toEqual(
        eligible ? { kind: 'active', value: 'verified' }
          : { kind: scenario === 'cancelled' ? 'inactive' : 'awaiting_runner' },
      );
      expect(operation).toHaveBeenCalledTimes(eligible ? 1 : 0);
    } finally {
      await sessions.endTaskSessions(task.id, 'Cancelled');
      await tasks.transition(task.id, 'Cancelled');
    }
  });

  it.each(['unchanged', 'first-session'] as const)(
    'guards pre-start attention cancellation when runtime is %s', async (runtimeChange) => {
      const events = createEventHub<TaskEventMessage>();
      const tasks = createTaskStore(pool, events);
      const sessions = createDispatcherStore(pool, events);
      const task = await createTask(events, 'Failed before recording a session');
      const owner = randomUUID();
      const transition = tasks.transition.bind(tasks);
      const endSessions = vi.spyOn(sessions, 'endTaskSessions');
      const client = {
        startTask: vi.fn(), steer: vi.fn(), pause: vi.fn(), resume: vi.fn(), status: vi.fn(),
        cancel: vi.fn(async (invocationId: string) => ({ invocationId, status: 'cancelled' as const })),
        deleteSession: vi.fn(async () => {}),
      };
      const clientFor = vi.fn(() => client);
      const dispatcher = new TaskDispatcher(sessions, tasks, settings(), clientFor, heartbeat(), events);
      try {
        const claim = await sessions.claimNext(owner, 120, 3);
        if (claim.kind !== 'claimed') throw new Error('Pre-start task was not claimed');
        expect(claim.task.taskId).toBe(task.id);
        await sessions.failStart(owner, claim.task, null, 'synthetic_prestart_failure');
        expect(await tasks.get(task.id, 1, 0)).toMatchObject({
          state: 'NeedsAttention', latestSessionEndReason: null,
        });
        const absent = {
          sandboxSessionId: null, foundrySessionId: null, sessionStatus: null, latestTurnId: null,
        };
        expect(await sessions.getRuntimeVersion(task.id)).toEqual(absent);
        expect(await sessions.getControlTarget(task.id)).toBeNull();
        const publish = vi.spyOn(events, 'publish');
        const foundryId = `first-runtime-${randomUUID()}`;
        const invocationId = `first-invocation-${randomUUID()}`;
        if (runtimeChange === 'first-session') {
          // Recovery must finish before testing the stale snapshot, not wait inside cancellation's policy lock.
          const recovery = await createTaskRecoveryStore(pool, events).claimRecovery(task.id, owner, 120);
          if (recovery.kind !== 'claimed') throw new Error('Pre-start recovery was not claimed');
          await sessions.recordStarted(owner, recovery.task, 'jarvis-runner-base-1x2', {
            sessionId: foundryId, invocationId,
          });
          expect((await transition(task.id, 'NeedsAttention')).kind).toBe('ok');
          publish.mockClear();
          await expect(transition(task.id, 'Cancelled', false, undefined, undefined, 'NeedsAttention', absent))
            .resolves.toMatchObject({ kind: 'invalid-transition' });
          expect(await tasks.get(task.id, 1, 0)).toMatchObject({ state: 'NeedsAttention' });
          expect(await sessions.getRuntimeVersion(task.id)).toMatchObject({
            foundrySessionId: foundryId, sessionStatus: 'Active',
          });
          expect((await sessions.getControlTarget(task.id))?.invocationId).toBe(invocationId);
          expect(endSessions).not.toHaveBeenCalled();
          expect(clientFor).not.toHaveBeenCalled();
          expect(publish).not.toHaveBeenCalled();
          const cancelledEvents = await pool.request().input('taskId', sql.BigInt, BigInt(task.id))
            .query(`SELECT id FROM dbo.task_events WHERE task_id = @taskId
              AND type = N'state_changed' AND JSON_VALUE(payload, '$.to') = N'Cancelled';`);
          expect(cancelledEvents.recordset).toEqual([]);
        }

        await expect(dispatcher.control(task.id, { action: 'cancel' }))
          .resolves.toMatchObject({ kind: 'ok', task: { state: 'Cancelled' } });
        expect(await tasks.get(task.id, 1, 0)).toMatchObject({ state: 'Cancelled' });
        if (runtimeChange === 'unchanged') {
          expect(await sessions.getRuntimeVersion(task.id)).toEqual(absent);
          expect(clientFor).not.toHaveBeenCalled();
        } else {
          expect(client.cancel).toHaveBeenCalledExactlyOnceWith(invocationId);
          expect(client.deleteSession).toHaveBeenCalledExactlyOnceWith(foundryId);
          expect(await sessions.getRuntimeVersion(task.id)).toMatchObject({
            foundrySessionId: foundryId, sessionStatus: 'Ended',
          });
        }
        expect(publish).toHaveBeenCalledWith(expect.objectContaining({
          taskId: task.id, type: 'state_changed', payload: { from: 'NeedsAttention', to: 'Cancelled' },
        }));
      } finally {
        await sessions.endTaskSessions(task.id, 'Cancelled');
        await tasks.transition(task.id, 'Cancelled');
      }
    },
  );

  it.each(['Active', 'completed', 'Idle', 'absent'] as const)(
    'rejects recovered runtime ABA after capturing a %s attention target', async (initial) => {
      const events = createEventHub<TaskEventMessage>();
      const tasks = createTaskStore(pool, events);
      const sessions = createDispatcherStore(pool, events);
      const task = await createTask(events, 'Attention runtime generation guard');
      try {
        expect((await tasks.transition(task.id, 'Running')).kind).toBe('ok');
        expect((await tasks.transition(task.id, 'NeedsAttention')).kind).toBe('ok');
        const original = await pool.request()
          .input('taskId', sql.BigInt, BigInt(task.id))
          .input('status', sql.NVarChar(8), initial === 'absent' ? 'Ended' : initial === 'completed' ? 'Active' : initial)
          .input('foundryId', sql.NVarChar(255), `old-attention-${randomUUID()}`)
          .query<{ id: string }>(`UPDATE dbo.tasks SET branch = N'jarvis/attention-fixture' WHERE id = @taskId;
            INSERT dbo.sandbox_sessions (task_id, foundry_session_id, agent_version, agent_name, size, image, status, started_at)
            OUTPUT CAST(inserted.id AS varchar(19)) AS id
            VALUES (@taskId, @foundryId, N'1', N'jarvis-runner-base-1x2', N'1x2', N'fixture', @status,
              DATEADD(minute, -2, SYSUTCDATETIME()));`);
        const originalId = original.recordset[0]?.id;
        if (!originalId) throw new Error('Attention session fixture was not created');
        await pool.request()
          .input('sessionId', sql.BigInt, BigInt(originalId))
          .input('status', sql.NVarChar(32), initial === 'Active' ? 'running' : 'completed')
          .query(`INSERT dbo.sandbox_turns (sandbox_session_id, invocation_id, mode, acp_session_id, status)
            VALUES (@sessionId, N'old-invocation', N'task', N'fixture-acp', @status);`);
        const expected = await sessions.getRuntimeVersion(task.id);
        if (!expected) throw new Error('Attention runtime snapshot was not read');
        const target = await sessions.getControlTarget(task.id);
        expect(target?.sandboxSessionId ?? null).toBe(initial === 'absent' ? null : originalId);
        if (target) expect(target.latestTurnId).toBe(expected.latestTurnId);

        await pool.request().input('sessionId', sql.BigInt, BigInt(originalId))
          .query(`INSERT dbo.sandbox_turns (sandbox_session_id, invocation_id, mode, acp_session_id, status)
            VALUES (@sessionId, N'new-completed-turn', N'task', N'fixture-acp', N'completed');`);
        await expect(tasks.transition(task.id, 'Cancelled', false, undefined, undefined, 'NeedsAttention', expected))
          .resolves.toEqual({ kind: 'invalid-transition' });
        const beforeRecovery = await sessions.getRuntimeVersion(task.id);
        if (!beforeRecovery) throw new Error('Updated attention runtime snapshot was not read');
        // Crash cleanup preserves completed Active sessions; account for this completed turn instead.
        expect(await sessions.endTaskSessions(task.id, 'NeedsAttention', true))
          .toEqual(initial === 'Active' || initial === 'completed' ? [originalId] : []);
        const recoverable = await sessions.getRuntimeVersion(task.id);
        expect(recoverable).toEqual({
          ...beforeRecovery, sessionStatus: initial === 'Idle' ? 'Idle' : 'Ended',
        });
        expect((await tasks.get(task.id, 1, 0))?.state).toBe('NeedsAttention');
        const owner = randomUUID();
        const recovery = await createTaskRecoveryStore(pool, events).claimRecovery(task.id, owner, 120);
        if (recovery.kind !== 'claimed') throw new Error(`Synthetic recovery claim was not acquired: ${recovery.kind}`);
        expect((await tasks.get(task.id, 1, 0))?.state).toBe('Running');
        const replacementId = await sessions.recordStarted(owner, recovery.task, 'jarvis-runner-base-1x2', {
          sessionId: `replacement-attention-${randomUUID()}`, invocationId: `replacement-${randomUUID()}`,
        });
        expect(replacementId).not.toBe(originalId);
        expect(await sessions.getRuntimeVersion(task.id)).toMatchObject({
          sandboxSessionId: replacementId, sessionStatus: 'Active',
        });
        expect((await tasks.transition(task.id, 'NeedsAttention')).kind).toBe('ok');
        const publish = vi.spyOn(events, 'publish');
        await expect(tasks.transition(task.id, 'Cancelled', false, undefined, undefined, 'NeedsAttention', beforeRecovery))
          .resolves.toEqual({ kind: 'invalid-transition' });
        expect((await tasks.get(task.id, 1, 0))?.state).toBe('NeedsAttention');
        expect((await sessions.getControlTarget(task.id))?.sandboxSessionId).toBe(replacementId);
        expect(publish).not.toHaveBeenCalled();

        const current = await sessions.getRuntimeVersion(task.id);
        if (!current) throw new Error('Replacement attention runtime snapshot was not read');
        await expect(tasks.transition(task.id, 'Cancelled', false, undefined, undefined, 'NeedsAttention', current))
          .resolves.toMatchObject({ kind: 'ok', task: { state: 'Cancelled' } });
      } finally {
        await sessions.endTaskSessions(task.id, 'Cancelled');
        await tasks.transition(task.id, 'Cancelled');
      }
    },
  );

  it('atomically refuses attention cancellation after recovery changed state', async () => {
    const events = createEventHub<TaskEventMessage>();
    const store = createTaskStore(pool, events);
    const task = await createTask(events, 'Attention cancellation state guard');
    expect((await store.transition(task.id, 'Running')).kind).toBe('ok');
    expect((await store.transition(task.id, 'NeedsAttention')).kind).toBe('ok');
    expect((await store.transition(task.id, 'Running')).kind).toBe('ok');
    await expect(store.transition(task.id, 'Cancelled', false, undefined, undefined, 'NeedsAttention'))
      .resolves.toEqual({ kind: 'invalid-transition' });
    expect(await store.get(task.id, 1, 0)).toMatchObject({ state: 'Running' });
    expect((await store.transition(task.id, 'NeedsAttention')).kind).toBe('ok');
    await expect(store.transition(task.id, 'Cancelled', false, undefined, undefined, 'NeedsAttention'))
      .resolves.toMatchObject({ kind: 'ok', task: { state: 'Cancelled' } });
  });

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

  it('lists stale active sessions and immediately eligible ended sessions for Running tasks', async () => {
    const events = createEventHub<TaskEventMessage>();
    const taskStore = createTaskStore(pool, events);
    const store = createDispatcherStore(pool, events);
    const fixtures: Array<{ task: Awaited<ReturnType<typeof createTask>> }> = [];
    const addInvocation = async (
      task: Awaited<ReturnType<typeof createTask>>,
      sessionStatus: 'Active' | 'Ended',
      endReason: string | null,
      stale: boolean,
      turnStatus: 'running' | 'completed',
      ageMinutes = 10,
    ) => {
      const foundrySessionId = `reconcile-${randomUUID()}`;
      const invocationId = `reconcile-invocation-${randomUUID()}`;
      const session = await pool.request()
        .input('taskId', sql.BigInt, BigInt(task.id))
        .input('foundrySessionId', sql.NVarChar(255), foundrySessionId)
        .input('status', sql.NVarChar(8), sessionStatus)
        .input('endReason', sql.NVarChar(32), endReason)
        .input('ageMinutes', sql.Int, stale ? ageMinutes : 0)
        .input('stale', sql.Bit, stale)
        .query<{ sandboxSessionId: string }>(`DECLARE @now datetime2(7) = SYSUTCDATETIME();
          DECLARE @startedAt datetime2(7) = DATEADD(minute, -@ageMinutes, @now);
          INSERT dbo.sandbox_sessions
          (task_id, foundry_session_id, agent_version, agent_name, size, image, status,
            started_at, last_heartbeat_at, ended_at, end_reason)
          OUTPUT CAST(inserted.id AS varchar(19)) AS sandboxSessionId
          VALUES (@taskId, @foundrySessionId, N'active', N'jarvis-runner-base-1x2', N'1x2',
            N'jarvis-runner-base-1x2', @status, @startedAt, CASE WHEN @stale = 1 THEN @startedAt ELSE NULL END,
            CASE WHEN @status = N'Ended' THEN @now ELSE NULL END, @endReason);`);
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
      return { sandboxSessionId, foundrySessionId, invocationId };
    };
    const addRunningInvocation = async (
      title: string,
      sessionStatus: 'Active' | 'Ended',
      endReason: string | null,
      stale: boolean,
      turnStatus: 'running' | 'completed',
    ) => {
      const task = await createTask(events, title);
      fixtures.push({ task });
      expect((await taskStore.transition(task.id, 'Running')).kind).toBe('ok');
      return { task, ...await addInvocation(task, sessionStatus, endReason, stale, turnStatus) };
    };

    try {
      const staleActive = await addRunningInvocation('Stale active invocation', 'Active', null, true, 'running');
      const staleCompleted = await addRunningInvocation('Stale completed invocation', 'Ended', 'done', true, 'completed');
      const freshActive = await addRunningInvocation('Fresh active invocation', 'Active', null, false, 'running');
      const freshEnded = await addRunningInvocation('Fresh ended invocation', 'Ended', 'done', false, 'completed');
      const freshExpired = await addRunningInvocation(
        'Fresh idle-expired invocation', 'Ended', 'idle_expired', false, 'completed',
      );
      const olderInvocationId = `older-invocation-${randomUUID()}`;
      const olderInvocationStartedAt = new Date(Date.now() - 8 * 60_000);
      await pool.request()
        .input('sandboxSessionId', sql.BigInt, BigInt(staleActive.sandboxSessionId))
        .input('invocationId', sql.NVarChar(255), olderInvocationId)
        .input('foundrySessionId', sql.NVarChar(255), staleActive.foundrySessionId)
        .input('startedAt', sql.DateTime2(7), olderInvocationStartedAt)
        .query(`INSERT dbo.sandbox_turns (sandbox_session_id, invocation_id, mode, acp_session_id, status, started_at)
          VALUES (@sandboxSessionId, @invocationId, N'task', @foundrySessionId, N'running', @startedAt);`);
      const staleExpired = await addRunningInvocation(
        'Stale idle-expired invocation', 'Ended', 'idle_expired', true, 'completed',
      );

      const newerExpiredTask = await createTask(events, 'Newer idle-expired invocation wins');
      fixtures.push({ task: newerExpiredTask });
      expect((await taskStore.transition(newerExpiredTask.id, 'Running')).kind).toBe('ok');
      const olderEligible = await addInvocation(newerExpiredTask, 'Active', null, true, 'running', 20);
      const latestExpired = await addInvocation(newerExpiredTask, 'Ended', 'idle_expired', true, 'completed', 10);

      const unsupportedLatestTask = await createTask(events, 'Newer unsupported session blocks older');
      fixtures.push({ task: unsupportedLatestTask });
      expect((await taskStore.transition(unsupportedLatestTask.id, 'Running')).kind).toBe('ok');
      await addInvocation(unsupportedLatestTask, 'Active', null, true, 'running', 20);
      await addInvocation(unsupportedLatestTask, 'Ended', 'cancelled', true, 'completed', 10);

      const stale = await store.listStaleRunning(new Date(Date.now() - 5 * 60_000), 10);
      expect(stale.map(({ taskId }) => taskId)).toEqual(expect.arrayContaining([
        staleActive.task.id, staleCompleted.task.id, staleExpired.task.id, newerExpiredTask.id,
        freshEnded.task.id, freshExpired.task.id,
      ]));
      expect(stale).toHaveLength(6);
      expect(stale.some(({ taskId }) => taskId === freshActive.task.id)).toBe(false);
      const cutoff = new Date(Date.now() - 5 * 60_000);
      const firstPage = await store.listStaleRunning(cutoff, 2);
      const secondPage = await store.listStaleRunning(cutoff, 2, firstPage.at(-1)?.taskId);
      const lastPage = await store.listStaleRunning(cutoff, 2, secondPage.at(-1)?.taskId);
      expect([...firstPage, ...secondPage, ...lastPage].map(({ taskId }) => taskId))
        .toEqual(stale.map(({ taskId }) => taskId));
      expect(new Set([...firstPage, ...secondPage, ...lastPage].map(({ taskId }) => taskId)).size).toBe(6);
      expect(await store.listStaleRunning(cutoff, 2, lastPage.at(-1)?.taskId)).toEqual([]);
      expect(stale.find(({ taskId }) => taskId === staleActive.task.id)?.sessionStatus).toBe('Active');
      expect(stale.find(({ taskId }) => taskId === staleActive.task.id)?.invocationId)
        .toBe(staleActive.invocationId);
      expect(stale.find(({ taskId }) => taskId === staleCompleted.task.id)?.sessionStatus).toBe('Ended');
      expect(stale.find(({ taskId }) => taskId === staleExpired.task.id)).toMatchObject({
        sandboxSessionId: staleExpired.sandboxSessionId,
        invocationId: staleExpired.invocationId,
        sessionStatus: 'Ended',
      });
      expect(stale.find(({ taskId }) => taskId === newerExpiredTask.id)).toMatchObject({
        sandboxSessionId: latestExpired.sandboxSessionId,
        invocationId: latestExpired.invocationId,
        sessionStatus: 'Ended',
      });
      expect(stale.some(({ taskId }) => taskId === unsupportedLatestTask.id)).toBe(false);
      expect(olderEligible.sandboxSessionId).not.toBe(latestExpired.sandboxSessionId);
      const latestCandidate = stale.find(({ taskId }) => taskId === newerExpiredTask.id);
      if (!latestCandidate) throw new Error('Latest expired invocation was not selected');
      expect(await store.isCurrentStaleTask(latestCandidate)).toBe(true);
      expect(await store.isCurrentStaleTask({
        ...latestCandidate,
        sandboxSessionId: olderEligible.sandboxSessionId,
        foundrySessionId: olderEligible.foundrySessionId,
        invocationId: olderEligible.invocationId,
      })).toBe(false);
      const recoveryStore = createTaskRecoveryStore(pool, events);
      await expect(recoveryStore.getRunningTaskForSession({
        executionGeneration: '0',
        sandboxSessionId: staleActive.sandboxSessionId,
        foundrySessionId: staleActive.foundrySessionId,
        agentName: 'jarvis-runner-base-1x2',
        invocationId: staleActive.invocationId,
      })).resolves.toBe(staleActive.task.id);
      await expect(recoveryStore.getRunningTaskForSession({
        executionGeneration: '0',
        sandboxSessionId: staleActive.sandboxSessionId,
        foundrySessionId: staleActive.foundrySessionId,
        agentName: 'jarvis-runner-base-1x2',
        invocationId: olderInvocationId,
      })).resolves.toBeNull();
      const heartbeatBefore = await pool.request()
        .input('sandboxSessionId', sql.BigInt, BigInt(staleActive.sandboxSessionId))
        .query<{ lastHeartbeatAt: Date }>(
          'SELECT last_heartbeat_at AS lastHeartbeatAt FROM dbo.sandbox_sessions WHERE id = @sandboxSessionId;',
        );
      await store.recordHeartbeat(staleActive.sandboxSessionId, olderInvocationId, true);
      const oldInvocation = await pool.request()
        .input('sandboxSessionId', sql.BigInt, BigInt(staleActive.sandboxSessionId))
        .input('olderInvocationId', sql.NVarChar(255), olderInvocationId)
        .input('latestInvocationId', sql.NVarChar(255), staleActive.invocationId)
        .query<{ lastHeartbeatAt: Date; oldStatus: string; latestStatus: string }>(`SELECT
          session.last_heartbeat_at AS lastHeartbeatAt,
          oldTurn.status AS oldStatus, latestTurn.status AS latestStatus
          FROM dbo.sandbox_sessions AS session
          INNER JOIN dbo.sandbox_turns AS oldTurn ON oldTurn.sandbox_session_id = session.id
            AND oldTurn.invocation_id = @olderInvocationId
          INNER JOIN dbo.sandbox_turns AS latestTurn ON latestTurn.sandbox_session_id = session.id
            AND latestTurn.invocation_id = @latestInvocationId
          WHERE session.id = @sandboxSessionId;`);
      expect(oldInvocation.recordset).toEqual([{
        lastHeartbeatAt: heartbeatBefore.recordset[0]?.lastHeartbeatAt,
        oldStatus: 'running',
        latestStatus: 'running',
      }]);
    } finally {
      for (const { task } of fixtures) {
        await store.endTaskSessions(task.id, 'Cancelled');
        await taskStore.transition(task.id, 'Cancelled');
      }
    }
  });

  it('reconciles a freshly idle-expired completion without tracked sessions before admitting the next task', async () => {
    const events = createEventHub<TaskEventMessage>();
    const taskStore = createTaskStore(pool, events);
    const store = createDispatcherStore(pool, events);
    const projectId = await createProject(1);
    const completedTask = await createTask(events, 'Completed idle-expired delivery', projectId);
    const waitingTask = await createTask(events, 'Waiting for project capacity', projectId);
    expect((await taskStore.transition(completedTask.id, 'Running')).kind).toBe('ok');
    const foundrySessionId = `expired-${randomUUID()}`;
    const invocationId = `expired-invocation-${randomUUID()}`;
    const inserted = await pool.request()
      .input('taskId', sql.BigInt, BigInt(completedTask.id))
      .input('foundrySessionId', sql.NVarChar(255), foundrySessionId)
      .input('startedAt', sql.DateTime2(7), new Date(Date.now() - 10 * 60_000))
      .query<{ sandboxSessionId: string }>(`INSERT dbo.sandbox_sessions
        (task_id, foundry_session_id, agent_version, agent_name, size, image, status,
          started_at, last_heartbeat_at, ended_at, end_reason)
        OUTPUT CAST(inserted.id AS varchar(19)) AS sandboxSessionId
        VALUES (@taskId, @foundrySessionId, N'active', N'copilot', N'1x2', N'copilot',
          N'Ended', @startedAt, SYSUTCDATETIME(), SYSUTCDATETIME(), N'idle_expired');`);
    const sandboxSessionId = inserted.recordset[0]?.sandboxSessionId;
    if (!sandboxSessionId) throw new Error('Idle-expired session fixture was not created');
    await pool.request()
      .input('sandboxSessionId', sql.BigInt, BigInt(sandboxSessionId))
      .input('foundrySessionId', sql.NVarChar(255), foundrySessionId)
      .input('invocationId', sql.NVarChar(255), invocationId)
      .query(`INSERT dbo.sandbox_turns (sandbox_session_id, invocation_id, mode, acp_session_id, status, ended_at)
        VALUES (@sandboxSessionId, @invocationId, N'task', @foundrySessionId, N'completed', SYSUTCDATETIME());`);

    const startTask = vi.fn(async () => ({
      invocationId: `waiting-${randomUUID()}`,
      sessionId: `waiting-session-${randomUUID()}`,
      status: 'queued' as const,
      agent: 'copilot' as const,
    }));
    const clientFor = vi.fn(() => ({
      startTask,
      steer: vi.fn(async () => ({
        invocationId: 'steered', sessionId: 'waiting-session', status: 'queued' as const, agent: 'copilot' as const,
      })),
      pause: vi.fn(async () => ({ sessionId: 'waiting-session', status: 'pausing' as const })),
      resume: vi.fn(async () => ({
        invocationId: 'resumed', sessionId: 'waiting-session', status: 'queued' as const, agent: 'copilot' as const,
      })),
      cancel: vi.fn(async (id: string) => ({ invocationId: id, status: 'cancelled' as const })),
      deleteSession: vi.fn(async () => {}),
      status: vi.fn(async (id: string) => ({
        invocationId: id,
        sessionId: foundrySessionId,
        status: 'completed' as const,
        workCompleted: true,
        providerStopped: true,
        workCommitSha,
        agent: 'copilot' as const,
        startedAt: Date.now() - 60_000,
        finishedAt: Date.now(),
        events: [],
        result: null,
        error: null,
      })),
    }));
    const dispatcher = new TaskDispatcher(
      store,
      taskStore,
      settings(),
      clientFor,
      heartbeat(),
      events,
      {
        recoveryStore: createTaskRecoveryStore(pool, events),
        workspaceFor: vi.fn(async () => ({
          repository: 'DanAakesen/dispatch-policy',
          defaultBranch: 'main',
          branch: `jarvis/task-${completedTask.id}`,
        })),
        verifyDelivery: vi.fn(async (_workspace, _task, gate) => {
          if (!gate) return { kind: 'refused' as const, reason: 'Completion policy gate unavailable' };
          const outcome = await gate(async () => {
            expect((await taskStore.transition(completedTask.id, 'Done', true)).kind).toBe('ok');
            return true;
          });
          return outcome.kind === 'not_running'
            ? { kind: 'not_running' as const }
            : { kind: 'awaiting_policy' as const };
        }),
      },
    );

    try {
      expect(await store.claimNext('before-policy', 120, 3)).toMatchObject({ kind: 'idle' });
      dispatcher.start();
      await vi.waitFor(() => expect(startTask).toHaveBeenCalledOnce());
      expect(await taskStore.get(completedTask.id, 1, 0)).toMatchObject({ state: 'Done' });
      expect(await taskStore.get(waitingTask.id, 1, 0)).toMatchObject({ state: 'Running' });
      expect(await store.isCurrentStaleTask({
        taskId: completedTask.id,
        executionGeneration: '0',
        sandboxSessionId,
        foundrySessionId,
        invocationId,
        agentName: 'copilot',
        sessionStatus: 'Ended',
      })).toBe(false);
    } finally {
      await dispatcher.stop();
      await taskStore.transition(waitingTask.id, 'NeedsAttention');
      await store.endTaskSessions(waitingTask.id, 'NeedsAttention');
      await store.endTaskSessions(completedTask.id, 'Done', true);
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
