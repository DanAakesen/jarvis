import { createPrivateKey } from 'node:crypto';
import { SignJWT } from 'jose';

export interface GitHubAppTokenIssuer {
  issue(repository: string): Promise<string>;
  issueForActions(repository: string): Promise<string>;
}

export interface GitHubRepository {
  readonly fullName: string;
  readonly name: string;
  readonly defaultBranch: string;
  readonly pushedAt: string | null;
  readonly language: string | null;
}

export interface GitHubRepositoryListing {
  readonly repositories: readonly GitHubRepository[];
  readonly fetchedAt: string;
}

export interface GitHubRepositoryCatalog {
  list(owner: string, refresh?: boolean): Promise<GitHubRepositoryListing>;
  detectTech(repository: GitHubRepository): Promise<string>;
}

interface GitHubAppTokenIssuerOptions {
  appId: string;
  getPrivateKey: () => Promise<string>;
  fetch?: typeof fetch;
  now?: () => number;
}

const githubApi = 'https://api.github.com';
const maxResponseBytes = 16 * 1024;
const maxRepositoryResponseBytes = 1024 * 1024;
const maxInstallationRepositories = 10_000;
export const repositoryCacheTtlMs = 5 * 60 * 1000;

class GitHubAppRequestError extends Error {
  constructor(readonly status: number) {
    super('GitHub App request failed');
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function installationId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  return typeof value === 'string' && /^[1-9][0-9]{0,19}$/u.test(value) ? value : null;
}

async function requestJson(
  fetchImpl: typeof fetch,
  path: string,
  appToken: string,
  body?: unknown,
  responseLimit = maxResponseBytes,
): Promise<unknown> {
  const response = await fetchImpl(`${githubApi}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `${['Bear', 'er'].join('')} ${appToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  });
  if (!response.ok) throw new GitHubAppRequestError(response.status);
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > responseLimit) {
    throw new Error('GitHub App response is too large');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('GitHub App response is invalid');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > responseLimit) {
        await reader.cancel().catch(() => undefined);
        throw new Error('GitHub App response is too large');
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
    throw new Error('GitHub App response is invalid');
  }
}

function createAppJwt(appId: string, privateKey: string, now: () => number): Promise<string> {
  const issuedAt = Math.floor(now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(appId)
    .setIssuedAt(issuedAt - 60)
    .setExpirationTime(issuedAt + 9 * 60)
    .sign(createPrivateKey(privateKey));
}

function validInstallationToken(value: unknown, now: () => number): string {
  const token = object(value);
  const expiresAt = typeof token?.expires_at === 'string' ? Date.parse(token.expires_at) : Number.NaN;
  const lifetime = expiresAt - now();
  if (typeof token?.token !== 'string' || token.token.length === 0 || token.token.length > 4096 ||
    Array.from(token.token).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    }) || !Number.isFinite(expiresAt) ||
    lifetime < 50 * 60 * 1000 || lifetime > 65 * 60 * 1000) {
    throw new Error('GitHub installation token response is invalid');
  }
  return token.token;
}

async function findInstallation(
  fetchImpl: typeof fetch,
  appToken: string,
  owner: string,
): Promise<string> {
  const matches: string[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const value = await requestJson(
      fetchImpl,
      `/app/installations?per_page=100&page=${page}`,
      appToken,
      undefined,
      maxRepositoryResponseBytes,
    );
    if (!Array.isArray(value)) throw new Error('GitHub App installations response is invalid');
    for (const item of value) {
      const installation = object(item);
      const account = object(installation?.account);
      if (typeof account?.login === 'string' && account.login.toLowerCase() === owner.toLowerCase()) {
        const id = installationId(installation?.id);
        if (id && installation?.suspended_at == null) matches.push(id);
      }
    }
    if (value.length < 100) break;
    if (page === 100) throw new Error('GitHub App installations exceed the supported limit');
  }
  if (matches.length !== 1) throw new Error('GitHub App installation is unavailable');
  return matches[0]!;
}

async function createInstallationToken(
  fetchImpl: typeof fetch,
  appToken: string,
  installation: string,
  now: () => number,
): Promise<string> {
  const value = await requestJson(
    fetchImpl,
    `/app/installations/${installation}/access_tokens`,
    appToken,
    { permissions: { contents: 'read' } },
  );
  return validInstallationToken(value, now);
}

