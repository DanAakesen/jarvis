import type { JarvisTool } from '../core/tool-registry.js';
import { ToolFailure, ToolRefusal } from '../core/tool-registry.js';
import { taskStates, type TaskState } from './task-lifecycle.js';
import type { Project } from './projects.js';
import type { TaskDetail, TaskListFilters, TaskRecord } from './task-store.js';
import { settingsOptions } from '../core/settings.js';
import { modelsForRole, reasoningForModel } from '../core/model-catalog.js';
import type { ModelCatalogue } from '@jarvis/contracts';
import { createGitHubActionsRunClient } from '../github/actions-runs.js';

const idSchema = { type: 'string', pattern: '^[1-9][0-9]{0,18}$', maxLength: 19 };
const maxSqlBigInt = 9_223_372_036_854_775_807n;
const taskFiltersSchema = {
  projectId: idSchema,
  agent: { type: 'string', enum: ['codex', 'copilot'] },
  state: { type: 'string', enum: taskStates },
  createdAfter: { type: 'string', format: 'date-time' },
  createdBefore: { type: 'string', format: 'date-time' },
  search: { type: 'string', minLength: 1, maxLength: 100 },
  limit: { type: 'integer', minimum: 1, maximum: 100 },
  offset: { type: 'integer', minimum: 0, maximum: 10_000 },
};

interface TaskListInput {
  projectId?: string;
  agent?: TaskListFilters['agent'];
  state?: TaskState;
  createdAfter?: string;
  createdBefore?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

interface CreateTaskToolInput {
  projectId: string;
  prompt: string;
  agent?: 'codex' | 'copilot';
  model?: string;
  reasoning?: string;
}

interface SetTaskModelInput {
  taskId: string;
  agent?: string;
  model?: string;
  reasoning?: string;
}

function requireStore<T>(store: T | null, name: string): T {
  if (!store) throw new Error(`${name} unavailable`);
  return store;
}

function isOption(value: string, options: readonly string[]): boolean {
  return options.includes(value);
}

function optionsList(options: readonly string[]): string {
  return options.join(', ');
}

function taskModelOptions(agent: TaskRecord['agent'], catalogue: ModelCatalogue): readonly string[] {
  return modelsForRole(catalogue, agent);
}

function assertSqlBigInt(value: string): void {
  if (!/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) > maxSqlBigInt) {
    throw new Error('Invalid identifier');
  }
}

function taskTitle(prompt: string): string {
  const firstLine = prompt.trim().split(/\r?\n/, 1)[0]?.trim() ?? '';
  return (firstLine || 'New task').slice(0, 200);
}

function projectSummary(project: Project) {
  return {
    id: project.id,
    name: project.name,
    repo: project.repo,
    default_branch: project.default_branch,
    default_agent: project.default_agent,
    policy: project.policy,
    sandbox_size: project.sandbox_size,
    tech: project.tech,
    max_parallel_tasks: project.max_parallel_tasks,
  };
}

function taskDetailSummary(detail: TaskDetail) {
  return {
    ...detail,
    events: detail.events.map(({ id, type, summary, source, at }) => ({ id, type, summary, source, at })),
  };
}

async function activeProject(projectId: string, request: import('fastify').FastifyRequest): Promise<Project> {
  assertSqlBigInt(projectId);
  const store = requireStore(request.server.projectStore, 'Project service');
  const project = (await store.list()).find(({ id }) => id === projectId);
  if (!project) throw new ToolRefusal('Active project not found.');
  return project;
}

function taskListFilters(input: TaskListInput): TaskListFilters {
  if (input.projectId !== undefined) assertSqlBigInt(input.projectId);
  if (input.createdAfter && input.createdBefore &&
    Date.parse(input.createdAfter) >= Date.parse(input.createdBefore)) {
    throw new Error('Invalid task filters');
  }
  return {
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.state ? { state: input.state } : {}),
    ...(input.createdAfter ? { createdAfter: input.createdAfter } : {}),
    ...(input.createdBefore ? { createdBefore: input.createdBefore } : {}),
    ...(input.search ? { search: input.search } : {}),
    limit: input.limit ?? 50,
    offset: input.offset ?? 0,
  };
}

