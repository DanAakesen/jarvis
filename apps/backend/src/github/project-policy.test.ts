import { describe, expect, it, vi } from 'vitest';
import type { TaskStore } from '../factory/task-store.js';
import type { GitHubAppTokenIssuer } from '../github-app.js';
import { createProjectPolicyEvaluator, type PolicyPullRequest, type ProjectPolicyStore } from './project-policy.js';
import type { GithubWebhookMapping } from './webhook-mapping.js';

const repository = 'DanAakesen/jarvis-test-target';
const headSha = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);
const mergedSha = 'c'.repeat(40);
const mapping: GithubWebhookMapping = {
  kind: 'pull_request',
  repository,
  number: 42,
  branch: 'jarvis/task-7',
  headSha,
  state: 'open',
  openedAt: '2026-10-04T12:00:00.000Z',
  mergedAt: null,
};

function candidate(policy: PolicyPullRequest['policy'] = 'complete_without_deployment'): PolicyPullRequest {
  return {
    taskId: '7',
    taskState: 'Running',
    repository,
    policy,
    number: 42,
    state: 'open',
    checks: 'passed',
    headSha,
  };
}

function github(options: {
  pullRequestState?: 'open' | 'closed';
  merged?: boolean;
  draft?: boolean;
  headSha?: string;
  mergeable?: boolean;
  mergeableState?: string;
  baseSha?: string;
  branchSha?: string;
  checkConclusion?: string;
  checkRuns?: readonly Record<string, unknown>[];
  mergeStatus?: number;
} = {}) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
    if (url.endsWith('/pulls/42/merge')) {
      if (options.mergeStatus && options.mergeStatus !== 200) {
        return new Response('{}', { status: options.mergeStatus });
      }
      return new Response(JSON.stringify({ merged: true, sha: mergedSha }));
    }
    if (url.endsWith('/pulls/42')) {
      return new Response(JSON.stringify({
        state: options.pullRequestState ?? 'open',
        merged: options.merged ?? false,
        draft: options.draft ?? false,
        head: { sha: options.headSha ?? headSha },
        base: { ref: 'main', sha: options.baseSha ?? baseSha },
        mergeable: options.mergeable ?? true,
        mergeable_state: options.mergeableState ?? 'clean',
      }));
    }
    if (url.endsWith('/check-runs?per_page=100')) {
      return new Response(JSON.stringify({
        total_count: options.checkRuns?.length ?? 1,
        check_runs: options.checkRuns ?? [{
          id: 1,
          name: 'CI',
          app: { id: 12 },
          status: 'completed',
          conclusion: options.checkConclusion ?? 'success',
        }],
      }));
    }
    if (url.endsWith('/status')) {
      return new Response(JSON.stringify({ state: 'success', total_count: 0, statuses: [] }));
    }
    if (url.endsWith('/branches/main')) {
      return new Response(JSON.stringify({ commit: { sha: options.branchSha ?? baseSha } }));
    }
    throw new Error(`Unexpected GitHub request: ${url}`);
  });
  return { fetch, calls };
}

function fixture(
  project: PolicyPullRequest = candidate(),
  githubOptions: Parameters<typeof github>[0] = {},
) {
  const getPullRequest = vi.fn(async () => project);
  const store: ProjectPolicyStore = { getPullRequest };
  const transition = vi.fn(async () => ({ kind: 'ok' as const, task: {} as never }));
  const recordEvent = vi.fn(async () => ({ id: '1' } as never));
  const tasks = { transition, recordEvent } as unknown as Pick<TaskStore, 'transition' | 'recordEvent'>;
  const issue = vi.fn(async () => 'installation-token');
  const tokenIssuer: GitHubAppTokenIssuer = { issue };
  const api = github(githubOptions);
  const evaluator = createProjectPolicyEvaluator({ store, tasks, tokenIssuer, fetch: api.fetch });
  return {
    evaluator,
    api,
    getPullRequest,
    transition,
    recordEvent,
    issue,
  };
}

