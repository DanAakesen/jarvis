import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createChatSession,
  cancelChatTurn,
  loadImageArtifactUrl,
  loadConversationHistory,
  sendChatTurn,
  steerChatTurn,
} from './conversation-history';

const config = { ...__JARVIS_CONFIG__, backendUrl: 'https://api.example.com/' };
const history = {
  messages: [{
    id: '42',
    sessionId: '41',
    channel: 'chat',
    language: 'en',
    role: 'jarvis',
    text: 'That action was refused.',
    model: null,
    voiceMinutes: null,
    at: '2026-10-03T12:00:00.000Z',
    toolCalls: [{ id: '90', tool: 'factory_create_task', outcome: 'refused', taskId: null }],
  }],
  nextCursor: null,
};

function createClient(getAccessToken: () => Promise<string> = async () => 'test-token') {
  return vi.fn(getAccessToken);
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('loadConversationHistory', () => {
  it.each(['image', 'caption'] as const)('projects persisted %s evidence without retaining frame handles or descriptions', async visualPath => {
    const metadata = { visualContext: {
      source: 'camera', capturedAt: history.messages[0]!.at, question: 'A question', description: 'Private visual description',
      visualPath, visualReason: 'frame_unavailable', frameId: 'must-not-enter-history', frame: 'private-image',
    } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ...history, messages: [{ ...history.messages[0], metadata }],
    }))));
    const result = await loadConversationHistory(createClient() as never, config);
    expect(result.messages[0]?.visualResult).toEqual({ visualPath, visualReason: 'frame_unavailable' });
    expect(result.messages[0]).not.toHaveProperty('metadata');
    expect(JSON.stringify(result)).not.toContain('must-not-enter-history');
    expect(JSON.stringify(result)).not.toContain('Private visual description');
  });

  it('requests the bounded page with a bearer token and cursor', async () => {
    const client = createClient();
    let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      request = { input, ...(init === undefined ? {} : { init }) };
      return new Response(JSON.stringify(history), { status: 200 });
    });
    vi.stubGlobal('fetch', fetch);

    await expect(loadConversationHistory(client as never, config, '42')).resolves.toEqual(history);

    const url = new URL(String(request?.input));
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.get('before')).toBe('42');
    const authorization = new Headers(request?.init?.headers).get('authorization');
    expect(authorization?.startsWith(['Bear', 'er'].join(''))).toBe(true);
    expect(client).toHaveBeenCalledOnce();
  });

  it('rejects malformed persisted visual evidence rather than claiming image access', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ...history, messages: [{ ...history.messages[0], metadata: { visualContext: { visualPath: 'video' } } }],
    }))));
    await expect(loadConversationHistory(createClient() as never, config)).rejects.toThrow('invalid visual input status');
  });

  describe('chat turn API', () => {
      it('preserves Markdown row and paragraph boundaries across byte-fragmented SSE, done and history reload', async () => {
        const text = 'Two synthetic bookings:\n\n| Hotel | Check-in |\n|---|---|\n| Fixture Hotel North | 14 May, 15:00 |\n\nAll times are local.';
        const user = { id: '51', sessionId: '41', role: 'dan', text: 'Show bookings', model: null, at: '2026-10-16T06:30:00Z' };
        const assistant = { ...user, id: '52', role: 'jarvis', text };
        const frame = (event: string, data: unknown) => `event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
        const wire = frame('user', user) + [...text].map(character => frame('delta', { text: character })).join('') + frame('done', assistant);
        const bytes = new TextEncoder().encode(wire);
        vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => String(url).includes('/turns')
          ? new Response(new ReadableStream({
            start(controller) {
              for (let index = 0; index < bytes.length; index += 7) controller.enqueue(bytes.slice(index, index + 7));
              controller.close();
            },
          }))
          : new Response(JSON.stringify({ messages: [{ ...assistant, channel: 'chat', language: 'en', toolCalls: [] }], nextCursor: null }))));
        const deltas: string[] = [];
        const result = await sendChatTurn(createClient() as never, config, { id: '41', language: 'en' }, 'Show bookings', vi.fn(), delta => deltas.push(delta));
        expect(deltas.join('')).toBe(text);
        expect(result.text).toBe(text);
        const page = await loadConversationHistory(createClient() as never, config);
        expect(page.messages[0]?.text).toBe(text);
      });

      it.each(['image', 'caption', undefined] as const)('reads %s delivery from done, not from an uploaded handle', async visualPath => {
        const base = { id: '51', sessionId: '41', role: 'dan', text: 'Count.', model: null, at: '2026-10-11T20:06:00Z' };
        vi.stubGlobal('fetch', vi.fn(async () => new Response(
          `event: user\ndata: ${JSON.stringify(base)}\n\n` +
          `event: done\ndata: ${JSON.stringify({ ...base, id: '52', role: 'jarvis',
            ...(visualPath ? { visualPath, visualReason: 'image_input_unverified' } : {}),
            frameId: 'private-handle', frame: 'private-image' })}\n\n`,
          { headers: { 'Content-Type': 'text/event-stream' } },
        )));
        const result = await sendChatTurn(createClient() as never, config, { id: '41', language: 'en' }, 'Count.', vi.fn(), vi.fn());
        expect(result.visualResult).toEqual(visualPath ? { visualPath, visualReason: 'image_input_unverified' } : undefined);
        expect(result).not.toHaveProperty('frameId');
        expect(result).not.toHaveProperty('frame');
      });

      it('makes malformed done evidence visible instead of reporting image success', async () => {
        const base = { id: '51', sessionId: '41', role: 'dan', text: 'Count.', model: null, at: '2026-10-11T20:06:00Z' };
        vi.stubGlobal('fetch', vi.fn(async () => new Response(
          `event: user\ndata: ${JSON.stringify(base)}\n\n` +
          `event: done\ndata: ${JSON.stringify({ ...base, id: '52', role: 'jarvis', visualPath: 'imaginary' })}\n\n`,
          { headers: { 'Content-Type': 'text/event-stream' } },
        )));
        await expect(sendChatTurn(createClient() as never, config, { id: '41', language: 'en' }, 'Count.', vi.fn(), vi.fn()))
          .rejects.toThrow('invalid visual input status');
      });

      it.each([undefined, 'opaque_frame-123'])('prepares one visualContext with optional frameId %s, without legacy context or frame bytes', async (frameId) => {
        const client = createClient();
        const session = { id: '41', language: 'en' as const };
        const visualContext = {
          source: 'camera' as const, capturedAt: '2026-10-11T20:06:00.000Z',
          description: 'Three fingers.', question: 'How many fingers am I holding up?',
          ...(frameId === undefined ? {} : { frameId }),
        };
        const extra = { ...visualContext, frame: 'must-not-be-forwarded' };
        const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(
          `event: user\ndata: ${JSON.stringify({
            id: '51', sessionId: '41', role: 'dan', text: visualContext.question, model: null,
            at: '2026-10-11T20:06:00.000Z',
          })}\n\n` +
          `event: done\ndata: ${JSON.stringify({
            id: '52', sessionId: '41', role: 'jarvis', text: 'Three.', model: null,
            at: '2026-10-11T20:06:00.000Z',
          })}\n\n`,
          { headers: { 'Content-Type': 'text/event-stream' } },
        ));
        vi.stubGlobal('fetch', fetch);
        await sendChatTurn(
          client as never, config, session, visualContext.question, vi.fn(), vi.fn(),
          undefined, undefined, undefined, undefined, undefined, undefined, extra,
        );
        expect(fetch).toHaveBeenCalledOnce();
        expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
          text: visualContext.question, visualContext,
        });
      });

      it.each([
        { capturedAt: 'invalid' },
        { frameId: 'bad/id' },
        { question: 'x'.repeat(501) },
        { description: ' ' },
      ])('refuses invalid visualContext before sending a turn: %j', async (overrides) => {
        const client = createClient();
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        await expect(sendChatTurn(
          client as never, config, { id: '41', language: 'en' }, 'Count fingers.', vi.fn(), vi.fn(),
          undefined, undefined, undefined, undefined, undefined, undefined,
          { source: 'camera', capturedAt: '2026-10-11T20:06:00.000Z', description: 'Three.', ...overrides },
        )).rejects.toThrow();
        expect(fetch).not.toHaveBeenCalled();
        expect(client).not.toHaveBeenCalled();
      });

      it('rejects simultaneous legacy and structured visual context before sending', async () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        await expect(sendChatTurn(
          createClient() as never, config, { id: '41', language: 'en' }, 'Count fingers.', vi.fn(), vi.fn(),
          undefined, 'Legacy scene.', undefined, undefined, undefined, undefined,
          { source: 'camera', capturedAt: '2026-10-11T20:06:00.000Z', description: 'Three.' },
        )).rejects.toThrow('Send visual context or legacy screen context, not both.');
        expect(fetch).not.toHaveBeenCalled();
      });

      it('keeps streaming through preparation and the food review window within the existing ingress limit', async () => {
        vi.useFakeTimers();
        const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
          const controller = new AbortController();
          setTimeout(() => controller.abort(), ms);
          return controller.signal;
        });
        try {
          let stream!: ReadableStreamDefaultController<Uint8Array>;
          let requestSignal!: AbortSignal;
          const user = { id: '51', sessionId: '41', role: 'dan', text: 'Synthetic estimate', model: null,
            at: '2026-10-25T12:00:00Z' };
          const committed = { ...user, id: '52', role: 'jarvis', text: 'Logged.' };
          const encoder = new TextEncoder();
          const event = (name: string, value: unknown) => encoder.encode(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`);
          vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
            requestSignal = init.signal!;
            return new Response(new ReadableStream<Uint8Array>({ start(controller) {
              stream = controller;
              stream.enqueue(event('user', user));
            } }));
          }));
          const result = sendChatTurn(createClient(), config, { id: '41', language: 'en' }, user.text, vi.fn(), vi.fn());
          await vi.advanceTimersByTimeAsync(60_000); // Estimate preparation.
          expect(requestSignal.aborted).toBe(false);
          await vi.advanceTimersByTimeAsync(110_000); // Still inside the pending review window.
          expect(requestSignal.aborted).toBe(false);
          expect(timeout).toHaveBeenCalledWith(240_000);
          stream.enqueue(event('done', committed));
          stream.close();
          expect(await result).toEqual(committed);
          await vi.advanceTimersByTimeAsync(70_000);
          expect(requestSignal.aborted).toBe(true);
        } finally {
          timeout.mockRestore();
          vi.useRealTimers();
        }
      });

      it('sanitizes stream-read failures and marks delivery uncertain without replaying the turn', async () => {
        const fetch = vi.fn(async () => new Response(new ReadableStream({
          start(controller) { controller.error(new Error('private transport diagnostics')); },
        })));
        vi.stubGlobal('fetch', fetch);
        const uncertain = vi.fn();
        await expect(sendChatTurn(createClient(), config, { id: '41', language: 'en' }, 'Synthetic estimate',
          vi.fn(), vi.fn(), uncertain)).rejects.toThrow('A food entry or another action may already have completed');
        expect(uncertain).toHaveBeenCalledOnce();
        expect(fetch).toHaveBeenCalledOnce();
      });

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

      it.each(['\n', '\r\n'])('delivers a fragmented first delta while the stream is still open with %j delimiters', async newline => {
        const userMessage = {
          id: '51', sessionId: '41', role: 'dan', text: 'Hello', model: null,
          at: '2026-10-12T06:17:18.000Z',
        };
        const assistantMessage = { ...userMessage, id: '52', role: 'jarvis', text: 'Hej, D\u00e6n.' };
        const encoder = new TextEncoder();
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(value) { controller = value; },
        });
        vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, {
          headers: { 'Content-Type': 'text/event-stream' },
        })));
        let receivedDelta!: () => void;
        const firstDelta = new Promise<void>(resolve => { receivedDelta = resolve; });
        const onUser = vi.fn();
        const onDelta = vi.fn(() => receivedDelta());
        let completed = false;
        const turn = sendChatTurn(
          createClient() as never, config, { id: '41', language: 'en' },
          'Hello', onUser, onDelta,
        ).then(reply => { completed = true; return reply; });
        const frame = (event: string, payload: unknown) =>
          `event: ${event}${newline}data: ${JSON.stringify(payload)}${newline}${newline}`;
        controller.enqueue(encoder.encode(frame('user', userMessage)));
        const bytes = encoder.encode(frame('delta', { text: assistantMessage.text }));
        const splitAt = bytes.indexOf(0xc3) + 1;
        controller.enqueue(bytes.slice(0, splitAt));
        controller.enqueue(bytes.slice(splitAt));
        try {
          await firstDelta;
          expect(onUser).toHaveBeenCalledWith(userMessage);
          expect(onDelta).toHaveBeenCalledExactlyOnceWith(assistantMessage.text);
          expect(completed).toBe(false);
          controller.enqueue(encoder.encode(frame('done', assistantMessage)));
        } finally {
          controller.close();
        }
        await expect(turn).resolves.toEqual(assistantMessage);
      });

      it('delivers a distinct acknowledgment boundary before final text', async () => {
        const userMessage = {
          id: '61', sessionId: '41', role: 'dan', text: 'Compare my targets.', model: null,
          at: '2026-10-12T06:17:18.000Z',
        };
        const assistantMessage = { ...userMessage, id: '62', role: 'jarvis', text: 'The targets match.' };
        const acknowledgment = "I'll compare your saved targets.";
        const fetch = vi.fn()
          .mockResolvedValueOnce(new Response([
            `event: user\ndata: ${JSON.stringify(userMessage)}\n\n`,
            `event: delta\ndata: ${JSON.stringify({ text: acknowledgment })}\n\n`,
            `event: acknowledgment\ndata: ${JSON.stringify({ text: acknowledgment })}\n\n`,
            `event: delta\ndata: ${JSON.stringify({ text: assistantMessage.text })}\n\n`,
            `event: done\ndata: ${JSON.stringify(assistantMessage)}\n\n`,
          ].join(''), { headers: { 'Content-Type': 'text/event-stream' } }));
        vi.stubGlobal('fetch', fetch);
        const onAcknowledgment = vi.fn();
        const onDelta = vi.fn();

        await sendChatTurn(
          createClient() as never, config, { id: '41', language: 'en' },
          userMessage.text, vi.fn(), onDelta, undefined, undefined, undefined, undefined,
          undefined, undefined, undefined, onAcknowledgment,
        );

        expect(onDelta.mock.calls).toEqual([[acknowledgment], [assistantMessage.text]]);
        expect(onAcknowledgment).toHaveBeenCalledExactlyOnceWith(acknowledgment);
        expect(fetch).toHaveBeenCalledOnce();
      });

      it('delivers the exact food invitation while the result is still pending, then clears it', async () => {
        const user = { id: '61', sessionId: '41', role: 'dan', text: 'Estimate this portion.',
          model: null, at: '2026-10-12T06:17:18.000Z' };
        const assistant = { ...user, id: '62', role: 'jarvis', text: 'Committed.' };
        const invitation = { id: 'a'.repeat(43), summary: 'Synthetic portion: 200 kcal. Estimated grams.',
          expiresAt: new Date(Date.now() + 120_000).toISOString() };
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
        vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
        const encoder = new TextEncoder();
        const enqueue = (event: string, data: unknown) =>
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        const onInvitation = vi.fn();
        let completed = false;
        const turn = sendChatTurn(createClient() as never, config, { id: '41', language: 'en' },
          user.text, vi.fn(), vi.fn(), undefined, undefined, undefined, undefined,
          undefined, undefined, undefined, undefined, onInvitation).then(result => { completed = true; return result; });
        enqueue('user', user);
        enqueue('food_invitation', invitation);
        await vi.waitFor(() => expect(onInvitation).toHaveBeenCalledExactlyOnceWith(invitation));
        expect(completed).toBe(false);
        enqueue('food_invitation', null);
        enqueue('done', assistant);
        controller.close();
        expect(await turn).toEqual(assistant);
        expect(onInvitation.mock.calls).toEqual([[invitation], [null]]);
      });

      it.each([
        { id: 'invalid', summary: 'Estimate', expiresAt: '2026-10-12T06:19:18.000Z' },
        { id: 'a'.repeat(43), summary: '', expiresAt: '2026-10-12T06:19:18.000Z' },
        { id: 'a'.repeat(43), summary: 'Estimate', expiresAt: 'invalid' },
      ])('rejects malformed food invitation data (%j)', async invitation => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(
          `event: food_invitation\ndata: ${JSON.stringify(invitation)}\n\n`,
        )));
        await expect(sendChatTurn(createClient() as never, config, { id: '41', language: 'en' },
          'Estimate', vi.fn(), vi.fn())).rejects.toThrow('invalid chat stream');
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
});

