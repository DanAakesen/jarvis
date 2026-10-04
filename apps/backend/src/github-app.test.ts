import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { jwtVerify } from 'jose';
import {
  createGitHubAppRepositoryCatalog,
  createGitHubAppTokenIssuer,
  repositoryCacheTtlMs,
} from './github-app.js';

describe('GitHub App installation tokens', () => {
  it('signs a short-lived App JWT and requests a one-hour token scoped to one repository', async () => {
    const now = Date.parse('2026-10-04T09:00:00.000Z');
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 123 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        token: 'ghs_test-installation-token',
        expires_at: new Date(now + 60 * 60 * 1000).toISOString(),
      }), { status: 201 }));
    const getPrivateKey = vi.fn(async () => privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
    const issuer = createGitHubAppTokenIssuer({
      appId: '123456',
      getPrivateKey,
      fetch: fetchImpl,
      now: () => now,
    });

    await expect(issuer.issue('DanAakesen/jarvis-test-target')).resolves.toBe('ghs_test-installation-token');
    expect(getPrivateKey).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [installationUrl, installationOptions] = fetchImpl.mock.calls[0]!;
    expect(installationUrl).toBe('https://api.github.com/repos/DanAakesen/jarvis-test-target/installation');
    const headers = installationOptions?.headers as Record<string, string>;
    const appToken = headers.Authorization?.slice(headers.Authorization.indexOf(' ') + 1);
    expect(appToken).toBeTruthy();
    const verified = await jwtVerify(appToken!, publicKey, {
      algorithms: ['RS256'], issuer: '123456', currentDate: new Date(now),
    });
    expect(verified.payload).toMatchObject({ iat: now / 1000 - 60, exp: now / 1000 + 9 * 60 });
    const [tokenUrl, tokenOptions] = fetchImpl.mock.calls[1]!;
    expect(tokenUrl).toBe('https://api.github.com/app/installations/123/access_tokens');
    expect(JSON.parse(String(tokenOptions?.body))).toEqual({
      repositories: ['jarvis-test-target'],
      permissions: { contents: 'write', pull_requests: 'write' },
    });
    expect(tokenOptions?.redirect).toBe('error');
  });

  it('lists every installed repository with a read-only token, caches the result, and refreshes on demand', async () => {
    const now = Date.parse('2026-10-04T09:00:00.000Z');
    const readOnlyToken = ['ghs', 'read-only-test-token'].join('_');
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const fetchImpl = vi.fn<typeof fetch>();
    const repositories = [
      {
        full_name: 'DanAakesen/first',
        name: 'first',
        default_branch: 'main',
        pushed_at: '2026-10-03T12:00:00Z',
        language: 'TypeScript',
      },
      {
        full_name: 'DanAakesen/second',
        name: 'second',
        default_branch: 'stable',
        pushed_at: null,
        language: null,
      },
    ];
    const queueList = () => {
      fetchImpl
        .mockResolvedValueOnce(new Response(JSON.stringify([{
          id: 123, account: { login: 'DanAakesen' }, suspended_at: null,
        }]), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          token: readOnlyToken,
          expires_at: new Date(now + 60 * 60 * 1000).toISOString(),
        }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ total_count: 2, repositories: repositories.slice(0, 1) }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ total_count: 2, repositories: repositories.slice(1) }), { status: 200 }));
    };
    queueList();
    const catalog = createGitHubAppRepositoryCatalog({
      appId: '123456',
      getPrivateKey: async () => privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      fetch: fetchImpl,
      now: () => now,
    });

    const first = await catalog.list('DanAakesen');
    expect(first).toEqual({
      repositories: [
        {
          fullName: 'DanAakesen/first', name: 'first', defaultBranch: 'main',
          pushedAt: '2026-10-03T12:00:00Z', language: 'TypeScript',
        },
        {
          fullName: 'DanAakesen/second', name: 'second', defaultBranch: 'stable',
          pushedAt: null, language: null,
        },
      ],
      fetchedAt: new Date(now).toISOString(),
    });
    expect(JSON.stringify(first)).not.toContain('ghs_');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.github.com/app/installations?per_page=100&page=1',
      'https://api.github.com/app/installations/123/access_tokens',
      'https://api.github.com/installation/repositories?per_page=100&page=1',
      'https://api.github.com/installation/repositories?per_page=100&page=2',
    ]);
    const tokenOptions = fetchImpl.mock.calls[1]?.[1];
    expect(JSON.parse(String(tokenOptions?.body))).toEqual({ permissions: { contents: 'read' } });
    expect((fetchImpl.mock.calls[2]?.[1]?.headers as Record<string, string>).Authorization).toContain(readOnlyToken);

    await catalog.list('danaakesen');
    expect(fetchImpl).toHaveBeenCalledTimes(4);

    queueList();
    await catalog.list('DanAakesen', true);
    expect(fetchImpl).toHaveBeenCalledTimes(8);
    expect(repositoryCacheTtlMs).toBe(5 * 60 * 1000);
  });

  it('detects repository technology from the default branch tree using a contents-read token', async () => {
    const now = Date.parse('2026-10-04T09:00:00.000Z');
    const readOnlyToken = ['ghs', 'tree-read-token'].join('_');
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        id: 123, account: { login: 'DanAakesen' }, suspended_at: null,
      }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        token: readOnlyToken,
        expires_at: new Date(now + 60 * 60 * 1000).toISOString(),
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tree: [{ path: 'src/Jarvis.csproj' }, { path: 'README.md' }],
        truncated: false,
      }), { status: 200 }));
    const catalog = createGitHubAppRepositoryCatalog({
      appId: '123456',
      getPrivateKey: async () => privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      fetch: fetchImpl,
      now: () => now,
    });

    await expect(catalog.detectTech({
      fullName: 'DanAakesen/jarvis', name: 'jarvis', defaultBranch: 'release/test',
      pushedAt: null, language: 'C#',
    })).resolves.toBe('dotnet');
    expect(fetchImpl.mock.calls[2]?.[0]).toBe('https://api.github.com/repos/DanAakesen/jarvis/git/trees/release%2Ftest?recursive=1');
    expect((fetchImpl.mock.calls[2]?.[1]?.headers as Record<string, string>).Authorization).toContain(readOnlyToken);
  });

  it.each([
    ['missing', new Response('{}', { status: 404 })],
    ['oversized', new Response('x'.repeat(1024 * 1024 + 1))],
  ])('falls back to a normalized primary language when the tree is %s', async (_reason, treeResponse) => {
    const now = Date.parse('2026-10-04T09:00:00.000Z');
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        id: 123, account: { login: 'DanAakesen' }, suspended_at: null,
      }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        token: 'ghs_language-fallback-token',
        expires_at: new Date(now + 60 * 60 * 1000).toISOString(),
      }), { status: 201 }))
      .mockResolvedValueOnce(treeResponse);
    const catalog = createGitHubAppRepositoryCatalog({
      appId: '123456',
      getPrivateKey: async () => privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      fetch: fetchImpl,
      now: () => now,
    });

    await expect(catalog.detectTech({
      fullName: 'DanAakesen/repository', name: 'repository', defaultBranch: 'main',
      pushedAt: null, language: 'Visual Basic',
    })).resolves.toBe('visual-basic');
  });

  it('rejects invalid repositories and non-one-hour or failed GitHub responses', async () => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const now = Date.parse('2026-10-04T09:00:00.000Z');
    const fetchImpl = vi.fn<typeof fetch>();
    const issuer = createGitHubAppTokenIssuer({
      appId: '123456',
      getPrivateKey: async () => privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      fetch: fetchImpl,
      now: () => now,
    });

    await expect(issuer.issue('github.com/owner/repo')).rejects.toThrow('repository is invalid');
    expect(fetchImpl).not.toHaveBeenCalled();

    fetchImpl
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 123 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        token: 'ghs_short-lived-token',
        expires_at: new Date(now + 10 * 60 * 1000).toISOString(),
      }), { status: 201 }));
    await expect(issuer.issue('DanAakesen/repo')).rejects.toThrow('token response is invalid');

    fetchImpl.mockResolvedValueOnce(new Response('{}', { status: 403 }));
    await expect(issuer.issue('DanAakesen/repo')).rejects.toThrow('GitHub App request failed');

    fetchImpl.mockResolvedValueOnce(new Response('x'.repeat(16 * 1024 + 1)));
    await expect(issuer.issue('DanAakesen/repo')).rejects.toThrow('response is too large');
  });
});
