// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { BrowserVoiceClient, type VoiceAudio, type VoiceStatus } from './voice-client';

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

class VoiceAudioFixture implements VoiceAudio {
  async prepare() {}
  async requestMicrophone() {}
  async open() {}
  detachInput() {}
  play() {}
  stopPlayback() {}
  hasPlayback() { return false; }
  setPlaybackStartedHandler() {}
  setPlaybackEndedHandler() {}
  setInputEndedHandler() {}
  playbackLevel() { return 0; }
  inputLevel() { return 0; }
  setMuted() {}
  closeInput() {}
  dispose() {}
}

class VoiceSocketFixture extends EventTarget {
  readyState = CONNECTING;
  readonly sent: string[] = [];
  readonly closes: Array<{ code?: number; reason?: string }> = [];

  constructor(private readonly failEnd = false) {
    super();
    queueMicrotask(() => this.open());
  }

  addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean
  ): void {
    super.addEventListener(type, callback, options);
  }

  removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean
  ): void {
    super.removeEventListener(type, callback, options);
  }

  send(text: string): void {
    if (this.failEnd && text === '{"type":"jarvis.session.end"}') {
      throw new Error('send failed');
    }
    this.sent.push(text);
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === CLOSED) return;
    this.closes.push(code === undefined ? {} : reason === undefined ? { code } : { code, reason });
    this.readyState = CLOSED;
    this.dispatchEvent(new Event('close'));
  }

  emit(event: Record<string, unknown>): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) }));
  }

  private open(): void {
    this.readyState = OPEN;
    this.dispatchEvent(new Event('open'));
  }
}

async function until(check: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function makeClient(failEnd = false) {
  let socket: VoiceSocketFixture | undefined;
  const statuses: VoiceStatus[] = [];
  let ended = 0;
  const client = new BrowserVoiceClient({
    backendUrl: 'https://fixture.example.invalid/api',
    getAccessToken: async () => 'fixture.token',
    onStatus: status => statuses.push(status),
    onSessionEnded: () => { ended += 1; },
    createAudio: () => new VoiceAudioFixture(),
    createSocket: () => {
      socket = new VoiceSocketFixture(failEnd);
      return socket;
    },
  });
  return {
    client,
    statuses,
    get ended() { return ended; },
    get socket() {
      if (!socket) throw new Error('Voice socket was not created');
      return socket;
    },
  };
}

describe('BrowserVoiceClient terminal ownership', () => {
  it('follows authoritative relay activity instead of a stale speaking default', async () => {
    const fixture = makeClient();
    fixture.client.start();
    await until(() => {
      try { return fixture.socket.readyState === OPEN; } catch { return false; }
    }, 'open voice socket');
    fixture.socket.emit({
      type: 'jarvis.session.ready',
      sessionId: '42',
      audio: { format: 'pcm16le', sampleRate: 24_000, channels: 1 },
    });
    await until(() => fixture.statuses.includes('listening'), 'voice listening');

    fixture.socket.emit({ type: 'jarvis.voice.activity', state: 'thinking' });
    expect(fixture.statuses.at(-1)).toBe('thinking');
    fixture.socket.emit({ type: 'jarvis.voice.activity', state: 'speaking' });
    fixture.socket.emit({ type: 'jarvis.voice.activity', state: 'listening' });
    expect(fixture.statuses.at(-1)).toBe('listening');
    fixture.socket.emit({ type: 'jarvis.voice.activity', state: 'reconnecting' });
    expect(fixture.statuses.at(-1)).toBe('reconnecting');
  });

  it.each([
    ['server failure', false, false],
    ['send failure', true, true],
  ])('uses 1011 and never reports Ended for %s', async (_name, failEnd, sendFails) => {
    const fixture = makeClient(failEnd);
    fixture.client.start();
    await until(() => {
      try { return fixture.socket.readyState === OPEN; } catch { return false; }
    }, 'open voice socket');
    fixture.socket.emit({
      type: 'jarvis.session.ready',
      sessionId: '42',
      audio: { format: 'pcm16le', sampleRate: 24_000, channels: 1 },
    });
    await until(() => fixture.statuses.includes('ready') || fixture.statuses.includes('listening'), 'voice readiness');

    fixture.client.stop();
    if (!sendFails) {
      fixture.socket.emit({
        type: 'jarvis.session.failed',
        closeCode: 1011,
        retryable: true,
      });
    }
    fixture.socket.emit({ type: 'jarvis.session.ended' });
    await until(() => fixture.socket.closes.length > 0, 'failed voice close');

    expect(fixture.ended).toBe(0);
    expect(fixture.statuses.at(-1)).toBe('error');
    expect(fixture.socket.closes).toEqual([{ code: 1011, reason: 'Voice end failed' }]);
  });

  it('closes with 1000 and releases ownership only after Jarvis Ended', async () => {
    const fixture = makeClient();
    fixture.client.start();
    await until(() => {
      try { return fixture.socket.readyState === OPEN; } catch { return false; }
    }, 'open voice socket');
    fixture.socket.emit({
      type: 'jarvis.session.ready',
      sessionId: '42',
      audio: { format: 'pcm16le', sampleRate: 24_000, channels: 1 },
    });
    await until(() => fixture.statuses.includes('ready') || fixture.statuses.includes('listening'), 'voice readiness');

    fixture.client.stop();
    expect(fixture.socket.closes).toEqual([]);
    expect(fixture.ended).toBe(0);
    fixture.socket.emit({ type: 'jarvis.session.ended' });

    expect(fixture.ended).toBe(1);
    expect(fixture.statuses.at(-1)).toBe('stopped');
    expect(fixture.socket.closes).toEqual([{ code: 1000, reason: 'Voice ended' }]);
  });

  it('fails a pre-connect stop without publishing Ended', () => {
    const fixture = makeClient();
    fixture.client.start();
    fixture.client.stop();

    expect(fixture.ended).toBe(0);
    expect(fixture.statuses.at(-1)).toBe('error');
  });
});
