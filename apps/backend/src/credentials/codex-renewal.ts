import { randomUUID } from 'node:crypto';
import { FoundryClientError, type FoundryClient, type FoundryErrorKind, type InvocationStatus } from '../foundry/client.js';
import type { CredentialStatusStore, CredentialStatusValue } from './credential-status.js';

const leaseSeconds = 15 * 60;
const heartbeatIntervalMs = 60_000;
const pollIntervalMs = 5_000;
const operationTimeoutMs = 8 * 60_000;
const dayMs = 24 * 60 * 60_000;
const retryDelayMs = 15 * 60_000;
const maxRetryDelayMs = 60 * 60_000;
const terminalStatuses = new Set<InvocationStatus>([
  'completed', 'failed', 'cancelled', 'interrupted', 'paused',
]);

type RenewalResult = 'skipped' | 'fresh' | 'renewed' | 'failed' | 'uncertain';
interface RenewalDiagnostics {
  kind?: FoundryErrorKind | 'internal';
  statusCode?: number | undefined;
}

function diagnostics(error: unknown): RenewalDiagnostics {
  return error instanceof FoundryClientError
    ? { kind: error.kind, statusCode: error.statusCode }
    : { kind: 'internal' };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function credentialStatus(expiresAt: string, now: number): Exclude<CredentialStatusValue, 'failed' | 'unknown'> {
  return Date.parse(expiresAt) - now <= 3 * dayMs ? 'renew_soon' : 'ok';
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new FoundryClientError('aborted', 'renewal'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

export async function runCodexRenewalOnce(
  store: CredentialStatusStore,
  client: Pick<FoundryClient, 'startCodexRenewal' | 'status' | 'deleteSession'>,
  onError: (details: RenewalDiagnostics) => void = () => {},
  force = false,
): Promise<RenewalResult> {
  const owner = randomUUID();
  if (!await store.acquireCodexRenewalLease(owner, leaseSeconds)) return 'skipped';

  const controller = new AbortController();
  let heartbeatBusy = false;
  const heartbeat = setInterval(() => {
    if (heartbeatBusy || controller.signal.aborted) return;
    heartbeatBusy = true;
    void store.refreshCodexRenewalLease(owner, leaseSeconds)
      .then((refreshed) => { if (!refreshed) controller.abort(); })
      .catch(() => controller.abort())
      .finally(() => { heartbeatBusy = false; });
  }, heartbeatIntervalMs);
  const deadline = setTimeout(() => controller.abort(), operationTimeoutMs);
  let sessionId: string | undefined;
  let terminal = false;
  let status: Exclude<CredentialStatusValue, 'unknown'> = 'failed';
  let expiresAt: string | null = null;
  let lastRenewedAt: string | null = null;
  let result: RenewalResult = 'uncertain';

  try {
    const accepted = await client.startCodexRenewal({ signal: controller.signal, force });
    sessionId = accepted.sessionId;
    for (;;) {
      const snapshot = await client.status(accepted.invocationId, { signal: controller.signal });
      if (terminalStatuses.has(snapshot.status)) {
        terminal = true;
        if (snapshot.status === 'completed' && snapshot.error === null && isObject(snapshot.result)) {
          const renewal = snapshot.result;
          const didRenew = renewal['renewed'] === true;
          expiresAt = didRenew ? renewal['expires_after'] as string : renewal['expires'] as string;
          lastRenewedAt = didRenew ? renewal['last_refresh_after'] as string : null;
          if (validDate(expiresAt) && (!didRenew || validDate(lastRenewedAt))) {
            status = credentialStatus(expiresAt, Date.now());
            result = didRenew ? 'renewed' : 'fresh';
          } else {
            result = 'failed';
          }
        } else {
          result = 'failed';
        }
        break;
      }
      await sleep(pollIntervalMs, controller.signal);
    }
  } catch (error) {
    result = 'uncertain';
    onError(diagnostics(error));
  } finally {
    clearTimeout(deadline);
    clearInterval(heartbeat);
    if (sessionId && terminal) {
      try { await client.deleteSession(sessionId); }
      catch { /* A completed renewal is safe to release even if session cleanup fails. */ }
    }
    if (result !== 'uncertain') {
      await store.completeCodexRenewal(owner, status, expiresAt, lastRenewedAt, terminal);
    }
  }
  return result;
}

export function startDailyCodexRenewalJob(
  store: CredentialStatusStore,
  client: Pick<FoundryClient, 'startCodexRenewal' | 'status' | 'deleteSession'>,
  onResult: (result: RenewalResult, details: RenewalDiagnostics) => void,
): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let retryMs = retryDelayMs;
  const run = async () => {
    let outcome: RenewalResult;
    let details: RenewalDiagnostics = {};
    try { outcome = await runCodexRenewalOnce(store, client, (error) => { details = error; }); }
    catch (error) {
      outcome = 'uncertain';
      details = diagnostics(error);
    }
    onResult(outcome, details);
    const delay = outcome === 'uncertain' ? retryMs : dayMs;
    retryMs = outcome === 'uncertain' ? Math.min(retryMs * 2, maxRetryDelayMs) : retryDelayMs;
    if (!stopped) {
      timer = setTimeout(() => { void run(); }, delay);
      timer.unref();
    }
  };
  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