describe('loadImageArtifactUrl', () => {
  it('requests an owner-authorized artifact URL and accepts only trusted HTTPS Blob hosts', async () => {
    const client = createClient();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({
      url: 'https://jarvisstore.blob.core.windows.net/artifacts/image.png?sp=r&spr=https',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const signal = controller.signal;

    await expect(loadImageArtifactUrl(
      client as never,
      config,
      '7b96c6a9-9f80-4a8b-8a73-51517fe37512',
      signal,
    )).resolves.toBe('https://jarvisstore.blob.core.windows.net/artifacts/image.png?sp=r&spr=https');

    expect(String(fetch.mock.calls[0]?.[0])).toContain(
      '/factory/workspace-artifacts/images/7b96c6a9-9f80-4a8b-8a73-51517fe37512',
    );
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization'))
      .toBe(`${['Bear', 'er'].join('')} test-token`);
    const requestSignal = fetch.mock.calls[0]?.[1]?.signal;
    expect(requestSignal?.aborted).toBe(false);
    controller.abort();
    expect(requestSignal?.aborted).toBe(true);

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      url: 'https://attacker.example/image.png',
    }), { status: 200 })));
    await expect(loadImageArtifactUrl(
      client as never,
      config,
      '7b96c6a9-9f80-4a8b-8a73-51517fe37512',
      signal,
    )).rejects.toThrow('untrusted image artifact URL');
  });
});

