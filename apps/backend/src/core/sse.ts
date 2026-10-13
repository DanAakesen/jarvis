import type { ServerSentEvent } from '@jarvis/contracts';
import type { ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';

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

export function registerSseShutdown(
  app: FastifyInstance,
  response: ServerResponse,
  cleanup: () => void,
): () => void {
  const close = () => {
    cleanup();
    if (!response.writableEnded && !response.destroyed) {
      response.end('retry: 1000\nevent: reconnect\ndata: {}\n\n');
    }
  };
  if (app.isStopping) close();
  else app.shutdownConnections.add(close);
  const unregister = () => { app.shutdownConnections.delete(close); };
  response.once('close', unregister);
  return unregister;
}
