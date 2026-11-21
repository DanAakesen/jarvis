import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { ConversationAgentInput } from '../core/chat-agent.js';
import type { ConversationMessage, ConversationStore } from '../core/conversation-store.js';
import { createLogger } from '../logging.js';
import type { PiVoiceAgent } from './pi-voice.js';
import { createVoiceRelayModule, VOICE_SUBPROTOCOL } from './relay.js';

const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
const cleanups: Array<() => Promise<void>> = [];
const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
});

async function until(check: () => boolean, label: string, attempts = 800) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (check()) return;
    await sleep(5);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function startRelay(store: ConversationStore, piAgent: PiVoiceAgent) {
  const upstream = new WebSocketServer({ port: 0 });
  const upstreamSockets: WebSocket[] = [];
  const upstreamEvents: Record<string, unknown>[] = [];
  upstream.on('connection', (socket) => {
    upstreamSockets.push(socket);
    socket.on('message', (data) => {
      upstreamEvents.push(JSON.parse(data.toString()) as Record<string, unknown>);
    });
    socket.send(JSON.stringify({
      type: 'session.started',
      session: { id: 'live-session', audio: { format: { type: 'audio/pcm', rate: 24_000 } } },
    }));
  });
  await new Promise<void>(resolve => upstream.once('listening', resolve));
  const upstreamUrl = `ws://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  const app = buildApp(
    config,
    createLogger({ ...config, logLevel: 'silent' } as typeof config),
    {
      auth: async () => ({
        objectId: config.auth.ownerObjectId,
        tenantId: config.auth.tenantId,
        displayName: 'Dan',
      }),
      conversationStore: store,
      piAgent,
      modules: [createVoiceRelayModule({
        getToken: async () => 'token',
        connect: () => new WebSocket(upstreamUrl),
      })],
    },
  );
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as AddressInfo).port;
  const browser = new WebSocket(
    `ws://127.0.0.1:${port}/voice`,
    [VOICE_SUBPROTOCOL, 'jarvis.auth.aaa.bbb.ccc'],
  );
  const received: Record<string, unknown>[] = [];
  browser.on('message', (data) => {
    received.push(JSON.parse(data.toString()) as Record<string, unknown>);
  });
  cleanups.push(async () => {
    browser.terminate();
    await app.close();
    for (const socket of upstreamSockets) socket.terminate();
    upstream.close();
  });
  await until(
    () => received.some(event => event.type === 'jarvis.session.ready') &&
      upstreamSockets.length === 1,
    'GPT-Live relay readiness',
  );
  return { browser, received, upstreamEvents, upstreamSockets };
}

