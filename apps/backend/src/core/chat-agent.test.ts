import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChatAgentError,
  ChatAgentInvocationError,
  type ChatAgentInvocationReason,
  type ConversationAgent,
  createFoundryAgentSessionId,
  createFoundryInvocationConversationAgent,
  createFoundryInvocationsEndpoint,
  FOUNDRY_AGENT_SCOPE,
} from './chat-agent.js';
import { chatAgentInvocationReasons } from '../system-status.js';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
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
  it.each(['45', new Date(Date.now() + 45_000).toUTCString(), 'private-invalid'])(
    'reads a valid Retry-After response hint without copying the header: %s', async (retryAfter) => {
      const { agent } = createAgent(vi.fn(async () => streamedResponse([
        'event: error\ndata: {"code":"rate_limit_exceeded"}\n\n',
      ], { 'content-type': 'text/event-stream', 'retry-after': retryAfter })));
      let error: unknown;
      try {
        for await (const chunk of agent.stream(input, delegatedAuthorization, new AbortController().signal)) {
          expect(chunk).toBeUndefined();
        }
      } catch (caught) { error = caught; }
      expect(error).toBeInstanceOf(ChatAgentError);
      if (retryAfter === 'private-invalid') expect((error as ChatAgentError).retryAfterMs).toBeUndefined();
      else expect((error as ChatAgentError).retryAfterMs).toBeGreaterThan(30_000);
    },
  );
  it.each([
    [45, 45_000], [0, 0], [-1, undefined], ['private', undefined], [null, undefined],
  ])('retains only numeric nonnegative retry metadata: %s', async (retryAfter, expected) => {
    const { agent } = createAgent(vi.fn(async () => streamedResponse([
      `event: error\ndata: ${JSON.stringify({
        code: 'rate_limit_exceeded', retry_after: retryAfter, message: 'never-retain',
      })}\n\n`,
    ])));
    const consume = async () => {
      for await (const chunk of agent.stream(input, delegatedAuthorization, new AbortController().signal)) {
        expect(chunk).toBeUndefined();
      }
    };
    await expect(consume()).rejects.toMatchObject({
      name: 'ChatAgentError', code: 'rate_limit_exceeded', retryAfterMs: expected,
      message: 'Chat agent failed (rate_limit_exceeded)',
    });
  });
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

  it('preserves the acknowledgment boundary after its streamed text', async () => {
    const acknowledgment = "I'll compare your saved targets.";
    const { agent } = createAgent(vi.fn(async () => streamedResponse([
      `event: delta\ndata: ${JSON.stringify({ text: acknowledgment })}\n\n`,
      `event: acknowledgment\ndata: ${JSON.stringify({ text: acknowledgment })}\n\n`,
      'event: delta\ndata: {"text":"The targets match."}\n\n',
      'event: done\ndata: {}\n\n',
    ])));
    const chunks = [];

    for await (const chunk of agent.stream(input, delegatedAuthorization, new AbortController().signal)) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      acknowledgment,
      { type: 'acknowledgment', text: acknowledgment },
      'The targets match.',
    ]);
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

  it('reuses a random 32-hex session ID scoped to the owner and conversation', () => {
    const owner = '12bcfab7-49ba-4cf7-8be7-780a13911f93';
    const session = createFoundryAgentSessionId(owner, '41');
    expect(session).toMatch(/^[0-9a-f]{32}$/u);
    expect(createFoundryAgentSessionId(owner.toUpperCase(), '41')).toBe(session);
    expect(createFoundryAgentSessionId(owner, '42')).not.toBe(session);
    expect(createFoundryAgentSessionId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '41')).not.toBe(session);
    expect(() => createFoundryAgentSessionId('not-an-owner-id', '41')).toThrow('identity is invalid');
    expect(() => createFoundryAgentSessionId(owner, '../message-text')).toThrow('identity is invalid');
  });

  it('bounds session affinity to the 256 most recently used conversations', () => {
    const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const evicted = createFoundryAgentSessionId(owner, '1000');
    const retained = createFoundryAgentSessionId(owner, '1001');
    for (let id = 1002; id < 1256; id++) createFoundryAgentSessionId(owner, String(id));
    expect(createFoundryAgentSessionId(owner, '1001')).toBe(retained);
    createFoundryAgentSessionId(owner, '1256');
    expect(createFoundryAgentSessionId(owner, '1001')).toBe(retained);
    expect(createFoundryAgentSessionId(owner, '1000')).not.toBe(evicted);
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
    expect(onAgentPhaseTimings).toHaveBeenCalledWith({
      chat_history_verification: 25.5, agent_auth: expect.any(Number),
    });
    expect(onAgentSessionTelemetry).toHaveBeenCalledWith({
      sessionIdUsed: true, sessionStartType: 'warm', platformMs: 120, agentMs: 12.5,
    });
    expect(JSON.stringify(onAgentSessionTelemetry.mock.calls)).not.toContain('other');
  });

  it.each([400, 401, 403, 404, 408, 429, 500])('never replays HTTP %s which may follow execution', async (status) => {
    const agentSessionId = createFoundryAgentSessionId(
      '12bcfab7-49ba-4cf7-8be7-780a13911f93', '41',
    );
    const onAgentSessionTelemetry = vi.fn();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('private provider details', { status }))
      .mockResolvedValueOnce(streamedResponse([
        'event: delta\ndata: {"text":"Hello"}\n\n',
        'event: done\ndata: {}\n\n',
      ], {
        'content-type': 'text/event-stream',
        'x-ms-debug-latency-session-start-type': 'cold',
        'x-ms-debug-latency-container': '450',
      }));
    const { agent } = createAgent(fetcher);
    await expect(async () => {
      for await (const chunk of agent.stream({
        ...input, agentSessionId, onAgentSessionTelemetry,
      }, delegatedAuthorization, new AbortController().signal)) { void chunk; }
    }).rejects.toThrow(`Chat agent unavailable (HTTP ${status})`);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((fetcher.mock.calls[0]![0] as URL).searchParams.has('agent_session_id')).toBe(true);
    expect(fetcher.mock.calls.every(([, options]) =>
      (options?.headers as Record<string, string>)['x-ms-debug-latency-enabled'] === 'true')).toBe(true);
    expect(onAgentSessionTelemetry.mock.calls).toEqual([
      [{ sessionIdUsed: true }],
    ]);
    expect(JSON.stringify(onAgentSessionTelemetry.mock.calls)).not.toContain('private provider details');
  });

  it('separates token authentication, hosted dispatch/transport and agent elapsed time', async () => {
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(1000).mockReturnValueOnce(1050)
      .mockReturnValueOnce(1050).mockReturnValueOnce(15450);
    const onAgentPhaseTimings = vi.fn();
    const { agent } = createAgent(vi.fn(async () => streamedResponse([
      'event: delta\ndata: {"text":"Hello"}\n\n',
      'event: done\ndata: {"agentTimings":{"agent_first_delta":4400,"agent_pre_model":400,"model_to_first_delta":4000,"agent_auth":999,"session_start":999}}\n\n',
    ])));
    for await (const chunk of agent.stream({ ...input, onAgentPhaseTimings },
      delegatedAuthorization, new AbortController().signal)) { void chunk; }
    expect(onAgentPhaseTimings).toHaveBeenCalledWith({
      agent_first_delta: 4400, agent_pre_model: 400, model_to_first_delta: 4000,
      agent_auth: 50, session_start: 10000,
    });
  });

  it('does not manufacture a negative session-start residual or accept one from the agent', async () => {
    const onAgentPhaseTimings = vi.fn();
    const { agent } = createAgent(vi.fn(async () => streamedResponse([
      'event: delta\ndata: {"text":"Hello"}\n\n',
      'event: done\ndata: {"agentTimings":{"agent_first_delta":600000,"session_start":999}}\n\n',
    ])));
    for await (const chunk of agent.stream({ ...input, onAgentPhaseTimings },
      delegatedAuthorization, new AbortController().signal)) { void chunk; }
    expect(onAgentPhaseTimings).toHaveBeenCalledWith({
      agent_first_delta: 600000, agent_auth: expect.any(Number),
    });
  });
  it('accepts bounded optional model maxima without requiring them from older agents', async () => {
    const onAgentPhaseTimings = vi.fn();
    const { agent } = createAgent(vi.fn(async () => streamedResponse([
      'event: done\ndata: {"agentTimings":{"model_request":1000,"model_request_max":20000,"model_auth_max":7000,"private-content":99}}\n\n',
    ])));
    for await (const chunk of agent.stream({ ...input, onAgentPhaseTimings },
      delegatedAuthorization, new AbortController().signal)) { void chunk; }
    expect(onAgentPhaseTimings).toHaveBeenCalledExactlyOnceWith({
      model_request: 1000, model_request_max: 20000, model_auth_max: 7000,
      agent_auth: expect.any(Number),
    });
    expect(JSON.stringify(onAgentPhaseTimings.mock.calls)).not.toContain('private-content');
  });

  it.each([-1, 600001, '4', null, {}, true])('rejects invalid optional maxima %j', async (duration) => {
    const onAgentPhaseTimings = vi.fn();
    const { agent } = createAgent(vi.fn(async () => streamedResponse([
      `event: done\ndata: ${JSON.stringify({ agentTimings: {
        model_request: 2, model_auth_max: duration, model_request_max: duration,
      } })}\n\n`,
    ])));
    for await (const chunk of agent.stream({ ...input, onAgentPhaseTimings },
      delegatedAuthorization, new AbortController().signal)) { void chunk; }
    expect(onAgentPhaseTimings).toHaveBeenCalledExactlyOnceWith({
      model_request: 2, agent_auth: expect.any(Number),
    });
  });

  it('rejects nonfinite maxima and accepts the duration bounds', async () => {
    const onAgentPhaseTimings = vi.fn();
    const { agent } = createAgent(vi.fn(async () => streamedResponse([
      'event: done\ndata: {"agentTimings":{"model_request_max":1e999,"model_auth_max":600000,"model_request":0}}\n\n',
    ])));
    for await (const chunk of agent.stream({ ...input, onAgentPhaseTimings },
      delegatedAuthorization, new AbortController().signal)) { void chunk; }
    expect(onAgentPhaseTimings).toHaveBeenCalledExactlyOnceWith({
      model_request: 0, model_auth_max: 600000, agent_auth: expect.any(Number),
    });
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

  it('sends smoke turns through Foundry without a delegated user token', async () => {
    const fetcher = vi.fn(async () => streamedResponse([
      'event: delta\ndata: {"text":"ok"}\n\n',
      'event: done\ndata: {}\n\n',
    ]));
    const { agent } = createAgent(fetcher);
    const chunks: string[] = [];
    for await (const chunk of agent.stream({
      ...input, messageId: '1', text: 'Reply with the single word ok.', smoke: true,
    }, '', new AbortController().signal)) chunks.push(chunk);

    expect(chunks).toEqual(['ok']);
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({
      messageId: '1', text: 'Reply with the single word ok.', language: 'en', smoke: true,
    });
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

  it.each([false, true])('settles terminal metadata and cancels an open upstream body (smoke=%s)', async (smoke) => {
    const encoder = new TextEncoder();
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    let doneSeen!: () => void;
    const terminal = new Promise<void>((resolve) => { doneSeen = resolve; });
    const cancel = vi.fn();
    const onVisualResult = vi.fn();
    const onAgentPhaseTimings = vi.fn();
    const calls = [{ name: 'list_capabilities', outcome: 'ok', capabilities: ['Notes', 'Calendar', 'GitHub'] }];
    const onAgentToolCalls = vi.fn(() => { doneSeen(); });
    const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        upstream = controller;
        controller.enqueue(encoder.encode('event: delta\ndata: {"text":"Complete reply"}\n\n'));
        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({
          smokeToolCalls: calls, agentTimings: { model_request: 2 },
          visualPath: 'image', model: 'gpt-6-luna', inputTokens: 10, outputTokens: 3,
        })}\n\n`));
      },
      cancel,
    }), { headers: { 'content-type': 'text/event-stream' } }));
    const { agent } = createAgent(fetcher);
    const iterator = agent.stream({
      ...input, smoke, onVisualResult, onAgentPhaseTimings, onAgentToolCalls,
    }, delegatedAuthorization, new AbortController().signal)[Symbol.asyncIterator]();
    let completion: ReturnType<typeof iterator.next> | undefined;
    try {
      await expect(iterator.next()).resolves.toEqual({ value: 'Complete reply', done: false });
      completion = iterator.next();
      await terminal;
      expect(cancel).toHaveBeenCalledOnce();
      await expect(completion).resolves.toEqual({ value: undefined, done: true });
      expect(onAgentToolCalls).toHaveBeenCalledExactlyOnceWith(calls);
      expect(onAgentPhaseTimings).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ model_request: 2 }));
      expect(onVisualResult).toHaveBeenCalledExactlyOnceWith({
        visualPath: 'image', model: 'gpt-6-luna', inputTokens: 10, outputTokens: 3,
      });
      expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string))
        .toHaveProperty(smoke ? 'smoke' : 'delegatedAuthorization', smoke ? true : delegatedAuthorization);
    } finally {
      if (!cancel.mock.calls.length) upstream.close();
      await completion;
      await iterator.return?.();
    }
  });

  it('recognizes a split done frame without requiring socket EOF', async () => {
    const encoder = new TextEncoder();
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    let doneSeen!: () => void;
    const terminal = new Promise<void>((resolve) => { doneSeen = resolve; });
    const cancel = vi.fn();
    const { agent } = createAgent(vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        upstream = controller;
        for (const chunk of ['event: do', 'ne\ndata: {"smokeTool', 'Calls":[]}\n', '\n']) {
          controller.enqueue(encoder.encode(chunk));
        }
      },
      cancel,
    }), { headers: { 'content-type': 'text/event-stream' } })));
    const iterator = agent.stream({
      ...input, onAgentToolCalls: () => { doneSeen(); },
    }, delegatedAuthorization, new AbortController().signal)[Symbol.asyncIterator]();
    const completion = iterator.next();
    try {
      await terminal;
      expect(cancel).toHaveBeenCalledOnce();
      await expect(completion).resolves.toEqual({ value: undefined, done: true });
    } finally {
      if (!cancel.mock.calls.length) upstream.close();
      await completion;
      await iterator.return?.();
    }
  });

  it('releases a real loopback HTTP socket after application done without server EOF', async () => {
    let peerClosed!: () => void;
    const closed = new Promise<void>((resolve) => { peerClosed = resolve; });
    let serverEnded = false;
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.once('close', () => {
        serverEnded = response.writableEnded;
        peerClosed();
      });
      response.write('event: delta\ndata: {"text":"Complete reply"}\n\n');
      response.write('event: done\ndata: {"smokeToolCalls":[]}\n\n');
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture requires a loopback TCP port');
    const caller = new AbortController();
    const deadline = setTimeout(() => { caller.abort(new Error('Fixture stream did not settle')); }, 2_000);
    const fetcher: typeof fetch = (_url, options) => fetch(`http://127.0.0.1:${address.port}`, options);
    const { agent } = createAgent(fetcher);
    const onAgentToolCalls = vi.fn();
    try {
      const chunks: string[] = [];
      for await (const chunk of agent.stream({
        ...input, onAgentToolCalls,
      }, delegatedAuthorization, caller.signal)) chunks.push(chunk);
      await closed;
      expect(chunks).toEqual(['Complete reply']);
      expect(onAgentToolCalls).toHaveBeenCalledExactlyOnceWith([]);
      expect(serverEnded).toBe(false);
    } finally {
      clearTimeout(deadline);
      caller.abort();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => { if (error) reject(error); else resolve(); });
        server.closeAllConnections();
      });
    }
  });

  it('does not consume duplicate completion or trailing frames after terminal done', async () => {
    const onAgentToolCalls = vi.fn();
    const { agent } = createAgent(vi.fn(async () => streamedResponse([
      'event: delta\ndata: {"text":"Complete reply"}\n\n' +
      'event: done\ndata: {"smokeToolCalls":[]}\n\n' +
      'event: done\ndata: {"smokeToolCalls":[]}\n\n' +
      'event: delta\ndata: {"text":"late text"}\n\n' +
      'event: error\ndata: {"error":"private provider details"}\n\n',
    ])));
    const chunks: string[] = [];
    for await (const chunk of agent.stream({
      ...input, onAgentToolCalls,
    }, delegatedAuthorization, new AbortController().signal)) chunks.push(chunk);
    expect(chunks).toEqual(['Complete reply']);
    expect(onAgentToolCalls).toHaveBeenCalledExactlyOnceWith([]);
  });

  it('preserves EOF parsing of an unterminated legacy done frame', async () => {
    const { agent } = createAgent(vi.fn(async () => streamedResponse([
      'event: delta\ndata: {"text":"Complete reply"}\n\nevent: done\ndata: {}',
    ])));
    const chunks: string[] = [];
    for await (const chunk of agent.stream(input, delegatedAuthorization, new AbortController().signal)) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(['Complete reply']);
  });

  it.each([1024 * 1024, 1024 * 1024 + 1])('preserves the exact stream byte limit even with done (%s bytes)', async (bytes) => {
    const prefix = 'event: done\ndata: {}\n\n:';
    const frame = prefix + 'x'.repeat(bytes - prefix.length);
    const { agent } = createAgent(vi.fn(async () => streamedResponse([frame])));
    const run = async () => {
      const chunks: string[] = [];
      for await (const chunk of agent.stream(input, delegatedAuthorization, new AbortController().signal)) {
        chunks.push(chunk);
      }
      return chunks;
    };
    if (bytes > 1024 * 1024) await expect(run()).rejects.toThrow('Chat response exceeded the size limit');
    else await expect(run()).resolves.toEqual([]);
  });

  it('does not let terminal done conceal an earlier provider error', async () => {
    const { agent } = createAgent(vi.fn(async () => streamedResponse([
      'event: error\ndata: {"error":"private provider details"}\n\nevent: done\ndata: {}\n\n',
    ])));
    await expect(async () => {
      for await (const chunk of agent.stream(input, delegatedAuthorization, new AbortController().signal)) {
        void chunk;
      }
    }).rejects.toThrow('Chat agent failed');
  });

  it('preserves cancellation before terminal done rather than accepting partial text', async () => {
    const encoder = new TextEncoder();
    const caller = new AbortController();
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
      const signal = options?.signal;
      if (!signal) throw new Error('Fixture requires the actual request signal');
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          upstream = controller;
          signal.addEventListener('abort', () => {
            controller.error(signal.reason);
          }, { once: true });
          controller.enqueue(encoder.encode('event: delta\ndata: {"text":"Partial"}\n\n'));
        },
      }), { headers: { 'content-type': 'text/event-stream' } });
    });
    const { agent } = createAgent(fetcher);
    const iterator = agent.stream(input, delegatedAuthorization, caller.signal)[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ value: 'Partial', done: false });
    const abort = new DOMException('Fixture cancelled', 'AbortError');
    caller.abort(abort);
    await expect(iterator.next()).rejects.toBe(abort);
    expect(() => upstream.enqueue(encoder.encode('event: done\ndata: {}\n\n'))).toThrow();
    await iterator.return?.();
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

  describe('backend-side failure reasons', () => {
    const drain = async (agent: ConversationAgent, signal: AbortSignal = new AbortController().signal) => {
      try {
        for await (const chunk of agent.stream(input, delegatedAuthorization, signal)) void chunk;
      } catch (error) { return error; }
      return undefined;
    };
    const expectInvocationFailure = (error: unknown, reason: ChatAgentInvocationReason, message: string) => {
      expect(error).toBeInstanceOf(ChatAgentInvocationError);
      expect(error).toMatchObject({ name: 'ChatAgentInvocationError', reason, message });
      expect(chatAgentInvocationReasons.has(reason)).toBe(true);
    };

    it.each<[number, ChatAgentInvocationReason]>([
      [400, 'agent_http_400'], [401, 'agent_http_401'], [403, 'agent_http_403'], [404, 'agent_http_404'],
      [408, 'agent_http_408'], [409, 'agent_http_409'], [424, 'agent_http_424'], [429, 'agent_http_429'],
      [500, 'agent_http_500'], [502, 'agent_http_502'], [503, 'agent_http_503'], [504, 'agent_http_504'],
      [418, 'agent_http_other'], [599, 'agent_http_other'],
    ])('labels HTTP %s as %s without copying the response', async (status, reason) => {
      const fetcher = vi.fn<typeof fetch>(async () => new Response('private provider details', { status }));
      const error = await drain(createAgent(fetcher).agent);
      expectInvocationFailure(error, reason, `Chat agent unavailable (HTTP ${status})`);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect((error as Error).message).not.toContain('private');
    });

    it.each<[string, () => Response]>([
      ['a non-stream content type', () => new Response('{}', {
        status: 200, headers: { 'content-type': 'application/json' },
      })],
      ['a missing body', () => new Response(null, {
        status: 200, headers: { 'content-type': 'text/event-stream' },
      })],
    ])('labels %s on a successful status as an invalid response', async (_name, respond) => {
      const error = await drain(createAgent(vi.fn<typeof fetch>(async () => respond())).agent);
      expectInvocationFailure(error, 'agent_response_invalid', 'Chat agent unavailable (HTTP 200)');
    });

    it.each<[string, () => Promise<string>]>([
      ['a rejected token request', async () => { throw new Error('private token provider detail'); }],
      ['an empty token', async () => ' '],
      ['a token with a line break', async () => 'token\nInjected: header'],
    ])('labels %s without calling the agent', async (_name, getToken) => {
      const fetcher = vi.fn();
      const agent = createFoundryInvocationConversationAgent(
        projectEndpoint, 'jarvis', getToken, fetcher as typeof globalThis.fetch,
      );
      const error = await drain(agent);
      expectInvocationFailure(error, 'agent_auth_unavailable', 'Foundry authentication unavailable');
      expect((error as Error).message).not.toContain('private');
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('labels a failed request and keeps the original failure only as the in-process cause', async () => {
      const cause = new TypeError('fetch failed');
      const error = await drain(createAgent(vi.fn<typeof fetch>(async () => { throw cause; })).agent);
      expectInvocationFailure(error, 'agent_request_failed', 'Chat agent request failed');
      expect((error as Error).cause).toBe(cause);
    });

    it('labels a stream that fails while it is being read', async () => {
      const response = new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.error(new TypeError('terminated')); },
      }), { headers: { 'content-type': 'text/event-stream' } });
      const error = await drain(createAgent(vi.fn<typeof fetch>(async () => response)).agent);
      expectInvocationFailure(error, 'agent_stream_failed', 'Chat agent stream failed');
    });

    it.each([
      ['an unparsable delta', 'event: delta\ndata: not json\n\n'],
      ['an empty delta', 'event: delta\ndata: {"text":""}\n\n'],
    ])('labels %s as an invalid response', async (_name, frame) => {
      const error = await drain(createAgent(vi.fn<typeof fetch>(async () => streamedResponse([frame]))).agent);
      expectInvocationFailure(error, 'agent_response_invalid', 'Invalid chat response');
    });

    it('labels an oversized stream and a stream that ends without done', async () => {
      const oversized = await drain(createAgent(vi.fn<typeof fetch>(async () =>
        streamedResponse([`event: done\ndata: {}\n\n:${'x'.repeat(1024 * 1024)}`]))).agent);
      expectInvocationFailure(oversized, 'agent_response_invalid', 'Chat response exceeded the size limit');
      const ended = await drain(createAgent(vi.fn<typeof fetch>(async () =>
        streamedResponse(['event: delta\ndata: {"text":"Partial"}\n\n']))).agent);
      expectInvocationFailure(ended, 'agent_stream_ended', 'Chat agent response ended unexpectedly');
    });

    it('leaves cancellation and a hosted error event untouched rather than relabelling them', async () => {
      const abort = new DOMException('Fixture cancelled', 'AbortError');
      const caller = new AbortController();
      const failure = new TypeError('private cancellation detail');
      const cancelledDuringAuth = createFoundryInvocationConversationAgent(
        projectEndpoint, 'jarvis',
        async () => { caller.abort(abort); throw failure; },
        vi.fn() as unknown as typeof globalThis.fetch,
      );
      expect(await drain(cancelledDuringAuth, caller.signal)).toBe(failure);
      expect(await drain(createAgent(vi.fn<typeof fetch>(async () => { throw abort; })).agent)).toBe(abort);
      const readAbort = new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.error(abort); },
      }), { headers: { 'content-type': 'text/event-stream' } });
      expect(await drain(createAgent(vi.fn<typeof fetch>(async () => readAbort)).agent)).toBe(abort);
      const hosted = await drain(createAgent(vi.fn<typeof fetch>(async () =>
        streamedResponse(['event: error\ndata: {"code":"capability_instructions_too_large"}\n\n']))).agent);
      expect(hosted).toBeInstanceOf(ChatAgentError);
      expect(hosted).not.toBeInstanceOf(ChatAgentInvocationError);
    });

    it('keeps the report allowlist in step with every reason the client can throw', () => {
      const thrown: Record<ChatAgentInvocationReason, true> = {
        agent_auth_unavailable: true, agent_request_failed: true,
        agent_http_400: true, agent_http_401: true, agent_http_403: true, agent_http_404: true,
        agent_http_408: true, agent_http_409: true, agent_http_424: true, agent_http_429: true,
        agent_http_500: true, agent_http_502: true, agent_http_503: true, agent_http_504: true,
        agent_http_other: true, agent_response_invalid: true, agent_stream_failed: true, agent_stream_ended: true,
      };
      expect([...chatAgentInvocationReasons].sort()).toEqual(
        [...Object.keys(thrown), 'agent_error_code_missing', 'agent_error_code_unlisted'].sort(),
      );
    });
  });
});
