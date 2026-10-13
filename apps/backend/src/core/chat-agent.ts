import { randomUUID } from 'node:crypto';
import { normalizeFoundryProjectEndpoint } from '../voice/relay.js';
import type { VisualContext } from './visual-context.js';

export const CHAT_AGENT_PHASES = [
  'chat_history_verification',
  'chat_context',
  'tool_catalogue',
  'settings',
  'turn_context',
  'prompt_build',
  'model_coordination',
  'model_request',
  'model_first_delta',
  'model_to_first_delta',
  'agent_pre_model',
  'agent_first_delta',
  'agent_auth',
  'session_start',
] as const;

export type AgentPhaseTimings = Partial<Record<(typeof CHAT_AGENT_PHASES)[number], number>>;

export interface FoundryAgentSessionTelemetry {
  readonly sessionIdUsed: boolean;
  readonly sessionStartType?: 'cold' | 'warm' | 'resume';
  readonly platformMs?: number;
  readonly provisioningMs?: number;
  readonly containerMs?: number;
  readonly agentMs?: number;
  readonly fallbackReason?: `http_${number}`;
}

export interface ConversationAgentInput {
  readonly messageId: string;
  readonly sessionId?: string;
  readonly agentSessionId?: string;
  readonly turnId?: string;
  readonly text: string;
  readonly language: 'da' | 'en';
  readonly smoke?: boolean;
  readonly smokeHistory?: readonly { readonly role: 'user' | 'assistant'; readonly text: string }[];
  readonly smokeApproval?: boolean;
  readonly screenContext?: string;
  readonly visualContext?: VisualContext;
  readonly attachments?: readonly {
    readonly id: string;
    readonly name: string;
    readonly contentType: string;
    readonly size: number;
    readonly status: 'uploaded' | 'ready' | 'failed';
    readonly context: string;
  }[];
  readonly reflexNote?: string;
  readonly steering?: boolean;
  readonly onVisualResult?: (result: ConversationVisualResult) => void;
  readonly onAgentPhaseTimings?: (timings: AgentPhaseTimings) => void;
  readonly onAgentSessionTelemetry?: (telemetry: FoundryAgentSessionTelemetry) => void;
  readonly onAgentToolCalls?: (calls: readonly ConversationAgentToolCall[]) => void;
}

export interface ConversationAgentToolCall {
  readonly name: string;
  readonly operation?: string;
  readonly number?: number;
  readonly page?: string;
  readonly outcome: 'ok' | 'refused' | 'error';
  readonly title?: string;
  readonly capabilities?: readonly string[];
  readonly refusal?: string;
  readonly executed?: boolean;
}

export interface ConversationVisualResult {
  readonly visualPath: 'image' | 'caption';
  readonly visualReason?: string;
  readonly model?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly description?: string;
  readonly captionMs?: number;
}

export interface ConversationAgent {
  stream(input: ConversationAgentInput, authorization: string, signal: AbortSignal): AsyncIterable<string>;
}

const maxStreamBytes = 1024 * 1024;
const requestTimeoutMs = 120_000;
const maxDiagnosticDurationMs = 600_000;
export const FOUNDRY_AGENT_SCOPE = 'https://ai.azure.com/.default';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const agentSessionIdPattern = /^[0-9a-f]{32}$/u;
const maxChatSessions = 256;
const chatSessions = new Map<string, string>();

export function createFoundryAgentSessionId(ownerObjectId: string, conversationSessionId: string): string {
  if (!uuidPattern.test(ownerObjectId) || !/^[1-9][0-9]{0,18}$/u.test(conversationSessionId)) {
    throw new TypeError('Foundry chat session identity is invalid');
  }
  const key = `${ownerObjectId.toLowerCase()}:${conversationSessionId}`;
  const id = chatSessions.get(key) ?? randomUUID().replaceAll('-', '');
  chatSessions.delete(key);
  chatSessions.set(key, id);
  if (chatSessions.size > maxChatSessions) chatSessions.delete(chatSessions.keys().next().value!);
  return id;
}

function parseEvents(buffer: string): { events: { event: string; data: string }[]; pending: string } {
  const frames = buffer.split(/\r?\n\r?\n/u);
  const pending = frames.pop() ?? '';
  const events: { event: string; data: string }[] = [];
  for (const frame of frames) {
    let event = 'message';
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/u)) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).trimStart());
      }
    }
    if (data.length > 0) events.push({ event, data: data.join('\n') });
  }
  return { events, pending };
}

export class ChatAgentError extends Error {
  constructor(readonly code: string | undefined) {
    super(code ? `Chat agent failed (${code})` : 'Chat agent failed');
    this.name = 'ChatAgentError';
  }
}

// Only a short lowercase code from the agent is trusted; anything else (provider text) is dropped.
function errorCode(data: string): string | undefined {
  try {
    const payload: unknown = JSON.parse(data);
    const code = typeof payload === 'object' && payload !== null && 'code' in payload ? payload.code : undefined;
    return typeof code === 'string' && /^[a-z0-9_]{1,64}$/u.test(code) ? code : undefined;
  } catch { return undefined; }
}

