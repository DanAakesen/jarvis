import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryEventQueueStore } from '../proactive/events/event-queue.js';
import { githubEvent } from '../proactive/events/producers.js';
import { createGithubWebhookModule, githubWebhookEvents } from './webhook.js';
import {
  WEBHOOK_FIXTURE_NOW as NOW, WEBHOOK_REPO as REPO, ignoredWebhooks as notQueued, issue, pullRequest,
  queuedWebhooks as queued,
} from './webhook.testkit.js';
import { formatWake } from '../pi/brain/wake.js';

const SECRET = 'test-webhook-secret';
const dan = { login: 'DanAakesen' };
const anna = { login: 'anna' };
const repository = { full_name: REPO, default_branch: 'main' };

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
      // A lone surrogate is what a cut in the middle of an emoji leaves behind.
      expect(event.summary).not.toMatch(/\p{Cs}/u);
    }
    await app.close();
  });

  it('cleans the branch name of a pull request from a fork before it reaches the wake', async () => {
    const { app, queue, post } = await build();
    // Git allows zero-width, bidirectional and tag characters in a ref name, and anyone can open a pull request from a fork.
    const dirty = 'feat/\u200Bsig\u202Enals\u{E0041}\u{E0042}';
    const fromFork = (action: string, extra: Record<string, unknown> = {}) => ({
      action, repository, sender: dan, pull_request: pullRequest({ head: { ref: dirty, sha: 'b'.repeat(40) }, ...extra }),
    });
    await post('pull_request', fromFork('opened'), 'fork-opened');
    await post('pull_request', {
      ...fromFork('review_requested', { updated_at: '2026-11-21T09:30:00Z' }), requested_reviewer: dan,
    }, 'fork-review');
    const events = await queue.claim(NOW, 10, 60_000);
    expect(events).toHaveLength(2);
    for (const event of events) expect(event.detail.branch).toBe('feat/ sig nals');
    // The line the model reads: no invisible, bidirectional or tag character anywhere in it.
    const lines = formatWake({ runId: 'run-1', now: NOW, timeZone: 'Europe/Copenhagen', events })
      .split('\n').filter((line) => line.startsWith('- '));
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
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
