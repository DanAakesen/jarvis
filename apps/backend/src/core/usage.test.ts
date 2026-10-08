import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TokenVerifier } from '../auth/verify.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { UsageEntry, UsageStore } from './usage.js';
import type { ToolCallStore } from './tool-calls.js';

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
  role: null,
  model: null,
  quantity: 2,
  costUsd: null,
  costDkk: null,
  costStatus: 'unverified',
  at: to.toISOString(),
  estimated: false,
};
const apps: ReturnType<typeof buildApp>[] = [];

function fixture(store: UsageStore | null = {
  list: vi.fn(async () => ({ entries: [entry], totalEntries: '1' })),
}, auth: TokenVerifier = async () => ({
  objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan',
}), toolCallStore?: ToolCallStore) {
  const app = buildApp(config, undefined, {
    auth, usageStore: store ?? undefined, ...(toolCallStore ? { toolCallStore } : {}),
  });
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
      codexToolCallsToday: null,
      entries: [entry],
      totalEntries: '1',
      dailyToolUsage: { date: to.toISOString().slice(0, 10), tools: [] },
      dailyCostTotals: [],
      monthlyCostTotals: [],
      toolCalls: [],
      roleCoverage: expect.arrayContaining([
        { role: 'chat', usageStatus: 'measured', costStatus: 'estimated', note: expect.any(String) },
        { role: 'research', usageStatus: 'unverified', costStatus: 'unverified', note: expect.any(String) },
        { role: 'embeddings', usageStatus: 'measured', costStatus: 'unverified', note: expect.any(String) },
      ]),
      truncated: false,
    });
    expect(store.list).toHaveBeenCalledWith(from, to);
  });

  it('returns usage for the current UTC day', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(to);
    const store: UsageStore = { list: vi.fn(async () => ({ entries: [], totalEntries: '0' })) };

    const response = await fixture(store).inject({ url: '/usage?period=today', headers });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ period: 'today', from: '2026-10-04T00:00:00.000Z' });
    expect(store.list).toHaveBeenCalledWith(new Date('2026-10-04T00:00:00.000Z'), to);
  });

  it('exposes sensitive period spend by area and model through the shared tool registry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(to);
    const entries: UsageEntry[] = [
      { ...entry, role: 'chat', model: 'gpt-6.1-sol', costUsd: 0.01, costDkk: 0.065785, costStatus: 'estimated' },
      { ...entry, role: 'chat', model: 'gpt-6.1-sol', costUsd: 0.02, costDkk: 0.13157, costStatus: 'estimated' },
      { ...entry, role: 'voice', model: 'gpt-5.6-luna', costUsd: null, costDkk: null, costStatus: 'unverified' },
    ];
    const store: UsageStore = {
      list: vi.fn(async () => ({ entries, totalEntries: String(entries.length) })),
    };
    const agentAuth: TokenVerifier = async () => ({
      kind: 'jarvis-agent',
      objectId: config.auth.ownerObjectId,
      tenantId: config.auth.tenantId,
    });
    const toolCallStore: ToolCallStore = { record: vi.fn(async () => {}) };
    const request = {
      method: 'POST',
      url: '/tools/get_usage',
      headers: { ...headers, 'x-jarvis-message-id': '42' },
      payload: { period: 'today' },
    };

    const app = fixture(store, agentAuth, toolCallStore);
    const response = await app.inject(request);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      tool: 'get_usage',
      outcome: 'ok',
      result: {
        period: 'today',
        from: '2026-10-04T00:00:00.000Z',
        total: { usd: 0.03, dkk: 0.197355, estimatedEntries: 2, unverifiedEntries: 1, costStatus: 'unverified' },
        areas: [
          { area: 'chat', usd: 0.03, dkk: 0.197355, estimatedEntries: 2, costStatus: 'estimated' },
          { area: 'voice', usd: 0, dkk: 0, unverifiedEntries: 1, costStatus: 'unverified' },
        ],
        models: [
          { model: 'gpt-5.6-luna', usd: 0, unverifiedEntries: 1, costStatus: 'unverified' },
          { model: 'gpt-6.1-sol', usd: 0.03, dkk: 0.197355, estimatedEntries: 2, costStatus: 'estimated' },
        ],
        truncated: false,
      },
    });
    expect(store.list).toHaveBeenCalledWith(new Date('2026-10-04T00:00:00.000Z'), to);
    expect(toolCallStore.record).toHaveBeenCalledWith({
      messageId: '42',
      tool: 'get_usage',
      arguments: { redacted: true },
      result: { redacted: true },
      outcome: 'ok',
    });
  });

  it('returns per-tool Codex counts for the UTC day', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(to);
    const store: UsageStore = { list: vi.fn(async () => ({ entries: [], totalEntries: '0' })) };
    const toolCallStore: ToolCallStore = {
      record: vi.fn(async () => {}),
      listCodexToolCalls: vi.fn(async () => [{ tool: 'web_research', count: '3' }]),
    };
    const response = await fixture(store, undefined, toolCallStore).inject({ url: '/usage', headers });

    expect(response.statusCode).toBe(200);
    expect(response.json().codexToolCallsToday).toEqual([{ tool: 'web_research', count: '3' }]);
    expect(toolCallStore.listCodexToolCalls).toHaveBeenCalledWith(
      new Date('2026-10-04T00:00:00.000Z'),
      new Date('2026-10-05T00:00:00.000Z'),
    );
  });

  it('reports Codex counts unavailable without failing the rest of usage', async () => {
    const store: UsageStore = { list: vi.fn(async () => ({ entries: [], totalEntries: '0' })) };
    const toolCallStore: ToolCallStore = {
      record: vi.fn(async () => {}),
      listCodexToolCalls: vi.fn(async () => { throw new Error('database failed'); }),
    };

    const response = await fixture(store, undefined, toolCallStore).inject({ url: '/usage', headers });

    expect(response.statusCode).toBe(200);
    expect(response.json().codexToolCallsToday).toBeNull();
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

  it('accepts bounded Foundry usage only from the Jarvis agent identity', async () => {
    const recordFoundryUsage = vi.fn(async () => {});
    const store: UsageStore = {
      list: vi.fn(async () => ({ entries: [], totalEntries: '0' })),
      recordFoundryUsage,
    };
    const agentAuth: TokenVerifier = async () => ({
      kind: 'jarvis-agent',
      objectId: config.auth.ownerObjectId,
      tenantId: config.auth.tenantId,
    });
    const payload = {
      role: 'chat',
      model: 'gpt-5.6-luna',
      inputTokens: 123,
      outputTokens: 45,
      eventId: 'a2a01070-225e-4d8b-b882-f925cf177603',
    };

    const denied = await fixture(store).inject({ method: 'POST', url: '/usage/foundry', headers, payload });
    const response = await fixture(store, agentAuth).inject({
      method: 'POST', url: '/usage/foundry', headers, payload,
    });
    const invalid = await fixture(store, agentAuth).inject({
      method: 'POST', url: '/usage/foundry', headers, payload: { ...payload, inputTokens: 10_000_001 },
    });

    expect(denied.statusCode).toBe(403);
    expect(response.statusCode).toBe(204);
    expect(invalid.statusCode).toBe(400);
    expect(recordFoundryUsage).toHaveBeenCalledOnce();
    expect(recordFoundryUsage).toHaveBeenCalledWith(payload);
  });
});
