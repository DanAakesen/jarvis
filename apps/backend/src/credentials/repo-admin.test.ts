import { describe, expect, it, vi } from 'vitest';
import { createRepoAdminRepositoryCreator, RepositoryCreationError } from './repo-admin.js';

const repositoryToken = 'repo-admin-test-token-not-for-sandbox';
const vaultToken = 'vault-access-test-token';

describe('backend repository creation credential boundary', () => {
  it('reads the admin secret from Key Vault and creates a repository without returning the token', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const parsedUrl = String(url);
      calls.push({ url: parsedUrl, init: init ?? {} });
      if (parsedUrl.includes('vault.azure.net')) {
        return Response.json({ value: repositoryToken });
      }
      if (parsedUrl.endsWith('/user')) return Response.json({ login: 'DanAakesen' });
      if (parsedUrl.endsWith('/user/repos')) {
        return Response.json({ full_name: 'DanAakesen/new-project', default_branch: 'master' }, { status: 201 });
      }
      if (parsedUrl.endsWith('/repos/DanAakesen/new-project')) {
        return Response.json({ default_branch: 'main' });
      }
      throw new Error('Unexpected request');
    });
    const getToken = vi.fn(async (scope: string) => {
      expect(scope).toBe('https://vault.azure.net/.default');
      return vaultToken;
    });
    const creator = createRepoAdminRepositoryCreator(
      'https://kv-jarvis.vault.azure.net/',
      getToken,
      fetcher as typeof fetch,
    );

    const repositoryUrl = await creator.create({
      owner: 'DanAakesen',
      name: 'new-project',
      description: 'A new project',
      visibility: 'private',
      defaultBranch: 'main',
    }, new AbortController().signal);

    expect(repositoryUrl).toBe('https://github.com/DanAakesen/new-project');
    expect(getToken).toHaveBeenCalledOnce();
    expect(calls.map(({ url }) => url)).toEqual([
      'https://kv-jarvis.vault.azure.net/secrets/jarvis-repo-admin?api-version=7.4',
      'https://api.github.com/user',
      'https://api.github.com/user/repos',
      'https://api.github.com/repos/DanAakesen/new-project',
    ]);
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: ['Bearer', vaultToken].join(' ') });
    expect(calls[1]?.init.headers).toMatchObject({ Authorization: ['Bearer', repositoryToken].join(' ') });
    expect(JSON.parse(String(calls[2]?.init.body))).toEqual({
      name: 'new-project',
      description: 'A new project',
      private: true,
      auto_init: true,
    });
    expect(JSON.parse(String(calls[3]?.init.body))).toEqual({ default_branch: 'main' });
    expect(JSON.stringify({ repositoryUrl, calls: calls.map(({ url, init }) => ({ url, body: init.body })) }))
      .not.toContain(repositoryToken);
    expect(repositoryUrl).not.toContain(vaultToken);
  });

  it('uses the organization endpoint and refuses conflicts without exposing provider details', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      if (String(url).includes('vault.azure.net')) return Response.json({ value: repositoryToken });
      if (String(url).endsWith('/user')) return Response.json({ login: 'DanAakesen' });
      return Response.json({ message: `duplicate ${repositoryToken}` }, { status: 422 });
    });
    const creator = createRepoAdminRepositoryCreator(
      'https://kv-jarvis.vault.azure.net',
      async () => vaultToken,
      fetcher as typeof fetch,
    );

    await expect(creator.create({
      owner: 'jarvis-org',
      name: 'new-project',
      description: 'A new project',
      visibility: 'public',
      defaultBranch: 'main',
    }, new AbortController().signal)).rejects.toMatchObject<Partial<RepositoryCreationError>>({ kind: 'conflict' });
    expect(String(fetcher.mock.calls[2]?.[0])).toBe('https://api.github.com/orgs/jarvis-org/repos');
  });

  it('rejects an unsafe Key Vault URL before making a request', () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(() => createRepoAdminRepositoryCreator(
      'https://attacker.example/',
      async () => vaultToken,
      fetcher,
    )).toThrow('Key Vault URI must be a secure Azure Key Vault origin');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
