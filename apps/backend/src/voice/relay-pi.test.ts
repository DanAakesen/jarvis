import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { ConversationAgentChunk, ConversationAgentInput } from '../core/chat-agent.js';
import type { ConversationMessage, ConversationSession, ConversationStore } from '../core/conversation-store.js';
import { createLogger } from '../logging.js';
import { PiGatewayError } from '../pi/errors.js';
import type { PiVoiceAgent } from './pi-voice.js';
import { createVoiceRelayModule, VOICE_SUBPROTOCOL } from './relay.js';

const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(cleanup => cleanup())); });

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string) {
  for (let index = 0; index < 200; index += 1) { if (check()) return; await sleep(10); }
  throw new Error(`Timed out waiting for ${label}`);
}

interface VoiceEvent {
  type: string;
  reason?: string;
  itemId?: string;
  session?: { instructions: string; tools?: Array<{ name: string }>; tool_choice?: string };
  response?: { instructions: string; tools: unknown[]; tool_choice: string };
}

function memoryStore(): ConversationStore {
  let next = 1;
  const messages = new Map<string, ConversationMessage>();
  const session = { id: '7', channel: 'voice', language: 'en', startedAt: new Date(), endedAt: null } as unknown as ConversationSession;
  return {
    createSession: async () => session,
    getSession: async () => session,
    endSession: async () => true,
    addMessage: async (input) => {
      const message = { id: String(next++), sessionId: input.sessionId, role: input.role, text: input.text, model: input.model, createdAt: new Date() } as unknown as ConversationMessage;
      messages.set(message.id, message);
      return message;
    },
    updateMessage: async (id, text) => ({ ...messages.get(id)!, text }),
  } as unknown as ConversationStore;
}

async function harness(agent: PiVoiceAgent | undefined) {
  const upstream = new WebSocketServer({ port: 0 });
  const upstreamEvents: VoiceEvent[] = [];
  const sockets: WebSocket[] = [];
  upstream.on('connection', (socket) => {
    sockets.push(socket);
    socket.on('message', (data) => {
      const event = JSON.parse(data.toString()) as VoiceEvent;
      upstreamEvents.push(event);
      if (event.type === 'session.update') socket.send(JSON.stringify({ type: 'session.updated' }));
      if (event.type === 'response.create') {
        const id = `resp_${upstreamEvents.length}`;
        socket.send(JSON.stringify({ type: 'response.created', response: { id } }));
        socket.send(JSON.stringify({ type: 'response.done', response: { id, status: 'completed' } }));
      }
    });
  });
  await new Promise<void>(resolve => upstream.once('listening', resolve));
  const upstreamUrl = `ws://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  const app = buildApp(config, createLogger({ ...config, logLevel: 'silent' } as typeof config), {
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan' }),
    conversationStore: memoryStore(),
    ...(agent ? { piAgent: agent } : {}),
    modules: [createVoiceRelayModule({ getToken: async () => 'upstream-token', connect: () => new WebSocket(upstreamUrl) })],
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as AddressInfo).port;
  cleanups.push(async () => { await app.close(); for (const socket of sockets) socket.terminate(); upstream.close(); });
  const connect = (query: string) => {
    const browser = new WebSocket(`ws://127.0.0.1:${port}/voice${query}`, [VOICE_SUBPROTOCOL, 'jarvis.auth.aaa.bbb.ccc']);
    const received: VoiceEvent[] = [];
    let closed: { code: number; reason: string } | undefined;
    browser.on('message', data => { try { received.push(JSON.parse(data.toString())); } catch { /* binary audio */ } });
    browser.on('close', (code, reason) => { closed = { code, reason: reason.toString() }; });
    cleanups.push(async () => browser.terminate());
    return { browser, received, closed: () => closed };
  };
  const speak = (transcript: string, itemId = 'item_1') => {
    sockets[0]!.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: itemId, transcript }));
  };
  const responses = () => upstreamEvents.filter(event => event.type === 'response.create');
  return { app, upstreamEvents, sockets, connect, speak, responses };
}

