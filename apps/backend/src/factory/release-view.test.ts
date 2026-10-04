import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { ProjectStore } from './projects.js';
import type { ReleaseGraphReader, ReleaseViewStore } from './release-view.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = { authorization: `${['Bear', 'er'].join('')} ${['test', 'token', 'signature'].join('.')}` };
const project = {
  id: '42',
  name: 'Jarvis',
  repo: 'DanAakesen/jarvis',
  default_branch: 'main',
  default_agent: 'copilot' as const,
  policy: 'deliver_pr' as const,
  merge_rules: null,
  sandbox_size: '1x2' as const,
  tech: 'node',
  max_parallel_tasks: 1,
  active: true,
};
const records = {
  releases: [{
    id: '7', version: '18', sha: 'a'.repeat(40), status: 'released' as const,
    createdAt: '2026-10-04T11:00:00.000Z', releasedAt: '2026-10-04T11:15:00.000Z',
  }],
  pullRequests: [],
  workflowRuns: [],
  deployments: [],
};
const graph = { fetchedAt: '2026-10-04T12:00:00.000Z', truncated: false, branches: [], commits: [] };
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function fixture(options: {
  projectStore?: ProjectStore;
  releaseViewStore?: ReleaseViewStore;
  releaseGraphReader?: ReleaseGraphReader;
} = {}) {
  const app = buildApp(config, undefined, {
    projectStore: options.projectStore ?? {
      list: vi.fn(async () => [project]),
      create: vi.fn(),
      update: vi.fn(),
      archive: vi.fn(),
    },
    releaseViewStore: options.releaseViewStore ?? {
      read: vi.fn(async () => records),
      projectForRelease: vi.fn(async () => '42'),
    },
    releaseGraphReader: options.releaseGraphReader ?? { read: vi.fn(async () => graph) },
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }),
  });
  apps.push(app);
  return app;
}

describe('project release view API', () => {
  it('returns stored release records and fetches the graph on demand', async () => {
    const releaseViewStore = { read: vi.fn(async () => records), projectForRelease: vi.fn(async () => '42') };
    const releaseGraphReader = { read: vi.fn(async () => graph) };
    const app = fixture({ releaseViewStore, releaseGraphReader });

    const response = await app.inject({ url: '/factory/projects/42/releases', headers });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      project: { id: '42', name: 'Jarvis', repo: 'DanAakesen/jarvis', defaultBranch: 'main' },
      ...records,
      graph,
    });
    expect(releaseViewStore.read).toHaveBeenCalledWith('42');
    expect(releaseGraphReader.read).toHaveBeenCalledWith('DanAakesen/jarvis', 'main');
  });

  it('resolves a release activity link to its owning project', async () => {
    const releaseViewStore = { read: vi.fn(async () => records), projectForRelease: vi.fn(async () => '42') };
    const app = fixture({ releaseViewStore });

    const response = await app.inject({ url: '/factory/releases/7', headers });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ projectId: '42' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(releaseViewStore.projectForRelease).toHaveBeenCalledWith('7');
  });

  it('requires authentication, validates project IDs, and hides unregistered projects', async () => {
    const app = fixture({ projectStore: {
      list: vi.fn(async () => []),
      create: vi.fn(),
      update: vi.fn(),
      archive: vi.fn(),
    } });

    expect((await app.inject({ url: '/factory/projects/42/releases' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/factory/projects/0/releases', headers })).statusCode).toBe(400);
    expect((await app.inject({ url: '/factory/projects/43/releases', headers })).statusCode).toBe(404);
  });

  it('keeps persisted release data available when the on-demand graph is unavailable', async () => {
    const app = fixture({ releaseGraphReader: { read: vi.fn(async () => { throw new Error('GitHub unavailable'); }) } });

    const response = await app.inject({ url: '/factory/projects/42/releases', headers });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ releases: records.releases, graph: null });
  });
});
