import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { jwtVerify } from 'jose';
import { createGitHubAppTokenIssuer } from './github-app.js';

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
  });
});
