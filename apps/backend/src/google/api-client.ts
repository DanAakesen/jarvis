import { GoogleOAuthError, type GoogleTokenProvider } from './oauth.js';

const ORIGINS = {
  calendar: { origin: 'https://www.googleapis.com', prefix: '/calendar/v3' },
  gmail: { origin: 'https://gmail.googleapis.com', prefix: '/gmail/v1' },
} as const;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export type GoogleApi = keyof typeof ORIGINS;

export interface GoogleApiRequest {
  readonly method?: 'GET' | 'POST' | 'PATCH';
  readonly body?: unknown;
  readonly signal: AbortSignal;
}

export interface GoogleApiClient {
  request(api: GoogleApi, path: string, options: GoogleApiRequest): Promise<Record<string, unknown>>;
}

export class GoogleApiError extends Error {
  constructor(
    readonly kind: 'throttled' | 'unavailable' | 'forbidden' | 'not-found' | 'rejected' | 'uncertain' | 'credentials-expired',
    readonly statusCode?: number,
  ) {
    super('Google API request failed');
    this.name = 'GoogleApiError';
  }
}

export interface GoogleApiClientOptions {
  readonly tokens: GoogleTokenProvider;
  readonly fetch?: typeof fetch;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw new GoogleApiError('unavailable');
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
        throw new GoogleApiError('unavailable');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof GoogleApiError) throw error;
    throw new GoogleApiError('unavailable');
  } finally {
    reader.releaseLock();
  }
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { throw new GoogleApiError('unavailable'); }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new GoogleApiError('unavailable');
  }
  return payload as Record<string, unknown>;
}

function requestError(statusCode: number, write: boolean): GoogleApiError {
  if (write && statusCode >= 500) return new GoogleApiError('uncertain', statusCode);
  if (statusCode === 401) return new GoogleApiError('credentials-expired', statusCode);
  if (statusCode === 403) return new GoogleApiError('forbidden', statusCode);
  if (statusCode === 404) return new GoogleApiError('not-found', statusCode);
  if (statusCode === 429) return new GoogleApiError('throttled', statusCode);
  if (statusCode >= 500) return new GoogleApiError('unavailable', statusCode);
  return new GoogleApiError('rejected', statusCode);
}

export function createGoogleApiClient({
  tokens,
  fetch: fetcher = fetch,
}: GoogleApiClientOptions): GoogleApiClient {
  return {
    async request(api, path, options) {
      if (!Object.hasOwn(ORIGINS, api) || typeof path !== 'string' || !path.startsWith('/') ||
          path.startsWith('//') || /[\r\n]/u.test(path)) {
        throw new GoogleApiError('rejected');
      }
      const apiRoot = ORIGINS[api];
      const url = new URL(`${apiRoot.prefix}${path}`, apiRoot.origin);
      if (url.origin !== apiRoot.origin || !url.pathname.startsWith(`${apiRoot.prefix}/`)) {
        throw new GoogleApiError('rejected');
      }
      const signal = AbortSignal.any([options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
      signal.throwIfAborted();
      let token: string;
      try { token = await tokens.getToken(signal); }
      catch (error) {
        if (error instanceof GoogleOAuthError && error.kind === 'invalid-grant') {
          throw new GoogleApiError('credentials-expired');
        }
        throw new GoogleApiError('unavailable');
      }
      if (typeof token !== 'string' || !token.trim() || /[\r\n]/u.test(token)) {
        throw new GoogleApiError('unavailable');
      }
      const method = options.method ?? 'GET';
      const write = method !== 'GET';
      let response: Response;
      try {
        response = await fetcher(url, {
          method,
          headers: {
            Authorization: 'Bearer ' + token,
            Accept: 'application/json',
            ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
          redirect: 'error',
          signal,
        });
      } catch {
        throw new GoogleApiError(write ? 'uncertain' : 'unavailable');
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw requestError(response.status, write);
      }
      if (response.status === 204) {
        await response.body?.cancel().catch(() => undefined);
        return {};
      }
      try {
        return await readJson(response);
      } catch (error) {
        if (write) throw new GoogleApiError('uncertain', response.status);
        throw error;
      }
    },
  };
}
