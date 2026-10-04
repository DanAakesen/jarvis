import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEventHub } from '../core/event-hub.js';
import type { SettingsStore } from '../core/settings.js';
import type { TaskRequest } from '../foundry/client.js';
import { TaskDispatcher } from '../factory/dispatcher.js';
import type { SandboxHeartbeat } from '../factory/heartbeat.js';
import type { TaskEventMessage } from '../factory/task-store.js';
import { createTaskStore } from './task-store.js';
import { createDispatcherStore } from './dispatcher-store.js';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readMigrations } from './migrations.js';

// P6-05 parallel load test: real SQL coordination, three competing dispatchers,
// both agents and several projects. Foundry is faked; live sandboxes and the
// Codex Pro allowance are outside this test (see docs/decisions.md).

const configuration = loadDatabaseConfig();
if (!configuration || process.env.NODE_ENV !== 'test' || configuration.server !== '127.0.0.1') {
  throw new Error('Dispatcher load tests require an isolated loopback SQL Server test configuration');
}

const database = `jarvis_load_${randomUUID().replaceAll('-', '')}`;
const administrator = new sql.ConnectionPool({ ...configuration, database: 'master' });
const pool = new sql.ConnectionPool({ ...configuration, database });

const globalLimit = 4;
const projectLimits = [2, 2, 1];
const tasksPerProject = 5;
const dispatcherCount = 3;
const sandboxRunMs = 500;

