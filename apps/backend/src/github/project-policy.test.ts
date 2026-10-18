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
    openedAt: new Date().toISOString(),
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
  requestStatus?: number;
  rateLimitHeaders?: Record<string, string>;
  requestBody?: string;
  enforceTokenPermissions?: boolean;
} = {}, onBaseBranchRead?: () => void) {
  const calls: { url: string; method: string; authorization: string | null; body?: string }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const authorization = new Headers(init?.headers).get('authorization');
    calls.push({ url, method, authorization, ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
    if (options.enforceTokenPermissions) {
      const expected = url.endsWith('/merge') ? 'installation-token' : 'repository-read-token';
      if (authorization !== `Bearer ${expected}`) return new Response('{}', { status: 403 });
    }
    if (options.requestStatus) {
      return new Response(options.requestBody ?? '{}', { status: options.requestStatus, headers: options.rateLimitHeaders });
    }
    if (url.endsWith('/pulls/42/merge')) {
      if (method !== 'PUT') return new Response('{}', { status: 405 });
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
      onBaseBranchRead?.();
      return new Response(JSON.stringify({ commit: { sha: options.branchSha ?? baseSha } }));
    }
    throw new Error(`Unexpected GitHub request: ${url}`);
  });
  return { fetch, calls };
}

function fixture(
  project: PolicyPullRequest = candidate(),
  githubOptions: Parameters<typeof github>[0] = {},
  onBaseBranchRead?: () => void,
) {
  let currentProject = project;
  const getPullRequest = vi.fn(async () => currentProject);
  let taskActive = true;
  let runnerCompleted = true;
  let runnerHeadSha = project.headSha;
  const store: ProjectPolicyStore = {
    getPullRequest,
    listOpenPullRequests: vi.fn(async () =>
      currentProject.state === 'open' && currentProject.policy === 'complete_without_deployment'
        ? [currentProject]
        : []),
    async withActiveTask<T>(_taskId: string, operation: () => Promise<T>, expectedHeadSha: string) {
      if (taskActive && (!runnerCompleted || expectedHeadSha !== runnerHeadSha)) {
        return { kind: 'awaiting_runner' as const };
      }
      return taskActive
        ? { kind: 'active' as const, value: await operation() }
        : { kind: 'inactive' as const };
    },
  };
  const transition = vi.fn<TaskStore['transition']>(async () => ({ kind: 'ok' as const, task: {} as never }));
  const recordEvent = vi.fn(async () => ({ id: '1' } as never));
  const tasks = { transition, recordEvent } as unknown as Pick<TaskStore, 'transition' | 'recordEvent'>;
  const issue = vi.fn(async () => 'installation-token');
  const issueForRepositoryRead = vi.fn(async () => 'repository-read-token');
  const tokenIssuer: GitHubAppTokenIssuer = {
    issue,
    issueForActions: vi.fn(async () => 'actions-token'),
    issueForChecks: vi.fn(async () => 'checks-token'),
    issueForContents: vi.fn(async () => 'contents-token'),
    issueForRepositoryRead,
    issueForContentsWrite: vi.fn(async () => 'contents-write-token'),
    issueForIssuesWrite: vi.fn(async () => 'issues-write-token'),
  };
  const api = github(githubOptions, onBaseBranchRead);
  const evaluator = createProjectPolicyEvaluator({
    store, tasks, tokenIssuer, fetch: api.fetch,
  });
  return {
    evaluator,
    api,
    getPullRequest,
    transition,
    recordEvent,
    issue,
    issueForRepositoryRead,
    setCandidate(candidate: PolicyPullRequest) { currentProject = candidate; },
    setTaskActive(active: boolean) { taskActive = active; },
    setRunnerCompleted(completed: boolean) { runnerCompleted = completed; },
    setRunnerHeadSha(sha: string) { runnerHeadSha = sha; },
  };
}

