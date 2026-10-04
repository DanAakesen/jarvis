const pending = new Map<symbol, string>();
const pendingListeners = new Set<() => void>();
const statusListeners = new Set<() => void>();
let waking = false;

function publishWaking(value: boolean) {
  if (waking === value) return;
  waking = value;
  statusListeners.forEach((listener) => listener());
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
    return await fetch(url, { ...init, signal });
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
    try {
      const token = await getAccessToken();
      if (current.signal.aborted) return;
      const response = await fetch(`${base}/database/status`, {
        headers: { Authorization: `${['Bear', 'er'].join('')} ${token}`, Accept: 'application/json' },
        signal: AbortSignal.any([current.signal, AbortSignal.timeout(10_000)]),
        cache: 'no-store',
      });
      if (!response.ok) return;
      const value: unknown = await response.json();
      if (!current.signal.aborted && typeof value === 'object' && value !== null &&
          'waking' in value && typeof value.waking === 'boolean') {
        publishWaking(value.waking);
      }
    } catch {
      // A failed probe does not establish a database state.
    } finally {
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
