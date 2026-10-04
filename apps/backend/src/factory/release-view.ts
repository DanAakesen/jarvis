import type { FastifyInstance } from 'fastify';
import type { Project } from './projects.js';

export interface ReleaseRecord {
  readonly id: string;
  readonly version: string;
  readonly sha: string;
  readonly status: 'building' | 'deploying' | 'released' | 'failed';
  readonly createdAt: string;
  readonly releasedAt: string | null;
}

export interface PullRequestRecord {
  readonly id: string;
  readonly number: number;
  readonly branch: string;
  readonly headSha: string;
  readonly state: 'open' | 'merged' | 'closed';
  readonly checks: 'pending' | 'passed' | 'failed';
  readonly taskId: string | null;
}

export interface WorkflowRunRecord {
  readonly id: string;
  readonly workflow: string;
  readonly trigger: string;
  readonly headSha: string;
  readonly status: 'queued' | 'in_progress' | 'completed';
  readonly conclusion: 'success' | 'failure' | 'cancelled' | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly releaseId: string | null;
  readonly pullRequestNumber: number | null;
  readonly taskId: string | null;
}

export interface DeploymentRecord {
  readonly id: string;
  readonly releaseId: string;
  readonly environment: string;
  readonly status: 'queued' | 'in_progress' | 'success' | 'failure';
  readonly at: string;
}

export interface ReleaseViewRecords {
  readonly releases: readonly ReleaseRecord[];
  readonly pullRequests: readonly PullRequestRecord[];
  readonly workflowRuns: readonly WorkflowRunRecord[];
  readonly deployments: readonly DeploymentRecord[];
}

export interface ReleaseViewStore {
  read(projectId: string): Promise<ReleaseViewRecords>;
}

export interface GitGraphCommit {
  readonly sha: string;
  readonly message: string;
  readonly author: string;
  readonly committedAt: string;
  readonly parents: readonly string[];
}

export interface GitGraphBranch {
  readonly name: string;
  readonly commits: readonly string[];
}

export interface GitGraph {
  readonly fetchedAt: string;
  readonly truncated: boolean;
  readonly branches: readonly GitGraphBranch[];
  readonly commits: readonly GitGraphCommit[];
}

export interface ReleaseGraphReader {
  read(repository: string, defaultBranch: string): Promise<GitGraph>;
}

const maxResponseBytes = 1024 * 1024;
const maxSqlBigInt = 9_223_372_036_854_775_807n;

function isValidId(id: string): boolean {
  return /^[1-9][0-9]{0,18}$/u.test(id) && BigInt(id) <= maxSqlBigInt;
}

function boundedResponse(reply: {
  code(statusCode: number): { send(payload: unknown): unknown };
  send(payload: unknown): unknown;
}, value: unknown) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || Buffer.byteLength(serialized) > maxResponseBytes) {
    return reply.code(413).send({ error: 'Response too large' });
  }
  return reply.send(value);
}

export function registerReleaseViewRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/factory/projects/:id/releases', {
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } },
        required: ['id'],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (!isValidId(request.params.id)) return reply.code(400).send({ error: 'Invalid request' });
    const projects = app.projectStore;
    const records = app.releaseViewStore;
    if (!projects || !records) return reply.code(503).send({ error: 'Release data unavailable' });

    let project: Project | undefined;
    let data: ReleaseViewRecords;
    try {
      project = (await projects.list()).find(({ id }) => id === request.params.id);
      if (!project) return reply.code(404).send({ error: 'Not found' });
      data = await records.read(project.id);
    } catch {
      request.log.warn('factory.release_data_read_failed');
      return reply.code(503).send({ error: 'Release data unavailable' });
    }

    let graph: GitGraph | null = null;
    if (app.releaseGraphReader) {
      try {
        graph = await app.releaseGraphReader.read(project.repo, project.default_branch);
      } catch {
        request.log.warn('factory.release_graph_read_failed');
      }
    }

    return boundedResponse(reply.header('Cache-Control', 'no-store'), {
      project: {
        id: project.id,
        name: project.name,
        repo: project.repo,
        defaultBranch: project.default_branch,
      },
      ...data,
      graph,
    });
  });
}
