import { createHash, randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readDownMigration, readMigrations, revertMigration, type Migration } from './migrations.js';
import { createTaskStore } from './task-store.js';
import { createCredentialStatusStore } from './credential-status-store.js';
import { createSettingsStore } from './settings-store.js';
import { createProjectStore } from './project-store.js';
import { createSandboxHeartbeatStore } from './sandbox-heartbeat-store.js';
import { ProjectConflictError } from '../factory/projects.js';
import { createEventHub } from '../core/event-hub.js';
import type { TaskEventMessage } from '../factory/task-store.js';

const configuration = loadDatabaseConfig();
if (!configuration || process.env.NODE_ENV !== 'test' || configuration.server !== '127.0.0.1') {
  throw new Error('Database integration tests require an isolated loopback SQL Server test configuration');
}
const database = `jarvis_ci_${randomUUID().replaceAll('-', '')}`;
const administrator = new sql.ConnectionPool({ ...configuration, database: 'master' });
const pool = new sql.ConnectionPool({ ...configuration, database });
const core = '0001_core_tables.sql';
const tablesInSchema = [
  'activity', 'artifacts', 'credential_status', 'jarvis_sessions', 'messages', 'projects', 'sandbox_sessions',
  'sandbox_turns', 'settings', 'task_events', 'tasks', 'tool_calls', 'webhook_deliveries',
];

async function tables(): Promise<string[]> {
  const { recordset } = await pool.request().query<{ name: string }>(
    "SELECT name FROM sys.tables WHERE schema_id = SCHEMA_ID(N'dbo') AND name <> N'schema_migrations' ORDER BY name");
  return recordset.map((row) => row.name).sort();
}
async function ledger(): Promise<string[]> {
  const { recordset } = await pool.request().query<{ name: string }>('SELECT name FROM dbo.schema_migrations ORDER BY name');
  return recordset.map((row) => row.name);
}
async function scalar(text: string): Promise<number> {
  const { recordset } = await pool.request().query<{ id: number }>(`${text}; SELECT CAST(SCOPE_IDENTITY() AS int) AS id;`);
  return recordset[0]?.id ?? 0;
}

