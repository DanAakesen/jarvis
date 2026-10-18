import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installAuthentication } from '../auth/hook.js';
import { loadConfig } from '../config.js';
import type { TokenVerifier, UserPrincipal } from '../auth/verify.js';
import { createMemoryProactiveStore, DEFAULT_NEWS_FEEDS } from './store.js';
import { registerProactiveRoutes, type ProactiveRouteOptions } from './routes.js';
import { registerProactive } from './composition.js';
import type { ProactiveCompositionOptions } from './composition.js';
import { sourceIds } from './types.js';

const owner = 'd5b41c2f-33f4-4b4f-9a52-09346e50c8dd';
const other = 'd5b41c2f-33f4-4b4f-9a52-09346e50c8df';
const authorization = ['Bearer', ['test', 'fixture', 'signature'].join('.')].join(' ');
const user: UserPrincipal = {
  objectId: owner,
  tenantId: '802efa29-17f2-4a79-8f5f-38f087aed96a',
  displayName: 'Fixture user',
};
const foreign: UserPrincipal = { ...user, objectId: other };
const tokenVerifier: TokenVerifier = async (token) => token === 'foreign.fixture.signature' ? foreign : user;
const apps: ReturnType<typeof Fastify>[] = [];

async function appFixture(
  clock: () => Date = () => new Date('2026-10-20T05:00:00.000Z'),
  callbacks: Pick<ProactiveRouteOptions, 'run' | 'worstCaseDkk'> = {},
) {
  const store = createMemoryProactiveStore(owner);
  const app = Fastify({ logger: false });
  apps.push(app);
  installAuthentication(app, loadConfig({ ENTRA_OWNER_OBJECT_ID: owner }), tokenVerifier);
  registerProactiveRoutes(app, {
    store,
    ownerObjectId: owner,
    todoWritesEnabled: true,
    alertsEnabled: true,
    pushEnabled: true,
    databaseAvailable: true,
    registerItemDetail: true,
    now: () => new Date(clock()),
    ...callbacks,
  });
  await app.ready();
  return { app, store };
}

