import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { createToolRegistry, ToolFailure, type JarvisTool } from './tool-registry.js';
import { GMAIL_DIRECT_ACCESS_REASON } from './gmail-access-policy.js';
import type { ConversationHistoryMessage, ConversationStore } from './conversation-store.js';

const computerNames = [
  'pc_open', 'pc_close', 'pc_media', 'pc_active_window', 'pc_clipboard_read', 'pc_clipboard_write',
  'pc_browser_tabs', 'pc_browser_snapshot', 'pc_browser_act', 'pc_act',
  'browser_do', 'browser_do_shared', 'codex_prompt',
];
const signal = () => new AbortController().signal;
function computer(name: string, execute: JarvisTool['execute']): JarvisTool {
  return { name, description: name, inputSchema: { type: 'object' }, execute };
}
function hostedRequest(text: string) {
  const message: ConversationHistoryMessage = {
    id: '42', sessionId: '1', role: 'dan', text, model: null, at: new Date(),
    channel: 'chat', language: 'en', interrupted: false, voiceMinutes: null, toolCalls: [], attachments: [],
  };
  const getHistory = vi.fn<ConversationStore['getHistory']>(async () => ({ messages: [message], nextCursor: null }));
  const request = { headers: { 'x-jarvis-message-id': '42' }, agentPrincipal: { kind: 'jarvis-agent' },
    server: { conversationStore: { getHistory } } } as unknown as FastifyRequest;
  return { request, message, getHistory };
}

