export type VoiceLanguage = 'da' | 'en';
export type VoiceStatus = 'stopped' | 'connecting' | 'stopping' | 'listening' | 'thinking' | 'speaking' | 'reconnecting' | 'error';

type VoiceSocket = Omit<Pick<WebSocket, 'addEventListener' | 'removeEventListener' | 'send' | 'close' | 'readyState'>, 'readyState'> & {
  readonly readyState: number;
};

export interface VoiceAudio {
  prepare(): Promise<void>;
  open(sendAudio: (audio: string) => void): Promise<void>;
  play(audio: string): number;
  stopPlayback(): void;
  hasPlayback(): boolean;
  setPlaybackEndedHandler(handler: () => void): void;
  setMuted(muted: boolean): void;
  closeInput(): void;
  dispose(): void;
}

export interface VoiceClientOptions {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  language?: VoiceLanguage;
  onStatus: (status: VoiceStatus, message: string) => void;
  onAudioLevel?: (level: number) => void;
  onSessionEnded?: () => void;
  createSocket?: (url: string, protocols: string[]) => VoiceSocket;
  createAudio?: () => VoiceAudio;
  delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

const SAMPLE_RATE = 24_000;
const CONNECTION_TIMEOUT_MS = 20_000;
const WARMUP_TIMEOUT_MS = 60_000;
const MAX_RECONNECTS = 8;
const STOP_TIMEOUT_MS = 15_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeEvent(data: unknown): Record<string, unknown> | null {
  if (typeof data !== 'string') return null;
  try {
    const event: unknown = JSON.parse(data);
    return isRecord(event) ? event : null;
  } catch {
    return null;
  }
}

function voiceUrl(backendUrl: string | null, language: VoiceLanguage): string {
  let url: URL;
  try {
    if (!backendUrl) throw new TypeError();
    url = new URL(backendUrl);
  } catch {
    throw new Error('Voice is unavailable until the backend is configured.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Voice is unavailable until the backend is configured.');
  }
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/+$/u, '')}/voice${language === 'da' ? '/da' : ''}`;
  return url.href;
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Voice stopped', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Voice stopped', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function waitForSocketEvent(
  socket: VoiceSocket,
  eventName: 'open' | 'close',
  signal: AbortSignal,
  timeoutMs?: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      socket.removeEventListener(eventName, onEvent);
      socket.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
      if (timer !== undefined) clearTimeout(timer);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Voice connection failed.'));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Voice stopped', 'AbortError'));
    };
    socket.addEventListener(eventName, onEvent, { once: true });
    socket.addEventListener('error', onError, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        cleanup();
        reject(new Error('Voice connection timed out.'));
      }, timeoutMs);
    }
    if (signal.aborted) onAbort();
  });
}

function waitForVoiceEvent(
  socket: VoiceSocket,
  types: readonly string[],
  signal: AbortSignal,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('close', onClose);
      signal.removeEventListener('abort', onAbort);
      clearTimeout(timer);
    };
    const onMessage = (message: Event) => {
      const event = decodeEvent((message as MessageEvent).data);
      if (event && typeof event.type === 'string' && types.includes(event.type)) {
        cleanup();
        resolve();
      } else if (event?.type === 'error') {
        cleanup();
        reject(new Error('Voice session could not be started.'));
      }
    };
    const onClose = () => {
      cleanup();
      reject(new Error('Voice connection ended.'));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Voice stopped', 'AbortError'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Voice session timed out.'));
    }, timeoutMs);
    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', onClose, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function waitForClose(socket: VoiceSocket, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const cleanup = () => {
      socket.removeEventListener('close', onClose);
      signal.removeEventListener('abort', onAbort);
    };
    const onClose = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      resolve();
    };
    socket.addEventListener('close', onClose, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function createSocket(url: string, protocols: string[]): VoiceSocket {
  return new WebSocket(url, protocols);
}

function browserAudio(): VoiceAudio {
  let context: AudioContext | undefined;
  let stream: MediaStream | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let processor: ScriptProcessorNode | undefined;
  let mute: GainNode | undefined;
  let muted = false;
  let scheduledUntil = 0;
  let playbackGeneration = 0;
  let playbackEnded = () => {};
  const playing = new Set<AudioBufferSourceNode>();

  const stopPlayback = () => {
    playbackGeneration += 1;
    for (const sourceNode of playing) {
      try { sourceNode.stop(); } catch { /* Playback may have ended already. */ }
    }
    playing.clear();
    scheduledUntil = context?.currentTime ?? 0;
  };

  const closeInput = () => {
    if (processor) processor.onaudioprocess = null;
    source?.disconnect();
    processor?.disconnect();
    mute?.disconnect();
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = undefined;
    source = undefined;
    processor = undefined;
    mute = undefined;
  };

  return {
    async prepare() {
      context ??= new AudioContext();
      await context.resume();
    },
    async open(sendAudio) {
      const audioContext = context;
      if (!audioContext) throw new Error('Audio is not ready.');
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (context !== audioContext || audioContext.state === 'closed') {
        for (const track of audioStream.getTracks()) track.stop();
        throw new DOMException('Voice stopped', 'AbortError');
      }
      stream = audioStream;
      source = audioContext.createMediaStreamSource(stream);
      processor = audioContext.createScriptProcessor(4096, 1, 1);
      mute = audioContext.createGain();
      mute.gain.value = 0;
      processor.onaudioprocess = (event) => {
        event.outputBuffer.getChannelData(0).fill(0);
        if (muted) return;
        const input = event.inputBuffer.getChannelData(0);
        if (input.length === 0) return;
        const outputLength = Math.floor(input.length * SAMPLE_RATE / audioContext.sampleRate);
        const pcm = new Uint8Array(outputLength * 2);
        const view = new DataView(pcm.buffer);
        for (let index = 0; index < outputLength; index += 1) {
          const position = index * audioContext.sampleRate / SAMPLE_RATE;
          const before = Math.floor(position);
          const after = Math.min(before + 1, input.length - 1);
          const fraction = position - before;
          const sample = Math.max(-1, Math.min(1,
            (input[before] ?? 0) + ((input[after] ?? 0) - (input[before] ?? 0)) * fraction));
          view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        }
        let binary = '';
        for (const byte of pcm) binary += String.fromCharCode(byte);
        sendAudio(btoa(binary));
      };
      source.connect(processor);
      processor.connect(mute);
      mute.connect(context.destination);
    },
    play(encoded) {
      if (!context) return 0;
      let binary: string;
      try { binary = atob(encoded); } catch { return 0; }
      const byteLength = binary.length - (binary.length % 2);
      if (!byteLength) return 0;
      const pcm = new DataView(new ArrayBuffer(byteLength));
      for (let index = 0; index < byteLength; index += 1) {
        pcm.setUint8(index, binary.charCodeAt(index));
      }
      const buffer = context.createBuffer(1, byteLength / 2, SAMPLE_RATE);
      const samples = buffer.getChannelData(0);
      let energy = 0;
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = pcm.getInt16(index * 2, true) / 0x8000;
        energy += samples[index]! * samples[index]!;
      }
      const audioLevel = samples.length > 0 ? Math.min(1, Math.sqrt(energy / samples.length) * 4) : 0;
      const sourceNode = context.createBufferSource();
      sourceNode.buffer = buffer;
      sourceNode.connect(context.destination);
      const generation = playbackGeneration;
      sourceNode.onended = () => {
        if (generation !== playbackGeneration) return;
        playing.delete(sourceNode);
        if (playing.size === 0) playbackEnded();
      };
      const startAt = Math.max(context.currentTime, scheduledUntil);
      sourceNode.start(startAt);
      scheduledUntil = startAt + buffer.duration;
      playing.add(sourceNode);
      return audioLevel;
    },
    stopPlayback,
    hasPlayback: () => playing.size > 0,
    setPlaybackEndedHandler(handler) {
      playbackEnded = handler;
    },
    setMuted(value) {
      muted = value;
    },
    closeInput,
    dispose() {
      closeInput();
      stopPlayback();
      if (context) void context.close();
      context = undefined;
    },
  };
}

export class BrowserVoiceClient {
  private language: VoiceLanguage;
  private readonly audio: VoiceAudio;
  private readonly makeSocket: (url: string, protocols: string[]) => VoiceSocket;
  private readonly delay: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  private controller: AbortController | undefined;
  private socket: VoiceSocket | undefined;
  private running = false;
  private muted = false;
  private microphoneOpen = false;
  private playbackAllowed = false;
  private responseFinished = false;
  private stopping = false;
  private stopTimer: ReturnType<typeof setTimeout> | undefined;
  private stopOpenSocket: VoiceSocket | undefined;
  private stopOpenHandler: (() => void) | undefined;

  constructor(private readonly options: VoiceClientOptions) {
    this.language = options.language ?? 'da';
    this.audio = options.createAudio?.() ?? browserAudio();
    this.makeSocket = options.createSocket ?? createSocket;
    this.delay = options.delay ?? abortableDelay;
    this.audio.setPlaybackEndedHandler(() => {
      this.options.onAudioLevel?.(0);
      if (this.running && this.microphoneOpen && this.responseFinished) {
        this.publish('listening', 'Listening for your voice.');
      }
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.controller = new AbortController();
    this.publish('connecting', 'Connecting to Jarvis voice…');
    void this.run(this.controller.signal);
  }

  stop(): void {
    if (!this.running || this.stopping) return;
    const socket = this.socket;
    if (!socket || socket.readyState === WebSocket.CLOSED) {
      this.finishStop(false);
      return;
    }
    this.stopping = true;
    this.audio.closeInput();
    this.audio.stopPlayback();
    this.publish('stopping', 'Saving voice session…');
    this.stopTimer = setTimeout(() => this.finishStop(false, true), STOP_TIMEOUT_MS);
    if (socket.readyState === WebSocket.CONNECTING) {
      this.stopOpenSocket = socket;
      this.stopOpenHandler = () => {
        if (this.socket === socket && this.stopping) this.sendStopRequest(socket);
      };
      socket.addEventListener('open', this.stopOpenHandler, { once: true });
      return;
    }
    if (socket.readyState !== WebSocket.OPEN) {
      this.finishStop(false, true);
      return;
    }
    this.sendStopRequest(socket);
  }

  private sendStopRequest(socket: VoiceSocket): void {
    try {
      socket.send(JSON.stringify({ type: 'jarvis.session.end' }));
    } catch {
      this.finishStop(false, true);
    }
  }

  setLanguage(language: VoiceLanguage): void {
    this.language = language;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.audio.setMuted(muted);
  }

  private publish(status: VoiceStatus, message: string): void {
    this.options.onStatus(status, message);
  }

  private async run(signal: AbortSignal): Promise<void> {
    let reconnects = 0;
    try {
      try {
        await this.audio.prepare();
      } catch {
        this.running = false;
        this.publish('error', 'Audio could not start. Check your browser audio settings and try again.');
        return;
      }
      while (this.running && !signal.aborted) {
        let socket: VoiceSocket | undefined;
        try {
          let token: string;
          try {
            token = await this.options.getAccessToken();
          } catch {
            this.running = false;
            this.publish('error', 'Your Microsoft sign-in needs attention. Sign in again.');
            return;
          }
          const url = voiceUrl(this.options.backendUrl, this.language);
          socket = this.makeSocket(url, ['jarvis.voice.v1', `jarvis.auth.${token}`]);
          this.socket = socket;
          socket.addEventListener('message', this.receiveBound);
          await waitForSocketEvent(socket, 'open', signal, CONNECTION_TIMEOUT_MS);
          if (this.language === 'da') {
            const ready = waitForVoiceEvent(socket, ['session.ready'], signal, WARMUP_TIMEOUT_MS);
            socket.send(JSON.stringify({ type: 'session.start', protocol_version: '1.0' }));
            await ready;
            const warmed = waitForVoiceEvent(socket, ['response.done'], signal, WARMUP_TIMEOUT_MS);
            socket.send(JSON.stringify({
              type: 'conversation.item.create',
              item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '/diag' }] },
            }));
            socket.send(JSON.stringify({ type: 'response.create' }));
            await warmed;
          } else {
            await waitForVoiceEvent(socket, ['session.updated'], signal, WARMUP_TIMEOUT_MS);
          }
          if (!this.running || signal.aborted) break;
          try {
            await this.audio.open((audio) => {
              if (socket === this.socket && socket) {
                socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio }));
              }
            });
          } catch {
            if (this.running && !signal.aborted) {
              this.running = false;
              this.publish('error', 'Microphone access was not granted. Check browser permissions and try again.');
            }
            break;
          }
          if (this.stopping) {
            this.audio.closeInput();
            await waitForClose(socket, signal);
            break;
          }
          this.microphoneOpen = true;
          this.playbackAllowed = true;
          this.audio.setMuted(this.muted);
          this.publish('listening', 'Listening for your voice.');
          await waitForClose(socket, signal);
          reconnects += 1;
        } catch (error) {
          if (!this.running || signal.aborted) break;
          if (error instanceof DOMException && error.name === 'AbortError') break;
          reconnects += 1;
        } finally {
          if (socket) {
            socket.removeEventListener('message', this.receiveBound);
            if (this.socket === socket) this.socket = undefined;
            socket.close();
          }
          this.microphoneOpen = false;
          this.playbackAllowed = false;
          this.responseFinished = false;
          this.audio.stopPlayback();
          this.audio.closeInput();
        }
        if (!this.running || signal.aborted) break;
        if (this.stopping) {
          this.finishStop(false, true);
          break;
        }
        if (reconnects > MAX_RECONNECTS) {
          this.running = false;
          this.publish('error', 'Voice could not reconnect. Stop voice and try again.');
          break;
        }
        this.publish('reconnecting', 'Voice connection ended. Reconnecting…');
        await this.delay(Math.min(1_000 * 2 ** (reconnects - 1), 10_000), signal).catch(() => {});
      }
    } finally {
      if (!this.running) this.audio.dispose();
    }
  }

  private readonly receiveBound = (message: Event) => this.receive((message as MessageEvent).data);

  private receive(data: unknown): void {
    const event = decodeEvent(data);
    if (!event || typeof event.type !== 'string') return;
    if (event.type === 'jarvis.session.ended') {
      this.finishStop(true);
    } else if (event.type === 'input_audio_buffer.speech_started' || event.type === 'speech_started') {
      this.audio.stopPlayback();
      this.options.onAudioLevel?.(0);
      this.playbackAllowed = false;
      this.responseFinished = false;
      if (this.running && this.microphoneOpen) this.publish('listening', 'Listening for your voice.');
    } else if (event.type === 'response.created') {
      this.playbackAllowed = true;
      this.responseFinished = false;
      if (this.running && this.microphoneOpen) this.publish('thinking', 'Jarvis is thinking.');
    } else if (event.type === 'response.audio.delta' || event.type === 'response.output_audio.delta') {
      if (typeof event.delta === 'string' && this.running && this.microphoneOpen && this.playbackAllowed) {
        this.options.onAudioLevel?.(this.audio.play(event.delta));
        this.publish('speaking', 'Jarvis is speaking.');
      }
    } else if (event.type === 'response.done' && this.running && this.microphoneOpen) {
      this.responseFinished = true;
      if (!this.audio.hasPlayback()) {
        this.options.onAudioLevel?.(0);
        this.publish('listening', 'Listening for your voice.');
      }
    }
  }

  private finishStop(sessionEnded: boolean, failed = false): void {
    this.running = false;
    this.stopping = false;
    if (this.stopTimer !== undefined) clearTimeout(this.stopTimer);
    this.stopTimer = undefined;
    if (this.stopOpenSocket && this.stopOpenHandler) {
      this.stopOpenSocket.removeEventListener('open', this.stopOpenHandler);
    }
    this.stopOpenSocket = undefined;
    this.stopOpenHandler = undefined;
    this.controller?.abort();
    this.controller = undefined;
    this.socket?.close(1000, 'Voice stopped');
    this.socket = undefined;
    this.audio.dispose();
    this.options.onAudioLevel?.(0);
    this.publish(
      failed ? 'error' : 'stopped',
      failed ? 'Voice session could not be saved. Stop voice and try again.' : 'Voice is off.',
    );
    if (sessionEnded) this.options.onSessionEnded?.();
  }
}
