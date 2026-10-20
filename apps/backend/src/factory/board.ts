import type {
  BoardCard, FactoryBoard, FactoryBoardColumn, FactoryBoardColumnId, FactoryBoardTask,
} from '@jarvis/contracts';
import { performance } from 'node:perf_hooks';
import { isFactoryBoard } from '@jarvis/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { GitHubAppTokenIssuer } from '../github-app.js';
import type { TaskRecord } from './task-store.js';
import { boardReadError, FactoryBoardReadError, readBoardStage } from './board-errors.js';

const githubApi = 'https://api.github.com';
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const maxResponseBytes = 4 * 1024 * 1024;
const maxPages = 10;
const pageSize = 100;
const maxConcurrentRequests = 8;
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
type FactoryBoardStage = 'project' | 'token' | 'source' | 'task' | 'release' | 'response';
type FactoryBoardCachePath = 'cache_hit' | 'shared_wait' | 'source_load';

export function boardDurationFields(
  durationMs: number,
): { durationMs: number } | { durationCensored: true } | { durationUnavailable: true } {
  if (!Number.isFinite(durationMs) || durationMs < 0) return { durationUnavailable: true };
  if (durationMs > 60_000) return { durationCensored: true };
  return { durationMs: Math.round(durationMs) };
}

async function logBoardPhase<T>(
  request: FastifyRequest,
  stage: FactoryBoardStage,
  work: () => Promise<T>,
  part?: 'assemble' | 'serialize',
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await work();
  } finally {
    request.log.info({
      reqId: request.id,
      route: request.routeOptions.url,
      stage,
      ...(part === undefined ? {} : { part }),
      ...boardDurationFields(performance.now() - startedAt),
    }, 'factory.board_phase');
  }
}

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
    throw new FactoryBoardReadError('source', 'invalid_response');
  }
  const url = githubUrl(issue.html_url);
  const labelNames = labels.map((label) => {
    const name = record(label)?.name;
    if (typeof name !== 'string' || name.length > 100) throw new FactoryBoardReadError('source', 'invalid_response');
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
    closedAt: closedAt === null ? null : new Date(closedAt as string).toISOString(),
    blockedBy: [],
    blockedByCount: (dependency?.blocked_by as number | undefined) ?? 0,
    body: body as string | null,
  };
}

function githubUrl(value: unknown): string {
  if (typeof value !== 'string') throw new FactoryBoardReadError('source', 'invalid_response');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FactoryBoardReadError('source', 'invalid_response');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.port) {
    throw new FactoryBoardReadError('source', 'invalid_response');
  }
  return url.toString();
}

function pullRequestFromGitHub(value: unknown): FactoryBoardPullRequestSource {
  const pullRequest = record(value);
  if (!pullRequest || !Number.isSafeInteger(pullRequest.number) || (pullRequest.number as number) < 1 ||
      typeof pullRequest.body !== 'string' && pullRequest.body !== null ||
      typeof pullRequest.draft !== 'boolean' || typeof pullRequest.html_url !== 'string') {
    throw new FactoryBoardReadError('source', 'invalid_response');
  }
  return {
    number: pullRequest.number as number,
    body: pullRequest.body as string | null,
    url: githubUrl(pullRequest.html_url),
    draft: pullRequest.draft,
  };
}

async function readResponse(response: Response): Promise<unknown> {
  if (!response.ok) throw new FactoryBoardReadError('source', 'request_failed', response.status);
  const length = response.headers.get('content-length');
  if (length !== null && Number(length) > maxResponseBytes) throw new FactoryBoardReadError('source', 'response_too_large');
  const reader = response.body?.getReader();
  if (!reader) throw new FactoryBoardReadError('source', 'invalid_response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new FactoryBoardReadError('source', 'response_too_large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')) as unknown;
  } catch {
    throw new FactoryBoardReadError('source', 'invalid_response');
  }
}

interface RequestLimiter {
  read(url: string, signal: AbortSignal): Promise<{ response: Response; result: unknown }>;
}

