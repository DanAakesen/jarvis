import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TokenVerifier } from '../auth/verify.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { UsageEntry, UsageStore } from './usage.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = { authorization: ['Bearer', ['e30', 'e30', 'sig'].join('.')].join(' ') };
const from = new Date('2026-09-27T03:00:00.000Z');
const to = new Date('2026-10-04T03:00:00.000Z');
const entry: UsageEntry = {
  taskId: '42',
  taskTitle: 'Fix the bug',
  projectId: '7',
  projectName: 'Jarvis',
  agent: 'codex',
  source: 'codex',
  metric: 'turns',
  quantity: 2,
  costDkk: null,
  at: to.toISOString(),
  estimated: false,
};
const apps: ReturnType<typeof buildApp>[] = [];

function fixture(store: UsageStore | null = {
  list: vi.fn(async () => ({ entries: [entry], totalEntries: '1' })),
}, auth: TokenVerifier = async () => ({
  objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan',
})) {
  const app = buildApp(config, undefined, { auth, usageStore: store ?? undefined });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.useRealTimers();
});

describe('usage report API', () => {
  it('returns authenticated usage within the selected period', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(to);
    const store: UsageStore = { list: vi.fn(async () => ({ entries: [entry], totalEntries: '1' })) };
    const app = fixture(store);

    const response = await app.inject({ url: '/usage?period=7d', headers });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      period: '7d',
      from: from.toISOString(),
      to: to.toISOString(),
      entries: [entry],
      totalEntries: '1',
      dailyToolUsage: { date: to.toISOString().slice(0, 10), tools: [] },
      truncated: false,
    });
    expect(store.list).toHaveBeenCalledWith(from, to);
  });

  it('defaults to 30 days and indicates when grouped entries are capped', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(to);
    const store: UsageStore = {
      list: vi.fn(async () => ({ entries: [entry], totalEntries: '1200' })),
    };
    const response = await fixture(store).inject({ url: '/usage', headers });

    expect(response.statusCode).toBe(200);
    expect(response.json().period).toBe('30d');
    expect(response.json().truncated).toBe(true);
    expect(store.list).toHaveBeenCalledWith(new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000), to);
  });

  it('requests all-time usage without a lower bound', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(to);
    const store: UsageStore = { list: vi.fn(async () => ({ entries: [], totalEntries: '0' })) };

    const response = await fixture(store).inject({ url: '/usage?period=all', headers });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ period: 'all', from: null, to: to.toISOString() });
    expect(store.list).toHaveBeenCalledWith(null, to);
  });

  it('rejects invalid filters, requires authentication, and reports unavailable storage', async () => {
    const store: UsageStore = { list: vi.fn(async () => ({ entries: [], totalEntries: '0' })) };
    const app = fixture(store);

    expect((await app.inject({ url: '/usage?period=12m', headers })).statusCode).toBe(400);
    expect((await app.inject({ url: '/usage' })).statusCode).toBe(401);
    expect(store.list).not.toHaveBeenCalled();
    expect((await fixture(null).inject({ url: '/usage', headers })).statusCode).toBe(503);
  });
});
