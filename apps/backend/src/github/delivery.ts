import type { TaskWorkspace } from '../foundry/client.js';
import type { GitHubAppTokenIssuer } from '../github-app.js';

const apiUrl = 'https://api.github.com';
const maxResponseBytes = 1024 * 1024;

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
  const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('GitHub delivery response is invalid');
  }
}

export function createGitHubDeliveryVerifier(
  tokenIssuer: GitHubAppTokenIssuer,
  fetchImpl: typeof fetch = fetch,
): (workspace: TaskWorkspace) => Promise<boolean> {
  return async ({ repository, branch }) => {
    const [owner, name] = repository.split('/');
    if (!owner || !name) throw new Error('GitHub repository is invalid');
    const token = await tokenIssuer.issue(repository);
    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `${['Bear', 'er'].join('')} ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const branchResponse = await fetchImpl(
      `${apiUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches/${encodeURIComponent(branch)}`,
      { headers, signal: AbortSignal.timeout(10_000), redirect: 'error' },
    );
    if (branchResponse.status === 404) {
      await branchResponse.body?.cancel().catch(() => undefined);
      return false;
    }
    if (!branchResponse.ok) throw new Error('GitHub branch verification failed');
    const branchBody = await readJson(branchResponse);
    if (!object(branchBody) || branchBody.name !== branch) {
      throw new Error('GitHub branch response is invalid');
    }

    const query = new URLSearchParams({
      head: `${owner}:${branch}`,
      state: 'all',
      per_page: '1',
    });
    const pullResponse = await fetchImpl(
      `${apiUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls?${query}`,
      { headers, signal: AbortSignal.timeout(10_000), redirect: 'error' },
    );
    if (!pullResponse.ok) throw new Error('GitHub pull request verification failed');
    const pullBody = await readJson(pullResponse);
    if (!Array.isArray(pullBody) || pullBody.length > 1) {
      throw new Error('GitHub pull request response is invalid');
    }
    return pullBody.some((value: unknown) => {
      if (!object(value) || !object(value.head) || !object(value.head.repo)) return false;
      return value.head.ref === branch && value.head.repo.full_name === repository;
    });
  };
}
