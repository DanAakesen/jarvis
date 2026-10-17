import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TokenVerifier } from '../auth/verify.js';
import { buildApp, type BuildAppOptions } from '../app.js';
import { loadConfig } from '../config.js';
import type {
  ConversationSummaryRecord,
  ConversationSummaryStore,
} from '../database/conversation-summary-store.js';
import { conversationModule } from './conversation.js';
import type { SettingsStore } from './settings.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = { authorization: ['Bearer', ['e30', 'e30', 'sig'].join('.')].join(' ') };
const ownerAuth: TokenVerifier = async () => ({
  objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan',
});
const otherAuth: TokenVerifier = async () => ({
  objectId: '11111111-1111-4111-8111-111111111111', tenantId: config.auth.tenantId, displayName: 'Someone else',
});
const agentAuth: TokenVerifier = async () => ({
  kind: 'jarvis-agent', objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId,
});
const limitKey = 'global.conversation_summary_daily_limit';
const createdAt = '2026-10-17T10:00:00.000Z';
const payload = {
  baseVersion: 0,
  fromMessageId: '10',
  throughMessageId: '40',
  messageCount: 31,
  summary: 'Dan planned the Copenhagen trip and chose the 9am train.',
  openItems: 'Book the hotel.',
  model: 'gpt-5.6-luna',
};
const apps: ReturnType<typeof buildApp>[] = [];

function memoryStore() {
  const records: ConversationSummaryRecord[] = [];
  return {
    records,
    latest: vi.fn<ConversationSummaryStore['latest']>(async () => records.at(-1) ?? null),
    usedSince: vi.fn<ConversationSummaryStore['usedSince']>(async () => records.length),
    append: vi.fn<ConversationSummaryStore['append']>(async (input) => {
      const latest = records.at(-1);
      const latestVersion = latest?.version ?? 0;
      if (latestVersion !== input.baseVersion) return { status: 'conflict', latestVersion };
      if (latest && (BigInt(input.throughMessageId) <= BigInt(latest.throughMessageId) ||
          input.fromMessageId !== latest.fromMessageId)) return { status: 'invalid_range' };
      if (records.length >= input.dailyLimit) return { status: 'limit', used: records.length };
      const record: ConversationSummaryRecord = {
        version: latestVersion + 1,
        fromMessageId: input.fromMessageId,
        throughMessageId: input.throughMessageId,
        messageCount: input.messageCount,
        summary: input.summary,
        openItems: input.openItems,
        model: input.model,
        createdAt,
      };
      records.push(record);
      return { status: 'saved', record, usedLast24h: records.length };
    }),
  };
}

function settingsFixture(values: Record<string, unknown> = {}): SettingsStore {
  return { read: async () => values, write: async () => {} };
}

function fixture(store: ConversationSummaryStore | null = memoryStore(), options: Partial<BuildAppOptions> = {}) {
  const app = buildApp(config, undefined, {
    modules: [conversationModule],
    auth: ownerAuth,
    ...(store ? { conversationSummaryStore: store } : {}),
    ...options,
  });
  apps.push(app);
  return app;
}

function read(app: ReturnType<typeof buildApp>) {
  return app.inject({ url: '/conversation/summary', headers });
}

function post(app: ReturnType<typeof buildApp>, body: object) {
  return app.inject({ method: 'POST', url: '/conversation/summary', headers, payload: body });
}

