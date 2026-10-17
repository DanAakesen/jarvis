import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFactoryBoard, type FactoryBoard } from '@jarvis/contracts';
import { FactoryBoardCache, registerFactoryBoardRoute, type FactoryBoardSource } from './board.js';
import { FactoryBoardReadError } from './board-errors.js';
import type { Project } from './projects.js';
import type { TaskStore } from './task-store.js';
import type { ReleaseViewStore } from './release-view.js';

const project: Project = {
  id: '42', name: 'Jarvis', description: null, repo: 'DanAakesen/jarvis', default_branch: 'main',
  default_agent: 'codex', policy: 'deliver_pr', merge_rules: null, sandbox_size: '1x2', tech: 'node',
  max_parallel_tasks: 1, active: true,
};
const source: FactoryBoardSource = {
  issues: [{
    number: 7, url: 'https://github.com/DanAakesen/jarvis/issues/7', title: 'Validated snapshot',
    taskCode: null, labels: [], worker: null, state: 'open', updatedAt: '2026-10-08T00:00:00.000Z',
    closedAt: null, blockedBy: [], blockedByCount: 0, body: null,
  }],
  pullRequests: [],
};
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe.each(['task', 'release'] as const)('Factory direct-route %s branch ownership', (stage) => {
  it.each([false, true])('awaits its sibling and preserves the first cause (fallback: %s)', async (cached) => {
    // Exercise the real route/cache, not buildApp middleware or publisher composition.
    const app = Fastify({ logger: false });
    apps.push(app);
    const initial = Promise.withResolvers<FactoryBoardSource>();
    const reader = vi.fn(async () => source);
    const taskList = vi.fn<TaskStore['list']>().mockResolvedValue([]);
    const releaseRead = vi.fn<ReleaseViewStore['read']>().mockResolvedValue({
      releases: [], pullRequests: [], workflowRuns: [], deployments: [],
    });
    app.decorate('factoryBoardCache', new FactoryBoardCache());
    app.decorate('factoryBoardReader', { read: reader });
    app.decorate('projectStore', { list: vi.fn(async () => [project]) });
    app.decorate('taskStore', { list: taskList });
    app.decorate('releaseViewStore', { read: releaseRead });
    app.decorate('githubAppTokenIssuer', { issueForRepositoryRead: vi.fn(async () => 'offline-read-token') });
    const warn = vi.fn();
    const info = vi.fn();
    app.addHook('onRequest', async (request) => {
      request.log.warn = warn;
      request.log.info = info;
    });
    registerFactoryBoardRoute(app);
    const previous = cached ? (await app.inject('/factory/board?project=42')).json<FactoryBoard>() : undefined;
    app.factoryBoardCache.invalidateAll();
    info.mockClear();
    const initialCalls = reader.mock.calls.length;
    reader.mockImplementationOnce(() => initial.promise);
    const failure = new FactoryBoardReadError(stage, 'request_failed', 503);
    if (stage === 'task') taskList.mockRejectedValueOnce(failure);
    else releaseRead.mockRejectedValueOnce(failure);
    const cacheRead = vi.spyOn(app.factoryBoardCache, 'get');
    const first = app.inject('/factory/board?project=42');
    let second: ReturnType<typeof app.inject> | undefined;
    try {
      await vi.waitFor(() => expect(info).toHaveBeenCalledWith(
        expect.objectContaining({ stage }), 'factory.board_phase',
      ));
      app.factoryBoardCache.invalidateAll();
      second = app.inject('/factory/board?project=42');
      await vi.waitFor(() => expect(cacheRead).toHaveBeenCalledTimes(2));
      expect(reader).toHaveBeenCalledTimes(initialCalls + 1);
      expect(warn).not.toHaveBeenCalled();
      initial.resolve(source);
      const responses = await Promise.all([first, second]);
      expect(responses.map(({ statusCode }) => statusCode)).toEqual(cached ? [200, 200] : [502, 502]);
      if (cached) {
        for (const response of responses) {
          expect(response.json()).toEqual({ ...previous, stale: true });
          expect(isFactoryBoard(response.json())).toBe(true);
        }
      }
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith(expect.objectContaining({
        stage, reason: 'request_failed', status: 503, stale: cached,
      }), 'factory.board_read_failed');
      const shared = cacheRead.mock.results[0];
      if (!shared || shared.type !== 'return') throw new Error('Cache request did not return a promise');
      if (cached) expect((await shared.value).failure).toBe(failure);
      else await expect(shared.value).rejects.toBe(failure);
      const recovered = await app.inject('/factory/board?project=42');
      expect(recovered.statusCode).toBe(200);
      expect(recovered.json().stale).toBe(false);
      expect(isFactoryBoard(recovered.json())).toBe(true);
      expect(reader).toHaveBeenCalledTimes(initialCalls + 2);
    } finally {
      initial.resolve(source);
      await Promise.allSettled([first, ...(second ? [second] : [])]);
    }
  });
});
