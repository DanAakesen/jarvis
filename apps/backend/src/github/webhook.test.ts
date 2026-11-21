import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryEventQueueStore } from '../proactive/events/event-queue.js';
import { githubEvent } from '../proactive/events/producers.js';
import { createGithubWebhookModule, githubWebhookEvents } from './webhook.js';

const SECRET = 'test-webhook-secret';
const REPO = 'DanAakesen/jarvis';
const NOW = new Date('2026-11-21T12:00:00.000Z');
const repository = { full_name: REPO, default_branch: 'main' };
const dan = { login: 'DanAakesen' };
const anna = { login: 'anna' };

const issue = (overrides: Record<string, unknown> = {}) => ({
  number: 7, title: 'Login fails on Safari', state: 'open', closed_at: null,
  created_at: '2026-11-21T10:00:00Z', updated_at: '2026-11-21T10:00:00Z', ...overrides,
});
const pullRequest = (overrides: Record<string, unknown> = {}) => ({
  number: 21, title: 'Add release signals', state: 'open', merged: false, merged_at: null, closed_at: null,
  created_at: '2026-11-21T09:00:00Z', updated_at: '2026-11-21T09:00:00Z', user: { login: 'copilot' },
  head: { ref: 'feature/signals', sha: 'b'.repeat(40) }, base: { ref: 'main' }, ...overrides,
});
const checkRun = (overrides: Record<string, unknown> = {}, suite: Record<string, unknown> = {}) => ({
  action: 'completed',
  check_run: {
    id: 9001, name: 'build', head_sha: 'c'.repeat(40), status: 'completed', conclusion: 'failure',
    completed_at: '2026-11-21T11:30:00Z', pull_requests: [], check_suite: { head_branch: 'main', ...suite }, ...overrides,
  },
  repository, sender: dan,
});

interface Fixture {
  event: string;
  payload: Record<string, unknown>;
  kind: string;
  dedupeKey: string;
  summary: string;
}

