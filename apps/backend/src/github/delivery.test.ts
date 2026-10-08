import { describe, expect, it, vi } from 'vitest';
import type { GitHubAppTokenIssuer } from '../github-app.js';
import { createGitHubDeliveryHandler, type TaskCompletionGate } from './delivery.js';
import type { GithubWebhookMapping } from './webhook-mapping.js';

const workspace = {
  repository: 'DanAakesen/jarvis-test-target',
  defaultBranch: 'main',
  branch: 'jarvis/task-42',
};
const task = { id: '42', title: 'Fix the bug' };
const pullRequest = {
  number: 73,
  state: 'open',
  created_at: '2026-10-04T20:06:00.000Z',
  head: { ref: workspace.branch, sha: 'a'.repeat(40), repo: { full_name: workspace.repository } },
  base: { ref: workspace.defaultBranch },
  body: null,
  draft: false,
  node_id: 'PR_kwDOExample',
};

function tokenIssuer(): GitHubAppTokenIssuer {
  return {
    issue: vi.fn(async () => 'installation-token'),
    issueForActions: vi.fn(async () => 'actions-token'),
    issueForContents: vi.fn(async () => 'contents-token'),
    issueForContentsWrite: vi.fn(async () => 'contents-write-token'),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function github(options: {
  existing?: boolean;
  aheadBy?: number;
  branchStatus?: number;
  pullRepository?: string;
  pullBody?: string | null;
  draft?: boolean;
} = {}) {
  let pullBody = options.pullBody ?? pullRequest.body;
  let draft = options.draft ?? pullRequest.draft;
  const matchingPullRequest = () => ({
    ...pullRequest,
    body: pullBody,
    draft,
    head: {
      ref: workspace.branch,
      sha: 'a'.repeat(40),
      repo: { full_name: options.pullRepository ?? workspace.repository },
    },
  });
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
      return jsonResponse(created ? [matchingPullRequest()] : []);
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
      return jsonResponse(matchingPullRequest(), 201);
    }
    if (parsed.pathname.endsWith('/pulls/73') && method === 'PATCH') {
      pullBody = JSON.parse(String(init?.body)).body as string;
      return jsonResponse(matchingPullRequest());
    }
    if (parsed.pathname === '/graphql' && method === 'POST') {
      draft = false;
      return jsonResponse({ data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } } });
    }
    throw new Error(`Unexpected GitHub request: ${url}`);
  });
  return { fetch, calls, get creates() { return createdPullRequests; } };
}

type PullRequestMapping = Extract<GithubWebhookMapping, { kind: 'pull_request' }>;

function fixture(
  fetch: typeof globalThis.fetch,
  callbacks: {
    onPullRequest?: (mapping: PullRequestMapping) => Promise<void>;
    afterPullRequest?: (mapping: PullRequestMapping) => Promise<void>;
    onPolicyError?: (failure: {
      reason: 'http' | 'timeout' | 'aborted' | 'internal';
      statusCode?: number;
    }) => void;
  } = {},
) {
  const recordEvent = vi.fn(async () => ({ id: '1' } as never));
  const recordPullRequest = callbacks.onPullRequest ?? vi.fn(async () => {});
  const handler = createGitHubDeliveryHandler(
    tokenIssuer(),
    { recordEvent } as never,
    'https://jarvis.example',
    fetch,
    recordPullRequest,
    callbacks.afterPullRequest,
    callbacks.onPolicyError,
  );
  return { handler, recordEvent, recordPullRequest, onPolicyError: callbacks.onPolicyError };
}

