import { createHash, randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readDownMigration, readMigrations, revertMigration, type Migration } from './migrations.js';
import { createTaskStore } from './task-store.js';

const configuration = loadDatabaseConfig();
if (!configuration || process.env.NODE_ENV !== 'test' || configuration.server !== '127.0.0.1') {
  throw new Error('Database integration tests require an isolated loopback SQL Server test configuration');
}
const database = `jarvis_ci_${randomUUID().replaceAll('-', '')}`;
const administrator = new sql.ConnectionPool({ ...configuration, database: 'master' });
const pool = new sql.ConnectionPool({ ...configuration, database });
const core = '0001_core_tables.sql';
const coreTables = ['activity', 'jarvis_sessions', 'messages', 'projects', 'settings', 'task_events', 'tasks', 'tool_calls'];

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

describe('committed domain schema (groups 1-3)', () => {
  it('boots the committed migration manifest twice without duplicate ledger rows', async () => {
    const committed = await readMigrations();
    expect(await applyMigrations(pool, committed)).toEqual(committed.map((migration) => migration.name));
    expect(await applyMigrations(pool, committed)).toEqual([]);
    expect(await ledger()).toEqual(committed.map((migration) => migration.name));
    expect(await tables()).toEqual(coreTables);
    const { recordset } = await pool.request().query<{ name: string }>(
      "SELECT name FROM sys.indexes WHERE name IN (N'IX_tasks_state_next_attempt_at', N'IX_task_events_task_id_at') ORDER BY name");
    expect(recordset.map((row) => row.name)).toEqual(['IX_task_events_task_id_at', 'IX_tasks_state_next_attempt_at']);
  });

  it('stores a valid conversation, project, task, tool call, event and activity', async () => {
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
    const row = await pool.request().query<{ state: string; priority: number; attempt_count: number }>(
      `SELECT state, priority, attempt_count FROM dbo.tasks WHERE id = ${String(task)}`);
    expect(row.recordset).toEqual([{ state: 'Running', priority: 0, attempt_count: 0 }]);
  });

  it('creates, filters, reads and transitions tasks with transactional history', async () => {
    const projectResult = await pool.request()
      .input('repo', sql.NVarChar(140), `DanAakesen/tasks-${randomUUID().slice(0, 8)}`)
      .query<{ id: string }>(`INSERT dbo.projects (name, repo, default_branch, default_agent, policy, sandbox_size, tech)
        OUTPUT CAST(inserted.id AS varchar(19)) AS id
        VALUES (N'Task API fixture', @repo, N'main', N'copilot', N'deliver_pr', N'1x2', N'node');`);
    const projectId = projectResult.recordset[0]?.id;
    if (!projectId) throw new Error('Task API fixture project was not created');
    const store = createTaskStore(pool);
    const created = await store.create({ projectId, title: 'Task API contract', request: 'Exercise SQL task operations' });
    expect(created).toMatchObject({ projectId, agent: 'copilot', source: 'board', state: 'Ready' });
    if (!created) throw new Error('Task API fixture task was not created');

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
    await transition(created.id, 'NeedsAttention');
    await transition(created.id, 'Running');
    await transition(created.id, 'Done', true);
    expect((await store.transition(created.id, 'Running')).kind).toBe('invalid-transition');

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
    expect(await tables()).toEqual([...coreTables, 'revert_fixture'].sort());
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
    expect(await tables()).toEqual(coreTables);
  });
});
