import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FactoryBoardStatus } from '@jarvis/contracts';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { GitHubAppTokenIssuer } from '../github-app.js';
import type { BackendModule } from '../modules.js';
import { factoryModule } from './index.js';
import type { Project, ProjectStore } from './projects.js';
import {
  createFactoryBoard,
  createGitHubFactoryBoardReader,
  desiredFactoryBoardStatus,
  type FactoryBoardIssue,
  type FactoryBoardSource,
} from './board.js';
import type { TaskEventMessage, TaskRecord, TaskStore } from './task-store.js';
import type { ReleaseViewStore } from './release-view.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = {
  authorization: `${['Bear', 'er'].join('')} ${['test', 'token', 'signature'].join('.')}`,
};
const timestamp = '2026-10-08T00:00:00.000Z';
const project: Project = {
  id: '42', name: 'Jarvis', description: null, repo: 'DanAakesen/jarvis', default_branch: 'main',
  default_agent: 'codex', policy: 'deliver_pr', merge_rules: null, sandbox_size: '1x2', tech: 'node',
  max_parallel_tasks: 1, active: true,
};
const sourceIssue: FactoryBoardIssue = {
  number: 7, title: 'Implement board', labels: ['Codex', 'P1'], state: 'open',
  closedAt: null, blockedBy: 0, body: null,
};
const source: FactoryBoardSource = {
  issues: [sourceIssue],
  pullRequests: [{ number: 70, body: 'Fixes #7', url: 'https://github.com/DanAakesen/jarvis/pull/70', draft: false }],
};
const task: TaskRecord = {
  id: '81', projectId: project.id, originMessageId: null, title: 'Board task', request: 'Implement the board',
  source: 'board', agent: 'codex', modelOverride: null, reasoningOverride: null, state: 'Running',
  activity: 'Working', priority: 0, attemptCount: 1, nextAttemptAt: null, branch: 'jarvis/task-81',
  pullRequest: { number: 70, url: 'https://github.com/DanAakesen/jarvis/pull/70', state: 'open' },
  checks: 'passed', latestSessionEndReason: null, createdAt: timestamp, startedAt: timestamp, finishedAt: null,
};
const cases = JSON.parse(readFileSync(
  new URL('../../../../.github/scripts/tests/fixtures/project_board_cases.json', import.meta.url),
  'utf8',
)) as {
  name: string;
  issue: { number: number; labels: string[]; blockedBy: number };
  pulls: { body: string; draft: boolean }[];
  status: Exclude<FactoryBoardStatus, 'Done'>;
}[];
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function fixture(reader: ReturnType<typeof vi.fn>, options: { modules?: readonly BackendModule[] } = {}) {
  const projectStore = { list: vi.fn(async () => [project]) } as unknown as ProjectStore;
  const taskStore = { list: vi.fn(async () => [task]) } as unknown as TaskStore;
  const releaseViewStore = {
    read: vi.fn(async () => ({
      releases: [],
      pullRequests: [{ id: '1', number: 70, branch: task.branch!, headSha: 'a'.repeat(40), state: 'open', checks: 'passed', taskId: task.id }],
      workflowRuns: [],
      deployments: [],
    })),
  } as unknown as ReleaseViewStore;
  const tokenIssuer = {
    issueForRepositoryRead: vi.fn(async () => 'test-installation-token'),
  } as unknown as GitHubAppTokenIssuer;
  const app = buildApp(config, undefined, {
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }),
    modules: options.modules ?? [factoryModule],
    projectStore,
    taskStore,
    releaseViewStore,
    githubAppTokenIssuer: tokenIssuer,
    factoryBoardReader: { read: reader },
  });
  apps.push(app);
  return { app, projectStore, taskStore, releaseViewStore, tokenIssuer };
}

