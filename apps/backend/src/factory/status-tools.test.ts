import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { coreModule } from '../core/index.js';
import type { ToolCallRecord } from '../core/tool-calls.js';
import type { GitHubAppTokenIssuer } from '../github-app.js';
import type { ReleaseViewRecords, ReleaseViewStore } from './release-view.js';
import type { ProjectStore } from './projects.js';
import type { TaskRecord, TaskStore } from './task-store.js';
import { factoryModule } from './index.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = {
  authorization: `${['Bear', 'er'].join('')} ${['e30', 'e30', 'sig'].join('.')}`,
  'x-jarvis-message-id': '42',
};
const project = {
  id: '7',
  name: 'Jarvis',
  repo: 'DanAakesen/jarvis',
  default_branch: 'main',
  default_agent: 'codex' as const,
  policy: 'deliver_pr' as const,
  merge_rules: null,
  sandbox_size: '1x2' as const,
  tech: 'node',
  max_parallel_tasks: 1,
  active: true,
};
const task: TaskRecord = {
  id: '42',
  projectId: '7',
  originMessageId: null,
  title: 'Retry task',
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
  createdAt: '2026-10-07T10:00:00.000Z',
  startedAt: null,
  finishedAt: null,
};
const records: ReleaseViewRecords = {
  releases: [{
    id: '9',
    version: '18',
    sha: 'a'.repeat(40),
    status: 'released',
    createdAt: '2026-10-07T10:00:00.000Z',
    releasedAt: '2026-10-07T10:10:00.000Z',
  }],
  pullRequests: [],
  workflowRuns: [{
    id: '12',
    workflow: 'Deploy',
    trigger: 'push',
    headSha: 'a'.repeat(40),
    status: 'completed',
    conclusion: 'success',
    startedAt: '2026-10-07T10:00:00.000Z',
    completedAt: '2026-10-07T10:10:00.000Z',
    releaseId: '9',
    pullRequestNumber: null,
    taskId: null,
  }],
  deployments: [{
    id: '14',
    releaseId: '9',
    environment: 'production',
    status: 'success',
    at: '2026-10-07T10:10:00.000Z',
  }],
};
const apps: ReturnType<typeof buildApp>[] = [];

function fixture(retry = vi.fn(async () => ({ kind: 'ok' as const, task }))) {
  const projectStore: ProjectStore = {
    list: vi.fn(async () => [project]),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
  };
  const releaseViewStore: ReleaseViewStore = {
    read: vi.fn(async () => records),
    projectForRelease: vi.fn(async () => '7'),
  };
  const taskStore = { retry } as unknown as TaskStore;
  const githubAppTokenIssuer = {
    issueForActions: vi.fn(async () => 'actions-read-token'),
  } as unknown as GitHubAppTokenIssuer;
  const record = vi.fn<(call: ToolCallRecord) => Promise<void>>(async () => {});
  const app = buildApp(config, undefined, {
    modules: [coreModule, factoryModule],
    auth: async () => ({
      objectId: config.auth.ownerObjectId,
      tenantId: config.auth.tenantId,
      displayName: 'Dan',
    }),
    projectStore,
    releaseViewStore,
    taskStore,
    githubAppTokenIssuer,
    toolCallStore: { record },
  });
  apps.push(app);
  return { app, projectStore, releaseViewStore, retry, githubAppTokenIssuer };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Software Factory status tools', () => {
  it('lists releases and returns one release with its linked workflow and deployment records', async () => {
    const { app, releaseViewStore } = fixture();

    const listed = await app.inject({
      method: 'POST', url: '/tools/list_releases', headers, payload: { projectId: '7' },
    });
    expect(listed.json()).toMatchObject({
      tool: 'list_releases',
      outcome: 'ok',
      result: { project: { id: '7', repo: project.repo }, releases: records.releases },
    });
    expect(releaseViewStore.read).toHaveBeenCalledWith('7');

    const detail = await app.inject({
      method: 'POST',
      url: '/tools/get_release',
      headers: { ...headers, 'x-jarvis-message-id': '43' },
      payload: { releaseId: '9' },
    });
    expect(detail.json()).toMatchObject({
      tool: 'get_release',
      outcome: 'ok',
      result: {
        project: { id: '7', repo: project.repo },
        release: records.releases[0],
        workflowRuns: records.workflowRuns,
        deployments: records.deployments,
      },
    });
    expect(releaseViewStore.projectForRelease).toHaveBeenCalledWith('9');
  });

  it('retries an eligible task through the store and refuses invalid lifecycle states', async () => {
    const retry = vi.fn(async () => ({ kind: 'ok' as const, task }));
    const { app } = fixture(retry);

    const retried = await app.inject({
      method: 'POST', url: '/tools/retry_task', headers, payload: { taskId: '42' },
    });
    expect(retried.json()).toMatchObject({
      tool: 'retry_task',
      outcome: 'ok',
      result: { id: '42', state: 'Ready', attemptCount: 0 },
    });
    expect(JSON.stringify(retried.json())).not.toContain(task.request);
    expect(retry).toHaveBeenCalledExactlyOnceWith('42');

    retry.mockResolvedValue({ kind: 'invalid-transition' });
    const refused = await app.inject({
      method: 'POST',
      url: '/tools/retry_task',
      headers: { ...headers, 'x-jarvis-message-id': '43' },
      payload: { taskId: '42' },
    });
    expect(refused.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: expect.stringContaining('use Recover') },
    });

    const invalid = await app.inject({
      method: 'POST',
      url: '/tools/retry_task',
      headers: { ...headers, 'x-jarvis-message-id': '44' },
      payload: { taskId: '0' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it('reads the latest default-branch deploy run through the repository-scoped Actions token', async () => {
    const { app, githubAppTokenIssuer } = fixture();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({
      total_count: 1,
      workflow_runs: [{
        id: 123,
        name: 'Deploy',
        path: '.github/workflows/deploy.yml@refs/heads/main',
        head_branch: 'main',
        head_sha: 'b'.repeat(40),
        status: 'completed',
        conclusion: 'success',
        created_at: '2026-10-07T10:00:00Z',
        updated_at: '2026-10-07T10:10:00Z',
      }],
    }));
    vi.stubGlobal('fetch', fetch);

    const response = await app.inject({
      method: 'POST',
      url: '/tools/get_deployment_status',
      headers,
      payload: { projectId: '7' },
    });

    expect(response.json()).toMatchObject({
      tool: 'get_deployment_status',
      outcome: 'ok',
      result: {
        deployment: {
          id: 123,
          status: 'completed',
          conclusion: 'success',
          headSha: 'b'.repeat(40),
          url: 'https://github.com/DanAakesen/jarvis/actions/runs/123',
        },
      },
    });
    expect(githubAppTokenIssuer.issueForActions).toHaveBeenCalledExactlyOnceWith(project.repo);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does not expose GitHub errors when deployment status cannot be read', async () => {
    const { app } = fixture();
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('private provider response', { status: 403 })));

    const response = await app.inject({
      method: 'POST', url: '/tools/get_deployment_status', headers, payload: { projectId: '7' },
    });

    expect(response.json()).toMatchObject({
      outcome: 'error',
      result: { error: 'GitHub deployment status could not be read.' },
    });
    expect(JSON.stringify(response.json())).not.toContain('private provider response');
  });
});
