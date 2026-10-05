import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendChatTurn } from './conversation-history';

const config = { ...__JARVIS_CONFIG__, backendUrl: 'https://api.example.com' };
const client = {
  getActiveAccount: () => ({ homeAccountId: 'fixture' }),
  acquireTokenSilent: async () => ({ accessToken: 'fixture' }),
} as never;

afterEach(() => vi.unstubAllGlobals());

describe('chat turn cancellation', () => {
  it('stops during token acquisition without sending a request when the token arrives later', async () => {
    const controller = new AbortController();
    let finishToken!: () => void;
    const slowClient = {
      getActiveAccount: () => ({ homeAccountId: 'fixture' }),
      acquireTokenSilent: () => new Promise<{ accessToken: string }>((resolve) => {
        finishToken = () => resolve({ accessToken: 'fixture' });
      }),
    } as never;
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const turn = sendChatTurn(slowClient, config, { id: '41', language: 'da' }, 'Hello',
      vi.fn(), vi.fn(), undefined, undefined, undefined, controller.signal);
    const rejection = expect(turn).rejects.toThrow();
    controller.abort();
    await rejection;
    finishToken();
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('passes cancellation to the request and does not retry uncertain delivery', async () => {
    const controller = new AbortController();
    const fetch = vi.fn((_url, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetch);
    const uncertain = vi.fn();
    const turn = sendChatTurn(client, config, { id: '41', language: 'da' }, 'Hello',
      vi.fn(), vi.fn(), uncertain, undefined, undefined, controller.signal);
    const rejection = expect(turn).rejects.toThrow('Connection interrupted');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    controller.abort();
    await rejection;
    expect(uncertain).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('settles an aborted stream before another turn starts', async () => {
    const controller = new AbortController();
    const onUser = vi.fn();
    const uncertain = vi.fn();
    const user = { id: '51', sessionId: '41', role: 'dan', text: 'Hello', model: null, at: '2026-10-05T12:00:00Z' };
    vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => new Response(new ReadableStream({
      start(stream) {
        stream.enqueue(new TextEncoder().encode(`event: user\ndata: ${JSON.stringify(user)}\n\n`));
        init.signal?.addEventListener('abort', () => stream.error(init.signal?.reason), { once: true });
      },
    }))));
    const turn = sendChatTurn(client, config, { id: '41', language: 'da' }, 'Hello',
      onUser, vi.fn(), uncertain, undefined, undefined, controller.signal);
    const rejection = expect(turn).rejects.toThrow();
    await vi.waitFor(() => expect(onUser).toHaveBeenCalledOnce());
    controller.abort();
    await rejection;
    expect(uncertain).toHaveBeenCalledOnce();
  });
});