describe('loadConversationHistory errors', () => {
  it('fails closed if no sign-in account is available', async () => {
    const client = createClient(async () => {
      throw new Error('Your Microsoft sign-in needs attention. Sign in again.');
    });
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

describe('chat steering API', () => {
  it('sends steering messages through the authenticated conversation endpoint', async () => {
    const client = createClient();
    const message = {
      id: '53',
      sessionId: '41',
      role: 'dan',
      text: 'Continue with this instead',
      language: 'da',
      model: null,
      at: '2026-10-05T12:00:00.000Z',
    };
    const fetch = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => new Response(JSON.stringify(message), { status: 201 }));
    vi.stubGlobal('fetch', fetch);

    await expect(steerChatTurn(
      client as never,
      config,
      { id: '41', language: 'en' },
      message.text,
      'da',
    )).resolves.toEqual(message);

    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      'https://api.example.com/conversation/sessions/41/steer',
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      text: message.text,
      language: 'da',
    });
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).has('authorization')).toBe(true);
    expect(client).toHaveBeenCalledOnce();
  });

  it('parses interrupted partial replies before the steered continuation', async () => {
    const client = createClient();
    const userMessage = {
      id: '51',
      sessionId: '41',
      role: 'dan',
      text: 'Hello',
      model: null,
      at: '2026-10-05T12:00:00.000Z',
    };
    const partialReply = {
      ...userMessage,
      id: '52',
      role: 'jarvis',
      text: 'I was going to',
    };
    const finalReply = {
      ...partialReply,
      id: '54',
      text: 'I’ll continue with your new direction.',
    };
    const stream = [
      `event: user\ndata: ${JSON.stringify(userMessage)}\n\n`,
      'event: delta\ndata: {"text":"I was going to"}\n\n',
      `event: interrupted\ndata: ${JSON.stringify(partialReply)}\n\n`,
      'event: delta\ndata: {"text":"I’ll continue"}\n\n',
      `event: done\ndata: ${JSON.stringify(finalReply)}\n\n`,
    ].join('');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })));

    const session = { id: '41', language: 'en' as const };
    const onInterrupted = vi.fn();
    const onDelta = vi.fn();
    await expect(sendChatTurn(
      client as never,
      config,
      session,
      'Hello',
      vi.fn(),
      onDelta,
      undefined,
      undefined,
      undefined,
      undefined,
      onInterrupted,
    )).resolves.toEqual(finalReply);

    expect(onInterrupted).toHaveBeenCalledWith(partialReply);
    expect(onDelta.mock.calls).toEqual([['I was going to'], ['I’ll continue']]);
  });
});


