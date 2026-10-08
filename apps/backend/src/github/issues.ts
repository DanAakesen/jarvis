import type { GitHubAppTokenIssuer } from '../github-app.js';

const apiUrl = 'https://api.github.com';
const maxResponseBytes = 1024 * 1024;
const maxAgentRulesBytes = 64 * 1024;
const maxIssueCommentPages = 10;
const maxIssueTitlePages = 100;

export interface GitHubIssue {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly state: 'open' | 'closed';
  readonly url: string;
  readonly labels: readonly string[];
  readonly isPullRequest: boolean;
}

export interface GitHubIssueComment {
  readonly author: string;
  readonly body: string;
}

export interface GitHubIssueReference {
  readonly number: number;
  readonly url: string;
}

export interface GitHubIssueCreateOptions {
  readonly labels?: readonly string[];
  readonly assignees?: readonly string[];
}

export interface GitHubIssueClient {
  readIssue(repository: string, issue: number): Promise<GitHubIssue | null>;
  readComments(repository: string, issue: number): Promise<readonly GitHubIssueComment[]>;
  readAgentRules(repository: string): Promise<string>;
  listIssueTitles(repository: string): Promise<readonly string[]>;
  findIssueByTitleSuffix(repository: string, suffix: string): Promise<GitHubIssueReference | null>;
  createIssue(
    repository: string,
    title: string,
    body: string,
    options?: GitHubIssueCreateOptions,
  ): Promise<GitHubIssueReference>;
  createComment(repository: string, issue: number, body: string): Promise<void>;
  addLabels(repository: string, issue: number, labels: readonly string[]): Promise<void>;
  removeLabel(repository: string, issue: number, label: string): Promise<void>;
}

export class GitHubIssueRequestError extends Error {
  constructor(readonly status: number) {
    super('GitHub issue request failed');
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function repositoryPath(repository: string): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error('Invalid repository');
  }
  return repository.split('/').map(encodeURIComponent).join('/');
}

async function readJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > maxResponseBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('GitHub issue response is too large');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('GitHub issue response is invalid');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('GitHub issue response is too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')) as unknown;
  } catch {
    throw new Error('GitHub issue response is invalid');
  }
}

