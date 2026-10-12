import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChatAgentError,
  createFoundryAgentSessionId,
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

function streamedResponse(chunks: string[], headers: HeadersInit = { 'content-type': 'text/event-stream' }) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { headers });
}

describe('Foundry Invocations chat agent', () => {
  it('accepts a description-free handle and keeps deferred caption evidence internal and bounded', async () => {
    const onVisualResult = vi.fn();
    const visualContext = { source: 'camera' as const, capturedAt: '2026-10-11T19:30:00Z', frameId: 'a'.repeat(32) };
    const fetcher = vi.fn<typeof fetch>(async () => streamedResponse([
      'event: delta\ndata: {"text":"A red mug."}\n\n',
      'event: done\ndata: {"visualPath":"caption","visualReason":"image_rejected","description":" A real red mug. ","captionMs":25}\n\n',
    ]));
    const { agent } = createAgent(fetcher);
    for await (const chunk of agent.stream({ ...input, sessionId: '41', visualContext, onVisualResult },
      delegatedAuthorization, new AbortController().signal)) { expect(chunk).toBe('A red mug.'); }
    expect(onVisualResult).toHaveBeenCalledWith({ visualPath: 'caption', visualReason: 'image_rejected',
      description: 'A real red mug.', captionMs: 25 });
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).visualContext).toEqual(visualContext);
  });

  it.each([
    { description: ' ', captionMs: -1 },
    { description: 'x'.repeat(5_001), captionMs: 600_001 },
    { description: 12, captionMs: '25' },
  ])('drops invalid deferred caption metadata %#', async (metadata) => {
    const onVisualResult = vi.fn();
    const { agent } = createAgent(vi.fn(async () => streamedResponse([
      `event: done\ndata: ${JSON.stringify({ visualPath: 'caption', ...metadata })}\n\n`,
    ])));
    for await (const chunk of agent.stream({ ...input, onVisualResult },
      delegatedAuthorization, new AbortController().signal)) { expect(chunk).toBeUndefined(); }
    expect(onVisualResult).toHaveBeenCalledWith({ visualPath: 'caption' });
  });

  it('forwards only a private handle and reports bounded final visual metadata', async () => {
    const onVisualResult = vi.fn();
    const visualContext = { source: 'screen' as const, capturedAt: '2026-10-11T19:30:00Z',
      description: 'A chart.', frameId: 'a'.repeat(32) };
    const fetcher = vi.fn<typeof fetch>(async () => streamedResponse([
      'event: delta\ndata: {"text":"A chart"}\n\n',
      'event: done\ndata: {"visualPath":"image","visualReason":"image_attached","model":"gpt-6-luna","inputTokens":100,"outputTokens":20}\n\n',
    ]));
    const { agent } = createAgent(fetcher);
    for await (const chunk of agent.stream({ ...input, sessionId: '41', visualContext, onVisualResult },
      delegatedAuthorization, new AbortController().signal)) { expect(chunk).toBe('A chart'); }
    expect(onVisualResult).toHaveBeenCalledWith({ visualPath: 'image', visualReason: 'image_attached',
      model: 'gpt-6-luna', inputTokens: 100, outputTokens: 20 });
    const body = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
    expect(body.visualContext).toEqual(visualContext);
    expect(body).not.toHaveProperty('onVisualResult');
    expect(body).not.toHaveProperty('image');
  });
  it.each([true, -1, 10_000_001, 1.5, '100', null])('drops invalid usage metadata %s', async (value) => {
    const onVisualResult = vi.fn();
    const { agent } = createAgent(vi.fn(async () => streamedResponse([
      `event: done\ndata: ${JSON.stringify({ visualPath: 'image',
        inputTokens: value, outputTokens: value, model: 'bad\nmodel' })}\n\n`,
    ])));
    for await (const chunk of agent.stream({ ...input, onVisualResult },
      delegatedAuthorization, new AbortController().signal)) { expect(chunk).toBeUndefined(); }
    expect(onVisualResult).toHaveBeenCalledWith({ visualPath: 'image' });
  });
  it('builds the documented invocation endpoint', () => {
    expect(createFoundryInvocationsEndpoint(projectEndpoint, 'jarvis').toString()).toBe(
      'https://resource.services.ai.azure.com/api/projects/jarvis/agents/jarvis/endpoint/protocols/invocations?api-version=v1',
    );
    expect(() => createFoundryInvocationsEndpoint(projectEndpoint, '../other')).toThrow(
      'agent name is invalid',
    );
    expect(() => createFoundryInvocationsEndpoint(projectEndpoint, 'jarvis', 'private-text')).toThrow(
      'session ID is invalid',
    );
  });

  it('derives a stable UUID session ID scoped to the owner and conversation', () => {
    const owner = '12bcfab7-49ba-4cf7-8be7-780a13911f93';
    const session = createFoundryAgentSessionId(owner, '41');
    expect(session).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(createFoundryAgentSessionId(owner.toUpperCase(), '41')).toBe(session);
    expect(createFoundryAgentSessionId(owner, '42')).not.toBe(session);
    expect(createFoundryAgentSessionId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '41')).not.toBe(session);
    expect(() => createFoundryAgentSessionId('not-an-owner-id', '41')).toThrow('identity is invalid');
    expect(() => createFoundryAgentSessionId(owner, '../message-text')).toThrow('identity is invalid');
  });

  it('uses session affinity, requests debug timings, and accepts only bounded agent phases', async () => {
    const onAgentPhaseTimings = vi.fn();
    const onAgentSessionTelemetry = vi.fn();
    const agentSessionId = createFoundryAgentSessionId(
      '12bcfab7-49ba-4cf7-8be7-780a13911f93', '41',
    );
    const fetcher = vi.fn<typeof fetch>(async () => streamedResponse([
      'event: done\ndata: {"agentTimings":{"chat_history_verification":25.5,"model_first_delta":600001,"unknown":7,"prompt_build":"4"}}\n\n',
    ], {
      'content-type': 'text/event-stream',
      'x-ms-debug-latency-session-start-type': 'warm',
      'x-ms-debug-latency-platform': '120',
      'x-ms-debug-latency-provisioning': '600001',
      'x-ms-debug-latency-container': '-1',
      'x-ms-debug-latency-agent': '12.5',
      'x-ms-debug-latency-other': '99',
    }));
    const { agent } = createAgent(fetcher);
    for await (const chunk of agent.stream({
      ...input, agentSessionId, onAgentPhaseTimings, onAgentSessionTelemetry,
    }, delegatedAuthorization, new AbortController().signal)) { void chunk; }

    const [url, options] = fetcher.mock.calls[0]!;
    expect((url as URL).searchParams.get('agent_session_id')).toBe(agentSessionId);
    expect(options?.headers).toMatchObject({ 'x-ms-debug-latency-enabled': 'true' });
    const body = JSON.parse(options?.body as string);
    expect(body).not.toHaveProperty('agentSessionId');
    expect(body).not.toHaveProperty('onAgentPhaseTimings');
    expect(body).not.toHaveProperty('onAgentSessionTelemetry');
    expect(onAgentPhaseTimings).toHaveBeenCalledWith({ chat_history_verification: 25.5 });
    expect(onAgentSessionTelemetry).toHaveBeenCalledWith({
      sessionIdUsed: true, sessionStartType: 'warm', platformMs: 120, agentMs: 12.5,
    });
    expect(JSON.stringify(onAgentSessionTelemetry.mock.calls)).not.toContain('other');
  });

  it('retries one rejected session-affine invocation once without affinity', async () => {
    const agentSessionId = createFoundryAgentSessionId(
      '12bcfab7-49ba-4cf7-8be7-780a13911f93', '41',
    );
    const onAgentSessionTelemetry = vi.fn();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('private provider details', { status: 400 }))
      .mockResolvedValueOnce(streamedResponse([
        'event: delta\ndata: {"text":"Hello"}\n\n',
        'event: done\ndata: {}\n\n',
      ], {
        'content-type': 'text/event-stream',
        'x-ms-debug-latency-session-start-type': 'cold',
        'x-ms-debug-latency-container': '450',
      }));
    const { agent } = createAgent(fetcher);
    const chunks: string[] = [];
    for await (const chunk of agent.stream({
      ...input, agentSessionId, onAgentSessionTelemetry,
    }, delegatedAuthorization, new AbortController().signal)) chunks.push(chunk);

    expect(chunks).toEqual(['Hello']);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((fetcher.mock.calls[0]![0] as URL).searchParams.has('agent_session_id')).toBe(true);
    expect((fetcher.mock.calls[1]![0] as URL).searchParams.has('agent_session_id')).toBe(false);
    expect(fetcher.mock.calls.every(([, options]) =>
      (options?.headers as Record<string, string>)['x-ms-debug-latency-enabled'] === 'true')).toBe(true);
    expect(onAgentSessionTelemetry.mock.calls).toEqual([
      [{ sessionIdUsed: true, fallbackReason: 'http_400' }],
      [{ sessionIdUsed: false, sessionStartType: 'cold', containerMs: 450 }],
    ]);
    expect(JSON.stringify(onAgentSessionTelemetry.mock.calls)).not.toContain('private provider details');
  });

  it('does not retry an invocation that had no session ID', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('private provider details', { status: 400 }));
    const { agent } = createAgent(fetcher);
    await expect(async () => {
      for await (const _chunk of agent.stream(input, delegatedAuthorization, new AbortController().signal)) {
        expect(_chunk).toBeUndefined();
      }
    }).rejects.toThrow('Chat agent unavailable');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((fetcher.mock.calls[0]![0] as URL).searchParams.has('agent_session_id')).toBe(false);
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

  it('yields the first delta without waiting for done or the upstream connection to close', async () => {
    const encoder = new TextEncoder();
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    const fetcher = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        upstream = controller;
        controller.enqueue(encoder.encode(': connected\n\nevent: delta\ndata: {"text":"Hi"}\n\n'));
      },
      cancel,
    }), { headers: { 'content-type': 'text/event-stream' } }));
    const { agent } = createAgent(fetcher);
    const iterator = agent.stream(input, delegatedAuthorization, new AbortController().signal)[Symbol.asyncIterator]();
    try {
      await expect(iterator.next()).resolves.toEqual({ value: 'Hi', done: false });
      expect(cancel).not.toHaveBeenCalled();
      upstream.enqueue(encoder.encode('event: delta\ndata: {"text":" there"}\n\n'));
      await expect(iterator.next()).resolves.toEqual({ value: ' there', done: false });
    } finally {
      await iterator.return?.();
    }
    expect(cancel).toHaveBeenCalledOnce();
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

  it('surfaces only a short diagnostic code from an agent error', async () => {
    const run = async (data: string) => {
      const { agent } = createAgent(vi.fn(async () => streamedResponse([`event: error\ndata: ${data}\n\n`])));
      try {
        for await (const chunk of agent.stream(input, delegatedAuthorization, new AbortController().signal)) {
          void chunk;
        }
      } catch (error) { return error; }
      return undefined;
    };

    const coded = await run('{"code":"capability_instructions_too_large"}');
    expect(coded).toBeInstanceOf(ChatAgentError);
    expect(coded).toMatchObject({ code: 'capability_instructions_too_large' });
    expect((coded as Error).message).toBe('Chat agent failed (capability_instructions_too_large)');

    for (const unsafe of ['{"code":"Provider: secret key!"}', '{"error":"provider details"}', '{}', 'not json']) {
      const error = await run(unsafe) as ChatAgentError;
      expect(error).toBeInstanceOf(ChatAgentError);
      expect(error.code).toBeUndefined();
      expect(error.message).toBe('Chat agent failed');
    }
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