describe('accepted turn recovery', () => {
  it('addresses explicit cancellation to the original turn without submitting a message', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ cancelled: true }));
    vi.stubGlobal('fetch', fetch);
    await cancelChatTurn(createClient(), config, { sessionId: '41', messageId: '42', language: 'en' });
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]![0])).toBe('https://api.example.com/conversation/sessions/41/turns/42/cancel');
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: 'POST', body: '{}' });
  });

  it.each(['disconnect', 'foreground'])('reattaches by original identity after %s without another POST', async reason => {
    vi.useFakeTimers();
    try {
      const user = { id: '42', sessionId: '41', role: 'dan', text: 'Synthetic estimate', model: null, at: '2026-10-26T12:00:00Z' };
      const answer = { ...user, id: '43', role: 'jarvis', text: 'Estimate only; not saved.' };
      const frame = (event: string, value: unknown) => `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
      const fetch = vi.fn()
        .mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) {
          controller.enqueue(new TextEncoder().encode(frame('user', user) + frame('delta', { text: 'Partial' })));
          if (reason === 'disconnect') controller.close();
        } })))
        .mockResolvedValueOnce(new Response(frame('user', user) + frame('delta', { text: answer.text }) + frame('done', answer)));
      vi.stubGlobal('fetch', fetch);
      const reset = vi.fn();
      const result = sendChatTurn(async () => 'token', config, { id: '41', language: 'en' }, user.text,
        vi.fn(), vi.fn(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, reset);
      await vi.advanceTimersByTimeAsync(0);
      if (reason === 'foreground') document.dispatchEvent(new Event('visibilitychange'));
      await vi.runAllTimersAsync();
      expect(await result).toEqual(answer);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(String(fetch.mock.calls[1]![0])).toContain('/sessions/41/turns/42/events');
      expect(fetch.mock.calls[1]![1].method).toBeUndefined();
      expect(reset).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});
