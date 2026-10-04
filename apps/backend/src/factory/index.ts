import type { FastifyReply } from 'fastify';
import type { BackendModule } from '../modules.js';
import { projectRoutes } from './projects.js';
import { taskStates, type TaskState } from './task-lifecycle.js';
import type {
  CreateTaskInput, RecordTaskEventInput, TaskControlCommand, TaskEventMessage, TaskListFilters,
} from './task-store.js';

const maxSqlBigInt = 9_223_372_036_854_775_807n;
const maxResponseBytes = 1024 * 1024;
const eventReplayPageSize = 200;
const maxPendingEvents = 1000;
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

    app.post<{ Params: { id: string }; Body: { action: string; message?: string } }>('/factory/tasks/:id/controls', {
      schema: {
        params: { type: 'object', properties: { id: idSchema }, required: ['id'], additionalProperties: false },
        body: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['steer', 'pause', 'resume', 'cancel'] },
            message: { type: 'string', minLength: 1, maxLength: 65_536 },
          },
          required: ['action'],
          additionalProperties: false,
          allOf: [{
            if: { properties: { action: { const: 'steer' } }, required: ['action'] },
            then: { required: ['message'] },
            else: { not: { required: ['message'] } },
          }],
        },
      },
    }, async (request, reply) => {
      const controller = app.taskController;
      if (!controller) return reply.code(503).send({ error: 'Task controls are unavailable' });
      if (!isSqlBigInt(request.params.id)) return reply.code(400).send({ error: 'Invalid task ID' });
      if (request.body.action === 'steer' && !request.body.message?.trim()) {
        return reply.code(400).send({ error: 'Steering message cannot be empty' });
      }
      const result = await controller.control(request.params.id, request.body as TaskControlCommand);
      if (result.kind === 'not-found') return reply.code(404).send({ error: 'Task not found' });
      if (result.kind === 'invalid-transition') return reply.code(409).send({ error: 'Task state does not allow this action' });
      if (result.kind === 'unavailable') return reply.code(503).send({ error: 'Task runtime is unavailable' });
      if (result.kind === 'failed') return reply.code(502).send({ error: 'Task control could not be completed' });
      return sendBounded(reply, result.task);
    });

    app.post<{ Params: { id: string } }>('/factory/tasks/:id/github-token', {
      config: { jarvisRunner: true },
      schema: {
        params: { type: 'object', properties: { id: idSchema }, required: ['id'], additionalProperties: false },
      },
    }, async (request, reply) => {
      const store = app.taskStore;
      const tokenIssuer = app.githubAppTokenIssuer;
      if (!store || !tokenIssuer) return reply.code(503).send({ error: 'GitHub token service unavailable' });
      if (!isSqlBigInt(request.params.id)) return reply.code(400).send({ error: 'Invalid task ID' });
      const sessionHeaderCount = request.raw.rawHeaders.filter((_value, index) =>
        index % 2 === 0 && request.raw.rawHeaders[index]?.toLowerCase() === 'x-jarvis-session-id').length;
      const foundrySessionId = request.headers['x-jarvis-session-id'];
      if (sessionHeaderCount !== 1 || typeof foundrySessionId !== 'string' ||
        !/^[A-Za-z0-9_.:-]{1,255}$/u.test(foundrySessionId)) {
        return reply.code(400).send({ error: 'Invalid runner session ID' });
      }
      const repository = await store.getActiveRepository(request.params.id, foundrySessionId);
      if (!repository) return reply.code(404).send({ error: 'Task not found' });
      try {
        const token = await tokenIssuer.issue(repository);
        return reply.header('Cache-Control', 'no-store').send({ token, repository });
      } catch {
        request.log.warn('github.installation_token_failed');
        return reply.code(502).send({ error: 'GitHub token unavailable' });
      }
    });

    app.get<{ Params: { id: string } }>('/factory/tasks/:id/events', {
      schema: {
        params: { type: 'object', properties: { id: idSchema }, required: ['id'], additionalProperties: false },
      },
    }, async (request, reply) => {
      const store = app.taskStore;
      if (!store) return reply.code(503).send({ error: 'Task service unavailable' });
      const taskId = request.params.id;
      if (!isSqlBigInt(taskId)) return reply.code(400).send({ error: 'Invalid task ID' });

      const headerCount = request.raw.rawHeaders.filter((_value, index) =>
        index % 2 === 0 && request.raw.rawHeaders[index]?.toLowerCase() === 'last-event-id').length;
      const rawEventId = request.headers['last-event-id'];
      if (headerCount > 1 || (rawEventId !== undefined && typeof rawEventId !== 'string') ||
        (typeof rawEventId === 'string' && !/^(?:0|[1-9][0-9]{0,18})$/.test(rawEventId))) {
        return reply.code(400).send({ error: 'Invalid event ID' });
      }
      const afterEventId = rawEventId ?? '0';
      if (BigInt(afterEventId) > maxSqlBigInt) return reply.code(400).send({ error: 'Invalid event ID' });
      if (!await store.get(taskId, 1, 0)) return reply.code(404).send({ error: 'Task not found' });

      const response = reply.raw;
      let closed = false;
      let replaying = true;
      let pending: TaskEventMessage[] = [];
      const replayedIds = new Set<string>();
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
      };
      const end = () => {
        cleanup();
        if (!response.writableEnded) response.end();
      };
      const writeEvent = (event: TaskEventMessage) => {
        if (closed || BigInt(event.id) <= BigInt(afterEventId) || replayedIds.has(event.id)) return !closed;
        replayedIds.add(event.id);
        if (!response.write(`id: ${event.id}\nevent: task\ndata: ${JSON.stringify(event)}\n\n`)) {
          end();
          return false;
        }
        return true;
      };
      const unsubscribe = app.eventHub.subscribe((event) => {
        if (event.taskId !== taskId || closed) return;
        if (replaying) {
          if (pending.length >= maxPendingEvents) {
            end();
            return;
          }
          pending.push(event);
        } else {
          writeEvent(event);
        }
      });
      reply.hijack();
      const heartbeat = setInterval(() => {
        if (!response.write(': heartbeat\n\n')) end();
      }, 25_000);
      response.once('close', cleanup);
      response.once('error', end);
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      response.flushHeaders();

      const replay = async () => {
        let cursor = afterEventId;
        while (!closed) {
          const events = await store.getEventsAfter(taskId, cursor, eventReplayPageSize);
          if (!events.length) break;
          for (const event of events) {
            if (closed) return;
            if (!writeEvent(event)) return;
            cursor = event.id;
          }
          if (events.length < eventReplayPageSize) break;
        }
        if (closed) return;
        replaying = false;
        const buffered = pending.sort((left, right) =>
          BigInt(left.id) < BigInt(right.id) ? -1 : BigInt(left.id) > BigInt(right.id) ? 1 : 0);
        pending = [];
        for (const event of buffered) {
          if (!writeEvent(event)) return;
        }
      };
      void replay().catch(end);
      return reply;
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
