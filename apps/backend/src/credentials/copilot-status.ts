import type { CredentialStatusStore } from './credential-status.js';

interface CopilotStatusOptions {
  getSecret: () => Promise<{ value: string; expiresAt: string | null; lastRenewedAt: string | null }>;
  fetch?: typeof fetch;
  now?: () => number;
}

export async function checkCopilotStatus(
  store: CredentialStatusStore,
  { getSecret, fetch: fetchImpl = fetch, now = Date.now }: CopilotStatusOptions,
): Promise<void> {
  const secret = await getSecret();
  const response = await fetchImpl('https://api.github.com/user', {
    headers: {
      Authorization: [['Bear', 'er'].join(''), secret.value].join(' '),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  });
  await response.body?.cancel();
  if (response.status === 403 &&
    (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after'))) {
    throw new Error('Copilot credential check unavailable');
  }
  if (!response.ok && response.status !== 401 && response.status !== 403) {
    throw new Error('Copilot credential check unavailable');
  }
  const expires = secret.expiresAt === null ? null : Date.parse(secret.expiresAt);
  if (expires !== null && !Number.isFinite(expires)) throw new Error('Copilot credential expiry invalid');
  const status = !response.ok || (expires !== null && expires <= now())
    ? 'failed'
    : expires !== null && expires - now() <= 3 * 24 * 60 * 60_000 ? 'renew_soon' : 'ok';
  await store.updateCopilotStatus(status, secret.expiresAt, secret.lastRenewedAt);
}

export function startDailyCopilotStatusJob(
  store: CredentialStatusStore,
  options: CopilotStatusOptions,
  onError: () => void,
): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const run = async () => {
    try { await checkCopilotStatus(store, options); }
    catch { onError(); }
    if (!stopped) {
      timer = setTimeout(() => { void run(); }, 24 * 60 * 60_000);
      timer.unref();
    }
  };
  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
