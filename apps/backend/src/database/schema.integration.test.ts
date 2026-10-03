import { createHash, randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readDownMigration, readMigrations, revertMigration, type Migration } from './migrations.js';
import { createSettingsStore } from './settings-store.js';

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
