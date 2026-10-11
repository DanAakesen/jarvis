import { normalizeFoundryProjectEndpoint } from '../voice/relay.js';
import type { VisualContext } from './visual-context.js';

export interface ConversationAgentInput {
  readonly messageId: string;
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly text: string;
  readonly language: 'da' | 'en';
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
}

export interface ConversationVisualResult {
  readonly visualPath: 'image' | 'caption';
  readonly visualReason?: string;
  readonly model?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface ConversationAgent {
  stream(input: ConversationAgentInput, authorization: string, signal: AbortSignal): AsyncIterable<string>;
}

const maxStreamBytes = 1024 * 1024;
const requestTimeoutMs = 120_000;
export const FOUNDRY_AGENT_SCOPE = 'https://ai.azure.com/.default';

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

export function createFoundryInvocationsEndpoint(projectEndpoint: string, agentName: string): URL {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(agentName)) {
    throw new TypeError('Foundry chat agent name is invalid');
  }
  const url = new URL(normalizeFoundryProjectEndpoint(projectEndpoint));
  url.pathname += `/agents/${agentName}/endpoint/protocols/invocations`;
  url.searchParams.set('api-version', 'v1');
  return url;
}

export function createFoundryInvocationConversationAgent(
  projectEndpoint: string,
  agentName: string,
  getToken: (scope: string, signal: AbortSignal) => Promise<string>,
  fetcher: typeof fetch = fetch,
): ConversationAgent {
  const url = createFoundryInvocationsEndpoint(projectEndpoint, agentName);
  return {
    async *stream(input, authorization, signal) {
      const { onVisualResult, ...payload } = input;
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]);
      const token = await getToken(FOUNDRY_AGENT_SCOPE, requestSignal);
      if (typeof token !== 'string' || !token.trim() || /[\r\n]/u.test(token)) {
        throw new Error('Foundry authentication unavailable');
      }
      const response = await fetcher(url, {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...payload, delegatedAuthorization: authorization }),
        signal: requestSignal,
      });
      if (!response.ok || !response.body ||
          !response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
        throw new Error(`Chat agent unavailable (HTTP ${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let receivedBytes = 0;
      let completed = false;
      const finish = (event: { event: string; data: string }) => {
        if (event.event !== 'done') return;
        completed = true;
        try {
          const result = JSON.parse(event.data) as Record<string, unknown>;
          if (result.visualPath === 'image' || result.visualPath === 'caption') {
            onVisualResult?.({ visualPath: result.visualPath,
              ...(typeof result.model === 'string' && /^[A-Za-z0-9][A-Za-z0-9: ._-]{0,127}$/u.test(result.model)
                ? { model: result.model } : {}),
              ...(Number.isSafeInteger(result.inputTokens) && (result.inputTokens as number) >= 0 &&
                (result.inputTokens as number) <= 10_000_000 ? { inputTokens: result.inputTokens as number } : {}),
              ...(Number.isSafeInteger(result.outputTokens) && (result.outputTokens as number) >= 0 &&
                (result.outputTokens as number) <= 10_000_000 ? { outputTokens: result.outputTokens as number } : {}),
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
            if (delta !== undefined) yield delta;
          }
          buffer = parsed.pending;
        }
        buffer += decoder.decode();
        const finalEvents = parseEvents(`${buffer}\n\n`).events;
        for (const event of finalEvents) {
          finish(event);
          const delta = deltaFromEvent(event);
          if (delta !== undefined) yield delta;
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      if (!completed) throw new Error('Chat agent response ended unexpectedly');
    },
  };
}
