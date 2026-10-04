import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { loadEffectiveSettings } from '../core/settings.js';
import type { GitHubRepositoryCatalog, GitHubRepositoryListing } from '../github-app.js';

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly repo: string;
  readonly default_branch: string;
  readonly default_agent: 'codex' | 'copilot';
  readonly policy: 'deliver_pr' | 'complete_without_deployment';
  readonly merge_rules: string | null;
  readonly sandbox_size: '1x2' | '2x4';
  readonly tech: string;
  readonly max_parallel_tasks: number;
  readonly active: boolean;
}

export type ProjectFields = Omit<Project, 'id' | 'active'>;
export type CreateProject = Omit<ProjectFields, 'max_parallel_tasks' | 'merge_rules'> &
  Partial<Pick<ProjectFields, 'max_parallel_tasks' | 'merge_rules'>>;
export type UpdateProject = Partial<ProjectFields>;

export interface ProjectStore {
  list(): Promise<Project[]>;
  create(project: CreateProject): Promise<Project>;
  update(id: string, project: UpdateProject): Promise<Project | null>;
  archive(id: string): Promise<boolean>;
}

export class ProjectConflictError extends Error {
  constructor() { super('Project repository already exists'); }
}

export class RepositoryNotAvailableError extends Error {
  constructor() { super('Repository is not available through the GitHub App installation'); }
}

export class GitHubRepositoryUnavailableError extends Error {
  constructor() { super('GitHub repository service is unavailable'); }
}

export async function manageExistingRepository(
  app: FastifyInstance,
  repositoryName: string,
  catalog: GitHubRepositoryCatalog = app.githubRepositoryCatalog!,
  signal?: AbortSignal,
): Promise<Project> {
  const projectStore = app.projectStore;
  const settingsStore = app.settingsStore;
  if (!projectStore || !settingsStore || !catalog) throw new Error('Repository management is unavailable');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repositoryName)) {
    throw new RepositoryNotAvailableError();
  }
  const settings = await loadEffectiveSettings(settingsStore);
  let listing: GitHubRepositoryListing;
  try {
    listing = await catalog.list(settings.newProjects.owner);
  } catch {
    throw new GitHubRepositoryUnavailableError();
  }
  const repository = listing.repositories.find((item) => item.fullName.toLowerCase() === repositoryName.toLowerCase());
  if (!repository) throw new RepositoryNotAvailableError();
  let tech: string;
  try {
    tech = await catalog.detectTech(repository);
  } catch {
    throw new GitHubRepositoryUnavailableError();
  }
  signal?.throwIfAborted();
  return projectStore.create({
    name: repository.name,
    repo: repository.fullName,
    default_branch: repository.defaultBranch,
    default_agent: settings.newProjects.defaultAgent,
    policy: settings.newProjects.policy,
    merge_rules: null,
    sandbox_size: '1x2',
    tech,
    max_parallel_tasks: settings.newProjects.maxParallelTasks,
  });
}

const projectFields = {
  name: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
  repo: { type: 'string', minLength: 3, maxLength: 140, pattern: '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$(?![\\s\\S])' },
  default_branch: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
  default_agent: { type: 'string', enum: ['codex', 'copilot'] },
  policy: { type: 'string', enum: ['deliver_pr', 'complete_without_deployment'] },
  merge_rules: { anyOf: [{ type: 'string', maxLength: 4000 }, { type: 'null' }] },
  sandbox_size: { type: 'string', enum: ['1x2', '2x4'] },
  tech: { type: 'string', minLength: 1, maxLength: 32, pattern: '^[a-z][a-z0-9_.-]*$(?![\\s\\S])' },
  max_parallel_tasks: { type: 'integer', minimum: 1, maximum: 2147483647 },
} as const;

const createSchema = {
  body: {
    type: 'object',
    properties: projectFields,
    required: ['name', 'repo', 'default_branch', 'default_agent', 'policy', 'sandbox_size', 'tech'],
    additionalProperties: false,
  },
} as const;

const updateSchema = {
  params: { type: 'object', properties: { id: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } }, required: ['id'], additionalProperties: false },
  body: {
    type: 'object',
    properties: projectFields,
    minProperties: 1,
    additionalProperties: false,
  },
} as const;

