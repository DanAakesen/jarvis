import type { RepositoryCreationInput, RepositoryCreator } from '../factory/new-project.js';

const keyVaultScope = 'https://vault.azure.net/.default';
const githubApi = 'https://api.github.com';
const githubApiVersion = '2022-11-28';
const maxResponseBytes = 64 * 1024;
const requestTimeoutMs = 30_000;

export class RepositoryCreationError extends Error {
  constructor(readonly kind: 'conflict' | 'failed') {
    super('Repository creation failed');
  }
}

function validateVaultUri(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new TypeError('Key Vault URI must be a secure Azure Key Vault origin'); }
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.vault\.azure\.net$/iu.test(url.hostname) ||
    url.port || url.username || url.password || !['', '/'].includes(url.pathname) || url.search || url.hash) {
    throw new TypeError('Key Vault URI must be a secure Azure Key Vault origin');
  }
  return `${url.origin}/`;
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw new RepositoryCreationError('failed');
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) {
        await reader.cancel();
        throw new RepositoryCreationError('failed');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  const parsed: unknown = JSON.parse(text);
  const object = jsonObject(parsed);
  if (!object) throw new RepositoryCreationError('failed');
  return object;
}

export function createRepoAdminRepositoryCreator(
  vaultUri: string,
  getToken: (scope: string, signal: AbortSignal) => Promise<string>,
  fetcher: typeof fetch = fetch,
): RepositoryCreator {
  const vault = validateVaultUri(vaultUri);
  return {
    async create(input: RepositoryCreationInput, signal: AbortSignal): Promise<string> {
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]);
      requestSignal.throwIfAborted();
      const vaultToken = await getToken(keyVaultScope, requestSignal);
      if (typeof vaultToken !== 'string' || !vaultToken.trim() || /[\r\n]/u.test(vaultToken)) {
        throw new RepositoryCreationError('failed');
      }
      const secretResponse = await fetcher(`${vault}secrets/jarvis-repo-admin?api-version=7.4`, {
        method: 'GET',
        redirect: 'error',
        headers: { Authorization: ['Bearer', vaultToken].join(' '), Accept: 'application/json' },
        signal: requestSignal,
      });
      if (!secretResponse.ok) {
        await secretResponse.body?.cancel().catch(() => undefined);
        throw new RepositoryCreationError('failed');
      }
      const secret = await responseJson(secretResponse);
      const repositoryToken = secret.value;
      if (typeof repositoryToken !== 'string' || !repositoryToken.trim() ||
        repositoryToken.length > 10_000 || /[\r\n]/u.test(repositoryToken)) {
        throw new RepositoryCreationError('failed');
      }

      const headers = {
        Authorization: ['Bearer', repositoryToken].join(' '),
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': githubApiVersion,
        'User-Agent': 'Jarvis-backend',
      };
      const apiRequest = async (path: string, method: 'GET' | 'POST' | 'PATCH', body?: unknown) => {
        requestSignal.throwIfAborted();
        const response = await fetcher(`${githubApi}${path}`, {
          method,
          redirect: 'error',
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: requestSignal,
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          throw new RepositoryCreationError(response.status === 409 || response.status === 422 ? 'conflict' : 'failed');
        }
        return responseJson(response);
      };

      const user = await apiRequest('/user', 'GET');
      if (typeof user.login !== 'string' || !user.login) throw new RepositoryCreationError('failed');
      const ownerIsUser = user.login.toLowerCase() === input.owner.toLowerCase();
      const ownerPath = encodeURIComponent(input.owner);
      const repositoryPath = `/repos/${ownerPath}/${encodeURIComponent(input.name)}`;
      const repository = await apiRequest(ownerIsUser ? '/user/repos' : `/orgs/${ownerPath}/repos`, 'POST', {
        name: input.name,
        description: input.description,
        private: input.visibility === 'private',
        auto_init: true,
      });
      const fullName = `${input.owner}/${input.name}`.toLowerCase();
      if (typeof repository.full_name !== 'string' || repository.full_name.toLowerCase() !== fullName ||
        typeof repository.default_branch !== 'string' || !repository.default_branch) {
        throw new RepositoryCreationError('failed');
      }
      if (repository.default_branch !== input.defaultBranch) {
        const updatedRepository = await apiRequest(repositoryPath, 'PATCH', { default_branch: input.defaultBranch });
        if (updatedRepository.default_branch !== input.defaultBranch) {
          throw new RepositoryCreationError('failed');
        }
      }
      return `https://github.com/${input.owner}/${input.name}`;
    },
  };
}
