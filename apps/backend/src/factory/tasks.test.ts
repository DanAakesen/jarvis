import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { TokenVerifier } from '../auth/verify.js';
import { createEventHub } from '../core/event-hub.js';
import type {
  RunningTaskContextSnapshot, TaskController, TaskDetail, TaskEventMessage, TaskRecord, TaskStore,
} from './task-store.js';
import type { GitHubAppTokenIssuer } from '../github-app.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = { authorization: ['Bearer', ['e30', 'e30', 'sig'].join('.')].join(' ') };
const runnerHeaders = { ...headers, 'x-jarvis-session-id': 'session-42' };
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
    payloadTruncated: false,
    source: 'backend',
    at: '2026-10-03T12:00:00.000Z',
  }],
};
const context: RunningTaskContextSnapshot = {
  runningTasks: [{
    id: '42',
    projectId: '7',
    projectName: 'Jarvis',
    title: 'Fix the bug',
    agent: 'codex',
    state: 'Running',
    activity: 'Updating tests',
    startedAt: '2026-10-03T12:00:00.000Z',
    recentEvents: [{
      type: 'progress',
      summary: 'Tests are being updated',
      summaryTruncated: false,
      source: 'runner',
      at: '2026-10-03T12:01:00.000Z',
    }],
  }],
  truncated: false,
};

