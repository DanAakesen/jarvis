type TokenProvider = (scope: string, signal: AbortSignal) => Promise<string>;

const TOKEN_FETCH_TIMEOUT_MS = 10_000;
const TOKEN_REFRESH_AHEAD_MS = 5 * 60_000;
const TOKEN_REFRESH_RETRY_MS = 30_000;
const TOKEN_FALLBACK_LIFETIME_MS = 10 * 60_000;
const TOKEN_MAX_LIFETIME_MS = 60 * 60_000;

function tokenExpiry(token: string): number | undefined {
  const payload = token.split('.')[1];
  if (!payload) return undefined;
  try {
    const exp = (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown }).exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1_000 : undefined;
  } catch {
    return undefined;
  }
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('Voice credential refresh timed out'));
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      cleanup();
      reject(signal.reason ?? new Error('Voice credential refresh timed out'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { cleanup(); resolve(value); },
      (error: unknown) => { cleanup(); reject(error); },
    );
    if (signal.aborted) onAbort();
  });
}

export function createVoiceCredentialCache(
  getToken: TokenProvider,
  scope: string,
  onRefreshError: (error: unknown) => void,
) {
  let token: string | undefined;
  let expiresAt = 0;
  let refreshPromise: Promise<string> | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;

  const scheduleRefresh = (delay: number) => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      void refresh().catch(() => {});
    }, delay);
    refreshTimer.unref();
  };

  const refresh = async (): Promise<string> => {
    if (refreshPromise) return await refreshPromise;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Voice credential refresh timed out')), TOKEN_FETCH_TIMEOUT_MS);
    timeout.unref();
    const pending = withAbort(Promise.resolve().then(() => getToken(scope, controller.signal)), controller.signal);
    refreshPromise = pending.then((freshToken) => {
      if (typeof freshToken !== 'string' || !freshToken.trim() || freshToken.length > 10_000 ||
          /[\r\n]/u.test(freshToken)) {
        throw new Error('Invalid Voice authentication');
      }
      const now = Date.now();
      const expiry = Math.min(
        tokenExpiry(freshToken) ?? now + TOKEN_FALLBACK_LIFETIME_MS,
        now + TOKEN_MAX_LIFETIME_MS,
      );
      if (expiry <= now) throw new Error('Voice authentication is expired');
      token = freshToken;
      expiresAt = expiry;
      const lifetime = expiry - now;
      const refreshAhead = Math.min(TOKEN_REFRESH_AHEAD_MS, Math.max(1_000, lifetime * 0.2));
      scheduleRefresh(Math.max(1_000, lifetime - refreshAhead));
      return freshToken;
    }).catch((error: unknown) => {
      onRefreshError(error);
      const retryDelay = token && expiresAt > Date.now()
        ? Math.min(TOKEN_REFRESH_RETRY_MS, Math.max(1_000, expiresAt - Date.now()))
        : TOKEN_REFRESH_RETRY_MS;
      scheduleRefresh(retryDelay);
      throw error;
    }).finally(() => {
      clearTimeout(timeout);
      refreshPromise = undefined;
    });
    return await refreshPromise;
  };

  const get = async (signal: AbortSignal): Promise<string> => {
    signal.throwIfAborted();
    if (token && expiresAt > Date.now()) return token;
    return await withAbort(refresh(), signal);
  };

  return {
    get,
    warm() {
      if (!token || expiresAt <= Date.now()) void refresh().catch(() => {});
    },
  };
}
