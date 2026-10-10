import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
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
    if (parsed.pathname.endsWith('/issues') && method === 'GET') return Response.json([]);
    if (parsed.pathname.endsWith('/issues') && method === 'POST') {
      return Response.json({
        number: 9,
        html_url: 'https://github.com/DanAakesen/jarvis/issues/9',
      }, { status: 201 });
    }
    if (parsed.pathname.endsWith('/labels') && method === 'POST') return Response.json([{ name: 'Jarvis' }]);
    if (parsed.pathname.endsWith('/comments') && method === 'POST') return Response.json({ id: 1 }, { status: 201 });
    if (method === 'DELETE') return new Response(null, { status: 204 });
    throw new Error(`Unexpected GitHub request: ${url}`);
  });
  return { calls, tokenIssuer, fetch, client: createGitHubIssueClient(tokenIssuer, fetch) };
}

describe('GitHub issue client', () => {
  it('creates the dedicated branch and commits only the confirmed image with a content-addressed URL', async () => {
    const calls: { path: string; method: string; body: unknown }[] = [];
    const tokenIssuer = { issueForContentsWrite: vi.fn(async () => 'contents-write-token') } as unknown as GitHubAppTokenIssuer;
    const bytes = Buffer.from('sanitized image fixture');
    let branchExists = false;
    let committed = false;
    const client = createGitHubIssueClient(tokenIssuer, async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined;
      calls.push({ path: url.pathname, method, body });
      if (url.pathname.endsWith('/git/ref/heads/issue-attachments')) {
        return branchExists ? Response.json({ object: { sha: 'a'.repeat(40) } }) : new Response(null, { status: 404 });
      }
      if (url.pathname.endsWith('/jarvis')) return Response.json({ default_branch: 'main' });
      if (url.pathname.endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: 'a'.repeat(40) } });
      if (url.pathname.endsWith('/git/refs')) { branchExists = true; return Response.json({}); }
      if (method === 'PUT') { committed = true; return Response.json({}); }
      return committed
        ? Response.json({ sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') })
        : new Response(null, { status: 404 });
    });
    const url = await client.publishIssueImage!('DanAakesen/jarvis', 8, bytes, 'png');
    expect(url).toBe(`https://raw.githubusercontent.com/DanAakesen/jarvis/issue-attachments/issue-attachments/8/${createHash('sha256').update(bytes).digest('hex')}.png`);
    expect(calls.filter(({ method }) => method === 'POST')).toEqual([{
      path: '/repos/DanAakesen/jarvis/git/refs', method: 'POST',
      body: { ref: 'refs/heads/issue-attachments', sha: 'a'.repeat(40) },
    }]);
    expect(calls.find(({ method }) => method === 'PUT')?.body).toEqual({
      branch: 'issue-attachments', content: bytes.toString('base64'), message: 'Add confirmed image for issue #8',
    });
    await client.publishIssueImage!('DanAakesen/jarvis', 8, bytes, 'png');
    expect(calls.filter(({ method }) => method === 'PUT')).toHaveLength(1);
    expect(calls.some(({ path }) => path.includes('/merges'))).toBe(false);
    expect(tokenIssuer.issueForContentsWrite).toHaveBeenCalledWith('DanAakesen/jarvis');
  });
  it('reads issue context, creates linked issues and progress comments, and removes labels', async () => {
    const test = fixture();
    await expect(test.client.readIssue('DanAakesen/jarvis', 8)).resolves.toMatchObject({
      number: 8, title: 'P10-02: Factory tasks', labels: ['Codex'], isPullRequest: false,
    });
    await expect(test.client.readComments('DanAakesen/jarvis', 8)).resolves.toEqual([
      { author: 'DanAakesen', body: 'Please implement it.' },
    ]);
    await expect(test.client.readAgentRules('DanAakesen/jarvis')).resolves.toBe('Follow AGENTS.md');
    await expect(test.client.listIssueTitles('DanAakesen/jarvis')).resolves.toEqual([]);
    await expect(test.client.createIssue('DanAakesen/jarvis', 'Fix task', 'Issue details'))
      .resolves.toMatchObject({ number: 9 });
    await test.client.createComment('DanAakesen/jarvis', 8, 'Started.');
    await test.client.addLabels('DanAakesen/jarvis', 8, ['Jarvis']);
    await test.client.removeLabel('DanAakesen/jarvis', 8, 'Codex');

    expect(test.calls.map(({ method }) => method)).toEqual(['GET', 'GET', 'GET', 'GET', 'POST', 'POST', 'POST', 'DELETE']);
    expect(test.calls[4]?.body).toBe(JSON.stringify({ title: 'Fix task', body: 'Issue details' }));
    expect(test.calls[6]?.body).toBe(JSON.stringify({ labels: ['Jarvis'] }));
    expect(test.tokenIssuer.issueForRepositoryRead).toHaveBeenCalledTimes(3);
    expect(test.tokenIssuer.issueForContents).toHaveBeenCalledWith('DanAakesen/jarvis');
    expect(test.tokenIssuer.issueForIssuesWrite).toHaveBeenCalledTimes(4);
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

  it('reads bounded issue-title pages for safe task-code allocation', async () => {
    const requestedPages: string[] = [];
    const client = createGitHubIssueClient({
      issueForRepositoryRead: vi.fn(async () => 'token'),
    } as unknown as GitHubAppTokenIssuer, async (input) => {
      const url = new URL(String(input));
      requestedPages.push(url.searchParams.get('page') ?? '');
      return Response.json(url.searchParams.get('page') === '1'
        ? Array.from({ length: 100 }, (_value, index) => ({ title: `Issue ${index}` }))
        : [{ title: 'P11-01: Existing work' }]);
    });

    await expect(client.listIssueTitles('DanAakesen/jarvis')).resolves.toHaveLength(101);
    expect(requestedPages).toEqual(['1', '2']);
  });

  it('finds a task-marker title suffix in the repository issue list without matching pull requests', async () => {
    const client = createGitHubIssueClient({
      issueForRepositoryRead: vi.fn(async () => 'token'),
    } as unknown as GitHubAppTokenIssuer, async () => Response.json([
      { number: 20, title: 'P11-02: Factory task 10', pull_request: {} },
      { number: 21, title: 'P11-01: Factory task 10 [Factory task 10]' },
    ]));

    await expect(client.findIssueByTitleSuffix('DanAakesen/jarvis', ' [Factory task 10]'))
      .resolves.toEqual({
        number: 21,
        url: 'https://github.com/DanAakesen/jarvis/issues/21',
      });
  });

  it('includes labels and assignees in the issue creation request', async () => {
    const test = fixture();
    await test.client.createIssue('DanAakesen/jarvis', 'P11-01: Fix', 'Problem and acceptance', {
      labels: ['P11', 'bug', 'Copilot'],
      assignees: ['copilot'],
    });

    expect(test.calls.at(-1)?.body).toBe(JSON.stringify({
      title: 'P11-01: Fix',
      body: 'Problem and acceptance',
      labels: ['P11', 'bug', 'Copilot'],
      assignees: ['copilot'],
    }));
  });
});
