import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatSession, loadConversationHistory, loadRuntimeTestAvailability } from './conversation-history';
const config = { ...__JARVIS_CONFIG__, backendUrl: 'https://api.example.com' };
const token = async () => 'synthetic-token';
afterEach(() => vi.unstubAllGlobals());
describe('runtime test client boundaries', () => {
  it('requires the exact requested runtime from session creation', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ id: '50', channel: 'chat', language: 'en', runtimeTest: 'copilot' })));
    vi.stubGlobal('fetch', fetch);
    await expect(createChatSession(token, config, 'en', undefined, 'copilot')).resolves.toEqual({ id: '50', language: 'en', runtimeTest: 'copilot' });
    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toEqual({ channel: 'chat', language: 'en', runtimeTest: 'copilot' });
    await expect(createChatSession(token, config, 'en', undefined, 'current')).rejects.toThrow('invalid chat session');
  });
  it('rejects unconfirmed availability and accepts explicit unavailability reasons', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ current: { available: true }, copilot: { available: false, reason: 'Settings are unsupported.' } }))));
    expect((await loadRuntimeTestAvailability(token, config)).copilot).toEqual({ available: false, reason: 'Settings are unsupported.' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ current: { available: true } }))));
    await expect(loadRuntimeTestAvailability(token, config)).rejects.toThrow('Invalid runtime availability');
  });
  it('scopes test history and rejects any message from another conversation', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ messages: [], nextCursor: null })));
    vi.stubGlobal('fetch', fetch);
    await loadConversationHistory(token, config, undefined, '50');
    expect(new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get('sessionId')).toBe('50');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: '51', sessionId: '99', channel: 'chat', language: 'en', role: 'jarvis', text: 'Other chat', model: null, at: '2026-10-29T12:00:00Z', toolCalls: [] }], nextCursor: null }))));
    await expect(loadConversationHistory(token, config, undefined, '50')).rejects.toThrow('invalid conversation history');
  });
});
