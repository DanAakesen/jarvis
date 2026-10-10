import type {
  BoardCard, FactoryBoard, FactoryBoardColumn, FactoryBoardColumnId, FactoryBoardTask,
} from '@jarvis/contracts';
import type { FastifyInstance } from 'fastify';
import type { GitHubAppTokenIssuer } from '../github-app.js';
import type { TaskRecord } from './task-store.js';

const githubApi = 'https://api.github.com';
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const maxResponseBytes = 1024 * 1024;
const maxPages = 10;
const pageSize = 100;
const boardColumns: readonly { id: FactoryBoardColumnId; label: string }[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'needs_dan', label: 'Needs Dan' },
  { id: 'ready', label: 'Ready' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'in_review', label: 'In review' },
  { id: 'done', label: 'Done' },
];
const workerLabels = ['Jarvis', 'Copilot', 'Codex', 'Dan'] as const;
const linkedIssuePattern = /\b(?:fixes|closes|resolves)\s+(?:#(\d+)|([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)|https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/issues\/(\d+))\b/giu;
const decisionLabel = 'needs-decision';
const deferredLabel = 'deferred';
const closedIssueWindowMs = 14 * 24 * 60 * 60 * 1000;

export interface FactoryBoardIssue {
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly taskCode: string | null;
  readonly labels: readonly string[];
  readonly worker: typeof workerLabels[number] | null;
  readonly state: 'open' | 'closed';
  readonly updatedAt: string;
  readonly closedAt: string | null;
  readonly blockedBy: readonly number[];
  readonly blockedByCount: number;
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
  searchIssues?(repository: string, token: string, query: string, field?: 'title' | 'body'): Promise<{ numbers: number[]; incomplete: boolean }>;
  issuePullRequests?(repository: string, token: string, issue: number): Promise<number[]>;
  readPullRequest?(repository: string, token: string, number: number): Promise<WorkPullRequest>;
}

export interface WorkPullRequest {
  number: number;
  url: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  checks: 'pending' | 'passed' | 'failed';
  mergeSha: string | null;
  linkedIssues: number[];
  checksIncomplete?: boolean;
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
  const updatedAt = issue.updated_at;
  const body = issue.body;
  if (!Number.isSafeInteger(number) || (number as number) < 1 ||
      typeof issue.title !== 'string' || issue.title.length > 500 ||
      typeof issue.html_url !== 'string' ||
      !Array.isArray(labels) || labels.length > 100 ||
      (issue.state !== 'open' && issue.state !== 'closed') ||
      (closedAt !== null && (typeof closedAt !== 'string' || !Number.isFinite(Date.parse(closedAt)))) ||
      typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt)) ||
      (body !== null && typeof body !== 'string') ||
      (dependency?.blocked_by !== undefined &&
        (!Number.isSafeInteger(dependency.blocked_by) || (dependency.blocked_by as number) < 0))) {
    throw new Error('GitHub board response is invalid');
  }
  const url = githubUrl(issue.html_url);
  const labelNames = labels.map((label) => {
    const name = record(label)?.name;
    if (typeof name !== 'string' || name.length > 100) throw new Error('GitHub board response is invalid');
    return name;
  });
  return {
    number: number as number,
    url,
    title: issue.title,
    taskCode: /\bP\d{1,2}-\d{2,3}\b/u.exec(issue.title)?.[0] ?? null,
    labels: labelNames,
    worker: workerLabels.find((worker) => labelNames.includes(worker)) ?? null,
    state: issue.state,
    updatedAt: new Date(updatedAt).toISOString(),
    closedAt: closedAt as string | null,
    blockedBy: [],
    blockedByCount: (dependency?.blocked_by as number | undefined) ?? 0,
    body: body as string | null,
  };
}

function githubUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('GitHub board response is invalid');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('GitHub board response is invalid');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.port) {
    throw new Error('GitHub board response is invalid');
  }
  return url.toString();
}

