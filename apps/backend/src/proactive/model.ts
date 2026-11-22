import { normalizeFoundryProjectEndpoint } from '../voice/live-protocol.js';

/** What the old event reasoner (`events/reasoner.ts`) still reads a one-shot model answer with. They go with it (#1887). */
export const MAX_PROACTIVE_RESPONSE_BYTES = 32 * 1024;

export class InvalidModelOutput extends Error {}

export async function cancellable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort = () => {};
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    })]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

export async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body || Number(response.headers.get('content-length')) > MAX_PROACTIVE_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw new InvalidModelOutput();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await cancellable(reader.read(), signal);
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PROACTIVE_RESPONSE_BYTES) throw new InvalidModelOutput();
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))) as unknown;
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (signal.aborted) throw error;
    throw new InvalidModelOutput();
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

/** Invalid or missing configuration returns undefined, which leaves the model unavailable. */
export function foundryChatEndpoint(foundryProjectEndpoint: string | undefined): URL | undefined {
  try {
    const endpoint = new URL('/models/chat/completions',
      new URL(normalizeFoundryProjectEndpoint(foundryProjectEndpoint ?? '')).origin);
    endpoint.searchParams.set('api-version', '2024-05-01-preview');
    return endpoint;
  } catch { return undefined; }
}
