import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectStore } from './projects.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { coreModule } from '../core/index.js';
import type { ToolCallRecord } from '../core/tool-calls.js';
import { ENGLISH_REALTIME_INSTRUCTIONS } from '../voice/realtime.js';
import type { TaskController, TaskDetail, TaskRecord, TaskStore } from './task-store.js';
import { factoryModule } from './index.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = {
  authorization: ['Bearer', ['e30', 'e30', 'sig'].join('.')].join(' '),
  'x-jarvis-message-id': '42',
};
const apps: ReturnType<typeof buildApp>[] = [];

const project = {
  id: '7',
  name: 'Jarvis',
  repo: 'DanAakesen/jarvis',
  default_branch: 'main',
  default_agent: 'codex' as const,
  policy: 'deliver_pr' as const,
  merge_rules: 'private project instructions',
  sandbox_size: '1x2' as const,
  tech: 'node',
  max_parallel_tasks: 2,
  active: true,
};

const task: TaskRecord = {
  id: '42',
  projectId: '7',
  originMessageId: null,
  title: 'Fix the bug',
  request: 'Find and fix it',
  source: 'board',
  agent: 'codex',
  modelOverride: null,
  reasoningOverride: null,
  state: 'Ready',
  activity: null,
  priority: 0,
  attemptCount: 0,
  nextAttemptAt: null,
  branch: null,
  createdAt: '2026-10-03T12:00:00.000Z',
  startedAt: null,
  finishedAt: null,
};

const detail: TaskDetail = {
  ...task,
  events: [{
    id: '19',
    type: 'runner_output',
    summary: 'Updated the implementation',
    payload: { text: 'private event payload' },
    payloadTruncated: false,
    source: 'runner',
    at: '2026-10-03T12:01:00.000Z',
  }],
  usage: [],
};

