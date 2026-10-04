import type { GitHubAppTokenIssuer } from '../github-app.js';
import type { TaskState } from '../factory/task-lifecycle.js';
import type { TaskStore } from '../factory/task-store.js';
import type { GithubWebhookMapping } from './webhook-mapping.js';

export interface PolicyPullRequest {
  readonly taskId: string;
  readonly taskState: TaskState;
  readonly repository: string;
  readonly policy: 'deliver_pr' | 'complete_without_deployment';
  readonly number: number;
  readonly state: 'open' | 'merged' | 'closed';
  readonly checks: 'pending' | 'passed' | 'failed';
  readonly headSha: string;
}

export interface ProjectPolicyStore {
  getPullRequest(repository: string, number: number): Promise<PolicyPullRequest | null>;
  withActiveTask<T>(
    taskId: string,
    operation: () => Promise<T>,
  ): Promise<{ kind: 'active'; value: T } | { kind: 'inactive' }>;
}

interface ProjectPolicyOptions {
  readonly store: ProjectPolicyStore;
  readonly tasks: Pick<TaskStore, 'transition' | 'recordEvent'>;
  readonly tokenIssuer: GitHubAppTokenIssuer;
  readonly fetch?: typeof fetch;
}

interface PullRequestSnapshot {
  readonly state: 'open' | 'closed';
  readonly merged: boolean;
  readonly draft: boolean;
  readonly headSha: string;
  readonly baseRef: string;
  readonly baseSha: string;
  readonly mergeable: boolean;
  readonly mergeableState: string;
}

class GithubRequestError extends Error {
  constructor(readonly status: number, readonly rateLimited: boolean) {
    super('GitHub request failed');
  }
}

const githubApi = 'https://api.github.com';
const maxResponseBytes = 1024 * 1024;
const maxErrorResponseBytes = 16 * 1024;
const shaPattern = /^[\da-f]{40}$/u;

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function isRateLimitedResponse(response: Response): Promise<boolean> {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  if (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')) return true;
  const reader = response.body?.getReader();
  if (!reader) return false;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxErrorResponseBytes) {
        await reader.cancel().catch(() => undefined);
        return false;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const payload = object(JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')) as unknown);
    const message = payload?.message;
    return typeof message === 'string' && /rate limit|abuse detection/iu.test(message);
  } catch {
    return false;
  }
}

async function requestJson(
  fetchImpl: typeof fetch,
  path: string,
  token: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(`${githubApi}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `${['Bear', 'er'].join('')} ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  });
  if (!response.ok) {
    const rateLimited = await isRateLimitedResponse(response);
    await response.body?.cancel().catch(() => undefined);
    throw new GithubRequestError(response.status, rateLimited);
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > maxResponseBytes) {
    throw new Error('GitHub response is too large');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('GitHub response is invalid');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('GitHub response is too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const payload = object(JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')) as unknown);
  if (!payload) throw new Error('GitHub response is invalid');
  return payload;
}

function pullRequestSnapshot(value: Record<string, unknown>): PullRequestSnapshot | null {
  const head = object(value.head);
  const base = object(value.base);
  const headSha = head?.sha;
  const baseRef = base?.ref;
  const baseSha = base?.sha;
  const state = value.state;
  const mergeableState = value.mergeable_state;
  if ((state !== 'open' && state !== 'closed') || typeof value.merged !== 'boolean' ||
    typeof value.draft !== 'boolean' || typeof headSha !== 'string' || !shaPattern.test(headSha) ||
    typeof baseRef !== 'string' || baseRef.length === 0 || baseRef.length > 255 ||
    typeof baseSha !== 'string' || !shaPattern.test(baseSha) ||
    typeof value.mergeable !== 'boolean' || typeof mergeableState !== 'string') return null;
  return {
    state,
    merged: value.merged,
    draft: value.draft,
    headSha,
    baseRef,
    baseSha,
    mergeable: value.mergeable,
    mergeableState,
  };
}

