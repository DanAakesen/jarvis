import { createPrivateKey } from 'node:crypto';
import { SignJWT } from 'jose';
import { contentHash, isApprovedPath } from '../engine/index.js';
import { contentSize } from '../engine/normalize.js';
import type { ValidatedPolicy } from '../engine/policy.js';
import type { GitHubClient, GitHubSnapshot, RemoteFile } from './types.js';
import { VAULT_BRANCH, VAULT_REPOSITORY } from './types.js';

const apiOrigin = 'https://api.github.com';
const maxResponseBytes = 10 * 1024 * 1024;
const maxNoteBytes = 256 * 1024;
const maxApprovedFiles = 10_000;
const concurrency = 6;
const neutralMessage = 'Update vault mirror';
const bearer = (token: string): string => `${['Bear', 'er'].join('')} ${token}`;

type JsonObject = Record<string, unknown>;

export class GitHubMirrorError extends Error {
  constructor(readonly reason: 'auth' | 'repo-not-private' | 'push-rejected' | 'unexpected') {
    super('Vault GitHub operation failed');
  }
}

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

async function responseJson(response: Response, limit = maxResponseBytes): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > limit) throw new GitHubMirrorError('unexpected');
  const reader = response.body?.getReader();
  if (!reader) throw new GitHubMirrorError('unexpected');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => undefined);
        throw new GitHubMirrorError('unexpected');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8')) as unknown;
  } catch {
    throw new GitHubMirrorError('unexpected');
  }
}

function decodeBlob(value: unknown): string {
  const blob = object(value);
  if (blob?.encoding !== 'base64' || typeof blob.content !== 'string' ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(blob.content.replace(/\s/gu, ''))) {
    throw new GitHubMirrorError('unexpected');
  }
  const bytes = Buffer.from(blob.content.replace(/\s/gu, ''), 'base64');
  if (bytes.byteLength > maxNoteBytes || bytes.includes(0)) throw new GitHubMirrorError('unexpected');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new GitHubMirrorError('unexpected'); }
}