beforeAll(async () => {
  await administrator.connect();
  await administrator.request().batch(`CREATE DATABASE [${database}];`);
  await pool.connect();
  await applyMigrations(pool, await readMigrations());
  await pool.request()
    .input('limit', sql.NVarChar(16), String(globalLimit))
    .query(`INSERT dbo.settings (scope, [key], value) VALUES (N'global', N'global.max_parallel_tasks', @limit);
      UPDATE dbo.credential_status SET status = N'ok', expires_at = DATEADD(day, 9, SYSUTCDATETIME()),
        last_renewed_at = SYSUTCDATETIME() WHERE name = N'codex-login';`);
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

async function createProject(index: number, maxParallelTasks: number): Promise<string> {
  const project = await pool.request()
    .input('name', sql.NVarChar(100), `Load project ${index + 1}`)
    .input('repo', sql.NVarChar(140), `DanAakesen/load-${index + 1}-${randomUUID().slice(0, 8)}`)
    .input('maxParallelTasks', sql.Int, maxParallelTasks)
    .query<{ id: string }>(`INSERT dbo.projects (name, repo, default_branch, default_agent, policy, sandbox_size, tech, max_parallel_tasks)
      OUTPUT CAST(inserted.id AS varchar(19)) AS id
      VALUES (@name, @repo, N'main', N'copilot', N'deliver_pr', N'1x2', N'node', @maxParallelTasks);`);
  const projectId = project.recordset[0]?.id;
  if (!projectId) throw new Error('Load project fixture was not created');
  return projectId;
}

async function activeCounts(): Promise<{ global: number; byProject: Map<string, number> }> {
  const { recordset } = await pool.request()
    .query<{ projectId: string; active: number }>(`SELECT CAST(project_id AS varchar(19)) AS projectId, COUNT(*) AS active
      FROM dbo.tasks
      WHERE state IN (N'Running', N'PauseRequested') OR (state = N'Ready' AND lease_until > SYSUTCDATETIME())
      GROUP BY project_id;`);
  const byProject = new Map(recordset.map((row) => [row.projectId, row.active]));
  return { global: recordset.reduce((sum, row) => sum + row.active, 0), byProject };
}

function settings(): SettingsStore {
  return { read: vi.fn(async () => ({})), write: vi.fn(async () => {}) };
}

describe('dispatcher parallel load', () => {
  it('runs tasks across projects with both agents within every limit and releases capacity after Codex limit failures', async () => {
    const events = createEventHub<TaskEventMessage>();
    const taskStore = createTaskStore(pool, events);
    const projects = await Promise.all(projectLimits.map((limit, index) => createProject(index, limit)));
    const limitByProject = new Map(projects.map((projectId, index) => [projectId, projectLimits[index] ?? 0]));

    const tasks: { id: string; projectId: string; agent: 'codex' | 'copilot'; hitsCodexLimit: boolean }[] = [];
    let codexTasks = 0;
    for (let round = 0; round < tasksPerProject; round += 1) {
      for (const projectId of projects) {
        const agent = tasks.length % 2 === 0 ? 'codex' : 'copilot';
        const created = await taskStore.create({
          projectId, title: `Load task ${tasks.length + 1}`, request: 'Make a small change', agent,
        });
        if (!created) throw new Error('Load task fixture was not created');
        // Every second Codex task ends as if the runner reported the Pro usage limit.
        const hitsCodexLimit = agent === 'codex' && codexTasks % 2 === 1;
        if (agent === 'codex') codexTasks += 1;
        tasks.push({ id: created.id, projectId, agent, hitsCodexLimit });
      }
    }
    const taskById = new Map(tasks.map((task) => [task.id, task]));

    const running = new Set<string>();
    const runningByProject = new Map<string, number>();
    const violations: string[] = [];
    const starts: { taskId: string; agent: string; runnerName: string; dispatcher: number }[] = [];
    let maxGlobal = 0;
    const maxByProject = new Map<string, number>();
    const finishedStates = new Map<string, string>();
    let resolveDrained!: () => void;
    const drained = new Promise<void>((resolve) => { resolveDrained = resolve; });

    const finish = async (taskId: string) => {
      const task = taskById.get(taskId);
      if (!task) return;
      // Leave the in-memory set before committing so it never counts more than SQL does.
      running.delete(taskId);
      runningByProject.set(task.projectId, (runningByProject.get(task.projectId) ?? 1) - 1);
      const result = task.hitsCodexLimit
        ? await taskStore.transition(taskId, 'NeedsAttention')
        : await taskStore.transition(taskId, 'Done', true);
      finishedStates.set(taskId, result.kind === 'ok' ? result.task.state : `failed:${result.kind}`);
      if (finishedStates.size === tasks.length) resolveDrained();
    };
    const unsubscribe = events.subscribe((event) => {
      if (event.type === 'sandbox_started' && taskById.has(event.taskId)) {
        setTimeout(() => { void finish(event.taskId).catch((error: unknown) => violations.push(String(error))); }, sandboxRunMs);
      }
    });

    const errors: unknown[] = [];
    const track = vi.fn();
    const dispatchers = Array.from({ length: dispatcherCount }, (_unused, index) => new TaskDispatcher(
      createDispatcherStore(pool, events), taskStore, settings(),
      (runnerName) => ({
        startTask: vi.fn(async (request: TaskRequest) => {
          const taskId = request.taskId;
          const task = taskId === undefined ? undefined : taskById.get(taskId);
          if (!taskId || !task) throw new Error('Start request did not name a load task');
          if (request.agent !== task.agent) violations.push(`task ${taskId} started with ${request.agent}`);
          starts.push({ taskId, agent: request.agent, runnerName, dispatcher: index });
          running.add(taskId);
          const projectRunning = (runningByProject.get(task.projectId) ?? 0) + 1;
          runningByProject.set(task.projectId, projectRunning);
          maxGlobal = Math.max(maxGlobal, running.size);
          maxByProject.set(task.projectId, Math.max(maxByProject.get(task.projectId) ?? 0, projectRunning));
          const counts = await activeCounts();
          if (counts.global > globalLimit) violations.push(`global active ${counts.global}`);
          for (const [projectId, active] of counts.byProject) {
            if (active > (limitByProject.get(projectId) ?? 0)) violations.push(`project ${projectId} active ${active}`);
          }
          return {
            invocationId: `load-invocation-${taskId}`,
            sessionId: `load-session-${taskId}`,
            status: 'queued' as const,
            agent: request.agent,
          };
        }),
        deleteSession: vi.fn(async () => {}),
        steer: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        cancel: vi.fn(),
      }),
      { track, untrack: vi.fn() } as unknown as SandboxHeartbeat,
      events,
      { onError: (error) => errors.push(error) },
    ));

    const startedAt = Date.now();
    dispatchers.forEach((dispatcher) => dispatcher.start());
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        drained,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error(
            `Timed out with ${finishedStates.size}/${tasks.length} tasks finished; ` +
            `unfinished ${tasks.filter((task) => !finishedStates.has(task.id)).map((task) => task.id).join(', ')}; ` +
            `dispatcher errors: ${errors.map((error) => (error instanceof Error ? error.message : String(error))).join(' | ') || 'none'}; ` +
            `violations: ${violations.join(' | ') || 'none'}`)), 90_000);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
      await Promise.all(dispatchers.map((dispatcher) => dispatcher.stop()));
      unsubscribe();
    }
    const elapsedMs = Date.now() - startedAt;

    const dispatchersUsed = new Set(starts.map((start) => start.dispatcher)).size;
    console.info(`P6-05 load: ${tasks.length} tasks, ${projects.length} projects, ${dispatcherCount} dispatchers, ` +
      `${elapsedMs} ms, max global ${maxGlobal}/${globalLimit}, max per project ` +
      `${projects.map((projectId) => `${maxByProject.get(projectId) ?? 0}/${limitByProject.get(projectId)}`).join(', ')}, ` +
      `dispatchers used ${dispatchersUsed}, Codex limit failures ${tasks.filter((task) => task.hitsCodexLimit).length}`);

    expect(errors).toEqual([]);
    expect(violations).toEqual([]);
    expect(starts).toHaveLength(tasks.length);
    expect(new Set(starts.map((start) => start.taskId)).size).toBe(tasks.length);
    expect(new Set(starts.map((start) => start.agent))).toEqual(new Set(['codex', 'copilot']));
    expect(new Set(starts.map((start) => start.runnerName))).toEqual(new Set(['jarvis-runner-base-1x2']));
    expect(track).toHaveBeenCalledTimes(tasks.length);
    expect(maxGlobal).toBe(globalLimit);
    for (const projectId of projects) {
      expect(maxByProject.get(projectId)).toBeGreaterThanOrEqual(1);
      expect(maxByProject.get(projectId)).toBeLessThanOrEqual(limitByProject.get(projectId) ?? 0);
    }
    for (const task of tasks) {
      expect(finishedStates.get(task.id)).toBe(task.hitsCodexLimit ? 'NeedsAttention' : 'Done');
    }
    await vi.waitFor(async () => {
      const sessions = await pool.request()
        .query<{ taskId: string; sessions: number; status: string; usageRows: number }>(`SELECT
          CAST(t.id AS varchar(19)) AS taskId, COUNT(s.id) AS sessions, MAX(s.status) AS status,
          (SELECT COUNT(*) FROM dbo.usage AS u WHERE u.task_id = t.id
            AND u.source = N'sandbox' AND u.metric = N'minutes') AS usageRows
          FROM dbo.tasks AS t LEFT JOIN dbo.sandbox_sessions AS s ON s.task_id = t.id
          GROUP BY t.id;`);
      expect(sessions.recordset).toHaveLength(tasks.length);
      for (const row of sessions.recordset) {
        const task = taskById.get(row.taskId);
        expect(row).toEqual({
          taskId: row.taskId, sessions: 1, status: task?.hitsCodexLimit ? 'Crashed' : 'Ended', usageRows: 1,
        });
      }
    }, { timeout: 15_000, interval: 250 });
    expect((await activeCounts()).global).toBe(0);
  });
});