describe('GitHub task delivery', () => {
  it('does not create a PR when cancellation wins the completion gate', async () => {
    const api = github();
    const test = fixture(api.fetch);
    const gate: TaskCompletionGate = vi.fn(async () => ({ kind: 'not_running' }));

    await expect(test.handler(workspace, task, gate)).resolves.toEqual({ kind: 'not_running' });

    expect(api.creates).toBe(0);
    expect(test.recordEvent).not.toHaveBeenCalled();
  });

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

  it('uses the issue task ID in the PR title and closes the linked issue', async () => {
    const api = github();
    const test = fixture(api.fetch);

    await expect(test.handler(workspace, {
      id: '42',
      title: 'P10-02:   Factory tasks are backed by GitHub issues',
      issueNumber: 574,
    })).resolves.toEqual({ kind: 'awaiting_policy' });

    const create = api.calls.find((call) => call.method === 'POST');
    expect(JSON.parse(create?.body ?? '{}')).toMatchObject({
      title: 'P10-02: Factory tasks are backed by GitHub issues',
      body: expect.stringMatching(/^Fixes #574\n\n/u),
    });
  });

  it.each([false, true])('evaluates project policy after releasing the completion gate (existing PR: %s)', async (existing) => {
    const api = github({ existing });
    let gateHeld = false;
    const persisted = vi.fn(async () => { expect(gateHeld).toBe(true); });
    const evaluated = vi.fn(async () => { expect(gateHeld).toBe(false); });
    const test = fixture(api.fetch, { onPullRequest: persisted, afterPullRequest: evaluated });
    const gate: TaskCompletionGate = async (operation) => {
      gateHeld = true;
      try {
        return { kind: 'ran' as const, value: await operation() };
      } finally {
        gateHeld = false;
      }
    };

    await expect(test.handler(workspace, task, gate)).resolves.toEqual({ kind: 'awaiting_policy' });

    expect(persisted).toHaveBeenCalledOnce();
    expect(evaluated).toHaveBeenCalledOnce();
  });

  it('reconciles a timed-out create that GitHub accepted before recording the PR', async () => {
    const api = github();
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const response = await api.fetch(input, init);
      if (init?.method === 'POST') throw new Error('connection closed after GitHub accepted the create');
      return response;
    });
    const test = fixture(fetch);

    await expect(test.handler(workspace, task)).resolves.toEqual({ kind: 'awaiting_policy' });

    expect(api.creates).toBe(1);
    expect(api.calls.filter((call) => call.method === 'GET' && call.url.includes('/pulls?'))).toHaveLength(2);
    expect(test.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
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
    expect(test.recordPullRequest).toHaveBeenCalledWith({
      kind: 'pull_request',
      repository: workspace.repository,
      number: 73,
      branch: workspace.branch,
      headSha: 'a'.repeat(40),
      state: 'open',
      openedAt: '2026-10-04T20:06:00.000Z',
      mergedAt: null,
    });
  });

  it('adds the issue link and marks a reused task-branch draft PR ready for review', async () => {
    const api = github({ existing: true, pullBody: 'Changes from the task branch.', draft: true });
    const afterPullRequest = vi.fn(async () => {});
    const test = fixture(api.fetch, { afterPullRequest });

    await expect(test.handler(workspace, { ...task, issueNumber: 601 })).resolves.toEqual({ kind: 'awaiting_policy' });

    const patch = api.calls.find((call) => call.method === 'PATCH');
    expect(patch?.url).toBe('https://api.github.com/repos/DanAakesen/jarvis-test-target/pulls/73');
    expect(JSON.parse(patch?.body ?? '{}').body).toBe('Changes from the task branch.\n\nFixes #601');
    const ready = api.calls.find((call) => call.url.endsWith('/graphql'));
    expect(ready?.method).toBe('POST');
    expect(JSON.parse(ready?.body ?? '{}').variables).toEqual({ pullRequestId: 'PR_kwDOExample' });
    expect(test.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'pull_request_opened',
      payload: expect.objectContaining({ pullRequest: 73, reused: true }),
    }));
    expect(afterPullRequest).toHaveBeenCalledOnce();
  });

  it('logs a sanitised policy callback failure before refusing delivery', async () => {
    const api = github({ existing: true });
    const onPolicyError = vi.fn();
    const test = fixture(api.fetch, {
      afterPullRequest: async () => { throw new Error('token=secret; body=private'); },
      onPolicyError,
    });

    await expect(test.handler(workspace, task)).resolves.toEqual({
      kind: 'refused',
      reason: 'The pull request was recorded, but project policy could not be verified. Review the task before retrying.',
    });

    expect(onPolicyError).toHaveBeenCalledWith({ reason: 'internal' });
    expect(JSON.stringify(onPolicyError.mock.calls)).not.toContain('secret');
    expect(JSON.stringify(onPolicyError.mock.calls)).not.toContain('private');
  });

  it('accepts GitHub canonical repository casing in a PR response', async () => {
    const api = github({ pullRepository: 'danaakesen/Jarvis-Test-Target' });
    const test = fixture(api.fetch);

    await expect(test.handler(workspace, task)).resolves.toEqual({ kind: 'awaiting_policy' });

    expect(api.creates).toBe(1);
    expect(test.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'pull_request_opened',
      payload: expect.objectContaining({ pullRequest: 73 }),
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