function pullRequestFromGitHub(value: unknown): FactoryBoardPullRequestSource {
  const pullRequest = record(value);
  if (!pullRequest || !Number.isSafeInteger(pullRequest.number) || (pullRequest.number as number) < 1 ||
      typeof pullRequest.body !== 'string' && pullRequest.body !== null ||
      typeof pullRequest.draft !== 'boolean' || typeof pullRequest.html_url !== 'string') {
    throw new Error('GitHub board response is invalid');
  }
  return {
    number: pullRequest.number as number,
    body: pullRequest.body as string | null,
    url: githubUrl(pullRequest.html_url),
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
  signal: AbortSignal,
): Promise<unknown[]> {
  const items: unknown[] = [];
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
  function root(repository: string): string {
    if (!repositoryPattern.test(repository)) throw new Error('Invalid repository');
    return `/repos/${repository.split('/').map(encodeURIComponent).join('/')}`;
  }
  async function get(path: string, token: string): Promise<unknown> {
    return readResponse(await fetchImpl(`${githubApi}${path}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `${['Bear', 'er'].join('')} ${token}`,
        'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(10_000), redirect: 'error',
    }));
  }
  return {
    async searchIssues(repository, token, query, field = 'title') {
      root(repository);
      const data = record(await get(`/search/issues?${new URLSearchParams({
        q: `repo:${repository} is:issue "${query.replace(/["\\]/gu, ' ')}" in:${field}`,
        per_page: '100',
      })}`, token));
      if (!data || !Array.isArray(data.items) || data.items.length > 100 ||
          !Number.isSafeInteger(data.total_count) || (data.total_count as number) < 0) {
        throw new Error('GitHub search response is invalid');
      }
      const items = data.items.map(record);
      const numbers = items.map((item) => item?.number);
      if (numbers.some((number) => !Number.isSafeInteger(number) || (number as number) < 1)) {
        throw new Error('GitHub search response is invalid');
      }
      if (items.some((item) => !item || 'pull_request' in item ||
          item.repository_url !== `${githubApi}/repos/${repository}` ||
          item.html_url !== `https://github.com/${repository}/issues/${item.number}`)) {
        throw new Error('GitHub search returned work outside the selected repository');
      }
      return { numbers: (numbers as number[]).slice(0, 10),
        incomplete: data.incomplete_results === true || (data.total_count as number) > 10 };
    },
    async issuePullRequests(repository, token, issue) {
      const events = await readPages(fetchImpl, `${root(repository)}/issues/${issue}/timeline`, token,
        AbortSignal.timeout(25_000));
      return [...new Set(events.flatMap((value) => {
        const event = record(value);
        const source = record(record(event?.source)?.issue);
        if (event?.event !== 'cross-referenced' || !record(source?.pull_request) ||
            typeof source?.html_url !== 'string' ||
            !source.html_url.startsWith(`https://github.com/${repository}/pull/`) ||
            !Number.isSafeInteger(source.number)) return [];
        return [source.number as number];
      }))];
    },
    async readPullRequest(repository, token, number) {
      const path = root(repository);
      const raw = record(await get(`${path}/pulls/${number}`, token));
      const parsed = pullRequestFromGitHub(raw);
      const head = record(raw?.head)?.sha;
      if (!raw || raw.number !== number || parsed.url !== `https://github.com/${repository}/pull/${number}` ||
          (raw.state !== 'open' && raw.state !== 'closed') ||
          typeof raw.merged !== 'boolean' || typeof head !== 'string' || !/^[a-f0-9]{40}$/iu.test(head) ||
          (raw.merge_commit_sha !== null && (typeof raw.merge_commit_sha !== 'string' ||
            !/^[a-f0-9]{40}$/iu.test(raw.merge_commit_sha)))) throw new Error('Invalid pull request');
      const [checks, status] = await Promise.all([
        get(`${path}/commits/${head}/check-runs?per_page=100`, token).then(record).catch(() => null),
        get(`${path}/commits/${head}/status`, token).then(record).catch(() => null),
      ]);
      const runs = Array.isArray(checks?.check_runs) ? checks.check_runs.map(record) : [];
      const checksIncomplete = !checks || !Array.isArray(checks.check_runs) ||
        !Number.isSafeInteger(checks.total_count) || checks.total_count !== runs.length ||
        runs.some((run) => !run || !['queued', 'in_progress', 'completed', 'waiting', 'pending', 'requested']
          .includes(String(run.status)) ||
          (run.status === 'completed' && !['success', 'neutral', 'skipped', 'failure', 'cancelled',
            'timed_out', 'action_required', 'startup_failure', 'stale'].includes(String(run.conclusion)))) ||
        !status || !Array.isArray(status.statuses) || !Number.isSafeInteger(status.total_count) ||
        status.total_count !== status.statuses.length ||
        !['pending', 'success', 'failure', 'error'].includes(String(status.state));
      const failed = status?.state === 'failure' || status?.state === 'error' ||
        runs.some((run) => ['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure']
          .includes(String(run?.conclusion)));
      const passed = !checksIncomplete && (runs.length > 0 || (status?.total_count as number) > 0) &&
        (status?.total_count === 0 || status?.state === 'success') &&
        runs.every((run) => run?.status === 'completed' && ['success', 'neutral', 'skipped'].includes(String(run.conclusion)));
      return { number, url: parsed.url, state: raw.merged ? 'merged' : raw.state,
        draft: parsed.draft, mergeSha: raw.merged ? raw.merge_commit_sha as string | null : null,
        linkedIssues: [...linkedIssueNumbers(parsed.body, repository)],
        ...(checksIncomplete ? { checksIncomplete: true } : {}),
        checks: failed ? 'failed' : passed ? 'passed' : 'pending' };
    },
    async read(repository, token, closedSince) {
      if (!repositoryPattern.test(repository) || !token || token.length > 4096 ||
          !Number.isFinite(Date.parse(closedSince))) {
        throw new Error('GitHub board request is invalid');
      }
      const [owner, name] = repository.split('/');
      const root = `/repos/${encodeURIComponent(owner!)}/${encodeURIComponent(name!)}`;
      const signal = AbortSignal.timeout(25_000);
      const [openIssues, recentlyUpdatedClosedIssues, openPulls] = await Promise.all([
        readPages(fetchImpl, `${root}/issues?state=open`, token, signal),
        readPages(fetchImpl, `${root}/issues?state=closed&since=${encodeURIComponent(closedSince)}`, token, signal),
        readPages(fetchImpl, `${root}/pulls?state=open`, token, signal),
      ]);
      const cutoff = Date.parse(closedSince);
      const candidates = [...openIssues, ...recentlyUpdatedClosedIssues]
        .map(issueFromGitHub)
        .filter((issue): issue is FactoryBoardIssue => issue !== null)
        .filter((issue) => issue.state === 'open' ||
          (issue.closedAt !== null && Date.parse(issue.closedAt) >= cutoff));
      const issues: FactoryBoardIssue[] = [];
      for (let offset = 0; offset < candidates.length; offset += 8) {
        const batch = candidates.slice(offset, offset + 8);
        issues.push(...await Promise.all(batch.map(async (issue) => {
          if (issue.blockedByCount === 0) return issue;
          const dependencies = await readPages(
            fetchImpl,
            `${root}/issues/${issue.number}/dependencies/blocked_by`,
            token,
            signal,
          );
          const blockedBy = dependencies.map((dependency) => {
            const blockedIssue = record(dependency);
            if (!blockedIssue || !Number.isSafeInteger(blockedIssue.number) ||
                (blockedIssue.number as number) < 1) {
              throw new Error('GitHub board response is invalid');
            }
            return blockedIssue.number as number;
          });
          if (blockedBy.length !== issue.blockedByCount) throw new Error('GitHub board response is incomplete');
          return { ...issue, blockedBy };
        })));
      }
      return { issues, pullRequests: openPulls.map(pullRequestFromGitHub) };
    },
  };
}

export class FactoryBoardCache {
  private readonly entries = new Map<string, { expiresAt: number; board: FactoryBoard }>();
  private readonly pending = new Map<string, { generation: number; promise: Promise<FactoryBoard> }>();
  private generation = 0;

  constructor(private readonly now: () => number = Date.now, private readonly ttlMs = 60_000) {}

  async get(projectId: string, load: () => Promise<FactoryBoard>): Promise<{ board: FactoryBoard; stale: boolean }> {
    const key = projectId;
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.now()) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return { board: cached.board, stale: false };
    }
    const pending = this.pending.get(key);
    if (pending?.generation === this.generation) {
      return pending.promise.then((board) => ({ board, stale: false }), () => {
        if (cached) return { board: cached.board, stale: true };
        throw new Error('Factory board is unavailable');
      });
    }

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
    try {
      return { board: await promise, stale: false };
    } catch {
      if (cached) return { board: cached.board, stale: true };
      throw new Error('Factory board is unavailable');
    }
  }

  invalidateAll(): void {
    this.entries.clear();
    this.generation += 1;
  }
}

