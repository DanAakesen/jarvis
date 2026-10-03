import websocket from '@fastify/websocket';
import WebSocket, { type RawData } from 'ws';
import {
  createEnglishSessionUpdate,
  ENGLISH_REALTIME_MODEL,
  executeRealtimeToolCall,
  isBrowserControlledToolOutput,
  parseVoiceEvent,
  type RealtimeFunctionCall,
} from './realtime.js';
import type { BackendModule } from '../modules.js';

export const VOICE_LIVE_SCOPE = 'https://ai.azure.com/.default';
export const VOICE_SUBPROTOCOL = 'jarvis.voice.v1';
const MAX_MESSAGE_BYTES = 1_048_576;
const TOKEN_TIMEOUT_MS = 10_000;
const CONNECTION_TIMEOUT_MS = 10_000;

export type VoiceConnectionFactory = (token: string, signal: AbortSignal) => WebSocket;

export interface VoiceRelayOptions {
  readonly getToken: (scope: string, signal: AbortSignal) => Promise<string>;
  readonly connect: VoiceConnectionFactory;
}

function credential(getToken: VoiceRelayOptions['getToken'], signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, rejectTimeout) => {
      timer = setTimeout(() => rejectTimeout(new Error('Voice authentication timed out')), TOKEN_TIMEOUT_MS);
      timer.unref();
    });
    void Promise.race([getToken(VOICE_LIVE_SCOPE, signal), timeout])
      .then((token) => {
        if (typeof token !== 'string' || !token.trim() || /[\r\n]/u.test(token)) {
          throw new Error('Invalid Voice authentication');
        }
        resolve(token);
      }, reject)
      .finally(() => { if (timer) clearTimeout(timer) });
  });
}

function dataSize(data: RawData): number {
  if (Array.isArray(data)) return data.reduce((size, chunk) => size + chunk.byteLength, 0);
  return data.byteLength;
}

function closeSocket(socket: WebSocket, code: number, reason: string): void {
  if (socket.readyState === WebSocket.OPEN) socket.close(code, reason);
  else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
}

export function normalizeVoiceLiveEndpoint(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new TypeError('Voice Live endpoint must be a valid URL');
  }
  const credentialParameters = new Set([
    'authorization', 'api-key', 'api_key', 'subscription-key', 'subscription_key',
    'access-token', 'access_token', 'token', 'key', 'sig', 'signature',
  ]);
  const includesCredential = [...url.searchParams.keys()].some((parameter) => credentialParameters.has(parameter.toLowerCase()));
  const modelParameters = url.searchParams.getAll('model');
  if (url.protocol !== 'wss:' || url.port || includesCredential ||
      !(url.hostname.endsWith('.services.ai.azure.com') || url.hostname.endsWith('.cognitiveservices.azure.com')) ||
      url.pathname !== '/voice-live/realtime' || url.username || url.password || url.hash ||
      modelParameters.length > 1 || (modelParameters.length === 1 && modelParameters[0] !== ENGLISH_REALTIME_MODEL)) {
    throw new TypeError('Voice Live endpoint must be a secure Azure Voice Live WebSocket URL');
  }
  url.searchParams.set('model', ENGLISH_REALTIME_MODEL);
  return url.href;
}

export function createVoiceLiveConnector(endpoint: string): VoiceConnectionFactory {
  const target = normalizeVoiceLiveEndpoint(endpoint);
  return (token, signal) => {
    const authorization = ['Bearer', token].join(' ');
    return new WebSocket(target, {
      headers: { Authorization: authorization },
      handshakeTimeout: CONNECTION_TIMEOUT_MS,
      maxPayload: MAX_MESSAGE_BYTES,
      perMessageDeflate: false,
      signal,
    });
  };
}