describe('Gmail source verification before computer dispatch', () => {
  it.each(computerNames)('refuses %s from the current hosted Gmail request when no mail integration exists', async (name) => {
    const execute = vi.fn(async () => ({}));
    const registry = createToolRegistry([{ id: 'computer', tools: computerNames.map((tool) => computer(tool, execute)) }]);
    const { request, getHistory } = hostedRequest('Find my hotel reservation in Gmail.');
    expect(registry.get('mail_search')).toBeUndefined();
    await expect(registry.get(name)!.execute({ target: 'app', value: 'Chrome', goal: 'Find the booking dates' }, request, signal()))
      .rejects.toThrow(GMAIL_DIRECT_ACCESS_REASON);
    expect(execute).not.toHaveBeenCalled();
    expect(getHistory).toHaveBeenCalledExactlyOnceWith({ limit: 1 });
  });

  it.each([
    'Read Gmail, then open Spotify.',
    'Find my hotel reservation in Gmail, then open Spotify.',
    'L\u00e6s Gmail, og \u00e5bn Spotify.',
  ])('preserves the separately requested app without a mail integration: %s', async (text) => {
    const execute = vi.fn(async () => ({ opened: true }));
    const registry = createToolRegistry([{ id: 'computer', tools: [
      computer('pc_open', execute), computer('pc_browser_snapshot', execute),
    ] }]);
    const { request } = hostedRequest(text);
    await expect(registry.get('pc_open')!.execute({ target: 'app', value: 'Spotify' }, request, signal()))
      .resolves.toEqual({ opened: true });
    await expect(registry.get('pc_browser_snapshot')!.execute({ tabId: 'opaque-tab' }, request, signal()))
      .rejects.toThrow(GMAIL_DIRECT_ACCESS_REASON);
    expect(execute).toHaveBeenCalledOnce();
  });

  it.each(['missing', 'stale', 'not-dan'] as const)('does not dispatch computer use for a %s hosted source', async (kind) => {
    const execute = vi.fn();
    const registry = createToolRegistry([{ id: 'computer', tools: [computer('pc_open', execute)] }]);
    const { request, message, getHistory } = hostedRequest('Open Chrome.');
    getHistory.mockResolvedValue({
      messages: kind === 'missing' ? [] : [{
        ...message, id: kind === 'stale' ? '43' : message.id, role: kind === 'not-dan' ? 'jarvis' : 'dan',
      }],
      nextCursor: null,
    });
    await expect(registry.get('pc_open')!.execute({ target: 'app', value: 'Chrome' }, request, signal()))
      .rejects.toThrow('The current Dan message could not be verified for computer use.');
    expect(execute).not.toHaveBeenCalled();
  });

  it('surfaces source lookup failure instead of dispatching computer use', async () => {
    const failure = new Error('Synthetic source-store failure');
    const execute = vi.fn();
    const registry = createToolRegistry([{ id: 'computer', tools: [computer('pc_open', execute)] }]);
    const { request, getHistory } = hostedRequest('Read Gmail.');
    getHistory.mockRejectedValue(failure);
    await expect(registry.get('pc_open')!.execute({ target: 'app', value: 'Chrome' }, request, signal())).rejects.toBe(failure);
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not dispatch after cancellation during source verification', async () => {
    const abort = new AbortController();
    const execute = vi.fn();
    const registry = createToolRegistry([{ id: 'computer', tools: [computer('pc_open', execute)] }]);
    const { request, message, getHistory } = hostedRequest('Open Spotify.');
    getHistory.mockImplementation(async () => {
      abort.abort();
      return { messages: [message], nextCursor: null };
    });
    await expect(registry.get('pc_open')!.execute({ target: 'app', value: 'Spotify' }, request, abort.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('resolves the verified voice source ID without requiring a duplicate message header', async () => {
    const execute = vi.fn();
    const registry = createToolRegistry([{ id: 'computer', tools: [computer('pc_open', execute)] }]);
    const { request, getHistory } = hostedRequest('Read Gmail.');
    delete request.headers['x-jarvis-message-id'];
    request.headers['x-jarvis-voice-item-id'] = 'fixture-voice-item';
    request.jarvisMemorySourceMessageId = '42';
    await expect(registry.get('pc_open')!.execute({ target: 'app', value: 'Chrome' }, request, signal()))
      .rejects.toThrow(GMAIL_DIRECT_ACCESS_REASON);
    expect(getHistory).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps later non-mail hosted requests available after refusing an unconfigured Gmail request', async () => {
    const execute = vi.fn(async () => ({ opened: true }));
    const registry = createToolRegistry([{ id: 'computer', tools: [computer('pc_open', execute)] }]);
    const { request, message, getHistory } = hostedRequest('Read Gmail.');
    await expect(registry.get('pc_open')!.execute({ target: 'app', value: 'Chrome' }, request, signal()))
      .rejects.toThrow(GMAIL_DIRECT_ACCESS_REASON);
    getHistory.mockResolvedValue({ messages: [{ ...message, id: '43', text: 'Open Spotify.' }], nextCursor: null });
    request.headers['x-jarvis-message-id'] = '43';
    await expect(registry.get('pc_open')!.execute({ target: 'app', value: 'Spotify' }, request, signal()))
      .resolves.toEqual({ opened: true });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('scopes the verified independent browser request to nested execution after failed mail', async () => {
    const execute = vi.fn(async () => ({}));
    const { request, getHistory } = hostedRequest('Read mail, then open Wikipedia.');
    const registry = createToolRegistry([{ id: 'fixture', tools: [
      computer('mail_search', async () => { throw new ToolFailure('Unavailable'); }),
      computer('browser_do', async (_input, req, abort) =>
        registry.get('pc_browser_snapshot')!.execute({ tabId: 'wiki' }, req, abort)),
      computer('pc_browser_snapshot', execute),
    ] }]);
    await expect(registry.get('mail_search')!.execute({}, request, signal())).rejects.toThrow('Unavailable');
    await registry.get('browser_do')!.execute({ goal: 'open Wikipedia' }, request, signal());
    expect(getHistory).toHaveBeenCalledOnce();
    await expect(registry.get('pc_browser_snapshot')!.execute({ tabId: 'opaque-tab' }, request, signal()))
      .rejects.toThrow(GMAIL_DIRECT_ACCESS_REASON);
    expect(execute).toHaveBeenCalledOnce();
  });
});
