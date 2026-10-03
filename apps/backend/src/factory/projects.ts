import type { FastifyPluginAsync } from 'fastify';

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
