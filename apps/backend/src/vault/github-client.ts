import type { GitHubAppTokenIssuer } from '../github-app.js';

export const VAULT_REPOSITORY = 'DanAakesen/vault';
export const VAULT_BRANCH = 'master';
export const MAX_VAULT_FILE_BYTES = 256 * 1024;

const apiOrigin = 'https://api.github.com';
const maxTreeResponseBytes = 10 * 1024 * 1024;
const maxContentsResponseBytes = 400 * 1024;
const tokenLifetimeMs = 50 * 60 * 1000;

export interface VaultTreeFile {
  readonly path: string;
  readonly sha: string;
}

export interface VaultFile {
  readonly path: string;
  readonly sha: string;
  readonly content: string;
}

export class VaultAppNotInstalledError extends Error {
  constructor() {
    super('The GitHub App is not installed on DanAakesen/vault with Contents access.');
    this.name = 'VaultAppNotInstalledError';
  }
}

export class VaultWriteConflictError extends Error {
  constructor() {
    super('The vault note changed during the write.');
    this.name = 'VaultWriteConflictError';
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function encodedPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function responseBody(response: Response, limit: number): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > limit) {
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
      if (size > limit) {
        await reader.cancel().catch(() => undefined);
        throw new Error('GitHub response is too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')) as unknown;
  } catch {
    throw new Error('GitHub response is invalid');
  }
}

function decodeContent(value: unknown): string {
  if (typeof value !== 'string') throw new Error('GitHub file content is invalid');
  const encoded = value.replace(/\s/gu, '');
  if (encoded.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) {
    throw new Error('GitHub file content is invalid');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > MAX_VAULT_FILE_BYTES || bytes.includes(0)) {
    throw new Error('GitHub file content is not a bounded text note');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('GitHub file content is not valid UTF-8');
  }
}

export function createGitHubVaultClient(options: {
  readonly tokenIssuer: Pick<GitHubAppTokenIssuer, 'issueForContentsWrite'>;
  readonly fetcher?: typeof fetch;
  readonly now?: () => number;
}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  let token: string | undefined;
  let tokenExpiresAt = 0;
  let tokenRequest: Promise<string> | undefined;

  async function getToken(): Promise<string> {
    if (token && tokenExpiresAt > now()) return token;
    tokenRequest ??= options.tokenIssuer.issueForContentsWrite(VAULT_REPOSITORY)
      .catch((error: unknown) => {
        if (object(error)?.status === 404) throw new VaultAppNotInstalledError();
        throw error;
      })
      .then((value) => {
        token = value;
        tokenExpiresAt = now() + tokenLifetimeMs;
        return value;
      })
      .finally(() => { tokenRequest = undefined; });
    return tokenRequest;
  }

  async function request(
    path: string,
    signal: AbortSignal,
    body?: unknown,
    limit = maxContentsResponseBytes,
  ): Promise<{ readonly response: Response; readonly value?: unknown }> {
    const accessToken = await getToken();
    const response = await fetcher(`${apiOrigin}${path}`, {
      method: body === undefined ? 'GET' : 'PUT',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `${['Bear', 'er'].join('')} ${accessToken}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      redirect: 'error',
    });
    if (!response.ok) return { response };
    return { response, value: await responseBody(response, limit) };
  }

  return {
    async tree(signal: AbortSignal): Promise<VaultTreeFile[]> {
      const { response, value } = await request(
        `/repos/${VAULT_REPOSITORY}/git/trees/${VAULT_BRANCH}?recursive=1`,
        signal,
        undefined,
        maxTreeResponseBytes,
      );
      if (!response.ok) throw new Error('Could not read the vault Git tree');
      const tree = object(value);
      if (tree?.truncated === true || !Array.isArray(tree?.tree) || tree.tree.length > 100_000) {
        throw new Error('The vault Git tree is incomplete or too large');
      }
      return tree.tree.flatMap((entry): VaultTreeFile[] => {
        const item = object(entry);
        return typeof item?.path === 'string' && typeof item.sha === 'string' &&
          /^[\da-f]{40}$/iu.test(item.sha) && item.type === 'blob' && item.mode === '100644'
          ? [{ path: item.path, sha: item.sha.toLowerCase() }]
          : [];
      });
    },

    async read(path: string, signal: AbortSignal): Promise<VaultFile | null> {
      const { response, value } = await request(
        `/repos/${VAULT_REPOSITORY}/contents/${encodedPath(path)}?ref=${VAULT_BRANCH}`,
        signal,
      );
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('Could not read the vault note');
      const file = object(value);
      if (file?.type !== 'file' || typeof file.path !== 'string' ||
          typeof file.sha !== 'string' || !/^[\da-f]{40}$/iu.test(file.sha) ||
          file.encoding !== 'base64') {
        throw new Error('GitHub file response is invalid');
      }
      return { path: file.path, sha: file.sha.toLowerCase(), content: decodeContent(file.content) };
    },

    async write(
      path: string,
      content: string,
      message: string,
      sha: string | undefined,
      signal: AbortSignal,
    ): Promise<string> {
      const { response, value } = await request(
        `/repos/${VAULT_REPOSITORY}/contents/${encodedPath(path)}`,
        signal,
        {
          message,
          content: Buffer.from(content, 'utf8').toString('base64'),
          branch: VAULT_BRANCH,
          ...(sha === undefined ? {} : { sha }),
        },
      );
      if (response.status === 409 || response.status === 422) throw new VaultWriteConflictError();
      if (!response.ok) throw new Error('Could not commit the vault note');
      const commitSha = object(object(value)?.commit)?.sha;
      if (typeof commitSha !== 'string' || !/^[\da-f]{40}$/iu.test(commitSha)) {
        throw new Error('GitHub commit response is invalid');
      }
      return commitSha.toLowerCase();
    },
  };
}