function deltaFromEvent(event: { event: string; data: string }): string | undefined {
  if (event.event === 'error') throw new ChatAgentError(errorCode(event.data));
  if (event.event !== 'delta') return undefined;
  let payload: unknown;
  try { payload = JSON.parse(event.data); } catch { throw new Error('Invalid chat response'); }
  if (typeof payload !== 'object' || payload === null || !('text' in payload) ||
      typeof payload.text !== 'string' || payload.text.length === 0) {
    throw new Error('Invalid chat response');
  }
  return payload.text;
}

export function createFoundryInvocationsEndpoint(
  projectEndpoint: string,
  agentName: string,
  agentSessionId?: string,
): URL {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(agentName)) {
    throw new TypeError('Foundry chat agent name is invalid');
  }
  if (agentSessionId !== undefined && !agentSessionIdPattern.test(agentSessionId)) {
    throw new TypeError('Foundry chat session ID is invalid');
  }
  const url = new URL(normalizeFoundryProjectEndpoint(projectEndpoint));
  url.pathname += `/agents/${agentName}/endpoint/protocols/invocations`;
  url.searchParams.set('api-version', 'v1');
  if (agentSessionId !== undefined) url.searchParams.set('agent_session_id', agentSessionId);
  return url;
}

function foundrySessionTelemetry(
  headers: Headers,
  sessionIdUsed: boolean,
  fallbackReason?: `http_${number}`,
): FoundryAgentSessionTelemetry {
  const telemetry: {
    sessionIdUsed: boolean;
    sessionStartType?: 'cold' | 'warm' | 'resume';
    platformMs?: number;
    provisioningMs?: number;
    containerMs?: number;
    agentMs?: number;
    fallbackReason?: `http_${number}`;
  } = { sessionIdUsed, ...(fallbackReason ? { fallbackReason } : {}) };
  const sessionStartType = headers.get('x-ms-debug-latency-session-start-type')?.toLowerCase();
  if (sessionStartType === 'cold' || sessionStartType === 'warm' || sessionStartType === 'resume') {
    telemetry.sessionStartType = sessionStartType;
  }
  const durationHeaders = {
    platformMs: 'x-ms-debug-latency-platform',
    provisioningMs: 'x-ms-debug-latency-provisioning',
    containerMs: 'x-ms-debug-latency-container',
    agentMs: 'x-ms-debug-latency-agent',
  } as const;
  for (const [field, header] of Object.entries(durationHeaders) as
    [keyof typeof durationHeaders, (typeof durationHeaders)[keyof typeof durationHeaders]][]) {
    const value = headers.get(header);
    if (value === null || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value)) continue;
    const durationMs = Number(value);
    if (Number.isFinite(durationMs) && durationMs <= maxDiagnosticDurationMs) {
      telemetry[field] = durationMs;
    }
  }
  return telemetry;
}

function phaseTimingsFromDone(payload: unknown): AgentPhaseTimings | undefined {
  if (typeof payload !== 'object' || payload === null || !('agentTimings' in payload) ||
      typeof payload.agentTimings !== 'object' || payload.agentTimings === null) return undefined;
  const agentTimings = payload.agentTimings as Record<string, unknown>;
  const timings: AgentPhaseTimings = {};
  for (const phase of CHAT_AGENT_PHASES) {
    const durationMs = agentTimings[phase];
    if (typeof durationMs === 'number' && Number.isFinite(durationMs) &&
        durationMs >= 0 && durationMs <= maxDiagnosticDurationMs) {
      timings[phase] = durationMs;
    }
  }
  return Object.keys(timings).length > 0 ? timings : undefined;
}

