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

async function createTask(events: TaskEventHub, title: string) {
  const project = await pool.request()
    .input('repo', sql.NVarChar(140), `DanAakesen/dispatch-${randomUUID().slice(0, 8)}`)
    .query<{ id: string }>(`INSERT dbo.projects (name, repo, default_branch, default_agent, policy, sandbox_size, tech)
      OUTPUT CAST(inserted.id AS varchar(19)) AS id
      VALUES (N'Dispatch fixture', @repo, N'main', N'copilot', N'deliver_pr', N'1x2', N'node');`);
  const projectId = project.recordset[0]?.id;
  if (!projectId) throw new Error('Dispatcher project fixture was not created');
  const task = await createTaskStore(pool, events).create({ projectId, title, request: 'Run the task' });
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
});
