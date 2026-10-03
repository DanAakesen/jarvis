import websocket from '@fastify/websocket';
import WebSocket, { type RawData } from 'ws';
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

export function createVoiceLiveConnector(endpoint: string): VoiceConnectionFactory {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new TypeError('Voice Live endpoint must be a valid URL');
  }
  const credentialParameters = new Set(['authorization', 'api-key', 'subscription-key']);
  const includesCredential = [...url.searchParams.keys()].some((parameter) => credentialParameters.has(parameter.toLowerCase()));
  if (url.protocol !== 'wss:' || url.port || includesCredential ||
      !(url.hostname.endsWith('.services.ai.azure.com') || url.hostname.endsWith('.cognitiveservices.azure.com')) ||
      url.pathname !== '/voice-live/realtime' || url.username || url.password || url.hash) {
    throw new TypeError('Voice Live endpoint must be a secure Azure Voice Live WebSocket URL');
  }
  const target = url.href;
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
        let queuedBytes = 0;
        const queued: { data: RawData; binary: boolean }[] = [];

        const close = (code: number, reason: string) => {
          controller.abort();
          if (upstream) closeSocket(upstream, code, reason);
          closeSocket(browser, code, reason);
        };

        browser.on('message', (data, binary) => {
          if (upstream?.readyState === WebSocket.OPEN) {
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
              for (const message of queued) {
                upstream?.send(message.data, { binary: message.binary });
              }
              queued.length = 0;
              queuedBytes = 0;
            });
            upstream.on('message', (data, binary) => {
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
