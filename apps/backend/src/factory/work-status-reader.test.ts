import { describe, expect, it, vi } from 'vitest';
import { createGitHubFactoryBoardReader, linkedIssueNumbers } from './board.js';

const repo = 'DanAakesen/jarvis';
const sha = 'a'.repeat(40);
describe('historical work status GitHub reads', () => {
  it('reads historical same-repository cross references using GET only', async () => {
    const fetcher = vi.fn(async (_url, options) => {
      expect(options.method).toBeUndefined();
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(options.redirect).toBe('error');
      return Response.json([
        { event: 'cross-referenced', source: { issue: { number: 9, html_url: `https://github.com/${repo}/pull/9`, pull_request: {} } } },
        { event: 'cross-referenced', source: { issue: { number: 12, html_url: 'https://github.com/other/repo/pull/12', pull_request: {} } } },
        { event: 'commented', source: { issue: { number: 13, html_url: `https://github.com/${repo}/pull/13`, pull_request: {} } } },
      ]);
    }) as unknown as typeof fetch;
    expect(await createGitHubFactoryBoardReader(fetcher).issuePullRequests!(repo, 'token', 8)).toEqual([9]);
    expect(vi.mocked(fetcher).mock.calls[0]?.[0]).toContain('/issues/8/timeline');
  });
  it('parses merged PR, closing references and both check providers', async () => {
    const fetcher = vi.fn(async (url) => {
      if (String(url).endsWith('/pulls/9')) return Response.json({ number: 9, html_url: `https://github.com/${repo}/pull/9`,
        draft: false, state: 'closed', merged: true, merge_commit_sha: sha, head: { sha },
        body: 'Fixes #8\nResolves #10' });
      if (String(url).includes('/check-runs')) return Response.json({ total_count: 1,
        check_runs: [{ status: 'completed', conclusion: 'success' }] });
      return Response.json({ state: 'success', total_count: 1, statuses: [{ state: 'success' }] });
    }) as unknown as typeof fetch;
    expect(await createGitHubFactoryBoardReader(fetcher).readPullRequest!(repo, 'token', 9)).toMatchObject({
      state: 'merged', mergeSha: sha, draft: false, checks: 'passed', linkedIssues: [8, 10],
    });
    expect(vi.mocked(fetcher).mock.calls).toHaveLength(3);
  });
  it.each([
    [{ total_count: 0, check_runs: [] }, { state: 'pending', total_count: 0, statuses: [] }, 'pending'],
    [{ total_count: 101, check_runs: [{ status: 'completed', conclusion: 'success' }] }, { state: 'success', total_count: 1, statuses: [{ state: 'success' }] }, 'pending'],
    [{ total_count: 1, check_runs: [{ status: 'completed', conclusion: 'failure' }] }, { state: 'success', total_count: 1, statuses: [{ state: 'success' }] }, 'failed'],
    [{ total_count: 1, check_runs: [{ status: 'in_progress', conclusion: null }] }, { state: 'pending', total_count: 0, statuses: [] }, 'pending'],
    [{ total_count: -1, check_runs: [] }, { state: 'success', total_count: 0, statuses: [] }, 'pending'],
    [{ total_count: 0, check_runs: [] }, { state: 'success', total_count: 1, statuses: [] }, 'pending'],
  ])('conservatively parses checks %j', async (checks, status, expected) => {
    const fetcher = vi.fn(async (url) => String(url).endsWith('/pulls/9')
      ? Response.json({ number: 9, html_url: `https://github.com/${repo}/pull/9`,
        draft: true, state: 'open', merged: false, merge_commit_sha: null, head: { sha }, body: 'Fixes #8' })
      : Response.json(String(url).includes('/check-runs') ? checks : status)) as unknown as typeof fetch;
    expect((await createGitHubFactoryBoardReader(fetcher).readPullRequest!(repo, 'token', 9)).checks).toBe(expected);
  });
  it('rejects foreign PR URLs and malformed merge SHAs', async () => {
    const fetcher = vi.fn(async () => Response.json({ number: 9, html_url: `https://github.com/${repo}/pull/9`,
      draft: false, state: 'closed', merged: true, merge_commit_sha: 'bad', head: { sha }, body: null })) as unknown as typeof fetch;
    await expect(createGitHubFactoryBoardReader(fetcher).readPullRequest!(repo, 'token', 9)).rejects.toThrow();
  });
  it('quotes untrusted query qualifiers and marks capped search incomplete', async () => {
    const fetcher = vi.fn(async (url) => {
      const query = new URL(String(url)).searchParams.get('q');
      expect(query).toBe(`repo:${repo} is:issue "repo:other/repo work" in:title`);
      return Response.json({ total_count: 101, incomplete_results: false,
        items: [{ number: 8, repository_url: `https://api.github.com/repos/${repo}`,
          html_url: `https://github.com/${repo}/issues/8` }] });
    }) as unknown as typeof fetch;
    expect(await createGitHubFactoryBoardReader(fetcher).searchIssues!(repo, 'token', 'repo:other/repo work'))
      .toEqual({ numbers: [8], incomplete: true });
  });
  it('recognizes own-repository qualified closing references but not foreign repositories', () => {
    const body = `Fixes #8\nCloses ${repo}#627\nResolves https://github.com/${repo}/issues/10\nFixes other/repo#627`;
    expect([...linkedIssueNumbers(body, repo)]).toEqual([8, 627, 10]);
    expect([...linkedIssueNumbers(body)]).toEqual([8]);
  });
  it.each([
    { number: 8, repository_url: 'https://api.github.com/repos/other/repo', html_url: 'https://github.com/other/repo/issues/8' },
    { number: 8, repository_url: `https://api.github.com/repos/${repo}`, html_url: `https://github.com/${repo}/pull/8`, pull_request: {} },
  ])('refuses foreign or pull-request search result %j', async (item) => {
    const fetcher = vi.fn(async () => Response.json({ total_count: 1, incomplete_results: false, items: [item] })) as unknown as typeof fetch;
    await expect(createGitHubFactoryBoardReader(fetcher).searchIssues!(repo, 'token', 'work')).rejects.toThrow();
  });
  it('preserves merged PR evidence when checks permission or provider reads fail', async () => {
    const fetcher = vi.fn(async (url) => String(url).endsWith('/pulls/9')
      ? Response.json({ number: 9, html_url: `https://github.com/${repo}/pull/9`,
        draft: false, state: 'closed', merged: true, merge_commit_sha: sha, head: { sha }, body: 'Fixes #8' })
      : new Response(null, { status: 403 })) as unknown as typeof fetch;
    expect(await createGitHubFactoryBoardReader(fetcher).readPullRequest!(repo, 'token', 9)).toMatchObject({
      state: 'merged', mergeSha: sha, checks: 'pending', checksIncomplete: true,
    });
  });
  it('refuses incomplete historical pagination instead of silently omitting merged PRs', async () => {
    const fetcher = vi.fn(async () => Response.json([], { headers: { link: '<https://api.github.com/next>; rel="next"' } })) as unknown as typeof fetch;
    await expect(createGitHubFactoryBoardReader(fetcher).issuePullRequests!(repo, 'token', 8)).rejects.toThrow('limit');
    expect(vi.mocked(fetcher).mock.calls).toHaveLength(10);
  });
});
