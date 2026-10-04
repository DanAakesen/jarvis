import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConversationStore } from './conversation-store.js';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readMigrations } from './migrations.js';

const configuration = loadDatabaseConfig();
if (!configuration || process.env.NODE_ENV !== 'test' || configuration.server !== '127.0.0.1') {
  throw new Error('Database integration tests require an isolated loopback SQL Server test configuration');
}
const database = `jarvis_conversation_${randomUUID().replaceAll('-', '')}`;
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

describe('SQL conversation store', () => {
  it('writes sessions and messages, pages history with tool/task references, and closes idempotently', async () => {
    const store = createConversationStore(pool);
    const session = await store.createSession({ channel: 'chat', language: 'da' });
    await expect(store.getSession(session.id)).resolves.toMatchObject({
      id: session.id,
      channel: 'chat',
      language: 'da',
      endedAt: null,
    });
    const dan = await store.addMessage({
      sessionId: session.id,
      role: 'dan',
      text: 'Start a task',
      model: null,
    });
    const jarvis = await store.addMessage({
      sessionId: session.id,
      role: 'jarvis',
      text: 'I started it.',
      model: 'gpt-5.6-luna',
    });
    expect(dan).not.toBeNull();
    expect(jarvis).not.toBeNull();

    const project = await pool.request()
      .input('name', sql.NVarChar(100), 'Conversation fixture')
      .input('repo', sql.NVarChar(140), `jarvis-test/${randomUUID()}`)
      .query<{ id: string }>(`INSERT INTO dbo.projects (name, repo, default_branch, default_agent, policy, sandbox_size, tech)
        OUTPUT CONVERT(varchar(20), INSERTED.id) AS id
        VALUES (@name, @repo, N'main', N'copilot', N'deliver_pr', N'1x2', N'node');`);
    const projectId = project.recordset[0]?.id;
    if (!projectId || !dan || !jarvis) throw new Error('Conversation integration fixture was not created');

    const task = await pool.request()
      .input('projectId', sql.BigInt, BigInt(projectId))
      .input('originMessageId', sql.BigInt, BigInt(dan.id))
      .query<{ id: string }>(`INSERT INTO dbo.tasks (project_id, origin_message_id, title, request, source, agent)
        OUTPUT CONVERT(varchar(20), INSERTED.id) AS id
        VALUES (@projectId, @originMessageId, N'Conversation task', N'Start a task', N'chat', N'copilot');`);
    const taskId = task.recordset[0]?.id;
    if (!taskId) throw new Error('Conversation task fixture was not created');

    await pool.request()
      .input('messageId', sql.BigInt, BigInt(jarvis.id))
      .input('tool', sql.NVarChar(64), 'factory_create_task')
      .input('arguments', sql.NVarChar(sql.MAX), JSON.stringify({ title: 'Conversation task' }))
      .input('result', sql.NVarChar(sql.MAX), JSON.stringify({ taskId }))
      .input('outcome', sql.NVarChar(8), 'ok')
      .input('taskId', sql.BigInt, BigInt(taskId))
      .query(`INSERT INTO dbo.tool_calls (message_id, tool, [arguments], result, outcome, task_id)
        VALUES (@messageId, @tool, @arguments, @result, @outcome, @taskId);`);

    const latest = await store.getHistory({ limit: 1 });
    expect(latest).toMatchObject({
      messages: [{
        id: jarvis.id,
        sessionId: session.id,
        channel: 'chat',
        language: 'da',
        role: 'jarvis',
        text: 'I started it.',
        toolCalls: [{ tool: 'factory_create_task', outcome: 'ok', taskId }],
      }],
      nextCursor: jarvis.id,
    });

    const earlier = await store.getHistory({ limit: 1, before: jarvis.id });
    expect(earlier).toMatchObject({
      messages: [{ id: dan.id, role: 'dan', text: 'Start a task', toolCalls: [] }],
      nextCursor: null,
    });
    const origin = await pool.request()
      .input('taskId', sql.BigInt, BigInt(taskId))
      .query<{ origin_message_id: string }>('SELECT CONVERT(varchar(20), origin_message_id) AS origin_message_id FROM dbo.tasks WHERE id = @taskId;');
    expect(origin.recordset[0]?.origin_message_id).toBe(dan.id);

    expect(await store.endSession(session.id)).toBe(true);
    expect(await store.endSession(session.id)).toBe(true);
    expect(await store.endSession('9223372036854775807')).toBe(false);
    await expect(store.addMessage({
      sessionId: session.id,
      role: 'dan',
      text: 'After the sitting ended',
      model: null,
    })).resolves.toBeNull();
  });

  it('stores voice transcripts and one idempotent voice-minute usage row per session', async () => {
    const store = createConversationStore(pool);
    const session = await store.createSession({ channel: 'voice', language: 'en' });
    const dan = await store.addMessage({
      sessionId: session.id,
      role: 'dan',
      text: 'How is the task going?',
      model: null,
    });
    const jarvis = await store.addMessage({
      sessionId: session.id,
      role: 'jarvis',
      text: 'The task is complete.',
      model: 'gpt-realtime-2.1',
    });
    if (!dan || !jarvis) throw new Error('Voice transcript fixture was not created');

    expect(await store.endSession(session.id)).toBe(true);
    expect(await store.endSession(session.id)).toBe(true);

    const usage = await pool.request()
      .input('sessionId', sql.BigInt, BigInt(session.id))
      .query<{ count: number; source: string; metric: string; quantity: number }>(`SELECT COUNT(*) AS count,
        MAX(source) AS source, MAX(metric) AS metric, MAX(quantity) AS quantity
        FROM dbo.usage WHERE jarvis_session_id = @sessionId;`);
    expect(usage.recordset[0]).toMatchObject({ count: 1, source: 'voice', metric: 'minutes' });
    expect(usage.recordset[0]?.quantity).toBeGreaterThanOrEqual(0);

    // Earlier tests in this database leave their own messages; check only this session's.
    const history = await store.getHistory({ limit: 10 });
    expect(history.messages.filter((message) => message.sessionId === session.id)).toMatchObject([
      { id: dan.id, channel: 'voice', language: 'en', text: 'How is the task going?', voiceMinutes: usage.recordset[0]?.quantity },
      { id: jarvis.id, channel: 'voice', language: 'en', text: 'The task is complete.', voiceMinutes: usage.recordset[0]?.quantity },
    ]);
  });
});
