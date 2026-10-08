import type { ServerSentEvent } from '@jarvis/contracts';

export interface SseResponse {
  write(chunk: string): boolean;
}

export function formatSseEvent(event: ServerSentEvent): string {
  const id = 'id' in event ? `id: ${event.id}\n` : '';
  return `${id}event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

export function writeSseEvent(response: SseResponse, event: ServerSentEvent): boolean {
  return response.write(formatSseEvent(event));
}
