import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserVoiceClient } from './voice-client';

class MockSocket extends EventTarget {
  readonly sent: Record<string, unknown>[] = [];
  readyState = 0;

  constructor(readonly url: string, readonly protocols: string[]) {
    super();
    queueMicrotask(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
      if (url.endsWith('/voice')) {
        setTimeout(() => this.receive({ type: 'session.updated' }), 0);
      }
      if (url.endsWith('/voice/da')) {
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

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }

  receive(event: Record<string, unknown>) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) }));
  }

  disconnect() {
    this.close();
  }
}

function audioAdapter(onOpen?: () => void) {
  let playbackEnded = () => {};
  return {
    prepare: vi.fn(async () => {}),
    open: vi.fn(async () => { onOpen?.(); }),
    play: vi.fn(() => 0.5),
    stopPlayback: vi.fn(),
    hasPlayback: vi.fn(() => false),
    setPlaybackEndedHandler: vi.fn((handler: () => void) => { playbackEnded = handler; }),
    setMuted: vi.fn(),
    closeInput: vi.fn(),
    dispose: vi.fn(),
    finishPlayback: () => playbackEnded(),
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
  it('warms the Danish voice agent but only opens microphone capture after explicit activation', async () => {
    const statuses: string[] = [];
    let opened = false;
    const audio = audioAdapter(() => { opened = true; });
    let socket: MockSocket | undefined;
    const client = new BrowserVoiceClient({
      backendUrl: 'https://api.example.com/',
      getAccessToken: async () => 'token',
      onStatus: (status) => statuses.push(status),
      createAudio: () => audio,
      createSocket: (url, protocols) => {
        socket = new MockSocket(url, protocols);
        return socket;
      },
    });
    clients.push(client);

    client.start();
    await until(() => statuses.includes('ready'));
    expect(audio.open).not.toHaveBeenCalled();
    await client.enableMicrophone();
    await until(() => opened);

    expect(socket?.url).toBe('wss://api.example.com/voice/da');
    expect(socket?.protocols).toEqual(['jarvis.voice.v1', 'jarvis.auth.token']);
    expect(socket?.sent.map(({ type }) => type)).toEqual([
      'jarvis.microphone.active',
    ]);
    expect(audio.open).toHaveBeenCalledOnce();
    client.setMuted(true);
    expect(socket?.sent.at(-1)?.type).toBe('jarvis.microphone.muted');
    client.setMuted(false);
    expect(socket?.sent.at(-1)?.type).toBe('jarvis.microphone.active');
    client.stop();
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
    await until(() => statuses.includes('ready'));
    client.stop();

    expect(socket?.sent.at(-1)).toEqual({ type: 'jarvis.session.end' });
    expect(statuses).toContain('stopping');
    expect(statuses.at(-1)).toBe('stopped');
    expect(onSessionEnded).toHaveBeenCalledOnce();
  });

  it('routes requested camera and screen frames without forwarding unrelated transcripts', async () => {
    let socket: MockSocket | undefined;
    const onSessionReady = vi.fn();
    const onVisionRequest = vi.fn();
    const client = new BrowserVoiceClient({
      backendUrl: 'https://api.example.com',
      getAccessToken: async () => 'token',
      language: 'en',
      onStatus: () => {},
      onSessionReady,
      onVisionRequest,
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
      transcript: 'Could you look at my screen?',
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
    expect(onVisionRequest.mock.calls).toEqual([
      ['camera', 'What am I holding?'],
      ['camera', 'Hvad holder jeg?'],
      ['screen', 'Could you look at my screen?'],
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

  it('stops current playback when speech starts', async () => {
    const audio = audioAdapter();
    const statuses: string[] = [];
    const audioLevels: number[] = [];
    let socket: MockSocket | undefined;
    const client = new BrowserVoiceClient({
      backendUrl: 'https://api.example.com',
      getAccessToken: async () => 'token',
      language: 'en',
      onStatus: (status) => statuses.push(status),
      onAudioLevel: (level) => audioLevels.push(level),
      createAudio: () => audio,
      createSocket: (url, protocols) => {
        socket = new MockSocket(url, protocols);
        return socket;
      },
    });
    clients.push(client);

    client.start();
    await until(() => statuses.includes('ready'));
    await client.enableMicrophone();
    await until(() => audio.open.mock.calls.length === 1);
    socket?.receive({ type: 'response.created' });
    expect(statuses.at(-1)).toBe('thinking');
    socket?.receive({ type: 'response.audio.delta', delta: 'AQID' });
    expect(audioLevels).toContain(0.5);
    socket?.receive({ type: 'input_audio_buffer.speech_started' });
    expect(audioLevels.at(-1)).toBe(0);
    socket?.receive({ type: 'response.audio.delta', delta: 'BAUG' });

    expect(audio.play).toHaveBeenCalledWith('AQID');
    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.stopPlayback).toHaveBeenCalledOnce();
    client.stop();
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
    await until(() => statuses.includes('ready'));
    await client.enableMicrophone();
    await until(() => audio.open.mock.calls.length === 1);
    socket?.receive({ type: 'response.created' });
    socket?.receive({ type: 'response.audio.delta', delta: 'AQID' });
    audio.hasPlayback.mockReturnValue(true);
    socket?.receive({ type: 'response.done' });
    expect(statuses.at(-1)).toBe('speaking');

    audio.hasPlayback.mockReturnValue(false);
    audio.finishPlayback();
    expect(statuses.at(-1)).toBe('listening');
    client.stop();
  });

  it('reconnects after the relay closes unexpectedly', async () => {
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
    await until(() => statuses.includes('ready'));
    await client.enableMicrophone();
    await until(() => audio.open.mock.calls.length === 1);
    const firstSocket = sockets[0];
    if (!firstSocket) throw new Error('The initial voice socket was not created.');
    client.setMuted(true);
    firstSocket.disconnect();
    await until(() => statuses.filter((status) => status === 'ready').length === 2);

    expect(statuses).toContain('reconnecting');
    expect(sockets).toHaveLength(2);
    expect(audio.open).toHaveBeenCalledOnce();
    await client.enableMicrophone();
    expect(audio.open).toHaveBeenCalledTimes(2);
    expect(audio.setMuted).toHaveBeenLastCalledWith(false);
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
    await until(() => statuses.includes('ready'));
    client.setLanguage('da');
    const firstSocket = sockets[0];
    if (!firstSocket) throw new Error('The voice socket was not created.');
    expect(firstSocket.url).toBe('wss://api.example.com/voice');
    client.stop();
  });

  it('allows an explicit retry after microphone permission is denied', async () => {
    const audio = audioAdapter();
    audio.open.mockRejectedValueOnce(new Error('Permission denied'));
    const statuses: string[] = [];
    const client = new BrowserVoiceClient({
      backendUrl: 'https://api.example.com',
      getAccessToken: async () => 'token',
      onStatus: (status) => statuses.push(status),
      createAudio: () => audio,
      createSocket: (url, protocols) => new MockSocket(url, protocols),
    });
    clients.push(client);
    await client.enableMicrophone();
    expect(audio.open).not.toHaveBeenCalled();
    client.start();
    await until(() => statuses.includes('ready'));
    await client.enableMicrophone();
    expect(statuses.at(-1)).toBe('ready');
    expect(audio.open).toHaveBeenCalledOnce();
    await client.enableMicrophone();
    expect(statuses.at(-1)).toBe('listening');
    expect(audio.open).toHaveBeenCalledTimes(2);
  });

  it('closes capture if voice stops while microphone permission is pending', async () => {
    const audio = audioAdapter();
    let resolve!: () => void;
    audio.open.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
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
    await until(() => statuses.includes('ready'));
    const pending = client.enableMicrophone();
    await client.enableMicrophone();
    expect(audio.open).toHaveBeenCalledOnce();
    client.stop();
    audio.closeInput.mockClear();
    resolve();
    await pending;
    expect(audio.closeInput).toHaveBeenCalled();
    expect(statuses).not.toContain('listening');
    expect(statuses.at(-1)).toBe('stopped');
  });
});
