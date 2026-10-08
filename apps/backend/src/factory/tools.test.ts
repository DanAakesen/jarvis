import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectStore } from './projects.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { capabilityInstructions } from '../core/capability-instructions.js';
import { coreModule } from '../core/index.js';
import { defaultSettings } from '../core/settings.js';
import type { ToolCallRecord } from '../core/tool-calls.js';
import type { TaskController, TaskDetail, TaskRecord, TaskStore } from './task-store.js';
import { factoryModule } from './index.js';
import type { ConversationMessage, ConversationStore } from '../core/conversation-store.js';
import type { TokenVerifier } from '../auth/verify.js';
import type { GitHubIssueClient } from '../github/issues.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = {
  authorization: ['Bearer', ['e30', 'e30', 'sig'].join('.')].join(' '),
  'x-jarvis-message-id': '42',
};
const apps: ReturnType<typeof buildApp>[] = [];

const project = {
  id: '7',
  name: 'Jarvis',
  description: null,
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
  const projectStore = {
    list: vi.fn(async () => [project]),
    update: vi.fn(async (id: string, fields: Partial<typeof project>) => id === project.id ? { ...project, ...fields } : null),
    archive: vi.fn(async (id: string) => id === project.id),
  } as unknown as ProjectStore;
  const taskStore = {
    create: vi.fn(async () => task),
    list: vi.fn(async () => [task]),
    get: vi.fn(async () => detail),
    findActiveByIssue: vi.fn(async () => null),
    updateModelConfig: vi.fn(async (_id, config) => ({
      kind: 'ok' as const,
      task: { ...task, ...config },
    })),
  } as unknown as TaskStore;
  const taskController: TaskController = {
    control: vi.fn(async () => ({ kind: 'ok' as const, task })),
  };
  const record = vi.fn<(call: ToolCallRecord) => Promise<void>>(async () => {});
  const githubIssueClient = {
    readIssue: vi.fn(async () => ({
      number: 8, title: 'P10-02: Factory tasks', body: 'Issue request', state: 'open' as const,
      url: 'https://github.com/DanAakesen/jarvis/issues/8', labels: ['Codex'], isPullRequest: false,
    })),
    readComments: vi.fn(async () => [{ author: 'DanAakesen', body: 'Please implement it.' }]),
    readAgentRules: vi.fn(async () => 'Repository agent rules.'),
    createIssue: vi.fn(async () => ({ number: 9, url: 'https://github.com/DanAakesen/jarvis/issues/9' })),
    createComment: vi.fn(async () => {}),
    removeLabel: vi.fn(async () => {}),
  } satisfies GitHubIssueClient;
  const conversationStore = {
    getHistory: vi.fn(async () => ({
      messages: [{
        id: '42', sessionId: 'session', role: 'dan', text: 'Start issue 8', model: null, at: new Date(),
      }],
      nextCursor: null,
    })),
  } as unknown as ConversationStore;
  const app = buildApp(config, undefined, {
    modules: [coreModule, factoryModule],
    auth: (async () => ({
      kind: 'jarvis-agent',
      objectId: '00000000-0000-0000-0000-000000000001',
      tenantId: config.auth.tenantId,
    })) as TokenVerifier,
    projectStore,
    taskStore,
    githubIssueClient,
    conversationStore,
    taskController,
    toolCallStore: { record },
  });
  apps.push(app);
  return { app, projectStore, taskStore, taskController, record, githubIssueClient };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Software Factory Jarvis tools', () => {
  it('registers every project and task tool for discovery and English voice', async () => {
    const names = [
      'start_issue',
      'list_projects', 'update_project', 'archive_project', 'confirm_project_archive',
      'list_tasks', 'get_task', 'list_releases', 'get_release', 'get_deployment_status',
      'create_task', 'set_task_model', 'retry_task', 'steer_task', 'pause_task', 'resume_task', 'cancel_task',
      'list_capabilities', 'repo_overview', 'repo_list', 'repo_read', 'repo_search', 'repo_issues',
      'create_project', 'manage_repository',
    ];
    const repositoryNames = [
      'list_capabilities', 'repo_overview', 'repo_list', 'repo_read', 'repo_search', 'repo_issues',
    ];
    expect(factoryModule.tools.map(({ name }) => name)).toEqual(names);
    const capabilities = capabilityInstructions(defaultSettings.memory);
    for (const name of names.filter((name) => !repositoryNames.includes(name))) {
      expect(capabilities).toContain(name);
    }
    expect(capabilities).toContain('repo_overview first');
    expect(capabilities).toContain('repo_search or repo_read');
    expect(capabilities).toContain('create a task only after Dan confirms');
    expect(capabilities).toContain('set_jarvis_model');

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
      ['update_project', { projectId: '7', name: 'Jarvis updated', description: 'The project description', default_agent: 'copilot' }],
      ['list_tasks', { projectId: '7', agent: 'codex', state: 'Ready', limit: 10, offset: 2 }],
      ['get_task', { taskId: '42', eventLimit: 20, eventOffset: 1 }],
      ['create_task', {
        projectId: '7', prompt: 'Fix the bug\nMore details', agent: 'codex', model: 'default', reasoning: 'default',
      }],
      ['set_task_model', { taskId: '42', model: 'default', reasoning: 'default' }],
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

    expect(projectStore.list).toHaveBeenCalledTimes(3);
    expect(projectStore.update).toHaveBeenCalledWith('7', {
      name: 'Jarvis updated', description: 'The project description', default_agent: 'copilot',
    });
    expect(record.mock.calls.find(([call]) => call.tool === 'update_project')?.[0])
      .toMatchObject({ arguments: { redacted: true }, result: { redacted: true } });
    expect(taskStore.list).toHaveBeenCalledWith({
      projectId: '7', agent: 'codex', state: 'Ready', limit: 10, offset: 2,
    });
    expect(taskStore.get).toHaveBeenCalledWith('42', 20, 1);
    expect(taskStore.create).toHaveBeenCalledWith({
      projectId: '7',
      issueNumber: 9,
      title: 'Fix the bug',
      request: 'Fix the bug\nMore details',
      source: 'chat',
      originMessageId: '46',
      agent: 'codex',
      modelOverride: 'default',
      reasoningOverride: 'default',
    });
    expect(taskStore.updateModelConfig).toHaveBeenCalledWith('42', {
      agent: 'codex', modelOverride: 'default', reasoningOverride: 'default',
    });
    const modelChange = record.mock.calls.find(([call]) => call.tool === 'set_task_model')?.[0];
    expect(modelChange?.result).toEqual({
      taskId: '42', state: 'Ready', agent: 'codex', model: 'default', reasoning: 'default',
      applies: 'next task turn',
    });
    expect(JSON.stringify(modelChange?.result)).not.toContain(task.request);
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
      ['update_project', { projectId: '7' }],
      ['update_project', { projectId: '7', description: 'x'.repeat(2001) }],
      ['set_task_model', { taskId: '42' }],
      ['steer_task', { taskId: '42', message: '   ' }],
      ['pause_task', {}],
      ['resume_task', {}],
      ['cancel_task', {}],
    ];

    for (const [name, payload] of invalidCalls) {
      const response = await app.inject({
        method: 'POST', url: `/tools/${name}`, headers, payload,
      });
      expect(response.statusCode, name).toBe(200);
      expect(response.json()).toMatchObject({
        outcome: 'refused', result: { refused: expect.stringContaining('Invalid arguments:') },
      });
    }
    expect(record).not.toHaveBeenCalled();
    expect(projectStore.list).not.toHaveBeenCalled();
    expect(taskStore.list).not.toHaveBeenCalled();
    expect(taskStore.get).not.toHaveBeenCalled();
    expect(taskStore.create).not.toHaveBeenCalled();
    expect(taskStore.updateModelConfig).not.toHaveBeenCalled();
    expect(taskController.control).not.toHaveBeenCalled();
  });

  it('returns refused, reasoned outcomes for missing records and invalid lifecycle actions', async () => {
    const { app, taskStore, taskController, record, projectStore } = fixture();
    vi.mocked(taskStore.get).mockResolvedValue(null);
    vi.mocked(projectStore.list).mockResolvedValue([]);
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

  it('archives a project only after an exact confirmation in a later Dan message', async () => {
    const record = vi.fn<(call: ToolCallRecord) => Promise<void>>(async () => {});
    let latestMessage: ConversationMessage = {
      id: '42',
      sessionId: 'session',
      role: 'dan',
      text: 'Archive the project',
      model: null,
      at: new Date(Date.now() - 1_000),
    };
    const conversationStore = {
      getHistory: vi.fn(async () => ({ messages: [latestMessage], nextCursor: null })),
    } as unknown as ConversationStore;
    const projectStore = {
      list: vi.fn(async () => [project]),
      update: vi.fn(async () => project),
      archive: vi.fn(async (id: string) => id === project.id),
    } as unknown as ProjectStore;
    const app = buildApp(config, undefined, {
      modules: [coreModule, factoryModule],
      auth: (async () => ({
        kind: 'jarvis-agent',
        objectId: '00000000-0000-0000-0000-000000000001',
        tenantId: config.auth.tenantId,
      })) as TokenVerifier,
      conversationStore,
      projectStore,
      toolCallStore: { record },
    });
    apps.push(app);

    const staged = await app.inject({
      method: 'POST', url: '/tools/archive_project', headers, payload: { projectId: '7' },
    });
    expect(staged.json()).toMatchObject({
      outcome: 'ok',
      result: { status: 'awaiting_confirmation', projectId: '7', repo: project.repo },
    });
    const confirmationCode = staged.json().result.confirmationCode as string;
    expect(confirmationCode).toMatch(/^\d{8}$/u);
    expect(projectStore.archive).not.toHaveBeenCalled();

    latestMessage = { ...latestMessage, text: `confirm ${confirmationCode}`, at: new Date(Date.now() + 1_000) };
    const sameMessage = await app.inject({
      method: 'POST',
      url: '/tools/confirm_project_archive',
      headers,
      payload: { confirmationCode },
    });
    expect(sameMessage.json()).toMatchObject({ outcome: 'refused' });
    expect(projectStore.archive).not.toHaveBeenCalled();

    latestMessage = {
      ...latestMessage, id: '43', text: `confirm ${confirmationCode} extra`, at: new Date(Date.now() + 2_000),
    };
    const refused = await app.inject({
      method: 'POST',
      url: '/tools/confirm_project_archive',
      headers: { ...headers, 'x-jarvis-message-id': '43' },
      payload: { confirmationCode },
    });
    expect(refused.json()).toMatchObject({ outcome: 'refused' });
    expect(projectStore.archive).not.toHaveBeenCalled();

    latestMessage = { ...latestMessage, id: '44', text: `confirm ${confirmationCode}`, at: new Date(Date.now() + 3_000) };
    const confirmed = await app.inject({
      method: 'POST',
      url: '/tools/confirm_project_archive',
      headers: { ...headers, 'x-jarvis-message-id': '44' },
      payload: { confirmationCode },
    });
    expect(confirmed.json()).toMatchObject({
      outcome: 'ok',
      result: { status: 'archived', projectId: '7', repo: project.repo },
    });
    expect(projectStore.archive).toHaveBeenCalledOnce();
  });

  it('refuses unverified task models and running-task changes with valid options', async () => {
    const { app, taskStore, record } = fixture();
    const invalid = await app.inject({
      method: 'POST', url: '/tools/set_task_model', headers,
      payload: { taskId: '42', agent: 'copilot', model: 'unverified' },
    });
    expect(invalid.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: expect.stringContaining('Unsupported copilot model.') },
    });
    expect(taskStore.updateModelConfig).not.toHaveBeenCalled();

    vi.mocked(taskStore.get).mockResolvedValue({ ...detail, state: 'Running' });
    const running = await app.inject({
      method: 'POST', url: '/tools/set_task_model', headers,
      payload: { taskId: '42', model: 'default' },
    });
    expect(running.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: expect.stringContaining('running tasks are refused') },
    });
    expect(taskStore.updateModelConfig).not.toHaveBeenCalled();
    expect(record.mock.calls.map(([call]) => call.outcome)).toEqual(['refused', 'refused']);
  });

  it('accepts supported Codex reasoning levels for ready tasks', async () => {
    const { app, taskStore } = fixture();
    const response = await app.inject({
      method: 'POST', url: '/tools/set_task_model', headers,
      payload: { taskId: '42', agent: 'codex', reasoning: 'high' },
    });

    expect(response.json()).toMatchObject({
      outcome: 'ok',
      result: { agent: 'codex', reasoning: 'high', state: 'Ready' },
    });
    expect(taskStore.updateModelConfig).toHaveBeenCalledWith('42', {
      agent: 'codex', modelOverride: null, reasoningOverride: 'high',
    });
  });

  it('accepts supported Copilot model and reasoning overrides for ready tasks', async () => {
    const { app, taskStore } = fixture();
    const response = await app.inject({
      method: 'POST', url: '/tools/set_task_model', headers,
      payload: { taskId: '42', agent: 'copilot', model: 'claude-sonnet-4.6', reasoning: 'high' },
    });

    expect(response.json()).toMatchObject({
      outcome: 'ok',
      result: { agent: 'copilot', model: 'claude-sonnet-4.6', reasoning: 'high', state: 'Ready' },
    });
    expect(taskStore.updateModelConfig).toHaveBeenCalledWith('42', {
      agent: 'copilot', modelOverride: 'claude-sonnet-4.6', reasoningOverride: 'high',
    });
  });

  it('clears provider-specific overrides when switching the agent', async () => {
    const { app, taskStore } = fixture();
    vi.mocked(taskStore.get).mockResolvedValue({
      ...detail, modelOverride: 'default', reasoningOverride: 'default',
    });
    const response = await app.inject({
      method: 'POST', url: '/tools/set_task_model', headers,
      payload: { taskId: '42', agent: 'copilot' },
    });

    expect(response.json()).toMatchObject({ outcome: 'ok' });
    expect(taskStore.updateModelConfig).toHaveBeenCalledWith('42', {
      agent: 'copilot', modelOverride: null, reasoningOverride: null,
    });
  });

  it('refuses a model update if the task stopped being Ready before persistence', async () => {
    const { app, taskStore } = fixture();
    vi.mocked(taskStore.updateModelConfig).mockResolvedValue({ kind: 'not-ready' });
    const response = await app.inject({
      method: 'POST', url: '/tools/set_task_model', headers,
      payload: { taskId: '42', model: 'default' },
    });

    expect(response.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: 'Task is no longer Ready. Model changes are accepted only while a task is Ready; the current turn is unchanged.' },
    });
  });

  it('refuses unverified model options when creating a task', async () => {
    const { app, taskStore } = fixture();
    const response = await app.inject({
      method: 'POST', url: '/tools/create_task', headers,
      payload: { projectId: '7', prompt: 'Fix a bug', agent: 'codex', model: 'gpt-5' },
    });
    expect(response.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: expect.stringContaining('Unsupported coding-agent model.') },
    });
    expect(taskStore.create).not.toHaveBeenCalled();
  });

  it('accepts supported Copilot model and reasoning on task creation', async () => {
    const { app, taskStore } = fixture();
    const response = await app.inject({
      method: 'POST', url: '/tools/create_task', headers,
      payload: {
        projectId: '7', prompt: 'Fix a bug', agent: 'copilot',
        model: 'gpt-5.4', reasoning: 'medium',
      },
    });

    expect(response.json()).toMatchObject({ outcome: 'ok' });
    expect(taskStore.create).toHaveBeenCalledWith(expect.objectContaining({
      agent: 'copilot', modelOverride: 'gpt-5.4', reasoningOverride: 'medium',
    }));
  });

  it('starts open issues as Codex tasks and refuses closed issues', async () => {
    const { app, taskStore, githubIssueClient } = fixture();
    const started = await app.inject({
      method: 'POST', url: '/tools/start_issue', headers, payload: { issue: 8 },
    });
    expect(started.json()).toMatchObject({
      outcome: 'ok',
      result: {
        task: { id: '42', agent: 'codex' },
        issue: { number: 8, url: 'https://github.com/DanAakesen/jarvis/issues/8' },
      },
    });
    expect(taskStore.create).toHaveBeenCalledWith(expect.objectContaining({
      issueNumber: 8, agent: 'codex', projectId: '7',
    }));

    vi.mocked(githubIssueClient.readIssue).mockResolvedValue({
      number: 8, title: 'P10-02: Factory tasks', body: '', state: 'closed',
      url: 'https://github.com/DanAakesen/jarvis/issues/8', labels: [], isPullRequest: false,
    });
    const refused = await app.inject({
      method: 'POST', url: '/tools/start_issue', headers, payload: { issue: 8 },
    });
    expect(refused.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: 'Only open GitHub issues can be started.' },
    });
  });

  it('associates a chat-created task with its originating message', async () => {
    const { app, taskStore } = fixture();

    const response = await app.inject({
      method: 'POST', url: '/tools/create_task', headers,
      payload: { projectId: '7', prompt: 'Fix a bug', agent: 'codex' },
    });

    expect(response.json()).toMatchObject({ outcome: 'ok' });
    expect(taskStore.create).toHaveBeenCalledWith(expect.objectContaining({
      projectId: '7',
      source: 'chat',
      originMessageId: '42',
    }));
  });
});
