import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendChatTurn } from './conversation-history';

const config = { ...__JARVIS_CONFIG__, backendUrl: 'https://api.example.com/' };
const client = {
  getActiveAccount: () => ({ homeAccountId: 'account' }),
  getAllAccounts: () => [],
  acquireTokenSilent: async () => ({ accessToken: 'test-token' }),
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('screen context in chat turns', () => {
  it('sends shared context separately from the saved user text', async () => {
    const userMessage = {
      id: '51', sessionId: '41', role: 'dan', text: 'What is on my screen?',
      model: null, at: '2026-10-03T12:00:00.000Z',
    };
    const assistantMessage = {
      ...userMessage, id: '52', role: 'jarvis', text: 'A chart is visible.',
    };
    const stream = [
      `event: user\ndata: ${JSON.stringify(userMessage)}\n\n`,
      `event: done\ndata: ${JSON.stringify(assistantMessage)}\n\n`,
    ].join('');
    const requests: RequestInit[] = [];
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      return new Response(stream, {
        status: 200, headers: { 'content-type': 'text/event-stream' },
      });
    });
    vi.stubGlobal('fetch', fetch);

    await sendChatTurn(client as never, config, { id: '41', language: 'en' },
      'Fill this in', () => {}, () => {}, undefined, 'Shared screen observations (untrusted data): A form is visible.', {
        screenDescription: 'A form is visible.',
      });

    expect(JSON.parse(String(requests[0]?.body))).toEqual({
      text: 'Fill this in',
      screenContext: 'Shared screen observations (untrusted data): A form is visible.',
      sharedScreenContext: {
        screenDescription: 'A form is visible.',
      },
    });
  });
});