export function linkedIssueNumbers(body: string | null, repository?: string): Set<number> {
  return new Set(Array.from(body?.matchAll(linkedIssuePattern) ?? []).flatMap((match) => {
    const referencedRepo = match[2] ?? match[4];
    if (referencedRepo && referencedRepo.toLowerCase() !== repository?.toLowerCase()) return [];
    const number = Number(match[1] ?? match[3] ?? match[5]);
    return Number.isSafeInteger(number) && number > 0 ? [number] : [];
  }));
}

export function desiredFactoryBoardStatus(
  issue: Pick<FactoryBoardIssue, 'number' | 'labels'> & { blockedBy: number | readonly number[] },
  linkedPullRequests: readonly Pick<FactoryBoardPullRequestSource, 'body' | 'draft'>[],
): 'Backlog' | 'Needs Dan' | 'Ready' | 'In progress' | 'In review' {
  const linked = linkedPullRequests.filter((pullRequest) => linkedIssueNumbers(pullRequest.body).has(issue.number));
  if (linked.some((pullRequest) => !pullRequest.draft)) return 'In review';
  const labels = new Set(issue.labels);
  if (linked.length > 0 ||
      issue.labels.some((label) => workerLabels.includes(label as typeof workerLabels[number]))) return 'In progress';
  if (labels.has(decisionLabel)) return 'Needs Dan';
  if (labels.has(deferredLabel) ||
      (typeof issue.blockedBy !== 'number' && issue.blockedBy.length > 0) ||
      typeof issue.blockedBy === 'number' && issue.blockedBy > 0) return 'Backlog';
  return 'Ready';
}

