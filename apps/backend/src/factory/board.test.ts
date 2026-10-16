import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFactoryBoard, type FactoryBoard } from '@jarvis/contracts';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { TokenVerifier } from '../auth/verify.js';
import { GitHubAppRequestError, GitHubAppResponseError, type GitHubAppTokenIssuer } from '../github-app.js';
import type { BackendModule } from '../modules.js';
import { factoryModule } from './index.js';
import type { Project, ProjectStore } from './projects.js';
import {
  FactoryBoardCache,
  createFactoryBoard,
  createGitHubFactoryBoardReader,
  boardDurationFields,
  desiredFactoryBoardStatus,
  type FactoryBoardIssue,
  type FactoryBoardSource,
} from './board.js';
import type { TaskEventMessage, TaskRecord, TaskStore } from './task-store.js';
import type { ReleaseViewStore } from './release-view.js';
import { FactoryBoardReadError } from './board-errors.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = {
  authorization: `${['Bear', 'er'].join('')} ${['test', 'token', 'signature'].join('.')}`,
};
const timestamp = '2026-10-08T00:00:00.000Z';

function pageLink(url: string, page: number, lastPage: number): string {
  const link = (targetPage: number) => {
    const target = new URL(url);
    target.searchParams.set('per_page', '100');
    target.searchParams.set('page', String(targetPage));
    return `<${target}>`;
  };
  return [
    ...(page < lastPage ? [`${link(page + 1)}; rel="next"`] : []),
    ...(page < lastPage ? [`${link(lastPage)}; rel="last"`] : []),
  ].join(', ');
}