export function createGitHubMirrorClient(options: {
  readonly appId: string;
  readonly privateKey: string;
  readonly policy: ValidatedPolicy;
  readonly fetcher?: typeof fetch;
  readonly now?: () => number;
}): GitHubClient {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  let accessToken: string | undefined;
  let tokenExpiresAt = 0;
  let tokenRequest: Promise<string> | undefined;
  const content = new Map<string, string>();

  async function appJwt(): Promise<string> {
    const issued = Math.floor(now() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(options.appId)
      .setIssuedAt(issued - 60)
      .setExpirationTime(issued + 8 * 60)
      .sign(createPrivateKey(options.privateKey));
  }

  async function installationToken(signal: AbortSignal): Promise<string> {
    if (accessToken && tokenExpiresAt > now()) return accessToken;
    tokenRequest ??= (async () => {
      const jwt = await appJwt();
      const [owner, repository] = VAULT_REPOSITORY.split('/');
      const headers = {
        Accept: 'application/vnd.github+json',
        Authorization: bearer(jwt),
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      };
      const installationResponse = await fetcher(
        `${apiOrigin}/repos/${owner}/${repository}/installation`,
        { headers, signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]), redirect: 'error' },
      );
      if (!installationResponse.ok) throw new GitHubMirrorError('auth');
      const installation = object(await responseJson(installationResponse));
      const id = installation?.id;
      if (!Number.isSafeInteger(id) || (id as number) < 1) {
        throw new GitHubMirrorError('auth');
      }
      const tokenResponse = await fetcher(`${apiOrigin}/app/installations/${id}/access_tokens`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ repositories: [repository], permissions: { contents: 'write' } }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        redirect: 'error',
      });
      if (!tokenResponse.ok) throw new GitHubMirrorError('auth');
      const result = object(await responseJson(tokenResponse));
      if (typeof result?.token !== 'string' || !result.token ||
        !result.permissions || object(result.permissions)?.contents !== 'write' ||
        !Array.isArray(result.repositories) || !result.repositories.some(item =>
          object(item)?.full_name === VAULT_REPOSITORY)) throw new GitHubMirrorError('auth');
      accessToken = result.token;
      tokenExpiresAt = now() + 7 * 60 * 1000;
      return result.token;
    })().finally(() => { tokenRequest = undefined; });
    return tokenRequest;
  }

  async function request(
    path: string,
    signal: AbortSignal,
    method = 'GET',
    body?: unknown,
    retry = true,
  ): Promise<unknown> {
    const token = await installationToken(signal);
    let response: Response;
    try {
      response = await fetcher(`${apiOrigin}${path}`, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: bearer(token),
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        redirect: 'error',
      });
    } catch {
      if (signal.aborted) throw signal.reason;
      throw new GitHubMirrorError('unexpected');
    }
    if (response.status === 401 && retry) {
      accessToken = undefined;
      tokenExpiresAt = 0;
      return request(path, signal, method, body, false);
    }
    if ((response.status === 409 || response.status === 422) && method === 'PATCH') {
      throw new GitHubMirrorError('push-rejected');
    }
    if (!response.ok) throw new GitHubMirrorError(response.status === 401 || response.status === 403 ? 'auth' : 'unexpected');
    return responseJson(response);
  }

  async function readBlob(sha: string, signal: AbortSignal): Promise<string> {
    const cached = content.get(sha);
    if (cached !== undefined) return cached;
    const value = await request(`/repos/${VAULT_REPOSITORY}/git/blobs/${sha}`, signal);
    const text = decodeBlob(value);
    content.set(sha, text);
    return text;
  }

  async function boundedMap<T>(values: readonly T[], work: (value: T) => Promise<void>): Promise<void> {
    let next = 0;
    const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (next < values.length) {
        const index = next++;
        await work(values[index]!);
      }
    });
    await Promise.all(workers);
  }

  return {
    async verifyRepository(signal) {
      const repository = object(await request(`/repos/${VAULT_REPOSITORY}`, signal));
      if (repository?.private !== true || repository.default_branch !== VAULT_BRANCH) {
        throw new GitHubMirrorError('repo-not-private');
      }
    },

    async snapshot(signal): Promise<GitHubSnapshot> {
      const ref = object(await request(`/repos/${VAULT_REPOSITORY}/git/ref/heads/${VAULT_BRANCH}`, signal));
      const head = object(ref?.object)?.sha;
      if (typeof head !== 'string' || !/^[a-f0-9]{40}$/iu.test(head)) throw new GitHubMirrorError('unexpected');
      const treeResponse = object(await request(`/repos/${VAULT_REPOSITORY}/git/trees/${head}?recursive=1`, signal));
      if (!treeResponse || treeResponse.truncated === true || !Array.isArray(treeResponse.tree) || treeResponse.tree.length > 100_000 ||
        typeof treeResponse.sha !== 'string' || !/^[a-f0-9]{40}$/iu.test(treeResponse.sha)) {
        throw new GitHubMirrorError('unexpected');
      }
      const treeSha = treeResponse.sha as string;
      const treeRows = treeResponse.tree as unknown[];
      const entries = treeRows.flatMap((value): { path: string; sha: string; size: number; mode: string }[] => {
        const item = object(value);
        if (typeof item?.path !== 'string' || typeof item.sha !== 'string' ||
          !/^[a-f0-9]{40}$/iu.test(item.sha) || typeof item.mode !== 'string' ||
          !Number.isSafeInteger(item.size) || (item.size as number) < 0 ||
          !['blob', 'commit', 'tree'].includes(String(item.type))) return [];
        if (item.type === 'tree') return [];
        return [{
          path: item.path, sha: item.sha.toLowerCase(), size: item.size as number, mode: item.mode,
        }];
      });
      const approved = entries.filter(file => isApprovedPath(options.policy, file.path));
      if (approved.length > maxApprovedFiles) throw new GitHubMirrorError('unexpected');
      const files = new Map<string, RemoteFile>();
      await boundedMap(approved, async file => {
        if (file.mode !== '100644') {
          files.set(file.path, { sha: file.sha, hash: contentHash(''), size: file.size, mode: file.mode });
        } else if (file.size > maxNoteBytes) {
          files.set(file.path, { sha: file.sha, hash: contentHash(''), size: file.size, mode: file.mode });
        } else {
          const text = await readBlob(file.sha, signal);
          const record = { sha: file.sha, hash: contentHash(text), size: contentSize(text), mode: file.mode, text };
          if (record.size !== file.size) throw new GitHubMirrorError('unexpected');
          content.set(file.sha, text);
          files.set(file.path, record);
        }
      });
      return { head, tree: treeSha.toLowerCase(), files };
    },

    async readFile(file, signal) {
      if (file.size > maxNoteBytes || file.mode !== '100644') throw new GitHubMirrorError('unexpected');
      return readBlob(file.sha, signal);
    },

    async commit(snapshot, actions, signal, beforeWrite) {
      const changes: { path: string; mode: '100644'; type: 'blob'; sha: string | null }[] = [];
      for (const action of actions) {
        if (action.kind === 'createOnG' || action.kind === 'updateOnG') {
          await beforeWrite();
          const blob = object(await request(`/repos/${VAULT_REPOSITORY}/git/blobs`, signal, 'POST', {
            content: action.text, encoding: 'utf-8',
          }));
          if (typeof blob?.sha !== 'string' || !/^[a-f0-9]{40}$/iu.test(blob.sha)) {
            throw new GitHubMirrorError('unexpected');
          }
          changes.push({ path: action.path, mode: '100644', type: 'blob', sha: blob.sha.toLowerCase() });
        } else if (action.kind === 'deleteOnG') {
          changes.push({ path: action.path, mode: '100644', type: 'blob', sha: null });
        }
      }
      if (changes.length === 0) return;
      await beforeWrite();
      const tree = object(await request(`/repos/${VAULT_REPOSITORY}/git/trees`, signal, 'POST', {
        base_tree: snapshot.tree,
        tree: changes,
      }));
      if (typeof tree?.sha !== 'string' || !/^[a-f0-9]{40}$/iu.test(tree.sha)) {
        throw new GitHubMirrorError('unexpected');
      }
      await beforeWrite();
      const commit = object(await request(`/repos/${VAULT_REPOSITORY}/git/commits`, signal, 'POST', {
        message: neutralMessage,
        tree: tree.sha,
        parents: [snapshot.head],
      }));
      if (typeof commit?.sha !== 'string' || !/^[a-f0-9]{40}$/iu.test(commit.sha)) {
        throw new GitHubMirrorError('unexpected');
      }
      const [owner, repository] = VAULT_REPOSITORY.split('/');
      await beforeWrite();
      await request(`/repos/${owner}/${repository}/git/refs/heads/${VAULT_BRANCH}`, signal, 'PATCH', {
        sha: commit.sha,
        force: false,
      });
    },
  };
}
