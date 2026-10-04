import { describe, expect, it, vi } from 'vitest';
import type { GitHubAppTokenIssuer } from '../github-app.js';
import { createGitHubDeliveryVerifier } from './delivery.js';

const workspace = {
  repository: 'DanAakesen/jarvis',
  defaultBranch: 'main',
  branch: 'jarvis/task-42',
};

function tokenIssuer(): GitHubAppTokenIssuer {
  return { issue: vi.fn(async () => 'installation-token') };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('GitHub delivery verification', () => {
  it('requires both the task branch and a pull request from the configured repository', async () => {
    const issuer = tokenIssuer();
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({ name: workspace.branch }))
      .mockResolvedValueOnce(jsonResponse([{
        head: { ref: workspace.branch, repo: { full_name: workspace.repository } },
      }]));
    const verify = createGitHubDeliveryVerifier(issuer, fetch);

    await expect(verify(workspace)).resolves.toBe(true);

    expect(issuer.issue).toHaveBeenCalledWith(workspace.repository);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[0]?.[0])).toContain('/branches/jarvis%2Ftask-42');
    expect(new URL(String(fetch.mock.calls[1]?.[0])).searchParams.get('head'))
      .toBe('DanAakesen:jarvis/task-42');
    const requestHeaders = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(requestHeaders.has('Authorization')).toBe(true);
  });

  it('rejects missing branches and pull requests without treating provider completion as delivery', async () => {
    const missingBranchFetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(jsonResponse({}, 404));
    await expect(createGitHubDeliveryVerifier(tokenIssuer(), missingBranchFetch)(workspace)).resolves.toBe(false);
    expect(missingBranchFetch).toHaveBeenCalledOnce();

    const noPullRequestFetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({ name: workspace.branch }))
      .mockResolvedValueOnce(jsonResponse([]));
    await expect(createGitHubDeliveryVerifier(tokenIssuer(), noPullRequestFetch)(workspace)).resolves.toBe(false);
  });

  it('fails closed when GitHub evidence cannot be validated', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(jsonResponse({ name: 'other-branch' }));
    await expect(createGitHubDeliveryVerifier(tokenIssuer(), fetch)(workspace))
      .rejects.toThrow('GitHub branch response is invalid');
  });
});
