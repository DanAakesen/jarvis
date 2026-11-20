import WebSocket, { type RawData } from 'ws';

export const FOUNDRY_VOICE_SCOPE = 'https://ai.azure.com/.default';
export const FOUNDRY_VOICE_FEATURES = 'VoiceAgents=V1Preview';
export const GPT_LIVE_DEPLOYMENT = 'gpt-live-1';
export const JARVIS_VOICE_AGENT_NAME = 'jarvis-pi-live';
export const VOICE_SAMPLE_RATE = 24_000;
export const VOICE_INPUT_QUIET_MS = 600;
export const VOICE_TRANSCRIPT_MAX_WAIT_MS = 3_000;
export const MAX_COMMENTARY_UTF8_BYTES = 256;
export const MAX_PROVIDER_VOICE_SECONDS = 24 * 60 * 60;

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

export function isCompatibleLiveSessionFormat(event: Record<string, unknown>): boolean {
  const session = event.session;
  if (typeof session !== 'object' || session === null || Array.isArray(session)) return true;
  const audio = (session as Record<string, unknown>).audio;
  if (typeof audio !== 'object' || audio === null || Array.isArray(audio)) return true;
  const format = (audio as Record<string, unknown>).format;
  if (format === undefined) return true;
  if (typeof format !== 'object' || format === null || Array.isArray(format)) return false;
  const value = format as Record<string, unknown>;
  return value.type === 'audio/pcm' && value.rate === VOICE_SAMPLE_RATE;
}

export function commentaryParts(text: string): string[] {
  const parts: string[] = [];
  let remaining = text.trim();
  while (remaining) {
    let bytes = 0;
    let maximumEnd = 0;
    let lastBoundary = 0;
    for (let index = 0; index < remaining.length;) {
      const codePoint = remaining.codePointAt(index)!;
      const character = String.fromCodePoint(codePoint);
      const nextBytes = Buffer.byteLength(character);
      if (bytes + nextBytes > MAX_COMMENTARY_UTF8_BYTES) break;
      bytes += nextBytes;
      index += character.length;
      maximumEnd = index;
      if (/\s|[.,!?;:]/u.test(character)) lastBoundary = index;
    }
    if (maximumEnd === 0) maximumEnd = String.fromCodePoint(remaining.codePointAt(0)!).length;
    const end = lastBoundary > 0 && lastBoundary >= Math.floor(maximumEnd / 2)
      ? lastBoundary
      : maximumEnd;
    const part = remaining.slice(0, end).trim();
    if (part) parts.push(part);
    remaining = remaining.slice(end).trimStart();
  }
  return parts;
}

export class LiveVoiceUsageTracker {
  private cumulativeSeconds: number | undefined;
  private readonly eventIds = new Set<string>();

  accept(event: Record<string, unknown>): number {
    const eventId = typeof event.event_id === 'string' &&
      /^[A-Za-z0-9_-]{1,128}$/u.test(event.event_id) ? event.event_id : undefined;
    if (eventId && this.eventIds.has(eventId)) return this.cumulativeSeconds ?? 0;
    const usage = event.usage;
    const seconds = usage && typeof usage === 'object' && !Array.isArray(usage)
      ? (usage as Record<string, unknown>).seconds
      : undefined;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) ||
        seconds < 0 || seconds > MAX_PROVIDER_VOICE_SECONDS) {
      throw new TypeError('Invalid provider voice usage');
    }
    if (eventId) {
      if (this.eventIds.size >= 1_000) {
        const oldest = this.eventIds.values().next().value;
        if (oldest) this.eventIds.delete(oldest);
      }
      this.eventIds.add(eventId);
    }
    this.cumulativeSeconds = Math.max(this.cumulativeSeconds ?? 0, seconds);
    return this.cumulativeSeconds;
  }

  get seconds(): number | undefined {
    return this.cumulativeSeconds;
  }
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
