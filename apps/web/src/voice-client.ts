export type VoiceLanguage = 'da' | 'en';
export type VoiceStatus = 'stopped' | 'connecting' | 'ready' | 'stopping' | 'listening' | 'thinking' | 'speaking' | 'reconnecting' | 'error';

type VoiceSocket = Omit<Pick<WebSocket, 'addEventListener' | 'removeEventListener' | 'send' | 'close' | 'readyState'>, 'readyState'> & {
  readonly readyState: number;
};

export type MicrophoneState = 'off' | 'requesting' | 'granted' | 'live' | 'denied' | 'missing' | 'failed';

export interface VoiceAudio {
  /** Creates or resumes browser audio; call synchronously from the user's start gesture. */
  prepare(): Promise<void>;
  /** Requests the microphone stream (native permission prompt) without sending any audio. */
  requestMicrophone(): Promise<void>;
  /** Connects the granted stream to the sender; never requests a new stream itself. */
  open(sendAudio: (audio: string) => void): Promise<void>;
  /** Stops sending but keeps the granted stream for a transport reconnect in the same session. */
  detachInput(): void;
  play(audio: string): void;
  stopPlayback(): void;
  hasPlayback(): boolean;
  setPlaybackStartedHandler(handler: () => void): void;
  setPlaybackEndedHandler(handler: () => void): void;
  setInputEndedHandler(handler: () => void): void;
  /** RMS level of decoded audio that is audible right now (0 when nothing is playing). */
  playbackLevel(): number;
  /** RMS level of the live, unmuted microphone input (0 when detached or muted). */
  inputLevel(): number;
  setMuted(muted: boolean): void;
  closeInput(): void;
  dispose(): void;
}

