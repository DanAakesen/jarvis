import { createOutboundAudioData } from '@azure/communication-call-automation';
import WebSocket, { type RawData } from 'ws';
import type { FastifyRequest } from 'fastify';
import { parseVoiceEvent, validPcm24Base64 } from '../voice/live-protocol.js';

const MAX_MEDIA_MESSAGE_BYTES = 1_048_576;
const MAX_PCM_BYTES = 512_000;
const MAX_TRANSCRIPT_CHARACTERS = 20_000;
const MAX_TRANSCRIPTS = 1_000;

export interface PhoneMediaSession {
  readonly sessionId: string;
}

export interface PhoneMediaRelayOptions {
  readonly access: PhoneMediaSession;
  readonly browser: WebSocket;
  readonly request: FastifyRequest;
  readonly getToken: (scope: string, signal: AbortSignal) => Promise<string>;
  readonly connect: (token: string, signal: AbortSignal, agentSessionId?: string) => WebSocket;
}

function size(data: RawData): number {
  if (Array.isArray(data)) return data.reduce((total, part) => total + part.byteLength, 0);
  return data.byteLength;
}

function text(data: RawData): string | undefined {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  return Buffer.isBuffer(data) ? data.toString('utf8') : undefined;
}

function close(socket: WebSocket, code: number, reason: string): void {
  if (socket.readyState === WebSocket.OPEN) socket.close(code, reason);
  else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
}

function getAudioData(data: RawData, binary: boolean): string | undefined {
  if (binary || size(data) > MAX_MEDIA_MESSAGE_BYTES) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(text(data) ?? '') as unknown; }
  catch { return undefined; }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const event = parsed as Record<string, unknown>;
  if (event.kind !== 'AudioData' || event.audioData === null ||
      typeof event.audioData !== 'object' || Array.isArray(event.audioData)) return undefined;
  const audio = (event.audioData as Record<string, unknown>).data;
  return validPcm24Base64(audio, MAX_PCM_BYTES) ? audio : undefined;
}

