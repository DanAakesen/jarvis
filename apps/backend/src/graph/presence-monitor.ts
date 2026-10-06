import type { AwayModeStore } from '../core/away-mode.js';
import type { GraphClient } from './client.js';

const requestTimeoutMs = 10_000;
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
  graph: GraphClient,
  ownerObjectId: string,
  store: AwayModeStore,
  onError: (error: unknown) => void,
  intervalMs = 60_000,
): () => Promise<void> {
  if (!ownerIdPattern.test(ownerObjectId)) throw new TypeError('Invalid Graph presence owner');
  let stopped = false;
  let controller: AbortController | undefined;
  let running: Promise<void> | undefined;

  const check = () => {
    if (stopped || running) return;
    controller = new AbortController();
    const activeController = controller;
    const signal = AbortSignal.any([activeController.signal, AbortSignal.timeout(requestTimeoutMs)]);
    running = graph.get(`users/${ownerObjectId}/presence`, signal)
      .then((value) => parseObservedPresence(value))
      .then((presence) => store.observePresence(
        presence === null ? null : presence === 'away',
      ))
      .then(() => undefined)
      .catch((error: unknown) => { if (!activeController.signal.aborted) onError(error); })
      .finally(() => {
        if (controller === activeController) controller = undefined;
        running = undefined;
      });
  };
  check();
  const timer = setInterval(check, intervalMs);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    controller?.abort();
    await running;
  };
}
