import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { ConversationStore } from './conversation-store.js';

const config = loadConfig({});
const apps: ReturnType<typeof buildApp>[] = [];
const headers = { authorization: 'Bearer fixture.owner.token' };
const session = { id: '41', channel: 'chat' as const, language: 'en' as const,
  startedAt: new Date('2026-10-29T09:00:00Z'), endedAt: null };

function setup(runtimeTest?: 'current' | 'copilot') {
  const store: ConversationStore = {
    createSession: vi.fn(async input => ({ ...session, ...(input.runtimeTest ? { runtimeTest: input.runtimeTest } : {}) })),
    getSession: vi.fn(async () => ({ ...session, ...(runtimeTest ? { runtimeTest } : {}) })),
    getMessageSessionId: vi.fn(async () => session.id),
    endSession: vi.fn(async () => true),
    addMessage: vi.fn(async () => null),
    getDanMessageIdBySourceItemId: vi.fn(async () => null),
    readRecentUserMessages: vi.fn(async () => []),
    getHistory: vi.fn(async () => ({ messages: [], nextCursor: null })),
    getDanMessagesAfter: vi.fn(async () => []),
  };
  const agent = { stream: vi.fn(async function* () { yield 'Fixture result'; }) };
  const app = buildApp(config, undefined, { conversationStore: store, conversationAgent: agent,
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Fixture owner' }),
  });
  apps.push(app);
  return { app, store, agent };
}
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

describe('runtime test routing', () => {
  it('reports unverified Copilot unavailable without treating configuration as live support', async () => {
    const { app } = setup();
    const response = await app.inject({ url: '/conversation/runtime-tests', headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ current: { available: true }, copilot: { available: false, reason: 'copilot_not_verified' } });
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('creates only a new current test session with the authenticated owner identity', async () => {
    const { app, store } = setup();
    const response = await app.inject({ method: 'POST', url: '/conversation/sessions', headers,
      payload: { channel: 'chat', language: 'en', runtimeTest: 'current' } });
    expect(response.statusCode).toBe(201);
    expect(response.json().runtimeTest).toBe('current');
    expect(store.createSession).toHaveBeenCalledWith({ channel: 'chat', language: 'en', runtimeTest: 'current', ownerObjectId: config.auth.ownerObjectId });
  });
  it('refuses unavailable Copilot without creating a different session', async () => {
    const { app, store } = setup();
    const response = await app.inject({ method: 'POST', url: '/conversation/sessions', headers,
      payload: { channel: 'chat', language: 'en', runtimeTest: 'copilot' } });
    expect(response.statusCode).toBe(503);
    expect(store.createSession).not.toHaveBeenCalled();
  });
  it('refuses runtime selection on a voice session', async () => {
    const { app, store } = setup();
    const response = await app.inject({ method: 'POST', url: '/conversation/sessions', headers,
      payload: { channel: 'voice', language: 'en', runtimeTest: 'current' } });
    expect(response.statusCode).toBe(400);
    expect(store.createSession).not.toHaveBeenCalled();
  });
  it('keeps normal creation unchanged', async () => {
    const { app, store } = setup();
    const response = await app.inject({ method: 'POST', url: '/conversation/sessions', headers,
      payload: { channel: 'chat', language: 'en' } });
    expect(response.statusCode).toBe(201);
    expect(response.json()).not.toHaveProperty('runtimeTest');
    expect(store.createSession).toHaveBeenCalledWith({ channel: 'chat', language: 'en' });
  });
  it('resolves stored source test scope and returns only its immutable runtime selection', async () => {
    const { app, store } = setup('copilot');
    const response = await app.inject({ url: '/conversation/history?sourceMessageId=42&limit=100', headers });
    expect(response.statusCode).toBe(200);
    expect(store.getMessageSessionId).toHaveBeenCalledWith('42');
    expect(store.getHistory).toHaveBeenCalledWith({ limit: 100, sessionId: '41' });
    expect(response.json()).toEqual({ messages: [], nextCursor: null, runtimeTest: 'copilot' });
  });
  it('uses existing global normal context for a verified normal source', async () => {
    const { app, store } = setup();
    const response = await app.inject({ url: '/conversation/history?sourceMessageId=42&limit=100', headers });
    expect(response.statusCode).toBe(200);
    expect(store.getHistory).toHaveBeenCalledWith({ limit: 100 });
    expect(response.json()).not.toHaveProperty('runtimeTest');
  });
  it('supports scoped test UI history without exposing a native provider reference', async () => {
    const { app, store } = setup('current');
    const response = await app.inject({ url: '/conversation/history?sessionId=41', headers });
    expect(response.statusCode).toBe(200);
    expect(store.getHistory).toHaveBeenCalledWith({ limit: 50, sessionId: '41' });
    expect(response.json()).not.toHaveProperty('nativeConversationId');
  });
  it('rejects competing source scopes without querying history', async () => {
    const { app, store } = setup();
    const response = await app.inject({ url: '/conversation/history?sessionId=41&sourceMessageId=42', headers });
    expect(response.statusCode).toBe(400);
    expect(store.getHistory).not.toHaveBeenCalled();
  });
  it('rechecks a persisted Copilot selection before accepting a user turn', async () => {
    const { app, store, agent } = setup('copilot');
    const response = await app.inject({ method: 'POST', url: '/conversation/sessions/41/turns', headers,
      payload: { text: 'Read the fixture.' } });
    expect(response.statusCode).toBe(503);
    expect(store.addMessage).not.toHaveBeenCalled();
    expect(agent.stream).not.toHaveBeenCalled();
  });
});
