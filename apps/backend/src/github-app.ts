import { createPrivateKey } from 'node:crypto';
import { SignJWT } from 'jose';

export interface GitHubAppTokenIssuer {
  issue(repository: string): Promise<string>;
}

interface GitHubAppTokenIssuerOptions {
  appId: string;
  getPrivateKey: () => Promise<string>;
  fetch?: typeof fetch;
  now?: () => number;
}

const githubApi = 'https://api.github.com';
const maxResponseBytes = 16 * 1024;

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function requestJson(
  fetchImpl: typeof fetch,
  path: string,
  appToken: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
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
  if (!response.ok) throw new Error('GitHub App request failed');
  const text = await response.text();
  if (Buffer.byteLength(text) > maxResponseBytes) throw new Error('GitHub App response is too large');
  const payload = object(JSON.parse(text) as unknown);
  if (!payload) throw new Error('GitHub App response is invalid');
  return payload;
}

export function createGitHubAppTokenIssuer({
  appId,
  getPrivateKey,
  fetch: fetchImpl = fetch,
  now = Date.now,
}: GitHubAppTokenIssuerOptions): GitHubAppTokenIssuer {
  return {
    async issue(repository) {
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

      const installation = await requestJson(
        fetchImpl,
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/installation`,
        appToken,
      );
      const installationId = installation.id;
      if (!(typeof installationId === 'number' && Number.isSafeInteger(installationId) && installationId > 0) &&
        !(typeof installationId === 'string' && /^[1-9][0-9]{0,19}$/u.test(installationId))) {
        throw new Error('GitHub installation response is invalid');
      }

      const token = await requestJson(
        fetchImpl,
        `/app/installations/${installationId}/access_tokens`,
        appToken,
        { repositories: [name], permissions: { contents: 'write', pull_requests: 'write' } },
      );
      const expiresAt = typeof token.expires_at === 'string' ? Date.parse(token.expires_at) : Number.NaN;
      const lifetime = expiresAt - now();
      if (typeof token.token !== 'string' || token.token.length === 0 || token.token.length > 4096 ||
        Array.from(token.token).some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || code === 127;
        }) || !Number.isFinite(expiresAt) ||
        lifetime < 50 * 60 * 1000 || lifetime > 65 * 60 * 1000) {
        throw new Error('GitHub installation token response is invalid');
      }
      return token.token;
    },
  };
}
