import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { TaskDetail, TaskRecord, TaskStore } from '../factory/task-store.js';
import type { ContainerAppScaler } from './container-app-scale.js';

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
const detail: TaskDetail = { ...task, events: [] };

function fixture({
  state = 'awake',
  ready = [],
  running = [],
  scalerAvailable = true,
}: {
  state?: 'awake' | 'asleep';
  ready?: TaskRecord[];
  running?: TaskRecord[];
  scalerAvailable?: boolean;
} = {}) {
const withNoActiveTasks = vi.fn(async (operation: () => Promise<void>) => ready.length > 0 || running.length > 0
  ? { kind: 'active' as const }
  : { kind: 'idle' as const, value: await operation() });
const taskStore: TaskStore = {
  create: vi.fn(async () => task),
  list: vi.fn(async () => []),
  get: vi.fn(async () => detail),
  getEventsAfter: vi.fn(async () => []),
  transition: vi.fn(async () => ({ kind: 'ok' as const, task })),
  withNoActiveTasks,
  };
  const scaler: ContainerAppScaler = {
    getMinimumReplicas: vi.fn(async () => state === 'asleep' ? 0 : 1),
    setMinimumReplicas: vi.fn(async () => undefined),
  };
  const app = buildApp(config, undefined, {
    taskStore,
    containerAppScaler: scalerAvailable ? scaler : null,
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan' }),
  });
  apps.push(app);
  return { app, withNoActiveTasks, scaler };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('sleep switch API', () => {
  it('reports the configured minimum replica state', async () => {
    const sleeping = fixture({ state: 'asleep' });
    const response = await sleeping.app.inject({ url: '/operations/sleep', headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ state: 'asleep' });
  });

  it.each([
    ['Ready', { ready: [task] }],
    ['Running', { running: [{ ...task, state: 'Running' as const }] }],
  ])('refuses sleep while a %s task exists', async (_state, tasks) => {
    const { app, scaler } = fixture(tasks);
    const response = await app.inject({
      method: 'PUT',
      url: '/operations/sleep',
      headers,
      payload: { state: 'asleep' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'Cannot put the backend to sleep while tasks are Ready or Running.' });
    expect(scaler.setMinimumReplicas).not.toHaveBeenCalled();
  });

  it('sets awake or asleep through ARM when no active task exists', async () => {
    const { app, withNoActiveTasks, scaler } = fixture();

    const sleep = await app.inject({ method: 'PUT', url: '/operations/sleep', headers, payload: { state: 'asleep' } });
    expect(sleep.statusCode).toBe(200);
    expect(sleep.json()).toEqual({ state: 'asleep' });
    expect(withNoActiveTasks).toHaveBeenCalledOnce();
    expect(scaler.setMinimumReplicas).toHaveBeenCalledWith(0);

    const awake = await app.inject({ method: 'PUT', url: '/operations/sleep', headers, payload: { state: 'awake' } });
    expect(awake.statusCode).toBe(200);
    expect(awake.json()).toEqual({ state: 'awake' });
    expect(scaler.setMinimumReplicas).toHaveBeenCalledWith(1);
  });

  it('validates requested states, keeps the route Dan-only, and reports missing configuration', async () => {
    const configured = fixture();
    expect((await configured.app.inject({
      method: 'PUT', url: '/operations/sleep', headers, payload: { state: 'sleeping' },
    })).statusCode).toBe(400);

    const unauthorizedApp = buildApp(config);
    apps.push(unauthorizedApp);
    const unauthorized = await unauthorizedApp.inject({ url: '/operations/sleep' });
    expect(unauthorized.statusCode).toBe(401);

    const unavailable = fixture({ scalerAvailable: false });
    const response = await unavailable.app.inject({ url: '/operations/sleep', headers });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Backend scaling is unavailable' });
  });

  it('does not report success when the ARM operation fails', async () => {
    const deniedScaler: ContainerAppScaler = {
      getMinimumReplicas: vi.fn(async () => 1),
      setMinimumReplicas: vi.fn(async () => { throw new Error('sensitive provider response'); }),
    };
    const failing = buildApp(config, undefined, {
      containerAppScaler: deniedScaler,
      auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan' }),
    });
    apps.push(failing);
    const response = await failing.inject({ method: 'PUT', url: '/operations/sleep', headers, payload: { state: 'awake' } });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('sensitive provider response');
  });
});