describe('GitHub project completion policies', () => {
  it('marks deliver_pr Done after verified green GitHub state and never merges', async () => {
    const test = fixture(candidate('deliver_pr'));

    await test.evaluator.handle(mapping);

    expect(test.transition).toHaveBeenCalledWith('7', 'Done', true);
    expect(test.api.calls.some((call) => call.url.endsWith('/merge'))).toBe(false);
    expect(test.recordEvent).not.toHaveBeenCalled();
  });

  it('uses the latest run for each check context after a rerun', async () => {
    const test = fixture(candidate('deliver_pr'), {
      checkRuns: [
        { id: 2, name: 'CI', app: { id: 12 }, status: 'completed', conclusion: 'success' },
        { id: 1, name: 'CI', app: { id: 12 }, status: 'completed', conclusion: 'failure' },
      ],
    });

    await test.evaluator.handle(mapping);

    expect(test.transition).toHaveBeenCalledWith('7', 'Done', true);
    expect(test.recordEvent).not.toHaveBeenCalled();
  });

  it('squash-merges eligible complete_without_deployment PRs and waits for the persisted merge webhook before Done', async () => {
    const test = fixture();

    await test.evaluator.handle(mapping);

    expect(test.api.calls.at(-1)).toMatchObject({
      url: `https://api.github.com/repos/${repository}/pulls/42/merge`,
      method: 'POST',
      body: JSON.stringify({ merge_method: 'squash', sha: headSha }),
    });
    expect(test.transition).not.toHaveBeenCalled();
    expect(test.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'project_policy_merge_requested',
      summary: expect.stringContaining('awaiting its pull request webhook'),
    }));

    const confirmation = fixture(
      { ...candidate(), state: 'merged', taskState: 'NeedsAttention' },
      { pullRequestState: 'closed', merged: true },
    );
    await confirmation.evaluator.handle({ ...mapping, state: 'merged', mergedAt: '2026-10-04T12:05:00.000Z' });
    expect(confirmation.transition).toHaveBeenCalledWith('7', 'Done', true);
    expect(test.issue).toHaveBeenCalledOnce();
  });

  it.each([
    ['draft pull requests', { draft: true }, 'still a draft'],
    ['failed required checks', { checkConclusion: 'failure' }, 'pending or failed'],
    ['a base branch that advanced', { branchSha: 'd'.repeat(40) }, 'behind its current base'],
    ['a non-mergeable PR', { mergeable: false, mergeableState: 'blocked' }, 'merge rules are not satisfied'],
    ['branch protection refusing the merge', { mergeStatus: 405 }, 'branch protection prevent it'],
  ])('records a reason and refuses %s', async (_description, options, expectedReason) => {
    const test = fixture(candidate(), options);

    await test.evaluator.handle(mapping);

    expect(test.transition).not.toHaveBeenCalled();
    expect(test.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'project_policy_blocked',
      summary: expect.stringContaining(expectedReason),
    }));
    if ('draft' in options) {
      expect(test.api.calls.some((call) => call.url.endsWith('/merge'))).toBe(false);
    }
  });

  it('does not trust the webhook head when it differs from the recorded PR state', async () => {
    const test = fixture(candidate(), { headSha: 'd'.repeat(40) });

    await test.evaluator.handle(mapping);

    expect(test.transition).not.toHaveBeenCalled();
    expect(test.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      summary: expect.stringContaining('differs from the recorded GitHub state'),
    }));
    expect(test.api.calls.some((call) => call.url.endsWith('/merge'))).toBe(false);
  });

  it('does not merge or complete a task that is paused', async () => {
    const test = fixture({ ...candidate(), taskState: 'Paused' });

    await test.evaluator.handle(mapping);

    expect(test.issue).not.toHaveBeenCalled();
    expect(test.api.calls).toHaveLength(0);
    expect(test.transition).not.toHaveBeenCalled();
    expect(test.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      summary: expect.stringContaining('task state does not permit'),
    }));
  });

  it('requires the persisted P3-04 check result before querying GitHub', async () => {
    const test = fixture({ ...candidate(), checks: 'failed' });

    await test.evaluator.handle(mapping);

    expect(test.issue).not.toHaveBeenCalled();
    expect(test.api.calls).toHaveLength(0);
    expect(test.transition).not.toHaveBeenCalled();
    expect(test.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      summary: expect.stringContaining('Recorded GitHub checks are not green'),
    }));
  });

  it('does not attempt completion from reports unrelated to a pull request', async () => {
    const test = fixture();

    await test.evaluator.handle({
      kind: 'push',
      repository,
      ref: 'refs/heads/main',
      sha: mergedSha,
      at: '2026-10-04T12:00:00.000Z',
    });

    expect(test.getPullRequest).not.toHaveBeenCalled();
    expect(test.transition).not.toHaveBeenCalled();
  });
});
