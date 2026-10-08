import type { FastifyReply } from 'fastify';
import type { BackendModule } from '../modules.js';
import { ToolRefusal } from '../core/tool-registry.js';
import { readSettings } from '../core/settings.js';
import { workspaceContext } from '../core/workspace-context.js';
import { sseHeaders } from '../core/now.js';
import { writeSseEvent } from '../core/sse.js';
import {
  GitHubRepositoryUnavailableError,
  ProjectConflictError,
  RepositoryNotAvailableError,
  manageExistingRepository,
  projectRoutes,
} from './projects.js';
import { createProjectTool } from './new-project.js';
import { taskStates, type TaskState } from './task-lifecycle.js';
import type {
  CreateTaskInput, RecordTaskEventInput, TaskControlCommand, TaskEventMessage, TaskListFilters,
} from './task-store.js';
import { factoryTools } from './tools.js';
import { repositoryTools } from './repository-tools.js';
import { registerReleaseViewRoutes } from './release-view.js';
import {
  createJarvisIssue,
  backfillFactoryTaskIssues,
  IssueCreationPartialError,
  IssueDraftValidationError,
  IssueWriteUncertainError,
  startIssueTask,
} from './issues.js';
import { registerFactoryBoardRoute } from './board.js';

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
  tools: [...factoryTools, ...repositoryTools, createProjectTool, {
    name: 'manage_repository',
    description: 'Register an existing repository from the GitHub App installation using the New projects defaults. ' +
      'Only after Dan has confirmed adding it; check list_projects first. Returns alreadyAdded when it is already a project.',
    inputSchema: {
      type: 'object',
      properties: {
        repository: { type: 'string', minLength: 3, maxLength: 140, pattern: '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' },
      },
      required: ['repository'],
      additionalProperties: false,
    },
    execute: async (input, request, signal) => {
      try {
        return await manageExistingRepository(request.server, (input as { repository: string }).repository, undefined, signal);
      } catch (error) {
        if (error instanceof ProjectConflictError) {
          const repository = (input as { repository: string }).repository.toLowerCase();
          const existing = (await request.server.projectStore?.list() ?? [])
            .find((project) => project.repo.toLowerCase() === repository);
          return {
            alreadyAdded: true,
            project: existing ? { id: String(existing.id), name: existing.name, repo: existing.repo } : null,
            confirmation: existing
              ? `${existing.repo} is already added as project "${existing.name}" (ID ${existing.id}); nothing was changed.`
              : 'That repository is already managed by Jarvis; nothing was changed.',
          };
        }
        if (error instanceof RepositoryNotAvailableError) throw new ToolRefusal('That repository is not available in the GitHub App installation.');
        if (error instanceof GitHubRepositoryUnavailableError) throw error;
        throw error;
      }
    },
  }],
  registerRoutes: async (app) => {
    registerReleaseViewRoutes(app);
    registerFactoryBoardRoute(app);
    app.get<{ Querystring: { refresh?: boolean } }>('/factory/repositories', {
      schema: {
        querystring: {
          type: 'object',
          properties: { refresh: { type: 'boolean', default: false } },
          additionalProperties: false,
        },
      },
    }, async (request, reply) => {
      const catalog = app.githubRepositoryCatalog;
      const settingsStore = app.settingsStore;
      if (!catalog || !settingsStore) return reply.code(503).send({ error: 'GitHub repository service unavailable' });
      const settings = await readSettings(settingsStore);
      try {
        const listing = await catalog.list(settings.newProjects.owner, request.query.refresh ?? false);
        return sendBounded(reply.header('Cache-Control', 'no-store'), listing);
      } catch {
        request.log.warn('github.repository_list_failed');
        return reply.code(502).send({ error: 'GitHub repository service unavailable' });
      }
    });

    app.post<{ Body: { project: string; title: string; body: string; executor?: 'jarvis' | 'copilot' | 'none' } }>(
      '/factory/issues',
      {
        schema: {
          body: {
            type: 'object',
            properties: {
              project: { type: 'string', minLength: 1, maxLength: 140 },
              title: { type: 'string', minLength: 1, maxLength: 200 },
              body: { type: 'string', minLength: 1, maxLength: 50_000 },
              executor: { type: 'string', enum: ['jarvis', 'copilot', 'none'] },
            },
            required: ['project', 'title', 'body'],
            additionalProperties: false,
          },
        },
      },
      async (request, reply) => {
        if (!app.projectStore || !app.githubIssueClient) {
          return reply.code(503).send({ error: 'GitHub issue service unavailable' });
        }
        try {
          const issue = await createJarvisIssue({
            ...request.body,
            projects: app.projectStore,
            github: app.githubIssueClient,
          });
          return reply.code(201).send(issue);
        } catch (error) {
          if (error instanceof IssueDraftValidationError) {
            return reply.code(400).send({ error: 'Issue title or body is invalid or contains a secret' });
          }
          if (error instanceof ToolRefusal) return reply.code(404).send({ error: error.message });
          if (error instanceof IssueCreationPartialError) {
            request.log.warn('factory.issue_executor_handoff_failed');
            return reply.code(502).send({
              error: 'The issue was created but its executor handoff could not be confirmed; check the issue before retrying',
              number: error.issue.number,
              url: error.issue.url,
              taskCode: error.taskCode,
            });
          }
          if (error instanceof IssueWriteUncertainError) {
            request.log.warn('factory.issue_create_outcome_uncertain');
            return reply.code(502).send({
              error: 'Could not confirm issue creation; check the repository before retrying',
            });
          }
          request.log.warn('factory.issue_create_failed');
          return reply.code(app.githubIssueClient ? 502 : 503)
            .send({ error: 'GitHub issue service unavailable' });
        }
      },
    );

    app.post('/factory/tasks/backfill-issues', async (request, reply) => {
      if (!app.taskStore || !app.projectStore || !app.githubIssueClient) {
        return reply.code(503).send({ error: 'Issue task service unavailable' });
      }
      try {
        const results = await backfillFactoryTaskIssues({
          tasks: app.taskStore,
          projects: app.projectStore,
          github: app.githubIssueClient,
        });
        const linked = results.filter(({ status }) => status === 'linked').length;
        const failed = results.length - linked;
        return sendBounded(reply, {
          processed: results.length,
          linked,
          failed,
          results,
        });
      } catch {
        request.log.warn('factory.issue_backfill_failed');
        return reply.code(502).send({ error: 'Factory issue backfill could not be completed' });
      }
    });

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

    app.post<{ Params: { id: string } }>('/factory/tasks/:id/retry', {
      schema: {
        params: { type: 'object', properties: { id: idSchema }, required: ['id'], additionalProperties: false },
      },
    }, async (request, reply) => {
      const store = app.taskStore;
      if (!store) return reply.code(503).send({ error: 'Task service unavailable' });
      if (!isSqlBigInt(request.params.id)) return reply.code(400).send({ error: 'Invalid task ID' });
      const result = await store.retry(request.params.id);
      if (result.kind === 'not-found') return reply.code(404).send({ error: 'Task not found' });
      if (result.kind !== 'ok') {
        return reply.code(409).send({ error: 'Only failed start attempts without sandbox history can be retried; use Recover for tasks that ran' });
      }
      return sendBounded(reply, result.task);
    });

    app.post<{ Params: { id: string }; Body: { action: string; message?: string } }>('/factory/tasks/:id/controls', {
      schema: {
        params: { type: 'object', properties: { id: idSchema }, required: ['id'], additionalProperties: false },
        body: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['steer', 'pause', 'resume', 'cancel', 'recover'] },
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
      let eventDelivery = Promise.resolve();
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
        if (!writeSseEvent(response, { event: 'task', id: event.id, data: event })) {
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
          return;
        }
        eventDelivery = eventDelivery.then(async () => {
          try {
            if (((await app.awayModeStore?.read())?.mode ?? 'present') !== 'present') return;
            if (closed) return;
            writeEvent(event);
          } catch {
            end();
          }
        });
      });
      reply.hijack();
      const heartbeat = setInterval(() => {
        if (!response.write(': heartbeat\n\n')) end();
      }, 25_000);
      response.once('close', cleanup);
      response.once('error', end);
      response.writeHead(200, {
        ...sseHeaders(reply),
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
        while (pending.length) {
          const away = ((await app.awayModeStore?.read())?.mode ?? 'present') !== 'present';
          const buffered = pending.sort((left, right) =>
            BigInt(left.id) < BigInt(right.id) ? -1 : BigInt(left.id) > BigInt(right.id) ? 1 : 0);
          pending = [];
          if (!away) {
            for (const event of buffered) {
              if (!writeEvent(event)) return;
            }
          }
        }
        replaying = false;
        if (!writeSseEvent(response, { event: 'ready', data: {} })) end();
      };
      void replay().catch(end);
      return reply;
    });

    app.get('/factory/context', { config: { jarvisAgent: true } }, async (_request, reply) => {
      const store = app.taskStore;
      if (!store) return reply.code(503).send({ error: 'Task service unavailable' });
      return sendBounded(reply, {
        ...await store.getRunningContext(),
        workspaceContext: workspaceContext(app.workspaceCommands.snapshot(app.ownerObjectId)),
      });
    });

    app.post<{ Params: { number: string }; Body: { project?: string } }>('/factory/issues/:number/start', {
      schema: {
        params: {
          type: 'object',
          properties: { number: idSchema },
          required: ['number'],
          additionalProperties: false,
        },
        body: {
          type: 'object',
          properties: { project: { type: 'string', minLength: 1, maxLength: 140 } },
          additionalProperties: false,
        },
      },
    }, async (request, reply) => {
      const issueNumber = Number(request.params.number);
      if (!Number.isSafeInteger(issueNumber) || issueNumber > 2_147_483_647) {
        return reply.code(400).send({ error: 'Invalid issue number' });
      }
      try {
        const result = await startIssueTask({
          projects: app.projectStore,
          tasks: app.taskStore,
          github: app.githubIssueClient,
          issue: issueNumber,
          ...(request.body?.project ? { project: request.body.project } : {}),
        });
        if (result.kind === 'project-not-found' || result.kind === 'issue-not-found') {
          return reply.code(404).send({ error: result.kind === 'project-not-found' ? 'Active project not found' : 'Issue not found' });
        }
        if (result.kind === 'issue-closed') return reply.code(409).send({ error: 'Closed issues cannot be started' });
        if (result.kind === 'not-an-issue') return reply.code(400).send({ error: 'Pull requests cannot be started as issues' });
        if (result.kind === 'prompt-too-large') return reply.code(413).send({ error: 'Issue task prompt is too large' });
        return reply.code(result.kind === 'created' ? 201 : 200).send({
          task: {
            id: result.task.id,
            title: result.task.title,
            state: result.task.state,
            agent: result.task.agent,
            issueNumber,
          },
          issue: { number: issueNumber, url: `https://github.com/${result.repository}/issues/${issueNumber}` },
        });
      } catch {
        request.log.warn('github.issue_start_failed');
        return reply.code(app.githubIssueClient && app.taskStore && app.projectStore ? 502 : 503)
          .send({ error: 'Issue task could not be started' });
      }
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