function createRequestLimiter(fetchImpl: typeof fetch, token: string): RequestLimiter {
  let active = 0;
  const waiting: {
    signal: AbortSignal;
    resolve: () => void;
    reject: (error: unknown) => void;
    onAbort: () => void;
  }[] = [];

  function acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const grant = () => {
        signal.removeEventListener('abort', onAbort);
        active += 1;
        resolve(() => {
          active -= 1;
          while (waiting.length > 0) {
            const next = waiting.shift()!;
            next.signal.removeEventListener('abort', next.onAbort);
            if (next.signal.aborted) {
              next.reject(next.signal.reason);
              continue;
            }
            next.resolve();
            break;
          }
        });
      };
      const onAbort = () => {
        const index = waiting.findIndex((entry) => entry.onAbort === onAbort);
        if (index >= 0) waiting.splice(index, 1);
        reject(signal.reason);
      };
      if (active < maxConcurrentRequests) {
        grant();
      } else {
        waiting.push({ signal, resolve: grant, reject, onAbort });
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  return {
    async read(url, signal) {
      let release: (() => void) | undefined;
      try {
        release = await acquire(signal);
        const response = await fetchImpl(url, {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `${['Bear', 'er'].join('')} ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
          signal,
          redirect: 'error',
        });
        return { response, result: await readResponse(response) };
      } catch (error) {
        if (error instanceof FactoryBoardReadError) throw error;
        const diagnostic = boardReadError('source', error);
        throw diagnostic.reason === 'unexpected'
          ? new FactoryBoardReadError('source', 'transport_failed')
          : diagnostic;
      } finally {
        release?.();
      }
    },
  };
}

interface PagePosition {
  readonly page?: number;
  readonly after?: string;
}

interface PageLinks {
  readonly next?: PagePosition;
  readonly lastPage?: number;
  readonly repositoryId?: string;
}

function paginationPage(response: Response, path: string, position: PagePosition): PageLinks {
  const header = response.headers.get('link');
  if (!header) return {};
  if (header.length > 8192) throw new FactoryBoardReadError('source', 'invalid_response');

  const baseUrl = new URL(`${githubApi}${path}`);
  const repositoryPath = /^\/repos\/[^/]+\/[^/]+(?=\/|$)/u.exec(baseUrl.pathname)?.[0];
  if (!repositoryPath) throw new FactoryBoardReadError('source', 'invalid_response');
  const endpointSuffix = baseUrl.pathname.slice(repositoryPath.length);
  const expectedQuery = [...baseUrl.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  const relations = new Map<string, number>();
  const seenRelations = new Set<string>();
  let next: PagePosition | undefined;
  let repositoryId: string | undefined;
  const entries = header.split(/,\s*(?=<)/u);
  if (entries.length > 4) throw new FactoryBoardReadError('source', 'invalid_response');
  for (const entry of entries) {
    const trimmed = entry.trim();
    const closingBracket = trimmed.indexOf('>');
    if (!trimmed.startsWith('<') || closingBracket <= 1) {
      throw new FactoryBoardReadError('source', 'invalid_response');
    }
    const target = trimmed.slice(1, closingBracket);
    let parameters = trimmed.slice(closingBracket + 1).trim();
    if (!parameters.startsWith(';')) throw new FactoryBoardReadError('source', 'invalid_response');
    parameters = parameters.slice(1).trim();
    if (!parameters.startsWith('rel="')) throw new FactoryBoardReadError('source', 'invalid_response');
    const relationEnd = parameters.indexOf('"', 5);
    if (relationEnd < 0) throw new FactoryBoardReadError('source', 'invalid_response');
    const relation = parameters.slice(5, relationEnd);
    if (!['first', 'prev', 'next', 'last'].includes(relation) || seenRelations.has(relation)) {
      throw new FactoryBoardReadError('source', 'invalid_response');
    }
    seenRelations.add(relation);
    const trailingParameters = parameters.slice(relationEnd + 1).trim();
    if (trailingParameters && (!trailingParameters.startsWith(';') ||
        trailingParameters.slice(1).split(';').some((parameter) => !parameter.trim()))) {
      throw new FactoryBoardReadError('source', 'invalid_response');
    }
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      throw new FactoryBoardReadError('source', 'invalid_response');
    }
    let linkRepositoryId: string | undefined;
    if (url.pathname !== baseUrl.pathname) {
      const canonicalPrefix = '/repositories/';
      if (!url.pathname.startsWith(canonicalPrefix)) {
        throw new FactoryBoardReadError('source', 'invalid_response');
      }
      const canonicalPath = url.pathname.slice(canonicalPrefix.length);
      const slash = canonicalPath.indexOf('/');
      linkRepositoryId = slash < 0 ? canonicalPath : canonicalPath.slice(0, slash);
      const suffix = slash < 0 ? '' : canonicalPath.slice(slash);
      if (!/^[1-9]\d{0,19}$/u.test(linkRepositoryId) || suffix !== endpointSuffix) {
        throw new FactoryBoardReadError('source', 'invalid_response');
      }
      if (repositoryId !== undefined && repositoryId !== linkRepositoryId) {
        throw new FactoryBoardReadError('source', 'incomplete_response');
      }
      repositoryId = linkRepositoryId;
    }
    const pageValues = url.searchParams.getAll('page');
    const cursorValues = url.searchParams.getAll('after');
    const previousCursorValues = url.searchParams.getAll('before');
    const linkPage = pageValues[0];
    const linkPageNumber = linkPage === undefined || !/^[1-9]\d*$/u.test(linkPage) ? NaN : Number(linkPage);
    const cursor = cursorValues[0];
    const previousCursor = previousCursorValues[0];
    const actualQuery = [...url.searchParams.entries()]
      .filter(([key]) => !['page', 'per_page', 'after', 'before'].includes(key))
      .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
        leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
    if (url.origin !== githubApi || url.username || url.password || url.hash || url.port ||
        url.searchParams.getAll('per_page').length !== 1 || url.searchParams.get('per_page') !== String(pageSize) ||
        pageValues.length > 1 || cursorValues.length > 1 || previousCursorValues.length > 1 ||
        (pageValues.length !== 1 && cursorValues.length !== 1 && previousCursorValues.length !== 1) ||
        (pageValues.length === 1 && (!Number.isSafeInteger(linkPageNumber) || linkPageNumber < 1)) ||
        (cursorValues.length === 1 && (!cursor || cursor.length > 2048 || relation !== 'next')) ||
        (previousCursorValues.length === 1 &&
          (!previousCursor || previousCursor.length > 2048 || relation !== 'prev' || pageValues.length !== 1)) ||
        ((relation === 'first' || relation === 'last' || relation === 'prev') && pageValues.length !== 1) ||
        JSON.stringify(actualQuery) !== JSON.stringify(expectedQuery)) {
      throw new FactoryBoardReadError('source', 'invalid_response');
    }
    if (relation === 'next') {
      if (cursorValues.length === 1) {
        next = { ...(pageValues.length === 1 ? { page: linkPageNumber } : {}), after: cursor! };
      } else {
        next = { page: linkPageNumber };
      }
    } else if (relation === 'last') {
      relations.set(relation, linkPageNumber);
    } else if (pageValues.length === 1) {
      relations.set(relation, linkPageNumber);
    }
  }

  const lastPage = relations.get('last');
  const requestedPage = position.page;
  if ((position.after !== undefined && lastPage !== undefined) ||
      (requestedPage !== undefined && next?.page !== undefined && next.page !== requestedPage + 1) ||
      (requestedPage !== undefined && lastPage !== undefined &&
        ((next !== undefined) !== (requestedPage < lastPage) || lastPage < requestedPage)) ||
      (relations.has('first') && relations.get('first') !== 1) ||
      (relations.has('prev') && requestedPage !== undefined &&
        (requestedPage < 2 || relations.get('prev') !== requestedPage - 1)) ||
      (requestedPage === 1 && relations.has('prev')) ||
      (next?.after !== undefined && lastPage !== undefined)) {
    throw new FactoryBoardReadError('source', 'invalid_response');
  }
  return { ...(next ? { next } : {}), ...(lastPage !== undefined ? { lastPage } : {}),
    ...(repositoryId ? { repositoryId } : {}) };
}

async function readPages(
  limiter: RequestLimiter,
  path: string,
  signal: AbortSignal,
): Promise<unknown[]> {
  async function readPage(
    position: PagePosition,
    pageSignal = signal,
  ): Promise<{ items: unknown[]; links: PageLinks }> {
    const url = new URL(`${githubApi}${path}`);
    url.searchParams.set('per_page', String(pageSize));
    if (position.after !== undefined) {
      if (position.page === undefined) url.searchParams.delete('page');
      else url.searchParams.set('page', String(position.page));
      url.searchParams.set('after', position.after);
    } else {
      url.searchParams.delete('after');
      url.searchParams.set('page', String(position.page));
    }
    const { response, result } = await limiter.read(url.toString(), pageSignal);
    if (!Array.isArray(result) || result.length > pageSize) throw new FactoryBoardReadError('source', 'invalid_response');
    const links = paginationPage(response, path, position);
    if (links.lastPage !== undefined && links.lastPage > maxPages) {
      throw new FactoryBoardReadError('source', 'result_limit');
    }
    if (links.next && result.length !== pageSize) {
      throw new FactoryBoardReadError('source', 'incomplete_response');
    }
    if ((position.page !== 1 || position.after !== undefined) && result.length === 0) {
      throw new FactoryBoardReadError('source', 'incomplete_response');
    }
    return { items: result, links };
  }

  const first = await readPage({ page: 1 });
  const items = [...first.items];
  let repositoryId = first.links.repositoryId;
  let next = first.links.next;
  let pageCount = 1;
  const lastPage = first.links.lastPage;
  if (lastPage !== undefined) {
    if (lastPage > 1 && next?.page !== 2) {
      throw new FactoryBoardReadError('source', 'incomplete_response');
    }
    const pages = await readTogether(
      Array.from({ length: lastPage - 1 }, (_, index) => async (pageSignal) => {
        const page = index + 2;
        const result = await readPage({ page }, pageSignal);
        if (result.links.lastPage !== undefined && result.links.lastPage !== lastPage ||
            (result.links.next?.page !== undefined && result.links.next.page !== page + 1) ||
            (page < lastPage && result.links.next?.page !== page + 1) ||
            (page === lastPage && result.links.next !== undefined) ||
            (repositoryId !== undefined && result.links.repositoryId !== undefined &&
              result.links.repositoryId !== repositoryId)) {
          throw new FactoryBoardReadError('source', 'incomplete_response');
        }
        repositoryId ??= result.links.repositoryId;
        return result.items;
      }),
      signal,
    );
    items.push(...pages.flat());
  } else {
    const seenCursors = new Set<string>();
    while (next) {
      if (pageCount >= maxPages) throw new FactoryBoardReadError('source', 'result_limit');
      if (next.after !== undefined) {
        if (seenCursors.has(next.after)) throw new FactoryBoardReadError('source', 'incomplete_response');
        seenCursors.add(next.after);
      }
      const requested = next;
      const result = await readPage(requested);
      if (repositoryId !== undefined && result.links.repositoryId !== undefined &&
          result.links.repositoryId !== repositoryId) {
        throw new FactoryBoardReadError('source', 'incomplete_response');
      }
      repositoryId ??= result.links.repositoryId;
      if (requested.after !== undefined && result.links.next !== undefined &&
          result.links.next.after === undefined) {
        throw new FactoryBoardReadError('source', 'incomplete_response');
      }
      items.push(...result.items);
      next = result.links.next;
      pageCount += 1;
    }
  }
  const identities = new Set<string>();
  for (const item of items) {
    const value = record(item);
    const identity = Number.isSafeInteger(value?.number) && (value!.number as number) > 0
      ? `number:${value!.number}`
      : typeof value?.id === 'string' || Number.isSafeInteger(value?.id) ? `id:${value?.id}` : undefined;
    if (identity && identities.has(identity)) throw new FactoryBoardReadError('source', 'incomplete_response');
    if (identity) identities.add(identity);
  }
  return items;
}

async function readTogether<T extends readonly unknown[]>(
  reads: { [K in keyof T]: (signal: AbortSignal) => Promise<T[K]> },
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let failed = false;
  let firstError: unknown;
  const pending = reads.map((read) => Promise.resolve().then(() => read(combinedSignal)).catch((error: unknown) => {
    if (!failed) {
      failed = true;
      firstError = error;
      controller.abort(error);
    }
    throw error;
  }));
  const results = await Promise.allSettled(pending);
  if (failed) throw firstError;
  return results.map((result) => (result as PromiseFulfilledResult<T[number]>).value) as unknown as T;
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
      const events = await readPages(
        createRequestLimiter(fetchImpl, token),
        `${root(repository)}/issues/${issue}/timeline`,
        AbortSignal.timeout(25_000),
      );
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
      const limiter = createRequestLimiter(fetchImpl, token);
      const [openIssues, recentlyUpdatedClosedIssues, openPulls] = await readTogether([
        (readSignal) => readPages(limiter, `${root}/issues?state=open`, readSignal),
        (readSignal) => readPages(limiter, `${root}/issues?state=closed&since=${encodeURIComponent(closedSince)}`, readSignal),
        (readSignal) => readPages(limiter, `${root}/pulls?state=open`, readSignal),
      ] as const, signal);
      const cutoff = Date.parse(closedSince);
      const candidates = [...openIssues, ...recentlyUpdatedClosedIssues]
        .map(issueFromGitHub)
        .filter((issue): issue is FactoryBoardIssue => issue !== null)
        .filter((issue) => issue.state === 'open' ||
          (issue.closedAt !== null && Date.parse(issue.closedAt) >= cutoff));
      if (new Set(candidates.map(({ number }) => number)).size !== candidates.length) {
        throw new FactoryBoardReadError('source', 'incomplete_response');
      }
      const issues = await readTogether(candidates.map((issue) => async (readSignal) => {
        if (issue.blockedByCount === 0) return issue;
        const dependencies = await readPages(
          limiter,
          `${root}/issues/${issue.number}/dependencies/blocked_by`,
          readSignal,
        );
        // The summary's blocked_by counts OPEN blockers only, while the list also returns closed ones.
        const blockedBy = dependencies.flatMap((dependency) => {
          const blockedIssue = record(dependency);
          if (!blockedIssue || !Number.isSafeInteger(blockedIssue.number) ||
              (blockedIssue.number as number) < 1 ||
              (blockedIssue.state !== 'open' && blockedIssue.state !== 'closed')) {
            throw new FactoryBoardReadError('source', 'invalid_response');
          }
          return blockedIssue.state === 'open' ? [blockedIssue.number as number] : [];
        });
        if (blockedBy.length !== issue.blockedByCount) throw new FactoryBoardReadError('source', 'incomplete_response');
        return { ...issue, blockedBy };
      }), signal);
      return { issues, pullRequests: openPulls.map(pullRequestFromGitHub) };
    },
  };
}

interface CachedFactoryBoard {
  expiresAt: number;
  invalidated: boolean;
  board: FactoryBoard;
}

interface FactoryBoardCacheSnapshot {
  entry: CachedFactoryBoard;
  failure?: unknown;
}

interface PendingFactoryBoard {
  dirty: boolean;
  promise: Promise<FactoryBoardCacheSnapshot>;
}

export class FactoryBoardCache {
  private readonly entries = new Map<string, CachedFactoryBoard>();
  private readonly pending = new Map<string, PendingFactoryBoard>();

  constructor(private readonly now: () => number = Date.now, private readonly ttlMs = 60_000) {}

  async get(
    projectId: string,
    load: () => Promise<FactoryBoard>,
    onCachePath?: (path: FactoryBoardCachePath) => void,
  ): Promise<{
    board: FactoryBoard; stale: boolean; failure?: unknown;
  }> {
    const key = projectId;
    const cached = this.entries.get(key);
    if (cached && !cached.invalidated && cached.expiresAt > this.now()) {
      onCachePath?.('cache_hit');
      this.entries.delete(key);
      this.entries.set(key, cached);
      return { board: cached.board, stale: false };
    }
    const pending = this.pending.get(key);
    if (pending) {
      onCachePath?.('shared_wait');
      return this.result(await pending.promise);
    }

    onCachePath?.('source_load');
    let resolve!: (snapshot: FactoryBoardCacheSnapshot) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<FactoryBoardCacheSnapshot>((resolveSnapshot, rejectSnapshot) => {
      resolve = resolveSnapshot;
      reject = rejectSnapshot;
    });
    const owner = { dirty: false, promise };
    this.pending.set(key, owner);
    void this.loadOwned(key, owner, load, cached).then((snapshot) => {
      if (this.pending.get(key) === owner) this.pending.delete(key);
      resolve(snapshot);
    }, (error: unknown) => {
      if (this.pending.get(key) === owner) this.pending.delete(key);
      reject(error);
    });
    return this.result(await promise);
  }

  private result({ entry, ...diagnostic }: FactoryBoardCacheSnapshot): {
    board: FactoryBoard; stale: boolean; failure?: unknown;
  } {
    // Publication can invalidate an entry after loading but before a waiter settles.
    return {
      board: entry.board,
      stale: entry.invalidated || entry.expiresAt <= this.now(),
      ...diagnostic,
    };
  }

  private remember(projectId: string, board: FactoryBoard, invalidated: boolean): CachedFactoryBoard {
    const now = this.now();
    const entry = { board, invalidated, expiresAt: invalidated ? now : now + this.ttlMs };
    this.entries.delete(projectId);
    this.entries.set(projectId, entry);
    if (this.entries.size > 32) {
      const [oldest, evicted] = this.entries.entries().next().value!;
      // Outstanding snapshots must become stale before losing invalidation reachability.
      evicted.invalidated = true;
      evicted.expiresAt = Math.min(evicted.expiresAt, now);
      this.entries.delete(oldest);
    }
    return entry;
  }

  private async loadOwned(
    projectId: string,
    owner: PendingFactoryBoard,
    load: () => Promise<FactoryBoard>,
    fallback?: CachedFactoryBoard,
  ): Promise<FactoryBoardCacheSnapshot> {
    try {
      fallback = this.remember(projectId, await load(), owner.dirty);
      if (owner.dirty) {
        owner.dirty = false;
        // One follow-up, not an unbounded drain while live updates continue.
        fallback = this.remember(projectId, await load(), owner.dirty);
      }
      return { entry: fallback };
    } catch (error) {
      if (fallback) return { entry: fallback, failure: error };
      throw error;
    }
  }

  invalidate(projectId: string): void {
    const cached = this.entries.get(projectId);
    if (cached) {
      cached.invalidated = true;
      cached.expiresAt = Math.min(cached.expiresAt, this.now());
    }
    const pending = this.pending.get(projectId);
    if (pending) pending.dirty = true;
  }

  invalidateAll(): void {
    for (const projectId of this.entries.keys()) this.invalidate(projectId);
    for (const pending of this.pending.values()) pending.dirty = true;
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
  if (issue.labels.some((label) => workerLabels.includes(label as typeof workerLabels[number]))) return 'In progress';
  if (linked.length > 0 && !labels.has(decisionLabel)) return 'In progress';
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
    const task = (linkedTask?.record?.taskId ? tasks.get(linkedTask.record.taskId) : undefined) ??
      taskRecords.find((record) => record.projectId === projectId && record.issueNumber === issue.number);
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
    let outcome: 'success' | 'failure' | 'not_found' | 'unavailable' = 'failure';
    let cachePath: FactoryBoardCachePath | 'not_started' = 'not_started';
    let cacheElapsedFields: ReturnType<typeof boardDurationFields> | undefined;
    let stale = false;
    try {
      const projects = app.projectStore;
      const tasks = app.taskStore;
      const releases = app.releaseViewStore;
      const tokenIssuer: GitHubAppTokenIssuer | null = app.githubAppTokenIssuer;
      if (!isSqlBigInt(request.query.project)) return reply.code(400).send({ error: 'Invalid project ID' });
      if (!projects || !tasks || !releases || !tokenIssuer) {
        outcome = 'unavailable';
        return reply.code(503).send({ error: 'Factory board service unavailable' });
      }
      let project;
      try {
        project = await logBoardPhase(request, 'project', async () =>
          (await projects.list()).find((candidate) => candidate.id === request.query.project && candidate.active));
      } catch (error) {
        const { stage, reason, status } = boardReadError('project', error);
        request.log.warn({
          reqId: request.id, route: request.routeOptions.url, stage, reason, status,
        }, 'factory.board_project_lookup_failed');
        outcome = 'unavailable';
        return reply.code(503).send({ error: 'Factory board service unavailable' });
      }
      if (!project) {
        outcome = 'not_found';
        return reply.code(404).send({ error: 'Project not found' });
      }

      try {
        const cacheStartedAt = performance.now();
        let cached;
        try {
          cached = await app.factoryBoardCache.get(project.id, async () => {
            const now = Date.now();
            const closedSince = new Date(now - closedIssueWindowMs).toISOString();
            const token = await logBoardPhase(request, 'token', () =>
              readBoardStage('token', () => tokenIssuer.issueForRepositoryRead(project.repo)));
            const [source, taskRecords, releaseRecords] = await readTogether([
              () => logBoardPhase(request, 'source', () =>
                readBoardStage('source', () => app.factoryBoardReader.read(project.repo, token, closedSince))),
              () => logBoardPhase(request, 'task', () =>
                readBoardStage('task', () => tasks.list({ projectId: project!.id, limit: 1000, offset: 0 }))),
              () => logBoardPhase(request, 'release', () =>
                readBoardStage('release', () => releases.read(project!.id))),
            ] as const);
            return logBoardPhase(request, 'response', async () => {
              const board = createFactoryBoard(
                project!.id,
                project!.repo,
                source,
                taskRecords,
                releaseRecords.pullRequests,
                now,
              );
              if (!isFactoryBoard(board)) throw new FactoryBoardReadError('response', 'invalid_response');
              return board;
            }, 'assemble');
          }, (path) => { cachePath = path; });
        } finally {
          cacheElapsedFields = boardDurationFields(performance.now() - cacheStartedAt);
        }
        const { board, stale: usedStale, failure } = cached;
        stale = usedStale;
        if (stale && 'failure' in cached) {
          const { stage, reason, status } = boardReadError('response', failure);
          request.log.warn({
            reqId: request.id, route: request.routeOptions.url, stage, reason, status, stale: true,
          }, 'factory.board_read_failed');
        }
        const response = { ...board, stale };
        const serialized = await logBoardPhase(request, 'response', async () => JSON.stringify(response), 'serialize');
        if (Buffer.byteLength(serialized) > 1024 * 1024) {
          request.log.warn({
            reqId: request.id, route: request.routeOptions.url,
            stage: 'response', reason: 'response_too_large', status: 413,
          }, 'factory.board_read_failed');
          return reply.code(413).send({ error: 'Factory board response too large' });
        }
        const sent = reply.header('Cache-Control', 'no-store').send(response);
        outcome = 'success';
        return sent;
      } catch (error) {
        const { stage, reason, status } = boardReadError('response', error);
        request.log.warn({
          reqId: request.id, route: request.routeOptions.url, stage, reason, status, stale: false,
        }, 'factory.board_read_failed');
        return reply.code(502).send({ error: 'Factory board unavailable' });
      }
    } finally {
      request.log.info({
        reqId: request.id,
        route: request.routeOptions.url,
        outcome,
        cachePath,
        stale,
        ...(cacheElapsedFields && 'durationMs' in cacheElapsedFields
          ? { cacheElapsedMs: cacheElapsedFields.durationMs }
          : cacheElapsedFields && 'durationCensored' in cacheElapsedFields
            ? { cacheElapsedCensored: true }
            : cacheElapsedFields ? { cacheElapsedUnavailable: true } : {}),
        statusCode: reply.statusCode,
      }, 'factory.board_read_timing');
    }
  });
}
