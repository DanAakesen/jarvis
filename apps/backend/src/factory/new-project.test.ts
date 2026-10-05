import { afterEach, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createEventHub } from '../core/event-hub.js';
import type { SettingsStore } from '../core/settings.js';
import type { ToolCallRecord, ToolCallStore } from '../core/tool-calls.js';
import { createRepoAdminRepositoryCreator } from '../credentials/repo-admin.js';
import type { Project, ProjectStore } from './projects.js';
import type { TaskEventHub, TaskEventMessage, TaskRecord, TaskStore } from './task-store.js';
import type { TeamsNotificationService } from '../teams/service.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const repositoryToken = 'repo-admin-test-token-not-for-sandbox';
const vaultToken = 'vault-access-test-token';
const authorization = {
  authorization: ['Bearer', ['test', 'token', 'signature'].join('.')].join(' '),
  'x-jarvis-message-id': '42',
};
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

it('uses configured defaults and keeps the repository secret out of task and recorded data', async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const address = String(url);
    requests.push({ url: address, init: init ?? {} });
    if (new URL(address).hostname === 'kv-jarvis.vault.azure.net') return Response.json({ value: repositoryToken });
    if (address.endsWith('/user')) return Response.json({ login: 'DanAakesen' });
    if (address.endsWith('/user/repos')) {
      return Response.json({ full_name: 'DanAakesen/bright-app', default_branch: 'main' }, { status: 201 });
    }
    if (address.endsWith('/repos/DanAakesen/bright-app')) {
      return Response.json({ default_branch: 'develop' });
    }
    throw new Error('Unexpected request');
  });
  const taskInput = vi.fn(async (input: Parameters<TaskStore['create']>[0]) => ({
    id: '81',
    projectId: input.projectId,
    originMessageId: input.originMessageId ?? null,
    title: input.title,
    request: input.request,
    source: input.source ?? 'board',
    agent: input.agent ?? 'copilot',
    modelOverride: null,
    reasoningOverride: null,
    state: 'Ready',
    activity: null,
    priority: 0,
    attemptCount: 0,
    nextAttemptAt: null,
    branch: null,
    createdAt: '2026-10-04T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
  } satisfies TaskRecord));
  const taskEventHub = createEventHub<TaskEventMessage>();
  const events: TaskEventMessage[] = [];
  taskEventHub.subscribe((event) => events.push(event));
  const taskStore: TaskStore = {
    create: async (input) => {
      const task = await taskInput(input);
      taskEventHub.publish({
        id: '1',
        taskId: task.id,
        type: 'created',
        summary: 'Task created from chat',
        payload: { state: 'Ready' },
        payloadTruncated: false,
        source: 'backend',
        at: '2026-10-04T00:00:00.000Z',
      });
      return task;
    },
    list: vi.fn(async () => []),
    get: vi.fn(async () => null),
    updateModelConfig: vi.fn(async () => ({ kind: 'not-found' as const })),
    getEventsAfter: vi.fn(async () => []),
    getRunningContext: vi.fn(async () => ({ runningTasks: [], truncated: false })),
    transition: vi.fn(async () => ({ kind: 'not-found' as const })),
    withNoActiveTasks: vi.fn(async (operation) => ({ kind: 'idle' as const, value: await operation() })),
    recordEvent: vi.fn(async () => events[0]!),
  };
  const createdProject: Project = {
    id: '73',
    name: 'bright-app',
    repo: 'DanAakesen/bright-app',
    default_branch: 'develop',
    default_agent: 'codex',
    policy: 'complete_without_deployment',
    merge_rules: null,
    sandbox_size: '1x2',
    tech: 'node',
    max_parallel_tasks: 3,
    active: true,
  };
  const projectInput = vi.fn(async (input: Parameters<ProjectStore['create']>[0]) => ({ ...createdProject, ...input }));
  const projectStore: ProjectStore = {
    list: vi.fn(async () => [createdProject]),
    create: projectInput,
    update: vi.fn(async () => null),
    archive: vi.fn(async () => false),
  };
  const settingsStore: SettingsStore = {
    read: async () => ({
      'new_projects.owner': '"DanAakesen"',
      'new_projects.visibility': '"public"',
      'new_projects.templates_repository': '"DanAakesen/templates"',
      'new_projects.default_agent': '"codex"',
      'new_projects.policy': '"complete_without_deployment"',
      'new_projects.max_parallel_tasks': '3',
      'new_projects.default_branch': '"develop"',
    }),
    write: vi.fn(async () => {}),
  };
  const toolCalls: ToolCallRecord[] = [];
  const toolCallStore: ToolCallStore = { record: async (call) => { toolCalls.push(call); } };
  const runConfirmed = vi.fn(async (_kind: unknown, _summary: unknown, action: () => Promise<string>) => action());
  const teamsNotifications = {
    notify: vi.fn(async () => {}),
    requestConfirmation: vi.fn(async () => {}),
    runConfirmed,
    rememberMessage: vi.fn(async () => {}),
    receiveConfirmation: vi.fn(async () => false),
    expirePendingConfirmations: vi.fn(async () => {}),
  } as unknown as TeamsNotificationService;
  const app = buildApp(config, undefined, {
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }),
    projectRepositoryCreator: createRepoAdminRepositoryCreator(
      'https://kv-jarvis.vault.azure.net/',
      async () => vaultToken,
      fetcher as typeof fetch,
    ),
    projectStore,
    taskStore,
    settingsStore,
    toolCallStore,
    teamsNotifications,
    eventHub: taskEventHub as TaskEventHub,
  });
  apps.push(app);

  const response = await app.inject({
    method: 'POST',
    url: '/tools/create_project',
    headers: authorization,
    payload: { name: 'bright-app', description: 'A bright new application' },
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    tool: 'create_project',
    outcome: 'ok',
    result: {
      projectId: '73',
      repository: 'DanAakesen/bright-app',
      repositoryUrl: 'https://github.com/DanAakesen/bright-app',
      taskId: '81',
    },
  });
  expect(projectInput).toHaveBeenCalledWith(expect.objectContaining({
    default_branch: 'develop',
    default_agent: 'codex',
    policy: 'complete_without_deployment',
    max_parallel_tasks: 3,
    sandbox_size: '1x2',
    tech: 'node',
  }));
  expect(taskInput).toHaveBeenCalledWith(expect.objectContaining({
    source: 'chat',
    originMessageId: '42',
    title: 'Scaffold bright-app',
  }));
  expect(taskInput.mock.calls[0]?.[0].request).toContain('DanAakesen/templates');
  expect(taskInput.mock.calls[0]?.[0].request).toContain('PowerShell 7 (pwsh)');
  expect(taskInput.mock.calls[0]?.[0].request).toContain('JARVIS_NEEDS_ATTENTION:');
  expect(runConfirmed).toHaveBeenCalledWith(
    'create_repository',
    expect.stringContaining('Create the public repository DanAakesen/bright-app'),
    expect.any(Function),
    expect.any(AbortSignal),
  );
  expect(JSON.stringify(taskInput.mock.calls[0]?.[0])).not.toContain(repositoryToken);
  expect(JSON.stringify(taskInput.mock.calls[0]?.[0])).not.toContain(vaultToken);
  expect(Object.keys(taskInput.mock.calls[0]?.[0] ?? {}).some((key) => /environment|token/iu.test(key))).toBe(false);
  expect(events).toHaveLength(1);
  expect(toolCalls).toHaveLength(1);
  expect(requests[2]?.init.headers).toMatchObject({ Authorization: ['Bearer', repositoryToken].join(' ') });
  expect(JSON.stringify({
    result: response.json(),
    project: createdProject,
    task: taskInput.mock.calls[0]?.[0],
    events,
    toolCalls,
  })).not.toContain(repositoryToken);
  expect(JSON.stringify({
    result: response.json(),
    project: createdProject,
    task: taskInput.mock.calls[0]?.[0],
    events,
    toolCalls,
  })).not.toContain(vaultToken);
});
