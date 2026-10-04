import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createChatSession,
  loadConversationHistory,
  sendChatTurn,
} from './conversation-history';

const config = { ...__JARVIS_CONFIG__, backendUrl: 'https://api.example.com/' };
const account = { homeAccountId: 'account' };
const history = {
  messages: [{
    id: '42',
    sessionId: '41',
    channel: 'chat',
    language: 'en',
    role: 'jarvis',
    text: 'That action was refused.',
    model: null,
    at: '2026-10-03T12:00:00.000Z',
    toolCalls: [{ id: '90', tool: 'factory_create_task', outcome: 'refused', taskId: null }],
  }],
  nextCursor: null,
};

function createClient(overrides: Record<string, unknown> = {}) {
  return {
    getActiveAccount: vi.fn(() => account),
    getAllAccounts: vi.fn(() => [account]),
    acquireTokenSilent: vi.fn(async () => ({ accessToken: 'test-token' })),
    ...overrides,
  };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('loadConversationHistory', () => {
  it('requests the bounded page with a bearer token and cursor', async () => {
    const client = createClient();
    let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      request = { input, ...(init === undefined ? {} : { init }) };
      return new Response(JSON.stringify(history), { status: 200 });
    });

    describe('chat turn API', () => {
      it('creates a session and reads streamed user and assistant messages', async () => {
        const client = createClient();
        const userMessage = {
          id: '51',
          sessionId: '41',
          role: 'dan',
          text: 'Hello',
          model: null,
          at: '2026-10-03T12:00:00.000Z',
        };
        const assistantMessage = {
          ...userMessage,
          id: '52',
          role: 'jarvis',
          text: 'Hello, Dan.',
        };
        const encoder = new TextEncoder();
        const streamText = [
          `event: user\ndata: ${JSON.stringify(userMessage)}\n\n`,
          'event: delta\ndata: {"text":"Hello, "}\n\n',
          `event: done\ndata: ${JSON.stringify(assistantMessage)}\n\n`,
        ].join('');
        const bytes = encoder.encode(streamText);
        const fetch = vi.fn()
          .mockResolvedValueOnce(new Response(JSON.stringify({
            id: '41', channel: 'chat', language: 'en',
          }), { status: 201 }))
          .mockResolvedValueOnce(new Response(new ReadableStream({
            start(controller) {
              controller.enqueue(bytes.slice(0, 31));
              controller.enqueue(bytes.slice(31));
              controller.close();
            },
          }), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
        vi.stubGlobal('fetch', fetch);

        const session = await createChatSession(client as never, config, 'en');
        const onUserMessage = vi.fn();
        const onDelta = vi.fn();
        const reply = await sendChatTurn(
          client as never,
          config,
          session,
          'Hello',
          onUserMessage,
          onDelta,
        );

        expect(session).toEqual({ id: '41', language: 'en' });
        expect(onUserMessage).toHaveBeenCalledWith(userMessage);
        expect(onDelta).toHaveBeenCalledWith('Hello, ');
        expect(reply).toEqual(assistantMessage);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(String(fetch.mock.calls[1]?.[0])).toContain('/conversation/sessions/41/turns');
      });

      it('shows the backend refusal and does not retry a failed turn', async () => {
        const client = createClient();
        const fetch = vi.fn(async () => new Response(
          JSON.stringify({ error: 'Chat is unavailable until the Jarvis agent is configured' }),
          { status: 503 },
        ));
        vi.stubGlobal('fetch', fetch);

        await expect(createChatSession(client as never, config, 'da'))
          .rejects.toThrow('Chat is unavailable until the Jarvis agent is configured');
        expect(fetch).toHaveBeenCalledOnce();
      });
    });
    vi.stubGlobal('fetch', fetch);

    await expect(loadConversationHistory(client as never, config, '42')).resolves.toEqual(history);

    const url = new URL(String(request?.input));
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.get('before')).toBe('42');
    const authorization = (request?.init?.headers as Record<string, string>).Authorization;
    expect(authorization?.startsWith(['Bear', 'er'].join(' '))).toBe(true);
    expect(client.acquireTokenSilent).toHaveBeenCalledWith({ scopes: [config.apiScope], account });
  });

  it('fails closed if no sign-in account is available', async () => {
    const client = createClient({ getActiveAccount: vi.fn(() => null), getAllAccounts: vi.fn(() => []) });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(loadConversationHistory(client as never, config)).rejects.toThrow(/sign-in needs attention/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not accept malformed API data or expose authorization errors as history', async () => {
    const client = createClient();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ messages: 'invalid' }), { status: 200 })));
    await expect(loadConversationHistory(client as never, config)).rejects.toThrow(/invalid conversation history/);

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    await expect(loadConversationHistory(client as never, config)).rejects.toThrow(/could not verify/);
  });
});