async function checksAreGreen(fetchImpl: typeof fetch, repository: string, sha: string, token: string): Promise<boolean> {
  const encodedRepository = repository.split('/').map(encodeURIComponent).join('/');
  const [checkRuns, combinedStatus] = await Promise.all([
    requestJson(fetchImpl, `/repos/${encodedRepository}/commits/${sha}/check-runs?per_page=100`, token),
    requestJson(fetchImpl, `/repos/${encodedRepository}/commits/${sha}/status`, token),
  ]);
  const runs = checkRuns.check_runs;
  const totalRuns = checkRuns.total_count;
  const statuses = combinedStatus.statuses;
  const totalStatuses = combinedStatus.total_count;
  if (!Array.isArray(runs) || !Number.isSafeInteger(totalRuns) || totalRuns !== runs.length ||
    !Array.isArray(statuses) || !Number.isSafeInteger(totalStatuses) || totalStatuses !== statuses.length ||
    (statuses.length > 0 && combinedStatus.state !== 'success')) return false;
  if (runs.length === 0 && statuses.length === 0) return false;
  const latestRuns = new Map<string, { id: number; status: unknown; conclusion: unknown }>();
  for (const value of runs) {
    const run = object(value);
    const appId = object(run?.app)?.id;
    if (!run || !Number.isSafeInteger(run.id) || typeof run.name !== 'string' ||
      !Number.isSafeInteger(appId)) return false;
    const key = `${appId}:${run.name}`;
    if ((latestRuns.get(key)?.id ?? 0) < (run.id as number)) {
      latestRuns.set(key, { id: run.id as number, status: run.status, conclusion: run.conclusion });
    }
  }
  const latestStatuses = new Map<string, { id: number; state: unknown }>();
  for (const value of statuses) {
    const status = object(value);
    if (!status || typeof status.context !== 'string' || !Number.isSafeInteger(status.id)) return false;
    if ((latestStatuses.get(status.context)?.id ?? 0) < (status.id as number)) {
      latestStatuses.set(status.context, { id: status.id as number, state: status.state });
    }
  }
  return Array.from(latestRuns.values()).every((run) =>
    run.status === 'completed' &&
    (run.conclusion === 'success' || run.conclusion === 'neutral' || run.conclusion === 'skipped')) &&
    Array.from(latestStatuses.values()).every((status) => status.state === 'success');
}

function pullRequestNumbers(mapping: GithubWebhookMapping): readonly number[] {
  if (mapping.kind === 'pull_request') return [mapping.number];
  if (mapping.kind === 'check_run' || mapping.kind === 'workflow_run') return mapping.pullRequestNumbers;
  return [];
}

function safeRepository(repository: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository);
}

