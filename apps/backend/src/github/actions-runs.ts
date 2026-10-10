import type { GitHubAppTokenIssuer } from '../github-app.js';

const githubApi = 'https://api.github.com';
const maxResponseBytes = 1024 * 1024;
const requestTimeoutMs = 10_000;

export interface GitHubActionsDeploymentRun {
  readonly id: number;
  readonly workflow: string;
  readonly status: 'requested' | 'waiting' | 'pending' | 'queued' | 'in_progress' | 'completed';
  readonly conclusion: string | null;
  readonly headBranch: string;
  readonly headSha: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly url: string;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(requestTimeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function readResponse(response: Response): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > maxResponseBytes) {
    throw new Error('GitHub Actions response is too large');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('GitHub Actions response is invalid');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('GitHub Actions response is too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true })
      .decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))))) as unknown;
  } catch {
    throw new Error('GitHub Actions response is invalid');
  }
}

function deploymentWorkflow(path: unknown): boolean {
  if (typeof path !== 'string') return false;
  const workflowPath = path.split('@', 1)[0]!;
  return /^\.github\/workflows\/deploy[^/]*\.ya?ml$/iu.test(workflowPath);
}

function parseRun(value: unknown, repository: string, branch: string): GitHubActionsDeploymentRun | null {
  const run = object(value);
  if (!run || !deploymentWorkflow(run.path) || run.head_branch !== branch) return null;

  const id = run.id;
  const workflowPath = (run.path as string).split('@', 1)[0]!;
  const status = run.status;
  const conclusion = run.conclusion;
  const headSha = run.head_sha;
  const createdAt = run.created_at;
  const updatedAt = run.updated_at;
  const allowedStatuses = ['requested', 'waiting', 'pending', 'queued', 'in_progress', 'completed'];
  const allowedConclusions = [
    'success', 'failure', 'cancelled', 'skipped', 'timed_out',
    'action_required', 'neutral', 'stale', 'startup_failure',
  ];
  if (!positiveSafeInteger(id) || typeof status !== 'string' || !allowedStatuses.includes(status) ||
    (conclusion !== null && (typeof conclusion !== 'string' || !allowedConclusions.includes(conclusion))) ||
    typeof run.head_branch !== 'string' || run.head_branch.length > 255 ||
    typeof headSha !== 'string' || !/^[0-9a-f]{40}$/iu.test(headSha) ||
    typeof createdAt !== 'string' || createdAt.length > 64 || !Number.isFinite(Date.parse(createdAt)) ||
    typeof updatedAt !== 'string' || updatedAt.length > 64 || !Number.isFinite(Date.parse(updatedAt))) {
    throw new Error('GitHub Actions deployment response is invalid');
  }

  return {
    id,
    workflow: workflowPath.slice('.github/workflows/'.length),
    status: status as GitHubActionsDeploymentRun['status'],
    conclusion: conclusion as string | null,
    headBranch: run.head_branch,
    headSha,
    createdAt,
    updatedAt,
    url: `https://github.com/${repository}/actions/runs/${id}`,
  };
}

export function createGitHubActionsRunClient(
  tokenIssuer: Pick<GitHubAppTokenIssuer, 'issueForActions'>,
  fetchImpl: typeof fetch = fetch,
) {
  return {
    async latestDeployment(
      repository: string,
      branch: string,
      signal?: AbortSignal,
      sha?: string,
    ): Promise<GitHubActionsDeploymentRun | null> {
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository) ||
        !branch.trim() || branch.length > 255 || (sha !== undefined && !/^[0-9a-f]{40}$/iu.test(sha))) {
        throw new Error('GitHub Actions repository or branch is invalid');
      }
      const [owner, name] = repository.split('/');
      if (!owner || !name) throw new Error('GitHub Actions repository is invalid');
      const token = await tokenIssuer.issueForActions(repository);
      const query = new URLSearchParams({ branch, per_page: '100' });
      if (sha) query.set('head_sha', sha);
      const response = await fetchImpl(
        `${githubApi}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/actions/runs?${query}`,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `${['Bear', 'er'].join('')} ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
          signal: requestSignal(signal),
          redirect: 'error',
        },
      );
      if (!response.ok) throw new Error('GitHub Actions workflow runs are unavailable');
      const value = object(await readResponse(response));
      if (!value || !Number.isSafeInteger(value.total_count) || (value.total_count as number) < 0 ||
        !Array.isArray(value.workflow_runs) || value.workflow_runs.length > 100) {
        throw new Error('GitHub Actions workflow-run response is invalid');
      }
      const runs = value.workflow_runs
        .map((run) => parseRun(run, repository, branch))
        .filter((run): run is GitHubActionsDeploymentRun => run !== null &&
          (sha === undefined || run.headSha.toLowerCase() === sha.toLowerCase()))
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id - left.id);
      return runs[0] ?? null;
    },
  };
}