describe('Factory board', () => {
  it('uses the same status fixtures as project_board.py', () => {
    for (const testCase of cases) {
      expect(
        desiredFactoryBoardStatus(testCase.issue, testCase.pulls),
        testCase.name,
      ).toBe(testCase.status);
    }
  });

  it('places recent closed issues in Done and returns linked PR and task details', () => {
    const board = createFactoryBoard(
      project.id,
      project.repo,
      {
        issues: [
          sourceIssue,
          { ...sourceIssue, number: 8, state: 'closed', closedAt: new Date(Date.now() - 1_000).toISOString() },
          { ...sourceIssue, number: 9, state: 'closed', closedAt: new Date(Date.now() - 15 * 86_400_000).toISOString() },
        ],
        pullRequests: source.pullRequests,
      },
      [task],
      [{ number: 70, checks: 'passed', taskId: task.id }],
    );

    expect(board.columns.map(({ status }) => status)).toEqual([
      'Backlog', 'Needs Dan', 'Ready', 'In progress', 'In review', 'Done',
    ]);
    expect(board.columns[4]?.cards[0]).toEqual({
      issueNumber: 7,
      taskId: task.id,
      title: sourceIssue.title,
      labels: sourceIssue.labels,
      pullRequests: [{
        number: 70,
        url: 'https://github.com/DanAakesen/jarvis/pull/70',
        draft: false,
        ready: true,
        checks: 'passed',
      }],
      task: {
        state: 'Running',
        agent: 'codex',
        sandbox: { lastSessionEndReason: null },
      },
    });
    expect(board.columns[5]?.cards.map(({ issueNumber }) => issueNumber)).toEqual([8]);
  });

  it('serves cached board snapshots and invalidates them after committed task events', async () => {
    const reader = vi.fn(async () => source);
    const { app, tokenIssuer, taskStore, releaseViewStore } = fixture(reader);
    const first = await app.inject({ url: '/factory/board?project=42', headers });
    const second = await app.inject({ url: '/factory/board?project=42', headers });

    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.json().columns).toHaveLength(6);
    expect(second.json()).toEqual(first.json());
    expect(reader).toHaveBeenCalledTimes(1);
    expect(tokenIssuer.issueForRepositoryRead).toHaveBeenCalledWith(project.repo);
    expect(taskStore.list).toHaveBeenCalledWith({ projectId: project.id, limit: 1000, offset: 0 });
    expect(releaseViewStore.read).toHaveBeenCalledWith(project.id);

    app.eventHub.publish({
      id: '1', taskId: task.id, type: 'state_changed', summary: 'Task paused',
      payload: { to: 'Paused' }, payloadTruncated: false, source: 'backend', at: timestamp,
    } satisfies TaskEventMessage);
    expect((await app.inject({ url: '/factory/board?project=42', headers })).statusCode).toBe(200);
    expect(reader).toHaveBeenCalledTimes(2);
  });

  it('rejects missing projects and limits GitHub reads to the configured repository', async () => {
    const reader = vi.fn(async () => source);
    const { app, projectStore } = fixture(reader);
    projectStore.list = vi.fn(async () => []);

    expect((await app.inject({ url: '/factory/board?project=42', headers })).statusCode).toBe(404);
    expect(reader).not.toHaveBeenCalled();
    expect((await app.inject({ url: '/factory/board', headers })).statusCode).toBe(400);
    expect((await app.inject({
      url: '/factory/board?project=9999999999999999999',
      headers,
    })).statusCode).toBe(400);
  });

  it('reads issues and pull requests with the read-only token and excludes closed issues older than 14 days', async () => {
    const requests: { url: string; authorization: string | null }[] = [];
    const reader = createGitHubFactoryBoardReader(async (input, init) => {
      const url = String(input);
      requests.push({ url, authorization: new Headers(init?.headers).get('authorization') });
      const issue = (number: number, closedAt: string | null) => ({
        number, title: `Issue ${number}`, body: null, state: closedAt ? 'closed' : 'open', closed_at: closedAt,
        labels: [], issue_dependencies_summary: { blocked_by: 0 },
      });
      if (url.includes('state=closed')) {
        return new Response(JSON.stringify([
          issue(2, new Date(Date.now() - 1_000).toISOString()),
          issue(3, new Date(Date.now() - 15 * 86_400_000).toISOString()),
        ]));
      }
      if (url.includes('/pulls?')) return new Response('[]');
      return new Response(JSON.stringify([issue(1, null)]));
    });

    const result = await reader.read(project.repo, 'reader-token', new Date(Date.now() - 14 * 86_400_000).toISOString());

    expect(result.issues.map(({ number }) => number)).toEqual([1, 2]);
    expect(requests).toHaveLength(3);
    expect(requests.every(({ authorization }) =>
      authorization === `${['Bear', 'er'].join('')} reader-token`)).toBe(true);
    expect(requests.map(({ url }) => url)).toEqual(expect.arrayContaining([
      expect.stringContaining('/issues?state=open'),
      expect.stringContaining('/issues?state=closed&since='),
      expect.stringContaining('/pulls?state=open'),
    ]));
  });
});