describe('GPT-Live authoritative client events', () => {
  it('preserves exact activity, response identity, speaker and persistence order across overlap', async () => {
    const writes: Array<{
      role: string;
      text: string;
      sourceItemId?: string;
    }> = [];
    let messageId = 100;
    const store = {
      createSession: async () => ({
        id: '70', channel: 'voice', language: 'en', startedAt: new Date(), endedAt: null,
      }),
      endSession: async () => true,
      addMessage: async (input: {
        sessionId: string;
        role: string;
        text: string;
        model: string | null;
        sourceItemId?: string;
      }) => {
        if (input.role === 'jarvis') await sleep(850);
        writes.push({
          role: input.role,
          text: input.text,
          ...(input.sourceItemId ? { sourceItemId: input.sourceItemId } : {}),
        });
        messageId += 1;
        return {
          id: String(messageId),
          sessionId: input.sessionId,
          role: input.role,
          text: input.text,
          model: input.model,
          at: new Date(),
        } as ConversationMessage;
      },
    } as unknown as ConversationStore;
    const inputs: ConversationAgentInput[] = [];
    const agent: PiVoiceAgent = {
      async *stream(input) {
        inputs.push(input);
        yield input.text === 'Cannot save that'
          ? 'I could not save it.'
          : 'It is saved now.';
      },
    };
    const relay = await startRelay(store, agent);
    relay.browser.send(JSON.stringify({ type: 'jarvis.microphone.active' }));
    await until(
      () => relay.received.some(event =>
        event.type === 'jarvis.voice.activity' && event.state === 'listening'
      ),
      'listening activity',
    );

    relay.upstreamSockets[0]!.send(JSON.stringify({
      type: 'session.input_transcript.delta',
      event_id: 'input-1',
      delta: 'Cannot save that',
      start_ms: 0,
      end_ms: 100,
    }));
    relay.upstreamSockets[0]!.send(JSON.stringify({
      type: 'session.delegation.created',
      event_id: 'delegation-1',
      offset_ms: 100,
      delegation: { id: 'delegate-1', target: 'client' },
    }));
    await until(() => inputs.length === 1, 'first delegated PI turn');

    const firstOutput = {
      type: 'session.output_transcript.delta',
      event_id: 'output-1',
      delta: 'I could not save it.',
    };
    relay.upstreamSockets[0]!.send(JSON.stringify(firstOutput));
    relay.upstreamSockets[0]!.send(JSON.stringify({
      type: 'session.output_audio.delta',
      event_id: 'audio-1',
      delta: 'AAE=',
      start_ms: 101,
      end_ms: 200,
    }));
    relay.upstreamSockets[0]!.send(JSON.stringify(firstOutput));
    await until(
      () => relay.received.some(event =>
        event.type === 'jarvis.voice.activity' && event.state === 'speaking'
      ),
      'speaking activity',
    );

    relay.upstreamSockets[0]!.send(JSON.stringify({
      type: 'session.input_transcript.delta',
      event_id: 'input-2',
      delta: 'Correct it',
      start_ms: 201,
      end_ms: 300,
    }));
    relay.upstreamSockets[0]!.send(JSON.stringify({
      type: 'session.delegation.created',
      event_id: 'delegation-2',
      offset_ms: 300,
      delegation: { id: 'delegate-2', target: 'client' },
    }));
    await until(() => inputs.length === 2, 'second delegated PI turn', 1_000);

    relay.upstreamSockets[0]!.send(JSON.stringify({
      type: 'session.output_transcript.delta',
      event_id: 'output-2',
      delta: 'It is saved now.',
    }));
    relay.upstreamSockets[0]!.send(JSON.stringify({
      type: 'session.output_audio.delta',
      event_id: 'audio-2',
      delta: 'AQI=',
    }));
    await until(() => writes.length === 4, 'serialized transcript writes', 1_000);

    expect(inputs.map(input => input.text)).toEqual(['Cannot save that', 'Correct it']);
    expect(writes.map(write => `${write.role}:${write.text}`)).toEqual([
      'dan:Cannot save that',
      'jarvis:I could not save it.',
      'dan:Correct it',
      'jarvis:It is saved now.',
    ]);
    expect(writes.every(write => write.sourceItemId?.startsWith(
      write.role === 'dan' ? 'input_' : 'voice_'
    ))).toBe(true);

    const assistantDeltas = relay.received.filter(event =>
      event.type === 'jarvis.voice.output_transcript.delta'
    );
    expect(assistantDeltas.map(event => event.delta)).toEqual([
      'I could not save it.',
      'It is saved now.',
    ]);
    expect(assistantDeltas.every(event =>
      typeof event.responseId === 'string' &&
      typeof event.eventId === 'string'
    )).toBe(true);
    expect(relay.received.some(event =>
      event.type === 'jarvis.voice.audio.delta' && event.eventId === 'audio-1'
    )).toBe(true);
    const outputStates = relay.received.filter(event =>
      event.type === 'jarvis.voice.activity'
    ).map(event => event.state);
    expect(outputStates).toEqual(expect.arrayContaining([
      'listening',
      'thinking',
      'speaking',
    ]));
    expect(relay.received.some(event =>
      event.type === 'jarvis.voice.response.cancelled' &&
      event.responseId === assistantDeltas[0]?.responseId
    )).toBe(true);
  }, 15_000);

  it('keeps natural GPT-Live backchannels in the full-duplex path', async () => {
    const store = {
      createSession: async () => ({
        id: '71', channel: 'voice', language: 'en', startedAt: new Date(), endedAt: null,
      }),
      endSession: async () => true,
      addMessage: async (input: {
        sessionId: string;
        role: string;
        text: string;
        model: string | null;
      }) => ({
        id: '710',
        sessionId: input.sessionId,
        role: input.role,
        text: input.text,
        model: input.model,
        at: new Date(),
      } as ConversationMessage),
    } as unknown as ConversationStore;
    const agent: PiVoiceAgent = {
      async *stream() { yield 'unused'; },
    };
    const relay = await startRelay(store, agent);
    relay.browser.send(JSON.stringify({ type: 'jarvis.microphone.active' }));
    relay.upstreamSockets[0]!.send(JSON.stringify({
      type: 'session.output_transcript.delta',
      event_id: 'natural-backchannel',
      delta: 'One moment.',
    }));
    relay.upstreamSockets[0]!.send(JSON.stringify({
      type: 'session.output_audio.delta',
      event_id: 'natural-backchannel-audio',
      delta: 'AAE=',
    }));

    await until(() => relay.received.some(event =>
      event.type === 'jarvis.voice.audio.delta' &&
      event.eventId === 'natural-backchannel-audio'
    ), 'natural GPT-Live audio');
    expect(relay.received).toContainEqual(expect.objectContaining({
      type: 'jarvis.voice.output_transcript.delta',
      eventId: 'natural-backchannel',
      delta: 'One moment.',
    }));
    expect(relay.received.some(event => event.type === 'jarvis.session.failed')).toBe(false);
  });

  it('persists a natural nondelegated owner turn before the assistant response', async () => {
    const writes: Array<{ role: string; text: string }> = [];
    const store = {
      createSession: async () => ({
        id: '711', channel: 'voice', language: 'en', startedAt: new Date(), endedAt: null,
      }),
      endSession: async () => true,
      addMessage: async (input: {
        sessionId: string;
        role: string;
        text: string;
        model: string | null;
      }) => {
        writes.push({ role: input.role, text: input.text });
        return {
          id: String(800 + writes.length),
          sessionId: input.sessionId,
          role: input.role,
          text: input.text,
          model: input.model,
          at: new Date(),
        } as ConversationMessage;
      },
    } as unknown as ConversationStore;
    const inputs: ConversationAgentInput[] = [];
    const relay = await startRelay(store, {
      async *stream(input) {
        inputs.push(input);
        yield 'PI should not own this direct turn.';
      },
    });
    relay.browser.send(JSON.stringify({ type: 'jarvis.microphone.active' }));
    relay.upstreamSockets[0]!.send(JSON.stringify({
      type: 'session.input_transcript.delta',
      event_id: 'direct-input',
      delta: 'Hello Jarvis',
      start_ms: 0,
      end_ms: 100,
    }));
    relay.upstreamSockets[0]!.send(JSON.stringify({
      type: 'session.output_transcript.delta',
      event_id: 'direct-output',
      delta: 'Hello Dan.',
    }));
    relay.upstreamSockets[0]!.send(JSON.stringify({
      type: 'session.output_audio.delta',
      event_id: 'direct-audio',
      delta: 'AAE=',
    }));

    await until(() => writes.length === 2, 'direct transcript persistence');
    expect(inputs).toEqual([]);
    expect(writes).toEqual([
      { role: 'dan', text: 'Hello Jarvis' },
      { role: 'jarvis', text: 'Hello Dan.' },
    ]);
    expect(relay.received).toContainEqual(expect.objectContaining({
      type: 'jarvis.voice.input_transcript.completed',
      transcript: 'Hello Jarvis',
    }));
  });

  it('does not let continuous input PCM overwrite delegated thinking', async () => {
    const store = {
      createSession: async () => ({
        id: '712', channel: 'voice', language: 'en', startedAt: new Date(), endedAt: null,
      }),
      endSession: async () => true,
      addMessage: async (input: {
        sessionId: string;
        role: string;
        text: string;
        model: string | null;
      }) => ({
        id: '720',
        sessionId: input.sessionId,
        role: input.role,
        text: input.text,
        model: input.model,
        at: new Date(),
      } as ConversationMessage),
    } as unknown as ConversationStore;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const relay = await startRelay(store, {
      // eslint-disable-next-line require-yield
      async *stream() {
        await held;
      },
    });
    relay.browser.send(JSON.stringify({ type: 'jarvis.microphone.active' }));
    relay.upstreamSockets[0]!.send(JSON.stringify({
      type: 'session.input_transcript.delta',
      event_id: 'thinking-input',
      delta: 'Find the current status',
      start_ms: 0,
      end_ms: 100,
    }));
    relay.upstreamSockets[0]!.send(JSON.stringify({
      type: 'session.delegation.created',
      event_id: 'thinking-delegation',
      offset_ms: 100,
      delegation: { id: 'delegate-thinking', target: 'client' },
    }));
    await until(() => relay.received.some(event =>
      event.type === 'jarvis.voice.activity' && event.state === 'thinking'
    ), 'thinking activity');
    relay.browser.send(JSON.stringify({
      type: 'jarvis.voice.input_audio.append',
      audio: 'AAE=',
    }));
    await sleep(50);
    const states = relay.received.filter(event =>
      event.type === 'jarvis.voice.activity'
    ).map(event => event.state);
    expect(states.at(-1)).toBe('thinking');
    release();
  });

  it('does not attach a late delegation to a newer owner transcript', async () => {
    const writes: Array<{ role: string; text: string }> = [];
    const store = {
      createSession: async () => ({
        id: '713', channel: 'voice', language: 'en', startedAt: new Date(), endedAt: null,
      }),
      endSession: async () => true,
      addMessage: async (input: {
        sessionId: string;
        role: string;
        text: string;
        model: string | null;
      }) => {
        writes.push({ role: input.role, text: input.text });
        return {
          id: String(900 + writes.length),
          sessionId: input.sessionId,
          role: input.role,
          text: input.text,
          model: input.model,
          at: new Date(),
        } as ConversationMessage;
      },
    } as unknown as ConversationStore;
    const inputs: ConversationAgentInput[] = [];
    const relay = await startRelay(store, {
      async *stream(input) {
        inputs.push(input);
        yield `Latest: ${input.text}`;
      },
    });
    relay.browser.send(JSON.stringify({ type: 'jarvis.microphone.active' }));
    relay.upstreamSockets[0]!.send(JSON.stringify({
      type: 'session.input_transcript.delta',
      event_id: 'old-input',
      delta: 'Old request',
      start_ms: 0,
      end_ms: 100,
    }));
    relay.upstreamSockets[0]!.send(JSON.stringify({
      type: 'session.output_transcript.delta',
      event_id: 'old-direct-output',
      delta: 'Short answer.',
    }));
    await until(() => writes.some(write => write.role === 'dan'), 'old direct owner write');
    relay.upstreamSockets[0]!.send(JSON.stringify({
      type: 'session.input_transcript.delta',
      event_id: 'new-input',
      delta: 'New request',
      start_ms: 201,
      end_ms: 300,
    }));
    relay.upstreamSockets[0]!.send(JSON.stringify({
      type: 'session.delegation.created',
      event_id: 'late-old-delegation',
      offset_ms: 100,
      delegation: { id: 'delegate-old', target: 'client' },
    }));
    await sleep(700);
    expect(inputs).toEqual([]);

    relay.upstreamSockets[0]!.send(JSON.stringify({
      type: 'session.delegation.created',
      event_id: 'new-delegation',
      offset_ms: 300,
      delegation: { id: 'delegate-new', target: 'client' },
    }));
    await until(() => inputs.length === 1, 'new delegated owner turn');
    expect(inputs[0]?.text).toBe('New request');
  }, 15_000);

  describe('delegation that precedes its owner transcript', () => {
    const recordingStore = (writes: Array<{ id: string; role: string; text: string }>) => ({
      createSession: async () => ({
        id: '714', channel: 'voice', language: 'en', startedAt: new Date(), endedAt: null,
      }),
      endSession: async () => true,
      addMessage: async (input: {
        sessionId: string;
        role: string;
        text: string;
        model: string | null;
      }) => {
        const id = String(1000 + writes.length);
        writes.push({ id, role: input.role, text: input.text });
        return {
          id, sessionId: input.sessionId, role: input.role, text: input.text,
          model: input.model, at: new Date(),
        } as ConversationMessage;
      },
    } as unknown as ConversationStore);
    const send = (relay: Awaited<ReturnType<typeof startRelay>>, event: Record<string, unknown>) =>
      relay.upstreamSockets[0]!.send(JSON.stringify(event));
    const commentary = (relay: Awaited<ReturnType<typeof startRelay>>) =>
      relay.upstreamEvents.filter(event => event.type === 'session.commentary.append');
    const expectOpen = (relay: Awaited<ReturnType<typeof startRelay>>) => {
      expect(relay.browser.readyState).toBe(WebSocket.OPEN);
      expect(relay.received.some(event => event.type === 'jarvis.session.failed')).toBe(false);
    };

    it('delegates the first turn without closing the session', async () => {
      const writes: Array<{ id: string; role: string; text: string }> = [];
      const inputs: ConversationAgentInput[] = [];
      const relay = await startRelay(recordingStore(writes), {
        async *stream(input) {
          inputs.push(input);
          yield 'Result ready.';
        },
      });
      relay.browser.send(JSON.stringify({ type: 'jarvis.microphone.active' }));
      send(relay, {
        type: 'session.delegation.created',
        event_id: 'first-delegation',
        offset_ms: 300,
        delegation: { id: 'delegate-first', target: 'client' },
      });
      await sleep(50);
      send(relay, {
        type: 'session.input_transcript.delta',
        event_id: 'first-input',
        delta: 'Find the status',
        start_ms: 0,
        end_ms: 300,
      });
      await until(() => commentary(relay).length === 1, 'first delegated result');
      send(relay, {
        type: 'session.output_transcript.delta',
        event_id: 'first-output',
        delta: 'Here is the status.',
      });
      await until(() => writes.length === 2, 'ordered persistence');

      expect(inputs).toHaveLength(1);
      expect(inputs[0]).toEqual(expect.objectContaining({ text: 'Find the status', messageId: '1000' }));
      expect(commentary(relay)).toEqual([expect.objectContaining({
        delegation_id: 'delegate-first',
        content: 'Result ready.',
      })]);
      expect(writes.map(({ role, text }) => ({ role, text }))).toEqual([
        { role: 'dan', text: 'Find the status' },
        { role: 'jarvis', text: 'Here is the status.' },
      ]);
      expectOpen(relay);
    }, 15_000);

    it('does not reuse a persisted direct turn for the next delegation', async () => {
      const writes: Array<{ id: string; role: string; text: string }> = [];
      const inputs: ConversationAgentInput[] = [];
      const relay = await startRelay(recordingStore(writes), {
        async *stream(input) {
          inputs.push(input);
          yield 'Result ready.';
        },
      });
      relay.browser.send(JSON.stringify({ type: 'jarvis.microphone.active' }));
      send(relay, {
        type: 'session.input_transcript.delta',
        event_id: 'direct-input',
        delta: 'Hello Jarvis',
        start_ms: 0,
        end_ms: 100,
      });
      send(relay, {
        type: 'session.output_transcript.delta',
        event_id: 'direct-output',
        delta: 'Hello Dan.',
      });
      await until(() => writes.length === 2, 'direct turn persistence');
      send(relay, {
        type: 'session.delegation.created',
        event_id: 'second-delegation',
        offset_ms: 400,
        delegation: { id: 'delegate-second', target: 'client' },
      });
      await sleep(50);
      send(relay, {
        type: 'session.input_transcript.delta',
        event_id: 'second-input',
        delta: 'Check my calendar',
        start_ms: 200,
        end_ms: 400,
      });
      await until(() => commentary(relay).length === 1, 'delegated result');
      send(relay, {
        type: 'session.output_transcript.delta',
        event_id: 'second-output',
        delta: 'Your calendar is clear.',
      });
      await until(() => writes.length === 4, 'ordered persistence');

      expect(inputs).toHaveLength(1);
      expect(inputs[0]?.text).toBe('Check my calendar');
      expect(commentary(relay)).toHaveLength(1);
      expect(writes.map(({ role, text }) => ({ role, text }))).toEqual([
        { role: 'dan', text: 'Hello Jarvis' },
        { role: 'jarvis', text: 'Hello Dan.' },
        { role: 'dan', text: 'Check my calendar' },
        { role: 'jarvis', text: 'Your calendar is clear.' },
      ]);
      expectOpen(relay);
    }, 15_000);

    it('does not reuse the previous delegated turn for the next delegation', async () => {
      const writes: Array<{ id: string; role: string; text: string }> = [];
      const inputs: ConversationAgentInput[] = [];
      const relay = await startRelay(recordingStore(writes), {
        async *stream(input) {
          inputs.push(input);
          yield 'Result ready.';
        },
      });
      relay.browser.send(JSON.stringify({ type: 'jarvis.microphone.active' }));
      send(relay, {
        type: 'session.input_transcript.delta',
        event_id: 'one-input',
        delta: 'First task',
        start_ms: 0,
        end_ms: 100,
      });
      send(relay, {
        type: 'session.delegation.created',
        event_id: 'one-delegation',
        offset_ms: 100,
        delegation: { id: 'delegate-one', target: 'client' },
      });
      await until(() => commentary(relay).length === 1, 'first delegated result');
      send(relay, {
        type: 'session.output_transcript.delta',
        event_id: 'one-output',
        delta: 'First done.',
      });
      await until(() => writes.length === 2, 'first turn persistence');
      send(relay, {
        type: 'session.delegation.created',
        event_id: 'two-delegation',
        offset_ms: 500,
        delegation: { id: 'delegate-two', target: 'client' },
      });
      await sleep(50);
      send(relay, {
        type: 'session.input_transcript.delta',
        event_id: 'two-input',
        delta: 'Second task',
        start_ms: 300,
        end_ms: 500,
      });
      await until(() => commentary(relay).length === 2, 'second delegated result');
      send(relay, {
        type: 'session.output_transcript.delta',
        event_id: 'two-output',
        delta: 'Second done.',
      });
      await until(() => writes.length === 4, 'second turn persistence');

      expect(inputs.map(input => input.text)).toEqual(['First task', 'Second task']);
      expect(commentary(relay).map(event => event.delegation_id)).toEqual([
        'delegate-one',
        'delegate-two',
      ]);
      expect(writes.map(({ role, text }) => ({ role, text }))).toEqual([
        { role: 'dan', text: 'First task' },
        { role: 'jarvis', text: 'First done.' },
        { role: 'dan', text: 'Second task' },
        { role: 'jarvis', text: 'Second done.' },
      ]);
      expectOpen(relay);
    }, 15_000);
  });

  it('sends a controlled PI failure commentary without switching engines', async () => {
    const store = {
      createSession: async () => ({
        id: '72', channel: 'voice', language: 'en', startedAt: new Date(), endedAt: null,
      }),
      endSession: async () => true,
      addMessage: async (input: { sessionId: string; role: string; text: string; model: string | null }) => ({
        id: '720',
        sessionId: input.sessionId,
        role: input.role,
        text: input.text,
        model: input.model,
        at: new Date(),
      } as ConversationMessage),
    } as unknown as ConversationStore;
    const agent: PiVoiceAgent = {
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error('authoritative PI failure');
      },
    };
    const relay = await startRelay(store, agent);
    relay.browser.send(JSON.stringify({ type: 'jarvis.microphone.active' }));
    relay.upstreamSockets[0]!.send(JSON.stringify({
      type: 'session.input_transcript.delta',
      event_id: 'failure-input',
      delta: 'Save the item',
      start_ms: 0,
      end_ms: 100,
    }));
    relay.upstreamSockets[0]!.send(JSON.stringify({
      type: 'session.delegation.created',
      event_id: 'failure-delegation',
      offset_ms: 100,
      delegation: { id: 'delegate-failure', target: 'client' },
    }));
    await until(() => relay.upstreamEvents.some(event =>
      event.type === 'session.commentary.append' &&
      event.content === 'PI could not answer that. No other engine was used.'
    ), 'authoritative PI failure commentary');

    expect(relay.upstreamEvents.filter(event =>
      event.type === 'session.commentary.append'
    )).toEqual([
      expect.objectContaining({
        delegation_id: 'delegate-failure',
        content: 'PI could not answer that. No other engine was used.',
      }),
    ]);
    expect(relay.received.some(event => event.type === 'jarvis.session.failed')).toBe(false);
  });

  describe('PI work in flight', () => {
    const storeFor = (id: string) => ({
      createSession: async () => ({
        id, channel: 'voice', language: 'en', startedAt: new Date(), endedAt: null,
      }),
      endSession: async () => true,
      addMessage: async (input: { sessionId: string; role: string; text: string; model: string | null }) => ({
        id: `${id}0`,
        sessionId: input.sessionId,
        role: input.role,
        text: input.text,
        model: input.model,
        at: new Date(),
      } as ConversationMessage),
    } as unknown as ConversationStore);

    // Each PI turn waits until the test hands it a reply, and records whether it was aborted first.
    const gatedAgent = () => {
      const runs: Array<{ text: string; aborted: () => boolean; reply: (text: string) => void }> = [];
      const agent: PiVoiceAgent = {
        async *stream(input, _authorization, signal) {
          let reply!: (text: string) => void;
          const answer = new Promise<string>((resolve, reject) => {
            reply = resolve;
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
          runs.push({ text: input.text, aborted: () => signal.aborted, reply });
          yield await answer;
        },
      };
      return { agent, runs };
    };

    const say = (relay: Awaited<ReturnType<typeof startRelay>>, id: string, text: string, from: number, to: number) =>
      relay.upstreamSockets[0]!.send(JSON.stringify({
        type: 'session.input_transcript.delta', event_id: id, delta: text, start_ms: from, end_ms: to,
      }));
    const delegate = (relay: Awaited<ReturnType<typeof startRelay>>, id: string, offset: number) =>
      relay.upstreamSockets[0]!.send(JSON.stringify({
        type: 'session.delegation.created', event_id: `${id}-event`, offset_ms: offset,
        delegation: { id, target: 'client' },
      }));
    const heard = (relay: Awaited<ReturnType<typeof startRelay>>, text: string) =>
      relay.received.some(event => event.type === 'jarvis.voice.input_transcript.delta' && event.delta === text);
    const commentary = (relay: Awaited<ReturnType<typeof startRelay>>) =>
      relay.upstreamEvents.filter(event => event.type === 'session.commentary.append');

    it('leaves the running PI turn alone when Dan speaks without delegating', async () => {
      const { agent, runs } = gatedAgent();
      const relay = await startRelay(storeFor('73'), agent);
      relay.browser.send(JSON.stringify({ type: 'jarvis.microphone.active' }));
      say(relay, 'work-input', 'Check the build', 0, 100);
      delegate(relay, 'delegate-work', 100);
      await until(() => runs.length === 1, 'PI turn start');

      say(relay, 'backchannel-input', 'mm-hm', 201, 250);
      await until(() => heard(relay, 'mm-hm'), 'relay to take the backchannel transcript');
      expect(runs).toHaveLength(1);
      expect(runs[0]!.aborted()).toBe(false);

      runs[0]!.reply('The build is green.');
      await until(() => commentary(relay).length > 0, 'PI result commentary');
      expect(commentary(relay)).toEqual([expect.objectContaining({
        delegation_id: 'delegate-work',
        content: 'The build is green.',
      })]);
      expect(runs).toHaveLength(1);
    }, 15_000);

    it('lets a new delegation take over the running PI turn, as a steering message does in Chat', async () => {
      const { agent, runs } = gatedAgent();
      const relay = await startRelay(storeFor('74'), agent);
      relay.browser.send(JSON.stringify({ type: 'jarvis.microphone.active' }));
      say(relay, 'first-input', 'Check the build', 0, 100);
      delegate(relay, 'delegate-first', 100);
      await until(() => runs.length === 1, 'first PI turn');

      say(relay, 'second-input', 'Check the deploy instead', 201, 300);
      delegate(relay, 'delegate-second', 300);
      await until(() => runs.length === 2, 'second PI turn');
      expect(runs[0]!.aborted()).toBe(true);
      expect(runs[1]!.aborted()).toBe(false);

      runs[1]!.reply('The deploy is fine.');
      await until(() => commentary(relay).length > 0, 'second PI result');
      await sleep(50);
      expect(runs.map(run => run.text)).toEqual(['Check the build', 'Check the deploy instead']);
      expect(commentary(relay)).toEqual([expect.objectContaining({
        delegation_id: 'delegate-second',
        content: 'The deploy is fine.',
      })]);
    }, 15_000);

    it('starts the request exactly once when Dan backchannels while the delegation is still settling', async () => {
      const { agent, runs } = gatedAgent();
      const relay = await startRelay(storeFor('76'), agent);
      relay.browser.send(JSON.stringify({ type: 'jarvis.microphone.active' }));
      say(relay, 'settle-input', 'Check the build', 0, 100);
      delegate(relay, 'delegate-settle', 100);
      say(relay, 'settle-backchannel', 'mm-hm', 201, 250);
      await until(() => heard(relay, 'mm-hm'), 'relay to take the backchannel transcript');
      expect(runs).toHaveLength(0);

      await until(() => runs.length === 1, 'delegated PI turn after settling');
      await sleep(150);
      expect(runs.map(run => run.text)).toEqual(['Check the build']);
      expect(runs[0]!.aborted()).toBe(false);

      runs[0]!.reply('The build is green.');
      await until(() => commentary(relay).length > 0, 'PI result commentary');
      await sleep(50);
      expect(commentary(relay)).toEqual([expect.objectContaining({
        delegation_id: 'delegate-settle',
        content: 'The build is green.',
      })]);
    }, 15_000);

    it('lets a correction delegated while the first is settling take over and answers once', async () => {
      const { agent, runs } = gatedAgent();
      const relay = await startRelay(storeFor('77'), agent);
      relay.browser.send(JSON.stringify({ type: 'jarvis.microphone.active' }));
      say(relay, 'early-input', 'Check the build', 0, 100);
      delegate(relay, 'delegate-early', 100);
      say(relay, 'correction-input', 'Check the deploy instead', 201, 300);
      delegate(relay, 'delegate-correction', 300);
      await until(() => runs.length === 1, 'corrected PI turn');
      await sleep(800);

      expect(runs.map(run => run.text)).toEqual(['Check the deploy instead']);
      runs[0]!.reply('The deploy is fine.');
      await until(() => commentary(relay).length > 0, 'corrected PI result');
      await sleep(50);
      expect(commentary(relay)).toEqual([expect.objectContaining({
        delegation_id: 'delegate-correction',
        content: 'The deploy is fine.',
      })]);
    }, 15_000);

    it('still stops the running PI turn when Dan ends the session', async () => {
      const { agent, runs } = gatedAgent();
      const relay = await startRelay(storeFor('75'), agent);
      relay.browser.send(JSON.stringify({ type: 'jarvis.microphone.active' }));
      say(relay, 'end-input', 'Check the build', 0, 100);
      delegate(relay, 'delegate-end', 100);
      await until(() => runs.length === 1, 'PI turn start');

      relay.browser.send(JSON.stringify({ type: 'jarvis.session.end' }));
      await until(() => runs[0]!.aborted(), 'PI turn cancelled by session end');
      expect(commentary(relay)).toEqual([]);
    }, 15_000);
  });
});