function finding(patch: Partial<Parameters<ReturnType<typeof createMemoryProactiveStore>['items']['upsertFinding']>[0]> = {}) {
  return {
    dedupeKey: 'fixture:d1',
    title: 'Calendar deadline',
    body: 'A synthetic deadline is approaching.',
    category: 'deadline' as const,
    urgency: 'normal' as const,
    dueAt: '2026-10-20T12:00:00.000Z',
    evidence: [{ source: 'calendar' as const, label: 'Calendar', observedAt: '2026-10-20T05:00:00.000Z' }],
    runId: null,
    language: 'en' as const,
    ...patch,
  };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('proactive routes', () => {
  it('returns default settings and the complete settings response after a validated patch', async () => {
    const { app } = await appFixture();
    const response = await app.inject({ method: 'GET', url: '/proactive/settings', headers: { authorization } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      paused: false,
      monthlyBudgetDkk: 100,
      sources: sourceIds.map((id) => ({ id, enabled: id !== 'x' })),
      newsFeeds: [...DEFAULT_NEWS_FEEDS],
      guidance: '',
    });
    const patched = await app.inject({
      method: 'PATCH',
      url: '/proactive/settings',
      headers: { authorization },
      payload: {
        paused: true,
        monthlyBudgetDkk: 0,
        sources: [{ id: 'todos', enabled: false }],
        newsFeeds: ['https://example.test/feed.xml'],
        guidance: 'Prefer concise reminders.',
      },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      paused: true,
      monthlyBudgetDkk: 0,
      newsFeeds: ['https://example.test/feed.xml'],
      guidance: 'Prefer concise reminders.',
    });
    expect(patched.json().sources).toHaveLength(8);
    expect(patched.json().sources[0]).toEqual({ id: 'todos', enabled: false });
    expect(patched.json().sources[1]).toEqual({ id: 'calendar', enabled: true });
  });

  it('rejects malformed settings fields, unsafe feeds and unknown source ids', async () => {
    const { app } = await appFixture();
    const invalid = [
      { monthlyBudgetDkk: -1 },
      { monthlyBudgetDkk: 1001 },
      { monthlyBudgetDkk: 1.5 },
      { newsFeeds: Array.from({ length: 11 }, (_, index) => `https://example.test/${index}`) },
      { newsFeeds: ['http://example.test/feed.xml'] },
      { guidance: 'x'.repeat(1001) },
      { sources: [{ id: 'unknown', enabled: true }] },
      { unknown: true },
      { sources: [{ id: 'news', enabled: true, extra: false }] },
    ];
    for (const payload of invalid) {
      const response = await app.inject({
        method: 'PATCH',
        url: '/proactive/settings',
        headers: { authorization },
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid_request' });
    }
  });

  it('returns status with no runs and reports sources in contract order', async () => {
    const { app } = await appFixture();
    const response = await app.inject({ method: 'GET', url: '/proactive/status', headers: { authorization } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      paused: false,
      quietNow: false,
      nextSlotAt: '2026-10-20T16:00:00.000Z',
      lastRun: null,
      budget: { month: '2026-10', monthlyLimitDkk: 100, estimatedSpendDkk: 0, state: 'ok' },
      capabilities: { todoWrites: true, alerts: true },
    });
    expect(response.json().sources.map((status: { id: string }) => status.id)).toEqual(sourceIds);
    expect(response.json().sources.find((status: { id: string }) => status.id === 'x')).toMatchObject({
      enabled: false, state: 'disabled', reason: null, observedAt: null,
    });
  });

  it('re-checks owner identity on each request', async () => {
    const { app } = await appFixture();
    const response = await app.inject({
      method: 'GET',
      url: '/proactive/settings',
      headers: { authorization: ['Bearer', ['foreign', 'fixture', 'signature'].join('.')].join(' ') },
    });
    expect(response.statusCode).toBe(403);
  });

  it('returns full items, enforces feedback transitions, and lists snoozed items once due', async () => {
    const now = { value: new Date('2026-10-20T05:00:00.000Z') };
    const fixture = await appFixture(() => now.value);
    const item = await fixture.store.items.upsertFinding(finding());
    const details = await fixture.app.inject({
      method: 'GET', url: `/proactive/items/${item.id}`, headers: { authorization },
    });
    expect(details.json()).toEqual(item);

    const seen = await fixture.app.inject({
      method: 'POST', url: `/proactive/items/${item.id}/feedback`, headers: { authorization }, payload: { action: 'seen' },
    });
    expect(seen.json()).toMatchObject({ state: 'seen', feedback: null });
    const seenAgain = await fixture.app.inject({
      method: 'POST', url: `/proactive/items/${item.id}/feedback`, headers: { authorization }, payload: { action: 'seen' },
    });
    expect(seenAgain.json().state).toBe('seen');
    const useful = await fixture.app.inject({
      method: 'POST', url: `/proactive/items/${item.id}/feedback`, headers: { authorization }, payload: { action: 'useful' },
    });
    expect(useful.json()).toMatchObject({ state: 'seen', feedback: 'useful' });

    for (const payload of [
      { action: 'snooze' },
      { action: 'snooze', snoozeUntil: '2026-10-20T04:59:59.000Z' },
      { action: 'snooze', snoozeUntil: '2026-10-27T05:00:01.000Z' },
      { action: 'seen', snoozeUntil: '2026-10-20T06:00:00.000Z' },
      { action: 'other' },
    ]) {
      const invalid = await fixture.app.inject({
        method: 'POST', url: `/proactive/items/${item.id}/feedback`, headers: { authorization }, payload,
      });
      expect(invalid.statusCode).toBe(400);
    }
    const until = '2026-10-20T06:00:00.000Z';
    const snoozed = await fixture.app.inject({
      method: 'POST', url: `/proactive/items/${item.id}/feedback`, headers: { authorization },
      payload: { action: 'snooze', snoozeUntil: until },
    });
    expect(snoozed.json()).toMatchObject({ state: 'snoozed', snoozedUntil: until });
    const beforeDue = await fixture.app.inject({ method: 'GET', url: '/proactive/items?state=open', headers: { authorization } });
    expect(beforeDue.json().items).toEqual([]);
    now.value = new Date('2026-10-20T06:00:00.000Z');
    const due = await fixture.app.inject({ method: 'GET', url: '/proactive/items?state=open', headers: { authorization } });
    expect(due.json().items).toHaveLength(1);
    const dismissed = await fixture.app.inject({
      method: 'POST', url: `/proactive/items/${item.id}/feedback`, headers: { authorization }, payload: { action: 'dismiss' },
    });
    const dismissedAgain = await fixture.app.inject({
      method: 'POST', url: `/proactive/items/${item.id}/feedback`, headers: { authorization }, payload: { action: 'dismiss' },
    });
    expect(dismissed.json().state).toBe('dismissed');
    expect(dismissedAgain.json().state).toBe('dismissed');
    const open = await fixture.app.inject({ method: 'GET', url: '/proactive/items?state=open', headers: { authorization } });
    const all = await fixture.app.inject({ method: 'GET', url: '/proactive/items?state=all', headers: { authorization } });
    expect(open.json().items).toEqual([]);
    expect(all.json().items).toHaveLength(1);
  });

  it('rejects invalid item list filters and snooze updates outside the limit', async () => {
    const { app } = await appFixture();
    for (const url of [
      '/proactive/items?state=closed',
      '/proactive/items?limit=0',
      '/proactive/items?limit=101',
      '/proactive/items?limit=nope',
      '/proactive/items?unknown=1',
    ]) {
      const response = await app.inject({ method: 'GET', url, headers: { authorization } });
      expect(response.statusCode).toBe(400);
    }
  });
});

describe('manual proactive runs', () => {
  const post = { method: 'POST' as const, url: '/proactive/runs', headers: { authorization } };

  it('enforces owner authorization for run reads and writes', async () => {
    const { app } = await appFixture();
    for (const method of ['GET', 'POST'] as const) {
      expect((await app.inject({ method, url: post.url })).statusCode).toBe(401);
      expect((await app.inject({
        method, url: post.url,
        headers: { authorization: ['Bearer', ['foreign', 'fixture', 'signature'].join('.')].join(' ') },
      })).statusCode).toBe(403);
    }
  });

  it('refuses in paused, all-disabled, budget, running order', async () => {
    const run = vi.fn(async () => {});
    const { app, store } = await appFixture(undefined, { run, worstCaseDkk: () => 2 });
    await store.runs.claim({ trigger: 'manual', slot: null, now: new Date('2026-10-20T05:00:00Z') });
    await store.settings.patch({
      paused: true, monthlyBudgetDkk: 0,
      sources: Object.fromEntries(sourceIds.map((id) => [id, false])),
    });
    const expectRefusal = async (error: string, status: number) => {
      const response = await app.inject(post);
      expect(response.statusCode).toBe(status);
      expect(response.json()).toEqual(error === 'already_running' ? { error, run: await store.runs.latest() } : { error });
    };
    await expectRefusal('paused', 409);
    await store.settings.patch({ paused: false });
    await expectRefusal('no_sources', 409);
    await store.settings.patch({ sources: { todos: true } });
    await expectRefusal('budget_exhausted', 409);
    await store.settings.patch({ monthlyBudgetDkk: 1 });
    await expectRefusal('budget_exhausted', 409);
    await store.settings.patch({ monthlyBudgetDkk: 100 });
    await expectRefusal('already_running', 409);
    expect(run).not.toHaveBeenCalled();
  });

  it('includes month spend and worst case in admission and fails closed without a runner', async () => {
    const { app, store } = await appFixture(undefined, { worstCaseDkk: () => 2 });
    await store.spend.record({
      runId: owner, month: '2026-10', inputTokens: 1, outputTokens: 1,
      estimatedDkk: 99, createdAt: new Date(),
    });
    expect((await app.inject(post)).json()).toEqual({ error: 'budget_exhausted' });
    await store.settings.patch({ monthlyBudgetDkk: 200 });
    expect((await app.inject(post)).statusCode).toBe(503);
    expect(await store.runs.list(50)).toEqual([]);
  });

  it('returns 202 before the pipeline settles, including during quiet hours', async () => {
    let complete!: () => void;
    const run = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
    const { app, store } = await appFixture(() => new Date('2026-10-20T21:00:00Z'), { run, worstCaseDkk: () => 1 });
    const response = await app.inject(post);
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ run: await store.runs.latest() });
    expect(run).toHaveBeenCalledOnce();
    expect((await store.runs.latest())!.status).toBe('running');
    expect((await app.inject(post)).json()).toEqual({ error: 'already_running', run: await store.runs.latest() });
    complete();
  });

  it('accepts a new manual run once an unfinished run reaches its ten-minute lease deadline', async () => {
    let now = new Date('2026-10-20T05:00:00Z');
    const run = vi.fn(async () => {});
    const { app, store } = await appFixture(() => now, { run, worstCaseDkk: () => 1 });
    const expired = await store.runs.claim({ trigger: 'manual', slot: null, now });
    now = new Date('2026-10-20T05:09:59.999Z');
    const active = await app.inject(post);
    expect(active.statusCode).toBe(409);
    expect(active.json()).toEqual({ error: 'already_running', run: expired!.run });
    expect(run).not.toHaveBeenCalled();

    now = new Date('2026-10-20T05:10:00Z');
    const response = await app.inject(post);
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ run: await store.runs.latest() });
    expect(response.json().run.id).not.toBe(expired!.run.id);
    expect(run).toHaveBeenCalledOnce();
    expect((await store.runs.list(50)).find((entry) => entry.id === expired!.run.id)).toMatchObject({
      status: 'failed', reason: 'lease_lost',
    });
    expect(await store.runs.finish(expired!.run.id, expired!.generation, 'done', null, 0, now)).toBe(false);
  });

  it('records detached callback failures with the claimed generation', async () => {
    const { app, store } = await appFixture(undefined, {
      run: async () => { throw new Error('private provider data'); }, worstCaseDkk: () => 1,
    });
    const finish = vi.spyOn(store.runs, 'finish');
    expect((await app.inject(post)).statusCode).toBe(202);
    await app.close();
    expect(await store.runs.latest()).toMatchObject({ status: 'failed', reason: 'internal_error' });
    expect(finish).toHaveBeenCalledWith(expect.any(String), 1, 'failed', 'internal_error', 0, expect.any(Date));
  });

  it('aborts and awaits manual work on shutdown without applying quiet cancellation', async () => {
    let signal: AbortSignal | undefined;
    const run = vi.fn(async (claim: Parameters<NonNullable<ProactiveRouteOptions['run']>>[0], current?: AbortSignal) => {
      signal = current;
      await new Promise<void>((resolve) => current!.addEventListener('abort', () => resolve(), { once: true }));
      await store.runs.finish(claim.run.id, claim.generation, 'cancelled', String(current!.reason), 0, new Date());
    });
    const { app, store } = await appFixture(() => new Date('2026-10-20T21:00:00Z'), { run, worstCaseDkk: () => 1 });
    expect((await app.inject(post)).statusCode).toBe(202);
    expect(signal?.aborted).toBe(false);
    await app.close();
    expect(signal?.aborted).toBe(true);
    expect(signal?.reason).toBe('interrupted_by_restart');
    expect(await store.runs.latest()).toMatchObject({ status: 'cancelled', reason: 'interrupted_by_restart' });
  });

  it('uses persisted five-minute limits, accepts exact boundary and serializes racing admissions', async () => {
    let now = new Date('2026-10-20T05:00:00Z');
    const fixture = await appFixture(() => now, {
      worstCaseDkk: () => 1,
      run: async (claim) => { await fixture.store.runs.finish(claim.run.id, claim.generation, 'done', null, 0, now); },
    });
    const store = fixture.store;
    expect((await fixture.app.inject(post)).statusCode).toBe(202);
    now = new Date('2026-10-20T05:04:59.999Z');
    expect((await fixture.app.inject(post)).json()).toEqual({ error: 'rate_limited' });
    now = new Date('2026-10-20T05:05:00Z');
    const responses = await Promise.all([fixture.app.inject(post), fixture.app.inject(post)]);
    expect(responses.filter((response) => response.statusCode === 202)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode === 429 || response.statusCode === 409)).toHaveLength(1);
    expect(await store.runs.countManualSince(new Date('2026-10-19T22:00:00Z'))).toBe(2);
  });

  it.each([
    ['2026-03-29T12:00:00Z', '2026-03-28T23:00:00Z'],
    ['2026-10-25T12:00:00Z', '2026-10-24T22:00:00Z'],
  ])('counts at most six manual runs since Copenhagen midnight on %s', async (instant, midnight) => {
    const now = new Date(instant);
    const { app, store } = await appFixture(() => now, { run: async () => {}, worstCaseDkk: () => 1 });
    const boundary = new Date(midnight);
    for (let index = -1; index < 6; index++) {
      const at = new Date(boundary.getTime() + index * 5 * 60_000);
      const claim = await store.runs.claim({ trigger: 'manual', slot: null, now: at });
      await store.runs.finish(claim!.run.id, claim!.generation, 'done', null, 0, at);
    }
    const count = vi.spyOn(store.runs, 'countManualSince');
    const response = await app.inject(post);
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({ error: 'rate_limited' });
    expect(count).toHaveBeenCalledWith(boundary);
  });

  it('handles a claim lost to another caller and lists bounded newest runs', async () => {
    const { app, store } = await appFixture(undefined, { run: async () => {}, worstCaseDkk: () => 1 });
    const claim = vi.spyOn(store.runs, 'claim').mockResolvedValueOnce(null);
    expect((await app.inject(post)).json()).toEqual({ error: 'already_running', run: null });
    claim.mockRestore();
    for (let index = 0; index < 3; index++) {
      const at = new Date(Date.UTC(2026, 9, 19, index));
      const entry = await store.runs.claim({ trigger: 'manual', slot: null, now: at });
      await store.runs.finish(entry!.run.id, entry!.generation, 'done', null, 0, at);
    }
    const response = await app.inject({ method: 'GET', url: '/proactive/runs?limit=2', headers: { authorization } });
    expect(response.json().runs).toEqual(await store.runs.list(2));
    expect(response.json().runs).toHaveLength(2);
    for (const query of ['limit=0', 'limit=51', 'limit=1.5', 'limit=no', 'extra=1', 'limit=1&limit=2']) {
      expect((await app.inject({ method: 'GET', url: `/proactive/runs?${query}`, headers: { authorization } })).statusCode).toBe(400);
    }
  });

  it('reports a persisted rate refusal when another replica finishes before this claim', async () => {
    const now = new Date('2026-10-20T05:00:00Z');
    const { app, store } = await appFixture(() => now, { run: async () => {}, worstCaseDkk: () => 1 });
    const original = store.runs.claim.bind(store.runs);
    vi.spyOn(store.runs, 'claim').mockImplementationOnce(async (input) => {
      const other = await original(input);
      await store.runs.finish(other!.run.id, other!.generation, 'done', null, 0, now);
      return original(input);
    });
    const response = await app.inject(post);
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({ error: 'rate_limited' });
    expect(await store.runs.list(50)).toHaveLength(1);
  });
});