describe('voice relay on the PI engine', () => {
  it('sends a spoken turn to the PI agent and has Voice Live read the answer, with no tools of its own', async () => {
    const inputs: ConversationAgentInput[] = [];
    const agent: PiVoiceAgent = {
      async *stream(input) { inputs.push(input); yield 'You have two meetings today.' as ConversationAgentChunk; },
    };
    const { app, connect, speak, responses, upstreamEvents } = await harness(agent);
    const { received } = connect('?engine=pi');
    await until(() => responses().length === 1, 'the greeting');
    const update = upstreamEvents.find(event => event.type === 'session.update')!;
    expect(update.session.tools).toBeUndefined();
    expect(update.session.instructions).toContain('You are only the voice of Jarvis');
    expect(received.some(event => event.type === 'jarvis.session.ready')).toBe(true);

    speak('What is on my calendar?');
    await until(() => inputs.length === 1, 'the PI turn');
    expect(inputs[0]).toMatchObject({ text: 'What is on my calendar?', channel: 'voice', sessionId: '7', messageId: '1' });
    await until(() => responses().length === 2, 'the spoken answer');
    const reply = responses()[1]!.response;
    expect(reply.tool_choice).toBe('none');
    expect(reply.tools).toEqual([]);
    expect(reply.instructions).toContain(JSON.stringify('You have two meetings today.'));
    const voice = (await app.systemStatusReader.read()).entries.find(entry => entry.id === 'foundry.voice');
    expect(voice).toMatchObject({
      status: 'ok',
      details: { engine: 'pi', evidence: 'voice-turn', outcome: 'ok' },
    });
  });

  it('cancels the PI turn in flight when Dan starts speaking, so no stale answer is spoken over him', async () => {
    let aborted = false;
    const agent: PiVoiceAgent = {
      async *stream(_input, _authorization, signal) {
        await new Promise<void>(resolve => signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
        yield 'Stale answer.' as ConversationAgentChunk;
      },
    };
    const { sockets, speak, responses, connect } = await harness(agent);
    connect('?engine=pi');
    await until(() => responses().length === 1, 'the greeting');
    speak('First question');
    await sleep(50);
    sockets[0]!.send(JSON.stringify({ type: 'input_audio_buffer.speech_started', item_id: 'item_2' }));
    await until(() => aborted, 'the cancellation');
    await sleep(50);
    expect(responses()).toHaveLength(1);
  });

  it('does not start a turn for an earlier utterance whose transcript arrives while Dan is speaking again', async () => {
    let calls = 0;
    const agent: PiVoiceAgent = { async *stream() { calls += 1; yield 'x' as ConversationAgentChunk; } };
    const { sockets, responses, connect } = await harness(agent);
    connect('?engine=pi');
    await until(() => responses().length === 1, 'the greeting');
    sockets[0]!.send(JSON.stringify({ type: 'input_audio_buffer.speech_started', item_id: 'item_2' }));
    await sleep(30);
    sockets[0]!.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_1', transcript: 'An older sentence' }));
    await sleep(100);
    expect(calls).toBe(0);
    expect(responses()).toHaveLength(1);
  });

  it('says a PI failure out loud and does not use another engine', async () => {
    const agent: PiVoiceAgent = {
      // eslint-disable-next-line require-yield
      async *stream() { throw new PiGatewayError('pi_budget_exhausted', 'PI has used its monthly cap, so it stopped. No other engine was used.'); },
    };
    const { app, connect, speak, responses } = await harness(agent);
    connect('?engine=pi');
    await until(() => responses().length === 1, 'the greeting');
    speak('Hello');
    await until(() => responses().length === 2, 'the spoken failure');
    expect(responses()[1]!.response.instructions).toContain('No other engine was used.');
    expect((await app.systemStatusReader.read()).entries.find(entry => entry.id === 'foundry.voice'))
      .toMatchObject({ status: 'down', details: { evidence: 'voice-turn', outcome: 'failed' } });
  });

  it('refuses typed requests and screen context on the default PI voice path', async () => {
    const agent: PiVoiceAgent = { async *stream() { yield 'x' as ConversationAgentChunk; } };
    const { connect, responses } = await harness(agent);
    const session = connect('');
    await until(() => responses().length === 1, 'the greeting');
    session.browser.send(JSON.stringify({ type: 'jarvis.screen.context', itemId: 'frame_1', description: 'a page' }));
    await until(() => session.received.some(event => event.type === 'jarvis.screen.context.unavailable'), 'the notice');
    expect(session.received.find(event => event.type === 'jarvis.screen.context.unavailable')).toMatchObject({ reason: 'not_supported', itemId: 'frame_1' });
    session.browser.send(JSON.stringify({ type: 'response.create' }));
    await until(() => session.closed() !== undefined, 'the close');
    expect(session.closed()).toMatchObject({ code: 1008 });
    expect(responses()).toHaveLength(1);
  });

  it('ends the session with an honest message when PI is not set up, instead of using the old engine', async () => {
    const { connect, upstreamEvents } = await harness(undefined);
    const session = connect('?engine=pi');
    await until(() => session.closed() !== undefined, 'the close');
    expect(session.closed()).toEqual({ code: 1011, reason: 'PI is not set up on this backend yet. No other engine was used.' });
    expect(upstreamEvents).toEqual([]);
  });

  it('refuses the obsolete Current voice selection instead of opening the old path', async () => {
    const { connect, responses, upstreamEvents } = await harness(undefined);
    const session = connect('?engine=current');
    await until(() => session.closed() !== undefined, 'the close');
    expect(session.closed()).toMatchObject({ code: 1008 });
    expect(responses()).toHaveLength(0);
    expect(upstreamEvents).toEqual([]);
  });

  it('routes an unnamed voice session to PI', async () => {
    const { connect, responses, speak, upstreamEvents } = await harness({
      async *stream() { yield 'Answer from PI.'; },
    });
    connect('');
    await until(() => responses().length === 1, 'the greeting');
    const update = upstreamEvents.find(event => event.type === 'session.update')!;
    expect(update.session?.instructions).toContain('You are only the voice of Jarvis');
    expect(update.session?.tools).toBeUndefined();
    speak('Hello');
    await until(() => responses().length === 2, 'the PI reply');
    expect(responses()[1]!.response.instructions).toContain('Answer from PI.');
  });

  it('refuses an unknown engine', async () => {
    const { connect } = await harness(undefined);
    const session = connect('?engine=other');
    await until(() => session.closed() !== undefined, 'the close');
    expect(session.closed()).toMatchObject({ code: 1008 });
  });
});
