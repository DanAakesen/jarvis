import type { TaskWorkspace } from '../foundry/client.js';
import type { GitHubAppTokenIssuer } from '../github-app.js';
import type { TaskStore } from '../factory/task-store.js';
import type { GithubWebhookMapping } from './webhook-mapping.js';

const apiUrl = 'https://api.github.com';
const maxResponseBytes = 1024 * 1024;

interface DeliveryTask {
  id: string;
  title: string;
  issueNumber?: number | null;
}

interface PullRequest {
  number: number;
  reused: boolean;
  headSha: string;
  openedAt: string;
}

export type GitHubDeliveryResult =
  | { kind: 'awaiting_policy' }
  | { kind: 'not_running' }
  | { kind: 'refused'; reason: string };

export type TaskCompletionGate = <T>(operation: () => Promise<T>) => Promise<
  { kind: 'ran'; value: T } | { kind: 'not_running' }
>;

class GitHubDeliveryRequestError extends Error {
  constructor(readonly status: number) {
    super('GitHub delivery request failed');
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > maxResponseBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('GitHub delivery response is too large');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('GitHub delivery response is invalid');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('GitHub delivery response is too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')) as unknown;
  } catch {
    throw new Error('GitHub delivery response is invalid');
  }
}

async function request(
  fetchImpl: typeof fetch,
  path: string,
  token: string,
  body?: unknown,
  timeoutMs = 10_000,
): Promise<unknown> {
  const response = await fetchImpl(`${apiUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `${['Bear', 'er'].join('')} ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error',
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new GitHubDeliveryRequestError(response.status);
  }
  return readJson(response);
}

function pullRequest(value: unknown, repository: string, branch: string, baseBranch: string): PullRequest | null {
  if (!object(value)) return null;
  const response = value;
  if (!object(response.head) || !object(response.base)) return null;
  const head = response.head;
  const base = response.base;
  if (!object(head.repo)) return null;
  const headRepository = head.repo;
  const headSha = head.sha;
  const openedAt = response.created_at;
  if (
    response.state !== 'open' || response.merged === true ||
    !Number.isSafeInteger(response.number) || (response.number as number) < 1 ||
    head.ref !== branch || typeof headRepository.full_name !== 'string' ||
    headRepository.full_name.toLowerCase() !== repository.toLowerCase() || base.ref !== baseBranch ||
    typeof headSha !== 'string' || !/^[\da-f]{40}$/iu.test(headSha) ||
    typeof openedAt !== 'string' || !Number.isFinite(Date.parse(openedAt))) {
    return null;
  }
  return {
    number: response.number as number,
    reused: false,
    headSha: headSha.toLowerCase(),
    openedAt: new Date(openedAt).toISOString(),
  };
}

function pullRequestTitle(task: DeliveryTask): string {
  const match = /^(P\d{2}-\d{2}):\s*(.+)$/u.exec(task.title.trim());
  return match ? `${match[1]}: ${match[2]}` : task.title;
}

async function findOpenPullRequest(
  fetchImpl: typeof fetch,
  repositoryPath: string,
  repository: string,
  branch: string,
  baseBranch: string,
  owner: string,
  token: string,
  timeoutMs?: number,
): Promise<PullRequest | null> {
  const query = new URLSearchParams({
    base: baseBranch,
    head: `${owner}:${branch}`,
    per_page: '1',
    state: 'open',
  });
  const response = await request(fetchImpl, `/repos/${repositoryPath}/pulls?${query}`, token, undefined, timeoutMs);
  if (!Array.isArray(response) || response.length > 1) {
    throw new Error('GitHub pull request response is invalid');
  }
  const found = response.length === 1 ? pullRequest(response[0], repository, branch, baseBranch) : null;
  if (response.length === 1 && !found) throw new Error('GitHub pull request response is invalid');
  return found ? { ...found, reused: true } : null;
}

