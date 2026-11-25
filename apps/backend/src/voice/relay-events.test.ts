import { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { ConversationAgentInput } from '../core/chat-agent.js';
import { failureCopy } from '@jarvis/contracts';
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

async function startRelay(store: ConversationStore, piAgent: PiVoiceAgent, logs?: string[]) {
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
    logs
      ? createLogger({ ...config, logLevel: 'info' } as typeof config, undefined, new Writable({
        write(chunk: Buffer, _encoding, done) { logs.push(chunk.toString()); done(); },
      }))
      : createLogger({ ...config, logLevel: 'silent' } as typeof config),
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
    await until(() => relay.received.some(event =>
      event.type === 'jarvis.voice.input_transcript.completed' && event.transcript === 'Hello Jarvis'
    ), 'completed input transcript');
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

  it('sends the whole current turn to PI whatever offset the delegation carries', async () => {
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
    // The offset lies before the new words; it is not where the turn ends, so it must not drop them.
    relay.upstreamSockets[0]!.send(JSON.stringify({
      type: 'session.delegation.created',
      event_id: 'offset-delegation',
      offset_ms: 100,
      delegation: { id: 'delegate-offset', target: 'client' },
    }));
    await until(() => inputs.length === 1, 'delegated owner turn');
    await sleep(100);
    expect(inputs.map(input => input.text)).toEqual(['New request']);
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
      event.content === failureCopy.cut_off.voice
    ), 'authoritative PI failure commentary');

    expect(relay.upstreamEvents.filter(event =>
      event.type === 'session.commentary.append'
    )).toEqual([
      expect.objectContaining({
        delegation_id: 'delegate-failure',
        content: failureCopy.cut_off.voice,
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
      say(relay, 'settle-backchannel', ' mm-hm', 201, 250);
      await until(() => heard(relay, ' mm-hm'), 'relay to take the backchannel transcript');
      expect(runs).toHaveLength(0);

      await until(() => runs.length === 1, 'delegated PI turn after settling');
      await sleep(150);
      // Words that arrive before PI starts belong to the same request; it still starts once.
      expect(runs.map(run => run.text)).toEqual(['Check the build mm-hm']);
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
      say(relay, 'early-input', 'Check the build. ', 0, 100);
      delegate(relay, 'delegate-early', 100);
      say(relay, 'correction-input', 'No, check the deploy instead', 201, 300);
      delegate(relay, 'delegate-correction', 300);
      await until(() => runs.length === 1, 'corrected PI turn');
      await sleep(800);

      // The correction arrived before PI started, so PI hears the whole turn once and the newest delegation answers it.
      expect(runs.map(run => run.text)).toEqual(['Check the build. No, check the deploy instead']);
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

  describe("Dan's sentence arrives word by word while GPT-Live is already answering", () => {
    type Relay = Awaited<ReturnType<typeof startRelay>>;
    const recordingStore = (writes: Array<{ role: string; text: string; sourceItemId?: string }>) => ({
      createSession: async () => ({
        id: '78', channel: 'voice', language: 'en', startedAt: new Date(), endedAt: null,
      }),
      endSession: async () => true,
      addMessage: async (input: {
        sessionId: string;
        role: string;
        text: string;
        model: string | null;
        sourceItemId?: string;
      }) => {
        writes.push({
          role: input.role,
          text: input.text,
          ...(input.sourceItemId ? { sourceItemId: input.sourceItemId } : {}),
        });
        return {
          id: String(7800 + writes.length), sessionId: input.sessionId, role: input.role,
          text: input.text, model: input.model, at: new Date(),
        } as ConversationMessage;
      },
    } as unknown as ConversationStore);
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
    const send = (relay: Relay, event: Record<string, unknown>) =>
      relay.upstreamSockets[0]!.send(JSON.stringify(event));
    const word = (relay: Relay, id: string, delta: string, from: number, to: number) =>
      send(relay, {
        type: 'session.input_transcript.delta', event_id: id, delta, start_ms: from, end_ms: to,
      });
    const speak = (relay: Relay, id: string, delta?: string) => {
      if (delta) send(relay, { type: 'session.output_transcript.delta', event_id: `${id}-text`, delta });
      send(relay, { type: 'session.output_audio.delta', event_id: `${id}-audio`, delta: 'AAE=' });
    };
    const delegate = (relay: Relay, id: string, offset: number) =>
      send(relay, {
        type: 'session.delegation.created', event_id: `${id}-event`, offset_ms: offset,
        delegation: { id, target: 'client' },
      });
    const commentary = (relay: Relay) =>
      relay.upstreamEvents.filter(event => event.type === 'session.commentary.append');
    const captionDeltas = (relay: Relay) =>
      relay.received.filter(event => event.type === 'jarvis.voice.input_transcript.delta');
    const activity = (relay: Relay) =>
      relay.received.filter(event => event.type === 'jarvis.voice.activity').map(event => event.state);

    it('returns to thinking when an acknowledgement ends, even while its history write is blocked', async () => {
      const { agent, runs } = gatedAgent();
      const writes: Array<{ role: string; text: string }> = [];
      const store = recordingStore(writes);
      const addMessage = store.addMessage;
      let releaseWrite!: () => void;
      const writeGate = new Promise<void>(resolve => { releaseWrite = resolve; });
      store.addMessage = async input => {
        if (input.role === 'jarvis') await writeGate;
        return addMessage(input);
      };
      const relay = await startRelay(store, agent);
      relay.browser.send(JSON.stringify({ type: 'jarvis.microphone.active' }));
      await until(() => activity(relay).at(-1) === 'listening', 'microphone active');
      word(relay, 'activity-question', 'Check my calendar', 0, 800);
      delegate(relay, 'activity-delegation', 800);
      await until(() => runs.length === 1, 'delegated tool work');
      try {
        expect(activity(relay).at(-1)).toBe('thinking');
        speak(relay, 'activity-ack', 'I will check.');
        await until(() => activity(relay).at(-1) === 'speaking', 'acknowledgement audio');
        await until(() => relay.received.some(event => event.type === 'jarvis.voice.response.completed'),
          'acknowledgement completed');
        expect(activity(relay)).toEqual(['listening', 'thinking', 'speaking', 'thinking']);
        expect(writes).toEqual([{ role: 'dan', text: 'Check my calendar', sourceItemId: expect.any(String) }]);
      } finally {
        releaseWrite();
        runs[0]!.reply('Your calendar is clear.');
      }
      await until(() => commentary(relay).some(event => event.content === 'Your calendar is clear.'),
        'answer handed to GPT-Live but not yet spoken');
      expect(activity(relay).at(-1)).toBe('thinking');
      speak(relay, 'activity-answer', 'Your calendar is clear.');
      await until(() => relay.received.filter(event => event.type === 'jarvis.voice.response.completed').length === 2,
        'answer completed');
      expect(activity(relay)).toEqual(['listening', 'thinking', 'speaking', 'thinking', 'speaking', 'listening']);
      await until(() => writes.length === 3, 'acknowledgement and answer persisted');
    }, 20_000);

    it('keeps one owner message and one PI turn when the delegation lands mid-sentence', async () => {
      const writes: Array<{ role: string; text: string; sourceItemId?: string }> = [];
      const { agent, runs } = gatedAgent();
      const relay = await startRelay(recordingStore(writes), agent);
      relay.browser.send(JSON.stringify({ type: 'jarvis.microphone.active' }));

      word(relay, 'w1', 'Check ', 0, 200);
      await sleep(30);
      speak(relay, 'a1', 'OK, ');
      await sleep(30);
      word(relay, 'w2', 'my ', 200, 400);
      speak(relay, 'a2');
      await sleep(30);
      word(relay, 'w3', 'Azure ', 400, 600);
      await sleep(30);
      delegate(relay, 'delegate-azure', 900);
      speak(relay, 'a3', 'checking now. ');
      await sleep(30);
      word(relay, 'w4', 'resource ', 600, 800);
      speak(relay, 'a4');
      await sleep(30);
      word(relay, 'w5', 'groups', 800, 900);
      speak(relay, 'a5');
      await until(() => activity(relay).includes('speaking'), 'speaking activity');
      expect(writes).toEqual([]);

      await until(() => runs.length === 1, 'delegated PI turn');
      expect(runs[0]!.text).toBe('Check my Azure resource groups');
      // PI is working and the reply is still playing: the screen must not fall back to listening.
      expect(activity(relay).slice(activity(relay).indexOf('speaking')).includes('listening')).toBe(false);

      word(relay, 'mm', 'mm-hm', 1_000, 1_050);
      await sleep(100);
      expect(runs).toHaveLength(1);
      expect(runs[0]!.aborted()).toBe(false);

      runs[0]!.reply('You have three resource groups.');
      await until(() => commentary(relay).some(event => event.content === 'You have three resource groups.'),
        'PI result commentary');
      await until(() => writes.some(write => write.role === 'jarvis'), 'assistant message');

      const owner = writes.filter(write => write.role === 'dan' && write.text.includes('Check'));
      expect(owner).toHaveLength(1);
      expect(owner[0]!.text).toBe('Check my Azure resource groups');
      expect(writes.findIndex(write => write.role === 'dan')).toBeLessThan(
        writes.findIndex(write => write.role === 'jarvis'),
      );
      expect(runs).toHaveLength(1);
      expect(commentary(relay).some(event =>
        typeof event.content === 'string' && event.content.includes('did not catch'))).toBe(false);
      const sentence = captionDeltas(relay).filter(event => event.delta !== 'mm-hm');
      expect(sentence.map(event => event.delta)).toEqual(['Check ', 'my ', 'Azure ', 'resource ', 'groups']);
      expect(new Set(sentence.map(event => event.itemId)).size).toBe(1);
      expect(owner[0]!.sourceItemId).toBe(sentence[0]!.itemId);
    }, 20_000);

    it('still stops the whole-sentence PI turn when Dan ends the session', async () => {
      const { agent, runs } = gatedAgent();
      const relay = await startRelay(recordingStore([]), agent);
      relay.browser.send(JSON.stringify({ type: 'jarvis.microphone.active' }));
      word(relay, 'e1', 'Check ', 0, 200);
      speak(relay, 'e-a1', 'OK. ');
      await sleep(30);
      word(relay, 'e2', 'Azure', 200, 400);
      delegate(relay, 'delegate-end-words', 400);
      await until(() => runs.length === 1, 'PI turn start');
      expect(runs[0]!.text).toBe('Check Azure');

      relay.browser.send(JSON.stringify({ type: 'jarvis.session.end' }));
      await until(() => runs[0]!.aborted(), 'PI turn cancelled by session end');
    }, 20_000);

    it('waits for a transcript that trails the delegation instead of asking Dan to repeat', async () => {
      const writes: Array<{ role: string; text: string }> = [];
      const { agent, runs } = gatedAgent();
      const relay = await startRelay(recordingStore(writes), agent);
      relay.browser.send(JSON.stringify({ type: 'jarvis.microphone.active' }));

      delegate(relay, 'delegate-late', 600);
      speak(relay, 'late-a1', 'OK, checking. ');
      await sleep(800);
      expect(commentary(relay)).toEqual([]);
      word(relay, 'late-w1', 'Check Azure ', 0, 400);
      await sleep(50);
      word(relay, 'late-w2', 'resource groups', 400, 600);

      await until(() => runs.length === 1, 'PI turn from the trailing transcript');
      expect(runs[0]!.text).toBe('Check Azure resource groups');
      expect(commentary(relay)).toEqual([]);
      expect(writes.filter(write => write.role === 'dan').map(write => write.text))
        .toEqual(['Check Azure resource groups']);
      runs[0]!.reply('Done.');
      await until(() => commentary(relay).length === 1, 'PI result');
    }, 20_000);

    it.each([150, 1_000])(
      'stores Dan before the acknowledgement when the transcript trails the delegation by %i ms',
      async (trailingMs) => {
        const writes: Array<{ role: string; text: string }> = [];
        const { agent, runs } = gatedAgent();
        const relay = await startRelay(recordingStore(writes), agent);
        relay.browser.send(JSON.stringify({ type: 'jarvis.microphone.active' }));

        delegate(relay, 'delegate-order', 400);
        speak(relay, 'order-a1', 'OK. ');
        await sleep(trailingMs);
        word(relay, 'order-w1', 'Check Azure ', 0, 200);
        word(relay, 'order-w2', 'resource groups', 200, 400);

        await until(() => writes.length >= 2, 'owner and acknowledgement messages', 1_000);
        expect(writes.slice(0, 2).map(write => `${write.role}:${write.text}`)).toEqual([
          'dan:Check Azure resource groups',
          'jarvis:OK. ',
        ]);
        await until(() => runs.length === 1, 'PI turn');
        expect(runs[0]!.text).toBe('Check Azure resource groups');
        expect(commentary(relay)).toEqual([]);
      },
      20_000,
    );

    it('only falls back to the did-not-catch reply when no words ever arrive', async () => {
      const { agent, runs } = gatedAgent();
      const relay = await startRelay(recordingStore([]), agent);
      relay.browser.send(JSON.stringify({ type: 'jarvis.microphone.active' }));

      delegate(relay, 'delegate-silent', 300);
      await sleep(1_500);
      expect(commentary(relay)).toEqual([]);
      await until(() => commentary(relay).length === 1, 'did-not-catch fallback', 1_000);
      expect(commentary(relay)[0]).toEqual(expect.objectContaining({
        delegation_id: 'delegate-silent',
        content: failureCopy.did_not_catch.voice,
      }));
      expect(runs).toHaveLength(0);
    }, 20_000);

    it('stores a direct sentence whole when GPT-Live answers before Dan has finished', async () => {
      const writes: Array<{ role: string; text: string; sourceItemId?: string }> = [];
      const relay = await startRelay(recordingStore(writes), {
        async *stream() { yield 'PI is not used for a direct reply.'; },
      });
      relay.browser.send(JSON.stringify({ type: 'jarvis.microphone.active' }));

      word(relay, 'd1', 'Tell ', 0, 200);
      for (const [index, text] of ['me ', 'about ', 'the ', 'weather'].entries()) {
        await sleep(250);
        speak(relay, `d-a${index}`, index === 0 ? 'Sure. ' : undefined);
        word(relay, `d${index + 2}`, text, 200 * (index + 1), 200 * (index + 2));
      }
      await until(() => writes.length === 2, 'direct owner and reply messages', 1_000);

      expect(writes.map(write => `${write.role}:${write.text}`)).toEqual([
        'dan:Tell me about the weather',
        'jarvis:Sure. ',
      ]);
      expect(new Set(captionDeltas(relay).map(event => event.itemId)).size).toBe(1);
    }, 20_000);
  });
  describe("Dan's whole spoken request, as GPT-Live really sends it", () => {
    type Relay = Awaited<ReturnType<typeof startRelay>>;
    type Write = { role: string; text: string; sourceItemId?: string };
    const recordingStore = (writes: Write[]) => ({
      createSession: async () => ({
        id: '79', channel: 'voice', language: 'en', startedAt: new Date(), endedAt: null,
      }),
      endSession: async () => true,
      addMessage: async (input: {
        sessionId: string; role: string; text: string; model: string | null; sourceItemId?: string;
      }) => {
        writes.push({
          role: input.role, text: input.text, ...(input.sourceItemId ? { sourceItemId: input.sourceItemId } : {}),
        });
        return {
          id: String(7900 + writes.length), sessionId: input.sessionId, role: input.role,
          text: input.text, model: input.model, at: new Date(),
        } as ConversationMessage;
      },
    } as unknown as ConversationStore);
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
    const send = (relay: Relay, event: Record<string, unknown>) =>
      relay.upstreamSockets[0]!.send(JSON.stringify(event));
    // Timestamps run on from word to word, as the provider's input timeline does.
    let clock = 0;
    const word = (relay: Relay, delta: string, lengthMs = 300) => {
      send(relay, {
        type: 'session.input_transcript.delta', event_id: `w${clock}`, delta, start_ms: clock, end_ms: clock + lengthMs,
      });
      clock += lengthMs;
    };
    const delegate = (relay: Relay, id: string, offsetMs: number) =>
      send(relay, {
        type: 'session.delegation.created', event_id: `${id}-event`, offset_ms: offsetMs,
        delegation: { id, target: 'client' },
      });
    const answer = (relay: Relay, id: string, delta: string) => {
      send(relay, { type: 'session.output_transcript.delta', event_id: `${id}-text`, delta });
      send(relay, { type: 'session.output_audio.delta', event_id: `${id}-audio`, delta: 'AAE=' });
    };
    const commentary = (relay: Relay) =>
      relay.upstreamEvents.filter(event => event.type === 'session.commentary.append');
    const captionItems = (relay: Relay) => [...new Set(relay.received
      .filter(event => event.type === 'jarvis.voice.input_transcript.delta').map(event => event.itemId))];
    const started = (relay: Relay) => {
      relay.browser.send(JSON.stringify({ type: 'jarvis.microphone.active' }));
      clock = 0;
    };

    it('sends the full sentence to PI once when the transcript keeps arriving after the delegation event', async () => {
      const writes: Write[] = [];
      const { agent, runs } = gatedAgent();
      const relay = await startRelay(recordingStore(writes), agent);
      started(relay);

      word(relay, 'What ');
      word(relay, 'is the weather ');
      delegate(relay, 'delegate-weather', 600);
      // The delegation's offset is far behind the words still to come; each gap is shorter than the quiet window.
      for (const text of ['in ', 'Copenhagen ', 'tomorrow ', 'morning']) {
        await sleep(350);
        word(relay, text);
        expect(runs).toHaveLength(0);
      }
      await until(() => runs.length === 1, 'PI turn with the whole sentence');
      await sleep(900);

      expect(runs.map(run => run.text)).toEqual(['What is the weather in Copenhagen tomorrow morning']);
      expect(commentary(relay)).toEqual([]);
      expect(writes.filter(write => write.role === 'dan').map(write => write.text))
        .toEqual(['What is the weather in Copenhagen tomorrow morning']);
      expect(captionItems(relay)).toHaveLength(1);
    }, 20_000);

    it('sends a transcript that arrives entirely after the delegation, after an earlier direct answer', async () => {
      const writes: Write[] = [];
      const { agent, runs } = gatedAgent();
      const relay = await startRelay(recordingStore(writes), agent);
      started(relay);

      word(relay, 'Hello Jarvis');
      answer(relay, 'greeting', 'Hello Dan.');
      await until(() => writes.length === 2, 'direct turn stored', 1_000);
      // GPT-Live named a far-off offset and no words are in yet: the group is empty, not "I did not catch that".
      delegate(relay, 'delegate-late-words', 20_000);
      await sleep(1_000);
      expect(commentary(relay)).toEqual([]);
      word(relay, 'Will it ');
      await sleep(300);
      word(relay, 'rain today');

      await until(() => runs.length === 1, 'PI turn from the late transcript');
      await sleep(900);
      expect(runs.map(run => run.text)).toEqual(['Will it rain today']);
      expect(commentary(relay)).toEqual([]);
      expect(writes.filter(write => write.role === 'dan').map(write => write.text))
        .toEqual(['Hello Jarvis', 'Will it rain today']);
    }, 20_000);

    it('shows Thinking before a direct reply and returns to Listening if the owner continues', async () => {
      const writes: Write[] = [];
      const relay = await startRelay(recordingStore(writes), {
        async *stream() { yield 'unused'; },
      });
      const states = () => relay.received.filter(event => event.type === 'jarvis.voice.activity').map(event => event.state);
      started(relay);
      word(relay, 'Show the forecast');
      await until(() => states().at(-1) === 'thinking', 'thinking before response starts');
      expect(relay.received.some(event => event.type === 'jarvis.voice.response.started')).toBe(false);
      word(relay, ' for tomorrow');
      await until(() => states().at(-1) === 'listening', 'listening during resumed input');
      await until(() => states().at(-1) === 'thinking', 'thinking after the last phrase');
      answer(relay, 'forecast', 'Sunny.');
      await until(() => writes.length === 2, 'completed exchange');
      expect(writes[0]?.text).toBe('Show the forecast for tomorrow');
      expect(states().at(-1)).toBe('listening');
    }, 20_000);

    it.each([700, 900])(
      'sends the whole sentence to PI once when Dan pauses %i ms twice after the delegation event',
      async (pauseMs) => {
        const writes: Write[] = [];
        const { agent, runs } = gatedAgent();
        const relay = await startRelay(recordingStore(writes), agent);
        started(relay);

        word(relay, 'Check ');
        delegate(relay, 'delegate-pauses', 300);
        await sleep(pauseMs);
        expect(runs).toHaveLength(0);
        word(relay, 'the build on ');
        await sleep(pauseMs);
        expect(runs).toHaveLength(0);
        word(relay, 'the main branch');
        await until(() => runs.length === 1, 'PI turn with the whole sentence');
        await sleep(1_000);

        expect(runs.map(run => run.text)).toEqual(['Check the build on the main branch']);
        expect(commentary(relay)).toEqual([]);
        expect(writes.filter(write => write.role === 'dan').map(write => write.text))
          .toEqual(['Check the build on the main branch']);
        expect(captionItems(relay)).toHaveLength(1);
      },
      20_000,
    );

    it('answers with the stored message of words GPT-Live had already started answering when it delegates', async () => {
      const writes: Write[] = [];
      const { agent, runs } = gatedAgent();
      const relay = await startRelay(recordingStore(writes), agent);
      started(relay);

      word(relay, 'Check my calendar');
      await sleep(1_700);
      answer(relay, 'one-moment', 'Sure, one moment.');
      await until(() => writes.length === 1, 'direct owner message stored first', 1_000);
      delegate(relay, 'delegate-after-direct', 300);

      await until(() => runs.length === 1, 'PI turn from the stored message');
      await sleep(1_000);
      expect(runs.map(run => run.text)).toEqual(['Check my calendar']);
      expect(commentary(relay)).toEqual([]);
      await until(() => writes.length === 2, 'reply stored after the owner message', 1_000);
      expect(writes.map(write => `${write.role}:${write.text}`)).toEqual([
        'dan:Check my calendar', 'jarvis:Sure, one moment.',
      ]);
      runs[0]!.reply('Your calendar is clear.');
      await until(() => commentary(relay).length === 1, 'PI result');
      expect(commentary(relay)[0]).toEqual(expect.objectContaining({
        delegation_id: 'delegate-after-direct', content: 'Your calendar is clear.',
      }));
      expect(runs).toHaveLength(1);
      expect(writes.filter(write => write.role === 'dan')).toHaveLength(1);
    }, 20_000);

    it('answers with the open turn when the delegation comes after a long quiet and before any reply', async () => {
      const writes: Write[] = [];
      const { agent, runs } = gatedAgent();
      const relay = await startRelay(recordingStore(writes), agent);
      started(relay);

      word(relay, 'Check my calendar');
      await sleep(1_700);
      delegate(relay, 'delegate-after-quiet', 300);
      await until(() => runs.length === 1, 'PI turn from the open turn');
      answer(relay, 'ack', 'One moment.');
      await until(() => writes.length === 2, 'owner message then reply', 1_000);
      await sleep(500);

      expect(runs.map(run => run.text)).toEqual(['Check my calendar']);
      expect(commentary(relay)).toEqual([]);
      expect(writes.map(write => `${write.role}:${write.text}`)).toEqual([
        'dan:Check my calendar', 'jarvis:One moment.',
      ]);
    }, 20_000);

    it('does not take a turn that already got a completed reply as the request of a later delegation', async () => {
      const writes: Write[] = [];
      const { agent, runs } = gatedAgent();
      const relay = await startRelay(recordingStore(writes), agent);
      started(relay);

      word(relay, 'Check my calendar');
      await sleep(1_700);
      answer(relay, 'full-answer', 'Your calendar is clear.');
      await until(() => writes.length === 2, 'answered exchange stored', 1_500);
      delegate(relay, 'delegate-new-request', 300);
      await sleep(1_200);
      expect(runs).toHaveLength(0);
      word(relay, 'Book a table');
      await until(() => runs.length === 1, 'PI turn for the new request');

      expect(runs.map(run => run.text)).toEqual(['Book a table']);
      expect(commentary(relay)).toEqual([]);
    }, 20_000);

    it('stores Dan\'s open words when the session ends before any reply or delegation', async () => {
      const writes: Write[] = [];
      const relay = await startRelay(recordingStore(writes), {
        async *stream() { yield 'unused'; },
      });
      const closed = new Promise<void>(resolve => relay.browser.once('close', () => resolve()));
      started(relay);

      word(relay, 'Remind me to call mum');
      await sleep(100);
      relay.browser.send(JSON.stringify({ type: 'jarvis.session.end' }));
      await closed;

      expect(writes.map(write => `${write.role}:${write.text}`)).toEqual(['dan:Remind me to call mum']);
    }, 20_000);

    it.each([700, 900])('stores three phrases separated by %i ms pauses as one message', async (pauseMs) => {
      const writes: Write[] = [];
      const relay = await startRelay(recordingStore(writes), {
        async *stream() { yield 'PI is not used for a direct reply.'; },
      });
      started(relay);

      word(relay, 'Tell me ');
      await sleep(pauseMs);
      word(relay, 'what the weather is ');
      await sleep(pauseMs);
      word(relay, 'like tomorrow');
      await sleep(pauseMs);
      expect(writes).toEqual([]);
      answer(relay, 'forecast', 'Sunny.');
      await until(() => writes.length === 2, 'owner and reply messages', 1_000);

      expect(writes.map(write => `${write.role}:${write.text}`)).toEqual([
        'dan:Tell me what the weather is like tomorrow',
        'jarvis:Sunny.',
      ]);
      expect(captionItems(relay)).toHaveLength(1);
      await until(() => relay.received.some(event => event.type === 'jarvis.voice.input_transcript.completed'),
        'completed caption');
      expect(relay.received.filter(event => event.type === 'jarvis.voice.input_transcript.completed'))
        .toEqual([expect.objectContaining({ transcript: 'Tell me what the weather is like tomorrow' })]);
    }, 20_000);

    it('keeps one message when GPT-Live starts answering inside a natural pause of the sentence', async () => {
      const writes: Write[] = [];
      const relay = await startRelay(recordingStore(writes), {
        async *stream() { yield 'PI is not used for a direct reply.'; },
      });
      started(relay);

      word(relay, 'Tell me ');
      await sleep(800);
      answer(relay, 'early', 'Sure. ');
      await sleep(100);
      word(relay, 'about the weather');
      await until(() => writes.length === 2, 'owner and reply messages', 1_000);

      expect(writes.map(write => `${write.role}:${write.text}`)).toEqual([
        'dan:Tell me about the weather',
        'jarvis:Sure. ',
      ]);
      expect(captionItems(relay)).toHaveLength(1);
    }, 20_000);

    it('stores a phrase, the answer to it and the next phrase as separate messages in order', async () => {
      const writes: Write[] = [];
      const relay = await startRelay(recordingStore(writes), {
        async *stream() { yield 'PI is not used for a direct reply.'; },
      });
      started(relay);

      word(relay, 'Hello Jarvis');
      answer(relay, 'first', 'Hello Dan.');
      await until(() => writes.length === 2, 'first exchange', 1_000);
      word(relay, 'How are you');
      answer(relay, 'second', 'Very well.');
      await until(() => writes.length === 4, 'second exchange', 1_000);

      expect(writes.map(write => `${write.role}:${write.text}`)).toEqual([
        'dan:Hello Jarvis', 'jarvis:Hello Dan.', 'dan:How are you', 'jarvis:Very well.',
      ]);
      expect(captionItems(relay)).toHaveLength(2);
    }, 20_000);

    it('treats words after PI has started as a new turn and lets the next delegation supersede', async () => {
      const writes: Write[] = [];
      const { agent, runs } = gatedAgent();
      const relay = await startRelay(recordingStore(writes), agent);
      started(relay);

      word(relay, 'Check the build');
      delegate(relay, 'delegate-first-try', 300);
      await until(() => runs.length === 1, 'first PI turn');

      word(relay, 'Actually check the deploy');
      expect(runs).toHaveLength(1);
      expect(runs[0]!.aborted()).toBe(false);
      delegate(relay, 'delegate-correction', 900);
      await until(() => runs.length === 2, 'correcting PI turn');

      expect(runs.map(run => run.text)).toEqual(['Check the build', 'Actually check the deploy']);
      expect(runs[0]!.aborted()).toBe(true);
      expect(runs[1]!.aborted()).toBe(false);
      expect(writes.filter(write => write.role === 'dan').map(write => write.text))
        .toEqual(['Check the build', 'Actually check the deploy']);
      expect(captionItems(relay)).toHaveLength(2);
      runs[1]!.reply('The deploy is fine.');
      await until(() => commentary(relay).length === 1, 'result of the correction');
      expect(commentary(relay)[0]).toEqual(expect.objectContaining({ delegation_id: 'delegate-correction' }));
    }, 20_000);

    it('does not cancel PI for GPT-Live\'s own backchannel while the delegation waits', async () => {
      const writes: Write[] = [];
      const { agent, runs } = gatedAgent();
      const relay = await startRelay(recordingStore(writes), agent);
      started(relay);

      word(relay, 'Check my ');
      delegate(relay, 'delegate-backchannel', 300);
      answer(relay, 'mm', 'Mm-hm. ');
      await sleep(200);
      word(relay, 'calendar');
      await until(() => runs.length === 1, 'PI turn');
      await sleep(900);

      expect(runs.map(run => run.text)).toEqual(['Check my calendar']);
      expect(runs[0]!.aborted()).toBe(false);
      await until(() => writes.length >= 2, 'owner and backchannel messages', 1_000);
      expect(writes.slice(0, 2).map(write => `${write.role}:${write.text}`)).toEqual([
        'dan:Check my calendar', 'jarvis:Mm-hm. ',
      ]);
      expect(commentary(relay)).toEqual([]);
    }, 20_000);

    it('leaves nothing running when the session ends while the delegation is still waiting', async () => {
      const writes: Write[] = [];
      const { agent, runs } = gatedAgent();
      const relay = await startRelay(recordingStore(writes), agent);
      const closed = new Promise<void>(resolve => relay.browser.once('close', () => resolve()));
      started(relay);

      word(relay, 'Check the ');
      delegate(relay, 'delegate-ended', 300);
      await sleep(200);
      word(relay, 'build');
      relay.browser.send(JSON.stringify({ type: 'jarvis.session.end' }));
      await closed;
      await sleep(1_000);

      expect(runs).toHaveLength(0);
      expect(commentary(relay)).toEqual([]);
      expect(writes.map(write => `${write.role}:${write.text}`)).toEqual(['dan:Check the build']);
    }, 20_000);

    it('logs the upstream error code and the activity trail without any transcript text', async () => {
      const logs: string[] = [];
      const relay = await startRelay(recordingStore([]), {
        async *stream() { yield 'unused'; },
      }, logs);
      started(relay);
      await until(() => relay.received.some(event => event.type === 'jarvis.voice.activity'), 'listening activity');
      answer(relay, 'speaking', 'Private reply words');
      await until(() => relay.received.some(event =>
        event.type === 'jarvis.voice.activity' && event.state === 'speaking'), 'speaking activity');

      send(relay, {
        type: 'error',
        error: {
          type: 'server_error', code: 'rate_limit_exceeded', param: 'session.audio[0]',
          message: 'Private reply words could not be spoken',
        },
      });
      await until(() => logs.some(line => line.includes('voice.upstream_event_error')), 'upstream error log');

      const records = logs.map(line => JSON.parse(line) as Record<string, unknown>);
      expect(records.find(record => record.msg === 'voice.upstream_event_error')).toMatchObject({
        failure: 'provider_error', errorType: 'server_error', errorCode: 'rate_limit_exceeded', param: 'session.audio[0]',
      });
      const published = records.filter(record => record.msg === 'voice.activity_published');
      expect(published.map(record => `${record.state}:${record.reason}`)).toEqual(expect.arrayContaining([
        'listening:microphone_active', 'thinking:response_started', 'speaking:output_audio',
      ]));
      expect(published.find(record => record.state === 'speaking')).toMatchObject({
        sinceLastMs: expect.any(Number), outputActive: true, piBusy: false, delegationPending: false,
      });
      expect(logs.join('')).not.toContain('Private');
    }, 20_000);
  });
});
