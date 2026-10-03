import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { TaskDetail, TaskRecord, TaskStore } from './task-store.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = { authorization: ['Bearer', ['e30', 'e30', 'sig'].join('.')].join(' ') };
const apps: ReturnType<typeof buildApp>[] = [];

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
    type: 'created',
    summary: 'Task created from the board',
    payload: { state: 'Ready' },
    source: 'backend',
    at: '2026-10-03T12:00:00.000Z',
  }],
};

function fixture(overrides: Partial<TaskStore> = {}) {
  const store: TaskStore = {
    create: vi.fn(async () => task),
    list: vi.fn(async () => [task]),
    get: vi.fn(async () => detail),
    transition: vi.fn(async () => ({ kind: 'ok' as const, task })),
    ...overrides,
  };
  const app = buildApp(config, undefined, {
    taskStore: store,
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan' }),
  });
  apps.push(app);
  return { app, store };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('factory tasks API', () => {
  it('creates a Ready board task for an active project', async () => {
    const { app, store } = fixture();
    const response = await app.inject({
      method: 'POST',
      url: '/factory/tasks',
      headers,
      payload: { projectId: '7', title: 'Fix the bug', request: 'Find and fix it', agent: 'codex' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ id: '42', source: 'board', state: 'Ready' });
    expect(store.create).toHaveBeenCalledWith({
      projectId: '7', title: 'Fix the bug', request: 'Find and fix it', agent: 'codex',
    });
  });

  it('validates create input and reports a missing active project', async () => {
    const missingProject = fixture({ create: vi.fn(async () => null) });
    expect((await missingProject.app.inject({
      method: 'POST', url: '/factory/tasks', headers, payload: { projectId: '7', title: 'Task', request: 'Work' },
    })).statusCode).toBe(404);
    expect((await missingProject.app.inject({
      method: 'POST', url: '/factory/tasks', headers, payload: { projectId: '7', title: '', request: 'Work' },
    })).statusCode).toBe(400);
    expect((await missingProject.app.inject({
      method: 'POST', url: '/factory/tasks', headers,
      payload: { projectId: '9223372036854775808', title: 'Task', request: 'Work' },
    })).statusCode).toBe(400);
  });

  it('lists filtered and bounded task results', async () => {
    const { app, store } = fixture();
    const response = await app.inject({
      url: '/factory/tasks?projectId=7&agent=copilot&state=Running&createdAfter=2026-10-01T00%3A00%3A00Z&search=deploy&limit=10&offset=5',
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ tasks: [task], limit: 10, offset: 5 });
    expect(store.list).toHaveBeenCalledWith({
      projectId: '7', agent: 'copilot', state: 'Running',
      createdAfter: '2026-10-01T00:00:00Z', search: 'deploy', limit: 10, offset: 5,
    });
  });

  it('rejects invalid filters and reversed time ranges', async () => {
    const { app, store } = fixture();
    expect((await app.inject({ url: '/factory/tasks?state=running', headers })).statusCode).toBe(400);
    expect((await app.inject({ url: '/factory/tasks?limit=101', headers })).statusCode).toBe(400);
    expect((await app.inject({
      url: '/factory/tasks?createdAfter=2026-10-02T00%3A00%3A00Z&createdBefore=2026-10-01T00%3A00%3A00Z',
      headers,
    })).statusCode).toBe(400);
    expect(store.list).not.toHaveBeenCalled();
  });

  it('returns task details with their event history', async () => {
    const { app, store } = fixture();
    const response = await app.inject({ url: '/factory/tasks/42?eventLimit=20&eventOffset=2', headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(detail);
    expect(store.get).toHaveBeenCalledWith('42', 20, 2);
  });

  it('returns 404 for missing tasks and rejects malformed identifiers', async () => {
    const missing = fixture({ get: vi.fn(async () => null) });
    expect((await missing.app.inject({ url: '/factory/tasks/42', headers })).statusCode).toBe(404);
    expect((await missing.app.inject({ url: '/factory/tasks/9223372036854775808', headers })).statusCode).toBe(400);
    expect((await missing.app.inject({ url: '/factory/tasks/0', headers })).statusCode).toBe(400);
  });

  it('rejects illegal lifecycle transitions and returns not-found consistently', async () => {
    const invalid = fixture({ transition: vi.fn(async () => ({ kind: 'invalid-transition' as const })) });
    const conflict = await invalid.app.inject({
      method: 'PATCH', url: '/factory/tasks/42/state', headers, payload: { state: 'Done' },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ error: 'Invalid task transition' });

    const missing = fixture({ transition: vi.fn(async () => ({ kind: 'not-found' as const })) });
    expect((await missing.app.inject({
      method: 'PATCH', url: '/factory/tasks/42/state', headers, payload: { state: 'Running' },
    })).statusCode).toBe(404);
  });

  it('allows a valid transition and requires authentication', async () => {
    const { app, store } = fixture();
    const changed = await app.inject({
      method: 'PATCH', url: '/factory/tasks/42/state', headers, payload: { state: 'Running' },
    });
    expect(changed.statusCode).toBe(200);
    expect(store.transition).toHaveBeenCalledWith('42', 'Running');
    expect((await app.inject({ url: '/factory/tasks' })).statusCode).toBe(401);
  });
});