const queued: Record<string, Fixture> = {
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

const notQueued: Record<string, { event: string; payload: Record<string, unknown> }> = {
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

async function build() {
  const queue = createMemoryEventQueueStore();
  const seenDeliveries = new Set<string>();
  const results: boolean[] = [];
  const publishBoard = vi.fn();
  const app = Fastify();
  app.decorate('nowEventHub', { publish: vi.fn() } as never);
  app.decorate('projectStore', { list: async () => [{ id: 'project-1', repo: REPO, active: true }] } as never);
  app.decorate('publishFactoryBoardChange', publishBoard as never);
  const module = createGithubWebhookModule({
    deliveryStore: {
      async hasDelivery(id) { return seenDeliveries.has(id); },
      async record({ deliveryId }) {
        if (seenDeliveries.has(deliveryId)) return false;
        seenDeliveries.add(deliveryId);
        return true;
      },
      async recordPullRequest() {},
    },
    getSecret: async () => SECRET,
    isTrackedRepository: (name) => name.toLowerCase() === REPO.toLowerCase(),
    // What the backend does with each mapping: build the event and hand it to the queue.
    onMapping: async (mapping) => {
      const event = githubEvent(mapping, NOW);
      if (event) results.push((await queue.enqueue(event, NOW)).inserted);
    },
  });
  await app.register(module.registerRoutes);
  await app.ready();
  const post = async (event: string, payload: unknown, deliveryId: string) => {
    const body = JSON.stringify(payload);
    const response = await app.inject({
      method: 'POST', url: '/github/webhooks', payload: body,
      headers: {
        'content-type': 'application/json', 'x-github-event': event, 'x-github-delivery': deliveryId,
        'x-hub-signature-256': `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`,
      },
    });
    return { statusCode: response.statusCode, status: (response.json() as { status?: string }).status };
  };
  return { app, queue, results, post, publishBoard };
}

describe('GitHub webhook signals for the proactive queue', () => {
  it.each(Object.entries(queued))('queues %s once, with a stable key and a summary the queue accepts', async (name, fixture) => {
    const { app, queue, results, post } = await build();
    expect(await post(fixture.event, fixture.payload, `${name}-1`)).toEqual({ statusCode: 202, status: 'accepted' });
    const [event] = await queue.claim(NOW, 10, 60_000);
    expect(event).toMatchObject({ source: 'github', kind: fixture.kind, dedupeKey: fixture.dedupeKey, summary: fixture.summary });
    expect(event!.summary.length).toBeLessThanOrEqual(400);

    // The same delivery again, and GitHub redelivering the same payload under a new delivery ID.
    expect(await post(fixture.event, fixture.payload, `${name}-1`)).toEqual({ statusCode: 202, status: 'duplicate' });
    expect(await post(fixture.event, fixture.payload, `${name}-2`)).toEqual({ statusCode: 202, status: 'accepted' });
    expect(results).toEqual([true, false, false]);
    // The first claim still holds its lease, so any second row would show up here.
    expect(await queue.claim(NOW, 10, 60_000)).toEqual([]);
    await app.close();
  });

  it('queues every kind side by side and leaves every other payload out', async () => {
    const { app, queue, results, post } = await build();
    for (const [name, fixture] of Object.entries(queued)) await post(fixture.event, fixture.payload, name);
    const before = results.length;
    for (const [index, [, { event, payload }]] of Object.entries(notQueued).entries()) {
      expect((await post(event, payload, `skip-${index}`)).statusCode).toBe(202);
    }
    expect(results).toHaveLength(before);
    expect(results.every(Boolean)).toBe(true);
    const claimed = await queue.claim(NOW, 50, 60_000);
    expect(claimed.map(({ kind }) => kind).sort()).toEqual(Object.values(queued).map(({ kind }) => kind).sort());
    await app.close();
  });

  it('treats a second close of the same issue as a new event but a replay of the first as the same one', async () => {
    const { app, queue, results, post } = await build();
    const closed = (at: string) => ({
      action: 'closed', repository, sender: dan, issue: issue({ state: 'closed', closed_at: at, updated_at: at }),
    });
    await post('issues', closed('2026-11-21T11:00:00Z'), 'close-1');
    await post('issues', closed('2026-11-21T13:00:00Z'), 'close-2');
    await post('issues', closed('2026-11-21T11:00:00Z'), 'close-3');
    expect(results).toEqual([true, true, false]);
    expect(await queue.claim(NOW, 10, 60_000)).toHaveLength(2);
    await app.close();
  });

  it('keeps even an absurd title inside the 400 characters the queue stores, without splitting an emoji', async () => {
    const { app, queue, post } = await build();
    const title = '🔥'.repeat(300);
    await post('issues', { action: 'opened', issue: issue({ title }), repository, sender: { login: 'x'.repeat(200) } }, 'long');
    // One body starts a character later than the other, so one of the two is cut in the middle of an emoji's two UTF-16 units.
    for (const [id, body] of [[77, title], [78, `a${title}`]] as const) {
      await post('issue_comment', {
        action: 'created', issue: issue({ title }), repository, sender: anna,
        comment: { id, body, created_at: '2026-11-21T10:30:00Z', user: anna },
      }, `long-comment-${id}`);
    }
    const claimed = await queue.claim(NOW, 10, 60_000);
    expect(claimed).toHaveLength(3);
    for (const event of claimed) {
      expect(event.summary.length).toBeLessThanOrEqual(400);
      expect(event.summary.isWellFormed()).toBe(true);
    }
    await app.close();
  });

  it('still refreshes the Factory board once for every new issue delivery, mapped or not', async () => {
    const { app, post, publishBoard } = await build();
    await post('issues', queued.issueOpened!.payload, 'board-1');
    await post('issues', queued.issueOpened!.payload, 'board-1');
    expect(publishBoard).toHaveBeenCalledTimes(1);
    expect(publishBoard).toHaveBeenCalledWith('project-1', 'github_webhook', expect.any(String));
    await post('issues', notQueued['an issue edit']!.payload, 'board-2');
    expect(publishBoard).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('is subscribed to every event the receiver acts on in the App manifest', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../../docs/github-app-manifest.json', import.meta.url), 'utf8')) as {
      default_events: string[];
    };
    for (const event of githubWebhookEvents) expect(manifest.default_events).toContain(event);
  });
});
