const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REQUEST_TIMEOUT_MS = 20_000;

export interface GoogleOAuthCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

export class GoogleOAuthError extends Error {
  constructor(readonly kind: 'invalid-grant' | 'unavailable') {
    super('Google OAuth token refresh failed');
    this.name = 'GoogleOAuthError';
  }
}

export interface GoogleTokenProviderOptions {
  readonly getCredentials: () => Promise<GoogleOAuthCredentials>;
  readonly onInvalidGrant: () => Promise<void>;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

export interface GoogleTokenProvider {
  getToken(signal: AbortSignal): Promise<string>;
}

async function responseJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new GoogleOAuthError('unavailable');
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65_536) {
        await reader.cancel();
        throw new GoogleOAuthError('unavailable');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof GoogleOAuthError) throw error;
    throw new GoogleOAuthError('unavailable');
  } finally {
    reader.releaseLock();
  }
  try { return JSON.parse(text); } catch { throw new GoogleOAuthError('unavailable'); }
}

function waitForSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { cleanup(); resolve(value); },
      (error: unknown) => { cleanup(); reject(error); },
    );
  });
}

export function createGoogleTokenProvider({
  getCredentials,
  onInvalidGrant,
  fetch: fetcher = fetch,
  now = Date.now,
}: GoogleTokenProviderOptions): GoogleTokenProvider {
  let cachedToken: { value: string; expiresAt: number } | undefined;
  let refreshRequest: Promise<string> | undefined;

  return {
    async getToken(signal) {
      signal.throwIfAborted();
      if (cachedToken && cachedToken.expiresAt - 60_000 > now()) return cachedToken.value;
      refreshRequest ??= (async () => {
        const credentials = await getCredentials();
        if ([credentials.clientId, credentials.clientSecret, credentials.refreshToken].some((value) =>
          !value.trim() || value.length > 10_000 || /[\r\n]/u.test(value))) {
          throw new GoogleOAuthError('unavailable');
        }
        const requestSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
        let response: Response;
        try {
          response = await fetcher(TOKEN_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: new URLSearchParams({
              client_id: credentials.clientId,
              client_secret: credentials.clientSecret,
              refresh_token: credentials.refreshToken,
              grant_type: 'refresh_token',
            }),
            redirect: 'error',
            signal: requestSignal,
          });
        } catch {
          throw new GoogleOAuthError('unavailable');
        }

        const payload = await responseJson(response);
        if (!response.ok) {
          if (response.status === 400 &&
              payload !== null && typeof payload === 'object' &&
              (payload as Record<string, unknown>).error === 'invalid_grant') {
            await onInvalidGrant().catch(() => undefined);
            throw new GoogleOAuthError('invalid-grant');
          }
          throw new GoogleOAuthError('unavailable');
        }
        const token = payload !== null && typeof payload === 'object'
          ? (payload as Record<string, unknown>).access_token
          : undefined;
        const expiresIn = payload !== null && typeof payload === 'object'
          ? (payload as Record<string, unknown>).expires_in
          : undefined;
        if (typeof token !== 'string' || !token.trim() || token.length > 10_000 ||
            /[\r\n]/u.test(token) || typeof expiresIn !== 'number' ||
            !Number.isFinite(expiresIn) || expiresIn <= 0 || expiresIn > 86_400) {
          throw new GoogleOAuthError('unavailable');
        }
        cachedToken = { value: token, expiresAt: now() + expiresIn * 1000 };
        return token;
      })().finally(() => { refreshRequest = undefined; });
      return waitForSignal(refreshRequest, signal);
    },
  };
}