export function createFoundryInvocationConversationAgent(
  projectEndpoint: string,
  agentName: string,
  getToken: (scope: string, signal: AbortSignal) => Promise<string>,
  fetcher: typeof fetch = fetch,
): ConversationAgent {
  createFoundryInvocationsEndpoint(projectEndpoint, agentName);
  return {
    async *stream(input, authorization, signal) {
      const {
        onVisualResult, onAgentPhaseTimings, onAgentSessionTelemetry, onAgentToolCalls,
        agentSessionId, smoke, ...payload
      } = input;
      if (agentSessionId !== undefined && !agentSessionIdPattern.test(agentSessionId)) {
        throw new TypeError('Foundry chat session ID is invalid');
      }
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]);
      const authStarted = performance.now();
      const token = await getToken(FOUNDRY_AGENT_SCOPE, requestSignal);
      const authMs = performance.now() - authStarted;
      if (typeof token !== 'string' || !token.trim() || /[\r\n]/u.test(token)) {
        throw new Error('Foundry authentication unavailable');
      }
      const request = (url: URL) => fetcher(url, {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
          'x-ms-debug-latency-enabled': 'true',
        },
        body: JSON.stringify({
          ...payload,
          ...(smoke ? { smoke: true } : { delegatedAuthorization: authorization }),
        }),
        signal: requestSignal,
      });
      const invocationStarted = performance.now();
      const response = await request(createFoundryInvocationsEndpoint(
        projectEndpoint, agentName, agentSessionId,
      ));
      onAgentSessionTelemetry?.(foundrySessionTelemetry(response.headers, agentSessionId !== undefined));
      if (!response.ok || !response.body ||
          !response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`Chat agent unavailable (HTTP ${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let receivedBytes = 0;
      let completed = false;
      let firstDeltaMs: number | undefined;
      const finish = (event: { event: string; data: string }) => {
        if (event.event !== 'done') return;
        completed = true;
        try {
          const result = JSON.parse(event.data) as Record<string, unknown>;
          const phaseTimings = phaseTimingsFromDone(result);
          if (phaseTimings) {
            // Agent elapsed time excludes hosted dispatch; the residual also includes transport.
            const agentMs = phaseTimings.agent_first_delta;
            delete phaseTimings.agent_auth;
            delete phaseTimings.session_start;
            if (authMs <= maxDiagnosticDurationMs) phaseTimings.agent_auth = authMs;
            if (agentMs !== undefined && firstDeltaMs !== undefined && firstDeltaMs >= agentMs &&
                firstDeltaMs <= maxDiagnosticDurationMs) {
              phaseTimings.session_start = firstDeltaMs - agentMs;
            }
            onAgentPhaseTimings?.(phaseTimings);
          }
          if (Array.isArray(result.smokeToolCalls)) {
            const calls = result.smokeToolCalls.flatMap((item): ConversationAgentToolCall[] => {
              if (typeof item !== 'object' || item === null || !('name' in item) ||
                  typeof item.name !== 'string' || !('outcome' in item) ||
                  (item.outcome !== 'ok' && item.outcome !== 'refused' && item.outcome !== 'error')) return [];
              return [{
                name: item.name,
                ...(typeof item.operation === 'string' ? { operation: item.operation } : {}),
                ...(typeof item.number === 'number' ? { number: item.number } : {}),
                ...(typeof item.page === 'string' ? { page: item.page } : {}),
                outcome: item.outcome,
                ...(typeof item.title === 'string' ? { title: item.title } : {}),
                ...(Array.isArray(item.capabilities) &&
                  item.capabilities.every((value: unknown) => typeof value === 'string')
                  ? { capabilities: item.capabilities } : {}),
                ...(typeof item.refusal === 'string' ? { refusal: item.refusal } : {}),
                ...(typeof item.executed === 'boolean' ? { executed: item.executed } : {}),
              }];
            });
            onAgentToolCalls?.(calls);
          }
          if (result.visualPath === 'image' || result.visualPath === 'caption') {
            onVisualResult?.({ visualPath: result.visualPath,
              ...(typeof result.model === 'string' && /^[A-Za-z0-9][A-Za-z0-9: ._-]{0,127}$/u.test(result.model)
                ? { model: result.model } : {}),
              ...(Number.isSafeInteger(result.inputTokens) && (result.inputTokens as number) >= 0 &&
                (result.inputTokens as number) <= 10_000_000 ? { inputTokens: result.inputTokens as number } : {}),
              ...(Number.isSafeInteger(result.outputTokens) && (result.outputTokens as number) >= 0 &&
                (result.outputTokens as number) <= 10_000_000 ? { outputTokens: result.outputTokens as number } : {}),
              ...(typeof result.description === 'string' && result.description.trim() &&
                Array.from(result.description).length <= 5_000 ? { description: result.description.trim() } : {}),
              ...(typeof result.captionMs === 'number' && Number.isFinite(result.captionMs) &&
                result.captionMs >= 0 && result.captionMs <= maxDiagnosticDurationMs ? { captionMs: result.captionMs } : {}),
              ...(typeof result.visualReason === 'string' && /^[a-z0-9_]{1,64}$/u.test(result.visualReason)
                ? { visualReason: result.visualReason } : {}) });
          }
        } catch { /* Legacy completion has no visual metadata. */ }
      };
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          receivedBytes += value.byteLength;
          if (receivedBytes > maxStreamBytes) throw new Error('Chat response exceeded the size limit');
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseEvents(buffer);
          for (const event of parsed.events) {
            finish(event);
            const delta = deltaFromEvent(event);
            if (delta !== undefined) {
              firstDeltaMs ??= performance.now() - invocationStarted;
              yield delta;
            }
          }
          buffer = parsed.pending;
        }
        buffer += decoder.decode();
        const finalEvents = parseEvents(`${buffer}\n\n`).events;
        for (const event of finalEvents) {
          finish(event);
          const delta = deltaFromEvent(event);
          if (delta !== undefined) {
            firstDeltaMs ??= performance.now() - invocationStarted;
            yield delta;
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      if (!completed) throw new Error('Chat agent response ended unexpectedly');
    },
  };
}
