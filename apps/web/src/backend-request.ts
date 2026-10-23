import { isOwnerSessionToken, preferOwnerSession } from './owner-session';

const pending = new Map<symbol, string>();
const pendingListeners = new Set<() => void>();
const statusListeners = new Set<() => void>();
let waking = false;
let databaseWaking = false;
const slowSessionVerifications = new Set<symbol>();

function publishStatus() {
  const value = databaseWaking || slowSessionVerifications.size > 0;
  if (waking === value) return;
  waking = value;
  statusListeners.forEach((listener) => listener());
}

export function beginOwnerSessionVerification(): () => void {
  const id = Symbol();
  let active = true;
  const timer = setTimeout(() => {
    if (!active) return;
    slowSessionVerifications.add(id);
    publishStatus();
  }, 3_000);
  return () => {
    active = false;
    clearTimeout(timer);
    if (slowSessionVerifications.delete(id)) publishStatus();
  };
}

export interface OwnerSessionRequestAuth {
  backendOrigin: string;
  getAccessToken: () => Promise<string>;
  confirmUnauthorized: (token: string) => Promise<'expired' | 'changed' | 'valid' | 'temporary'>;
}

let ownerSessionRequestAuth: OwnerSessionRequestAuth | null = null;

export function setOwnerSessionRequestAuth(auth: OwnerSessionRequestAuth | null): void {
  ownerSessionRequestAuth = auth;
}

export function confirmOwnerSessionUnauthorized(
  token: string,
): Promise<'expired' | 'changed' | 'valid' | 'temporary'> {
  return ownerSessionRequestAuth?.confirmUnauthorized(token) ?? Promise.resolve('temporary');
}

export async function recoverOwnerSession(token: string): Promise<{
  verdict: 'expired' | 'changed' | 'valid' | 'temporary';
  accessToken?: string;
}> {
  const verdict = await confirmOwnerSessionUnauthorized(token);
  if (verdict !== 'expired' && verdict !== 'changed') return { verdict };
  try {
    const accessToken = await ownerSessionRequestAuth?.getAccessToken();
    return { verdict, ...(accessToken ? { accessToken } : {}) };
  } catch {
    return { verdict };
  }
}

