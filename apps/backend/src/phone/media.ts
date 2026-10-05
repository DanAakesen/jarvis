import { createOutboundAudioData } from '@azure/communication-call-automation';
import WebSocket, { type RawData } from 'ws';
import type { FastifyRequest } from 'fastify';
import { parseVoiceEvent } from '../voice/realtime.js';

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

function validBase64(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PCM_BYTES * 4 / 3 + 4 &&
    value.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value);
}

export function createPhoneVoiceSessionStart(sessionId: string) {
  if (!/^[1-9]\d{0,18}$/u.test(sessionId) ||
      BigInt(sessionId) > 9_223_372_036_854_775_807n) {
    throw new TypeError('Invalid phone session');
  }
  return {
    type: 'session.start',
    protocol_version: '1.0',
    caller: { phoneSessionId: sessionId },
  };
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
  return validBase64(audio) ? audio : undefined;
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

  const sendUpstream = (event: unknown) => {
    if (upstream?.readyState === WebSocket.OPEN) upstream.send(JSON.stringify(event));
  };
  const end = (code: number, reason: string) => {
    if (closed) return;
    closed = true;
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
        sendUpstream({ type: 'input_audio_buffer.append', audio });
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
      upstream.once('open', () => {
        sendUpstream(createPhoneVoiceSessionStart(access.sessionId));
      });
      upstream.on('message', (data, binary) => {
        if (closed || size(data) > MAX_MEDIA_MESSAGE_BYTES) {
          end(1009, 'Voice response too large');
          return;
        }
        const event = parseVoiceEvent(data as Buffer, binary);
        if (!event) return;
        if (event.type === 'session.ready') {
          upstreamReady = true;
          for (const audio of queuedAudio.splice(0)) {
            queuedAudioBytes -= Buffer.byteLength(audio, 'base64');
            sendUpstream({ type: 'input_audio_buffer.append', audio });
          }
          return;
        }
        if (event.type === 'user.message' && Array.isArray(event.content)) {
          const transcript = event.content.flatMap((part) =>
            part !== null && typeof part === 'object' && !Array.isArray(part) &&
            (part as Record<string, unknown>).type === 'input_text' &&
            typeof (part as Record<string, unknown>).text === 'string'
              ? [(part as Record<string, unknown>).text as string]
              : []).join('');
          saveTranscript('dan', event.item_id, transcript);
          return;
        }
        if (event.type === 'conversation.item.input_audio_transcription.completed' &&
            typeof event.transcript === 'string') {
          saveTranscript('dan', event.item_id, event.transcript);
        }
        if (event.type === 'assistant.message' && Array.isArray(event.content)) {
          const transcript = event.content.flatMap((part) =>
            part !== null && typeof part === 'object' && !Array.isArray(part) &&
            (part as Record<string, unknown>).type === 'output_text' &&
            typeof (part as Record<string, unknown>).text === 'string'
              ? [(part as Record<string, unknown>).text as string]
              : []).join('');
          saveTranscript('jarvis', event.item_id, transcript);
          return;
        }
        if ((event.type === 'response.output_text.done' ||
             event.type === 'response.audio_transcript.done' ||
             event.type === 'response.output_audio_transcript.done') &&
            (typeof event.text === 'string' || typeof event.transcript === 'string')) {
          saveTranscript('jarvis', event.item_id, event.text ?? event.transcript);
        }
        if ((event.type === 'response.audio.delta' || event.type === 'response.output_audio.delta') &&
            validBase64(event.delta) && browser.readyState === WebSocket.OPEN) {
          browser.send(createOutboundAudioData(event.delta));
        }
        if (event.type === 'session.rejected' || event.type === 'error') end(1011, 'Voice session failed');
      });
      upstream.once('error', () => {
        request.log.warn('phone.voice_connection_failed');
        end(1011, 'Voice connection failed');
      });
      upstream.once('close', () => end(1011, 'Voice connection closed'));
    } catch {
      request.log.warn('phone.voice_connection_failed');
      end(1011, 'Voice connection failed');
    }
  })();
  return () => end(1000, 'Phone session ended');
}
