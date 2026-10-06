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
