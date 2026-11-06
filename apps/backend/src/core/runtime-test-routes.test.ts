import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { ConversationStore } from './conversation-store.js';
import type { RuntimeSessionStore } from './runtime-session.js';
import { hasManagedPolicyCompatibility, managedPolicyCompatibilityReceipt } from './managed-policy-compatibility.js';

const config = loadConfig({});
const apps: ReturnType<typeof buildApp>[] = [];
const headers = { authorization: 'Bearer fixture.owner.token' };
const session = { id: '41', channel: 'chat' as const, language: 'en' as const,
  startedAt: new Date('2026-10-29T09:00:00Z'), endedAt: null };

const metadata = { projectEndpoint: 'https://synthetic.services.ai.azure.com/api/projects/synthetic', definition: {},
  target: { agentName: 'fixture', version: '1', fingerprint: 'a'.repeat(64), model: 'gpt-6.1-terra', effort: 'high' } };
function setup(runtimeTest?: 'current' | 'copilot', readReceipt?: () => string | undefined) {
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
  const sessions: RuntimeSessionStore = { createSession: vi.fn(), getSession: vi.fn(), claimTurn: vi.fn(),
    bindNativeConversation: vi.fn(), completeTurn: vi.fn(), attachSource: vi.fn() };
  const verified = () => hasManagedPolicyCompatibility(metadata, readReceipt?.());
  const app = buildApp(config, undefined, { conversationStore: store, conversationAgent: agent,
    ...(readReceipt ? {
      managedRuntime: { sessions, readTargetMetadata: async () => metadata,
        readVerifiedTarget: async () => verified() ? metadata.target : null },
      conversationRuntimeTests: async () => ({ current: { available: true },
        copilot: verified() ? { available: true } : { available: false, reason: 'copilot_policy_not_verified' as const } }),
    } : {}),
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Fixture owner' }),
  });
  apps.push(app);
  return { app, store, agent, sessions };
}
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

describe('runtime test routing', () => {
  it('refuses missing policy compatibility before session creation or any source/claim', async () => {
    const { app, store, sessions } = setup('copilot', () => undefined);
    const availability = await app.inject({ url: '/conversation/runtime-tests', headers });
    expect(availability.json().copilot).toEqual({ available: false, reason: 'copilot_policy_not_verified' });
    expect(availability.json().current.available).toBe(true);
    const create = await app.inject({ method: 'POST', url: '/conversation/sessions', headers,
      payload: { channel: 'chat', language: 'en', runtimeTest: 'copilot' } });
    expect(create.statusCode).toBe(503);
    expect(create.json().error).toContain('applying Jarvis’s instructions');
    expect(store.createSession).not.toHaveBeenCalled();
    expect(store.addMessage).not.toHaveBeenCalled();
    expect(sessions.claimTurn).not.toHaveBeenCalled();
  });
  it('rechecks compatibility before an existing Copilot session accepts another message', async () => {
    let receipt: string | undefined = managedPolicyCompatibilityReceipt(metadata);
    const { app, store, agent, sessions } = setup('copilot', () => receipt);
    const create = await app.inject({ method: 'POST', url: '/conversation/sessions', headers,
      payload: { channel: 'chat', language: 'en', runtimeTest: 'copilot' } });
    expect(create.statusCode).toBe(201);
    receipt = undefined;
    const turn = await app.inject({ method: 'POST', url: '/conversation/sessions/41/turns', headers,
      payload: { text: 'Read the fixture.' } });
    expect(turn.statusCode).toBe(503);
    expect(turn.json().error).toContain('Use Current.');
    expect(store.addMessage).not.toHaveBeenCalled();
    expect(agent.stream).not.toHaveBeenCalled();
    expect(sessions.claimTurn).not.toHaveBeenCalled();
  });

  it('reports unverified Copilot unavailable without treating configuration as live support', async () => {
    const { app } = setup();
    const response = await app.inject({ url: '/conversation/runtime-tests', headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ current: { available: true }, copilot: { available: false, reason: 'copilot_not_configured' } });
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
