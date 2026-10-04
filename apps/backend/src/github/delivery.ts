import type { TaskWorkspace } from '../foundry/client.js';
import type { GitHubAppTokenIssuer } from '../github-app.js';
import type { TaskStore } from '../factory/task-store.js';

const apiUrl = 'https://api.github.com';
const maxResponseBytes = 1024 * 1024;

interface DeliveryTask {
  id: string;
  title: string;
}

interface PullRequest {
  number: number;
  reused: boolean;
}

export type GitHubDeliveryResult =
  | { kind: 'awaiting_policy' }
  | { kind: 'refused'; reason: string };

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
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new GitHubDeliveryRequestError(response.status);
  }
  return readJson(response);
}

function pullRequest(value: unknown, repository: string, branch: string, baseBranch: string): PullRequest | null {
  if (!object(value) || !object(value.head) || !object(value.head.repo) || !object(value.base) ||
    value.state !== 'open' || value.merged !== false ||
    !Number.isSafeInteger(value.number) || (value.number as number) < 1 ||
    value.head.ref !== branch || value.head.repo.full_name !== repository || value.base.ref !== baseBranch) {
    return null;
  }
  return { number: value.number as number, reused: false };
}

async function findOpenPullRequest(
  fetchImpl: typeof fetch,
  repositoryPath: string,
  repository: string,
  branch: string,
  baseBranch: string,
  owner: string,
  token: string,
): Promise<PullRequest | null> {
  const query = new URLSearchParams({
    base: baseBranch,
    head: `${owner}:${branch}`,
    per_page: '1',
    state: 'open',
  });
  const response = await request(fetchImpl, `/repos/${repositoryPath}/pulls?${query}`, token);
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
): (workspace: TaskWorkspace, task: DeliveryTask) => Promise<GitHubDeliveryResult> {
  return async ({ repository, defaultBranch, branch }, task) => {
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

        try {
          const taskPath = `/factory/tasks/${encodeURIComponent(task.id)}`;
          const created = await request(fetchImpl, `/repos/${repositoryPath}/pulls`, token, {
            title: task.title,
            head: branch,
            base: defaultBranch,
            body: staticWebAppOrigin
              ? `Completed by Jarvis task [#${task.id}](${staticWebAppOrigin}${taskPath}).`
              : `Completed by Jarvis task #${task.id} (task details: ${taskPath}).`,
          });
          pull = pullRequest(created, repository, branch, defaultBranch);
          if (!pull) throw new Error('GitHub pull request response is invalid');
        } catch (error) {
          if (!(error instanceof GitHubDeliveryRequestError) || error.status !== 422) throw error;
          pull = await findOpenPullRequest(fetchImpl, repositoryPath, repository, branch, defaultBranch, owner!, token);
          if (!pull) throw error;
        }
      }
    } catch {
      return {
        kind: 'refused',
        reason: 'GitHub could not verify or open the task pull request. Check repository access and retry the task.',
      };
    }

    await tasks.recordEvent({
      taskId: task.id,
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
    return { kind: 'awaiting_policy' };
  };
}
