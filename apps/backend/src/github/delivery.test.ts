import { describe, expect, it, vi } from 'vitest';
import type { GitHubAppTokenIssuer } from '../github-app.js';
import { createGitHubDeliveryHandler } from './delivery.js';

const workspace = {
  repository: 'DanAakesen/jarvis-test-target',
  defaultBranch: 'main',
  branch: 'jarvis/task-42',
};
const task = { id: '42', title: 'Fix the bug' };
const pullRequest = {
  number: 73,
  state: 'open',
  head: { ref: workspace.branch, repo: { full_name: workspace.repository } },
  base: { ref: workspace.defaultBranch },
};

function tokenIssuer(): GitHubAppTokenIssuer {
  return { issue: vi.fn(async () => 'installation-token'), issueForActions: vi.fn(async () => 'actions-token') };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function github(options: {
  existing?: boolean;
  aheadBy?: number;
  branchStatus?: number;
} = {}) {
  const calls: { url: string; method: string; body?: string }[] = [];
  let created = options.existing ?? false;
  let createRequests = 0;
  let createdPullRequests = 0;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
    const parsed = new URL(url);
    if (parsed.pathname.endsWith(`/branches/${encodeURIComponent(workspace.branch)}`)) {
      return options.branchStatus
        ? jsonResponse({}, options.branchStatus)
        : jsonResponse({ name: workspace.branch });
    }
    if (parsed.pathname.endsWith('/pulls') && method === 'GET') {
      return jsonResponse(created ? [pullRequest] : []);
    }
    if (parsed.pathname.endsWith('/compare/main...jarvis%2Ftask-42')) {
      return jsonResponse({ ahead_by: options.aheadBy ?? 1 });
    }
    if (parsed.pathname.endsWith('/pulls') && method === 'POST') {
      createRequests += 1;
      if (createRequests > 1) {
        created = true;
        return jsonResponse({ message: 'A pull request already exists' }, 422);
      }
      createdPullRequests += 1;
      created = true;
      return jsonResponse(pullRequest, 201);
    }
    throw new Error(`Unexpected GitHub request: ${url}`);
  });
  return { fetch, calls, get creates() { return createdPullRequests; } };
}

function fixture(fetch: typeof globalThis.fetch) {
  const recordEvent = vi.fn(async () => ({ id: '1' } as never));
  const handler = createGitHubDeliveryHandler(
    tokenIssuer(),
    { recordEvent } as never,
    'https://jarvis.example',
    fetch,
  );
  return { handler, recordEvent };
}

describe('GitHub task delivery', () => {
  it('opens one PR for completed branch commits and reuses it on duplicate completions', async () => {
    const api = github();
    const test = fixture(api.fetch);

    await expect(test.handler(workspace, task)).resolves.toEqual({ kind: 'awaiting_policy' });
    await expect(test.handler(workspace, task)).resolves.toEqual({ kind: 'awaiting_policy' });

    expect(api.creates).toBe(1);
    const create = api.calls.find((call) => call.method === 'POST');
    expect(create?.url).toBe('https://api.github.com/repos/DanAakesen/jarvis-test-target/pulls');
    expect(JSON.parse(create?.body ?? '{}')).toEqual({
      title: task.title,
      head: workspace.branch,
      base: workspace.defaultBranch,
      body: 'Completed by Jarvis task [#42](https://jarvis.example/factory/tasks/42).',
    });
    expect(new URL(api.calls[1]!.url).searchParams.get('head')).toBe('DanAakesen:jarvis/task-42');
    expect(new URL(api.calls[1]!.url).searchParams.get('base')).toBe('main');
    const headers = new Headers((api.fetch.mock.calls[0]?.[1] as RequestInit).headers);
    expect(headers.get('Authorization')).toBeTruthy();
    expect(test.recordEvent).toHaveBeenCalledTimes(2);
    expect(test.recordEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'pull_request_opened',
      payload: expect.objectContaining({ pullRequest: 73, reused: false }),
    }));
    expect(test.recordEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'pull_request_opened',
      payload: expect.objectContaining({ pullRequest: 73, reused: true }),
    }));
  });

  it('reuses an existing open PR without comparing or creating another', async () => {
    const api = github({ existing: true });
    const test = fixture(api.fetch);

    await expect(test.handler(workspace, task)).resolves.toEqual({ kind: 'awaiting_policy' });

    expect(api.calls).toHaveLength(2);
    expect(api.creates).toBe(0);
    expect(test.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'pull_request_opened',
      payload: expect.objectContaining({ pullRequest: 73, reused: true }),
    }));
  });

  it('refuses a branch with no commits ahead and returns a clear reason', async () => {
    const api = github({ aheadBy: 0 });
    const test = fixture(api.fetch);

    await expect(test.handler(workspace, task)).resolves.toEqual({
      kind: 'refused',
      reason: 'The task branch has no commits ahead of the project default branch; no pull request was opened.',
    });

    expect(api.creates).toBe(0);
    expect(test.recordEvent).not.toHaveBeenCalled();
  });

  it('refuses missing branches and GitHub API failures without exposing provider responses', async () => {
    const missingBranch = fixture(github({ branchStatus: 404 }).fetch);
    await expect(missingBranch.handler(workspace, task)).resolves.toEqual({
      kind: 'refused',
      reason: 'The task branch does not exist in the configured repository.',
    });

    const failureFetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({ message: 'private details' }, 500));
    const failedApi = fixture(failureFetch);
    await expect(failedApi.handler(workspace, task)).resolves.toEqual({
      kind: 'refused',
      reason: 'GitHub could not verify or open the task pull request. Check repository access and retry the task.',
    });
  });

  it('recovers a concurrent duplicate create by reusing the PR GitHub already opened', async () => {
    const api = github();
    const originalFetch = api.fetch;
    let releasePullRequestReads!: () => void;
    const bothPullRequestReads = new Promise<void>((resolve) => { releasePullRequestReads = resolve; });
    let pullRequestReads = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (String(input).includes('/pulls?')) {
        pullRequestReads += 1;
        if (pullRequestReads === 2) releasePullRequestReads();
        if (pullRequestReads <= 2) await bothPullRequestReads;
      }
      return originalFetch(input, init);
    });
    const test = fixture(fetch);

    await expect(Promise.all([
      test.handler(workspace, task),
      test.handler(workspace, task),
    ])).resolves.toEqual([{ kind: 'awaiting_policy' }, { kind: 'awaiting_policy' }]);

    expect(api.creates).toBe(1);
    expect(test.recordEvent).toHaveBeenCalledTimes(2);
  });
});