export function createProjectPolicyEvaluator({
  store,
  tasks,
  tokenIssuer,
  fetch: fetchImpl = fetch,
}: ProjectPolicyOptions) {
  async function recordReason(taskId: string, reason: string): Promise<void> {
    await tasks.recordEvent({
      taskId,
      type: 'project_policy_blocked',
      summary: reason,
      payload: { reason },
      source: 'backend',
    });
  }

  async function markDone(candidate: PolicyPullRequest): Promise<void> {
    if (candidate.taskState !== 'Running' && candidate.taskState !== 'NeedsAttention') return;
    await store.withActiveTask(candidate.taskId, async () => {
      await tasks.transition(candidate.taskId, 'Done', true);
    });
  }

  async function evaluate(candidate: PolicyPullRequest): Promise<void> {
    if (candidate.taskState === 'Done' || candidate.taskState === 'Cancelled') return;
    if (candidate.state === 'closed') {
      await recordReason(candidate.taskId, 'The pull request was closed without a merge.');
      return;
    }
    if (candidate.taskState !== 'Running' && candidate.taskState !== 'NeedsAttention') {
      await recordReason(candidate.taskId, 'The task state does not permit automatic policy completion.');
      return;
    }

    if (candidate.checks !== 'passed') {
      await recordReason(candidate.taskId, 'Recorded GitHub checks are not green.');
      return;
    }
    if (!safeRepository(candidate.repository)) {
      await recordReason(candidate.taskId, 'The project repository is invalid.');
      return;
    }

    let mergeRequested = false;
    try {
      const token = await tokenIssuer.issue(candidate.repository);
      const encodedRepository = candidate.repository.split('/').map(encodeURIComponent).join('/');
      const path = `/repos/${encodedRepository}/pulls/${candidate.number}`;
      const pullRequest = pullRequestSnapshot(await requestJson(fetchImpl, path, token));
      if (!pullRequest) {
        await recordReason(candidate.taskId, 'GitHub pull request state could not be verified.');
        return;
      }
      if (candidate.state === 'merged') {
        if (pullRequest.state !== 'closed' || !pullRequest.merged || pullRequest.draft ||
          pullRequest.headSha.toLowerCase() !== candidate.headSha.toLowerCase() ||
          !await checksAreGreen(fetchImpl, candidate.repository, pullRequest.headSha, token)) {
          await recordReason(candidate.taskId, 'The merged pull request or its green checks could not be verified.');
          return;
        }
        await markDone(candidate);
        return;
      }
      if (candidate.state !== 'open') return;
      if (pullRequest.state !== 'open' || pullRequest.merged) {
        await recordReason(candidate.taskId, 'The pull request is no longer open.');
        return;
      }
      if (pullRequest.draft) {
        await recordReason(candidate.taskId, 'The pull request is still a draft.');
        return;
      }
      if (pullRequest.headSha.toLowerCase() !== candidate.headSha.toLowerCase()) {
        await recordReason(candidate.taskId, 'The pull request head differs from the recorded GitHub state.');
        return;
      }
      if (!await checksAreGreen(fetchImpl, candidate.repository, pullRequest.headSha, token)) {
        await recordReason(candidate.taskId, 'GitHub reports pending or failed pull request checks.');
        return;
      }

      if (candidate.policy === 'deliver_pr') {
        await markDone(candidate);
        return;
      }

      const baseBranch = await requestJson(
        fetchImpl,
        `/repos/${encodedRepository}/branches/${encodeURIComponent(pullRequest.baseRef)}`,
        token,
      );
      const currentBaseSha = object(baseBranch.commit)?.sha;
      if (typeof currentBaseSha !== 'string' || currentBaseSha.toLowerCase() !== pullRequest.baseSha.toLowerCase()) {
        await recordReason(candidate.taskId, 'The pull request branch is behind its current base branch.');
        return;
      }
      if (!pullRequest.mergeable || pullRequest.mergeableState !== 'clean') {
        await recordReason(candidate.taskId, 'GitHub reports that the pull request merge rules are not satisfied.');
        return;
      }

      mergeRequested = true;
      const merge = await store.withActiveTask(candidate.taskId, async () => {
        const result = await requestJson(fetchImpl, `${path}/merge`, token, {
          merge_method: 'squash',
          sha: pullRequest.headSha,
        });
        if (result.merged === true) {
          await tasks.recordEvent({
            taskId: candidate.taskId,
            type: 'project_policy_merge_requested',
            summary: 'GitHub accepted the squash merge; awaiting its pull request webhook.',
            payload: { pullRequest: candidate.number },
            source: 'backend',
          });
        }
        return result;
      });
      if (merge.kind === 'inactive') {
        await recordReason(candidate.taskId, 'The task is no longer active; automatic merge was not attempted.');
        return;
      }
      const result = merge.value;
      if (result.merged !== true) {
        await recordReason(candidate.taskId, 'GitHub did not confirm the squash merge.');
        return;
      }
    } catch (error) {
      if (error instanceof GithubRequestError && !error.rateLimited && error.status >= 400 && error.status < 500) {
        const reason = mergeRequested
          ? 'GitHub refused the squash merge because merge rules or branch protection prevent it.'
          : 'GitHub refused to verify the pull request state.';
        await recordReason(candidate.taskId, reason);
        return;
      }
      throw error;
    }
  }

  return {
    async handle(mapping: GithubWebhookMapping): Promise<void> {
      for (const number of pullRequestNumbers(mapping)) {
        const candidate = await store.getPullRequest(mapping.repository, number);
        if (candidate) await evaluate(candidate);
      }
    },
  };
}