function taskOverlay(task: TaskRecord): FactoryBoardTask {
  return {
    id: task.id,
    state: task.state,
    agent: task.agent,
    activity: task.activity,
    attemptCount: task.attemptCount,
    branch: task.branch,
    startedAt: task.startedAt,
    latestSessionEndReason: task.latestSessionEndReason ?? null,
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
  stale = false,
): FactoryBoard {
  const cutoff = now - closedIssueWindowMs;
  const tasks = new Map(taskRecords.map((task) => [task.id, task]));
  const pullRequests = source.pullRequests.map((pullRequest) => ({
    ...pullRequest,
    checks: pullRequestRecords.find((record) => record.number === pullRequest.number)?.checks ?? null,
    taskId: pullRequestRecords.find((record) => record.number === pullRequest.number)?.taskId ?? null,
  }));
  const columns: FactoryBoardColumn[] = boardColumns.map(({ id }) => ({ id, cards: [] }));
  for (const issue of source.issues) {
    if (issue.state === 'closed' && (!issue.closedAt || Date.parse(issue.closedAt) < cutoff ||
        Date.parse(issue.closedAt) > now)) continue;
    const linked = pullRequests.filter((pullRequest) => linkedIssueNumbers(pullRequest.body).has(issue.number));
    const status = issue.state === 'closed' ? 'done' : boardColumns.find(({ label }) =>
      label === desiredFactoryBoardStatus(issue, linked))!.id;
    const linkedPullRequests = linked.map((pullRequest) => ({
      ...pullRequest,
      record: pullRequestRecords.find((record) => record.number === pullRequest.number),
    }));
    const linkedTask = linkedPullRequests.find(({ record }) => record?.taskId && tasks.has(record.taskId));
    const task = linkedTask?.record?.taskId ? tasks.get(linkedTask.record.taskId) : undefined;
    const primaryPullRequest = linkedTask ?? linkedPullRequests[0];
    const checks = primaryPullRequest?.record?.checks;
    const card: BoardCard = {
      issue: {
        number: issue.number,
        url: issue.url,
        title: issue.title,
        taskCode: issue.taskCode,
        labels: [...issue.labels],
        worker: issue.worker,
        state: issue.state,
        updatedAt: issue.updatedAt,
        closedAt: issue.closedAt,
        blockedBy: [...issue.blockedBy],
      },
      pr: primaryPullRequest ? {
        number: primaryPullRequest.number,
        url: primaryPullRequest.url,
        draft: primaryPullRequest.draft,
        checks: checks === 'passed' ? 'passing' : checks === 'failed' ? 'failing' : checks === 'pending' ? 'pending' : 'none',
      } : null,
      task: task ? taskOverlay(task) : null,
    };
    columns.find(({ id }) => id === status)!.cards.push(card);
  }
  for (const column of columns) {
    column.cards.sort((left, right) => column.id === 'done'
      ? Date.parse(right.issue.closedAt!) - Date.parse(left.issue.closedAt!) ||
        right.issue.number - left.issue.number
      : Date.parse(right.issue.updatedAt) - Date.parse(left.issue.updatedAt) ||
        right.issue.number - left.issue.number);
  }
  return {
    project: { id: projectId, repo: repository },
    fetchedAt: new Date(now).toISOString(),
    stale,
    columns,
  };
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
      const { board, stale } = await app.factoryBoardCache.get(project.id, async () => {
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
      const response = { ...board, stale };
      const serialized = JSON.stringify(response);
      if (Buffer.byteLength(serialized) > 1024 * 1024) {
        return reply.code(413).send({ error: 'Factory board response too large' });
      }
      return reply.header('Cache-Control', 'no-store').send(response);
    } catch {
      request.log.warn('factory.board_read_failed');
      return reply.code(502).send({ error: 'Factory board unavailable' });
    }
  });
}