const idSchema = {
  params: { type: 'object', properties: { id: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } }, required: ['id'], additionalProperties: false },
} as const;

function isValidId(id: string): boolean {
  return id.length < 19 || (id.length === 19 && id <= '9223372036854775807');
}

function validateBodyProperties(allowed: readonly string[], widths: Readonly<Record<string, number>>) {
  return async (request: { body: unknown }, reply: { code(statusCode: number): { send(payload: unknown): unknown } }) => {
    if (typeof request.body === 'object' && request.body !== null && !Array.isArray(request.body)) {
      const fields = Object.entries(request.body);
      if (fields.some(([key]) => !allowed.includes(key)) ||
        fields.some(([key, value]) => typeof value === 'string' && value.length > (widths[key] ?? Number.POSITIVE_INFINITY))) {
        return reply.code(400).send({ error: 'Invalid request' });
      }
    }
  };
}

const stringWidths = { name: 100, repo: 140, default_branch: 255, merge_rules: 4000, tech: 32 };

function storeOrUnavailable(store: ProjectStore | null, reply: { code(statusCode: number): { send(payload: unknown): unknown } }): ProjectStore | null {
  if (!store) {
    reply.code(503).send({ error: 'Service unavailable' });
    return null;
  }
  return store;
}

export const projectRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (_request, reply) => {
    const store = storeOrUnavailable(app.projectStore, reply);
    if (!store) return;
    return store.list();
  });

  app.post<{ Body: CreateProject }>('/', {
    schema: createSchema,
    preValidation: validateBodyProperties(Object.keys(projectFields), stringWidths),
  }, async (request, reply) => {
    const store = storeOrUnavailable(app.projectStore, reply);
    if (!store) return;
    try {
      const project = await store.create(request.body);
      return reply.code(201).header('Location', `/factory/projects/${project.id}`).send(project);
    } catch (error) {
      if (error instanceof ProjectConflictError) return reply.code(409).send({ error: 'Project repository already exists' });
      throw error;
    }
  });

  app.post<{ Body: { repository: string } }>('/manage', {
    schema: {
      body: {
        type: 'object',
        properties: {
          repository: { type: 'string', minLength: 3, maxLength: 140, pattern: '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' },
        },
        required: ['repository'],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (!app.projectStore || !app.settingsStore || !app.githubRepositoryCatalog) {
      return reply.code(503).send({ error: 'Repository management unavailable' });
    }
    try {
      const project = await manageExistingRepository(app, request.body.repository);
      return reply.code(201).header('Location', `/factory/projects/${project.id}`).send(project);
    } catch (error) {
      if (error instanceof RepositoryNotAvailableError) return reply.code(404).send({ error: 'Repository not available' });
      if (error instanceof ProjectConflictError) return reply.code(409).send({ error: 'Project repository already exists' });
      if (error instanceof GitHubRepositoryUnavailableError) {
        request.log.warn('github.repository_management_failed');
        return reply.code(502).send({ error: 'GitHub repository service unavailable' });
      }
      throw error;
    }
  });

  app.patch<{ Params: { id: string }; Body: UpdateProject }>('/:id', {
    schema: updateSchema,
    preValidation: validateBodyProperties(Object.keys(projectFields), stringWidths),
  }, async (request, reply) => {
    if (!isValidId(request.params.id)) return reply.code(400).send({ error: 'Invalid request' });
    const store = storeOrUnavailable(app.projectStore, reply);
    if (!store) return;
    try {
      const project = await store.update(request.params.id, request.body);
      if (!project) return reply.code(404).send({ error: 'Not found' });
      return project;
    } catch (error) {
      if (error instanceof ProjectConflictError) return reply.code(409).send({ error: 'Project repository already exists' });
      throw error;
    }
  });

  app.delete<{ Params: { id: string } }>('/:id', { schema: idSchema }, async (request, reply) => {
    if (!isValidId(request.params.id)) return reply.code(400).send({ error: 'Invalid request' });
    const store = storeOrUnavailable(app.projectStore, reply);
    if (!store) return;
    if (!await store.archive(request.params.id)) return reply.code(404).send({ error: 'Not found' });
    return reply.code(204).send();
  });
};
