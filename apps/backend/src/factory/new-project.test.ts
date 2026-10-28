import { afterEach, expect, it, vi } from 'vitest';
import { buildApp, type BuildAppOptions } from '../app.js';
import { loadConfig } from '../config.js';
import { createEventHub } from '../core/event-hub.js';
import type { SettingsStore } from '../core/settings.js';
import type { ToolCallRecord, ToolCallStore } from '../core/tool-calls.js';
import { createRepoAdminRepositoryCreator } from '../credentials/repo-admin.js';
import type { Project, ProjectStore } from './projects.js';
import type { TaskEventHub, TaskEventMessage, TaskRecord, TaskStore } from './task-store.js';
import type { OwnerInteractionService } from '../core/owner-interactions.js';
import { GitHubIssueRequestError, type GitHubIssueClient } from '../github/issues.js';
import { createFactoryBoard } from './board.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const repositoryToken = 'repo-admin-test-token-not-for-sandbox';
const vaultToken = 'vault-access-test-token';
const authorization = {
  authorization: ['Bearer', ['test', 'token', 'signature'].join('.')].join(' '),
  'x-jarvis-message-id': '42',
};
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function fixture(overrides: BuildAppOptions = {}) {
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
    issueNumber: input.issueNumber ?? null,
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
    linkIssueNumberIfUnlinked: vi.fn(async () => null),
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
    description: null,
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
  const ownerInteractions = {
    notify: vi.fn(async () => {}),
    requestConfirmation: vi.fn(async () => {}),
    runConfirmed,
    rememberMessage: vi.fn(async () => {}),
    receiveConfirmation: vi.fn(async () => false),
    expirePendingConfirmations: vi.fn(async () => {}),
  } as unknown as OwnerInteractionService;
  const createIssue = vi.fn(async () => ({ number: 1, url: 'https://github.com/DanAakesen/bright-app/issues/1' }));
  const githubIssueClient = { createIssue } as unknown as GitHubIssueClient;
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
    ownerInteractions,
    githubIssueClient,
    eventHub: taskEventHub as TaskEventHub,
    ...overrides,
  });
  apps.push(app);
  const create = () => app.inject({
    method: 'POST',
    url: '/tools/create_project',
    headers: authorization,
    payload: { name: 'bright-app', description: 'A bright new application' },
  });
  return { app, create, requests, fetcher, taskInput, taskStore, projectInput, createdProject,
    events, toolCalls, createIssue, runConfirmed };
}

it('creates the scaffold issue before its task and keeps defaults, instructions and secrets safe', async () => {
  const { create, requests, taskInput, projectInput, createdProject, events, toolCalls, createIssue, runConfirmed } = fixture();
  const response = await create();

  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    tool: 'create_project',
    outcome: 'ok',
    result: {
      projectId: '73',
      repository: 'DanAakesen/bright-app',
      repositoryUrl: 'https://github.com/DanAakesen/bright-app',
      issueNumber: 1,
      issueUrl: 'https://github.com/DanAakesen/bright-app/issues/1',
      taskId: '81',
    },
  });
  expect(projectInput).toHaveBeenCalledWith(expect.objectContaining({
    description: 'A bright new application',
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
    issueNumber: 1,
  }));
  expect(createIssue).toHaveBeenCalledExactlyOnceWith('DanAakesen/bright-app', 'Scaffold bright-app', taskInput.mock.calls[0]?.[0].request);
  expect(projectInput.mock.invocationCallOrder[0]).toBeLessThan(createIssue.mock.invocationCallOrder[0]!);
  expect(createIssue.mock.invocationCallOrder[0]).toBeLessThan(taskInput.mock.invocationCallOrder[0]!);
  expect(taskInput.mock.calls[0]?.[0].request).toContain('DanAakesen/templates');
  expect(taskInput.mock.calls[0]?.[0].request).toContain('PowerShell 7 (pwsh)');
  expect(taskInput.mock.calls[0]?.[0].request).toContain('Fill PRODUCT.md and PLAN.md from the description');
  expect(taskInput.mock.calls[0]?.[0].request).toContain('templates/github-actions/pr-checks.yml');
  expect(taskInput.mock.calls[0]?.[0].request).toContain('templates/github-actions/release.yml');
  expect(taskInput.mock.calls[0]?.[0].request).toContain('default branch develop as the PR base');
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
    issue: createIssue.mock.calls,
  })).not.toContain(repositoryToken);
  expect(JSON.stringify({
    result: response.json(),
    project: createdProject,
    task: taskInput.mock.calls[0]?.[0],
    events,
    toolCalls,
    issue: createIssue.mock.calls,
  })).not.toContain(vaultToken);
});

