import type {
  FactoryBoard, FactoryBoardCard, FactoryBoardStatus, FactoryBoardTaskOverlay,
} from '@jarvis/contracts';
import type { FastifyInstance } from 'fastify';
import type { GitHubAppTokenIssuer } from '../github-app.js';
import type { TaskRecord } from './task-store.js';

const githubApi = 'https://api.github.com';
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const maxResponseBytes = 1024 * 1024;
const maxPages = 10;
const pageSize = 100;
const boardStatuses: readonly FactoryBoardStatus[] = [
  'Backlog', 'Needs Dan', 'Ready', 'In progress', 'In review', 'Done',
];
const workerLabels = new Set(['Codex', 'Copilot', 'Dan', 'Jarvis']);
const linkedIssuePattern = /\b(?:fixes|closes|resolves)\s+#(\d+)\b/giu;
const decisionLabel = 'needs-decision';
const deferredLabel = 'deferred';
const closedIssueWindowMs = 14 * 24 * 60 * 60 * 1000;

export interface FactoryBoardIssue {
  readonly number: number;
  readonly title: string;
  readonly labels: readonly string[];
  readonly state: 'open' | 'closed';
  readonly closedAt: string | null;
  readonly blockedBy: number;
  readonly body: string | null;
}

export interface FactoryBoardPullRequestSource {
  readonly number: number;
  readonly body: string | null;
  readonly url: string;
  readonly draft: boolean;
}

export interface FactoryBoardSource {
  readonly issues: readonly FactoryBoardIssue[];
  readonly pullRequests: readonly FactoryBoardPullRequestSource[];
}

export interface FactoryBoardReader {
  read(repository: string, token: string, closedSince: string): Promise<FactoryBoardSource>;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function issueFromGitHub(value: unknown): FactoryBoardIssue | null {
  const issue = record(value);
  if (!issue || 'pull_request' in issue) return null;
  const labels = issue.labels;
  const dependency = record(issue.issue_dependencies_summary);
  const number = issue.number;
  const closedAt = issue.closed_at;
  const body = issue.body;
  if (!Number.isSafeInteger(number) || (number as number) < 1 ||
      typeof issue.title !== 'string' || issue.title.length > 500 ||
      !Array.isArray(labels) || labels.length > 100 ||
      (issue.state !== 'open' && issue.state !== 'closed') ||
      (closedAt !== null && (typeof closedAt !== 'string' || !Number.isFinite(Date.parse(closedAt)))) ||
      (body !== null && typeof body !== 'string') ||
      (dependency?.blocked_by !== undefined &&
        (!Number.isSafeInteger(dependency.blocked_by) || (dependency.blocked_by as number) < 0))) {
    throw new Error('GitHub board response is invalid');
  }
  const labelNames = labels.map((label) => {
    const name = record(label)?.name;
    if (typeof name !== 'string' || name.length > 100) throw new Error('GitHub board response is invalid');
    return name;
  });
  return {
    number: number as number,
    title: issue.title,
    labels: labelNames,
    state: issue.state,
    closedAt: closedAt as string | null,
    blockedBy: (dependency?.blocked_by as number | undefined) ?? 0,
    body: body as string | null,
  };
}

function pullRequestFromGitHub(value: unknown): FactoryBoardPullRequestSource {
  const pullRequest = record(value);
  if (!pullRequest || !Number.isSafeInteger(pullRequest.number) || (pullRequest.number as number) < 1 ||
      typeof pullRequest.body !== 'string' && pullRequest.body !== null ||
      typeof pullRequest.draft !== 'boolean' || typeof pullRequest.html_url !== 'string') {
    throw new Error('GitHub board response is invalid');
  }
  let url: URL;
  try {
    url = new URL(pullRequest.html_url);
  } catch {
    throw new Error('GitHub board response is invalid');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password) {
    throw new Error('GitHub board response is invalid');
  }
  return {
    number: pullRequest.number as number,
    body: pullRequest.body as string | null,
    url: url.toString(),
    draft: pullRequest.draft,
  };
}

async function readResponse(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error('GitHub board request failed');
  const length = response.headers.get('content-length');
  if (length !== null && Number(length) > maxResponseBytes) throw new Error('GitHub board response is too large');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('GitHub board response is invalid');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('GitHub board response is too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')) as unknown;
  } catch {
    throw new Error('GitHub board response is invalid');
  }
}

