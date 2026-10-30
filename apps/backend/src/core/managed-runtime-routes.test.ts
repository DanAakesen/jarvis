import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { RuntimeSessionStore } from './runtime-session.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const apps: ReturnType<typeof buildApp>[] = [];
const target = { model: 'gpt-6.1-terra', effort: 'high', agentName: 'synthetic', version: '1', fingerprint: 'a'.repeat(64) };
const claimId = '23fb84c8-43e0-4658-980a-c8f18e425aab';
const headers = { authorization: 'Bearer e30.agent.sig', 'x-jarvis-message-id': '42' };
function setup() {
  const sessions: RuntimeSessionStore = {
    createSession: vi.fn(), getSession: vi.fn(),
    claimTurn: vi.fn(async () => ({ kind: 'claimed' as const, claimId, nativeConversationId: null })),
    bindNativeConversation: vi.fn(async () => true),
    completeTurn: vi.fn(async () => true), attachSource: vi.fn(async () => true),
  };
  const readVerifiedTarget = vi.fn(async () => target);
  const app = buildApp(config, undefined, {
    auth: async token => token === 'e30.agent.sig'
      ? { kind: 'jarvis-agent', objectId: '11111111-1111-4111-8111-111111111111', tenantId: config.auth.tenantId }
      : { objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Synthetic owner' },
    managedRuntime: { sessions, readVerifiedTarget },
  });
  apps.push(app);
  return { app, sessions, readVerifiedTarget };
}
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
describe('internal managed runtime persistence', () => {
  it('refuses a browser owner token before reading or changing bindings', async () => {
    const { app, sessions, readVerifiedTarget } = setup();
    const response = await app.inject({ method: 'POST', url: '/agent/runtime-tests/41/claim',
      headers: { ...headers, authorization: 'Bearer e30.owner.sig' }, payload: { target } });
    expect(response.statusCode).toBe(403);
    expect(readVerifiedTarget).not.toHaveBeenCalled();
    expect(sessions.claimTurn).not.toHaveBeenCalled();
  });
  it('derives the owner/source server-side and returns capability only for a successful claim', async () => {
    const { app, sessions } = setup();
    const response = await app.inject({ method: 'POST', url: '/agent/runtime-tests/41/claim', headers, payload: { target } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ claimId, nativeConversationId: null });
    expect(sessions.claimTurn).toHaveBeenCalledWith({ ownerObjectId: config.auth.ownerObjectId, sessionId: '41', sourceMessageId: '42', target });
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('rejects caller target drift before a durable claim', async () => {
    const { app, sessions } = setup();
    const response = await app.inject({ method: 'POST', url: '/agent/runtime-tests/41/claim', headers,
      payload: { target: { ...target, effort: 'none' } } });
    expect(response.statusCode).toBe(409);
    expect(sessions.claimTurn).not.toHaveBeenCalled();
  });
  it('does not expose a capability or raw SQL errors when storage outcome is uncertain', async () => {
    const { app, sessions } = setup();
    vi.mocked(sessions.claimTurn).mockRejectedValue(new Error('Private database payload'));
    const response = await app.inject({ method: 'POST', url: '/agent/runtime-tests/41/claim', headers, payload: { target } });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('Private');
    expect(response.json()).not.toHaveProperty('claimId');
    expect(sessions.claimTurn).toHaveBeenCalledTimes(1);
  });
  it.each(['bind', 'source', 'finish'])('requires the original stored source and claim for %s', async operation => {
    const { app, sessions } = setup();
    const body = operation === 'bind' ? { claimId, nativeConversationId: 'conv-synthetic' }
      : operation === 'source' ? { claimId, additionalSourceMessageId: '43' }
        : { claimId, outcome: 'succeeded' };
    const response = await app.inject({ method: 'POST', url: `/agent/runtime-tests/41/${operation}`, headers, payload: body });
    expect(response.statusCode).toBe(204);
    const fn = operation === 'bind' ? sessions.bindNativeConversation : operation === 'source' ? sessions.attachSource : sessions.completeTurn;
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ ownerObjectId: config.auth.ownerObjectId, sessionId: '41', sourceMessageId: '42', claimId }));
  });
});