it('shows the scaffold issue with its Factory task overlay before a pull request exists', async () => {
  const test = fixture();
  expect((await test.create()).statusCode).toBe(200);
  const task = await test.taskInput.mock.results[0]!.value;
  const issue = await test.createIssue.mock.results[0]!.value;
  const board = createFactoryBoard(test.createdProject.id, test.createdProject.repo, {
    issues: [{
      ...issue, title: task.title, body: task.request, taskCode: null, labels: [], worker: null,
      state: 'open', updatedAt: task.createdAt, closedAt: null, blockedBy: [], blockedByCount: 0,
    }],
    pullRequests: [],
  }, [task], []);
  expect(board.columns.find(({ id }) => id === 'ready')?.cards).toMatchObject([{
    issue: { number: issue.number, url: issue.url }, task: { id: task.id, state: 'Ready' }, pr: null,
  }]);
  expect(board.columns.flatMap(({ cards }) => cards)).toHaveLength(1);
});

it('refuses before repository creation when the issue service is unavailable', async () => {
  const test = fixture({ githubIssueClient: undefined });
  const response = await test.create();
  expect(response.json()).toMatchObject({ outcome: 'refused' });
  expect(test.fetcher).not.toHaveBeenCalled();
  expect(test.projectInput).not.toHaveBeenCalled();
  expect(test.createIssue).not.toHaveBeenCalled();
  expect(test.taskInput).not.toHaveBeenCalled();
});

it('does not create an issue or task when approval or repository creation fails', async () => {
  const test = fixture();
  test.runConfirmed.mockRejectedValueOnce(new Error('Not approved'));
  const response = await test.create();
  expect(response.json()).toMatchObject({ outcome: 'refused' });
  expect(test.fetcher).not.toHaveBeenCalled();
  expect(test.projectInput).not.toHaveBeenCalled();
  expect(test.createIssue).not.toHaveBeenCalled();
  expect(test.taskInput).not.toHaveBeenCalled();
});

it('does not create an issue or task when registration fails after repository creation', async () => {
  const test = fixture();
  test.projectInput.mockRejectedValueOnce(new Error('Private database detail'));
  const response = await test.create();
  expect(response.json()).toMatchObject({ outcome: 'refused' });
  expect(response.body).toContain('was created, but I could not register it');
  expect(response.body).not.toContain('Private database detail');
  expect(test.createIssue).not.toHaveBeenCalled();
  expect(test.taskInput).not.toHaveBeenCalled();
});

it.each([403, 404, 422, 500, 503, null])('reports issue creation failure (%s) without starting a task or retrying the write', async (status) => {
  const test = fixture();
  test.createIssue.mockRejectedValueOnce(status === null
    ? new Error('Private transport detail') : new GitHubIssueRequestError(status));
  const response = await test.create();
  expect(response.json()).toMatchObject({ outcome: 'refused' });
  expect(response.body).toContain('was created and registered');
  expect(response.body).toContain('No scaffolding task was started');
  expect(response.body).toContain(status !== null && status < 500
    ? 'could not create its scaffolding issue'
    : "could not be verified. Check the repository's issues before retrying");
  expect(response.body).not.toContain('Private transport detail');
  expect(test.createIssue).toHaveBeenCalledOnce();
  expect(test.taskInput).not.toHaveBeenCalled();
});

it.each(['throws', 'returns null'])('keeps the created issue link when task persistence %s', async (failure) => {
  const test = fixture();
  const create = vi.spyOn(test.taskStore, 'create');
  if (failure === 'throws') create.mockRejectedValueOnce(new Error('Private database detail'));
  else create.mockResolvedValueOnce(null);
  const response = await test.create();
  expect(response.json()).toMatchObject({ outcome: 'refused' });
  expect(response.body).toContain('https://github.com/DanAakesen/bright-app/issues/1');
  expect(response.body).toContain('could not start its scaffolding task');
  expect(response.body).not.toContain('Private database detail');
  expect(test.createIssue).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledOnce();
});
