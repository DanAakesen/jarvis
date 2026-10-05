import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFoundryInvocationConversationAgent,
  createFoundryInvocationsEndpoint,
  FOUNDRY_AGENT_SCOPE,
} from './chat-agent.js';

afterEach(() => { vi.unstubAllGlobals(); });
const projectEndpoint = 'https://resource.services.ai.azure.com/api/projects/jarvis';
const delegatedAuthorization = ['Bear', 'er'].join('') + ' delegated-token';
const input = { messageId: '42', text: 'Hello', language: 'en' as const };

function createAgent(fetcher: typeof fetch = fetch) {
  const getToken = vi.fn(async () => 'foundry-token');
  return {
    agent: createFoundryInvocationConversationAgent(
      projectEndpoint, 'jarvis', getToken, fetcher,
    ),
    getToken,
  };
}

function streamedResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
}

describe('Foundry Invocations chat agent', () => {
  it('builds the documented invocation endpoint', () => {
    expect(createFoundryInvocationsEndpoint(projectEndpoint, 'jarvis').toString()).toBe(
      'https://resource.services.ai.azure.com/api/projects/jarvis/agents/jarvis/endpoint/protocols/invocations?api-version=v1',
    );
    expect(() => createFoundryInvocationsEndpoint(projectEndpoint, '../other')).toThrow(
      'agent name is invalid',
    );
  });

  it('authenticates to Foundry and parses split text events', async () => {
    const fetch = vi.fn(async () => streamedResponse([
      'event: delta\ndata: {"text":"Hell',
      'o"}\n\nevent: delta\ndata: {"text":" Jarvis"}\n\n',
      'event: done\ndata: {}\n\n',
    ]));
    const { agent, getToken } = createAgent(fetch as typeof globalThis.fetch);
    const controller = new AbortController();
    const result: string[] = [];
    for await (const text of agent.stream(input, delegatedAuthorization, controller.signal)) {
      result.push(text);
    }

    expect(result).toEqual(['Hello', ' Jarvis']);
    expect(getToken).toHaveBeenCalledWith(FOUNDRY_AGENT_SCOPE, expect.any(AbortSignal));
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://resource.services.ai.azure.com/api/projects/jarvis/agents/jarvis/endpoint/protocols/invocations?api-version=v1'),
      expect.objectContaining({
      method: 'POST',
      redirect: 'error',
      signal: expect.any(AbortSignal),
      body: JSON.stringify({ ...input, delegatedAuthorization }),
      headers: expect.objectContaining({
        Authorization: ['Bear', 'er'].join('') + ' foundry-token',
        Accept: 'text/event-stream',
      }),
    }));
  });

  it('rejects non-stream and incomplete agent responses', async () => {
    const unavailable = createAgent(vi.fn(async () => new Response('{}', { status: 503 })));

    const unavailableChunks: string[] = [];
    await expect(async () => {
      for await (const chunk of unavailable.agent.stream(
        input, delegatedAuthorization, new AbortController().signal,
      )) {
        unavailableChunks.push(chunk);
      }
    }).rejects.toThrow('Chat agent unavailable');
    expect(unavailableChunks).toEqual([]);

    const partial = createAgent(vi.fn(async () => streamedResponse([
      'event: delta\ndata: {"text":"Partial"}\n\n',
    ])));
    const partialChunks: string[] = [];
    await expect(async () => {
      for await (const chunk of partial.agent.stream(
        input, delegatedAuthorization, new AbortController().signal,
      )) {
        partialChunks.push(chunk);
      }
    }).rejects.toThrow('ended unexpectedly');
    expect(partialChunks).toEqual(['Partial']);
  });
  it('does not expose errors sent by the hosted agent', async () => {
    const { agent } = createAgent(vi.fn(async () => streamedResponse([
      'event: error\ndata: {"error":"provider details"}\n\n',
    ])));

    const chunks: string[] = [];
    await expect(async () => {
      for await (const chunk of agent.stream(
        input,
        delegatedAuthorization,
        new AbortController().signal,
      )) {
        chunks.push(chunk);
      }
    }).rejects.toThrow('Chat agent failed');
    expect(chunks).toEqual([]);
  });

  it('rejects a missing Foundry token before making a request', async () => {
    const fetch = vi.fn();
    const agent = createFoundryInvocationConversationAgent(
      projectEndpoint,
      'jarvis',
      async () => '',
      fetch as typeof globalThis.fetch,
    );
    await expect(async () => {
      for await (const _chunk of agent.stream(input, delegatedAuthorization, new AbortController().signal)) {
        expect(_chunk).toBeUndefined();
      }
    }).rejects.toThrow('Foundry authentication unavailable');
    expect(fetch).not.toHaveBeenCalled();
  });
});