function fixture() {
  const projectStore = { list: vi.fn(async () => [project]) } as unknown as ProjectStore;
  const taskStore = {
    create: vi.fn(async () => task),
    list: vi.fn(async () => [task]),
    get: vi.fn(async () => detail),
  } as unknown as TaskStore;
  const taskController: TaskController = {
    control: vi.fn(async () => ({ kind: 'ok' as const, task })),
  };
  const record = vi.fn<(call: ToolCallRecord) => Promise<void>>(async () => {});
  const app = buildApp(config, undefined, {
    modules: [coreModule, factoryModule],
    auth: async () => ({
      objectId: config.auth.ownerObjectId,
      tenantId: config.auth.tenantId,
      displayName: 'Dan',
    }),
    projectStore,
    taskStore,
    taskController,
    toolCallStore: { record },
  });
  apps.push(app);
  return { app, projectStore, taskStore, taskController, record };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Software Factory Jarvis tools', () => {
  it('registers every project and task tool for discovery and English voice', async () => {
    const names = [
      'list_projects', 'list_tasks', 'get_task', 'create_task',
      'steer_task', 'pause_task', 'resume_task', 'cancel_task', 'create_project',
    ];
    expect(factoryModule.tools.map(({ name }) => name)).toEqual(names);
    for (const name of names) expect(ENGLISH_REALTIME_INSTRUCTIONS).toContain(name);

    const { app } = fixture();
    const response = await app.inject({ url: '/tools', headers });
    expect(response.statusCode).toBe(200);
    expect(response.json().map(({ name }: { name: string }) => name)).toEqual([
      ...coreModule.tools.map(({ name }) => name), ...names,
    ]);
    expect(response.json().every(({ inputSchema }: { inputSchema: { type: string } }) =>
      inputSchema.type === 'object')).toBe(true);
  });

  it('executes all tools through their stores and records message-linked calls', async () => {
    const { app, projectStore, taskStore, taskController, record } = fixture();
    const calls: [string, Record<string, unknown>][] = [
      ['list_projects', {}],
      ['list_tasks', { projectId: '7', agent: 'codex', state: 'Ready', limit: 10, offset: 2 }],
      ['get_task', { taskId: '42', eventLimit: 20, eventOffset: 1 }],
      ['create_task', {
        projectId: '7', prompt: 'Fix the bug\nMore details', agent: 'copilot', model: 'gpt-5', reasoning: 'high',
      }],
      ['steer_task', { taskId: '42', message: 'Keep the current approach.' }],
      ['pause_task', { taskId: '42' }],
      ['resume_task', { taskId: '42' }],
      ['cancel_task', { taskId: '42' }],
    ];

    for (const [index, [name, payload]] of calls.entries()) {
      const response = await app.inject({
        method: 'POST',
        url: `/tools/${name}`,
        headers: { ...headers, 'x-jarvis-message-id': String(index + 42) },
        payload,
      });
      expect(response.statusCode, name).toBe(200);
      expect(response.json()).toMatchObject({
        tool: name,
        outcome: 'ok',
        confirmation: `Done: ${name} succeeded.`,
      });
    }

    expect(projectStore.list).toHaveBeenCalledOnce();
    expect(taskStore.list).toHaveBeenCalledWith({
      projectId: '7', agent: 'codex', state: 'Ready', limit: 10, offset: 2,
    });
    expect(taskStore.get).toHaveBeenCalledWith('42', 20, 1);
    expect(taskStore.create).toHaveBeenCalledWith({
      projectId: '7',
      title: 'Fix the bug',
      request: 'Fix the bug\nMore details',
      agent: 'copilot',
      modelOverride: 'gpt-5',
      reasoningOverride: 'high',
    });
    expect(taskController.control).toHaveBeenCalledTimes(4);
    expect(record).toHaveBeenCalledTimes(calls.length);
    expect(record.mock.calls.map(([call]) => call.messageId)).toEqual(
      calls.map((_call, index) => String(index + 42)),
    );

    const results = record.mock.calls.map(([call]) => JSON.stringify(call.result)).join('\n');
    expect(results).not.toContain('private project instructions');
    expect(results).not.toContain('private event payload');
    expect(results).toContain('"summary":"Updated the implementation"');
  });

  it('rejects invalid inputs before execution or tool-call recording', async () => {
    const { app, record, projectStore, taskStore, taskController } = fixture();
    const invalidCalls: [string, unknown][] = [
      ['list_projects', null],
      ['list_tasks', { state: 'running' }],
      ['get_task', { taskId: '0' }],
      ['create_task', { projectId: '7', prompt: '' }],
      ['steer_task', { taskId: '42', message: '   ' }],
      ['pause_task', {}],
      ['resume_task', {}],
      ['cancel_task', {}],
    ];

    for (const [name, payload] of invalidCalls) {
      const response = await app.inject({
        method: 'POST', url: `/tools/${name}`, headers, payload,
      });
      expect(response.statusCode, name).toBe(400);
    }
    expect(record).not.toHaveBeenCalled();
    expect(projectStore.list).not.toHaveBeenCalled();
    expect(taskStore.list).not.toHaveBeenCalled();
    expect(taskStore.get).not.toHaveBeenCalled();
    expect(taskStore.create).not.toHaveBeenCalled();
    expect(taskController.control).not.toHaveBeenCalled();
  });

  it('returns refused, reasoned outcomes for missing records and invalid lifecycle actions', async () => {
    const { app, taskStore, taskController, record } = fixture();
    vi.mocked(taskStore.get).mockResolvedValue(null);
    vi.mocked(taskStore.create).mockResolvedValue(null);
    vi.mocked(taskController.control).mockResolvedValue({ kind: 'invalid-transition' });

    const missingTask = await app.inject({
      method: 'POST', url: '/tools/get_task', headers, payload: { taskId: '404' },
    });
    expect(missingTask.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: 'Task not found.' },
      confirmation: 'Not done: get_task was refused. Task not found.',
    });

    const missingProject = await app.inject({
      method: 'POST', url: '/tools/create_task', headers, payload: { projectId: '7', prompt: 'Fix a bug' },
    });
    expect(missingProject.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: 'Active project not found.' },
      confirmation: 'Not done: create_task was refused. Active project not found.',
    });

    const pauseReadyTask = await app.inject({
      method: 'POST', url: '/tools/pause_task', headers, payload: { taskId: '42' },
    });
    expect(pauseReadyTask.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: 'Task state does not allow this action.' },
      confirmation: 'Not done: pause_task was refused. Task state does not allow this action.',
    });
    expect(taskController.control).toHaveBeenCalledWith('42', { action: 'pause' });
    expect(record.mock.calls.map(([call]) => call.outcome)).toEqual(['refused', 'refused', 'refused']);
  });
});
