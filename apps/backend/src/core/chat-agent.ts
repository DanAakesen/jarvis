export interface ConversationAgentInput {
  readonly messageId: string;
  readonly text: string;
  readonly language: 'da' | 'en';
}

export interface ConversationAgent {
  stream(input: ConversationAgentInput, authorization: string, signal: AbortSignal): AsyncIterable<string>;
}

const maxStreamBytes = 1024 * 1024;

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

export function createHttpConversationAgent(endpoint: string): ConversationAgent {
  const url = new URL(endpoint);
  return {
    async *stream(input, authorization, signal) {
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: authorization,
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
        signal,
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