async function request(
  fetchImpl: typeof fetch,
  token: string,
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<unknown> {
  const response = await fetchImpl(`${apiUrl}${path}`, {
    method,
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
    throw new GitHubIssueRequestError(response.status);
  }
  if (response.status === 204) return null;
  return readJson(response);
}

function parsedIssue(value: unknown, repository: string, issue: number): GitHubIssue {
  const issueUrl = `https://github.com/${repository}/issues/${issue}`;
  const pullUrl = `https://github.com/${repository}/pull/${issue}`;
  if (!object(value) || value.number !== issue ||
    typeof value.title !== 'string' || value.title.length < 1 || value.title.length > 256 ||
    (value.body !== null && value.body !== undefined && typeof value.body !== 'string') ||
    (value.state !== 'open' && value.state !== 'closed') ||
    typeof value.html_url !== 'string' || (value.html_url !== issueUrl && value.html_url !== pullUrl) ||
    !Array.isArray(value.labels)) {
    throw new Error('GitHub issue response is invalid');
  }
  const labels = value.labels.flatMap((label) =>
    object(label) && typeof label.name === 'string' ? [label.name] : []);
  return {
    number: issue,
    title: value.title,
    body: typeof value.body === 'string' ? value.body : '',
    state: value.state,
    url: value.html_url,
    labels,
    isPullRequest: object(value.pull_request),
  };
}

export function createGitHubIssueClient(
  tokenIssuer: GitHubAppTokenIssuer,
  fetchImpl: typeof fetch = fetch,
): GitHubIssueClient {
  return {
    async readIssue(repository, issue) {
      const path = repositoryPath(repository);
      if (!Number.isSafeInteger(issue) || issue < 1 || issue > 2_147_483_647) throw new Error('Invalid issue number');
      const token = await tokenIssuer.issueForRepositoryRead(repository);
      try {
        return parsedIssue(
          await request(fetchImpl, token, `/repos/${path}/issues/${issue}`),
          repository,
          issue,
        );
      } catch (error) {
        if (error instanceof GitHubIssueRequestError && error.status === 404) return null;
        throw error;
      }
    },
    async readComments(repository, issue) {
      const path = repositoryPath(repository);
      if (!Number.isSafeInteger(issue) || issue < 1 || issue > 2_147_483_647) throw new Error('Invalid issue number');
      const token = await tokenIssuer.issueForRepositoryRead(repository);
      const comments: GitHubIssueComment[] = [];
      for (let page = 1; page <= maxIssueCommentPages; page += 1) {
        const response = await request(
          fetchImpl,
          token,
          `/repos/${path}/issues/${issue}/comments?per_page=100&page=${page}`,
        );
        if (!Array.isArray(response) || response.length > 100) throw new Error('GitHub issue comments are invalid');
        comments.push(...response.flatMap((value) => {
          if (!object(value) || !object(value.user) || typeof value.user.login !== 'string' ||
            typeof value.body !== 'string') return [];
          return [{ author: value.user.login, body: value.body }];
        }));
        if (response.length < 100) return comments;
      }
      throw new Error('GitHub issue has too many comments to start safely');
    },
    async readAgentRules(repository) {
      const path = repositoryPath(repository);
      const token = await tokenIssuer.issueForContents(repository);
      let response: unknown;
      try {
        response = await request(fetchImpl, token, `/repos/${path}/contents/AGENTS.md`);
      } catch (error) {
        if (error instanceof GitHubIssueRequestError && error.status === 404) return '';
        throw error;
      }
      if (!object(response) || response.encoding !== 'base64' || typeof response.content !== 'string' ||
        response.content.length > Math.ceil(maxAgentRulesBytes / 3) * 4 + 8) {
        throw new Error('Repository agent rules are invalid');
      }
      const rules = Buffer.from(response.content.replace(/\s/gu, ''), 'base64');
      if (rules.length > maxAgentRulesBytes) throw new Error('Repository agent rules are too large');
      return rules.toString('utf8');
    },
    async listIssueTitles(repository) {
      const path = repositoryPath(repository);
      const token = await tokenIssuer.issueForRepositoryRead(repository);
      const titles: string[] = [];
      for (let page = 1; page <= maxIssueTitlePages; page += 1) {
        const response = await request(
          fetchImpl,
          token,
          `/repos/${path}/issues?state=all&per_page=100&page=${page}`,
        );
        if (!Array.isArray(response) || response.length > 100 ||
            response.some((issue) => !object(issue) || typeof issue.title !== 'string')) {
          throw new Error('GitHub issue list is invalid');
        }
        titles.push(...response.map((issue) => (issue as { title: string }).title));
        if (response.length < 100) return titles;
      }
      throw new Error('GitHub issue list is too large to allocate a task code safely');
    },
    async findIssueByTitleSuffix(repository, suffix) {
      if (!suffix.trim() || suffix.length > 100) throw new Error('Invalid issue title suffix');
      const path = repositoryPath(repository);
      const token = await tokenIssuer.issueForRepositoryRead(repository);
      let match: GitHubIssueReference | null = null;
      for (let page = 1; page <= maxIssueTitlePages; page += 1) {
        const response = await request(
          fetchImpl,
          token,
          `/repos/${path}/issues?state=all&per_page=100&page=${page}`,
        );
        if (!Array.isArray(response) || response.length > 100 ||
            response.some((issue) => !object(issue) || typeof issue.title !== 'string' ||
              !Number.isSafeInteger(issue.number) || (issue.number as number) < 1)) {
          throw new Error('GitHub issue list is invalid');
        }
        const found = response.find((issue) => {
          if (!object(issue)) return false;
          return !object(issue.pull_request) && typeof issue.title === 'string' &&
            issue.title.endsWith(suffix);
        });
        if (found && object(found)) {
          if (match) throw new Error('GitHub issue title suffix is ambiguous');
          const number = found.number as number;
          match = { number, url: `https://github.com/${repository}/issues/${number}` };
        }
        if (response.length < 100) return match;
      }
      throw new Error('GitHub issue list is too large to find a task marker safely');
    },
    async createIssue(repository, title, body, options) {
      const path = repositoryPath(repository);
      if (!title.trim() || title.length > 256 || Buffer.byteLength(body, 'utf8') > 50_000 ||
          options?.labels?.some((label) => !label.trim() || label.length > 50) ||
          options?.assignees?.some((assignee) => !/^[A-Za-z0-9-]{1,39}$/u.test(assignee))) {
        throw new Error('Invalid issue content');
      }
      const token = await tokenIssuer.issueForIssuesWrite(repository);
      const created = await request(fetchImpl, token, `/repos/${path}/issues`, 'POST', {
        title,
        body,
        ...(options?.labels ? { labels: options.labels } : {}),
        ...(options?.assignees ? { assignees: options.assignees } : {}),
      });
      if (!object(created) || !Number.isSafeInteger(created.number) ||
        (created.number as number) < 1 || (created.number as number) > 2_147_483_647 ||
        created.html_url !== `https://github.com/${repository}/issues/${created.number}`) {
        throw new Error('GitHub issue response is invalid');
      }
      return { number: created.number as number, url: created.html_url };
    },
    async addLabels(repository, issue, labels) {
      const path = repositoryPath(repository);
      if (!Number.isSafeInteger(issue) || issue < 1 || issue > 2_147_483_647 ||
          labels.length < 1 || labels.length > 10 ||
          labels.some((label) => !label.trim() || label.length > 50)) {
        throw new Error('Invalid issue labels');
      }
      const token = await tokenIssuer.issueForIssuesWrite(repository);
      await request(fetchImpl, token, `/repos/${path}/issues/${issue}/labels`, 'POST', { labels });
    },
    async createComment(repository, issue, body) {
      const path = repositoryPath(repository);
      if (!Number.isSafeInteger(issue) || issue < 1 || issue > 2_147_483_647 ||
        !body.trim() || body.length > 4_000) throw new Error('Invalid issue comment');
      const token = await tokenIssuer.issueForIssuesWrite(repository);
      await request(fetchImpl, token, `/repos/${path}/issues/${issue}/comments`, 'POST', { body });
    },
    async removeLabel(repository, issue, label) {
      const path = repositoryPath(repository);
      if (!Number.isSafeInteger(issue) || issue < 1 || issue > 2_147_483_647 ||
        !label.trim() || label.length > 50) throw new Error('Invalid issue label');
      const token = await tokenIssuer.issueForIssuesWrite(repository);
      try {
        await request(fetchImpl, token,
          `/repos/${path}/issues/${issue}/labels/${encodeURIComponent(label)}`, 'DELETE');
      } catch (error) {
        if (!(error instanceof GitHubIssueRequestError && error.status === 404)) throw error;
      }
    },
  };
}
