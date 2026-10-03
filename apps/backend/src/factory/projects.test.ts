import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { ProjectConflictError, type Project, type ProjectStore } from './projects.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = { authorization: ['Bearer', ['test', 'token', 'signature'].join('.')].join(' ') };
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

const project: Project = {
  id: '42', name: 'Jarvis', repo: 'DanAakesen/jarvis', default_branch: 'main', default_agent: 'copilot',
  policy: 'deliver_pr', merge_rules: null, sandbox_size: '1x2', tech: 'node', max_parallel_tasks: 1, active: true,
};

function fixture(store: ProjectStore | null = {
  list: vi.fn(async () => [project]),
  create: vi.fn(async (input) => ({ ...project, ...input })),
  update: vi.fn(async (id, input) => id === project.id ? { ...project, ...input } : null),
  archive: vi.fn(async (id) => id === project.id),
}) {
  const app = buildApp(config, undefined, {
    projectStore: store ?? undefined,
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }),
  });
  apps.push(app);
  return app;
}

const validInput = {
  name: 'Jarvis', repo: 'DanAakesen/jarvis', default_branch: 'main', default_agent: 'copilot',
  policy: 'deliver_pr', sandbox_size: '1x2', tech: 'node',
};

describe('projects API', () => {
  it('lists projects and requires authentication', async () => {
    const app = fixture();
    expect((await app.inject({ url: '/factory/projects', headers })).json()).toEqual([project]);
    expect((await app.inject({ url: '/factory/projects' })).statusCode).toBe(401);
  });

  it('creates a project with defaults and returns its resource location', async () => {
    const app = fixture();
    const response = await app.inject({ method: 'POST', url: '/factory/projects', headers, payload: validInput });
    expect(response.statusCode).toBe(201);
    expect(response.headers.location).toBe('/factory/projects/42');
    expect(response.json()).toEqual({ ...project, ...validInput });
  });

  it('accepts supported policy, sandbox, repository, tech, and concurrency values', async () => {
    const app = fixture();
    const response = await app.inject({
      method: 'POST', url: '/factory/projects', headers,
      payload: {
        ...validInput, repo: 'dan-aakesen/my-site.web_1', policy: 'complete_without_deployment',
        sandbox_size: '2x4', tech: 'dotnet-8', max_parallel_tasks: 2147483647,
      },
    });
    expect(response.statusCode).toBe(201);
  });

  it.each([
    ['repository shape', { repo: 'not-a-repo' }],
    ['empty repository owner', { repo: '/jarvis' }],
    ['multiple repository separators', { repo: 'DanAakesen/org/jarvis' }],
    ['repository characters', { repo: 'DanAakesen/jarvis!' }],
    ['repository newline', { repo: 'DanAakesen/jarvis\n' }],
    ['repository maximum length', { repo: `${'a'.repeat(139)}/b` }],
    ['blank name', { name: '   ' }],
    ['blank branch', { default_branch: '   ' }],
    ['UTF-16 name storage width', { name: '😀'.repeat(51) }],
    ['policy vocabulary', { policy: 'auto_merge' }],
    ['sandbox size vocabulary', { sandbox_size: '4x8' }],
    ['tech format', { tech: 'Node.js' }],
    ['tech newline', { tech: 'node\n' }],
    ['tech maximum length', { tech: `a${'b'.repeat(32)}` }],
    ['max parallel minimum', { max_parallel_tasks: 0 }],
    ['max parallel integer', { max_parallel_tasks: 1.5 }],
    ['max parallel maximum', { max_parallel_tasks: 2147483648 }],
  ])('rejects invalid %s before persistence', async (_rule, field) => {
    const app = fixture();
    const response = await app.inject({ method: 'POST', url: '/factory/projects', headers, payload: { ...validInput, ...field } });
    expect(response.statusCode).toBe(400);
  });

  it('rejects missing and unknown fields', async () => {
    const app = fixture();
    expect((await app.inject({
      method: 'POST', url: '/factory/projects', headers,
      payload: Object.fromEntries(Object.entries(validInput).filter(([key]) => key !== 'name')),
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'POST', url: '/factory/projects', headers, payload: { ...validInput, active: false },
    })).statusCode).toBe(400);
  });

  it('updates only provided project settings and rejects invalid updates', async () => {
    const app = fixture();
    const response = await app.inject({
      method: 'PATCH', url: '/factory/projects/42', headers, payload: { max_parallel_tasks: 4 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ...project, max_parallel_tasks: 4 });
    expect((await app.inject({
      method: 'PATCH', url: '/factory/projects/42', headers, payload: { tech: 'Invalid Tech' },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'PATCH', url: '/factory/projects/42', headers, payload: {},
    })).statusCode).toBe(400);
  });

  it('returns conflict for a duplicate repository and handles missing projects', async () => {
    const store = {
      list: vi.fn(async () => []),
      create: vi.fn(async () => { throw new Error('duplicate'); }),
      update: vi.fn(async () => null),
      archive: vi.fn(async () => false),
    };
    const app = fixture(store);
    expect((await app.inject({ method: 'PATCH', url: '/factory/projects/404', headers, payload: { name: 'Missing' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/factory/projects/404', headers })).statusCode).toBe(404);
    const duplicate = fixture({
      ...store,
      create: vi.fn(async () => { throw new ProjectConflictError(); }),
      update: vi.fn(async () => { throw new ProjectConflictError(); }),
    });
    expect((await duplicate.inject({ method: 'POST', url: '/factory/projects', headers, payload: validInput })).statusCode).toBe(409);
    expect((await duplicate.inject({
      method: 'PATCH', url: '/factory/projects/42', headers, payload: { repo: 'DanAakesen/other' },
    })).statusCode).toBe(409);
  });

  it('archives a project and refuses malformed or out-of-range IDs', async () => {
    const app = fixture();
    expect((await app.inject({ method: 'DELETE', url: '/factory/projects/42', headers })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: '/factory/projects/0', headers })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: '/factory/projects/9223372036854775808', headers })).statusCode).toBe(400);
  });

  it('reports unavailable storage without returning a false success', async () => {
    const app = fixture(null);
    const response = await app.inject({ url: '/factory/projects', headers });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Service unavailable' });
  });
});