beforeAll(async () => {
  await administrator.connect();
  await administrator.request().batch(`CREATE DATABASE [${database}];`);
  await pool.connect();
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

describe('committed domain schema (groups 1-4 and 6)', () => {
  it('boots the committed migration manifest twice without duplicate ledger rows', async () => {
    const committed = await readMigrations();
    expect(await applyMigrations(pool, committed)).toEqual(committed.map((migration) => migration.name));
    expect(await applyMigrations(pool, committed)).toEqual([]);
    expect(await ledger()).toEqual(committed.map((migration) => migration.name));
    expect(await tables()).toEqual(tablesInSchema);
    const credentials = await pool.request().query<{ name: string; status: string }>(
      `SELECT name, status FROM dbo.credential_status WHERE name IN (N'codex-login', N'copilot-token') ORDER BY name;`);
    expect(credentials.recordset).toEqual([
      { name: 'codex-login', status: 'unknown' },
      { name: 'copilot-token', status: 'unknown' },
    ]);
    const { recordset } = await pool.request().query<{ name: string }>(
      `SELECT name FROM sys.indexes WHERE name IN (
        N'IX_tasks_state_next_attempt_at', N'IX_task_events_task_id_at', N'IX_sandbox_sessions_task_id_status',
        N'IX_sandbox_turns_sandbox_session_id_started_at', N'IX_artifacts_task_id_at') ORDER BY name`);
    expect(recordset.map((row) => row.name)).toEqual([
      'IX_artifacts_task_id_at', 'IX_sandbox_sessions_task_id_status', 'IX_sandbox_turns_sandbox_session_id_started_at',
      'IX_task_events_task_id_at', 'IX_tasks_state_next_attempt_at',
    ]);
  });

  it('stores valid records across the committed schema', async () => {
    await pool.request().query(`INSERT dbo.settings (scope, [key], value) VALUES
      (N'global', N'jarvis.model', N'"gpt-5.6-luna"'), (N'project:1', N'voice.en.voice', N'{"name":"Ryan"}'),
      (N'project:12', N'agent.reasoning-effort', N'null')`);
    const session = await scalar("INSERT dbo.jarvis_sessions (channel, language) VALUES (N'chat', N'en')");
    const message = await scalar(`INSERT dbo.messages (jarvis_session_id, role, text, model, input_tokens, output_tokens)
      VALUES (${String(session)}, N'jarvis', N'On it.', N'gpt-5.6-luna', 10, 2)`);
    const project = await scalar(`INSERT dbo.projects (name, repo, default_branch, default_agent, policy, sandbox_size, tech)
      VALUES (N'Jarvis', N'DanAakesen/jarvis', N'main', N'codex', N'deliver_pr', N'1x2', N'node')`);
    await pool.request().query(`INSERT dbo.projects (name, repo, default_branch, default_agent, policy, sandbox_size, tech, max_parallel_tasks, active)
      VALUES (N'Web', N'Dan-Aakesen/my-site.web_1', N'release/v1', N'copilot', N'complete_without_deployment', N'2x4', N'dotnet-8', 3, 0)`);
    const task = await scalar(`INSERT dbo.tasks (project_id, origin_message_id, title, request, source, agent)
      VALUES (${String(project)}, ${String(message)}, N'Fix it', N'Fix the bug', N'chat', N'codex')`);
    await pool.request().query(`INSERT dbo.tool_calls (message_id, tool, arguments, result, outcome, task_id)
      VALUES (${String(message)}, N'create_task', N'{"title":"Fix it"}', N'{"id":${String(task)}}', N'ok', ${String(task)}),
      (${String(message)}, N'list-tasks', N'{}', N'[]', N'error', NULL);
      INSERT dbo.task_events (task_id, type, summary, payload, source) VALUES (${String(task)}, N'created', N'Created', N'{}', N'backend');
      INSERT dbo.activity (area, kind, title, link) VALUES (N'factory', N'task_done', N'Fix it is done', N'task:${String(task)}');
      UPDATE dbo.tasks SET state = N'Running', lease_owner = N'dispatcher-1', lease_until = DATEADD(minute, 5, SYSUTCDATETIME()) WHERE id = ${String(task)};`);
    const sandboxSession = await scalar(`INSERT dbo.sandbox_sessions
      (task_id, foundry_session_id, agent_version, agent_name, size, image, status, cost_estimate_dkk)
      VALUES (${String(task)}, N'foundry-session-1', N'1', N'jarvis-runner-base-1x2', N'1x2', N'jarvis-runner:latest', N'Active', 0.25)`);
    await pool.request().query(`INSERT dbo.sandbox_turns
      (sandbox_session_id, invocation_id, mode, acp_session_id, status)
      VALUES (${String(sandboxSession)}, N'invocation-1', N'task', N'acp-session-1', N'running');
      INSERT dbo.artifacts (task_id, kind, blob_path, size_bytes)
      VALUES (${String(task)}, N'log', N'tasks/1/log.txt', 12);
      INSERT dbo.webhook_deliveries (delivery_id, event)
      VALUES (N'delivery-1', N'push');
      UPDATE dbo.webhook_deliveries SET outcome = N'ok', processed_at = SYSUTCDATETIME()
      WHERE delivery_id = N'delivery-1';
      UPDATE dbo.credential_status SET expires_at = SYSUTCDATETIME(),
        last_renewed_at = SYSUTCDATETIME(), status = N'ok' WHERE name = N'codex-login';`);
    const row = await pool.request().query<{ state: string; priority: number; attempt_count: number }>(
      `SELECT state, priority, attempt_count FROM dbo.tasks WHERE id = ${String(task)}`);
    expect(row.recordset).toEqual([{ state: 'Running', priority: 0, attempt_count: 0 }]);
    await pool.request().query(`UPDATE dbo.tasks SET state = N'Done', finished_at = SYSUTCDATETIME()
      WHERE id = ${String(task)};`);
  });

  it('serializes Codex starts against renewal acquisition and recovers expired leases', async () => {
    const project = await pool.request()
      .input('repo', sql.NVarChar(140), `DanAakesen/credentials-${randomUUID().slice(0, 8)}`)
      .query<{ id: string }>(`INSERT dbo.projects (name, repo, default_branch, default_agent, policy, sandbox_size, tech)
        OUTPUT CAST(inserted.id AS varchar(19)) AS id
        VALUES (N'Credential lease fixture', @repo, N'main', N'codex', N'deliver_pr', N'1x2', N'node');`);
    const projectId = project.recordset[0]?.id;
    if (!projectId) throw new Error('Credential lease project was not created');

    const tasks = createTaskStore(pool, createEventHub<TaskEventMessage>());
    const credentials = createCredentialStatusStore(pool);
    const runningCodex = await tasks.create({ projectId, title: 'Codex active', request: 'Run', agent: 'codex' });
    if (!runningCodex) throw new Error('Codex task was not created');
    expect((await tasks.transition(runningCodex.id, 'Running')).kind).toBe('ok');

    const owner = randomUUID();
    expect(await credentials.acquireCodexRenewalLease(owner, 900)).toBe(false);
    expect((await tasks.transition(runningCodex.id, 'PauseRequested')).kind).toBe('ok');
    expect((await tasks.transition(runningCodex.id, 'Paused')).kind).toBe('ok');
    expect(await credentials.acquireCodexRenewalLease(owner, 900)).toBe(true);

    const blockedCodex = await tasks.create({ projectId, title: 'Codex blocked', request: 'Wait', agent: 'codex' });
    if (!blockedCodex) throw new Error('Blocked Codex task was not created');
    expect((await tasks.transition(blockedCodex.id, 'Running')).kind).toBe('renewal-active');
    const allowedCopilot = await tasks.create({ projectId, title: 'Copilot allowed', request: 'Run', agent: 'copilot' });
    if (!allowedCopilot) throw new Error('Copilot task was not created');
    expect((await tasks.transition(allowedCopilot.id, 'Running')).kind).toBe('ok');
    expect((await tasks.transition(allowedCopilot.id, 'Cancelled')).kind).toBe('ok');

    await credentials.completeCodexRenewal(
      owner, 'ok', '2030-01-01T00:00:00.000Z', '2026-10-03T00:00:00.000Z',
    );
    expect((await tasks.transition(blockedCodex.id, 'Running')).kind).toBe('ok');
    await credentials.updateCopilotStatus(
      'renew_soon', '2026-10-05T12:00:00.000Z', '2026-10-01T12:00:00.000Z',
    );
    expect(await credentials.list()).toEqual([
      {
        name: 'codex-login', status: 'ok',
        expiresAt: '2030-01-01T00:00:00.000Z', lastRenewedAt: '2026-10-03T00:00:00.000Z',
      },
      {
        name: 'copilot-token', status: 'renew_soon',
        expiresAt: '2026-10-05T12:00:00.000Z', lastRenewedAt: '2026-10-01T12:00:00.000Z',
      },
    ]);
    expect((await tasks.transition(blockedCodex.id, 'PauseRequested')).kind).toBe('ok');
    expect((await tasks.transition(blockedCodex.id, 'Paused')).kind).toBe('ok');

    await pool.request()
      .input('owner', sql.UniqueIdentifier, owner)
      .query(`UPDATE dbo.credential_status SET renewal_lease_owner = @owner,
        renewal_lease_until = DATEADD(minute, -1, SYSUTCDATETIME()) WHERE name = N'codex-login';`);
    const recoveredOwner = randomUUID();
    expect(await credentials.acquireCodexRenewalLease(recoveredOwner, 900)).toBe(true);
    await credentials.completeCodexRenewal(recoveredOwner, 'failed', null, null);
    const failedCredentialTask = await tasks.create({
      projectId, title: 'Blocked by failed credential', request: 'Wait', agent: 'codex',
    });
    if (!failedCredentialTask) throw new Error('Failed-credential task was not created');
    expect((await tasks.transition(failedCredentialTask.id, 'Running')).kind).toBe('credential-unavailable');

    const repairedOwner = randomUUID();
    expect(await credentials.acquireCodexRenewalLease(repairedOwner, 900)).toBe(true);
    await credentials.completeCodexRenewal(repairedOwner, 'ok', null, null);
    expect((await tasks.transition(failedCredentialTask.id, 'Running')).kind).toBe('ok');
    expect((await tasks.transition(failedCredentialTask.id, 'PauseRequested')).kind).toBe('ok');
    expect((await tasks.transition(failedCredentialTask.id, 'Paused')).kind).toBe('ok');
  });

  it('creates, filters, reads and transitions tasks with transactional history', async () => {
    const projectResult = await pool.request()
      .input('repo', sql.NVarChar(140), `DanAakesen/tasks-${randomUUID().slice(0, 8)}`)
      .query<{ id: string }>(`INSERT dbo.projects (name, repo, default_branch, default_agent, policy, sandbox_size, tech)
        OUTPUT CAST(inserted.id AS varchar(19)) AS id
        VALUES (N'Task API fixture', @repo, N'main', N'copilot', N'deliver_pr', N'1x2', N'node');`);
    const projectId = projectResult.recordset[0]?.id;
    if (!projectId) throw new Error('Task API fixture project was not created');
    const store = createTaskStore(pool, createEventHub<TaskEventMessage>());
    const created = await store.create({ projectId, title: 'Task API contract', request: 'Exercise SQL task operations' });
    expect(created).toMatchObject({ projectId, agent: 'copilot', source: 'board', state: 'Ready' });
    if (!created) throw new Error('Task API fixture task was not created');
    let idleOperationRan = false;
    expect(await store.withNoActiveTasks(async () => { idleOperationRan = true; }))
      .toEqual({ kind: 'active' });
    expect(idleOperationRan).toBe(false);

    expect(await store.list({
      projectId, agent: 'copilot', state: 'Ready', search: 'contract',
      limit: 10, offset: 0,
    })).toEqual([created]);
    expect(await store.get(created.id, 10, 0)).toMatchObject({
      id: created.id,
      events: [{ type: 'created', payload: { state: 'Ready' }, source: 'backend' }],
    });
    await pool.request()
      .input('taskId', sql.BigInt, BigInt(created.id))
      .input('payload', sql.NVarChar(sql.MAX), JSON.stringify({ data: 'x'.repeat(3_000) }))
      .query('UPDATE dbo.task_events SET payload = @payload WHERE task_id = @taskId AND type = N\'created\';');
    expect(await store.get(created.id, 10, 0)).toMatchObject({
      events: [{ payload: null, payloadTruncated: true }],
    });

    const transition = async (id: string, state: 'Running' | 'PauseRequested' | 'Paused' | 'NeedsAttention' | 'Done' | 'Cancelled', verified = false) => {
      const result = await store.transition(id, state, verified);
      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') throw new Error(`Unexpected transition result: ${result.kind}`);
      expect(result.task.state).toBe(state);
    };

    expect((await store.transition(created.id, 'Done')).kind).toBe('invalid-transition');
    await transition(created.id, 'Running');
    await transition(created.id, 'PauseRequested');
    await transition(created.id, 'Paused');
    await transition(created.id, 'Running');
    await pool.request()
      .input('taskId', sql.BigInt, BigInt(created.id))
      .input('longSummary', sql.NVarChar(2_000), 'x'.repeat(450))
      .query(`INSERT dbo.task_events (task_id, type, summary, source) VALUES
        (@taskId, N'progress', N'First progress', N'runner'),
        (@taskId, N'progress', N'Second progress', N'runner'),
        (@taskId, N'progress', N'Third progress', N'runner'),
        (@taskId, N'progress', @longSummary, N'runner');`);
    const context = await store.getRunningContext();
    const runningTask = context.runningTasks.find(({ id }) => id === created.id);
    expect(context.truncated).toBe(false);
    expect(runningTask).toMatchObject({
      projectId,
      projectName: 'Task API fixture',
      title: 'Task API contract',
      state: 'Running',
      recentEvents: [
        { summary: 'x'.repeat(400), summaryTruncated: true },
        { summary: 'Third progress', summaryTruncated: false },
        { summary: 'Second progress', summaryTruncated: false },
      ],
    });
    await transition(created.id, 'NeedsAttention');
    await transition(created.id, 'Running');
    await transition(created.id, 'Done', true);
    expect((await store.transition(created.id, 'Running')).kind).toBe('invalid-transition');
    await expect(store.withNoActiveTasks(async () => 'scale updated'))
      .resolves.toEqual({ kind: 'idle', value: 'scale updated' });

    const readyCancel = await store.create({ projectId, title: 'Cancel ready', request: 'Cancel before start' });
    if (!readyCancel) throw new Error('Ready task fixture was not created');
    await transition(readyCancel.id, 'Cancelled');

    const runningCancel = await store.create({ projectId, title: 'Cancel running', request: 'Cancel while running' });
    if (!runningCancel) throw new Error('Running task fixture was not created');
    await transition(runningCancel.id, 'Running');
    await transition(runningCancel.id, 'Cancelled');

    const pausedCancel = await store.create({ projectId, title: 'Cancel paused', request: 'Cancel while paused' });
    if (!pausedCancel) throw new Error('Paused task fixture was not created');
    await transition(pausedCancel.id, 'Running');
    await transition(pausedCancel.id, 'PauseRequested');
    await transition(pausedCancel.id, 'Paused');
    await transition(pausedCancel.id, 'Cancelled');

    await pool.request().input('projectId', sql.BigInt, BigInt(projectId))
      .query('UPDATE dbo.projects SET active = 0 WHERE id = @projectId;');
    expect(await store.create({ projectId, title: 'Archived project', request: 'Must not be queued' })).toBeNull();
  });

  it('persists events and activity together, then publishes committed events within one second', async () => {
    const projectResult = await pool.request()
      .input('repo', sql.NVarChar(140), `DanAakesen/events-${randomUUID().slice(0, 8)}`)
      .query<{ id: string }>(`INSERT dbo.projects (name, repo, default_branch, default_agent, policy, sandbox_size, tech)
        OUTPUT CAST(inserted.id AS varchar(19)) AS id
        VALUES (N'Event pipeline fixture', @repo, N'main', N'copilot', N'deliver_pr', N'1x2', N'node');`);
    const projectId = projectResult.recordset[0]?.id;
    if (!projectId) throw new Error('Event pipeline fixture project was not created');

    const hub = createEventHub<TaskEventMessage>();
    const delivered: TaskEventMessage[] = [];
    hub.subscribe((event) => delivered.push(event));
    const store = createTaskStore(pool, hub);
    const task = await store.create({ projectId, title: 'Event pipeline', request: 'Test persistence and publication' });
    if (!task) throw new Error('Event pipeline fixture task was not created');

    const startedAt = performance.now();
    const runnerEvent = await store.recordEvent({
      taskId: task.id,
      type: 'files_changed',
      summary: 'Changed source files',
      payload: { files: ['src/app.ts'] },
      source: 'runner',
    });
    expect(performance.now() - startedAt).toBeLessThan(1000);
    expect(runnerEvent).toMatchObject({ taskId: task.id, type: 'files_changed', source: 'runner' });
    expect((await store.transition(task.id, 'Running')).kind).toBe('ok');
    expect(delivered.map(({ type }) => type)).toEqual(['created', 'files_changed', 'state_changed']);
    expect(delivered.map(({ taskId }) => taskId)).toEqual([task.id, task.id, task.id]);
    expect(await store.getEventsAfter(task.id, delivered[0]!.id, 1)).toEqual([runnerEvent]);
    expect(await store.getEventsAfter(task.id, runnerEvent.id, 1)).toMatchObject([
      { id: delivered[2]!.id, taskId: task.id, type: 'state_changed' },
    ]);
    expect(await store.getEventsAfter(task.id, delivered[2]!.id, 1)).toEqual([]);

    await expect(store.recordEvent({
      taskId: '9223372036854775807',
      type: 'files_changed',
      source: 'runner',
    })).rejects.toThrow('Task event persistence failed');
    await expect(store.recordEvent({
      taskId: task.id,
      type: 'files_changed\n',
      source: 'runner',
    })).rejects.toThrow('Invalid task event');
    await expect(store.recordEvent({
      taskId: task.id,
      type: 'files_changed',
      payload: 'x'.repeat(1024 * 1024 - 1),
      source: 'runner',
    })).rejects.toThrow('Invalid task event payload');
    expect(delivered).toHaveLength(3);

    const eventRows = await pool.request().input('taskId', sql.BigInt, BigInt(task.id))
      .query<{ type: string }>('SELECT type FROM dbo.task_events WHERE task_id = @taskId ORDER BY id;');
    const activityRows = await pool.request().input('link', sql.NVarChar(100), `task:${task.id}`)
      .query<{ kind: string; title: string }>(
        'SELECT kind, title FROM dbo.activity WHERE link = @link ORDER BY id;');
    expect(eventRows.recordset.map(({ type }) => type)).toEqual(['created', 'files_changed', 'state_changed']);
    expect(activityRows.recordset).toEqual([
      { kind: 'created', title: 'Task created from the board' },
      { kind: 'files_changed', title: 'Changed source files' },
      { kind: 'state_changed', title: 'Task state changed' },
    ]);
  });

  it('reads and transactionally writes only the recognized global settings', async () => {
    const store = createSettingsStore(pool);
    await store.write({
      jarvis: { model: 'gpt-5.6-luna', reasoning: 'low' },
      voice: { defaultLanguage: 'en' },
      global: { maxParallelTasks: 3 },
    });

    expect(await store.read()).toMatchObject({
      'jarvis.model': '"gpt-5.6-luna"',
      'jarvis.reasoning_effort': '"low"',
      'voice.default_language': '"en"',
      'global.max_parallel_tasks': '3',
    });
  });

  it('heartbeats running sandboxes and atomically marks a confirmed crash', async () => {
    const project = await createProjectStore(pool).create({
      name: 'Heartbeat fixture', repo: `${database}/heartbeat`, default_branch: 'main',
      default_agent: 'copilot', policy: 'deliver_pr', sandbox_size: '1x2', tech: 'node',
    });
    const taskStore = createTaskStore(pool, createEventHub<TaskEventMessage>());
    const task = await taskStore.create({
      projectId: project.id, title: 'Heartbeat fixture', request: 'Exercise heartbeat persistence',
    });
    if (!task) throw new Error('Heartbeat task fixture was not created');
    expect((await taskStore.transition(task.id, 'Running')).kind).toBe('ok');
    const sandboxSessionId = await scalar(`INSERT dbo.sandbox_sessions
      (task_id, foundry_session_id, agent_version, agent_name, size, image, status)
      VALUES (${task.id}, N'heartbeat-session', N'1', N'jarvis-runner-base-1x2', N'1x2',
        N'jarvis-runner-base@sha256:fixture', N'Active')`);
    await pool.request().query(`INSERT dbo.sandbox_turns
      (sandbox_session_id, invocation_id, mode, acp_session_id, status)
      VALUES (${sandboxSessionId}, N'heartbeat-invocation', N'task', N'heartbeat-acp', N'running')`);

    const eventHub = createEventHub<TaskEventMessage>();
    const published: TaskEventMessage[] = [];
    eventHub.subscribe((event) => published.push(event));
    const store = createSandboxHeartbeatStore(pool, eventHub);
    // Earlier tests in this database leave their own running sessions; check only this fixture's.
    const running = (await store.listRunning()).filter((row) => row.sandboxSessionId === String(sandboxSessionId));
    expect(running).toEqual([{
      sandboxSessionId: String(sandboxSessionId), foundrySessionId: 'heartbeat-session',
      agentName: 'jarvis-runner-base-1x2', invocationId: 'heartbeat-invocation',
    }]);
    await store.recordHeartbeat(String(sandboxSessionId));
    const heartbeat = await pool.request().query<{ at: Date | null }>(
      `SELECT last_heartbeat_at AS at FROM dbo.sandbox_sessions WHERE id = ${sandboxSessionId}`);
    expect(heartbeat.recordset[0]?.at).toBeInstanceOf(Date);

    expect(await store.markNeedsAttention(String(sandboxSessionId))).toBe(true);
    expect(await store.markNeedsAttention(String(sandboxSessionId))).toBe(false);
    const result = await pool.request().query<{ taskState: string; sessionStatus: string; endReason: string; leaseOwner: string | null }>(
      `SELECT t.state AS taskState, s.status AS sessionStatus, s.end_reason AS endReason, t.lease_owner AS leaseOwner
        FROM dbo.tasks AS t JOIN dbo.sandbox_sessions AS s ON s.task_id = t.id WHERE s.id = ${sandboxSessionId}`);
    expect(result.recordset).toEqual([{
      taskState: 'NeedsAttention', sessionStatus: 'Crashed', endReason: 'crashed', leaseOwner: null,
    }]);
    const activity = await pool.request().query<{ kind: string; title: string; link: string }>(
      `SELECT kind, title, link FROM dbo.activity WHERE link = N'task:${task.id}' AND kind = N'state_changed'`);
    expect(activity.recordset).toContainEqual({
      kind: 'state_changed', title: 'Sandbox heartbeat detected a crash', link: `task:${task.id}`,
    });
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      taskId: task.id,
      type: 'state_changed',
      summary: 'Sandbox heartbeat detected a crash',
      payload: { from: 'Running', to: 'NeedsAttention', reason: 'sandbox_crashed' },
      source: 'backend',
    });
  });

  it('creates, updates, lists, and archives projects through the SQL store', async () => {
    const store = createProjectStore(pool);
    const repo = `${database}/project`;
    const project = await store.create({
      name: 'Project store', repo, default_branch: 'main', default_agent: 'copilot',
      policy: 'deliver_pr', sandbox_size: '1x2', tech: 'node',
    });
    expect(project).toMatchObject({ repo, max_parallel_tasks: 1, merge_rules: null, active: true });
    expect(await store.list()).toContainEqual(project);
    expect(await store.update(project.id, { max_parallel_tasks: 3 })).toMatchObject({ max_parallel_tasks: 3 });
    expect(await store.archive(project.id)).toBe(true);
    expect(await store.list()).not.toContainEqual(expect.objectContaining({ id: project.id }));
    expect(await store.update(project.id, { name: 'Archived' })).toBeNull();
    expect(await store.archive(project.id)).toBe(true);
    await expect(store.create({
      name: 'Replacement', repo, default_branch: 'main', default_agent: 'copilot',
      policy: 'deliver_pr', sandbox_size: '1x2', tech: 'node',
    })).rejects.toBeInstanceOf(ProjectConflictError);
  });

  it.each([
    ["INSERT dbo.settings (scope, [key], value) VALUES (N'global', N'jarvis.reasoning', N'not json')", 'CK_settings_value'],
    ["INSERT dbo.settings (scope, [key], value) VALUES (N'project:x', N'jarvis.model', N'{}')", 'CK_settings_scope'],
    ["INSERT dbo.tool_calls (message_id, tool, arguments, outcome) VALUES (1, N'create_task', N'[]', N'ok')", 'CK_tool_calls_arguments'],
    ["INSERT dbo.jarvis_sessions (channel, language) VALUES (N'phone', N'en')", 'CK_jarvis_sessions_channel'],
    ["INSERT dbo.jarvis_sessions (channel, language) VALUES (N'VOICE', N'en')", 'CK_jarvis_sessions_channel'],
    ["INSERT dbo.messages (jarvis_session_id, role, text) VALUES (999999, N'dan', N'Hi')", 'FK_messages_jarvis_sessions'],
    ["INSERT dbo.projects (name, repo, default_branch, default_agent, policy, sandbox_size, tech) VALUES (N'Dup', N'danaakesen/JARVIS', N'main', N'codex', N'deliver_pr', N'1x2', N'node')", 'UQ_projects_repo'],
    ["INSERT dbo.projects (name, repo, default_branch, default_agent, policy, sandbox_size, tech) VALUES (N'Bad', N'not-a-repo', N'main', N'codex', N'deliver_pr', N'1x2', N'node')", 'CK_projects_repo'],
    ["INSERT dbo.projects (name, repo, default_branch, default_agent, policy, sandbox_size, tech, max_parallel_tasks) VALUES (N'Zero', N'DanAakesen/zero', N'main', N'codex', N'deliver_pr', N'1x2', N'node', 0)", 'CK_projects_max_parallel_tasks'],
    ["INSERT dbo.projects (name, repo, default_branch, default_agent, policy, sandbox_size, tech) VALUES (N'Size', N'DanAakesen/size', N'main', N'codex', N'deliver_pr', N'4x8', N'node')", 'CK_projects_sandbox_size'],
    ["INSERT dbo.tasks (project_id, title, request, source, agent) VALUES (1, N'Voice', N'Do it', N'voice', N'codex')", 'CK_tasks_origin_message'],
    ["INSERT dbo.tasks (project_id, title, request, source, agent, state) VALUES (1, N'Lower', N'Do it', N'board', N'codex', N'ready')", 'CK_tasks_state'],
    ["INSERT dbo.tasks (project_id, title, request, source, agent, lease_owner) VALUES (1, N'Lease', N'Do it', N'board', N'codex', N'd1')", 'CK_tasks_lease'],
    ["INSERT dbo.tool_calls (message_id, tool, arguments, outcome) VALUES (1, N'create_task', N'{}', N'maybe')", 'CK_tool_calls_outcome'],
    ["INSERT dbo.task_events (task_id, type, source) VALUES (1, N'created', N'agent')", 'CK_task_events_source'],
    ["INSERT dbo.activity (area, kind, title) VALUES (N'Factory', N'task_done', N'Done')", 'CK_activity_area'],
    ["INSERT dbo.sandbox_sessions (task_id, foundry_session_id, agent_version, size, image, status) VALUES (1, N'bad-size', N'1', N'4x8', N'image', N'Active')", 'CK_sandbox_sessions_size'],
    ["INSERT dbo.sandbox_sessions (task_id, foundry_session_id, agent_version, size, image, status) VALUES (1, N'bad-status', N'1', N'1x2', N'image', N'active')", 'CK_sandbox_sessions_status'],
    ["INSERT dbo.sandbox_sessions (task_id, foundry_session_id, agent_version, size, image, status) VALUES (1, N'', N'1', N'1x2', N'image', N'Active')", 'CK_sandbox_sessions_foundry_session_id'],
    ["INSERT dbo.sandbox_sessions (task_id, foundry_session_id, agent_version, agent_name, size, image, status) VALUES (1, N'bad-agent', N'1', N'', N'1x2', N'image', N'Active')", 'CK_sandbox_sessions_agent_name'],
    ["INSERT dbo.sandbox_turns (sandbox_session_id, invocation_id, mode, acp_session_id, status) VALUES (1, N'i', N'other', N'a', N'running')", 'CK_sandbox_turns_mode'],
    ["INSERT dbo.sandbox_turns (sandbox_session_id, invocation_id, mode, acp_session_id, status) VALUES (1, N'i', N'task', N'a', N'Running')", 'CK_sandbox_turns_status'],
    ["INSERT dbo.sandbox_turns (sandbox_session_id, invocation_id, mode, acp_session_id, status) VALUES (1, N'', N'task', N'a', N'running')", 'CK_sandbox_turns_invocation_id'],
    ["INSERT dbo.artifacts (task_id, kind, blob_path, size_bytes) VALUES (1, N'other', N'path', 1)", 'CK_artifacts_kind'],
    ["INSERT dbo.artifacts (task_id, kind, blob_path, size_bytes) VALUES (1, N'log', N'path', -1)", 'CK_artifacts_size_bytes'],
    ["INSERT dbo.webhook_deliveries (delivery_id, event, received_at, processed_at, outcome) VALUES (N'delivery-bad', N'push', '2026-01-01', '2026-01-02', N'pending')", 'CK_webhook_deliveries_outcome'],
    ["INSERT dbo.credential_status (name, status) VALUES (N'unknown', N'ok')", 'CK_credential_status_name'],
    ["INSERT dbo.credential_status (name, status) VALUES (N'github-app-key', N'expired')", 'CK_credential_status_status'],
  ])('rejects invalid data %#', async (statement, constraint) => {
    await expect(pool.request().query(statement)).rejects.toThrow(constraint);
  });

  it('refuses to revert a migration that is not the latest applied one and keeps state on failure', async () => {
    const committed = await readMigrations();
    const text = 'CREATE TABLE dbo.revert_fixture (id int);';
    const fixture: Migration = { name: '9999_revert_fixture.sql', sql: text, checksum: createHash('sha256').update(text).digest('hex') };
    expect(await applyMigrations(pool, [...committed, fixture])).toEqual([fixture.name]);
    await expect(revertMigration(pool, [...committed, fixture], await readDownMigration(core))).rejects.toThrow('latest applied');
    const failing = { name: fixture.name, sql: "DROP TABLE dbo.revert_fixture; THROW 51000, 'fixture failure', 1;" };
    await expect(revertMigration(pool, [...committed, fixture], failing)).rejects.toThrow();
    expect(await tables()).toEqual([...tablesInSchema, 'revert_fixture'].sort());
    expect(await revertMigration(pool, [...committed, fixture], { name: fixture.name, sql: 'DROP TABLE dbo.revert_fixture;' })).toBe(fixture.name);
    expect(await ledger()).toEqual(committed.map((migration) => migration.name));
  });

  it('reverts every committed migration with its down script, newest first, and applies them again', async () => {
    const committed = await readMigrations();
    for (const migration of [...committed].reverse()) {
      expect(await revertMigration(pool, committed, await readDownMigration(migration.name))).toBe(migration.name);
    }
    expect(await tables()).toEqual([]);
    expect(await ledger()).toEqual([]);
    await expect(revertMigration(pool, committed, await readDownMigration(core))).rejects.toThrow('latest applied');
    expect(await applyMigrations(pool, committed)).toEqual(committed.map((migration) => migration.name));
    expect(await tables()).toEqual(tablesInSchema);
  });
});