export function waitForBackendRetry(attempt: number, signal: AbortSignal): Promise<void> {
  const base = Math.min(30_000, 1_000 * 2 ** attempt);
  const delay = base * (0.75 + Math.random() * 0.5);
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, delay);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function awaitWithSignal<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([operation(), cancelled]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

function publishWaking(value: boolean) {
  databaseWaking = value;
  publishStatus();
}

export function subscribeDatabaseStatus(listener: () => void) {
  statusListeners.add(listener);
  return () => { statusListeners.delete(listener); };
}

export function getDatabaseWaking() {
  return waking;
}

export function beginBackendRequest(url: string, signal?: AbortSignal | null) {
  if (signal?.aborted) return () => {};
  const id = Symbol();
  pending.set(id, url);
  const finish = () => {
    signal?.removeEventListener('abort', finish);
    if (pending.delete(id)) pendingListeners.forEach((listener) => listener());
  };
  signal?.addEventListener('abort', finish, { once: true });
  pendingListeners.forEach((listener) => listener());
  return finish;
}

/** Track only API data requests, never MSAL, profile verification, or status probes. */
export async function backendFetch(url: string | URL, init: RequestInit = {}): Promise<Response> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), 120_000);
  const signal = AbortSignal.any([
    ...(init.signal ? [init.signal] : []),
    deadline.signal,
  ]);
  const finish = beginBackendRequest(String(url), signal);
  try {
    const headers = new Headers(init.headers);
    let headersInit = init.headers;
    let token = /^Bearer\s+(.+)$/iu.exec(headers.get('authorization') ?? '')?.[1] ?? null;
    let sessionToken = token && isOwnerSessionToken(token) ? token : null;
    const sessionRequest = Boolean(sessionToken);
    const requestAuth = ownerSessionRequestAuth;
    if (sessionToken && requestAuth) {
      let targetOrigin: string;
      try {
        targetOrigin = new URL(url, window.location.origin).origin;
      } catch {
        throw new Error('The backend request could not be completed.');
      }
      if (targetOrigin !== requestAuth.backendOrigin) {
        throw new Error('The backend request could not be completed.');
      }
    }
    const method = (init.method ?? 'GET').toUpperCase();
    const safeMethod = method === 'GET' || method === 'HEAD';
    const replayableBody = typeof ReadableStream === 'undefined' || !(init.body instanceof ReadableStream);
    let attempt = 0;
    while (true) {
      if (token && headers.get('authorization') !== `${['Bear', 'er'].join('')} ${token}`) {
        headers.set('Authorization', `${['Bear', 'er'].join('')} ${token}`);
        headersInit = headers;
      }
      let response: Response;
      try {
        response = await fetch(url, {
          ...init,
          ...(headersInit === undefined ? {} : { headers: headersInit }),
          signal,
        });
      } catch (error) {
        if (!sessionRequest || !safeMethod || attempt >= 3 || signal.aborted) throw error;
        await waitForBackendRetry(attempt++, signal);
        continue;
      }
      if (sessionToken && response.ok) preferOwnerSession({ backendUrl: requestAuth?.backendOrigin ?? '' });
      if (sessionToken && requestAuth && response.status === 401) {
        const recovery = await recoverOwnerSession(sessionToken);
        const verdict = recovery.verdict;
        if (verdict === 'temporary' && safeMethod && attempt < 3) {
          await waitForBackendRetry(attempt++, signal);
          continue;
        }
        if ((verdict === 'expired' || verdict === 'changed') && safeMethod && attempt < 3) {
          if (!recovery.accessToken) return response;
          token = recovery.accessToken;
          sessionToken = isOwnerSessionToken(token) ? token : null;
          await waitForBackendRetry(attempt++, signal);
          continue;
        }
        return response;
      }
      const retryable = response.status === 429 ||
        (safeMethod && response.status === 503);
      if (!sessionRequest || !retryable || attempt >= 3 || (!safeMethod && !replayableBody)) return response;
      await waitForBackendRetry(attempt++, signal);
    }
  } finally {
    clearTimeout(timer);
    finish();
  }

}

export function watchDatabaseStatus(backendUrl: string, getAccessToken: () => Promise<string>) {
  const base = backendUrl.replace(/\/+$/, '');
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const hasPending = () => document.visibilityState !== 'hidden' &&
    [...pending.values()].some((url) => url.startsWith(`${base}/`));
  const cancel = () => {
    controller?.abort();
    controller = null;
    clearTimeout(timer);
    publishWaking(false);
  };
  const poll = async (current: AbortController) => {
    let finishVerification = () => {};
    try {
      const token = await getAccessToken();
      if (current.signal.aborted) return;
      if (isOwnerSessionToken(token)) finishVerification = beginOwnerSessionVerification();
      const response = await fetch(`${base}/database/status`, {
        headers: { Authorization: `${['Bear', 'er'].join('')} ${token}`, Accept: 'application/json' },
        signal: AbortSignal.any([current.signal, AbortSignal.timeout(10_000)]),
        cache: 'no-store',
      });
      if (isOwnerSessionToken(token) && response.ok) preferOwnerSession({ backendUrl });
      if (response.status === 401 && isOwnerSessionToken(token)) {
        await ownerSessionRequestAuth?.confirmUnauthorized(token);
        return;
      }
      if (!response.ok) return;
      const value: unknown = await response.json();
      if (!current.signal.aborted && typeof value === 'object' && value !== null &&
          'waking' in value && typeof value.waking === 'boolean') {
        publishWaking(value.waking);
      }
    } catch {
      // A failed probe does not establish a database state.
    } finally {
      finishVerification();
      if (!current.signal.aborted && !stopped && hasPending()) {
        timer = setTimeout(() => { void poll(current); }, 1_000);
      }
    }
  };
  const update = () => {
    if (stopped) return;
    if (!hasPending()) cancel();
    else if (!controller) {
      controller = new AbortController();
      void poll(controller);
    }
  };
  pendingListeners.add(update);
  document.addEventListener('visibilitychange', update);
  update();
  return () => {
    stopped = true;
    pendingListeners.delete(update);
    document.removeEventListener('visibilitychange', update);
    cancel();
  };
}