describe('proactive disabled composition', () => {
  it('registers no routes and does not even inspect dependencies when off', async () => {
    let accessed = 0;
    const options = {
      enabled: false,
      get ownerObjectId() { accessed++; return owner; },
      get pool() { accessed++; return undefined; },
    };
    const app = Fastify({ logger: false });
    apps.push(app);
    installAuthentication(app, loadConfig({ ENTRA_OWNER_OBJECT_ID: owner }), tokenVerifier);
    registerProactive(app, options as ProactiveCompositionOptions);
    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/proactive/status', headers: { authorization } });
    expect(response.statusCode).toBe(404);
    expect(accessed).toBe(0);
  });

  it('reports missing SQL as not connected without throwing', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    installAuthentication(app, loadConfig({ ENTRA_OWNER_OBJECT_ID: owner }), tokenVerifier);
    registerProactive(app, {
      enabled: true,
      ownerObjectId: owner,
      now: () => new Date('2026-10-20T05:00:00.000Z'),
    });
    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/proactive/status', headers: { authorization } });
    expect(response.statusCode).toBe(200);
    expect(response.json().sources.find((status: { id: string }) => status.id === 'calendar')).toMatchObject({
      state: 'unavailable', reason: 'not_connected',
    });
    expect(response.json().sources.find((status: { id: string }) => status.id === 'x')).toMatchObject({
      state: 'disabled', reason: null,
    });
    const enabled = await app.inject({
      method: 'PATCH',
      url: '/proactive/settings',
      headers: { authorization },
      payload: { sources: [{ id: 'x', enabled: true }] },
    });
    expect(enabled.statusCode).toBe(200);
    const updated = await app.inject({ method: 'GET', url: '/proactive/status', headers: { authorization } });
    expect(updated.json().sources.find((status: { id: string }) => status.id === 'x')).toMatchObject({
      state: 'unavailable', reason: 'no_provider',
    });
  });
});