describe('GitHub project completion policies', () => {
  it('delegates repeated reasons to durable storage instead of suppressing them in the evaluator', async () => {
    const test = fixture({ ...candidate(), checks: 'failed' });

    await test.evaluator.handle(mapping);
    await test.evaluator.handle(mapping);

    expect(test.recordEvent).toHaveBeenCalledTimes(2);
    expect(test.recordEvent.mock.calls[0]).toEqual(test.recordEvent.mock.calls[1]);
  });

  it('does not hide the same reason after a state change in the same evaluator', async () => {
    const test = fixture({ ...candidate(), checks: 'failed' });
    await test.evaluator.handle(mapping);
    await test.transition('7', 'NeedsAttention');
    test.setCandidate({ ...candidate(), taskState: 'NeedsAttention', checks: 'failed' });

    await test.evaluator.handle(mapping);

    expect(test.recordEvent).toHaveBeenCalledTimes(2);
    expect(test.recordEvent.mock.calls[0]).toEqual(test.recordEvent.mock.calls[1]);
  });

  it('keeps the repeated awaiting-runner block subject to durable deduplication after markDone', async () => {
    const test = fixture(candidate('deliver_pr'));
    test.setRunnerCompleted(false);

    await test.evaluator.handle(mapping);
    await test.evaluator.handle(mapping);

    expect(test.transition).not.toHaveBeenCalled();
    expect(test.recordEvent).toHaveBeenCalledTimes(2);
    expect(test.recordEvent.mock.calls[0]).toEqual(test.recordEvent.mock.calls[1]);
  });

  it('does not mark Done from a green PR before the current runner completion is verified', async () => {
    const test = fixture(candidate('deliver_pr'), { enforceTokenPermissions: true });
    test.setRunnerCompleted(false);

    await test.evaluator.handle(mapping);

    expect(test.transition).not.toHaveBeenCalled();
    expect(test.issue).not.toHaveBeenCalled();
    expect(test.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'project_policy_blocked',
      summary: expect.stringContaining('Runner completion has not been verified'),
    }));
    test.setRunnerCompleted(true);
    await test.evaluator.handle(mapping);
    expect(test.transition).toHaveBeenCalledExactlyOnceWith('7', 'Done', true);
  });

  it('does not attempt a merge before the current runner completion is verified', async () => {
    const test = fixture();
    test.setRunnerCompleted(false);

    await test.evaluator.handle(mapping);

    expect(test.issue).not.toHaveBeenCalled();
    expect(test.api.calls.some((call) => call.url.endsWith('/merge'))).toBe(false);
  });

  it('does not mark Done using a green PR for a different work commit', async () => {
    const test = fixture(candidate('deliver_pr'));
    test.setRunnerHeadSha('d'.repeat(40));
    await test.evaluator.handle(mapping);
    expect(test.transition).not.toHaveBeenCalled();
    expect(test.issue).not.toHaveBeenCalled();
    expect(test.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'project_policy_blocked', summary: expect.stringContaining('Runner completion has not been verified'),
    }));
  });

  it('does not report no-check completion when the task transition was rejected', async () => {
    const project = candidate('deliver_pr');
    const test = fixture({ ...project, openedAt: new Date(Date.now() - 180_000).toISOString() }, { checkRuns: [] });
    test.transition.mockResolvedValueOnce({ kind: 'invalid-transition' });

    await test.evaluator.handle(mapping);

    expect(test.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      summary: 'The task changed before policy completion; completion was not applied.',
    }));
    expect(test.recordEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'project_policy_completed_without_checks',
    }));
  });

  it('marks deliver_pr Done after verified green GitHub state and never merges', async () => {
    const test = fixture(candidate('deliver_pr'), { enforceTokenPermissions: true });

    await test.evaluator.handle(mapping);

    expect(test.transition).toHaveBeenCalledWith('7', 'Done', true);
    expect(test.api.calls.some((call) => call.url.endsWith('/merge'))).toBe(false);
    expect(test.issue).not.toHaveBeenCalled();
    expect(test.issueForRepositoryRead).toHaveBeenCalledExactlyOnceWith(repository);
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

  it('completes deliver_pr without CI only after the pull request check grace period', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T12:00:00.000Z'));
    const test = fixture({
      ...candidate('deliver_pr'),
      checks: 'pending',
      openedAt: new Date().toISOString(),
    }, { checkRuns: [] });

    try {
      await test.evaluator.handle(mapping);
      expect(test.transition).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2 * 60_000 - 1);
      expect(test.transition).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(test.transition).toHaveBeenCalledWith('7', 'Done', true);
      expect(test.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: 'project_policy_completed_without_checks',
        summary: 'No CI configured; completed without checks',
      }));
    } finally {
      await test.evaluator.stop();
      vi.useRealTimers();
    }
  });

  it('squash-merges without CI after the grace period', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T12:00:00.000Z'));
    const test = fixture({
      ...candidate(),
      checks: 'pending',
      openedAt: new Date().toISOString(),
    }, { checkRuns: [] });

    try {
      await test.evaluator.handle(mapping);
      expect(test.api.calls.some((call) => call.url.endsWith('/merge'))).toBe(false);

      await vi.advanceTimersByTimeAsync(2 * 60_000);

      expect(test.api.calls.filter((call) => call.url.endsWith('/merge'))).toHaveLength(1);
      expect(test.transition).not.toHaveBeenCalled();
    } finally {
      await test.evaluator.stop();
      vi.useRealTimers();
    }
  });

  it('recovers an eligible no-check PR after a simulated restart', async () => {
    vi.useFakeTimers();
    const openedAt = new Date('2026-10-06T12:00:00.000Z');
    vi.setSystemTime(openedAt);
    const waiting = fixture({
      ...candidate(),
      checks: 'pending',
      openedAt: openedAt.toISOString(),
    }, { checkRuns: [] });
    const restarted = fixture({
      ...candidate(),
      checks: 'pending',
      openedAt: new Date(openedAt.getTime() - 2 * 60_000).toISOString(),
    }, { checkRuns: [] });

    try {
      await waiting.evaluator.handle(mapping);
      expect(waiting.api.calls.some((call) => call.url.endsWith('/merge'))).toBe(false);
      await waiting.evaluator.stop();

      restarted.evaluator.start();
      await vi.waitFor(() => expect(restarted.api.calls.some((call) => call.url.endsWith('/merge'))).toBe(true));
      expect(restarted.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: 'project_policy_merge_requested',
      }));
    } finally {
      await waiting.evaluator.stop();
      await restarted.evaluator.stop();
      vi.useRealTimers();
    }
  });

  it('keeps waiting when GitHub checks appear during the grace period', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T12:00:00.000Z'));
    const checkRuns: Record<string, unknown>[] = [];
    const test = fixture({
      ...candidate('deliver_pr'),
      checks: 'pending',
      openedAt: new Date().toISOString(),
    }, { checkRuns });

    try {
      await test.evaluator.handle(mapping);
      await vi.advanceTimersByTimeAsync(30_000);
      checkRuns.push({
        id: 2,
        name: 'CI',
        app: { id: 12 },
        status: 'in_progress',
        conclusion: null,
      });
      await test.evaluator.handle(mapping);

      await vi.advanceTimersByTimeAsync(90_000);

      expect(test.transition).not.toHaveBeenCalled();
      expect(test.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
        summary: expect.stringContaining('pending or failed'),
      }));
    } finally {
      await test.evaluator.stop();
      vi.useRealTimers();
    }
  });

  it('squash-merges eligible complete_without_deployment PRs without confirmation and waits for the merge webhook before Done', async () => {
    const test = fixture();

    await test.evaluator.handle(mapping);

    expect(test.api.calls.at(-1)).toMatchObject({
      url: `https://api.github.com/repos/${repository}/pulls/42/merge`,
      method: 'PUT',
      body: JSON.stringify({ merge_method: 'squash', sha: headSha }),
    });
    expect(test.transition).not.toHaveBeenCalled();
    expect(test.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'project_policy_merge_requested',
      summary: expect.stringContaining('awaiting its pull request webhook'),
    }));
    await test.evaluator.recheckProject('42');
    expect(test.api.calls.filter((call) => call.url.endsWith('/merge'))).toHaveLength(1);

    const mergeWebhook = fixture(
      { ...candidate(), state: 'merged', taskState: 'NeedsAttention' },
      { pullRequestState: 'closed', merged: true },
    );
    await mergeWebhook.evaluator.handle({ ...mapping, state: 'merged', mergedAt: '2026-10-04T12:05:00.000Z' });
    expect(mergeWebhook.transition).toHaveBeenCalledWith('7', 'Done', true);
    expect(test.issue).toHaveBeenCalledOnce();
  });

  it('rechecks an already-open PR immediately after the live project policy changes', async () => {
    const test = fixture(candidate('deliver_pr'));

    await test.evaluator.recheckProject('42');
    expect(test.api.calls.some((call) => call.url.endsWith('/merge'))).toBe(false);

    test.setCandidate(candidate('complete_without_deployment'));
    await test.evaluator.recheckProject('42');

    expect(test.api.calls.filter((call) => call.url.endsWith('/merge'))).toHaveLength(1);
  });

  it('does not repeat GitHub merge refusals during later sweeps', async () => {
    const test = fixture(candidate(), { mergeStatus: 405 });

    await test.evaluator.recheckProject('42');
    await test.evaluator.recheckProject('42');

    expect(test.api.calls.filter((call) => call.url.endsWith('/merge'))).toHaveLength(1);
    expect(test.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'project_policy_blocked',
      summary: expect.stringContaining('GitHub refused the squash merge'),
    }));
  });

  it('backs off and bounds retries after transient GitHub failures', async () => {
    vi.useFakeTimers();
    const test = fixture(candidate(), { requestStatus: 503 });

    try {
      await test.evaluator.recheckProject('42');
      const firstAttemptCount = test.api.calls.length;
      await test.evaluator.recheckProject('42');
      expect(test.api.calls).toHaveLength(firstAttemptCount);

      await vi.advanceTimersByTimeAsync(60_000);
      await test.evaluator.recheckProject('42');
      expect(test.api.calls).toHaveLength(firstAttemptCount * 2);
      expect(test.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: 'project_policy_blocked',
        summary: expect.stringContaining('retry automatically'),
      }));
    } finally {
      await test.evaluator.stop();
      vi.useRealTimers();
    }
  });

  it('uses a separate write token only inside the active-task merge', async () => {
    const test = fixture(candidate(), { enforceTokenPermissions: true });
    await test.evaluator.handle(mapping);

    expect(test.issueForRepositoryRead).toHaveBeenCalledExactlyOnceWith(repository);
    expect(test.issue).toHaveBeenCalledExactlyOnceWith(repository);
    expect(test.api.calls.at(-1)).toMatchObject({
      method: 'PUT',
      authorization: 'Bearer installation-token',
      body: JSON.stringify({ merge_method: 'squash', sha: headSha }),
    });
    expect(test.transition).not.toHaveBeenCalled();
  });

  it('does not mint a write token if the task becomes inactive before the merge', async () => {
    const test = fixture(candidate(), { enforceTokenPermissions: true });
    test.setTaskActive(false);

    await test.evaluator.handle(mapping);
    expect(test.issue).not.toHaveBeenCalled();
    expect(test.api.calls.some((call) => call.url.endsWith('/merge'))).toBe(false);
  });

  it('fails closed when merge credentials cannot be obtained without leaking errors', async () => {
    const test = fixture(candidate(), { enforceTokenPermissions: true });
    test.issue.mockRejectedValue(new Error('PRIVATE synthetic credential error'));

    await test.evaluator.handle(mapping);
    expect(test.api.calls.some((call) => call.url.endsWith('/merge'))).toBe(false);
    expect(test.transition).not.toHaveBeenCalled();
    expect(test.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      summary: 'GitHub merge credentials could not be verified; no merge was attempted.',
    }));
    expect(JSON.stringify(test.recordEvent.mock.calls)).not.toContain('PRIVATE');
  });

  it('does not request a merge when the task was cancelled during GitHub verification', async () => {
    const test = fixture(candidate(), {}, () => test.setTaskActive(false));

    await test.evaluator.handle(mapping);

    expect(test.api.calls.some((call) => call.url.endsWith('/merge'))).toBe(false);
    await vi.waitFor(() => expect(test.recordEvent).toHaveBeenCalled());
    expect(test.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      summary: expect.stringContaining('task is no longer active'),
    }));
  });

  it.each([
    ['429 responses', 429, {}],
    ['rate-limited 403 responses', 403, { 'x-ratelimit-remaining': '0' }],
    ['secondary rate limit 403 responses', 403, { 'retry-after': '60' }],
    ['headerless secondary rate limit 403 responses', 403, {}, '{"message":"You have exceeded a secondary rate limit."}'],
  ])('leaves GitHub %s retryable', async (_description, requestStatus, rateLimitHeaders, requestBody) => {
    const test = fixture(candidate(), { requestStatus, rateLimitHeaders, requestBody });

    await expect(test.evaluator.handle(mapping)).rejects.toThrow('GitHub request failed');
    expect(test.recordEvent).not.toHaveBeenCalled();
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
    await vi.waitFor(() => expect(test.recordEvent).toHaveBeenCalled());

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