export interface VoiceClientOptions {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  language?: VoiceLanguage;
  onStatus: (status: VoiceStatus, message: string) => void;
  onMicrophoneState?: (state: MicrophoneState) => void;
  onSessionEnded?: () => void;
  onSessionReady?: (sessionId: string) => void;
  onVisionRequest?: (source: 'camera' | 'screen', transcript: string) => void;
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

function requestedVisionSource(transcript: string): 'camera' | 'screen' | undefined {
  if (/\b(?:what am i holding|what(?:'s| is) in my hand|look at (?:my|the) camera|what can you see|hvad holder jeg|hvad er det jeg holder|kig på (?:mit )?kamera(?:et)?|hvad kan du se)\b/iu.test(transcript)) {
    return 'camera';
  }
  if (/\b(?:look at (?:my|the) screen|what(?:'s| is) on (?:my|the) screen|kig på (?:min )?skærm(?:en)?|hvad (?:er der|kan du se) på (?:min )?skærm(?:en)?)\b/iu.test(transcript)) {
    return 'screen';
  }
  if (/\b(?:do|act|use|fill|complete|submit|book|buy|purchase|send|delete|choose|select|find|search|compare|open|click|type|enter|apply)\b.{0,80}\b(?:here|this|that|it|these|those)\b|\b(?:here|this|that|it|these|those)\b.{0,80}\b(?:do|act|use|fill|complete|submit|book|buy|purchase|send|delete|choose|select|find|search|compare|open|click|type|enter|apply)\b/iu.test(transcript)) {
    return 'screen';
  }
  return undefined;
}

function voiceUrl(backendUrl: string | null, language: VoiceLanguage): string {
  let url: URL;
  try {
    if (!backendUrl) throw new TypeError();
    url = new URL(backendUrl);
  } catch {
    throw new Error('Voice unavailable. Try again.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Voice unavailable. Try again.');
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

function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  return Math.min(1, Math.sqrt(energy / samples.length) * 4);
}

function browserAudio(): VoiceAudio {
  let context: AudioContext | undefined;
  let playbackOutput: AnalyserNode | undefined;
  let playbackSamples: Float32Array<ArrayBuffer> | undefined;
  let stream: MediaStream | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let processor: ScriptProcessorNode | undefined;
  let mute: GainNode | undefined;
  let muted = false;
  let currentInputLevel = 0;
  let inputGeneration = 0;
  let scheduledUntil = 0;
  let playbackGeneration = 0;
  let playbackStarted = () => {};
  let playbackEnded = () => {};
  let inputEnded = () => {};
  const playing = new Set<AudioBufferSourceNode>();
  const startTimers = new Set<ReturnType<typeof setTimeout>>();

  const stopPlayback = () => {
    playbackGeneration += 1;
    for (const timer of startTimers) clearTimeout(timer);
    startTimers.clear();
    for (const sourceNode of playing) {
      try { sourceNode.stop(); } catch { /* Playback may have ended already. */ }
    }
    playing.clear();
    scheduledUntil = context?.currentTime ?? 0;
  };

  const detachInput = () => {
    if (processor) processor.onaudioprocess = null;
    source?.disconnect();
    processor?.disconnect();
    mute?.disconnect();
    source = undefined;
    processor = undefined;
    mute = undefined;
    currentInputLevel = 0;
  };

  const closeInput = () => {
    inputGeneration += 1;
    detachInput();
    for (const track of stream?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }
    stream = undefined;
  };

  return {
    async prepare() {
      context ??= new AudioContext();
      await context.resume();
    },
    async requestMicrophone() {
      if (stream?.getAudioTracks().some((track) => track.readyState === 'live')) return;
      const generation = inputGeneration;
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new DOMException('Microphone capture is unavailable in this browser.', 'NotSupportedError');
      }
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== inputGeneration) {
        // Voice ended while the permission prompt was open: discard the late grant immediately.
        for (const track of audioStream.getTracks()) track.stop();
        throw new DOMException('Voice stopped', 'AbortError');
      }
      stream = audioStream;
      for (const track of audioStream.getAudioTracks()) {
        track.onended = () => {
          if (stream !== audioStream) return;
          closeInput();
          inputEnded();
        };
      }
    },
    async open(sendAudio) {
      const audioContext = context;
      const audioStream = stream;
      if (!audioContext || audioContext.state === 'closed') throw new Error('Audio is not ready.');
      if (!audioStream) throw new Error('Microphone is not available.');
      detachInput();
      source = audioContext.createMediaStreamSource(audioStream);
      processor = audioContext.createScriptProcessor(4096, 1, 1);
      mute = audioContext.createGain();
      mute.gain.value = 0;
      processor.onaudioprocess = (event) => {
        event.outputBuffer.getChannelData(0).fill(0);
        if (muted) {
          currentInputLevel = 0;
          return;
        }
        const input = event.inputBuffer.getChannelData(0);
        if (input.length === 0) return;
        currentInputLevel = rms(input);
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
      mute.connect(audioContext.destination);
    },
    detachInput,
    play(encoded) {
      if (!context) return;
      let binary: string;
      try { binary = atob(encoded); } catch { return; }
      const byteLength = binary.length - (binary.length % 2);
      if (!byteLength) return;
      const pcm = new DataView(new ArrayBuffer(byteLength));
      for (let index = 0; index < byteLength; index += 1) {
        pcm.setUint8(index, binary.charCodeAt(index));
      }
      const buffer = context.createBuffer(1, byteLength / 2, SAMPLE_RATE);
      const samples = buffer.getChannelData(0);
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = pcm.getInt16(index * 2, true) / 0x8000;
      }
      if (!playbackOutput) {
        playbackOutput = context.createAnalyser();
        playbackOutput.fftSize = 1024;
        playbackOutput.connect(context.destination);
        playbackSamples = new Float32Array(playbackOutput.fftSize);
      }
      const sourceNode = context.createBufferSource();
      sourceNode.buffer = buffer;
      sourceNode.connect(playbackOutput);
      const generation = playbackGeneration;
      sourceNode.onended = () => {
        if (generation !== playbackGeneration) return;
        playing.delete(sourceNode);
        if (playing.size === 0) playbackEnded();
      };
      const wasIdle = playing.size === 0;
      const startAt = Math.max(context.currentTime, scheduledUntil);
      sourceNode.start(startAt);
      scheduledUntil = startAt + buffer.duration;
      playing.add(sourceNode);
      if (wasIdle) {
        // A received chunk is not audible yet: report speaking when its scheduled start arrives.
        const timer = setTimeout(() => {
          startTimers.delete(timer);
          if (generation === playbackGeneration && playing.has(sourceNode)) playbackStarted();
        }, Math.max(0, (startAt - context.currentTime) * 1000));
        startTimers.add(timer);
      }
    },
    stopPlayback,
    hasPlayback: () => playing.size > 0,
    setPlaybackStartedHandler(handler) {
      playbackStarted = handler;
    },
    setPlaybackEndedHandler(handler) {
      playbackEnded = handler;
    },
    setInputEndedHandler(handler) {
      inputEnded = handler;
    },
    playbackLevel() {
      if (!playbackOutput || !playbackSamples || playing.size === 0) return 0;
      playbackOutput.getFloatTimeDomainData(playbackSamples);
      return rms(playbackSamples);
    },
    inputLevel: () => (processor && !muted ? currentInputLevel : 0),
    setMuted(value) {
      muted = value;
      if (muted) currentInputLevel = 0;
    },
    closeInput,
    dispose() {
      closeInput();
      stopPlayback();
      playbackOutput?.disconnect();
      playbackOutput = undefined;
      playbackSamples = undefined;
      if (context) void context.close();
      context = undefined;
    },
  };
}

type MicrophoneProblem = 'requesting' | 'denied' | 'missing' | 'failed';

const microphoneMessages: Record<MicrophoneProblem, string> = {
  requesting: 'Allow microphone access when your browser asks, so Jarvis can hear you.',
  denied: 'Microphone access is blocked. Allow it for this site in your browser settings, then choose Retry microphone in More options.',
  missing: 'No microphone was found. Connect one, then choose Retry microphone in More options.',
  failed: 'The microphone could not start. Check your browser audio settings, then choose Retry microphone in More options.',
};
const microphoneLostMessage = 'Your microphone stopped. Check its browser permission or connection, then choose Retry microphone in More options.';

function microphoneProblem(error: unknown): Exclude<MicrophoneProblem, 'requesting'> {
  const name = isRecord(error) || error instanceof DOMException ? (error as { name?: unknown }).name : undefined;
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'missing';
  return 'failed';
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
  private microphone: MicrophoneState = 'off';
  private microphoneMessage = microphoneMessages.requesting;
  private microphoneOpen = false;
  private microphoneOpening = false;
  private sessionReady = false;
  private playbackAllowed = false;
  private responseFinished = false;
  private stopping = false;
  private stopTimer: ReturnType<typeof setTimeout> | undefined;
  private stopOpenSocket: VoiceSocket | undefined;
  private stopOpenHandler: (() => void) | undefined;
  private screenSessionReady = false;

  constructor(private readonly options: VoiceClientOptions) {
    this.language = options.language ?? 'da';
    this.audio = options.createAudio?.() ?? browserAudio();
    this.makeSocket = options.createSocket ?? createSocket;
    this.delay = options.delay ?? abortableDelay;
    this.audio.setPlaybackStartedHandler(() => {
      if (this.running && !this.stopping && this.microphoneOpen && this.playbackAllowed) {
        this.publish('speaking', 'Jarvis is speaking.');
      }
    });
    this.audio.setPlaybackEndedHandler(() => {
      if (this.running && !this.stopping && this.microphoneOpen && this.responseFinished) {
        this.publish('listening', 'Listening for your voice.');
      }
    });
    this.audio.setInputEndedHandler(() => this.microphoneLost());
  }

  /**
   * Starts voice from Dan's explicit gesture: audio is prepared and the microphone requested in the
   * same call stack, but audio is only sent after the authenticated session handshake succeeds.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.publish('connecting', 'Connecting to Jarvis voice…');
    void this.run(signal);
    void this.requestMicrophone(signal);
  }

  stop(): void {
    if (!this.running || this.stopping) return;
    const socket = this.socket;
    if (!socket || socket.readyState === WebSocket.CLOSED) {
      this.finishStop(false);
      return;
    }
    this.stopping = true;
    this.microphoneOpen = false;
    this.audio.closeInput();
    this.audio.stopPlayback();
    this.setMicrophone('off');
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
    if (this.muted === muted) return;
    this.muted = muted;
    this.audio.setMuted(muted);
    const socket = this.socket;
    if (this.microphoneOpen && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: muted ? 'jarvis.microphone.muted' : 'jarvis.microphone.active' }));
    }
  }

  /** Audible decoded playback level right now; queued but not yet playing audio reads as silence. */
  playbackLevel(): number {
    return this.running && !this.stopping ? this.audio.playbackLevel() : 0;
  }

  /** Live, unmuted microphone input level; kept separate from playback. */
  inputLevel(): number {
    return this.running && !this.stopping && this.microphoneOpen && !this.muted ? this.audio.inputLevel() : 0;
  }

  /** Exceptional recovery after a denied, missing, failed or revoked microphone; an explicit user action. */
  async retryMicrophone(): Promise<void> {
    const signal = this.controller?.signal;
    if (!signal || !this.running || this.stopping ||
        !(this.microphone === 'denied' || this.microphone === 'missing' || this.microphone === 'failed')) return;
    await this.requestMicrophone(signal);
  }

  sendScreenContext(description: string, sharedWindowTitle?: string): void {
    if (!this.running || !this.screenSessionReady || description.trim().length === 0 ||
        description.length > 5_000 || (sharedWindowTitle !== undefined &&
          (!sharedWindowTitle.trim() || sharedWindowTitle.length > 300 ||
            Array.from(sharedWindowTitle).some((character) =>
              character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))) ||
        this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error('The active voice session is not ready for screen context.');
    }
    this.socket.send(JSON.stringify({
      type: 'jarvis.screen.context',
      description,
      ...(sharedWindowTitle ? { sharedWindowTitle } : {}),
    }));
  }

  sendScreenContextUnavailable(): void {
    if (!this.running || !this.screenSessionReady || this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error('The active voice session is not ready for screen context.');
    }
    this.socket.send(JSON.stringify({ type: 'jarvis.screen.context.unavailable' }));
  }

  private setMicrophone(state: MicrophoneState): void {
    if (this.microphone === state) return;
    this.microphone = state;
    this.options.onMicrophoneState?.(state);
  }

  private async requestMicrophone(signal: AbortSignal): Promise<void> {
    this.setMicrophone('requesting');
    this.microphoneMessage = microphoneMessages.requesting;
    if (this.sessionReady) this.publish('ready', this.microphoneMessage);
    try {
      await this.audio.requestMicrophone();
    } catch (error) {
      if (signal.aborted || !this.running || this.stopping) return;
      const problem = microphoneProblem(error);
      this.setMicrophone(problem);
      this.microphoneMessage = microphoneMessages[problem];
      if (this.sessionReady) this.publish('ready', this.microphoneMessage);
      return;
    }
    if (signal.aborted || !this.running || this.stopping) {
      // A late grant after End voice is released at once and can never revive the session.
      if (!this.running || this.stopping) this.audio.closeInput();
      return;
    }
    this.setMicrophone('granted');
    await this.attachMicrophone();
  }

  private async attachMicrophone(): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || !this.running || this.stopping ||
        !this.sessionReady || this.microphoneOpen || this.microphoneOpening || this.microphone !== 'granted') return;
    this.microphoneOpening = true;
    try {
      await this.audio.open((audio) => {
        if (this.running && !this.stopping && this.microphoneOpen && socket === this.socket &&
            socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio }));
        }
      });
      if (!this.running || this.stopping || !this.sessionReady || socket !== this.socket ||
          socket.readyState !== WebSocket.OPEN) {
        this.audio.detachInput();
        return;
      }
      this.microphoneOpen = true;
      this.playbackAllowed = true;
      this.audio.setMuted(this.muted);
      this.setMicrophone('live');
      if (!this.muted) socket.send(JSON.stringify({ type: 'jarvis.microphone.active' }));
      this.publish('listening', 'Listening for your voice.');
    } catch {
      this.audio.closeInput();
      if (this.running && !this.stopping && socket === this.socket) {
        this.setMicrophone('failed');
        this.microphoneMessage = microphoneMessages.failed;
        if (this.sessionReady) this.publish('ready', this.microphoneMessage);
      }
    } finally {
      this.microphoneOpening = false;
    }
  }

  private microphoneLost(): void {
    if (!this.running || this.stopping || this.microphone === 'off') return;
    const wasOpen = this.microphoneOpen;
    this.microphoneOpen = false;
    this.audio.stopPlayback();
    this.setMicrophone('failed');
    this.microphoneMessage = microphoneLostMessage;
    const socket = this.socket;
    if (wasOpen && !this.muted && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'jarvis.microphone.muted' }));
    }
    if (this.sessionReady) this.publish('ready', this.microphoneMessage);
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
        this.setMicrophone('off');
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
            this.setMicrophone('off');
            this.publish('error', 'Your Microsoft sign-in needs attention. Sign in again.');
            return;
          }
          const url = voiceUrl(this.options.backendUrl, this.language);
          socket = this.makeSocket(url, ['jarvis.voice.v1', `jarvis.auth.${token}`]);
          this.socket = socket;
          socket.addEventListener('message', this.receiveBound);
          await waitForSocketEvent(socket, 'open', signal, CONNECTION_TIMEOUT_MS);
          if (this.language === 'da') {
            // The Danish voice wrapper speaks the Voice Live realtime protocol and owns its own
            // session configuration and greeting. `session.start`/`session.ready` and a `/diag`
            // warm-up belong to the hosted agent's Bridge Protocol, not to this route (L98).
            await waitForVoiceEvent(socket, ['session.created', 'session.updated'], signal, WARMUP_TIMEOUT_MS);
          } else {
            await waitForVoiceEvent(socket, ['session.updated'], signal, WARMUP_TIMEOUT_MS);
          }
          if (!this.running || signal.aborted) break;
          if (this.stopping) {
            await waitForClose(socket, signal);
            break;
          }
          this.sessionReady = true;
          // A permission already granted in this session (including across a transport reconnect)
          // starts capture without another click; an explicit mute is preserved by attachMicrophone.
          if (this.microphone === 'granted') void this.attachMicrophone();
          else this.publish('ready', this.microphoneMessage);
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
          this.sessionReady = false;
          this.screenSessionReady = false;
          this.playbackAllowed = false;
          this.responseFinished = false;
          this.audio.stopPlayback();
          this.audio.detachInput();
          if (this.microphone === 'live') this.setMicrophone('granted');
        }
        if (!this.running || signal.aborted) break;
        if (this.stopping) {
          this.finishStop(false, true);
          break;
        }
        if (reconnects > MAX_RECONNECTS) {
          this.running = false;
          this.setMicrophone('off');
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
    if (event.type === 'jarvis.session.ready') {
      if (typeof event.sessionId === 'string' && /^[1-9]\d{0,18}$/u.test(event.sessionId)) {
        this.screenSessionReady = true;
        this.options.onSessionReady?.(event.sessionId);
      }
    } else if (event.type === 'jarvis.session.ended') {
      this.finishStop(true);
    } else if (event.type === 'conversation.item.input_audio_transcription.completed' &&
        typeof event.transcript === 'string') {
      const source = requestedVisionSource(event.transcript);
      if (source) this.options.onVisionRequest?.(source, event.transcript);
    } else if (event.type === 'input_audio_buffer.speech_started' || event.type === 'speech_started') {
      this.audio.stopPlayback();
      this.playbackAllowed = false;
      this.responseFinished = false;
      if (this.running && this.microphoneOpen) this.publish('listening', 'Listening for your voice.');
    } else if (event.type === 'response.created') {
      this.playbackAllowed = true;
      this.responseFinished = false;
      if (this.running && this.microphoneOpen) this.publish('thinking', 'Jarvis is thinking.');
    } else if (event.type === 'response.audio.delta' || event.type === 'response.output_audio.delta') {
      if (typeof event.delta === 'string' && this.running && this.microphoneOpen && this.playbackAllowed) {
        // Speaking is published by the audio adapter when this chunk actually becomes audible.
        this.audio.play(event.delta);
      }
    } else if (event.type === 'response.done' && this.running && this.microphoneOpen) {
      this.responseFinished = true;
      if (!this.audio.hasPlayback()) {
        this.publish('listening', 'Listening for your voice.');
      }
    }
  }

  private finishStop(sessionEnded: boolean, failed = false): void {
    this.running = false;
    this.sessionReady = false;
    this.screenSessionReady = false;
    this.microphoneOpen = false;
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
    this.setMicrophone('off');
    this.publish(
      failed ? 'error' : 'stopped',
      failed ? 'Voice session could not be saved. Stop voice and try again.' : 'Voice is off.',
    );
    if (sessionEnded) this.options.onSessionEnded?.();
  }
}
