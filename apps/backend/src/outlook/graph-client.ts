const GRAPH_ORIGIN = 'https://graph.microsoft.com';
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_GET_ATTEMPTS = 3;

export type GraphMethod = 'GET' | 'POST' | 'PATCH';

export interface GraphRequest {
  readonly method?: GraphMethod;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

export interface GraphClient {
  request(path: string, options: GraphRequest): Promise<Record<string, unknown>>;
}

export class GraphClientError extends Error {
  constructor(
    readonly kind: 'throttled' | 'unavailable' | 'forbidden' | 'not-found' | 'rejected' | 'uncertain',
    readonly statusCode?: number,
  ) {
    super('Microsoft Graph request failed');
    this.name = 'GraphClientError';
  }
}

export interface GraphClientOptions {
  readonly getToken: (scope: string, signal: AbortSignal) => Promise<string>;
  readonly fetch?: typeof fetch;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw new GraphClientError('unavailable');
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new GraphClientError('unavailable');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof GraphClientError) throw error;
    throw new GraphClientError('unavailable');
  } finally {
    reader.releaseLock();
  }

  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new GraphClientError('unavailable'); }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new GraphClientError('unavailable');
  }
  return parsed as Record<string, unknown>;
}

function retryDelay(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  const delay = Number.isFinite(seconds) && seconds >= 0
    ? seconds * 1000
    : Date.parse(header) - Date.now();
  return Number.isFinite(delay) && delay >= 0 && delay <= 2_000 ? delay : undefined;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function requestError(statusCode: number, write: boolean): GraphClientError {
  if (write && statusCode >= 500) return new GraphClientError('uncertain', statusCode);
  if (statusCode === 403) return new GraphClientError('forbidden', statusCode);
  if (statusCode === 404) return new GraphClientError('not-found', statusCode);
  if (statusCode === 429) return new GraphClientError('throttled', statusCode);
  if (statusCode >= 500) return new GraphClientError('unavailable', statusCode);
  return new GraphClientError('rejected', statusCode);
}

export function createGraphClient({ getToken, fetch: fetcher = fetch }: GraphClientOptions): GraphClient {
  return {
    async request(path, options) {
      if (typeof path !== 'string' || !path.startsWith('/v1.0/') || path.startsWith('//') ||
          /[\r\n]/u.test(path)) {
        throw new GraphClientError('rejected');
      }
      const url = new URL(path, GRAPH_ORIGIN);
      if (url.origin !== GRAPH_ORIGIN) throw new GraphClientError('rejected');

      const method = options.method ?? 'GET';
      const signal = AbortSignal.any([options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
      signal.throwIfAborted();
      let token: string;
      try { token = await getToken(GRAPH_SCOPE, signal); }
      catch { throw new GraphClientError('unavailable'); }
      if (typeof token !== 'string' || !token.trim() || /[\r\n]/u.test(token)) {
        throw new GraphClientError('unavailable');
      }

      const headers = new Headers({
        Authorization: ['Bea', 'rer ', token].join(''),
        Accept: 'application/json',
        ...options.headers,
      });
      if (options.body !== undefined) headers.set('Content-Type', 'application/json');
      const write = method !== 'GET';
      for (let attempt = 1; ; attempt += 1) {
        signal.throwIfAborted();
        let response: Response;
        try {
          response = await fetcher(url, {
            method,
            headers,
            redirect: 'error',
            ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
            signal,
          });
        } catch {
          throw new GraphClientError(write ? 'uncertain' : 'unavailable');
        }

        if (method === 'GET' && response.status === 429 && attempt < MAX_GET_ATTEMPTS) {
          const delay = retryDelay(response);
          await response.body?.cancel().catch(() => undefined);
          if (delay !== undefined) {
            await wait(delay, signal);
            continue;
          }
        }
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          throw requestError(response.status, write);
        }
        if (response.status === 204 || response.status === 202) {
          await response.body?.cancel().catch(() => undefined);
          return {};
        }
        try {
          return await readJson(response);
        } catch (error) {
          if (write) throw new GraphClientError('uncertain', response.status);
          throw error;
        }
      }
    },
  };
}
