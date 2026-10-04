import type { FastifyReply } from 'fastify';
import type { BackendModule } from '../modules.js';
import { projectRoutes } from './projects.js';
import { taskStates, type TaskState } from './task-lifecycle.js';
import type { CreateTaskInput, RecordTaskEventInput, TaskListFilters } from './task-store.js';

const maxSqlBigInt = 9_223_372_036_854_775_807n;
const maxResponseBytes = 1024 * 1024;
const taskStateSchema = { type: 'string', enum: taskStates };
const idSchema = { type: 'string', pattern: '^[1-9][0-9]{0,18}$', maxLength: 19 };

interface TaskListQuery {
  projectId?: string;
  agent?: 'codex' | 'copilot';
  state?: TaskState;
  createdAfter?: string;
  createdBefore?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

interface TaskDetailQuery {
  eventLimit?: number;
  eventOffset?: number;
}

type SandboxEventInput = Omit<RecordTaskEventInput, 'source'>;

function isSqlBigInt(value: string): boolean {
  return BigInt(value) <= maxSqlBigInt;
}

function sendBounded(reply: FastifyReply, value: unknown) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || Buffer.byteLength(serialized) > maxResponseBytes) {
    return reply.code(413).send({ error: 'Response too large' });
  }
  return reply.send(value);
}

export const factoryModule: BackendModule = {
  id: 'factory',
  tools: [],
  registerRoutes: async (app) => {
    app.post<{ Body: CreateTaskInput }>('/factory/tasks', {
      schema: {
        body: {
          type: 'object',
          properties: {
            projectId: idSchema,
            title: { type: 'string', minLength: 1, maxLength: 200 },
            request: { type: 'string', minLength: 1, maxLength: 50_000 },
            agent: { type: 'string', enum: ['codex', 'copilot'] },
            modelOverride: { type: 'string', minLength: 1, maxLength: 100 },
            reasoningOverride: { type: 'string', minLength: 1, maxLength: 32 },
            priority: { type: 'integer', minimum: -2_147_483_648, maximum: 2_147_483_647 },
          },
          required: ['projectId', 'title', 'request'],
          additionalProperties: false,
        },
      },
    }, async (request, reply) => {
      const store = app.taskStore;
      if (!store) return reply.code(503).send({ error: 'Task service unavailable' });
      if (!isSqlBigInt(request.body.projectId)) return reply.code(400).send({ error: 'Invalid project ID' });
      const task = await store.create(request.body);
      if (!task) return reply.code(404).send({ error: 'Active project not found' });
      const serialized = JSON.stringify(task);
      if (serialized === undefined || Buffer.byteLength(serialized) > maxResponseBytes) {
        return reply.code(413).send({ error: 'Response too large' });
      }
      return reply.code(201).send(task);
    });

    app.get<{ Querystring: TaskListQuery }>('/factory/tasks', {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            projectId: idSchema,
            agent: { type: 'string', enum: ['codex', 'copilot'] },
            state: taskStateSchema,
            createdAfter: { type: 'string', format: 'date-time' },
            createdBefore: { type: 'string', format: 'date-time' },
            search: { type: 'string', minLength: 1, maxLength: 100 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            offset: { type: 'integer', minimum: 0, maximum: 10_000, default: 0 },
          },
          additionalProperties: false,
        },
      },
    }, async (request, reply) => {
      const store = app.taskStore;
      if (!store) return reply.code(503).send({ error: 'Task service unavailable' });
      const query = request.query;
      if (query.projectId !== undefined && !isSqlBigInt(query.projectId)) {
        return reply.code(400).send({ error: 'Invalid project ID' });
      }
      if (query.createdAfter && query.createdBefore &&
        Date.parse(query.createdAfter) >= Date.parse(query.createdBefore)) {
        return reply.code(400).send({ error: 'Invalid creation period' });
      }
      const filters: TaskListFilters = {
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.agent ? { agent: query.agent } : {}),
        ...(query.state ? { state: query.state } : {}),
        ...(query.createdAfter ? { createdAfter: query.createdAfter } : {}),
        ...(query.createdBefore ? { createdBefore: query.createdBefore } : {}),
        ...(query.search ? { search: query.search } : {}),
        limit: query.limit ?? 50,
        offset: query.offset ?? 0,
      };
      return sendBounded(reply, { tasks: await store.list(filters), limit: filters.limit, offset: filters.offset });
    });

    app.get<{ Params: { id: string }; Querystring: TaskDetailQuery }>('/factory/tasks/:id', {
      schema: {
        params: { type: 'object', properties: { id: idSchema }, required: ['id'], additionalProperties: false },
        querystring: {
          type: 'object',
          properties: {
            eventLimit: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
            eventOffset: { type: 'integer', minimum: 0, maximum: 10_000, default: 0 },
          },
          additionalProperties: false,
        },
      },
    }, async (request, reply) => {
      const store = app.taskStore;
      if (!store) return reply.code(503).send({ error: 'Task service unavailable' });
      if (!isSqlBigInt(request.params.id)) return reply.code(400).send({ error: 'Invalid task ID' });
      const detail = await store.get(request.params.id, request.query.eventLimit ?? 100, request.query.eventOffset ?? 0);
      if (!detail) return reply.code(404).send({ error: 'Task not found' });
      return sendBounded(reply, detail);
    });

    app.get('/factory/context', { config: { jarvisAgent: true } }, async (_request, reply) => {
      const store = app.taskStore;
      if (!store) return reply.code(503).send({ error: 'Task service unavailable' });
      return sendBounded(reply, await store.getRunningContext());
    });

    app.post<{ Body: SandboxEventInput }>('/factory/sandbox-events', {
      config: { jarvisRunner: true },
      schema: {
        body: {
          type: 'object',
          properties: {
            taskId: idSchema,
            type: { type: 'string', pattern: '^[a-z][a-z_]{0,63}$', maxLength: 64 },
            summary: { type: ['string', 'null'], maxLength: 2000 },
            payload: { type: 'object' },
          },
          required: ['taskId', 'type'],
          additionalProperties: false,
        },
      },
    }, async (request, reply) => {
      const store = app.taskStore;
      if (!store) return reply.code(503).send({ error: 'Task service unavailable' });
      if (!isSqlBigInt(request.body.taskId)) return reply.code(400).send({ error: 'Invalid task ID' });
      const event = await store.recordEvent({ ...request.body, source: 'runner' });
      return reply.code(201).send({ eventId: event.id });
    });

    await app.register(projectRoutes, { prefix: '/factory/projects' });
  },
};
