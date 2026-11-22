/**
 * GitHub webhook payloads shared by the receiver test and the wake test. Each queued fixture carries the event the backend must
 * make from it; the times are 21 November 2026 so a clock at `WEBHOOK_FIXTURE_NOW` sees every one as just happened.
 */
export const WEBHOOK_REPO = 'DanAakesen/jarvis';
export const WEBHOOK_FIXTURE_NOW = new Date('2026-11-21T12:00:00.000Z');

const repository = { full_name: WEBHOOK_REPO, default_branch: 'main' };
const dan = { login: 'DanAakesen' };
const anna = { login: 'anna' };

export const issue = (overrides: Record<string, unknown> = {}) => ({
  number: 7, title: 'Login fails on Safari', state: 'open', closed_at: null,
  created_at: '2026-11-21T10:00:00Z', updated_at: '2026-11-21T10:00:00Z', ...overrides,
});
export const pullRequest = (overrides: Record<string, unknown> = {}) => ({
  number: 21, title: 'Add release signals', state: 'open', merged: false, merged_at: null, closed_at: null,
  created_at: '2026-11-21T09:00:00Z', updated_at: '2026-11-21T09:00:00Z', user: { login: 'copilot' },
  head: { ref: 'feature/signals', sha: 'b'.repeat(40) }, base: { ref: 'main' }, ...overrides,
});
export const checkRun = (overrides: Record<string, unknown> = {}, suite: Record<string, unknown> = {}) => ({
  action: 'completed',
  check_run: {
    id: 9001, name: 'build', head_sha: 'c'.repeat(40), status: 'completed', conclusion: 'failure',
    completed_at: '2026-11-21T11:30:00Z', pull_requests: [], check_suite: { head_branch: 'main', ...suite }, ...overrides,
  },
  repository, sender: dan,
});

export interface WebhookFixture {
  event: string;
  payload: Record<string, unknown>;
  kind: string;
  dedupeKey: string;
  summary: string;
}