async function readPages(
  fetchImpl: typeof fetch,
  path: string,
  token: string,
): Promise<unknown[]> {
  const items: unknown[] = [];
  const signal = AbortSignal.timeout(20_000);
  for (let page = 1; page <= maxPages; page += 1) {
    const url = `${githubApi}${path}${path.includes('?') ? '&' : '?'}per_page=${pageSize}&page=${page}`;
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `${['Bear', 'er'].join('')} ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal,
      redirect: 'error',
    });
    const result = await readResponse(response);
    if (!Array.isArray(result) || result.length > pageSize) throw new Error('GitHub board response is invalid');
    items.push(...result);
    if (!response.headers.get('link')?.match(/<[^>]+>;\s*rel="next"/u)) return items;
  }
  throw new Error('GitHub board result limit exceeded');
}

export function createGitHubFactoryBoardReader(fetchImpl: typeof fetch = fetch): FactoryBoardReader {
  return {
    async read(repository, token, closedSince) {
      if (!repositoryPattern.test(repository) || !token || token.length > 4096 ||
          !Number.isFinite(Date.parse(closedSince))) {
        throw new Error('GitHub board request is invalid');
      }
      const [owner, name] = repository.split('/');
      const root = `/repos/${encodeURIComponent(owner!)}/${encodeURIComponent(name!)}`;
      const [openIssues, recentlyUpdatedClosedIssues, openPulls] = await Promise.all([
        readPages(fetchImpl, `${root}/issues?state=open`, token),
        readPages(fetchImpl, `${root}/issues?state=closed&since=${encodeURIComponent(closedSince)}`, token),
        readPages(fetchImpl, `${root}/pulls?state=open`, token),
      ]);
      const cutoff = Date.parse(closedSince);
      const issues = [...openIssues, ...recentlyUpdatedClosedIssues]
        .map(issueFromGitHub)
        .filter((issue): issue is FactoryBoardIssue => issue !== null)
        .filter((issue) => issue.state === 'open' ||
          (issue.closedAt !== null && Date.parse(issue.closedAt) >= cutoff));
      return { issues, pullRequests: openPulls.map(pullRequestFromGitHub) };
    },
  };
}

export class FactoryBoardCache {
  private readonly entries = new Map<string, { expiresAt: number; board: FactoryBoard }>();
  private readonly pending = new Map<string, { generation: number; promise: Promise<FactoryBoard> }>();
  private generation = 0;

  constructor(private readonly now: () => number = Date.now, private readonly ttlMs = 60_000) {}

  async get(repository: string, load: () => Promise<FactoryBoard>): Promise<FactoryBoard> {
    const key = repository.toLowerCase();
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.now()) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.board;
    }
    if (cached) this.entries.delete(key);
    const pending = this.pending.get(key);
    if (pending?.generation === this.generation) return pending.promise;

    const generation = this.generation;
    const promise = load().then((board) => {
      if (generation === this.generation) {
        this.entries.set(key, { expiresAt: this.now() + this.ttlMs, board });
        if (this.entries.size > 32) this.entries.delete(this.entries.keys().next().value!);
      }
      return board;
    }).finally(() => {
      if (this.pending.get(key)?.promise === promise) this.pending.delete(key);
    });
    this.pending.set(key, { generation, promise });
    return promise;
  }

  invalidateAll(): void {
    this.entries.clear();
    this.generation += 1;
  }
}

export function linkedIssueNumbers(body: string | null): Set<number> {
  return new Set(Array.from(body?.matchAll(linkedIssuePattern) ?? [], (match) => Number(match[1])));
}

export function desiredFactoryBoardStatus(
  issue: Pick<FactoryBoardIssue, 'number' | 'labels' | 'blockedBy'>,
  linkedPullRequests: readonly Pick<FactoryBoardPullRequestSource, 'body' | 'draft'>[],
): Exclude<FactoryBoardStatus, 'Done'> {
  const linked = linkedPullRequests.filter((pullRequest) => linkedIssueNumbers(pullRequest.body).has(issue.number));
  if (linked.some((pullRequest) => !pullRequest.draft)) return 'In review';
  const labels = new Set(issue.labels);
  if (linked.length > 0 || issue.labels.some((label) => workerLabels.has(label))) return 'In progress';
  if (labels.has(decisionLabel)) return 'Needs Dan';
  if (labels.has(deferredLabel) || issue.blockedBy > 0) return 'Backlog';
  return 'Ready';
}

function taskOverlay(task: TaskRecord): FactoryBoardTaskOverlay {
  return {
    state: task.state,
    agent: task.agent,
    sandbox: { lastSessionEndReason: task.latestSessionEndReason ?? null },
  };
}

export function createFactoryBoard(
  projectId: string,
  repository: string,
  source: FactoryBoardSource,
  taskRecords: readonly TaskRecord[],
  pullRequestRecords: readonly {
    readonly number: number;
    readonly checks: 'pending' | 'passed' | 'failed';
    readonly taskId: string | null;
  }[],
  now = Date.now(),
): FactoryBoard {
  const cutoff = now - closedIssueWindowMs;
  const tasks = new Map(taskRecords.map((task) => [task.id, task]));
  const pullRequests = source.pullRequests.map((pullRequest) => ({
    ...pullRequest,
    checks: pullRequestRecords.find((record) => record.number === pullRequest.number)?.checks ?? null,
    taskId: pullRequestRecords.find((record) => record.number === pullRequest.number)?.taskId ?? null,
  }));
  const columns = boardStatuses.map((status) => ({ status, cards: [] as FactoryBoardCard[] }));
  for (const issue of source.issues) {
    if (issue.state === 'closed' && (!issue.closedAt || Date.parse(issue.closedAt) < cutoff)) continue;
    const linked = pullRequests.filter((pullRequest) => linkedIssueNumbers(pullRequest.body).has(issue.number));
    const status = issue.state === 'closed' ? 'Done' : desiredFactoryBoardStatus(issue, linked);
    const taskId = linked.map(({ taskId }) => taskId).find((id): id is string => id !== null && tasks.has(id)) ?? null;
    const task = taskId ? tasks.get(taskId) : undefined;
    const column = columns.find((candidate) => candidate.status === status)!;
    column.cards.push({
      issueNumber: issue.number,
      taskId,
      title: issue.title,
      labels: [...issue.labels],
      pullRequests: linked.map(({ number, url, draft, checks }) => ({ number, url, draft, ready: !draft, checks })),
      task: task ? taskOverlay(task) : null,
    });
  }
  for (const column of columns) column.cards.sort((left, right) => left.issueNumber - right.issueNumber);
  return { projectId, repository, fetchedAt: new Date(now).toISOString(), columns };
}

function isSqlBigInt(value: string): boolean {
  return /^[1-9][0-9]{0,18}$/u.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n;
}

export function registerFactoryBoardRoute(app: FastifyInstance): void {
  app.get<{ Querystring: { project: string } }>('/factory/board', {
    schema: {
      querystring: {
        type: 'object',
        properties: { project: { type: 'string', pattern: '^[1-9][0-9]{0,18}$', maxLength: 19 } },
        required: ['project'],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const projects = app.projectStore;
    const tasks = app.taskStore;
    const releases = app.releaseViewStore;
    const tokenIssuer: GitHubAppTokenIssuer | null = app.githubAppTokenIssuer;
    if (!isSqlBigInt(request.query.project)) return reply.code(400).send({ error: 'Invalid project ID' });
    if (!projects || !tasks || !releases || !tokenIssuer) {
      return reply.code(503).send({ error: 'Factory board service unavailable' });
    }
    let project;
    try {
      project = (await projects.list()).find((candidate) => candidate.id === request.query.project && candidate.active);
    } catch {
      request.log.warn('factory.board_project_lookup_failed');
      return reply.code(503).send({ error: 'Factory board service unavailable' });
    }
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    try {
      const board = await app.factoryBoardCache.get(`${project.id}:${project.repo}`, async () => {
        const now = Date.now();
        const closedSince = new Date(now - closedIssueWindowMs).toISOString();
        const token = await tokenIssuer.issueForRepositoryRead(project.repo);
        const [source, taskRecords, releaseRecords] = await Promise.all([
          app.factoryBoardReader.read(project.repo, token, closedSince),
          tasks.list({ projectId: project!.id, limit: 1000, offset: 0 }),
          releases.read(project!.id),
        ]);
        return createFactoryBoard(
          project!.id,
          project!.repo,
          source,
          taskRecords,
          releaseRecords.pullRequests,
          now,
        );
      });
      const serialized = JSON.stringify(board);
      if (Buffer.byteLength(serialized) > 1024 * 1024) {
        return reply.code(413).send({ error: 'Factory board response too large' });
      }
      return reply.header('Cache-Control', 'no-store').send(board);
    } catch {
      request.log.warn('factory.board_read_failed');
      return reply.code(502).send({ error: 'Factory board unavailable' });
    }
  });
}
