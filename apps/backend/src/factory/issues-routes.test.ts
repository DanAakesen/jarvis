import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { ProjectStore } from './projects.js';
import type { TaskRecord, TaskStore } from './task-store.js';
import type { GitHubIssueClient } from '../github/issues.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = { authorization: ['Bearer', ['e30', 'e30', 'sig'].join('.')].join(' ') };
const apps: ReturnType<typeof buildApp>[] = [];
const project = {
  id: '7', name: 'Jarvis', description: null, repo: 'DanAakesen/jarvis', default_branch: 'main',
  default_agent: 'copilot', policy: 'deliver_pr', merge_rules: null, sandbox_size: '1x2',
  tech: 'node', max_parallel_tasks: 1, active: true,
};
const task: TaskRecord = {
  id: '42', projectId: '7', issueNumber: 574, originMessageId: null,
  title: 'P10-02: Factory tasks', request: 'untrusted private request', source: 'board', agent: 'codex',
  modelOverride: null, reasoningOverride: null, state: 'Ready', activity: null, priority: 0,
  attemptCount: 0, nextAttemptAt: null, branch: null, createdAt: '2026-10-08T00:00:00.000Z',
  startedAt: null, finishedAt: null,
};

function fixture() {
  const taskStore = {
    create: vi.fn(async () => task),
    findActiveByIssue: vi.fn(async () => null),
  } as unknown as TaskStore;
  const projectStore = { list: vi.fn(async () => [project]) } as unknown as ProjectStore;
  const githubIssueClient = {
    readIssue: vi.fn(async () => ({
      number: 574, title: task.title, body: 'Issue body', state: 'open' as const,
      url: 'https://github.com/DanAakesen/jarvis/issues/574', labels: ['Codex'], isPullRequest: false,
    })),
    readComments: vi.fn(async () => [{ author: 'DanAakesen', body: 'Please implement this.' }]),
    readAgentRules: vi.fn(async () => 'Read AGENTS.md.'),
  } as unknown as GitHubIssueClient;
  const app = buildApp(config, undefined, {
    taskStore,
    projectStore,
    githubIssueClient,
    auth: async () => ({
      objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan',
    }),
  });
  apps.push(app);
  return { app, taskStore, githubIssueClient };
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('Factory issue start route', () => {
  it('requires Dan authentication and starts an issue as Codex without returning its prompt', async () => {
    const { app, taskStore } = fixture();
    expect((await app.inject({ method: 'POST', url: '/factory/issues/574/start', payload: {} })).statusCode).toBe(401);

    const response = await app.inject({
      method: 'POST', url: '/factory/issues/574/start', headers, payload: {},
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      task: { id: '42', title: task.title, state: 'Ready', agent: 'codex', issueNumber: 574 },
      issue: { number: 574, url: 'https://github.com/DanAakesen/jarvis/issues/574' },
    });
    expect(response.body).not.toContain(task.request);
    expect(taskStore.create).toHaveBeenCalledWith(expect.objectContaining({
      issueNumber: 574, agent: 'codex', projectId: '7',
    }));
  });

  it('returns an existing linked task and refuses closed or missing issues', async () => {
    const { app, taskStore, githubIssueClient } = fixture();
    vi.mocked(taskStore.findActiveByIssue!).mockResolvedValue(task);
    expect((await app.inject({
      method: 'POST', url: '/factory/issues/574/start', headers, payload: {},
    })).statusCode).toBe(200);
    expect(githubIssueClient.readIssue).not.toHaveBeenCalled();
    expect(taskStore.create).not.toHaveBeenCalled();

    vi.mocked(taskStore.findActiveByIssue!).mockResolvedValue(null);
    vi.mocked(githubIssueClient.readIssue).mockResolvedValue({
      number: 574, title: task.title, body: '', state: 'closed', url: 'https://github.com/DanAakesen/jarvis/issues/574',
      labels: [], isPullRequest: false,
    });
    expect((await app.inject({
      method: 'POST', url: '/factory/issues/574/start', headers, payload: {},
    })).statusCode).toBe(409);

    vi.mocked(githubIssueClient.readIssue).mockResolvedValue(null);
    expect((await app.inject({
      method: 'POST', url: '/factory/issues/574/start', headers, payload: {},
    })).statusCode).toBe(404);
  });
});