export const queuedWebhooks: Record<string, WebhookFixture> = {
  release: {
    event: 'release', kind: 'release.published',
    payload: {
      action: 'published', repository, sender: dan,
      release: {
        id: 301, tag_name: 'v1.4.0', name: 'Winter release', draft: false, prerelease: false,
        created_at: '2026-11-21T08:55:00Z', published_at: '2026-11-21T09:00:00Z',
      },
    },
    dedupeKey: 'github:release:DanAakesen/jarvis:301:2026-11-21T09:00:00.000Z',
    summary: 'Release v1.4.0 "Winter release" published on DanAakesen/jarvis (by DanAakesen)',
  },
  issueOpened: {
    event: 'issues', kind: 'issues.opened',
    payload: { action: 'opened', issue: issue(), repository, sender: anna },
    dedupeKey: 'github:issues:DanAakesen/jarvis#7:opened:2026-11-21T10:00:00.000Z',
    summary: 'Issue #7 opened on DanAakesen/jarvis: Login fails on Safari (by anna)',
  },
  issueClosed: {
    event: 'issues', kind: 'issues.closed',
    payload: {
      action: 'closed', repository, sender: dan,
      issue: issue({ state: 'closed', closed_at: '2026-11-21T11:00:00Z', updated_at: '2026-11-21T11:00:00Z' }),
    },
    dedupeKey: 'github:issues:DanAakesen/jarvis#7:closed:2026-11-21T11:00:00.000Z',
    summary: 'Issue #7 closed on DanAakesen/jarvis: Login fails on Safari (by DanAakesen)',
  },
  issueReopened: {
    event: 'issues', kind: 'issues.reopened',
    payload: { action: 'reopened', issue: issue({ updated_at: '2026-11-21T12:00:00Z' }), repository, sender: dan },
    dedupeKey: 'github:issues:DanAakesen/jarvis#7:reopened:2026-11-21T12:00:00.000Z',
    summary: 'Issue #7 reopened on DanAakesen/jarvis: Login fails on Safari (by DanAakesen)',
  },
  issueComment: {
    event: 'issue_comment', kind: 'issue_comment.created',
    payload: {
      action: 'created', issue: issue(), repository, sender: anna,
      comment: { id: 5001, body: 'Still happening on iOS 26.1\nwith the new build', created_at: '2026-11-21T10:30:00Z', user: anna },
    },
    dedupeKey: 'github:issue_comment:DanAakesen/jarvis:5001',
    summary: 'anna commented on issue #7 on DanAakesen/jarvis ("Login fails on Safari"): Still happening on iOS 26.1 with the new build',
  },
  pullRequestComment: {
    event: 'issue_comment', kind: 'issue_comment.created',
    payload: {
      action: 'created', issue: issue({ number: 21, title: 'Add release signals', pull_request: { url: 'https://api.github.com/x' } }),
      repository, sender: dan,
      comment: { id: 5002, body: 'Please add a test', created_at: '2026-11-21T10:40:00Z', user: dan },
    },
    dedupeKey: 'github:issue_comment:DanAakesen/jarvis:5002',
    summary: 'DanAakesen commented on pull request #21 on DanAakesen/jarvis ("Add release signals"): Please add a test',
  },
  pullRequestOpened: {
    event: 'pull_request', kind: 'pull_request.opened',
    payload: { action: 'opened', pull_request: pullRequest(), repository, sender: { login: 'copilot' } },
    dedupeKey: 'github:pull_request:DanAakesen/jarvis#21:opened',
    summary: 'Pull request #21 on DanAakesen/jarvis: Add release signals (feature/signals) (by copilot)',
  },
  pullRequestMerged: {
    event: 'pull_request', kind: 'pull_request.closed',
    payload: {
      action: 'closed', repository, sender: dan,
      pull_request: pullRequest({
        state: 'closed', merged: true, merged_at: '2026-11-21T11:00:00Z', closed_at: '2026-11-21T11:00:00Z',
        updated_at: '2026-11-21T11:00:00Z',
      }),
    },
    dedupeKey: 'github:pull_request:DanAakesen/jarvis#21:closed:2026-11-21T11:00:00.000Z',
    summary: 'Pull request #21 on DanAakesen/jarvis: Add release signals was merged (by DanAakesen)',
  },
  reviewRequested: {
    event: 'pull_request', kind: 'pull_request.review_requested',
    payload: {
      action: 'review_requested', repository, sender: { login: 'copilot' }, requested_reviewer: dan,
      pull_request: pullRequest({ updated_at: '2026-11-21T09:30:00Z' }),
    },
    dedupeKey: 'github:pull_request:DanAakesen/jarvis#21:review_requested:DanAakesen:2026-11-21T09:30:00.000Z',
    summary: 'Review requested from DanAakesen on pull request #21 on DanAakesen/jarvis: Add release signals (by copilot)',
  },
  failedCheck: {
    event: 'check_run', kind: 'check_run.failure',
    payload: checkRun(),
    dedupeKey: 'github:check_run:DanAakesen/jarvis:9001:failure',
    summary: 'Check "build" failed on DanAakesen/jarvis (main)',
  },
};

export const ignoredWebhooks: Record<string, { event: string; payload: Record<string, unknown> }> = {
  'a check that failed on a pull request branch': { event: 'check_run', payload: checkRun({}, { head_branch: 'feature/signals' }) },
  'a check that passed on the default branch': { event: 'check_run', payload: checkRun({ conclusion: 'success' }) },
  'a check still running': { event: 'check_run', payload: checkRun({ status: 'in_progress', conclusion: null }) },
  'a pull request closed without a merge': {
    event: 'pull_request',
    payload: { action: 'closed', repository, sender: dan, pull_request: pullRequest({ state: 'closed', closed_at: '2026-11-21T11:00:00Z' }) },
  },
  'a pull request push': { event: 'pull_request', payload: { action: 'synchronize', repository, sender: dan, pull_request: pullRequest() } },
  'an issue edit': { event: 'issues', payload: { action: 'edited', issue: issue(), repository, sender: dan } },
  'a comment edit': {
    event: 'issue_comment',
    payload: { action: 'edited', issue: issue(), repository, sender: dan, comment: { id: 5001, body: 'x', created_at: '2026-11-21T10:30:00Z', user: dan } },
  },
  'a release that is only created': {
    event: 'release',
    payload: { action: 'created', repository, sender: dan, release: { id: 302, tag_name: 'v1.5.0', created_at: '2026-11-21T08:55:00Z' } },
  },
};