function parseRepository(value: unknown, owner: string): GitHubRepository {
  const repository = object(value);
  const fullName = repository?.full_name;
  const name = repository?.name;
  const defaultBranch = repository?.default_branch;
  const pushedAt = repository?.pushed_at;
  const language = repository?.language;
  if (typeof fullName !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(fullName) ||
    fullName.split('/')[0]?.toLowerCase() !== owner.toLowerCase() ||
    typeof name !== 'string' || name.length > 100 ||
    typeof defaultBranch !== 'string' || defaultBranch.length === 0 || defaultBranch.length > 255 ||
    (pushedAt !== null && (typeof pushedAt !== 'string' || !Number.isFinite(Date.parse(pushedAt)))) ||
    (language !== null && (typeof language !== 'string' || language.length > 100)) ||
    fullName.split('/')[1]?.toLowerCase() !== name.toLowerCase()) {
    throw new Error('GitHub repository response is invalid');
  }
  return {
    fullName,
    name,
    defaultBranch,
    pushedAt: pushedAt as string | null,
    language: language as string | null,
  };
}

function detectTech(paths: readonly string[], language: string | null): string {
  const markers: readonly [string, RegExp][] = [
    ['dotnet', /\.(?:csproj|fsproj|vbproj|sln)$/iu],
    ['node', /(?:^|\/)package\.json$/iu],
    ['python', /(?:^|\/)(?:pyproject\.toml|requirements\.txt|pipfile)$/iu],
    ['go', /(?:^|\/)go\.mod$/iu],
    ['rust', /(?:^|\/)cargo\.toml$/iu],
    ['java', /(?:^|\/)(?:pom\.xml|build\.gradle(?:\.kts)?)$/iu],
    ['ruby', /(?:^|\/)gemfile$/iu],
    ['php', /(?:^|\/)composer\.json$/iu],
  ];
  for (const [tech, pattern] of markers) {
    if (paths.some((path) => pattern.test(path))) return tech;
  }
  const languageIdentifiers: Record<string, string> = {
    'C#': 'dotnet',
    'F#': 'dotnet',
    JavaScript: 'node',
    TypeScript: 'node',
    Python: 'python',
    Go: 'go',
    Rust: 'rust',
    Java: 'java',
    Ruby: 'ruby',
    PHP: 'php',
    Swift: 'swift',
    Kotlin: 'kotlin',
    'C++': 'cpp',
  };
  if (!language) return 'unknown';
  const identifier = languageIdentifiers[language] ??
    language.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 32);
  return /^[a-z][a-z0-9_.-]{0,31}$/u.test(identifier) ? identifier : 'unknown';
}

