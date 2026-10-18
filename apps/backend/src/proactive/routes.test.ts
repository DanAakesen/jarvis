import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { installAuthentication } from '../auth/hook.js';
import { loadConfig } from '../config.js';
import type { TokenVerifier, UserPrincipal } from '../auth/verify.js';
import { createMemoryProactiveStore, DEFAULT_NEWS_FEEDS } from './store.js';
import { registerProactiveRoutes } from './routes.js';
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

async function appFixture(clock: () => Date = () => new Date('2026-10-20T05:00:00.000Z')) {
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
