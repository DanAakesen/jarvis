import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpConversationAgent } from './chat-agent.js';

afterEach(() => { vi.unstubAllGlobals(); });

function streamedResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
}

describe('HTTP chat agent', () => {
  it('forwards the authenticated message and parses split text events', async () => {
    const fetch = vi.fn(async () => streamedResponse([
      'event: delta\ndata: {"text":"Hell',
      'o"}\n\nevent: delta\ndata: {"text":" Jarvis"}\n\n',
      'event: done\ndata: {}\n\n',
    ]));
    vi.stubGlobal('fetch', fetch);
    const agent = createHttpConversationAgent('https://agent.example/chat');
    const controller = new AbortController();
    const result: string[] = [];
    for await (const text of agent.stream({
      messageId: '42',
      text: 'Hello',
      language: 'en',
    }, ['Bear', 'er'].join(' ') + ' delegated-token', controller.signal)) {
      result.push(text);
    }

    expect(result).toEqual(['Hello', ' Jarvis']);
    expect(fetch).toHaveBeenCalledWith(new URL('https://agent.example/chat'), expect.objectContaining({
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      body: JSON.stringify({ messageId: '42', text: 'Hello', language: 'en' }),
      headers: expect.objectContaining({
        Authorization: ['Bear', 'er'].join(' ') + ' delegated-token',
        Accept: 'text/event-stream',
      }),
    }));
  });

  it('rejects non-stream and incomplete agent responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    const agent = createHttpConversationAgent('https://agent.example/chat');
    const input = { messageId: '42', text: 'Hello', language: 'en' as const };

    await expect(async () => {
      for await (const _chunk of agent.stream(input, 'authorization', new AbortController().signal)) {}
    }).rejects.toThrow('Chat agent unavailable');

    vi.stubGlobal('fetch', vi.fn(async () => streamedResponse([
      'event: delta\ndata: {"text":"Partial"}\n\n',
    ])));
    await expect(async () => {
      for await (const _chunk of agent.stream(input, 'authorization', new AbortController().signal)) {}
    }).rejects.toThrow('ended unexpectedly');
  });

  it('does not expose errors sent by the hosted agent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamedResponse([
      'event: error\ndata: {"error":"provider details"}\n\n',
    ])));
    const agent = createHttpConversationAgent('https://agent.example/chat');

    await expect(async () => {
      for await (const _chunk of agent.stream(
        { messageId: '42', text: 'Hello', language: 'en' },
        'authorization',
        new AbortController().signal,
      )) {}
    }).rejects.toThrow('Chat agent failed');
  });
});
