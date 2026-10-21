import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserVoiceClient } from './voice-client';

class MockSocket extends EventTarget {
  readonly sent: Record<string, unknown>[] = [];
  readyState = 0;

  constructor(readonly url: string, readonly protocols: string[], autoReady = true) {
    super();
    queueMicrotask(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
      if (autoReady && url.endsWith('/voice')) {
        setTimeout(() => this.receive({ type: 'session.updated' }), 0);
      }
      if (autoReady && url.endsWith('/voice/da')) {
        setTimeout(() => this.receive({ type: 'session.created' }), 0);
      }
    });
  }

  send(message: string) {
    const event = JSON.parse(message) as Record<string, unknown>;
    this.sent.push(event);
    if (event.type === 'session.start') this.receive({ type: 'session.ready' });
    if (event.type === 'response.create') this.receive({ type: 'response.done' });
    if (event.type === 'jarvis.session.end') this.receive({ type: 'jarvis.session.ended' });
  }

  close(code = 1000, reason = '') {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent('close', { code, reason }));
  }

  receive(event: Record<string, unknown>) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) }));
  }

  disconnect() {
    this.close();
  }
}

function audioAdapter(onOpen?: () => void) {
  let playbackStarted = () => {};
  let playbackEnded = () => {};
  let inputEnded = () => {};
  let level = 0;
  return {
    prepare: vi.fn(async () => {}),
    requestMicrophone: vi.fn(async () => {}),
    open: vi.fn<(send: (audio: string) => void) => Promise<void>>(async () => { onOpen?.(); }),
    detachInput: vi.fn(),
    play: vi.fn<(audio: string) => void>(),
    stopPlayback: vi.fn(() => { level = 0; }),
    hasPlayback: vi.fn(() => false),
    setPlaybackStartedHandler: vi.fn((handler: () => void) => { playbackStarted = handler; }),
    setPlaybackEndedHandler: vi.fn((handler: () => void) => { playbackEnded = handler; }),
    setInputEndedHandler: vi.fn((handler: () => void) => { inputEnded = handler; }),
    playbackLevel: vi.fn(() => level),
    inputLevel: vi.fn(() => 0.3),
    setMuted: vi.fn(),
    closeInput: vi.fn(),
    dispose: vi.fn(),
    startPlayback: (nextLevel = 0.6) => { level = nextLevel; playbackStarted(); },
    finishPlayback: () => { level = 0; playbackEnded(); },
    endInput: () => inputEnded(),
  };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for the voice client.');
}

const clients: BrowserVoiceClient[] = [];

afterEach(() => {
  for (const client of clients.splice(0)) client.stop();
  vi.useRealTimers();
});