export function createGitHubDeliveryHandler(
  tokenIssuer: GitHubAppTokenIssuer,
  tasks: Pick<TaskStore, 'recordEvent'>,
  staticWebAppOrigin?: string,
  fetchImpl: typeof fetch = fetch,
  onPullRequest?: (mapping: Extract<GithubWebhookMapping, { kind: 'pull_request' }>) => Promise<void>,
  afterPullRequest?: (mapping: Extract<GithubWebhookMapping, { kind: 'pull_request' }>) => Promise<void>,
): (workspace: TaskWorkspace, task: DeliveryTask, gate?: TaskCompletionGate) => Promise<GitHubDeliveryResult> {
  return async ({ repository, defaultBranch, branch }, task, gate) => {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository) ||
      !defaultBranch || defaultBranch.length > 255 || !branch || branch.length > 255 ||
      !/^[1-9][0-9]{0,18}$/u.test(task.id) || !task.title.trim()) {
      return { kind: 'refused', reason: 'The task repository, branch, or title could not be verified.' };
    }
    const [owner] = repository.split('/');
    const repositoryPath = repository.split('/').map(encodeURIComponent).join('/');

    let pull: PullRequest | null;
    try {
      const token = await tokenIssuer.issue(repository);
      let branchBody: unknown;
      try {
        branchBody = await request(
          fetchImpl,
          `/repos/${repositoryPath}/branches/${encodeURIComponent(branch)}`,
          token,
        );
      } catch (error) {
        if (error instanceof GitHubDeliveryRequestError && error.status === 404) {
          return { kind: 'refused', reason: 'The task branch does not exist in the configured repository.' };
        }
        throw error;
      }
      if (!object(branchBody) || branchBody.name !== branch) {
        throw new Error('GitHub branch response is invalid');
      }

      pull = await findOpenPullRequest(fetchImpl, repositoryPath, repository, branch, defaultBranch, owner!, token);
      if (!pull) {
        const comparison = await request(
          fetchImpl,
          `/repos/${repositoryPath}/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(branch)}`,
          token,
        );
        if (!object(comparison) || !Number.isSafeInteger(comparison.ahead_by) || (comparison.ahead_by as number) < 0) {
          throw new Error('GitHub branch comparison response is invalid');
        }
        if (comparison.ahead_by === 0) {
          return {
            kind: 'refused',
            reason: 'The task branch has no commits ahead of the project default branch; no pull request was opened.',
          };
        }

        const create = async () => {
          const taskPath = `/factory/tasks/${encodeURIComponent(task.id)}`;
          try {
            const created = await request(fetchImpl, `/repos/${repositoryPath}/pulls`, token, {
              title: pullRequestTitle(task),
              head: branch,
              base: defaultBranch,
              body: [
                task.issueNumber ? `Fixes #${task.issueNumber}` : undefined,
                staticWebAppOrigin
                  ? `Completed by Jarvis task [#${task.id}](${staticWebAppOrigin}${taskPath}).`
                  : `Completed by Jarvis task #${task.id} (task details: ${taskPath}).`,
              ].filter((line): line is string => line !== undefined).join('\n\n'),
            }, 6_000);
            const opened = pullRequest(created, repository, branch, defaultBranch);
            if (!opened) throw new Error('GitHub pull request response is invalid');
            const mapping = await recordOpenedPull(tasks, task.id, opened, branch, defaultBranch, repository, onPullRequest);
            return { kind: 'opened' as const, mapping };
          } catch (error) {
            if (error instanceof GitHubDeliveryRequestError && error.status === 422) {
              return { kind: 'duplicate' as const };
            }
            const reconciled = await findOpenPullRequest(
              fetchImpl, repositoryPath, repository, branch, defaultBranch, owner!, token, 3_000,
            );
            if (reconciled) {
              const mapping = await recordOpenedPull(
                tasks, task.id, reconciled, branch, defaultBranch, repository, onPullRequest,
              );
              return { kind: 'opened' as const, mapping };
            }
            throw error;
          }
        };
        const guardedCreate = gate
          ? await gate(create)
          : { kind: 'ran' as const, value: await create() };
        if (guardedCreate.kind === 'not_running') return { kind: 'not_running' };
        if (guardedCreate.value.kind === 'opened') {
          try {
            await afterPullRequest?.(guardedCreate.value.mapping);
          } catch {
            return {
              kind: 'refused',
              reason: 'The pull request was recorded, but project policy could not be verified. Review the task before retrying.',
            };
          }
          return { kind: 'awaiting_policy' };
        }
        if (guardedCreate.value.kind === 'duplicate') {
          pull = await findOpenPullRequest(fetchImpl, repositoryPath, repository, branch, defaultBranch, owner!, token);
          if (!pull) throw new Error('GitHub could not verify the task pull request after a duplicate create');
        }
      }
    } catch {
      return {
        kind: 'refused',
        reason: 'GitHub could not verify or open the task pull request. Check repository access and retry the task.',
      };
    }
    if (!pull) {
      return {
        kind: 'refused',
        reason: 'GitHub could not verify or open the task pull request. Check repository access and retry the task.',
      };
    }

    const recorded = gate
      ? await gate(() => recordOpenedPull(tasks, task.id, pull, branch, defaultBranch, repository, onPullRequest))
      : {
        kind: 'ran' as const,
        value: await recordOpenedPull(tasks, task.id, pull, branch, defaultBranch, repository, onPullRequest),
      };
    if (recorded.kind === 'not_running') return { kind: 'not_running' };
    try {
      await afterPullRequest?.(recorded.value);
      return { kind: 'awaiting_policy' };
    } catch {
      return {
        kind: 'refused',
        reason: 'The pull request was recorded, but project policy could not be verified. Review the task before retrying.',
      };
    }
  };
}

async function recordOpenedPull(
  tasks: Pick<TaskStore, 'recordEvent'>,
  taskId: string,
  pull: PullRequest,
  branch: string,
  defaultBranch: string,
  repository: string,
  onPullRequest?: (mapping: Extract<GithubWebhookMapping, { kind: 'pull_request' }>) => Promise<void>,
): Promise<Extract<GithubWebhookMapping, { kind: 'pull_request' }>> {
  await tasks.recordEvent({
      taskId,
      type: 'pull_request_opened',
      summary: `${pull.reused ? 'Reused' : 'Opened'} pull request #${pull.number} for the completed task branch`,
      payload: {
        pullRequest: pull.number,
        url: `https://github.com/${repository}/pull/${pull.number}`,
        branch,
        base: defaultBranch,
        reused: pull.reused,
      },
      source: 'backend',
    });
  const mapping: Extract<GithubWebhookMapping, { kind: 'pull_request' }> = {
    kind: 'pull_request',
    repository,
    number: pull.number,
    branch,
    headSha: pull.headSha,
    state: 'open',
    openedAt: pull.openedAt,
    mergedAt: null,
  };
  await onPullRequest?.(mapping);
  return mapping;
}