function fixture(
  overrides: Partial<TaskStore> = {},
  auth: TokenVerifier = async () => ({
    objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan',
  }),
  taskController?: TaskController,
  githubAppTokenIssuer?: GitHubAppTokenIssuer,
) {
  const eventHub = createEventHub<TaskEventMessage>();
  const store: TaskStore = {
    create: vi.fn(async () => task),
    list: vi.fn(async () => [task]),
    get: vi.fn(async () => detail),
    updateModelConfig: vi.fn(async () => ({ kind: 'not-found' as const })),
    getActiveRepository: vi.fn(async () => 'DanAakesen/jarvis-test-target'),
    getEventsAfter: vi.fn(async (taskId, eventId, limit) => detail.events
      .filter((event) => BigInt(event.id) > BigInt(eventId))
      .slice(0, limit)
      .map((event) => ({ ...event, taskId }))),
    getRunningContext: vi.fn(async () => context),
    transition: vi.fn(async () => ({ kind: 'ok' as const, task })),
    withNoActiveTasks: vi.fn(async (operation) => ({ kind: 'idle' as const, value: await operation() })),
    recordEvent: vi.fn(async (event) => ({
      id: '20',
      taskId: event.taskId,
      type: event.type,
      summary: event.summary ?? null,
      payload: event.payload ?? null,
      payloadTruncated: false,
      source: event.source,
      at: task.createdAt,
    } satisfies TaskEventMessage)),
    ...overrides,
  };
  const app = buildApp(config, undefined, {
    taskStore: store,
    ...(taskController ? { taskController } : {}),
    ...(githubAppTokenIssuer ? { githubAppTokenIssuer } : {}),
    eventHub,
    auth,
  });
  apps.push(app);
  return { app, store, eventHub };
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

  it('rejects serialized task pages larger than the response limit', async () => {
    const manyTasks = Array.from({ length: 30 }, (_value, index) => ({
      ...task, id: String(index + 1), request: 'x'.repeat(50_000),
    }));
    const { app } = fixture({ list: vi.fn(async () => manyTasks) });
    const response = await app.inject({ url: '/factory/tasks', headers });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({ error: 'Response too large' });
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

  it('routes validated controls to the dispatcher and maps state conflicts', async () => {
    const controller: TaskController = {
      control: vi.fn(async () => ({ kind: 'ok', task })),
    };
    const { app } = fixture({}, undefined, controller);
    const response = await app.inject({
      method: 'POST',
      url: '/factory/tasks/42/controls',
      headers,
      payload: { action: 'steer', message: 'Keep the current approach.' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(task);
    expect(controller.control).toHaveBeenCalledWith('42', {
      action: 'steer', message: 'Keep the current approach.',
    });

    vi.mocked(controller.control).mockResolvedValue({ kind: 'invalid-transition' });
    const conflict = await app.inject({
      method: 'POST', url: '/factory/tasks/42/controls', headers, payload: { action: 'pause' },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ error: 'Task state does not allow this action' });
    expect((await app.inject({
      method: 'POST', url: '/factory/tasks/42/controls', headers, payload: { action: 'steer', message: '   ' },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'POST', url: '/factory/tasks/42/controls', headers, payload: { action: 'delete' },
    })).statusCode).toBe(400);
  });

  it('mints a task repository token only for its runner session', async () => {
    const issue = vi.fn(async (repository: string) =>
      repository === 'DanAakesen/jarvis-test-target' ? 'ghs_test-installation-token' : 'wrong-repository');
    const issuer = { issue } satisfies GitHubAppTokenIssuer;
    const runnerAuth: TokenVerifier = async () => ({
      kind: 'jarvis-runner',
      objectId: '11111111-1111-4111-8111-111111111111',
      tenantId: config.auth.tenantId,
    });
    const runner = fixture({}, runnerAuth, undefined, issuer);
    const response = await runner.app.inject({
      method: 'POST', url: '/factory/tasks/42/github-token', headers: runnerHeaders,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      token: 'ghs_test-installation-token',
      repository: 'DanAakesen/jarvis-test-target',
    });
    expect(runner.store.getActiveRepository).toHaveBeenCalledWith('42', 'session-42');
    expect(issue).toHaveBeenCalledWith('DanAakesen/jarvis-test-target');

    const otherSession = fixture({
      getActiveRepository: vi.fn(async (_taskId, sessionId) =>
        sessionId === 'session-42' ? 'DanAakesen/jarvis-test-target' : null),
    }, runnerAuth, undefined, issuer);
    const mismatched = await otherSession.app.inject({
      method: 'POST',
      url: '/factory/tasks/42/github-token',
      headers: { ...runnerHeaders, 'x-jarvis-session-id': 'another-session' },
    });
    expect(mismatched.statusCode).toBe(404);
    expect(issue).toHaveBeenCalledOnce();

    const user = fixture({}, undefined, undefined, issuer);
    const denied = await user.app.inject({
      method: 'POST', url: '/factory/tasks/42/github-token', headers: runnerHeaders,
    });
    expect(denied.statusCode).toBe(403);
    expect(issue).toHaveBeenCalledOnce();
  });

  it('rejects inactive tasks and sanitizes GitHub token failures', async () => {
    const runnerAuth: TokenVerifier = async () => ({
      kind: 'jarvis-runner',
      objectId: '11111111-1111-4111-8111-111111111111',
      tenantId: config.auth.tenantId,
    });
    const issuer = { issue: vi.fn(async () => 'ghs_test-token') };
    const inactive = fixture({ getActiveRepository: vi.fn(async () => null) }, runnerAuth, undefined, issuer);
    expect((await inactive.app.inject({
      method: 'POST', url: '/factory/tasks/42/github-token', headers: runnerHeaders,
    })).statusCode).toBe(404);
    expect(issuer.issue).not.toHaveBeenCalled();

    expect((await fixture({}, runnerAuth, undefined, issuer).app.inject({
      method: 'POST', url: '/factory/tasks/42/github-token', headers,
    })).statusCode).toBe(400);

    const failing = fixture({}, runnerAuth, undefined, {
      issue: vi.fn(async () => { throw new Error('private provider detail'); }),
    });
    const failed = await failing.app.inject({
      method: 'POST', url: '/factory/tasks/42/github-token', headers: runnerHeaders,
    });
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toEqual({ error: 'GitHub token unavailable' });
    expect(failed.body).not.toContain('private provider detail');
    expect((await failing.app.inject({
      method: 'POST', url: '/factory/tasks/9223372036854775808/github-token', headers: runnerHeaders,
    })).statusCode).toBe(400);
  });

  it('keeps controls authenticated and unavailable without dispatcher wiring', async () => {
    const { app } = fixture();
    expect((await app.inject({
      method: 'POST', url: '/factory/tasks/42/controls', payload: { action: 'cancel' },
    })).statusCode).toBe(401);
    const unavailable = await app.inject({
      method: 'POST', url: '/factory/tasks/42/controls', headers, payload: { action: 'cancel' },
    });
    expect(unavailable.statusCode).toBe(503);
  });

  it('accepts the authenticated recover control action', async () => {
    const controller: TaskController = {
      control: vi.fn(async () => ({ kind: 'ok', task: { ...task, state: 'Running' } })),
    };
    const { app } = fixture({}, undefined, controller);
    const response = await app.inject({
      method: 'POST',
      url: '/factory/tasks/42/controls',
      headers,
      payload: { action: 'recover' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: '42', state: 'Running' });
    expect(controller.control).toHaveBeenCalledWith('42', { action: 'recover' });
  });

  it('authenticates the event stream and validates resume IDs', async () => {
    const { app, store } = fixture();
    expect((await app.inject({ url: '/factory/tasks/42/events' })).statusCode).toBe(401);
    expect((await app.inject({
      url: '/factory/tasks/42/events',
      headers: { ...headers, 'last-event-id': '9223372036854775808' },
    })).statusCode).toBe(400);
    expect((await app.inject({
      url: '/factory/tasks/9223372036854775808/events', headers,
    })).statusCode).toBe(400);
    expect(store.getEventsAfter).not.toHaveBeenCalled();
  });

  it('replays after Last-Event-ID without duplicating a concurrently published event and sends heartbeats', async () => {
    const replayed = {
      id: '20',
      taskId: '42',
      type: 'progress',
      summary: 'Tests passed',
      payload: null,
      payloadTruncated: false,
      source: 'runner' as const,
      at: '2026-10-03T12:01:00.000Z',
    };
    const later = { ...replayed, id: '21', summary: 'Changes pushed' };
    let publishDuringReplay = true;
    const { app, eventHub, store } = fixture({
      getEventsAfter: vi.fn(async (taskId, eventId, limit) => {
        if (publishDuringReplay && eventId === '19') {
          publishDuringReplay = false;
          eventHub.publish(replayed);
          await Promise.resolve();
        }
        return [replayed].filter((event) => event.taskId === taskId && BigInt(event.id) > BigInt(eventId)).slice(0, limit);
      }),
    });
    const timerSpy = vi.spyOn(globalThis, 'setInterval');
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();
    const response = await fetch(`${address}/factory/tasks/42/events`, {
      headers: { ...headers, 'last-event-id': '19' },
      signal: controller.signal,
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    let text = '';
    const readFrame = async (frame: string) => {
      while (!text.includes(frame)) {
        const result = await reader.read();
        if (result.done) throw new Error('Event stream ended unexpectedly');
        text += new TextDecoder().decode(result.value);
      }
      const index = text.indexOf('\n\n');
      const current = text.slice(0, index + 2);
      text = text.slice(index + 2);
      return current;
    };
    try {
      expect(await readFrame('id: 20')).toContain('"id":"20"');
      expect(await readFrame('event: ready')).toBe('event: ready\ndata: {}\n\n');
      expect(store.getEventsAfter).toHaveBeenCalledWith('42', '19', 200);
      const interval = timerSpy.mock.calls.find(([, delay]) => delay === 25_000)?.[0];
      expect(interval).toBeDefined();
      interval?.();
      expect(await readFrame(': heartbeat')).toBe(': heartbeat\n\n');

      eventHub.publish(later);
      expect(await readFrame('id: 21')).toContain('"id":"21"');
    } finally {
      controller.abort();
      await reader.cancel().catch(() => {});
      timerSpy.mockRestore();
    }
  });

  it('signals an empty replay is ready only after SQL completes, not on a heartbeat', async () => {
    let completeReplay!: (events: TaskEventMessage[]) => void;
    const replay = new Promise<TaskEventMessage[]>((resolve) => { completeReplay = resolve; });
    const { app } = fixture({ getEventsAfter: vi.fn(() => replay) });
    const timerSpy = vi.spyOn(globalThis, 'setInterval');
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();
    const response = await fetch(`${address}/factory/tasks/42/events`, { headers, signal: controller.signal });
    const reader = response.body!.getReader();
    try {
      const interval = timerSpy.mock.calls.find(([, delay]) => delay === 25_000)?.[0];
      expect(interval).toBeDefined();
      interval?.();
      expect(new TextDecoder().decode((await reader.read()).value)).toBe(': heartbeat\n\n');
      completeReplay([]);
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('event: ready\ndata: {}\n\n');
    } finally {
      completeReplay([]);
      controller.abort();
      await reader.cancel().catch(() => {});
      timerSpy.mockRestore();
    }
  });

  it('returns the bounded running-task context only to the Jarvis agent', async () => {
    const { app, store } = fixture({}, async () => ({
      kind: 'jarvis-agent',
      objectId: '11111111-1111-4111-8111-111111111111',
      tenantId: config.auth.tenantId,
    }));
    const response = await app.inject({ url: '/factory/context', headers });
    const taskList = await app.inject({ url: '/factory/tasks', headers });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(context);
    expect(store.getRunningContext).toHaveBeenCalledOnce();
    expect(taskList.statusCode).toBe(403);
  });

  it('records validated runner events through the task store', async () => {
    const recordEvent = vi.fn(async (event) => ({
      id: '21',
      taskId: event.taskId,
      type: event.type,
      summary: event.summary ?? null,
      payload: event.payload ?? null,
      payloadTruncated: false,
      source: event.source,
      at: task.createdAt,
    } satisfies TaskEventMessage));
    const { app, store } = fixture(
      { recordEvent },
      async () => ({
        kind: 'jarvis-runner',
        objectId: '11111111-1111-4111-8111-111111111111',
        tenantId: config.auth.tenantId,
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/factory/sandbox-events',
      headers,
      payload: { taskId: '42', type: 'agent_output', summary: 'Updating tests', payload: { text: '...' } },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ eventId: '21' });
    expect(recordEvent).toHaveBeenCalledWith({
      taskId: '42', type: 'agent_output', summary: 'Updating tests', payload: { text: '...' }, source: 'runner',
    });
    expect(store.recordEvent).toBe(recordEvent);
  });

  it('rejects runner events from users and validates event identifiers', async () => {
    const user = fixture();
    expect((await user.app.inject({
      method: 'POST',
      url: '/factory/sandbox-events',
      headers,
      payload: { taskId: '42', type: 'started' },
    })).statusCode).toBe(403);
    expect(user.store.recordEvent).not.toHaveBeenCalled();

    const runner = fixture({}, async () => ({
      kind: 'jarvis-runner',
      objectId: '11111111-1111-4111-8111-111111111111',
      tenantId: config.auth.tenantId,
    }));
    for (const payload of [
      { taskId: '0', type: 'started' },
      { taskId: '9223372036854775808', type: 'started' },
      { taskId: '42', type: 'Invalid event' },
      { taskId: '42', type: 'started', summary: 'x'.repeat(2001) },
    ]) {
      const response = await runner.app.inject({
        method: 'POST', url: '/factory/sandbox-events', headers, payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(runner.store.recordEvent).not.toHaveBeenCalled();
  });

  it('returns 404 for missing tasks and rejects malformed identifiers', async () => {
    const missing = fixture({ get: vi.fn(async () => null) });
    expect((await missing.app.inject({ url: '/factory/tasks/42', headers })).statusCode).toBe(404);
    expect((await missing.app.inject({ url: '/factory/tasks/9223372036854775808', headers })).statusCode).toBe(400);
    expect((await missing.app.inject({ url: '/factory/tasks/0', headers })).statusCode).toBe(400);
  });

  it('does not allow clients to mutate task state directly', async () => {
    const { app, store } = fixture();
    expect((await app.inject({
      method: 'PATCH', url: '/factory/tasks/42/state', headers, payload: { state: 'Done' },
    })).statusCode).toBe(404);
    expect(store.transition).not.toHaveBeenCalled();
    expect((await app.inject({ url: '/factory/tasks' })).statusCode).toBe(401);
  });
});
