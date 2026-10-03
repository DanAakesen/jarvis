import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createLogger } from '../logging.js';
import type { ConversationStore } from './conversation-store.js';

const config = loadConfig({});
const apps: ReturnType<typeof buildApp>[] = [];
const startedAt = new Date('2026-10-03T12:00:00Z');
const message = {
  id: '42',
  sessionId: '41',
  role: 'dan' as const,
  text: 'Hello Jarvis',
  model: null,
  at: startedAt,
};
const history = {
  messages: [{
    ...message,
    channel: 'chat' as const,
    language: 'da' as const,
    toolCalls: [{ id: '90', tool: 'factory_create_task', outcome: 'refused' as const, taskId: null }],
  }],
  nextCursor: null,
};
const auth = async () => ({
  objectId: config.auth.ownerObjectId,
  tenantId: config.auth.tenantId,
  displayName: 'Dan Aakesen',
});

function createApp(store?: ConversationStore) {
  const sink = { trackTrace: vi.fn(), flush: vi.fn(async () => {}), shutdown: vi.fn(async () => {}) };
  const output = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const app = buildApp(config, createLogger(config, sink, output), {
    auth,
    ...(store ? { conversationStore: store } : {}),
  });
  apps.push(app);
  return app;
}

function storeFixture(overrides: Partial<ConversationStore> = {}) {
  return {
    createSession: vi.fn(async () => ({
      id: '41',
      channel: 'chat' as const,
      language: 'da' as const,
      startedAt,
      endedAt: null,
    })),
    endSession: vi.fn(async () => true),
    addMessage: vi.fn<ConversationStore['addMessage']>(async () => message),
    getHistory: vi.fn(async () => history),
    ...overrides,
  } satisfies ConversationStore;
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

const headers = { authorization: ['Bearer', 'a.b.c'].join(' ') };

describe('conversation routes', () => {
  it('creates chat or voice sessions with a validated language', async () => {
    const store = storeFixture();
    const app = createApp(store);
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/sessions',
      headers,
      payload: { channel: 'voice', language: 'en' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ id: '41', channel: 'chat', language: 'da' });
    expect(store.createSession).toHaveBeenCalledWith({ channel: 'voice', language: 'en' });
  });

  it('rejects invalid session fields and unauthenticated callers', async () => {
    const store = storeFixture();
    const app = createApp(store);
    const invalid = await app.inject({
      method: 'POST',
      url: '/conversation/sessions',
      headers,
      payload: { channel: 'email', language: 'da' },
    });
    const unauthorized = await app.inject({
      method: 'POST',
      url: '/conversation/sessions',
      payload: { channel: 'chat', language: 'da' },
    });

    expect(invalid.statusCode).toBe(400);
    expect(unauthorized.statusCode).toBe(401);
    expect(store.createSession).not.toHaveBeenCalled();
  });

  it('persists messages for an active session and rejects blank content', async () => {
    const store = storeFixture();
    const app = createApp(store);
    store.addMessage.mockResolvedValueOnce(message).mockResolvedValueOnce(null);
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/sessions/41/messages',
      headers,
      payload: { role: 'dan', text: 'Hello Jarvis' },
    });
    const blank = await app.inject({
      method: 'POST',
      url: '/conversation/sessions/41/messages',
      headers,
      payload: { role: 'dan', text: '   ' },
    });
    const ended = await app.inject({
      method: 'POST',
      url: '/conversation/sessions/41/messages',
      headers,
      payload: { role: 'dan', text: 'Too late' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ id: '42', sessionId: '41', text: 'Hello Jarvis' });
    expect(blank.statusCode).toBe(400);
    expect(store.addMessage).toHaveBeenCalledTimes(2);
    expect(store.addMessage).toHaveBeenCalledWith({
      sessionId: '41',
      role: 'dan',
      text: 'Too late',
      model: null,
    });
    expect(ended.statusCode).toBe(404);
  });

  it('reads a bounded history page with tool-call metadata and ends sessions', async () => {
    const store = storeFixture({
      getHistory: vi.fn(async () => history),
      endSession: vi.fn(async () => false),
    });
    const app = createApp(store);
    const response = await app.inject({ url: '/conversation/history?limit=25&before=50', headers });
    const invalidCursor = await app.inject({ url: '/conversation/history?before=9223372036854775808', headers });
    const invalidSession = await app.inject({ method: 'POST', url: '/conversation/sessions/9223372036854775808/end', headers });
    const ended = await app.inject({ method: 'POST', url: '/conversation/sessions/41/end', headers });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      messages: [{ id: '42', toolCalls: [{ id: '90', outcome: 'refused' }] }],
      nextCursor: null,
    });
    expect(store.getHistory).toHaveBeenCalledWith({ limit: 25, before: '50' });
    expect(invalidCursor.statusCode).toBe(400);
    expect(invalidSession.statusCode).toBe(400);
    expect(store.getHistory).toHaveBeenCalledOnce();
    expect(ended.statusCode).toBe(404);
    expect(store.endSession).toHaveBeenCalledWith('41');
  });

  it('returns an unavailable response when persistence is not configured', async () => {
    const app = createApp();
    const response = await app.inject({ url: '/conversation/history', headers });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Conversation storage unavailable' });
  });
});