export function createVoiceRelayModule(options: VoiceRelayOptions): BackendModule {
  return {
    id: 'voice',
    tools: [],
    registerRoutes: async (app) => {
      await app.register(websocket, {
        options: {
          maxPayload: MAX_MESSAGE_BYTES,
          perMessageDeflate: false,
          handleProtocols: (protocols) => protocols.has(VOICE_SUBPROTOCOL) ? VOICE_SUBPROTOCOL : false,
        },
      });
      app.get('/voice', { websocket: true }, (browser, request) => {
        if (request.principal === null) {
          browser.close(1008, 'Unauthorized');
          return;
        }
        const controller = new AbortController();
        let upstream: WebSocket | undefined;
        let configured = false;
        let queuedBytes = 0;
        const queued: { data: RawData; binary: boolean }[] = [];
        const seenCallIds = new Set<string>();
        let pendingToolCalls = 0;
        let toolCallsInResponse = false;
        let responseDone = false;
        let toolQueue = Promise.resolve();

        const close = (code: number, reason: string) => {
          controller.abort();
          if (upstream) closeSocket(upstream, code, reason);
          closeSocket(browser, code, reason);
        };

        const sendUpstream = (message: unknown, sent?: () => void) => {
          if (upstream?.readyState !== WebSocket.OPEN) return;
          upstream.send(JSON.stringify(message), (error) => {
            if (error) close(1011, 'Voice connection failed');
            else sent?.();
          });
        };

        const flushQueued = () => {
          configured = true;
          for (const message of queued) {
            upstream?.send(message.data, { binary: message.binary }, (error) => {
              if (error) close(1011, 'Voice connection failed');
            });
          }
          queued.length = 0;
          queuedBytes = 0;
        };

        const resumeAfterTools = () => {
          if (controller.signal.aborted || !responseDone || !toolCallsInResponse || pendingToolCalls > 0) return;
          responseDone = false;
          toolCallsInResponse = false;
          sendUpstream({ type: 'response.create' });
        };

        const runToolCall = (call: RealtimeFunctionCall) => {
          if (!/^[A-Za-z0-9_-]{1,128}$/u.test(call.call_id) ||
              typeof call.name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(call.name) ||
              typeof call.arguments !== 'string' ||
              seenCallIds.has(call.call_id) || seenCallIds.size >= 1_000 ||
              pendingToolCalls >= 10) {
            close(1008, 'Invalid voice tool call');
            return;
          }
          seenCallIds.add(call.call_id);
          pendingToolCalls += 1;
          toolCallsInResponse = true;
          toolQueue = toolQueue.then(async () => {
            if (controller.signal.aborted) return;
            const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
            const output = await executeRealtimeToolCall(call, app.jarvisTools, request, signal);
            sendUpstream({
              type: 'conversation.item.create',
              item: { type: 'function_call_output', call_id: call.call_id, output },
            });
          }).catch(() => close(1011, 'Voice connection failed')).finally(() => {
            pendingToolCalls -= 1;
            resumeAfterTools();
          });
        };

        browser.on('message', (data, binary) => {
          const event = parseVoiceEvent(data, binary);
          if (event?.type === 'session.update' || isBrowserControlledToolOutput(event)) {
            close(1008, 'Voice session is configured by the server');
            return;
          }
          if (configured && upstream?.readyState === WebSocket.OPEN) {
            upstream.send(data, { binary }, (error) => {
              if (error) close(1011, 'Voice connection failed');
            });
            return;
          }
          queuedBytes += dataSize(data);
          if (queuedBytes > MAX_MESSAGE_BYTES) {
            close(1009, 'Voice message too large');
            return;
          }
          queued.push({ data, binary });
        });
        browser.once('close', () => {
          controller.abort();
          if (upstream) closeSocket(upstream, 1000, 'Browser disconnected');
        });
        browser.once('error', () => {
          controller.abort();
          if (upstream) closeSocket(upstream, 1011, 'Voice connection failed');
        });

        void (async () => {
          try {
            const token = await credential(options.getToken, controller.signal);
            if (controller.signal.aborted || browser.readyState !== WebSocket.OPEN) return;
            upstream = options.connect(token, controller.signal);
            upstream.once('open', () => {
              sendUpstream(createEnglishSessionUpdate(app.jarvisTools), flushQueued);
            });
            upstream.on('message', (data, binary) => {
              const event = parseVoiceEvent(data, binary);
              if (event?.type === 'response.function_call_arguments.done') {
                runToolCall(event as unknown as RealtimeFunctionCall);
                return;
              }
              if (event?.type === 'response.done' && toolCallsInResponse) {
                responseDone = true;
                resumeAfterTools();
              }
              if (browser.readyState === WebSocket.OPEN) {
                browser.send(data, { binary }, (error) => {
                  if (error) close(1011, 'Voice connection failed');
                });
              }
            });
            upstream.once('close', (code) => {
              if (browser.readyState === WebSocket.OPEN) {
                browser.close(code === 1000 ? 1000 : 1011, 'Voice connection ended');
              }
            });
            upstream.once('error', () => close(1011, 'Voice connection failed'));
          } catch {
            request.log.warn('voice.connection_failed');
            close(1011, 'Voice connection failed');
          }
        })();
      });
    },
  };
}
