import type { AwayModeStore } from '../core/away-mode.js';
import type { GraphClient } from './client.js';

const requestTimeoutMs = 10_000;
const permissionRetryMs = 24 * 60 * 60_000;
const presenceStatuses = new Set([
  'Available', 'AvailableIdle', 'Away', 'BeRightBack', 'Busy', 'BusyIdle',
  'DoNotDisturb', 'Offline', 'PresenceUnknown',
]);
const ownerIdPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu;

export type ObservedPresence = 'away' | 'present' | null;

export function parseObservedPresence(value: unknown): ObservedPresence {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Microsoft Graph presence response was invalid');
  }
  const availability = (value as Record<string, unknown>).availability;
  if (typeof availability !== 'string' || !presenceStatuses.has(availability)) {
    throw new Error('Microsoft Graph presence response was invalid');
  }
  if (availability === 'Away' || availability === 'Offline') return 'away';
  if (availability === 'PresenceUnknown') return null;
  return 'present';
}

export function startGraphPresenceMonitor(
  enabled: boolean,
  graph: GraphClient,
  ownerObjectId: string,
  store: AwayModeStore,
  onError: (error: unknown) => void,
  onAvailabilityChange: (unavailable: boolean, statusCode?: number) => void,
  intervalMs = 60_000,
): () => Promise<void> {
  if (!enabled) return async () => {};
  if (!ownerIdPattern.test(ownerObjectId)) throw new TypeError('Invalid Graph presence owner');
  let stopped = false;
  let controller: AbortController | undefined;
  let running: Promise<void> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let unavailable = false;

  const schedulePolling = () => {
    if (stopped || pollTimer) return;
    pollTimer = setInterval(check, intervalMs);
    pollTimer.unref();
  };

  const schedulePermissionRetry = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = undefined;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      check();
    }, permissionRetryMs);
    retryTimer.unref();
  };

  const check = () => {
    if (stopped || running) return;
    controller = new AbortController();
    const activeController = controller;
    const signal = AbortSignal.any([activeController.signal, AbortSignal.timeout(requestTimeoutMs)]);
    running = graph.get(`users/${ownerObjectId}/presence`, signal)
      .then(async (value) => {
        const presence = parseObservedPresence(value);
        if (unavailable) {
          unavailable = false;
          onAvailabilityChange(false);
          schedulePolling();
        }
        await store.observePresence(presence === null ? null : presence === 'away');
      })
      .catch((error: unknown) => {
        if (activeController.signal.aborted) return;
        const statusCode = typeof error === 'object' && error !== null
          ? (error as { statusCode?: unknown }).statusCode
          : undefined;
        if (statusCode === 401 || statusCode === 403) {
          if (!unavailable) {
            unavailable = true;
            onAvailabilityChange(true, statusCode);
          }
          schedulePermissionRetry();
          return;
        }
        onError(error);
        if (unavailable) schedulePermissionRetry();
      })
      .finally(() => {
        if (controller === activeController) controller = undefined;
        running = undefined;
      });
  };
  check();
  schedulePolling();
  return async () => {
    stopped = true;
    if (pollTimer) clearInterval(pollTimer);
    if (retryTimer) clearTimeout(retryTimer);
    controller?.abort();
    await running;
  };
}