async function controlTask(
  taskId: string,
  action: 'steer' | 'pause' | 'resume' | 'cancel',
  request: import('fastify').FastifyRequest,
  message?: string,
): Promise<TaskRecord> {
  assertSqlBigInt(taskId);
  if (action === 'steer' && !message?.trim()) throw new Error('Invalid steering message');
  const controller = requireStore(request.server.taskController, 'Task controls');
  const result = await controller.control(taskId, action === 'steer'
    ? { action, message: message! }
    : { action });
  if (result.kind === 'not-found') throw new ToolRefusal('Task not found.');
  if (result.kind === 'invalid-transition') throw new ToolRefusal('Task state does not allow this action.');
  if (result.kind !== 'ok') throw new Error('Task control failed');
  return result.task;
}

export const factoryTools: readonly JarvisTool[] = [
  {
    name: 'list_projects',
    description: 'List active Software Factory projects and their IDs for selecting a project.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    reflexSafe: true,
    execute: async (_input, request) => {
      const store = requireStore(request.server.projectStore, 'Project service');
      return (await store.list()).map(projectSummary);
    },
  },
  {
    name: 'list_tasks',
    description: 'List Software Factory tasks using the same bounded filters as the Tasks API.',
    inputSchema: { type: 'object', properties: taskFiltersSchema, additionalProperties: false },
    reflexSafe: true,
    execute: async (input, request) => {
      const store = requireStore(request.server.taskStore, 'Task service');
      const filters = taskListFilters(input as TaskListInput);
      return { tasks: await store.list(filters), limit: filters.limit, offset: filters.offset };
    },
  },
  {
    name: 'get_task',
    description: 'Get a task and bounded event summaries without exposing event payloads.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: idSchema,
        eventLimit: { type: 'integer', minimum: 1, maximum: 200 },
        eventOffset: { type: 'integer', minimum: 0, maximum: 10_000 },
      },
      required: ['taskId'],
      additionalProperties: false,
    },
    reflexSafe: true,
    execute: async (input, request) => {
      const { taskId, eventLimit, eventOffset } = input as {
        taskId: string; eventLimit?: number; eventOffset?: number;
      };
      assertSqlBigInt(taskId);
      const store = requireStore(request.server.taskStore, 'Task service');
      const detail = await store.get(taskId, eventLimit ?? 100, eventOffset ?? 0);
      if (!detail) throw new ToolRefusal('Task not found.');
      return taskDetailSummary(detail);
    },
  },
  {
    name: 'list_releases',
    description: 'List the recorded releases for an active Software Factory project.',
    inputSchema: {
      type: 'object',
      properties: { projectId: idSchema },
      required: ['projectId'],
      additionalProperties: false,
    },
    reflexSafe: true,
    execute: async (input, request) => {
      const project = await activeProject((input as { projectId: string }).projectId, request);
      const store = requireStore(request.server.releaseViewStore, 'Release service');
      const records = await store.read(project.id);
      return {
        project: { id: project.id, name: project.name, repo: project.repo },
        releases: records.releases,
      };
    },
  },
  {
    name: 'get_release',
    description: 'Get a recorded release and its linked workflow and deployment status.',
    inputSchema: {
      type: 'object',
      properties: { releaseId: idSchema },
      required: ['releaseId'],
      additionalProperties: false,
    },
    reflexSafe: true,
    execute: async (input, request) => {
      const { releaseId } = input as { releaseId: string };
      assertSqlBigInt(releaseId);
      const store = requireStore(request.server.releaseViewStore, 'Release service');
      const projectId = await store.projectForRelease(releaseId);
      if (!projectId) throw new ToolRefusal('Release not found.');
      const project = await activeProject(projectId, request);
      const records = await store.read(project.id);
      const release = records.releases.find(({ id }) => id === releaseId);
      if (!release) throw new ToolRefusal('Release not found.');
      return {
        project: { id: project.id, name: project.name, repo: project.repo },
        release,
        workflowRuns: records.workflowRuns.filter(({ releaseId: linkedReleaseId }) => linkedReleaseId === release.id),
        deployments: records.deployments.filter(({ releaseId: linkedReleaseId }) => linkedReleaseId === release.id),
      };
    },
  },
  {
    name: 'get_deployment_status',
    description: 'Check the latest deploy workflow run on an active project’s default branch.',
    inputSchema: {
      type: 'object',
      properties: { projectId: idSchema },
      required: ['projectId'],
      additionalProperties: false,
    },
    reflexSafe: true,
    execute: async (input, request, signal) => {
      const project = await activeProject((input as { projectId: string }).projectId, request);
      const tokenIssuer = request.server.githubAppTokenIssuer;
      if (!tokenIssuer) throw new ToolFailure('GitHub deployment status is unavailable.');
      try {
        const deployment = await createGitHubActionsRunClient(tokenIssuer)
          .latestDeployment(project.repo, project.default_branch, signal);
        return {
          project: { id: project.id, name: project.name, repo: project.repo },
          deployment,
        };
      } catch {
        throw new ToolFailure('GitHub deployment status could not be read.');
      }
    },
  },
  {
    name: 'create_task',
    description: 'Create a Ready task in an active project from Dan’s prompt.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: idSchema,
        prompt: { type: 'string', minLength: 1, maxLength: 50_000 },
        agent: { type: 'string', enum: ['codex', 'copilot'] },
        model: { type: 'string', minLength: 1, maxLength: 100 },
        reasoning: { type: 'string', minLength: 1, maxLength: 32 },
      },
      required: ['projectId', 'prompt'],
      additionalProperties: false,
    },
    execute: async (input, request) => {
      const { projectId, prompt, agent, model, reasoning } = input as CreateTaskToolInput;
      assertSqlBigInt(projectId);
      const originMessageId = request.jarvisMemorySourceMessageId ??
        (typeof request.headers['x-jarvis-message-id'] === 'string'
          ? request.headers['x-jarvis-message-id']
          : undefined);
      if (!originMessageId || !/^[1-9][0-9]{0,18}$/u.test(originMessageId) ||
        BigInt(originMessageId) > 9_223_372_036_854_775_807n) {
        throw new ToolRefusal('Task creation needs a valid conversation message.');
      }
      if (agent !== undefined && !isOption(agent, settingsOptions.projectAgents)) {
        throw new ToolRefusal(`Unsupported coding agent. Valid agents: ${optionsList(settingsOptions.projectAgents)}.`);
      }
      const catalogue = await request.server.modelCatalogue.read();
      const modelOptions = agent
        ? taskModelOptions(agent, catalogue)
        : [...new Set([...taskModelOptions('codex', catalogue), ...taskModelOptions('copilot', catalogue)])];
      if (model !== undefined && !isOption(model, modelOptions)) {
        throw new ToolRefusal(`Unsupported coding-agent model. Valid models: ${optionsList(modelOptions)}.`);
      }
      const codexEfforts = ['default', ...reasoningForModel(catalogue, 'codex', model ?? 'default')];
      if (reasoning !== undefined && (agent !== 'codex' || !isOption(reasoning, codexEfforts))) {
        throw new ToolRefusal(`Unsupported reasoning. Specify Codex and use one of the valid Codex reasoning levels: ${optionsList(codexEfforts)}.`);
      }
      const store = requireStore(request.server.taskStore, 'Task service');
      const task = await store.create({
        projectId,
        title: taskTitle(prompt),
        request: prompt,
        source: 'chat',
        originMessageId,
        ...(agent ? { agent } : {}),
        ...(model ? { modelOverride: model } : {}),
        ...(reasoning ? { reasoningOverride: reasoning } : {}),
      });
      if (!task) throw new ToolRefusal('Active project not found.');
      return task;
    },
  },
  {
    name: 'set_task_model',
    description: 'Set the coding agent, model, or reasoning for a Ready task; running tasks are not changed.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: idSchema,
        agent: { type: 'string', minLength: 1, maxLength: 32 },
        model: { type: 'string', minLength: 1, maxLength: 100 },
        reasoning: { type: 'string', minLength: 1, maxLength: 32 },
      },
      required: ['taskId'],
      anyOf: [{ required: ['agent'] }, { required: ['model'] }, { required: ['reasoning'] }],
      additionalProperties: false,
    },
    execute: async (input, request) => {
      const { taskId, agent: requestedAgent, model, reasoning } = input as SetTaskModelInput;
      assertSqlBigInt(taskId);
      if (requestedAgent !== undefined && !isOption(requestedAgent, settingsOptions.projectAgents)) {
        throw new ToolRefusal(`Unsupported coding agent. Valid agents: ${optionsList(settingsOptions.projectAgents)}.`);
      }
      const store = requireStore(request.server.taskStore, 'Task service');
      const current = await store.get(taskId, 1, 0);
      if (!current) throw new ToolRefusal('Task not found.');
      if (current.state !== 'Ready') {
        throw new ToolRefusal(`Task is ${current.state}. Model changes are accepted only while a task is Ready; running tasks are refused and remain unchanged.`);
      }

      const agent = (requestedAgent ?? current.agent) as TaskRecord['agent'];
      const catalogue = await request.server.modelCatalogue.read();
      const modelOptions = taskModelOptions(agent, catalogue);
      if (model !== undefined && !isOption(model, modelOptions)) {
        throw new ToolRefusal(`Unsupported ${agent} model. Valid models: ${optionsList(modelOptions)}.`);
      }
      const codexEfforts = [
        'default',
        ...reasoningForModel(catalogue, 'codex', model ?? current.modelOverride ?? 'default'),
      ];
      if (reasoning !== undefined && (agent !== 'codex' || !isOption(reasoning, codexEfforts))) {
        throw new ToolRefusal(`Unsupported ${agent} reasoning. Valid Codex reasoning levels: ${optionsList(codexEfforts)}.`);
      }

      const changedAgent = agent !== current.agent;
      const result = await store.updateModelConfig(taskId, {
        agent,
        modelOverride: model ?? (changedAgent ? null : current.modelOverride),
        reasoningOverride: reasoning ?? (changedAgent ? null : current.reasoningOverride),
      });
      if (result.kind === 'not-found') throw new ToolRefusal('Task not found.');
      if (result.kind === 'not-ready') {
        throw new ToolRefusal('Task is no longer Ready. Model changes are accepted only while a task is Ready; the current turn is unchanged.');
      }
      return {
        taskId: result.task.id,
        state: result.task.state,
        agent: result.task.agent,
        model: result.task.modelOverride,
        reasoning: result.task.reasoningOverride,
        applies: 'next task turn',
      };
    },
  },
  {
    name: 'retry_task',
    description: 'Retry an eligible task that failed before sandbox work began; use Recover for tasks that ran.',
    inputSchema: {
      type: 'object',
      properties: { taskId: idSchema },
      required: ['taskId'],
      additionalProperties: false,
    },
    execute: async (input, request) => {
      const { taskId } = input as { taskId: string };
      assertSqlBigInt(taskId);
      const store = requireStore(request.server.taskStore, 'Task service');
      const result = await store.retry(taskId);
      if (result.kind === 'not-found') throw new ToolRefusal('Task not found.');
      if (result.kind === 'invalid-transition') {
        throw new ToolRefusal('Only eligible failed starts without sandbox history can be retried; use Recover for tasks that ran.');
      }
      if (result.kind === 'credential-unavailable') {
        throw new ToolRefusal('Retry is unavailable while the task credentials are unavailable.');
      }
      if (result.kind === 'renewal-active') {
        throw new ToolRefusal('Retry is unavailable while Codex credential renewal is active.');
      }
      return {
        id: result.task.id,
        state: result.task.state,
        attemptCount: result.task.attemptCount,
      };
    },
  },
  {
    name: 'steer_task',
    description: 'Send a correction to the current turn of a running task.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: idSchema,
        message: { type: 'string', minLength: 1, maxLength: 65_536, pattern: '\\S' },
      },
      required: ['taskId', 'message'],
      additionalProperties: false,
    },
    execute: async (input, request) => {
      const { taskId, message } = input as { taskId: string; message: string };
      return controlTask(taskId, 'steer', request, message);
    },
  },
  ...(['pause', 'resume', 'cancel'] as const).map((action) => ({
    name: `${action}_task`,
    description: `${action[0]!.toUpperCase()}${action.slice(1)} a Software Factory task when its lifecycle state permits.`,
    inputSchema: {
      type: 'object',
      properties: { taskId: idSchema },
      required: ['taskId'],
      additionalProperties: false,
    },
    execute: async (input: unknown, request: import('fastify').FastifyRequest) => {
      const { taskId } = input as { taskId: string };
      return controlTask(taskId, action, request);
    },
    ...(action === 'pause' ? { reflexSafe: true } : {}),
  })),
];