function omit(body: Record<string, unknown>, name: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([key]) => key !== name));
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('conversation summary API', () => {
  it('requires authentication and the owner identity on user routes', async () => {
    const store = memoryStore();
    const app = fixture(store);

    expect((await app.inject({ url: '/conversation/summary' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/conversation/summary', payload })).statusCode).toBe(401);
    for (const auth of [otherAuth, agentAuth]) {
      const denied = fixture(store, { auth });
      expect((await read(denied)).statusCode).toBe(403);
      expect((await post(denied, payload)).statusCode).toBe(403);
    }
    expect(store.latest).not.toHaveBeenCalled();
    expect(store.append).not.toHaveBeenCalled();
  });

  it('returns no summary and the default daily budget when nothing is saved', async () => {
    const store = memoryStore();

    const response = await read(fixture(store));

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.json()).toEqual({ summary: null, budget: { limit: 24, usedLast24h: 0 } });
    expect(store.latest).toHaveBeenCalledWith(config.auth.ownerObjectId);
    expect(store.usedSince).toHaveBeenCalledWith(config.auth.ownerObjectId);
  });

  it('stores the first summary and serves it back with the budget', async () => {
    const store = memoryStore();
    const app = fixture(store);
    const stored = {
      version: 1,
      fromMessageId: '10',
      throughMessageId: '40',
      messageCount: 31,
      summary: payload.summary,
      openItems: payload.openItems,
      model: payload.model,
      createdAt,
    };

    const created = await post(app, payload);

    expect(created.statusCode).toBe(201);
    expect(created.headers['cache-control']).toBe('private, no-store');
    expect(created.json()).toEqual({ summary: stored, budget: { limit: 24, usedLast24h: 1 } });
    expect(store.append).toHaveBeenCalledWith({
      ownerObjectId: config.auth.ownerObjectId, ...payload, dailyLimit: 24,
    });
    expect((await read(app)).json()).toEqual({ summary: stored, budget: { limit: 24, usedLast24h: 1 } });
  });

  it('extends the summary incrementally with the next version', async () => {
    const store = memoryStore();
    const app = fixture(store);
    await post(app, payload);

    const second = await post(app, {
      ...payload, baseVersion: 1, throughMessageId: '90', messageCount: 81, summary: 'Trip booked.', openItems: '',
    });

    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual({
      summary: {
        version: 2,
        fromMessageId: '10',
        throughMessageId: '90',
        messageCount: 81,
        summary: 'Trip booked.',
        openItems: '',
        model: payload.model,
        createdAt,
      },
      budget: { limit: 24, usedLast24h: 2 },
    });
    expect((await read(app)).json()).toMatchObject({ summary: { version: 2 }, budget: { usedLast24h: 2 } });
  });

  it('reports the latest version when the base version is stale', async () => {
    const store = memoryStore();
    const app = fixture(store);
    await post(app, payload);

    const stale = await post(app, { ...payload, baseVersion: 0, throughMessageId: '90' });

    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: expect.any(String), latestVersion: 1 });
    expect(store.records).toHaveLength(1);
  });

  it('rejects ranges that end before they start or do not extend the latest summary', async () => {
    const store = memoryStore();
    const app = fixture(store);

    const backwards = await post(app, { ...payload, fromMessageId: '40', throughMessageId: '10' });
    expect(backwards.statusCode).toBe(422);
    expect(store.append).not.toHaveBeenCalled();

    await post(app, payload);
    for (const range of [
      { throughMessageId: '40' },
      { throughMessageId: '39' },
      { fromMessageId: '11', throughMessageId: '90' },
    ]) {
      const response = await post(app, { ...payload, baseVersion: 1, ...range });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({ error: expect.any(String) });
    }
    expect(store.records).toHaveLength(1);
  });

  it('redacts secret-like text instead of rejecting it', async () => {
    const store = memoryStore();
    const secret = ['Bearer', 'private-token'].join(' ');

    const response = await post(fixture(store), {
      ...payload,
      summary: `Dan pasted ${secret} while debugging.`,
      openItems: 'Rotate the api_key: private-value',
    });

    const stored = store.records[0];
    expect(response.statusCode).toBe(201);
    expect(stored?.summary).toContain('[REDACTED]');
    expect(`${stored?.summary} ${stored?.openItems}`).not.toMatch(/private-token|private-value/u);
    expect(response.json().summary).toEqual(stored);
    expect(store.append).toHaveBeenCalledWith(expect.objectContaining({
      summary: stored?.summary, openItems: stored?.openItems,
    }));
  });

  it('trims text before storing it', async () => {
    const store = memoryStore();

    const response = await post(fixture(store), {
      ...payload, summary: '  Trip planned.\n', openItems: ' \n ', model: ' gpt-5.6-luna ',
    });

    expect(response.statusCode).toBe(201);
    expect(store.records[0]).toMatchObject({ summary: 'Trip planned.', openItems: '', model: 'gpt-5.6-luna' });
  });

  it('rejects blank text and text that redaction pushes over its bound with 422', async () => {
    const store = memoryStore();
    const app = fixture(store);
    // Redaction turns each 8-character credential into 10 characters, so this passes the schema but not the column bound.
    const growing = Array(666).fill(['Bearer', 'x'].join(' ')).join(' ');

    for (const override of [{ summary: '   ' }, { summary: growing }, { model: '   ' }]) {
      expect((await post(app, { ...payload, ...override })).statusCode).toBe(422);
    }
    expect(store.append).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing field', omit(payload, 'model')],
    ['an unknown field', { ...payload, extra: true }],
    ['a negative base version', { ...payload, baseVersion: -1 }],
    ['a fractional base version', { ...payload, baseVersion: 1.5 }],
    ['a null base version', { ...payload, baseVersion: null }],
    ['a string message count', { ...payload, messageCount: '31' }],
    ['a zero message count', { ...payload, messageCount: 0 }],
    ['too many messages', { ...payload, messageCount: 1_000_001 }],
    ['a zero message id', { ...payload, fromMessageId: '0' }],
    ['a numeric message id', { ...payload, throughMessageId: 40 }],
    ['a message id above the SQL bigint range', { ...payload, throughMessageId: '9223372036854775808' }],
    ['an empty summary', { ...payload, summary: '' }],
    ['an oversized summary', { ...payload, summary: 'x'.repeat(6001) }],
    ['oversized open items', { ...payload, openItems: 'x'.repeat(3001) }],
    ['an empty model', { ...payload, model: '' }],
    ['an oversized model', { ...payload, model: 'm'.repeat(129) }],
    ['an array body', [payload]],
  ])('rejects %s with 400', async (_name, body) => {
    const store = memoryStore();

    const response = await post(fixture(store), body);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: expect.any(String) });
    expect(store.append).not.toHaveBeenCalled();
  });

  it('bounds the request body size', async () => {
    const store = memoryStore();

    const response = await post(fixture(store), { ...payload, summary: 'x'.repeat(70_000) });

    expect(response.statusCode).toBe(413);
    expect(store.append).not.toHaveBeenCalled();
  });

  it('reports the budget when the store says the daily limit is reached', async () => {
    const store = memoryStore();
    store.append.mockResolvedValueOnce({ status: 'limit', used: 24 });

    const response = await post(fixture(store), payload);

    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({ error: expect.any(String), budget: { limit: 24, usedLast24h: 24 } });
  });

  it('uses the configured daily limit and treats zero as disabled', async () => {
    const configured = memoryStore();
    const twelve = fixture(configured, { settingsStore: settingsFixture({ [limitKey]: '12' }) });
    expect((await read(twelve)).json()).toEqual({ summary: null, budget: { limit: 12, usedLast24h: 0 } });
    expect((await post(twelve, payload)).statusCode).toBe(201);
    expect(configured.append).toHaveBeenCalledWith(expect.objectContaining({ dailyLimit: 12 }));

    const disabled = memoryStore();
    const zero = fixture(disabled, { settingsStore: settingsFixture({ [limitKey]: '0' }) });
    const response = await post(zero, payload);

    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({ error: expect.any(String), budget: { limit: 0, usedLast24h: 0 } });
    expect(disabled.append).toHaveBeenCalledWith(expect.objectContaining({ dailyLimit: 0 }));
    expect(disabled.records).toHaveLength(0);
    expect((await read(zero)).json()).toEqual({ summary: null, budget: { limit: 0, usedLast24h: 0 } });
  });

  it('reports 503 without details when the store, the database, or the settings are unavailable', async () => {
    const missing = fixture(null);
    expect((await read(missing)).statusCode).toBe(503);
    expect((await post(missing, payload)).statusCode).toBe(503);

    const failing = memoryStore();
    failing.latest.mockRejectedValueOnce(new Error('SQL unavailable'));
    failing.append.mockRejectedValueOnce(new Error('SQL unavailable'));
    const app = fixture(failing);
    const unreadable = await read(app);
    const unsaved = await post(app, payload);
    expect([unreadable.statusCode, unsaved.statusCode]).toEqual([503, 503]);
    expect(`${unreadable.body} ${unsaved.body}`).not.toContain('SQL unavailable');

    const noSettings = memoryStore();
    const brokenSettings: SettingsStore = {
      read: async () => { throw new Error('SQL unavailable'); },
      write: async () => {},
    };
    const withoutSettings = fixture(noSettings, { settingsStore: brokenSettings });
    expect((await read(withoutSettings)).statusCode).toBe(503);
    expect((await post(withoutSettings, payload)).statusCode).toBe(503);
    expect(noSettings.append).not.toHaveBeenCalled();
  });
});