describe('BrowserVoiceClient', () => {
  it('accepts only typed relay visual-path evidence and projects no image data', async () => {
    const sockets: MockSocket[] = [];
    const onVisualResult = vi.fn();
    const onVisualResultError = vi.fn();
    const client = new BrowserVoiceClient({
      backendUrl: 'https://api.example.com', getAccessToken: async () => 'token', onStatus: () => {},
      onVisualResult, onVisualResultError, createAudio: () => audioAdapter(),
      createSocket: (url, protocols) => { const socket = new MockSocket(url, protocols); sockets.push(socket); return socket; },
    });
    clients.push(client);
    client.start();
    await until(() => sockets[0]?.readyState === 1);
    const socket = sockets[0]!;
    for (const value of [
      { visualPath: 'video' }, { visualPath: 'image', itemId: 'invalid item' },
      { visualPath: 'caption', visualReason: 'x'.repeat(65) }, { frameId: 'reference-alone' },
    ]) socket.receive({ type: 'jarvis.visual_context', ...value });
    expect(onVisualResult).not.toHaveBeenCalled();
    expect(onVisualResultError).toHaveBeenCalledTimes(4);
    socket.receive({ type: 'jarvis.visual_context', itemId: 'item_1', visualPath: 'caption',
      visualReason: 'image_input_unverified', frameId: 'private-handle', frame: 'private-image' });
    expect(onVisualResult).toHaveBeenLastCalledWith({ itemId: 'item_1', visualPath: 'caption', visualReason: 'image_input_unverified' });
    socket.receive({ type: 'jarvis.visual_context', itemId: 'item_2', visualPath: 'image' });
    expect(onVisualResult).toHaveBeenLastCalledWith({ itemId: 'item_2', visualPath: 'image' });
    expect(socket.readyState).toBe(1);
  });

  it.each([
    ['en', 'budget_exhausted'], ['da', 'budget_exhausted'],
    ['en', 'budget_unavailable'], ['da', 'budget_unavailable'],
  ] as const)('preserves correlated %s voice %s feedback without echoing it', async (language, reason) => {
    const sockets: MockSocket[] = [];
    const onVisionLimit = vi.fn();
    const client = new BrowserVoiceClient({
      backendUrl: 'https://api.example.com', getAccessToken: async () => 'token', language,
      onStatus: () => {}, onVisionLimit, createAudio: () => audioAdapter(),
      createSocket: (url, protocols) => { const socket = new MockSocket(url, protocols); sockets.push(socket); return socket; },
    });
    clients.push(client);
    client.setCameraState(true);
    client.start();
    await until(() => sockets[0]?.readyState === 1);
    const socket = sockets[0]!;
    socket.receive({ type: 'jarvis.session.ready', sessionId: '41' });
    const sent = socket.sent.length;
    socket.receive({ type: 'jarvis.screen.context.unavailable', itemId: 'invalid item', reason });
    socket.receive({ type: 'jarvis.screen.context.unavailable', itemId: 'current_item', reason, retryAfterMs: -1 });
    expect(onVisionLimit).not.toHaveBeenCalled();
    socket.receive({ type: 'jarvis.screen.context.unavailable', itemId: 'current_item', reason });
    expect(onVisionLimit).toHaveBeenCalledExactlyOnceWith({ itemId: 'current_item', code: reason });
    expect(socket.sent).toHaveLength(sent);
    if (reason === 'budget_exhausted') {
      client.sendScreenContextUnavailable({ itemId: 'current_item', reason });
      expect(socket.sent.at(-1)).toEqual({ type: 'jarvis.screen.context.unavailable', itemId: 'current_item', reason });
    }
    client.setCameraState(false);
    socket.receive({ type: 'jarvis.screen.context.unavailable', itemId: 'current_item', reason });
    expect(onVisionLimit).toHaveBeenCalledOnce();
    expect(socket.readyState).toBe(1);
  });

  it.each(['en', 'da'] as const)('prepares correlated camera turns and resends camera state after %s reconnect', async (language) => {
    const sockets: MockSocket[] = [];
    const onUserTurn = vi.fn();
    const onVisionRequest = vi.fn();
    const onVisionLimit = vi.fn();
    const client = new BrowserVoiceClient({
      backendUrl: 'https://api.example.com',
      getAccessToken: async () => 'token',
      language,
      onStatus: () => {},
      onUserTurn,
      onVisionRequest,
      onVisionLimit,
      createAudio: () => audioAdapter(),
      delay: async () => {},
      createSocket: (url, protocols) => {
        const socket = new MockSocket(url, protocols);
        sockets.push(socket);
        return socket;
      },
    });
    clients.push(client);
    client.setCameraState(true);
    client.start();
    await until(() => sockets[0]?.readyState === 1);
    const first = sockets[0];
    if (!first) throw new Error('Voice socket was not created.');
    first.receive({ type: 'jarvis.session.ready', sessionId: '41' });
    expect(first.sent.at(-1)).toEqual({ type: 'jarvis.camera.state', on: true });
    client.setCameraState(true);
    expect(first.sent.filter((event) => event.type === 'jarvis.camera.state')).toHaveLength(1);
    first.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_fingers',
      transcript: 'How many fingers am I holding up?' });
    first.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_followup',
      transcript: 'And now?' });
    expect(onUserTurn.mock.calls).toEqual([
      ['How many fingers am I holding up?', 'item_fingers'],
      ['And now?', 'item_followup'],
    ]);
    expect(onVisionRequest.mock.calls).toEqual([
      ['camera', 'How many fingers am I holding up?', 'item_fingers'],
      ['camera', 'And now?', 'item_followup'],
    ]);
    const visual = {
      source: 'camera' as const, capturedAt: '2026-10-11T20:06:00.000Z',
      question: 'How many fingers am I holding up?', frameId: 'opaque_frame-123',
    };
    client.sendScreenContext('Three fingers.', undefined, 'item_fingers', visual);
    client.sendScreenContextUnavailable({ itemId: 'item_followup', reason: 'frame_rate_limited' });
    expect(first.sent.at(-2)).toEqual({
      type: 'jarvis.screen.context', description: 'Three fingers.', itemId: 'item_fingers', ...visual,
    });
    expect(first.sent.at(-1)).toEqual({
      type: 'jarvis.screen.context.unavailable', itemId: 'item_followup', reason: 'frame_rate_limited',
    });
    expect(first.readyState).toBe(1);
    first.receive({ type: 'jarvis.screen.context.unavailable', itemId: 'item_followup',
      reason: 'frame_rate_limited', retryAfterMs: 3_000 });
    expect(onVisionLimit).toHaveBeenCalledWith({ itemId: 'item_followup', code: 'frame_rate_limited', retryAfterMs: 3_000 });
    first.receive({ type: 'jarvis.screen.context.unavailable', itemId: 'item_followup',
      reason: 'daily_limit', retryAfterMs: -1 });
    expect(onVisionLimit).toHaveBeenCalledOnce();
    expect(() => client.sendScreenContext('Image.', undefined, 'item.bad')).toThrow(/not ready/);
    const sentCount = first.sent.length;
    expect(() => client.sendScreenContext('Image.', undefined, undefined, visual)).toThrow(/not ready/);
    expect(() => client.sendScreenContext('Image.', undefined, 'item_fingers', { ...visual, frameId: 'bad/id' }))
      .toThrow(/invalid image reference/);
    expect(() => client.sendScreenContext('Image.', undefined, 'item_fingers', { ...visual, capturedAt: 'invalid' }))
      .toThrow(/valid capture time/);
    expect(first.sent).toHaveLength(sentCount);
    client.sendScreenContext(undefined, undefined, 'item_fingers', visual);
    expect(first.sent.at(-1)).toEqual({ type: 'jarvis.screen.context', itemId: 'item_fingers', ...visual });
    expect(first.sent.at(-1)).not.toHaveProperty('description');
    expect(() => client.sendScreenContext(undefined)).toThrow(/not ready/);
    first.disconnect();
    await until(() => sockets[1]?.readyState === 1);
    const second = sockets[1];
    if (!second) throw new Error('Voice socket did not reconnect.');
    second.receive({ type: 'jarvis.session.ready', sessionId: '42' });
    expect(second.sent.at(-1)).toEqual({ type: 'jarvis.camera.state', on: true });
    client.setCameraState(false);
    expect(second.sent.at(-1)).toEqual({ type: 'jarvis.camera.state', on: false });
    second.receive({ type: 'jarvis.screen.context.unavailable', itemId: 'item_weather', reason: 'daily_limit' });
    expect(onVisionLimit).toHaveBeenCalledOnce();
    onVisionRequest.mockClear();
    second.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_weather',
      transcript: 'How is the weather?' });
    expect(onVisionRequest).not.toHaveBeenCalled();
    second.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_camera_off',
      transcript: 'What do you see?' });
    expect(onVisionRequest).not.toHaveBeenCalled();
    client.sendScreenContextUnavailable({ itemId: 'item_weather', reason: 'vision_failed' });
    expect(second.sent.at(-1)).toEqual({
      type: 'jarvis.screen.context.unavailable', itemId: 'item_weather', reason: 'vision_failed',
    });
    expect(() => client.sendScreenContext('Image.', undefined, ' ')).toThrow(/not ready/);
    expect(() => client.sendScreenContextUnavailable({ itemId: 'x'.repeat(129), reason: 'capture_failed' })).toThrow(/not ready/);
  });

  it('requests the microphone from Start voice and captures automatically after the handshake', async () => {
    const statuses: string[] = [];
    const microphone: string[] = [];
    let socket: MockSocket | undefined;
    const audio = audioAdapter(() => {
      // Capture is only attached once the authenticated relay has completed its handshake.
      expect(socket?.readyState).toBe(1);
      expect(statuses).toContain('connecting');
    });
    const client = new BrowserVoiceClient({
      backendUrl: 'https://api.example.com/',
      getAccessToken: async () => 'token',
      onStatus: (status) => statuses.push(status),
      onMicrophoneState: (state) => microphone.push(state),
      createAudio: () => audio,
      createSocket: (url, protocols) => {
        socket = new MockSocket(url, protocols);
        return socket;
      },
    });
    clients.push(client);

    expect(audio.requestMicrophone).not.toHaveBeenCalled();
    client.start();
    // Requested synchronously inside the start gesture, before any socket exists.
    expect(audio.prepare).toHaveBeenCalledOnce();
    expect(audio.requestMicrophone).toHaveBeenCalledOnce();
    expect(audio.open).not.toHaveBeenCalled();
    await until(() => statuses.includes('listening'));

    expect(statuses).not.toContain('ready');
    expect(microphone).toEqual(['requesting', 'granted', 'live']);
    expect(socket?.url).toBe('wss://api.example.com/voice/da');
    expect(socket?.protocols).toEqual(['jarvis.voice.v1', 'jarvis.auth.token']);
    expect(socket?.sent.map(({ type }) => type)).toEqual(['jarvis.microphone.active']);
    expect(audio.open).toHaveBeenCalledOnce();
    const send = audio.open.mock.calls[0]![0];
    send('AAAA');
    expect(socket?.sent.at(-1)).toEqual({ type: 'input_audio_buffer.append', audio: 'AAAA' });
    client.setMuted(true);
    expect(socket?.sent.at(-1)?.type).toBe('jarvis.microphone.muted');
    expect(client.inputLevel()).toBe(0);
    client.setMuted(false);
    expect(socket?.sent.at(-1)?.type).toBe('jarvis.microphone.active');
    expect(client.inputLevel()).toBe(0.3);
    client.stop();
  });

  it('never sends audio when the handshake has not completed', async () => {
    const statuses: string[] = [];
    const audio = audioAdapter();
    const socket = new MockSocket('wss://api.example.com/never', []);
    const client = new BrowserVoiceClient({
      backendUrl: 'https://api.example.com',
      getAccessToken: async () => 'token',
      onStatus: (status) => statuses.push(status),
      createAudio: () => audio,
      createSocket: () => socket,
    });
    clients.push(client);
    client.start();
    await until(() => socket.readyState === 1);
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(audio.requestMicrophone).toHaveBeenCalledOnce();
    expect(audio.open).not.toHaveBeenCalled();
    expect(socket.sent).toEqual([]);
    expect(statuses).toEqual(['connecting']);
  });

  it('waits for persisted session completion before reporting stop', async () => {
    const statuses: string[] = [];
    const onSessionEnded = vi.fn();
    let socket: MockSocket | undefined;
    const client = new BrowserVoiceClient({
      backendUrl: 'https://api.example.com',
      getAccessToken: async () => 'token',
      onStatus: (status) => statuses.push(status),
      onSessionEnded,
      createAudio: () => audioAdapter(),
      createSocket: (url, protocols) => {
        socket = new MockSocket(url, protocols);
        return socket;
      },
    });

    clients.push(client);

    client.start();
    await until(() => statuses.includes('listening'));
    client.stop();

    expect(socket?.sent.at(-1)).toEqual({ type: 'jarvis.session.end' });
    expect(statuses).toContain('stopping');
    expect(statuses.at(-1)).toBe('stopped');
    expect(onSessionEnded).toHaveBeenCalledOnce();
  });

  it.each(['en', 'da'] as const)('routes camera and screen requests through the %s voice transport', async (language) => {
    let socket: MockSocket | undefined;
    const onSessionReady = vi.fn();
    const onVisionRequest = vi.fn();
    const onUserTurn = vi.fn();
    const client = new BrowserVoiceClient({
      backendUrl: 'https://api.example.com',
      getAccessToken: async () => 'token',
      language,
      onStatus: () => {},
      onSessionReady,
      onVisionRequest,
      onUserTurn,
      createAudio: () => audioAdapter(),
      createSocket: (url, protocols) => {
        socket = new MockSocket(url, protocols);
        return socket;
      },
    });
    clients.push(client);

    client.start();
    await until(() => socket?.readyState === 1);
    socket?.receive({ type: 'jarvis.session.ready', sessionId: '41' });
    socket?.receive({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'What am I holding?',
    });
    socket?.receive({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'Hvad holder jeg?',
    });
    socket?.receive({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'can you see anything?',
    });
    socket?.receive({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'Kan du se noget?',
    });
    socket?.receive({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'Could you look at my screen?',
    });
    socket?.receive({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'Hvad kan du se på min skærm?',
    });
    socket?.receive({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'Fill this in with my name and submit after I confirm.',
    });
    socket?.receive({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'How is the weather?',
    });
    client.sendScreenContext('A form with a name field.', 'Contact form - Chrome');

    expect(onSessionReady).toHaveBeenCalledWith('41');
    expect(socket?.sent.some((event) => event.type === 'jarvis.camera.state')).toBe(false);
    expect(onUserTurn).toHaveBeenCalledTimes(8);
    expect(onUserTurn).toHaveBeenLastCalledWith('How is the weather?');
    socket?.receive({ type: 'conversation.item.input_audio_transcription.completed', transcript: '   ' });
    expect(onUserTurn).toHaveBeenCalledTimes(8);
    expect(onVisionRequest.mock.calls).toEqual([
      ['camera', 'What am I holding?'],
      ['camera', 'Hvad holder jeg?'],
      ['camera', 'can you see anything?'],
      ['camera', 'Kan du se noget?'],
      ['screen', 'Could you look at my screen?'],
      ['screen', 'Hvad kan du se på min skærm?'],
      ['screen', 'Fill this in with my name and submit after I confirm.'],
    ]);
    expect(socket?.sent.at(-1)).toEqual({
      type: 'jarvis.screen.context',
      description: 'A form with a name field.',
      sharedWindowTitle: 'Contact form - Chrome',
    });
    client.sendScreenContextUnavailable();
    expect(socket?.sent.at(-1)).toEqual({ type: 'jarvis.screen.context.unavailable' });
    expect(() => client.sendScreenContext('x'.repeat(5_001))).toThrow(/not ready/);
  });

  it('reports speaking only once queued audio is audible and resets the level on interruption', async () => {
    const audio = audioAdapter();
    const statuses: string[] = [];
    let socket: MockSocket | undefined;
    const client = new BrowserVoiceClient({
      backendUrl: 'https://api.example.com',
      getAccessToken: async () => 'token',
      language: 'en',
      onStatus: (status) => statuses.push(status),
      createAudio: () => audio,
      createSocket: (url, protocols) => {
        socket = new MockSocket(url, protocols);
        return socket;
      },
    });
    clients.push(client);

    client.start();
    await until(() => statuses.includes('listening'));
    socket?.receive({ type: 'response.created' });
    expect(statuses.at(-1)).toBe('thinking');
    socket?.receive({ type: 'response.audio.delta', delta: 'AQID' });
    // A received network chunk is not proof of audible speech.
    expect(statuses.at(-1)).toBe('thinking');
    expect(client.playbackLevel()).toBe(0);
    audio.startPlayback(0.7);
    expect(statuses.at(-1)).toBe('speaking');
    expect(client.playbackLevel()).toBe(0.7);
    socket?.receive({ type: 'input_audio_buffer.speech_started' });
    expect(statuses.at(-1)).toBe('listening');
    expect(client.playbackLevel()).toBe(0);
    socket?.receive({ type: 'response.audio.delta', delta: 'BAUG' });

    expect(audio.play).toHaveBeenCalledWith('AQID');
    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.stopPlayback).toHaveBeenCalledOnce();
    client.stop();
    expect(client.playbackLevel()).toBe(0);
    expect(client.inputLevel()).toBe(0);
  });

  it('keeps the speaking state until queued audio playback ends', async () => {
    const audio = audioAdapter();
    const statuses: string[] = [];
    let socket: MockSocket | undefined;
    const client = new BrowserVoiceClient({
      backendUrl: 'https://api.example.com',
      getAccessToken: async () => 'token',
      language: 'en',
      onStatus: (status) => statuses.push(status),
      createAudio: () => audio,
      createSocket: (url, protocols) => {
        socket = new MockSocket(url, protocols);
        return socket;
      },
    });
    clients.push(client);

    client.start();
    await until(() => statuses.includes('listening'));
    socket?.receive({ type: 'response.created' });
    socket?.receive({ type: 'response.audio.delta', delta: 'AQID' });
    audio.startPlayback();
    audio.hasPlayback.mockReturnValue(true);
    socket?.receive({ type: 'response.done' });
    expect(statuses.at(-1)).toBe('speaking');

    audio.hasPlayback.mockReturnValue(false);
    audio.finishPlayback();
    expect(statuses.at(-1)).toBe('listening');
    expect(client.playbackLevel()).toBe(0);
    client.stop();
  });

  it.each([
    ['en', 4010, 'Voice service did not become ready. Retrying…'],
    ['da', 4010, 'Voice service did not become ready. Retrying…'],
    ['en', 1006, 'Voice connection ended. Reconnecting…'],
    ['da', 1006, 'Voice connection ended. Reconnecting…'],
  ] as const)('reports %s warm-up close %i promptly and preserves reconnect backoff', async (language, code, message) => {
    vi.useFakeTimers();
    const sockets: MockSocket[] = [];
    const onStatus = vi.fn();
    const audio = audioAdapter();
    const client = new BrowserVoiceClient({
      backendUrl: 'https://api.example.com',
      getAccessToken: async () => 'token',
      language,
      onStatus,
      createAudio: () => audio,
      createSocket: (url, protocols) => {
        const socket = new MockSocket(url, protocols, sockets.length > 0);
        sockets.push(socket);
        return socket;
      },
    });
    clients.push(client);
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets[0]?.readyState).toBe(1);
    expect(audio.open).not.toHaveBeenCalled();

    sockets[0]!.close(code, 'Private provider failure details');
    await vi.advanceTimersByTimeAsync(0);
    expect(onStatus).toHaveBeenLastCalledWith('reconnecting', message);
    expect(JSON.stringify(onStatus.mock.calls)).not.toContain('Private provider failure details');
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(sockets).toHaveLength(2);
    expect(onStatus).toHaveBeenLastCalledWith('listening', 'Listening for your voice.');
    expect(audio.open).toHaveBeenCalledOnce();
    expect(audio.requestMicrophone).toHaveBeenCalledOnce();
  });

  it('resumes capture after a transport reconnect without another enable step and keeps an explicit mute', async () => {
    const audio = audioAdapter();
    const sockets: MockSocket[] = [];
    const statuses: string[] = [];
    const client = new BrowserVoiceClient({
      backendUrl: 'https://api.example.com',
      getAccessToken: async () => 'token',
      language: 'en',
      onStatus: (status) => statuses.push(status),
      createAudio: () => audio,
      createSocket: (url, protocols) => {
        const socket = new MockSocket(url, protocols);
        sockets.push(socket);
        return socket;
      },
      delay: async () => {},
    });
    clients.push(client);

    client.start();
    await until(() => statuses.includes('listening'));
    const firstSocket = sockets[0];
    if (!firstSocket) throw new Error('The initial voice socket was not created.');
    client.setMuted(true);
    firstSocket.disconnect();
    await until(() => statuses.filter((status) => status === 'listening').length === 2);

    expect(statuses).toContain('reconnecting');
    expect(statuses).not.toContain('ready');
    expect(sockets).toHaveLength(2);
    expect(audio.requestMicrophone).toHaveBeenCalledOnce();
    expect(audio.detachInput).toHaveBeenCalled();
    expect(audio.closeInput).not.toHaveBeenCalled();
    expect(audio.open).toHaveBeenCalledTimes(2);
    expect(audio.setMuted).toHaveBeenLastCalledWith(true);
    // The relay starts muted, so a muted reconnect must not announce an active microphone.
    expect(sockets[1]?.sent.map(({ type }) => type)).toEqual([]);
    client.stop();
  });

  it('uses a changed language for the next session without changing the active relay', async () => {
    const statuses: string[] = [];
    const audio = audioAdapter();
    const sockets: MockSocket[] = [];
    const client = new BrowserVoiceClient({
      backendUrl: 'https://api.example.com',
      getAccessToken: async () => 'token',
      language: 'en',
      onStatus: (status) => statuses.push(status),
      createAudio: () => audio,
      createSocket: (url, protocols) => {
        const socket = new MockSocket(url, protocols);
        sockets.push(socket);
        return socket;
      },
      delay: async () => {},
    });
    clients.push(client);

    client.start();
    await until(() => statuses.includes('listening'));
    client.setLanguage('da');
    const firstSocket = sockets[0];
    if (!firstSocket) throw new Error('The voice socket was not created.');
    expect(firstSocket.url).toBe('wss://api.example.com/voice');
    client.stop();
  });

  it('reports a denied microphone without claiming Listening and allows an explicit retry', async () => {
    const audio = audioAdapter();
    audio.requestMicrophone.mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'));
    const statuses: [string, string][] = [];
    const microphone: string[] = [];
    let socket: MockSocket | undefined;
    const client = new BrowserVoiceClient({
      backendUrl: 'https://api.example.com',
      getAccessToken: async () => 'token',
      onStatus: (status, message) => statuses.push([status, message]),
      onMicrophoneState: (state) => microphone.push(state),
      createAudio: () => audio,
      createSocket: (url, protocols) => {
        socket = new MockSocket(url, protocols);
        return socket;
      },
    });
    clients.push(client);
    await client.retryMicrophone();
    expect(audio.requestMicrophone).not.toHaveBeenCalled();
    client.start();
    await until(() => statuses.some(([status]) => status === 'ready'));
    expect(microphone).toEqual(['requesting', 'denied']);
    expect(statuses.at(-1)?.[1]).toMatch(/Retry microphone/);
    expect(statuses.map(([status]) => status)).not.toContain('listening');
    expect(audio.open).not.toHaveBeenCalled();
    expect(socket?.sent).toEqual([]);

    await client.retryMicrophone();
    expect(audio.requestMicrophone).toHaveBeenCalledTimes(2);
    expect(statuses.at(-1)?.[0]).toBe('listening');
    expect(microphone.at(-1)).toBe('live');
  });

  it('reports a missing microphone distinctly', async () => {
    const audio = audioAdapter();
    audio.requestMicrophone.mockRejectedValueOnce(new DOMException('No device', 'NotFoundError'));
    const microphone: string[] = [];
    const statuses: string[] = [];
    const client = new BrowserVoiceClient({
      backendUrl: 'https://api.example.com',
      getAccessToken: async () => 'token',
      onStatus: (status) => statuses.push(status),
      onMicrophoneState: (state) => microphone.push(state),
      createAudio: () => audio,
      createSocket: (url, protocols) => new MockSocket(url, protocols),
    });
    clients.push(client);
    client.start();
    await until(() => statuses.includes('ready'));
    expect(microphone.at(-1)).toBe('missing');
  });

  it('stops listening truthfully when the microphone track ends', async () => {
    const audio = audioAdapter();
    const statuses: [string, string][] = [];
    let socket: MockSocket | undefined;
    const client = new BrowserVoiceClient({
      backendUrl: 'https://api.example.com',
      getAccessToken: async () => 'token',
      onStatus: (status, message) => statuses.push([status, message]),
      createAudio: () => audio,
      createSocket: (url, protocols) => {
        socket = new MockSocket(url, protocols);
        return socket;
      },
    });
    clients.push(client);
    client.start();
    await until(() => statuses.some(([status]) => status === 'listening'));
    audio.endInput();
    expect(statuses.at(-1)?.[0]).toBe('ready');
    expect(statuses.at(-1)?.[1]).toMatch(/Retry microphone/);
    expect(socket?.sent.at(-1)?.type).toBe('jarvis.microphone.muted');
    expect(client.inputLevel()).toBe(0);
  });

  it('disposes a late microphone grant after voice stops while permission is pending', async () => {
    const audio = audioAdapter();
    let grant!: () => void;
    audio.requestMicrophone.mockImplementationOnce(() => new Promise<void>((done) => { grant = done; }));
    const statuses: string[] = [];
    const client = new BrowserVoiceClient({
      backendUrl: 'https://api.example.com',
      getAccessToken: async () => 'token',
      onStatus: (status) => statuses.push(status),
      createAudio: () => audio,
      createSocket: (url, protocols) => new MockSocket(url, protocols),
    });
    clients.push(client);
    client.start();
    client.start();
    expect(audio.requestMicrophone).toHaveBeenCalledOnce();
    await until(() => statuses.includes('ready'));
    client.stop();
    await until(() => statuses.at(-1) === 'stopped');
    audio.closeInput.mockClear();
    grant();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(audio.closeInput).toHaveBeenCalled();
    expect(audio.open).not.toHaveBeenCalled();
    expect(statuses).not.toContain('listening');
    expect(statuses.at(-1)).toBe('stopped');
  });

  it('releases capture and playback when voice stops', async () => {
    const audio = audioAdapter();
    const statuses: string[] = [];
    const client = new BrowserVoiceClient({
      backendUrl: 'https://api.example.com',
      getAccessToken: async () => 'token',
      onStatus: (status) => statuses.push(status),
      createAudio: () => audio,
      createSocket: (url, protocols) => new MockSocket(url, protocols),
    });
    clients.push(client);
    client.start();
    await until(() => statuses.includes('listening'));
    audio.startPlayback();
    client.stop();
    await until(() => statuses.at(-1) === 'stopped');
    expect(audio.closeInput).toHaveBeenCalled();
    expect(audio.stopPlayback).toHaveBeenCalled();
    expect(audio.dispose).toHaveBeenCalled();
    expect(client.playbackLevel()).toBe(0);
  });
});
