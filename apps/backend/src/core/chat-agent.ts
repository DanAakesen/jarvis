import { normalizeFoundryProjectEndpoint } from '../voice/relay.js';

export interface ConversationAgentInput {
  readonly messageId: string;
  readonly text: string;
  readonly language: 'da' | 'en';
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

function deltaFromEvent(event: { event: string; data: string }): string | undefined {
  if (event.event === 'error') throw new Error('Chat agent failed');
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
        body: JSON.stringify({ ...input, delegatedAuthorization: authorization }),
        signal: requestSignal,
      });
      if (!response.ok || !response.body ||
          !response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
        throw new Error('Chat agent unavailable');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let receivedBytes = 0;
      let completed = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          receivedBytes += value.byteLength;
          if (receivedBytes > maxStreamBytes) throw new Error('Chat response exceeded the size limit');
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseEvents(buffer);
          for (const event of parsed.events) {
            if (event.event === 'done') completed = true;
            const delta = deltaFromEvent(event);
            if (delta !== undefined) yield delta;
          }
          buffer = parsed.pending;
        }
        buffer += decoder.decode();
        const finalEvents = parseEvents(`${buffer}\n\n`).events;
        for (const event of finalEvents) {
          if (event.event === 'done') completed = true;
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
