import { describe, expect, it, vi } from 'vitest';
import type { GitHubAppTokenIssuer } from '../github-app.js';
import { createGitHubIssueClient } from './issues.js';

function fixture() {
  const calls: { url: string; method: string; body?: string }[] = [];
  const tokenIssuer = {
    issueForRepositoryRead: vi.fn(async () => 'repository-read-token'),
    issueForContents: vi.fn(async () => 'contents-token'),
    issueForIssuesWrite: vi.fn(async () => 'issues-write-token'),
  } as unknown as GitHubAppTokenIssuer;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/issues/8')) {
      return Response.json({
        number: 8, title: 'P10-02: Factory tasks', body: 'Issue body', state: 'open',
        html_url: 'https://github.com/DanAakesen/jarvis/issues/8', labels: [{ name: 'Codex' }],
      });
    }
    if (parsed.pathname.endsWith('/issues/8/comments')) {
      return Response.json([{ user: { login: 'DanAakesen' }, body: 'Please implement it.' }]);
    }
    if (parsed.pathname.endsWith('/contents/AGENTS.md')) {
      return Response.json({ encoding: 'base64', content: Buffer.from('Follow AGENTS.md').toString('base64') });
    }
    if (parsed.pathname.endsWith('/issues') && method === 'POST') {
      return Response.json({
        number: 9,
        html_url: 'https://github.com/DanAakesen/jarvis/issues/9',
      }, { status: 201 });
    }
    if (parsed.pathname.endsWith('/comments') && method === 'POST') return Response.json({ id: 1 }, { status: 201 });
    if (method === 'DELETE') return new Response(null, { status: 204 });
    throw new Error(`Unexpected GitHub request: ${url}`);
  });
  return { calls, tokenIssuer, fetch, client: createGitHubIssueClient(tokenIssuer, fetch) };
}

describe('GitHub issue client', () => {
  it('reads issue context, creates linked issues and progress comments, and removes labels', async () => {
    const test = fixture();
    await expect(test.client.readIssue('DanAakesen/jarvis', 8)).resolves.toMatchObject({
      number: 8, title: 'P10-02: Factory tasks', labels: ['Codex'], isPullRequest: false,
    });
    await expect(test.client.readComments('DanAakesen/jarvis', 8)).resolves.toEqual([
      { author: 'DanAakesen', body: 'Please implement it.' },
    ]);
    await expect(test.client.readAgentRules('DanAakesen/jarvis')).resolves.toBe('Follow AGENTS.md');
    await expect(test.client.createIssue('DanAakesen/jarvis', 'Fix task', 'Issue details'))
      .resolves.toMatchObject({ number: 9 });
    await test.client.createComment('DanAakesen/jarvis', 8, 'Started.');
    await test.client.removeLabel('DanAakesen/jarvis', 8, 'Codex');

    expect(test.calls.map(({ method }) => method)).toEqual(['GET', 'GET', 'GET', 'POST', 'POST', 'DELETE']);
    expect(test.calls[3]?.body).toBe(JSON.stringify({ title: 'Fix task', body: 'Issue details' }));
    expect(test.tokenIssuer.issueForRepositoryRead).toHaveBeenCalledTimes(2);
    expect(test.tokenIssuer.issueForContents).toHaveBeenCalledWith('DanAakesen/jarvis');
    expect(test.tokenIssuer.issueForIssuesWrite).toHaveBeenCalledTimes(3);
  });

  it('treats a missing GitHub issue as not found', async () => {
    const tokenIssuer = {
      issueForRepositoryRead: vi.fn(async () => 'token'),
    } as unknown as GitHubAppTokenIssuer;
    const missing = createGitHubIssueClient(tokenIssuer, async () => new Response(null, { status: 404 }));
    await expect(missing.readIssue('DanAakesen/jarvis', 404)).resolves.toBeNull();
  });

  it('reads paginated issue comments and permits repositories without AGENTS.md', async () => {
    const tokenIssuer = {
      issueForRepositoryRead: vi.fn(async () => 'token'),
      issueForContents: vi.fn(async () => 'contents-token'),
    } as unknown as GitHubAppTokenIssuer;
    const requestedPages: string[] = [];
    const client = createGitHubIssueClient(tokenIssuer, async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/comments')) {
        requestedPages.push(url.searchParams.get('page') ?? '');
        const count = url.searchParams.get('page') === '1' ? 100 : 2;
        return Response.json(Array.from({ length: count }, (_value, index) => ({
          user: { login: 'DanAakesen' }, body: `Comment ${index}`,
        })));
      }
      return new Response(null, { status: 404 });
    });

    await expect(client.readComments('DanAakesen/jarvis', 8)).resolves.toHaveLength(102);
    await expect(client.readAgentRules('DanAakesen/jarvis')).resolves.toBe('');
    expect(requestedPages).toEqual(['1', '2']);
  });
});
