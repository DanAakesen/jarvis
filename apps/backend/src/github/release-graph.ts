import type { ReleaseGraphReader, GitGraph, GitGraphBranch, GitGraphCommit } from '../factory/release-view.js';
import type { GitHubAppTokenIssuer } from '../github-app.js';

const githubApi = 'https://api.github.com';
const maxResponseBytes = 1024 * 1024;
const maxBranches = 20;
const commitsPerBranch = 30;
const requestTimeoutMs = 10_000;
const responseHeaders = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function validSha(value: unknown): value is string {
  return typeof value === 'string' && /^[\da-f]{40}$/iu.test(value);
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error('GitHub graph request failed');
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > maxResponseBytes) {
    throw new Error('GitHub graph response is too large');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('GitHub graph response is invalid');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('GitHub graph response is too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')) as unknown;
  } catch {
    throw new Error('GitHub graph response is invalid');
  }
}

function parseBranch(value: unknown): GitGraphBranch {
  const branch = object(value);
  const commit = object(branch?.commit);
  if (typeof branch?.name !== 'string' || branch.name.length === 0 || branch.name.length > 255 ||
    !validSha(commit?.sha)) {
    throw new Error('GitHub branch response is invalid');
  }
  return { name: branch.name, commits: [] };
}

function parseCommit(value: unknown): GitGraphCommit {
  const commit = object(value);
  const details = object(commit?.commit);
  const author = object(details?.author) ?? object(details?.committer);
  const message = details?.message;
  const committedAt = author?.date;
  const authorName = author?.name;
  const parents = commit?.parents;
  if (!validSha(commit?.sha) || typeof message !== 'string' || message.length === 0 ||
    typeof committedAt !== 'string' || !Number.isFinite(Date.parse(committedAt)) ||
    (authorName !== undefined && authorName !== null && (typeof authorName !== 'string' || authorName.length > 255)) ||
    !Array.isArray(parents) || parents.length > 20 || parents.some((parent) => !validSha(object(parent)?.sha))) {
    throw new Error('GitHub commit response is invalid');
  }
  return {
    sha: commit.sha.toLowerCase(),
    message: message.slice(0, 500),
    author: typeof authorName === 'string' && authorName.length > 0 ? authorName : 'Unknown author',
    committedAt: new Date(committedAt).toISOString(),
    parents: parents.map((parent) => (object(parent) as { sha: string }).sha.toLowerCase()),
  };
}

export function createGitHubReleaseGraphReader(
  tokenIssuer: Pick<GitHubAppTokenIssuer, 'issueForContents'>,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): ReleaseGraphReader {
  async function request(url: string, token: string): Promise<unknown> {
    const response = await fetchImpl(url, {
      headers: {
        ...responseHeaders,
        Authorization: `${['Bear', 'er'].join('')} ${token}`,
      },
      signal: AbortSignal.timeout(requestTimeoutMs),
      redirect: 'error',
    });
    return readJson(response);
  }

  return {
    async read(repository, defaultBranch): Promise<GitGraph> {
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository) ||
        defaultBranch.length === 0 || defaultBranch.length > 255) {
        throw new Error('GitHub repository or branch is invalid');
      }
      const [owner, repo] = repository.split('/');
      if (!owner || !repo) throw new Error('GitHub repository is invalid');
      const token = await tokenIssuer.issueForContents(repository);
      const base = `${githubApi}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
      const branchResponse = await request(`${base}/branches?per_page=100`, token);
      if (!Array.isArray(branchResponse) || branchResponse.length > 100) {
        throw new Error('GitHub branch response is invalid');
      }
      const listedBranches = branchResponse.map(parseBranch);
      if (!listedBranches.some(({ name }) => name === defaultBranch) && listedBranches.length > 0) {
        const value = await request(`${base}/branches/${encodeURIComponent(defaultBranch)}`, token);
        listedBranches.push(parseBranch(value));
      }
      if (listedBranches.length === 0) {
        return { fetchedAt: new Date(now()).toISOString(), truncated: false, branches: [], commits: [] };
      }
      const selected = [
        ...listedBranches.filter(({ name }) => name === defaultBranch),
        ...listedBranches.filter(({ name }) => name !== defaultBranch).slice(0, maxBranches - 1),
      ];
      const histories: { branch: GitGraphBranch; commits: GitGraphCommit[] }[] = [];
      for (let index = 0; index < selected.length; index += 4) {
        const batch = selected.slice(index, index + 4);
        histories.push(...await Promise.all(batch.map(async (branch) => {
          const url = new URL(`${base}/commits`);
          url.searchParams.set('sha', branch.name);
          url.searchParams.set('per_page', String(commitsPerBranch));
          const value = await request(url.toString(), token);
          if (!Array.isArray(value) || value.length > commitsPerBranch) {
            throw new Error('GitHub commit response is invalid');
          }
          return { branch, commits: value.map(parseCommit) };
        })));
      }
      const commits = new Map<string, GitGraphCommit>();
      for (const history of histories) {
        for (const commit of history.commits) commits.set(commit.sha, commit);
      }
      const branches = histories.map(({ branch, commits: branchCommits }) => ({
        name: branch.name,
        commits: branchCommits.map(({ sha }) => sha),
      }));
      return {
        fetchedAt: new Date(now()).toISOString(),
        truncated: branchResponse.length === 100 || histories.some(({ commits: history }) => history.length === commitsPerBranch),
        branches,
        commits: [...commits.values()].sort((left, right) => left.committedAt.localeCompare(right.committedAt)),
      };
    },
  };
}