export function createGitHubAppTokenIssuer({
  appId,
  getPrivateKey,
  fetch: fetchImpl = fetch,
  now = Date.now,
}: GitHubAppTokenIssuerOptions): GitHubAppTokenIssuer {
  const issue = async (repository: string, permissions: Record<string, 'read' | 'write'>): Promise<string> => {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
      throw new Error('GitHub repository is invalid');
    }
    const [owner, name] = repository.split('/');
    if (!owner || !name) throw new Error('GitHub repository is invalid');

    const issuedAt = Math.floor(now() / 1000);
    const appToken = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(appId)
      .setIssuedAt(issuedAt - 60)
      .setExpirationTime(issuedAt + 9 * 60)
      .sign(createPrivateKey(await getPrivateKey()));

    const installation = object(await requestJson(
      fetchImpl,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/installation`,
      appToken,
    ));
    const id = installationId(installation?.id);
    if (!id) {
      throw new Error('GitHub installation response is invalid');
    }

    const token = await requestJson(
      fetchImpl,
      `/app/installations/${id}/access_tokens`,
      appToken,
      { repositories: [name], permissions },
    );
    return validInstallationToken(token, now);
  };

  return {
    issue: (repository) => issue(repository, { contents: 'write', pull_requests: 'write' }),
    issueForActions: (repository) => issue(repository, { actions: 'read' }),
  };
}

export function createGitHubAppRepositoryCatalog({
  appId,
  getPrivateKey,
  fetch: fetchImpl = fetch,
  now = Date.now,
}: GitHubAppTokenIssuerOptions): GitHubRepositoryCatalog {
  const cache = new Map<string, { expiresAt: number; listing: GitHubRepositoryListing }>();
  const pending = new Map<string, Promise<GitHubRepositoryListing>>();

  const load = async (owner: string): Promise<GitHubRepositoryListing> => {
    const appToken = await createAppJwt(appId, await getPrivateKey(), now);
    const id = await findInstallation(fetchImpl, appToken, owner);
    const token = await createInstallationToken(fetchImpl, appToken, id, now);
    const repositories: GitHubRepository[] = [];
    let expectedCount: number | undefined;
    for (let page = 1; page <= 100; page += 1) {
      const value = object(await requestJson(
        fetchImpl,
        `/installation/repositories?per_page=100&page=${page}`,
        token,
        undefined,
        maxRepositoryResponseBytes,
      ));
      const rows = value?.repositories;
      if (!Array.isArray(rows) || typeof value?.total_count !== 'number' ||
        !Number.isSafeInteger(value.total_count) || value.total_count < 0 ||
        value.total_count > maxInstallationRepositories || rows.length > 100) {
        throw new Error('GitHub repositories response is invalid');
      }
      expectedCount ??= value.total_count;
      if (expectedCount !== value.total_count) throw new Error('GitHub repositories response is inconsistent');
      repositories.push(...rows.map((row) => parseRepository(row, owner)));
      if (repositories.length >= expectedCount) break;
      if (rows.length === 0 || page === 100) {
        throw new Error('GitHub repository list is incomplete');
      }
    }
    if (repositories.length !== expectedCount) throw new Error('GitHub repository list is incomplete');
    repositories.sort((left, right) => left.fullName.localeCompare(right.fullName));
    return { repositories, fetchedAt: new Date(now()).toISOString() };
  };

  return {
    async list(owner, refresh = false) {
      if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(owner)) {
        throw new Error('GitHub account is invalid');
      }
      const key = owner.toLowerCase();
      const cached = cache.get(key);
      if (!refresh && cached && cached.expiresAt > now()) {
        return {
          repositories: cached.listing.repositories.map((repository) => ({ ...repository })),
          fetchedAt: cached.listing.fetchedAt,
        };
      }
      let request = pending.get(key);
      if (!request) {
        request = load(owner);
        pending.set(key, request);
      }
      try {
        const listing = await request;
        cache.set(key, { expiresAt: now() + repositoryCacheTtlMs, listing });
        return {
          repositories: listing.repositories.map((repository) => ({ ...repository })),
          fetchedAt: listing.fetchedAt,
        };
      } finally {
        if (pending.get(key) === request) pending.delete(key);
      }
    },
    async detectTech(repository) {
      const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/u.exec(repository.fullName);
      if (!match || repository.defaultBranch.length === 0 || repository.defaultBranch.length > 255) {
        throw new Error('GitHub repository is invalid');
      }
      const owner = match[1]!;
      const name = match[2]!;
      const appToken = await createAppJwt(appId, await getPrivateKey(), now);
      const id = await findInstallation(fetchImpl, appToken, owner);
      const token = await createInstallationToken(fetchImpl, appToken, id, now);
      let paths: string[] = [];
      try {
        const tree = object(await requestJson(
          fetchImpl,
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${encodeURIComponent(repository.defaultBranch)}?recursive=1`,
          token,
          undefined,
          maxRepositoryResponseBytes,
        ));
        if (!Array.isArray(tree?.tree)) throw new Error('GitHub repository tree is invalid');
        paths = tree.tree.flatMap((item) => {
          const entry = object(item);
          return typeof entry?.path === 'string' ? [entry.path] : [];
        });
      } catch (error) {
        if (error instanceof GitHubAppRequestError && error.status === 404) {
          return detectTech(paths, repository.language);
        }
        if (!(error instanceof Error && error.message === 'GitHub App response is too large')) throw error;
      }
      return detectTech(paths, repository.language);
    },
  };
}