export function bridgePhoneMedia({
  access,
  browser,
  request,
  getToken,
  connect,
}: PhoneMediaRelayOptions): () => void {
  const controller = new AbortController();
  let upstream: WebSocket | undefined;
  let closed = false;
  let audioReady = false;
  let upstreamReady = false;
  let queuedAudioBytes = 0;
  const queuedAudio: string[] = [];
  const savedUserItems = new Set<string>();
  const savedAssistantItems = new Set<string>();
  let transcriptQueue = Promise.resolve();
  let inputText = '';
  let inputTimer: ReturnType<typeof setTimeout> | undefined;
  let outputText = '';
  let outputTimer: ReturnType<typeof setTimeout> | undefined;

  const sendUpstream = (event: unknown) => {
    if (upstream?.readyState === WebSocket.OPEN) upstream.send(JSON.stringify(event));
  };
  const end = (code: number, reason: string) => {
    if (closed) return;
    closed = true;
    clearTimeout(inputTimer);
    clearTimeout(outputTimer);
    controller.abort();
    if (upstream) close(upstream, code, reason);
    close(browser, code, reason);
  };
  const saveTranscript = (role: 'dan' | 'jarvis', itemId: unknown, transcript: unknown) => {
    if (typeof itemId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(itemId) ||
        typeof transcript !== 'string' || !transcript.trim() ||
        transcript.length > MAX_TRANSCRIPT_CHARACTERS) return;
    const saved = role === 'dan' ? savedUserItems : savedAssistantItems;
    if (saved.has(itemId) || saved.size >= MAX_TRANSCRIPTS) return;
    saved.add(itemId);
    transcriptQueue = transcriptQueue.then(async () => {
      const store = request.server.conversationStore;
      if (!store) throw new Error('Phone conversation storage unavailable');
      const message = await store.addMessage({
        sessionId: access.sessionId,
        role,
        text: transcript.trim(),
        model: null,
        ...(role === 'dan' ? { sourceItemId: itemId } : {}),
      });
      if (!message) throw new Error('Phone transcript was not stored');
    }).catch(() => {
      request.log.warn('phone.transcript_persistence_failed');
      end(1011, 'Phone session storage unavailable');
    });
  };

  browser.on('message', (data, binary) => {
    if (closed || size(data) > MAX_MEDIA_MESSAGE_BYTES) {
      end(1009, 'Phone media message too large');
      return;
    }
    let event: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text(data) ?? '');
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      event = parsed as Record<string, unknown>;
    } catch {
      end(1008, 'Invalid phone media data');
      return;
    }
    if (event.kind === 'AudioMetadata') {
      const metadata = event.audioMetadata;
      if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata) ||
          (metadata as Record<string, unknown>).encoding?.toString().toLowerCase() !== 'pcm' ||
          (metadata as Record<string, unknown>).sampleRate !== 24000 ||
          (metadata as Record<string, unknown>).channels !== 1) {
        end(1008, 'Unsupported phone audio format');
        return;
      }
      audioReady = true;
      return;
    }
    if (event.kind === 'AudioData') {
      const audio = getAudioData(data, binary);
      if (!audio || !audioReady) {
        end(1008, 'Invalid phone audio');
        return;
      }
      if (upstreamReady) {
        sendUpstream({ type: 'session.input_audio.append', audio });
      } else {
        queuedAudioBytes += Buffer.byteLength(audio, 'base64');
        if (queuedAudioBytes > MAX_PCM_BYTES) {
          end(1009, 'Phone audio queue is full');
          return;
        }
        queuedAudio.push(audio);
      }
      return;
    }
    if (event.kind === 'DtmfData' || event.kind === 'StopAudio') return;
    end(1008, 'Unsupported phone media event');
  });
  browser.once('close', () => end(1000, 'Phone call disconnected'));
  browser.once('error', () => end(1011, 'Phone media connection failed'));

  void (async () => {
    try {
      const token = await getToken('https://ai.azure.com/.default', controller.signal);
      if (closed) return;
      upstream = connect(token, controller.signal, `phone_${access.sessionId}`);
      upstream.on('message', (data, binary) => {
        if (closed || size(data) > MAX_MEDIA_MESSAGE_BYTES) {
          end(1009, 'Voice response too large');
          return;
        }
        const event = parseVoiceEvent(data as Buffer, binary);
        if (!event) return;
        if (event.type === 'session.started') {
          upstreamReady = true;
          for (const audio of queuedAudio.splice(0)) {
            queuedAudioBytes -= Buffer.byteLength(audio, 'base64');
            sendUpstream({ type: 'session.input_audio.append', audio });
          }
          return;
        }
        if (event.type === 'session.input_transcript.delta' && typeof event.delta === 'string') {
          inputText += event.delta;
          clearTimeout(inputTimer);
          inputTimer = setTimeout(() => {
            const text = inputText;
            inputText = '';
            saveTranscript('dan', `phone_input_${access.sessionId}_${Date.now()}`, text);
          }, 600);
          inputTimer.unref();
          return;
        }
        if (event.type === 'session.output_transcript.delta' && typeof event.delta === 'string') {
          outputText += event.delta;
          clearTimeout(outputTimer);
          outputTimer = setTimeout(() => {
            const text = outputText;
            outputText = '';
            saveTranscript('jarvis', `phone_output_${access.sessionId}_${Date.now()}`, text);
          }, 600);
          outputTimer.unref();
          return;
        }
        if (event.type === 'session.output_audio.delta' &&
            validPcm24Base64(event.delta, MAX_PCM_BYTES) && browser.readyState === WebSocket.OPEN) {
          browser.send(createOutboundAudioData(event.delta));
        }
        if (event.type === 'session.delegation.created') end(1011, 'Phone client delegation is unavailable');
        if (event.type === 'session.closed') end(1000, 'Voice session ended');
        if (event.type === 'error') end(1011, 'Voice session failed');
      });
      upstream.once('error', () => {
        if (closed) return;
        request.log.warn('phone.voice_connection_failed');
        end(1011, 'Voice connection failed');
      });
      upstream.once('close', () => end(1011, 'Voice connection closed'));
    } catch {
      if (closed) return;
      request.log.warn('phone.voice_connection_failed');
      end(1011, 'Voice connection failed');
    }
  })();
  return () => end(1000, 'Phone session ended');
}
