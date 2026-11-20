import WebSocket, { type RawData } from 'ws';

export const FOUNDRY_VOICE_SCOPE = 'https://ai.azure.com/.default';
export const FOUNDRY_VOICE_FEATURES = 'VoiceAgents=V1Preview';
export const GPT_LIVE_DEPLOYMENT = 'gpt-live-1';
export const JARVIS_VOICE_AGENT_NAME = 'jarvis-pi-live';
export const VOICE_SAMPLE_RATE = 24_000;
export const VOICE_INPUT_QUIET_MS = 600;
export const VOICE_TRANSCRIPT_MAX_WAIT_MS = 3_000;

const MAX_EVENT_BYTES = 1_048_576;
const CONNECTION_TIMEOUT_MS = 15_000;
const AGENT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export type VoiceConnectionFactory = (
  token: string,
  signal: AbortSignal,
) => WebSocket;

export function dataSize(data: RawData): number {
  if (Array.isArray(data)) return data.reduce((size, chunk) => size + chunk.byteLength, 0);
  return data.byteLength;
}

function textData(data: RawData): string | undefined {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  return Buffer.isBuffer(data) ? data.toString('utf8') : undefined;
}

export function parseVoiceEvent(data: RawData, isBinary: boolean): Record<string, unknown> | undefined {
  if (isBinary || dataSize(data) > MAX_EVENT_BYTES) return undefined;
  try {
    const parsed: unknown = JSON.parse(textData(data) ?? '');
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

export function validPcm24Base64(value: unknown, maximumDecodedBytes = 512_000): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > Math.ceil(maximumDecodedBytes * 4 / 3) + 4 ||
      value.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    return false;
  }
  const decoded = Buffer.from(value, 'base64');
  return decoded.byteLength > 0 && decoded.byteLength <= maximumDecodedBytes && decoded.byteLength % 2 === 0;
}

export function normalizeFoundryProjectEndpoint(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new TypeError('Foundry project endpoint must be a valid URL');
  }
  if (url.protocol !== 'https:' || url.port || !url.hostname.endsWith('.services.ai.azure.com') ||
      !/^\/api\/projects\/[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(url.pathname) ||
      url.username || url.password || url.search || url.hash) {
    throw new TypeError('Foundry project endpoint must be a secure Azure AI project URL');
  }
  return url.href;
}

export function foundryVoiceAgentSessionEndpoint(projectEndpoint: string, agentName: string): string {
  const endpoint = normalizeFoundryProjectEndpoint(projectEndpoint);
  if (!AGENT_NAME_PATTERN.test(agentName)) throw new TypeError('Invalid Foundry voice agent name');
  const url = new URL(endpoint);
  url.protocol = 'wss:';
  url.pathname = `${url.pathname.replace(/\/+$/u, '')}/agents/${encodeURIComponent(agentName)}/endpoint/protocols/voice/live/sessions`;
  url.searchParams.set('api-version', 'v1');
  return url.href;
}

export function createFoundryVoiceAgentConnector(
  projectEndpoint: string,
  agentName: string,
): VoiceConnectionFactory {
  const endpoint = foundryVoiceAgentSessionEndpoint(projectEndpoint, agentName);
  return (token, signal) => {
    if (!token.trim() || /[\r\n]/u.test(token)) throw new TypeError('Invalid Foundry voice token');
    return new WebSocket(endpoint, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Foundry-Features': FOUNDRY_VOICE_FEATURES,
      },
      handshakeTimeout: CONNECTION_TIMEOUT_MS,
      maxPayload: MAX_EVENT_BYTES,
      perMessageDeflate: false,
      signal,
    });
  };
}