const project: Project = {
  id: '42', name: 'Jarvis', description: null, repo: 'DanAakesen/jarvis', default_branch: 'main',
  default_agent: 'codex', policy: 'deliver_pr', merge_rules: null, sandbox_size: '1x2', tech: 'node',
  max_parallel_tasks: 1, active: true,
};
const sourceIssue: FactoryBoardIssue = {
  number: 7, url: 'https://github.com/DanAakesen/jarvis/issues/7', title: 'P10-04: Implement board',
  taskCode: 'P10-04', labels: ['Codex', 'P1'], worker: 'Codex', state: 'open',
  updatedAt: timestamp, closedAt: null, blockedBy: [], blockedByCount: 0, body: null,
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
  status: string;
}[];
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function fixture(reader: ReturnType<typeof vi.fn>, options: { modules?: readonly BackendModule[]; auth?: TokenVerifier } = {}) {
  const projectStore = { list: vi.fn(async () => [project]) } as unknown as ProjectStore;
  const taskStore = {
    list: vi.fn(async () => [task]),
    get: vi.fn(async () => ({ ...task, events: [], usage: [] })),
  } as unknown as TaskStore;
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
    auth: options.auth ?? (async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId })),
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
  it('reports bounded phase durations without presenting clipped values as exact', () => {
    expect(boardDurationFields(0)).toEqual({ durationMs: 0 });
    expect(boardDurationFields(60_000)).toEqual({ durationMs: 60_000 });
    expect(boardDurationFields(60_001)).toEqual({ durationCensored: true });
    expect(boardDurationFields(Number.NaN)).toEqual({ durationUnavailable: true });
  });

  it('keeps the board private and refuses the existing deployment smoke identity', async () => {
    const reader = vi.fn(async () => source);
    const { app, tokenIssuer } = fixture(reader, {
      auth: async () => ({ kind: 'jarvis-deploy', objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }),
    });
    expect((await app.inject({ url: '/factory/board?project=42' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/factory/board?project=42', headers })).statusCode).toBe(403);
    expect(tokenIssuer.issueForRepositoryRead).not.toHaveBeenCalled();
    expect(reader).not.toHaveBeenCalled();
  });

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

    expect(board.columns.map(({ id }) => id)).toEqual([
      'backlog', 'needs_dan', 'ready', 'in_progress', 'in_review', 'done',
    ]);
    expect(board.columns[4]?.cards[0]).toEqual({
      issue: {
        number: 7,
        url: sourceIssue.url,
        title: sourceIssue.title,
        taskCode: 'P10-04',
        labels: sourceIssue.labels,
        worker: 'Codex',
        state: 'open',
        updatedAt: timestamp,
        closedAt: null,
        blockedBy: [],
      },
      pr: {
        number: 70,
        url: 'https://github.com/DanAakesen/jarvis/pull/70',
        draft: false,
        checks: 'passing',
      },
      task: {
        id: task.id,
        state: 'Running',
        agent: 'codex',
        activity: 'Working',
        attemptCount: 1,
        branch: 'jarvis/task-81',
        startedAt: timestamp,
        latestSessionEndReason: null,
      },
    });
    expect(board.columns[5]?.cards.map(({ issue: { number } }) => number)).toEqual([8]);
    expect(isFactoryBoard(board)).toBe(true);
  });

  it('shares an invalidated in-flight owner and publishes only its clean follow-up', async () => {
    const initial = Promise.withResolvers<FactoryBoardSource>();
    const updated = { ...source, issues: [{ ...sourceIssue, title: 'Updated board' }] };
    const reader = vi.fn(async () => updated).mockImplementationOnce(() => initial.promise);
    const { app } = fixture(reader);
    const cacheRead = vi.spyOn(app.factoryBoardCache, 'get');
    const first = app.inject({ url: '/factory/board?project=42', headers });
    let second: ReturnType<typeof app.inject> | undefined;
    try {
      await vi.waitFor(() => expect(reader).toHaveBeenCalledOnce());
      app.publishFactoryBoardChange(project.id, 'github_webhook');
      second = app.inject({ url: '/factory/board?project=42', headers });
      await vi.waitFor(() => expect(cacheRead).toHaveBeenCalledTimes(2));
      expect(reader).toHaveBeenCalledOnce();

      initial.resolve(source);
      const responses = await Promise.all([first, second]);
      for (const response of responses) {
        expect(response.statusCode).toBe(200);
        expect(response.json().stale).toBe(false);
        expect(response.json().columns[4].cards[0].issue.title).toBe('Updated board');
      }
      expect(reader).toHaveBeenCalledTimes(2);
      const cached = await app.inject({ url: '/factory/board?project=42', headers });
      expect(cached.json()).toEqual(responses[0]!.json());
      expect(reader).toHaveBeenCalledTimes(2);
    } finally {
      initial.resolve(source);
      await Promise.allSettled([first, ...(second ? [second] : [])]);
    }
  });

  it('does not replace another project in-flight owner when a project publishes an update', async () => {
    const initial = Promise.withResolvers<FactoryBoardSource>();
    const reader = vi.fn(async () => source).mockImplementationOnce(() => initial.promise);
    const { app, projectStore } = fixture(reader);
    vi.mocked(projectStore.list).mockResolvedValue([
      project, { ...project, id: '43', repo: 'DanAakesen/other' },
    ]);
    const cacheRead = vi.spyOn(app.factoryBoardCache, 'get');
    const first = app.inject({ url: '/factory/board?project=42', headers });
    let second: ReturnType<typeof app.inject> | undefined;
    try {
      await vi.waitFor(() => expect(reader).toHaveBeenCalledOnce());
      app.publishFactoryBoardChange('43', 'github_webhook');
      second = app.inject({ url: '/factory/board?project=42', headers });
      await vi.waitFor(() => expect(cacheRead).toHaveBeenCalledTimes(2));
      expect(reader).toHaveBeenCalledOnce();

      initial.resolve(source);
      const responses = await Promise.all([first, second]);
      expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
      expect(responses[1]!.json()).toEqual(responses[0]!.json());
      await app.inject({ url: '/factory/board?project=42', headers });
      expect(reader).toHaveBeenCalledOnce();
    } finally {
      initial.resolve(source);
      await Promise.allSettled([first, ...(second ? [second] : [])]);
    }
  });

  it('keeps a validated stale snapshot and typed error when a dirty follow-up is invalid', async () => {
    const initial = Promise.withResolvers<FactoryBoardSource>();
    const updated = { ...source, issues: [{ ...sourceIssue, title: 'Updated board' }] };
    const reader = vi.fn(async () => updated).mockImplementationOnce(() => initial.promise);
    const { app, taskStore } = fixture(reader);
    vi.mocked(taskStore.list).mockResolvedValueOnce([task])
      .mockResolvedValueOnce([{ ...task, startedAt: 'invalid' }]);
    const warn = vi.fn();
    app.addHook('onRequest', async (request) => { request.log.warn = warn; });
    const first = app.inject({ url: '/factory/board?project=42', headers });
    try {
      await vi.waitFor(() => expect(reader).toHaveBeenCalledOnce());
      app.publishFactoryBoardChange(project.id, 'github_webhook');
      initial.resolve(source);
      const stale = await first;
      expect(stale.statusCode).toBe(200);
      expect(isFactoryBoard(stale.json())).toBe(true);
      expect(stale.json().stale).toBe(true);
      expect(stale.json().columns[4].cards[0].issue.title).toBe(sourceIssue.title);
      expect(warn).toHaveBeenCalledWith(expect.objectContaining({
        stage: 'response', reason: 'invalid_response', stale: true,
      }), 'factory.board_read_failed');
      expect(reader).toHaveBeenCalledTimes(2);
      const fresh = await app.inject({ url: '/factory/board?project=42', headers });
      expect(isFactoryBoard(fresh.json())).toBe(true);
      expect(fresh.json().stale).toBe(false);
      expect(fresh.json().columns[4].cards[0].issue.title).toBe('Updated board');
      expect(reader).toHaveBeenCalledTimes(3);
    } finally {
      initial.resolve(source);
      await first;
    }
  });

  it.each([false, true])('keeps failed ownership until source settlement (fallback: %s)', async (cached) => {
    const initial = Promise.withResolvers<FactoryBoardSource>();
    const reader = vi.fn(async () => source);
    const { app, taskStore } = fixture(reader);
    const warn = vi.fn();
    const info = vi.fn();
    app.addHook('onRequest', async (request) => {
      request.log.warn = warn;
      request.log.info = info;
    });
    const previous = cached ? (await app.inject({ url: '/factory/board?project=42', headers })).json<FactoryBoard>() : undefined;
    if (cached) app.factoryBoardCache.invalidate(project.id);
    info.mockClear();
    const initialCalls = reader.mock.calls.length;
    reader.mockImplementationOnce(() => initial.promise);
    const failure = new FactoryBoardReadError('task', 'request_failed', 503);
    vi.mocked(taskStore.list).mockRejectedValueOnce(failure);
    const cacheRead = vi.spyOn(app.factoryBoardCache, 'get');
    const first = app.inject({ url: '/factory/board?project=42', headers });
    let second: ReturnType<typeof app.inject> | undefined;
    try {
      await vi.waitFor(() => expect(reader).toHaveBeenCalledTimes(initialCalls + 1));
      await vi.waitFor(() => expect(info).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'task' }), 'factory.board_phase',
      ));
      app.publishFactoryBoardChange(project.id, 'github_webhook');
      second = app.inject({ url: '/factory/board?project=42', headers });
      await vi.waitFor(() => expect(cacheRead).toHaveBeenCalledTimes(2));
      expect(reader).toHaveBeenCalledTimes(initialCalls + 1);
      expect(warn).not.toHaveBeenCalled();
      initial.resolve(source);
      const failed = await Promise.all([first, second]);
      expect(failed.map((response) => response.statusCode)).toEqual(cached ? [200, 200] : [502, 502]);
      if (cached) {
        for (const response of failed) {
          expect(response.json().stale).toBe(true);
          expect(response.json().columns).toEqual(previous?.columns);
          expect(isFactoryBoard(response.json())).toBe(true);
        }
      }
      expect(warn.mock.calls.filter(([, event]) => event === 'factory.board_read_failed')).toHaveLength(2);
      expect(warn).toHaveBeenCalledWith(expect.objectContaining({
        stage: 'task', reason: 'request_failed', status: 503, stale: cached,
      }), 'factory.board_read_failed');
      const shared = cacheRead.mock.results[0];
      if (!shared || shared.type !== 'return') throw new Error('Cache request did not return a promise');
      if (cached) expect((await shared.value).failure).toBe(failure);
      else await expect(shared.value).rejects.toBe(failure);
      expect((await app.inject({ url: '/factory/board?project=42', headers })).statusCode).toBe(200);
      expect(reader).toHaveBeenCalledTimes(initialCalls + 2);
    } finally {
      initial.resolve(source);
      await Promise.allSettled([first, ...(second ? [second] : [])]);
    }
  });

  it('settles repeated follow-up invalidation as stale without inventing a source failure', async () => {
    const initial = Promise.withResolvers<FactoryBoardSource>();
    const followUp = Promise.withResolvers<FactoryBoardSource>();
    const updated = { ...source, issues: [{ ...sourceIssue, title: 'Final board' }] };
    const reader = vi.fn(async () => updated)
      .mockImplementationOnce(() => initial.promise).mockImplementationOnce(() => followUp.promise);
    const { app } = fixture(reader);
    const warn = vi.fn();
    const info = vi.fn();
    const updates: unknown[] = [];
    app.addHook('onRequest', async (request) => {
      request.log.warn = warn;
      request.log.info = info;
    });
    const unsubscribe = app.nowEventHub.subscribe((update) => updates.push(update));
    const first = app.inject({ url: '/factory/board?project=42', headers });
    try {
      await vi.waitFor(() => expect(reader).toHaveBeenCalledOnce());
      app.publishFactoryBoardChange(project.id, 'github_webhook');
      initial.resolve(source);
      await vi.waitFor(() => expect(reader).toHaveBeenCalledTimes(2));
      app.publishFactoryBoardChange(project.id, 'github_webhook');
      app.publishFactoryBoardChange(project.id, 'github_webhook');
      followUp.resolve(source);
      const stale = await first;
      expect(isFactoryBoard(stale.json())).toBe(true);
      expect(stale.json().stale).toBe(true);
      expect(warn).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'success', statusCode: 200, stale: true, cachePath: 'source_load',
      }), 'factory.board_read_timing');
      expect(updates).toEqual([1, 2, 3].map((version) => ({ type: 'board', projectId: project.id, version })));
      const fresh = await app.inject({ url: '/factory/board?project=42', headers });
      expect(fresh.json().stale).toBe(false);
      expect(fresh.json().columns[4].cards[0].issue.title).toBe('Final board');
      expect(reader).toHaveBeenCalledTimes(3);
    } finally {
      initial.resolve(source);
      followUp.resolve(source);
      await first;
      unsubscribe();
    }
  });

  it('preserves cached projects when a task project lookup fails and reports its safe cause', async () => {
    const reader = vi.fn(async () => source);
    const { app, taskStore } = fixture(reader);
    await app.inject({ url: '/factory/board?project=42', headers });
    const warn = vi.spyOn(app.log, 'warn');
    const info = vi.spyOn(app.log, 'info');
    vi.mocked(taskStore.get).mockRejectedValueOnce({
      kind: 'transport', statusCode: 503, message: 'private-lookup-failure',
    });
    app.eventHub.publish({
      id: '1', taskId: task.id, type: 'state_changed', summary: 'Task paused',
      payload: { to: 'Paused' }, payloadTruncated: false, source: 'backend', at: timestamp,
    });
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(
      { kind: 'transport', statusCode: 503 }, 'factory.board_task_event_failed',
    ));
    expect(info.mock.calls.some(([, event]) => event === 'factory.board_invalidated')).toBe(false);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private-lookup-failure');
    const cached = await app.inject({ url: '/factory/board?project=42', headers });
    expect(cached.statusCode).toBe(200);
    expect(reader).toHaveBeenCalledOnce();
  });

  it('invalidates only the resolved task project and preserves another project snapshot', async () => {
    const reader = vi.fn(async () => ({ issues: [], pullRequests: [] }));
    const { app, projectStore } = fixture(reader);
    vi.mocked(projectStore.list).mockResolvedValue([
      project, { ...project, id: '43', repo: 'DanAakesen/other' },
    ]);
    const cached = await app.inject({ url: '/factory/board?project=43', headers });
    const updates: unknown[] = [];
    const unsubscribe = app.nowEventHub.subscribe((update) => updates.push(update));
    try {
      app.eventHub.publish({
        id: '1', taskId: task.id, type: 'state_changed', summary: 'Task paused',
        payload: { to: 'Paused' }, payloadTruncated: false, source: 'backend', at: timestamp,
      });
      await vi.waitFor(() => expect(updates).toEqual([{ type: 'board', projectId: project.id, version: 1 }]));
      const retained = await app.inject({ url: '/factory/board?project=43', headers });
      expect(retained.json()).toEqual(cached.json());
      expect(reader).toHaveBeenCalledOnce();
    } finally {
      unsubscribe();
    }
  });

  it('refuses a failed active-project lookup without starting or invalidating a source owner', async () => {
    const reader = vi.fn(async () => source);
    const { app, projectStore } = fixture(reader);
    const warn = vi.fn();
    app.addHook('onRequest', async (request) => { request.log.warn = warn; });
    const cached = await app.inject({ url: '/factory/board?project=42', headers });
    vi.mocked(projectStore.list).mockRejectedValueOnce(new DOMException('private-project-failure', 'TimeoutError'));
    const failed = await app.inject({ url: '/factory/board?project=42', headers });
    expect(failed.statusCode).toBe(503);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'project', reason: 'timeout', route: '/factory/board',
    }), 'factory.board_project_lookup_failed');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private-project-failure');
    const recovered = await app.inject({ url: '/factory/board?project=42', headers });
    expect(recovered.json()).toEqual(cached.json());
    expect(reader).toHaveBeenCalledOnce();
  });

  it('does not let a cached board bypass current active-project scoping', async () => {
    const reader = vi.fn(async () => source);
    const { app, projectStore } = fixture(reader);
    expect((await app.inject({ url: '/factory/board?project=42', headers })).statusCode).toBe(200);
    vi.mocked(projectStore.list).mockResolvedValueOnce([]);
    expect((await app.inject({ url: '/factory/board?project=42', headers })).statusCode).toBe(404);
    expect(reader).toHaveBeenCalledOnce();
  });

  it('serves cached board snapshots and invalidates them after committed task events', async () => {
    const reader = vi.fn(async () => source);
    const { app, tokenIssuer, taskStore, releaseViewStore } = fixture(reader);
    const info = vi.spyOn(app.log, 'info');
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

    const updates: unknown[] = [];
    const unsubscribe = app.nowEventHub.subscribe((update) => updates.push(update));
    app.eventHub.publish({
      id: '1', taskId: task.id, type: 'state_changed', summary: 'Task paused',
      payload: { to: 'Paused' }, payloadTruncated: false, source: 'backend', at: timestamp,
    } satisfies TaskEventMessage);
    await vi.waitFor(() => expect(updates).toContainEqual({ type: 'board', projectId: project.id, version: 1 }));
    expect(info).toHaveBeenCalledWith(
      { origin: 'task_event', projectId: project.id, version: 1 }, 'factory.board_invalidated',
    );
    expect(info.mock.calls.filter(([, event]) => event === 'factory.board_invalidated')).toHaveLength(1);
    expect((await app.inject({ url: '/factory/board?project=42', headers })).statusCode).toBe(200);
    expect(reader).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('logs bounded phase timings and distinguishes source loads from cache hits', async () => {
    const reader = vi.fn(async () => source);
    const { app } = fixture(reader);
    const info = vi.fn();
    app.addHook('onRequest', async (request) => { request.log.info = info; });
    const first = await app.inject({ url: '/factory/board?project=42', headers });
    expect(first.statusCode).toBe(200);
    expect(first.headers['content-type']).toContain('application/json');
    const firstPhases = info.mock.calls
      .filter(([, event]) => event === 'factory.board_phase')
      .map(([fields]) => fields as Record<string, unknown>);
    expect(firstPhases.map(({ stage }) => stage).sort()).toEqual([
      'project', 'release', 'response', 'response', 'source', 'task', 'token',
    ]);
    expect(firstPhases.filter(({ stage }) => stage === 'response').map(({ part }) => part).sort())
      .toEqual(['assemble', 'serialize']);
    for (const phase of firstPhases) {
      expect(phase).toMatchObject({
        reqId: expect.stringMatching(/^[\da-f-]{36}$/u),
        route: '/factory/board',
      });
      expect(phase.durationMs).toEqual(expect.any(Number));
      expect(phase.durationMs as number).toBeGreaterThanOrEqual(0);
      expect(phase.durationMs as number).toBeLessThanOrEqual(60_000);
    }
    expect(info.mock.calls.find(([, event]) => event === 'factory.board_read_timing')?.[0])
      .toMatchObject({
        cachePath: 'source_load', cacheElapsedMs: expect.any(Number),
        stale: false, outcome: 'success', statusCode: 200,
      });

    info.mockClear();
    const second = await app.inject({ url: '/factory/board?project=42', headers });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(reader).toHaveBeenCalledOnce();
    const cachedPhases = info.mock.calls
      .filter(([, event]) => event === 'factory.board_phase')
      .map(([fields]) => fields as Record<string, unknown>);
    expect(cachedPhases.map(({ stage }) => stage)).toEqual(['project', 'response']);
    expect(info.mock.calls.find(([, event]) => event === 'factory.board_read_timing')?.[0])
      .toMatchObject({
        cachePath: 'cache_hit', cacheElapsedMs: expect.any(Number),
        stale: false, outcome: 'success', statusCode: 200,
      });
  });

  it('measures cache wait time separately for shared callers', async () => {
    let finishRead!: (result: FactoryBoardSource) => void;
    const reader = vi.fn(() => new Promise<FactoryBoardSource>((resolve) => { finishRead = resolve; }));
    const { app } = fixture(reader);
    const info = vi.fn();
    app.addHook('onRequest', async (request) => { request.log.info = info; });
    const first = app.inject({ url: '/factory/board?project=42', headers });
    await vi.waitFor(() => expect(reader).toHaveBeenCalledOnce());
    const second = app.inject({ url: '/factory/board?project=42', headers });
    await vi.waitFor(() => expect(info.mock.calls.filter(([fields, event]) =>
      event === 'factory.board_phase' && (fields as Record<string, unknown>).stage === 'project',
    )).toHaveLength(2));
    finishRead(source);
    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(200);

    const summaries = info.mock.calls
      .filter(([, event]) => event === 'factory.board_read_timing')
      .map(([fields]) => fields as Record<string, unknown>);
    expect(summaries).toHaveLength(2);
    expect(summaries.map(({ cachePath }) => cachePath).sort()).toEqual(['shared_wait', 'source_load']);
    for (const summary of summaries) {
      expect(summary.cacheElapsedMs).toEqual(expect.any(Number));
      expect(summary.cacheElapsedMs as number).toBeGreaterThanOrEqual(0);
      expect(summary.cacheElapsedMs as number).toBeLessThanOrEqual(60_000);
    }
  });

  it.each([
    ['token', new GitHubAppRequestError(401), 'request_failed', 401],
    ['token', new GitHubAppRequestError(403), 'request_failed', 403],
    ['token', new GitHubAppResponseError('invalid_token_lifetime', 'sensitive-expiry'), 'invalid_token_lifetime', undefined],
    ['token', new GitHubAppResponseError('invalid_token_permissions', 'sensitive-permissions'), 'invalid_token_permissions', undefined],
    ['source', new FactoryBoardReadError('source', 'request_failed', 429), 'request_failed', 429],
    ['source', new FactoryBoardReadError('source', 'result_limit'), 'result_limit', undefined],
    ['source', new DOMException('sensitive-timeout', 'TimeoutError'), 'timeout', undefined],
    ['task', new Error('sensitive-sql'), 'unexpected', undefined],
    ['release', new Error('sensitive-release'), 'unexpected', undefined],
  ] as const)('reports only safe fields for %s / %s failures', async (stage, error, reason, status) => {
    const reader = vi.fn(async () => source);
    const { app, tokenIssuer, taskStore, releaseViewStore } = fixture(reader);
    const warn = vi.fn();
    app.addHook('onRequest', async (request) => { request.log.warn = warn; });
    if (stage === 'token') vi.mocked(tokenIssuer.issueForRepositoryRead).mockRejectedValueOnce(error);
    if (stage === 'source') reader.mockRejectedValueOnce(error);
    if (stage === 'task') vi.mocked(taskStore.list).mockRejectedValueOnce(error);
    if (stage === 'release') vi.mocked(releaseViewStore.read).mockRejectedValueOnce(error);
    const response = await app.inject({ url: '/factory/board?project=42', headers });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'Factory board unavailable' });
    expect(warn).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      stage, reason, status, stale: false, route: '/factory/board',
      reqId: expect.stringMatching(/^[\da-f-]{36}$/u),
    }), 'factory.board_read_failed');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sensitive');
    if (stage === 'token') expect(reader).not.toHaveBeenCalled();
  });

  it('rejects an invalid completed board before caching it and accepts a subsequent valid read', async () => {
    const reader = vi.fn(async () => source);
    const { app, taskStore } = fixture(reader);
    const warn = vi.fn();
    app.addHook('onRequest', async (request) => { request.log.warn = warn; });
    vi.mocked(taskStore.list).mockResolvedValueOnce([{ ...task, startedAt: 'invalid' }]);
    const failed = await app.inject({ url: '/factory/board?project=42', headers });
    expect(failed.statusCode).toBe(502);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'response', reason: 'invalid_response', status: undefined, stale: false,
      route: '/factory/board', reqId: expect.stringMatching(/^[\da-f-]{36}$/u),
    }), 'factory.board_read_failed');
    const response = await app.inject({ url: '/factory/board?project=42', headers });
    expect(response.statusCode).toBe(200);
    expect(isFactoryBoard(response.json())).toBe(true);
    expect(reader).toHaveBeenCalledTimes(2);
  });

  it('logs stale refresh diagnostics without exposing them in the response', async () => {
    const error = new FactoryBoardReadError('source', 'request_failed', 503);
    const reader = vi.fn(async () => source);
    const { app } = fixture(reader);
    const warn = vi.fn();
    const info = vi.fn();
    app.addHook('onRequest', async (request) => {
      request.log.warn = warn;
      request.log.info = info;
    });
    let now = Date.now();
    app.factoryBoardCache = new FactoryBoardCache(() => now, 10);
    await app.inject({ url: '/factory/board?project=42', headers });
    now += 11;
    info.mockClear();
    reader.mockRejectedValueOnce(error);
    const response = await app.inject({ url: '/factory/board?project=42', headers });
    expect(response.statusCode).toBe(200);
    expect(response.json().stale).toBe(true);
    expect(isFactoryBoard(response.json())).toBe(true);
    expect(response.body).not.toContain('failure');
    expect(warn).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      stage: 'source', reason: 'request_failed', status: 503, stale: true,
      route: '/factory/board', reqId: expect.stringMatching(/^[\da-f-]{36}$/u),
    }), 'factory.board_read_failed');
    const failureFields = warn.mock.calls[0]![0] as Record<string, unknown>;
    expect(info.mock.calls.find(([, event]) => event === 'factory.board_read_timing')?.[0])
      .toMatchObject({
        reqId: failureFields.reqId, cachePath: 'source_load', stale: true,
        cacheElapsedMs: expect.any(Number),
        outcome: 'success', statusCode: 200, route: '/factory/board',
      });
  });

  it('retains the response byte limit with a safe response-stage diagnostic', async () => {
    const reader = vi.fn(async () => ({
      issues: Array.from({ length: 150 }, (_, index) => ({
        ...sourceIssue, number: index + 1, labels: Array.from({ length: 100 }, (_, label) => `${label}-${'x'.repeat(95)}`),
      })),
      pullRequests: [],
    }));
    const { app } = fixture(reader);
    const warn = vi.fn();
    app.addHook('onRequest', async (request) => { request.log.warn = warn; });
    const response = await app.inject({ url: '/factory/board?project=42', headers });
    expect(response.statusCode).toBe(413);
    expect(warn).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      stage: 'response', reason: 'response_too_large', status: 413,
      route: '/factory/board', reqId: expect.stringMatching(/^[\da-f-]{36}$/u),
    }), 'factory.board_read_failed');
  });

  it.each([401, 403, 429, 500, 503])('preserves source HTTP %s without reading the external error body', async (status) => {
    const reader = createGitHubFactoryBoardReader(async () => new Response('private-external-response', { status }));
    await expect(reader.read(project.repo, 'reader-token', timestamp)).rejects.toMatchObject({
      stage: 'source', reason: 'request_failed', status,
    });
  });

  it.each([
    ['size', 'response_too_large'],
    ['json', 'invalid_response'],
    ['pagination', 'result_limit'],
  ] as const)('reports the bounded source %s failure', async (failure, reason) => {
    const reader = createGitHubFactoryBoardReader(async (input) => {
      if (failure === 'size') return new Response('private-response', { headers: { 'content-length': String(1024 * 1024 + 1) } });
      if (failure === 'json') return new Response('private-invalid-json');
      const url = String(input);
      return new Response('[]', { headers: { link: pageLink(url, 1, 11) } });
    });
    await expect(reader.read(project.repo, 'reader-token', timestamp)).rejects.toMatchObject({
      stage: 'source', reason,
    });
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
        html_url: `https://github.com/DanAakesen/jarvis/issues/${number}`,
        updated_at: timestamp,
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

  it('reads provider-shaped page-and-cursor links in order and validates backward cursors', async () => {
    const cursorUrls: URL[] = [];
    const authorizationHeaders: string[] = [];
    const providerLink = (page: number, cursorName: 'after' | 'before', cursor: string, relation: string) => {
      const url = new URL('https://api.github.com/repositories/1403065900/issues');
      url.searchParams.set('state', 'closed');
      url.searchParams.set('since', timestamp);
      url.searchParams.set('per_page', '100');
      url.searchParams.set('page', String(page));
      url.searchParams.set(cursorName, cursor);
      return `<${url}>; rel="${relation}"`;
    };
    const closedIssue = (number: number) => ({
      number, title: `Closed ${number}`, body: null, state: 'closed', closed_at: timestamp,
      html_url: `https://github.com/DanAakesen/jarvis/issues/${number}`,
      updated_at: timestamp, labels: [], issue_dependencies_summary: { blocked_by: 0 },
    });
    const reader = createGitHubFactoryBoardReader(async (input, init) => {
      const url = new URL(String(input));
      authorizationHeaders.push(new Headers(init?.headers).get('authorization') ?? '');
      if (url.pathname.endsWith('/issues') && url.searchParams.get('state') === 'closed') {
        cursorUrls.push(url);
        if (cursorUrls.length === 1) {
          return new Response(JSON.stringify(Array.from({ length: 100 }, (_, index) => closedIssue(index + 1))), {
            headers: { link: providerLink(2, 'after', 'opaque/cursor+one', 'next') },
          });
        }
        if (url.searchParams.get('after') === 'opaque/cursor+one') {
          return new Response(JSON.stringify(Array.from({ length: 100 }, (_, index) => closedIssue(index + 101))), {
            headers: {
              link: `${providerLink(3, 'after', 'opaque/cursor+two', 'next')}, ` +
                `${providerLink(1, 'before', 'opaque/previous+one', 'prev')}`,
            },
          });
        }
        if (url.searchParams.get('after') === 'opaque/cursor+two') {
          return new Response(JSON.stringify(Array.from({ length: 25 }, (_, index) => closedIssue(index + 201))), {
            headers: { link: providerLink(2, 'before', 'opaque/previous+two', 'prev') },
          });
        }
        throw new Error(`Unexpected cursor request: ${url}`);
      }
      return new Response('[]');
    });

    const result = await reader.read(project.repo, 'reader-token', timestamp);

    expect(result.issues).toEqual(Array.from({ length: 225 }, (_, index) => {
      const number = index + 1;
      return {
        number,
        url: `https://github.com/DanAakesen/jarvis/issues/${number}`,
        title: `Closed ${number}`,
        taskCode: null,
        labels: [],
        worker: null,
        state: 'closed',
        updatedAt: timestamp,
        closedAt: timestamp,
        blockedBy: [],
        blockedByCount: 0,
        body: null,
      };
    }));
    expect(result.pullRequests).toEqual([]);
    expect(cursorUrls).toHaveLength(3);
    expect(cursorUrls.every(({ pathname }) => pathname === '/repos/DanAakesen/jarvis/issues')).toBe(true);
    expect(cursorUrls.every(({ searchParams }) => !searchParams.has('before'))).toBe(true);
    expect(cursorUrls.map(({ searchParams }) => [
      searchParams.get('page'), searchParams.get('after'),
    ])).toEqual([
      ['1', null],
      ['2', 'opaque/cursor+one'],
      ['3', 'opaque/cursor+two'],
    ]);
    expect(cursorUrls[1]?.searchParams.get('page')).toBe('2');
    expect(cursorUrls[1]?.searchParams.get('after')).toBe('opaque/cursor+one');
    expect(cursorUrls[2]?.searchParams.get('page')).toBe('3');
    expect(cursorUrls[2]?.searchParams.get('after')).toBe('opaque/cursor+two');
    expect(authorizationHeaders).toHaveLength(5);
    expect(authorizationHeaders.every((authorization) =>
      authorization === `${['Bear', 'er'].join('')} reader-token`)).toBe(true);
  });

  it('rejects inconsistent provider previous-page metadata', async () => {
    const providerLink = (page: number, cursorName: 'after' | 'before', cursor: string, relation: string) => {
      const url = new URL('https://api.github.com/repositories/1403065900/issues');
      url.searchParams.set('state', 'closed');
      url.searchParams.set('since', timestamp);
      url.searchParams.set('per_page', '100');
      url.searchParams.set('page', String(page));
      url.searchParams.set(cursorName, cursor);
      return `<${url}>; rel="${relation}"`;
    };
    const closedIssue = (number: number) => ({
      number, title: `Closed ${number}`, body: null, state: 'closed', closed_at: timestamp,
      html_url: `https://github.com/DanAakesen/jarvis/issues/${number}`,
      updated_at: timestamp, labels: [], issue_dependencies_summary: { blocked_by: 0 },
    });
    const reader = createGitHubFactoryBoardReader(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/issues') && url.searchParams.get('state') === 'closed') {
        if (url.searchParams.get('page') === '1') {
          return new Response(JSON.stringify(Array.from({ length: 100 }, (_, index) => closedIssue(index + 1))), {
            headers: { link: providerLink(2, 'after', 'opaque/cursor', 'next') },
          });
        }
        return new Response(JSON.stringify([closedIssue(101)]), {
          headers: { link: providerLink(9, 'before', 'opaque/previous', 'prev') },
        });
      }
      return new Response('[]');
    });

    await expect(reader.read(project.repo, 'reader-token', timestamp)).rejects.toMatchObject({
      stage: 'source', reason: 'invalid_response',
    });
  });

  it.each([
    [
      'different cursors',
      [
        ['after', 'cursor-one'],
        ['after', 'cursor-two'],
      ],
    ],
    [
      'offset and cursor links',
      [
        ['page', '2'],
        ['after', 'cursor-one'],
      ],
    ],
  ] as const)('rejects duplicate next relations with %s before requesting another page', async (_description, links) => {
    let closedIssueRequests = 0;
    const duplicateNextLinks = links.map(([parameter, value]) => {
      const url = new URL('https://api.github.com/repositories/1403065900/issues');
      url.searchParams.set('state', 'closed');
      url.searchParams.set('since', timestamp);
      url.searchParams.set('per_page', '100');
      url.searchParams.set('page', '2');
      if (parameter !== 'page') url.searchParams.set(parameter, value);
      return `<${url}>; rel="next"`;
    }).join(', ');
    const reader = createGitHubFactoryBoardReader(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/issues') && url.searchParams.get('state') === 'closed') {
        closedIssueRequests += 1;
        return new Response(JSON.stringify(Array.from({ length: 100 }, (_, index) => ({
          number: index + 1, title: `Closed ${index + 1}`, body: null, state: 'closed', closed_at: timestamp,
          html_url: `https://github.com/DanAakesen/jarvis/issues/${index + 1}`,
          updated_at: timestamp, labels: [], issue_dependencies_summary: { blocked_by: 0 },
        }))), { headers: { link: duplicateNextLinks } });
      }
      return new Response('[]');
    });

    await expect(reader.read(project.repo, 'reader-token', timestamp)).rejects.toMatchObject({
      stage: 'source', reason: 'invalid_response',
    });
    expect(closedIssueRequests).toBe(1);
  });

  it('overlaps complete page and sparse dependency reads within eight requests and preserves page order', async () => {
    const issues = Array.from({ length: 201 }, (_, index) => ({
      number: index + 1,
      title: `Issue ${index + 1}`,
      body: null,
      state: 'open',
      closed_at: null,
      html_url: `https://github.com/DanAakesen/jarvis/issues/${index + 1}`,
      updated_at: timestamp,
      labels: [],
      issue_dependencies_summary: { blocked_by: index < 20 && index % 2 === 0 ? 1 : 0 },
    }));
    let active = 0;
    let maximumActive = 0;
    let requestCount = 0;
    let initialRequests = 0;
    let dependencyRequests = 0;
    let dependencyWave = 0;
    let dependencyWaveRelease = Promise.withResolvers<void>();
    const pageThreeReturned = Promise.withResolvers<void>();
    const initialRelease = Promise.withResolvers<void>();
    const page = (url: string, items: unknown[], current: number, last: number) =>
      new Response(JSON.stringify(items), { headers: { link: pageLink(url, current, last) } });
    const reader = createGitHubFactoryBoardReader(async (input) => {
      active += 1;
      requestCount += 1;
      maximumActive = Math.max(maximumActive, active);
      const url = String(input);
      try {
        if (url.includes('/dependencies/blocked_by')) {
          dependencyRequests += 1;
          const waveRelease = dependencyWaveRelease;
          if (dependencyRequests % 8 === 0 || dependencyRequests === 10) {
            dependencyWave += 1;
            dependencyWaveRelease = Promise.withResolvers<void>();
            waveRelease.resolve();
          }
          await waveRelease.promise;
          return new Response(JSON.stringify([{ number: 1000 + Number(url.match(/\/issues\/(\d+)\/dependencies/u)?.[1]), state: 'open' }]));
        }
        if (url.includes('state=closed') || url.includes('/pulls?')) {
          initialRequests += 1;
          if (initialRequests === 3) initialRelease.resolve();
          await initialRelease.promise;
          return new Response('[]');
        }
        if (url.includes('/issues?state=open')) {
          const current = Number(new URL(url).searchParams.get('page'));
          initialRequests += current === 1 ? 1 : 0;
          if (current === 1) {
            if (initialRequests === 3) initialRelease.resolve();
            await initialRelease.promise;
            return page(url, issues.slice(0, 100), current, 3);
          }
          if (current === 2) {
            await pageThreeReturned.promise;
            return page(url, issues.slice(100, 200), current, 3);
          }
          pageThreeReturned.resolve();
          return page(url, issues.slice(200), current, 3);
        }
        throw new Error(`Unexpected source URL: ${url}`);
      } finally {
        active -= 1;
      }
    });

    const result = await reader.read(project.repo, 'reader-token', timestamp);

    expect(result.issues.map(({ number }) => number)).toEqual(issues.map(({ number }) => number));
    expect(result.issues.filter(({ blockedByCount }) => blockedByCount === 0)).toHaveLength(191);
    expect(result.issues.filter(({ blockedByCount }) => blockedByCount === 1)
      .map(({ number, blockedBy }) => [number, blockedBy])).toEqual(
      issues.slice(0, 20).filter((_, index) => index % 2 === 0)
        .map(({ number }) => [number, [1000 + number]]),
    );
    expect(requestCount).toBe(15);
    expect(dependencyRequests).toBe(10);
    expect(maximumActive).toBeLessThanOrEqual(8);
    expect(maximumActive).toBe(8);
    expect(dependencyWave).toBe(2);
    const serialRequestWaves = requestCount;
    const parallelRequestWaves = 2 + dependencyWave;
    expect(parallelRequestWaves).toBe(4);
    expect(parallelRequestWaves).toBeLessThan(serialRequestWaves);
    expect(result).toEqual({
      issues: issues.map((issue) => ({
        number: issue.number,
        url: issue.html_url,
        title: issue.title,
        taskCode: null,
        labels: [],
        worker: null,
        state: 'open',
        updatedAt: timestamp,
        closedAt: null,
        blockedBy: issue.issue_dependencies_summary.blocked_by === 0 ? [] : [1000 + issue.number],
        blockedByCount: issue.issue_dependencies_summary.blocked_by,
        body: null,
      })),
      pullRequests: [],
    });
    expect(new Set(result.issues.map(({ number }) => number)).size).toBe(201);
  });

  it('accepts the complete ten-page, 100-item boundary', async () => {
    const issues = Array.from({ length: 1_000 }, (_, index) => ({
      number: index + 1, title: `Issue ${index + 1}`, body: null, state: 'open', closed_at: null,
      html_url: `https://github.com/DanAakesen/jarvis/issues/${index + 1}`,
      updated_at: timestamp, labels: [], issue_dependencies_summary: { blocked_by: 0 },
    }));
    const reader = createGitHubFactoryBoardReader(async (input) => {
      const url = String(input);
      if (!url.includes('/issues?state=open')) return new Response('[]');
      const pageNumber = Number(new URL(url).searchParams.get('page'));
      const responseHeaders = pageNumber < 10 ? { link: pageLink(url, pageNumber, 10) } : undefined;
      return new Response(JSON.stringify(issues.slice((pageNumber - 1) * 100, pageNumber * 100)), {
        headers: responseHeaders,
      });
    });

    const result = await reader.read(project.repo, 'reader-token', timestamp);

    expect(result.issues.map(({ number }) => number)).toEqual(issues.map(({ number }) => number));
  });

  it('rejects unsafe, changing, and incomplete page metadata without following supplied URLs', async () => {
    const issuePage = Array.from({ length: 100 }, (_, index) => ({ number: index + 1 }));
    const unsafeUrls: string[] = [];
    const unsafe = createGitHubFactoryBoardReader(async (input, init) => {
      const url = String(input);
      unsafeUrls.push(url);
      if (url.includes('state=open')) {
        return new Response(JSON.stringify(issuePage), {
          headers: { link: pageLink(url, 1, 2).replace('https://api.github.com', 'https://attacker.example') },
        });
      }
      expect(new Headers(init?.headers).get('authorization')).toBe(`${['Bear', 'er'].join('')} reader-token`);
      return new Response('[]');
    });
    await expect(unsafe.read(project.repo, 'reader-token', timestamp)).rejects.toMatchObject({
      stage: 'source', reason: 'invalid_response',
    });
    expect(unsafeUrls.every((url) => url.startsWith('https://api.github.com/repos/DanAakesen/jarvis/'))).toBe(true);

    const changing = createGitHubFactoryBoardReader(async (input) => {
      const url = String(input);
      if (url.includes('state=open')) {
        const pageNumber = Number(new URL(url).searchParams.get('page'));
        return new Response(JSON.stringify(issuePage), {
          headers: { link: pageLink(url, pageNumber, pageNumber === 1 ? 2 : 3) },
        });
      }
      return new Response('[]');
    });
    await expect(changing.read(project.repo, 'reader-token', timestamp)).rejects.toMatchObject({
      stage: 'source', reason: 'incomplete_response',
    });

    const incomplete = createGitHubFactoryBoardReader(async (input) => {
      const url = String(input);
      if (url.includes('state=open')) {
        const pageNumber = Number(new URL(url).searchParams.get('page'));
        return new Response(JSON.stringify(pageNumber === 2 ? issuePage.slice(0, 99) : issuePage), {
          headers: { link: pageLink(url, pageNumber, 3) },
        });
      }
      return new Response('[]');
    });
    await expect(incomplete.read(project.repo, 'reader-token', timestamp)).rejects.toMatchObject({
      stage: 'source', reason: 'incomplete_response',
    });
  });

  it('stops next-only cursor pagination at the ten-page source limit', async () => {
    let closedPageRequests = 0;
    const issuePage = Array.from({ length: 100 }, (_, index) => ({
      number: index + 1, title: `Issue ${index + 1}`, body: null, state: 'closed', closed_at: timestamp,
      html_url: `https://github.com/DanAakesen/jarvis/issues/${index + 1}`,
      updated_at: timestamp, labels: [], issue_dependencies_summary: { blocked_by: 0 },
    }));
    const reader = createGitHubFactoryBoardReader(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/issues') && url.searchParams.get('state') === 'closed') {
        closedPageRequests += 1;
        return new Response(JSON.stringify(issuePage), {
          headers: {
            link: `<https://api.github.com/repositories/1403065900/issues?state=closed&since=${encodeURIComponent(timestamp)}&per_page=100&after=cursor-${closedPageRequests}>; rel="next"`,
          },
        });
      }
      return new Response('[]');
    });

    await expect(reader.read(project.repo, 'reader-token', timestamp)).rejects.toMatchObject({
      stage: 'source', reason: 'result_limit',
    });
    expect(closedPageRequests).toBe(10);
  });

  it('cancels active and queued page siblings when a page fails', async () => {
    let active = 0;
    let maximumActive = 0;
    let requestCount = 0;
    const reader = createGitHubFactoryBoardReader(async (input, init) => {
      const url = String(input);
      const signal = init?.signal as AbortSignal;
      active += 1;
      requestCount += 1;
      maximumActive = Math.max(maximumActive, active);
      try {
        if (url.includes('/issues?state=open') && new URL(url).searchParams.get('page') === '1') {
          return new Response(JSON.stringify(Array.from({ length: 100 }, (_, index) => ({ number: index + 1 }))), {
            headers: { link: pageLink(url, 1, 10) },
          });
        }
        if (url.includes('/issues?state=open') && new URL(url).searchParams.get('page') === '2') {
          return new Response('invalid JSON');
        }
        return await new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      } finally {
        active -= 1;
      }
    });

    await expect(reader.read(project.repo, 'reader-token', timestamp)).rejects.toMatchObject({
      stage: 'source', reason: 'invalid_response',
    });

    expect(active).toBe(0);
    expect(maximumActive).toBeLessThanOrEqual(8);
    expect(requestCount).toBeLessThan(12);
  });

  it('loads exact blocked issue numbers through the GitHub dependency API', async () => {
    const reader = createGitHubFactoryBoardReader(async (input) => {
      const url = String(input);
      if (url.includes('/dependencies/blocked_by')) {
        return new Response(JSON.stringify([{ number: 3, state: 'open' }, { number: 5, state: 'open' }]));
      }
      if (url.includes('/pulls?')) return new Response('[]');
      if (url.includes('state=closed')) return new Response('[]');
      return new Response(JSON.stringify([{
        number: 7,
        title: 'Blocked work',
        html_url: 'https://github.com/DanAakesen/jarvis/issues/7',
        body: null,
        state: 'open',
        updated_at: timestamp,
        closed_at: null,
        labels: [],
        issue_dependencies_summary: { blocked_by: 2 },
      }]));
    });

    await expect(reader.read(project.repo, 'reader-token', timestamp)).resolves.toMatchObject({
      issues: [{ number: 7, blockedBy: [3, 5], blockedByCount: 2 }],
    });
  });

  it('counts only open blockers when GitHub also lists closed ones', async () => {
    const reader = createGitHubFactoryBoardReader(async (input) => {
      const url = String(input);
      if (url.includes('/dependencies/blocked_by')) {
        return new Response(JSON.stringify([
          { number: 3, state: 'open' }, { number: 4, state: 'closed' }, { number: 5, state: 'closed' },
        ]));
      }
      if (url.includes('/pulls?') || url.includes('state=closed')) return new Response('[]');
      return new Response(JSON.stringify([{
        number: 7,
        title: 'Partly unblocked work',
        html_url: 'https://github.com/DanAakesen/jarvis/issues/7',
        body: null,
        state: 'open',
        updated_at: timestamp,
        closed_at: null,
        labels: [],
        issue_dependencies_summary: { blocked_by: 1, total_blocked_by: 3 },
      }]));
    });

    await expect(reader.read(project.repo, 'reader-token', timestamp)).resolves.toMatchObject({
      issues: [{ number: 7, blockedBy: [3], blockedByCount: 1 }],
    });
  });

  it('rejects dependency entries without a known state and counts that disagree with GitHub', async () => {
    const issueBody = [{
      number: 7, title: 'Blocked work', html_url: 'https://github.com/DanAakesen/jarvis/issues/7', body: null,
      state: 'open', updated_at: timestamp, closed_at: null, labels: [],
      issue_dependencies_summary: { blocked_by: 2 },
    }];
    const serve = (dependencies: unknown) => createGitHubFactoryBoardReader(async (input) => {
      const url = String(input);
      if (url.includes('/dependencies/blocked_by')) return new Response(JSON.stringify(dependencies));
      if (url.includes('/pulls?') || url.includes('state=closed')) return new Response('[]');
      return new Response(JSON.stringify(issueBody));
    });
    await expect(serve([{ number: 3 }, { number: 5 }]).read(project.repo, 't', timestamp)).rejects.toThrow();
    await expect(serve([{ number: 3, state: 'open' }]).read(project.repo, 't', timestamp)).rejects.toThrow();
  });

  it('normalises GitHub closed_at (no milliseconds) so the board passes the shared contract', async () => {
    const closedAt = new Date(Date.now() - 1_000).toISOString().replace(/\.\d{3}Z$/u, 'Z');
    const reader = createGitHubFactoryBoardReader(async (input) => {
      const url = String(input);
      if (url.includes('/pulls?')) return new Response('[]');
      const issue = (state: 'open' | 'closed') => ({
        number: state === 'closed' ? 2 : 1, title: `Issue ${state}`, body: null, state,
        html_url: `https://github.com/DanAakesen/jarvis/issues/${state === 'closed' ? 2 : 1}`,
        updated_at: closedAt, closed_at: state === 'closed' ? closedAt : null, labels: [],
        issue_dependencies_summary: { blocked_by: 0 },
      });
      return new Response(JSON.stringify([issue(url.includes('state=closed') ? 'closed' : 'open')]));
    });

    const source = await reader.read(project.repo, 'reader-token', new Date(Date.now() - 14 * 86_400_000).toISOString());
    const closed = source.issues.find(({ number }) => number === 2)!;
    expect(closed.closedAt).toBe(new Date(closedAt).toISOString());
    expect(closed.closedAt).toMatch(/\.\d{3}Z$/u);
    expect(isFactoryBoard(createFactoryBoard(project.id, project.repo, source, [], [], Date.now()))).toBe(true);
  });

  it('marks an expired cached board stale when GitHub refresh fails', async () => {
    let now = 1_000;
    const cache = new FactoryBoardCache(() => now, 10);
    const snapshot = createFactoryBoard(project.id, project.repo, source, [task], [], now);
    await expect(cache.get(project.id, async () => snapshot)).resolves.toEqual({ board: snapshot, stale: false });
    now += 11;
    const failure = new FactoryBoardReadError('source', 'request_failed', 503);
    await expect(cache.get(project.id, async () => { throw failure; })).resolves.toEqual({
      board: snapshot,
      stale: true,
      failure,
    });
  });

  it.each([false, true])('preserves the cause for joined cache failures (cached: %s)', async (cached) => {
    let now = 1_000;
    const cache = new FactoryBoardCache(() => now, 10);
    const board = createFactoryBoard(project.id, project.repo, source, [], [], now);
    if (cached) await cache.get(project.id, async () => board);
    now += 11;
    let reject!: (error: unknown) => void;
    const load = vi.fn(() => new Promise<FactoryBoard>((_resolve, fail) => { reject = fail; }));
    const cachePaths: string[] = [];
    const first = cache.get(project.id, load, (path) => cachePaths.push(path));
    const second = cache.get(project.id, load, (path) => cachePaths.push(path));
    expect(cachePaths).toEqual(['source_load', 'shared_wait']);
    const failure = new FactoryBoardReadError('token', 'invalid_token_lifetime');
    const results = Promise.allSettled([first, second]);
    reject(failure);
    expect(await results).toEqual(cached ? [
      { status: 'fulfilled', value: { board, stale: true, failure } },
      { status: 'fulfilled', value: { board, stale: true, failure } },
    ] : [
      { status: 'rejected', reason: failure }, { status: 'rejected', reason: failure },
    ]);
    expect(load).toHaveBeenCalledOnce();
    await expect(cache.get(project.id, async () => board)).resolves.toEqual({ board, stale: false });
  });
});
