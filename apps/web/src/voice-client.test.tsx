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
    });
  }

  send(message: string) {
    const event = JSON.parse(message) as Record<string, unknown>;
    this.sent.push(event);
    if (event.type === 'session.start') this.receive({ type: 'session.ready' });
    if (event.type === 'response.create') this.receive({ type: 'response.done' });
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
  return {
    prepare: vi.fn(async () => {}),
    open: vi.fn(async () => { onOpen?.(); }),
    play: vi.fn(),
    stopPlayback: vi.fn(),
    setMuted: vi.fn(),
    closeInput: vi.fn(),
    dispose: vi.fn(),
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
  it('warms the Danish voice agent before opening microphone capture', async () => {
    let opened = false;
    const audio = audioAdapter(() => { opened = true; });
    let socket: MockSocket | undefined;
    const client = new BrowserVoiceClient({
      backendUrl: 'https://api.example.com/',
      getAccessToken: async () => 'token',
      onStatus: () => {},
      createAudio: () => audio,
      createSocket: (url, protocols) => {
        socket = new MockSocket(url, protocols);
        return socket;
      },
    });
    clients.push(client);

    client.start();
    await until(() => opened);

    expect(socket?.url).toBe('wss://api.example.com/voice/da');
    expect(socket?.protocols).toEqual(['jarvis.voice.v1', 'jarvis.auth.token']);
    expect(socket?.sent.map(({ type }) => type)).toEqual([
      'session.start',
      'conversation.item.create',
      'response.create',
    ]);
    expect(socket?.sent[1]).toMatchObject({
      item: { content: [{ text: '/diag' }] },
    });
    expect(audio.open).toHaveBeenCalledOnce();
    client.stop();
  });

  it('stops current playback when speech starts', async () => {
    const audio = audioAdapter();
    let socket: MockSocket | undefined;
    const client = new BrowserVoiceClient({
      backendUrl: 'https://api.example.com',
      getAccessToken: async () => 'token',
      language: 'en',
      onStatus: () => {},
      createAudio: () => audio,
      createSocket: (url, protocols) => {
        socket = new MockSocket(url, protocols);
        return socket;
      },
    });
    clients.push(client);

    client.start();
    await until(() => audio.open.mock.calls.length === 1);
    socket?.receive({ type: 'response.audio.delta', delta: 'AQID' });
    socket?.receive({ type: 'input_audio_buffer.speech_started' });

    expect(audio.play).toHaveBeenCalledWith('AQID');
    expect(audio.stopPlayback).toHaveBeenCalledOnce();
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
    await until(() => audio.open.mock.calls.length === 1);
    const firstSocket = sockets[0];
    if (!firstSocket) throw new Error('The initial voice socket was not created.');
    firstSocket.disconnect();
    await until(() => audio.open.mock.calls.length === 2);

    expect(statuses).toContain('reconnecting');
    expect(sockets).toHaveLength(2);
    expect(audio.open).toHaveBeenCalledTimes(2);
    client.stop();
  });

  it('uses a changed language for the next session without changing the active relay', async () => {
    const audio = audioAdapter();
    const sockets: MockSocket[] = [];
    const client = new BrowserVoiceClient({
      backendUrl: 'https://api.example.com',
      getAccessToken: async () => 'token',
      language: 'en',
      onStatus: () => {},
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
    await until(() => audio.open.mock.calls.length === 1);
    client.setLanguage('da');
    const firstSocket = sockets[0];
    if (!firstSocket) throw new Error('The voice socket was not created.');
    expect(firstSocket.url).toBe('wss://api.example.com/voice');
    client.stop();
  });
});
