import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { backendFetch } from './backend-request';

export type PresenceMode = 'present' | 'away' | 'on_the_move';

export const presenceModes: readonly { mode: PresenceMode; label: string; tone: string }[] = [
  { mode: 'present', label: 'Present', tone: 'var(--presence-present)' },
  { mode: 'away', label: 'Away', tone: 'var(--presence-away)' },
  { mode: 'on_the_move', label: 'On the move', tone: 'var(--presence-move)' },
];

export type PresenceState =
  | { status: 'idle' | 'loading' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string }
  | { status: 'ready'; mode: PresenceMode; source: string | null; changedAt: string | null; saving: PresenceMode | null; error: string };

export function isPresenceMode(value: unknown): value is PresenceMode {
  return value === 'present' || value === 'away' || value === 'on_the_move';
}

export function presenceLabel(mode: PresenceMode) {
  return presenceModes.find((entry) => entry.mode === mode)!.label;
}

let state: PresenceState = { status: 'idle' };
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function setState(next: PresenceState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** A missing route means the presence backend has not been deployed yet; that is shown, never guessed. */
const unavailableStatuses = new Set([404, 405, 501]);

async function request(backendUrl: string, getAccessToken: () => Promise<string>, init?: { mode: PresenceMode; source?: 'device' }) {
  const token = await getAccessToken();
  return backendFetch(`${backendUrl.replace(/\/+$/u, '')}/presence`, {
    method: init ? 'PUT' : 'GET',
    headers: {
      Authorization: `${['Bear', 'er'].join('')} ${token}`,
      Accept: 'application/json',
      ...(init ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(init ? { body: JSON.stringify(init.source ? { mode: init.mode, source: init.source } : { mode: init.mode }) } : {}),
    cache: 'no-store',
  });
}

function readPresence(value: unknown): { mode: PresenceMode; source: string | null; changedAt: string | null } | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!isPresenceMode(record.mode)) return null;
  return {
    mode: record.mode,
    source: typeof record.source === 'string' ? record.source.slice(0, 40) : null,
    changedAt: typeof record.changedAt === 'string' && !Number.isNaN(Date.parse(record.changedAt)) ? record.changedAt : null,
  };
}

async function load(backendUrl: string, getAccessToken: () => Promise<string>, quiet: boolean) {
  if (!quiet && state.status !== 'ready') setState({ status: 'loading' });
  try {
    const response = await request(backendUrl, getAccessToken);
    if (unavailableStatuses.has(response.status)) {
      await response.body?.cancel().catch(() => {});
      setState({ status: 'unavailable' });
      return;
    }
    if (!response.ok) throw new Error('Presence could not be loaded.');
    const presence = readPresence(await response.json());
    if (!presence) throw new Error('Presence returned an unknown mode.');
    setState({ status: 'ready', ...presence, saving: null, error: '' });
  } catch (error) {
    if (state.status !== 'ready') setState({ status: 'error', message: error instanceof Error ? error.message : 'Presence could not be loaded.' });
  }
}

/** Applies a live `mode_changed` event, so a switch made by Jarvis shows at once. */
export function publishPresenceMode(mode: string) {
  if (!isPresenceMode(mode)) return;
  if (state.status === 'ready') setState({ ...state, mode, source: 'jarvis', changedAt: new Date().toISOString(), saving: null, error: '' });
  else setState({ status: 'ready', mode, source: 'jarvis', changedAt: new Date().toISOString(), saving: null, error: '' });
}

export function resetPresenceForTests() {
  state = { status: 'idle' };
  inflight = null;
  lastDeviceSync = 0;
}

// Phones are where Dan is on the move (Dan, 8 October, P9-44): a touch device with a phone-sized screen. A narrow
// desktop window is not a phone, so the pointer decides as well as the size.
const phoneDeviceQuery = '(pointer: coarse) and (max-width: 900px), (pointer: coarse) and (max-height: 500px)';
const manualHold = 2 * 60 * 60 * 1000;
const deviceResync = 10 * 60 * 1000;
let lastDeviceSync = 0;

async function syncDevicePresence(backendUrl: string, getAccessToken: () => Promise<string>) {
  if (state.status !== 'ready' || state.saving) return;
  const target: PresenceMode = window.matchMedia?.(phoneDeviceQuery).matches ? 'on_the_move' : 'present';
  const recentManual = state.source === 'manual' && state.changedAt !== null && Date.now() - Date.parse(state.changedAt) < manualHold;
  if (state.mode === target || recentManual) return;
  lastDeviceSync = Date.now();
  try {
    const response = await request(backendUrl, getAccessToken, { mode: target, source: 'device' });
    if (!response.ok) return;
    const presence = readPresence(await response.json().catch(() => null));
    if (presence && state.status === 'ready') setState({ ...state, ...presence, saving: null, error: '' });
  } catch {
    // Device presence is a convenience; a failed attempt leaves the current mode and is retried later.
  }
}

/** Sets On the move on a phone and Present on a computer, unless Dan chose a mode himself in the last two hours. */
export function useDevicePresence(backendUrl: string | null, getAccessToken: () => Promise<string>, enabled: boolean) {
  const current = useSyncExternalStore(subscribe, () => state, () => state);
  const ready = current.status === 'ready';
  useEffect(() => {
    if (!backendUrl || !enabled || !ready) return;
    if (lastDeviceSync === 0) void syncDevicePresence(backendUrl, getAccessToken);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastDeviceSync > deviceResync) void syncDevicePresence(backendUrl, getAccessToken);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [backendUrl, enabled, getAccessToken, ready]);
}

/** Shared presence state: loaded once, refreshed every minute while the page is visible, switched with PUT. */
export function usePresence(backendUrl: string | null, getAccessToken: () => Promise<string>) {
  const current = useSyncExternalStore(subscribe, () => state, () => state);
  useEffect(() => {
    if (!backendUrl) return;
    if (state.status === 'idle' && !inflight) {
      inflight = load(backendUrl, getAccessToken, false).finally(() => { inflight = null; });
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && state.status === 'ready' && !inflight) {
        inflight = load(backendUrl, getAccessToken, true).finally(() => { inflight = null; });
      }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [backendUrl, getAccessToken]);

  const setMode = useCallback(async (mode: PresenceMode) => {
    if (!backendUrl || state.status !== 'ready' || state.saving) return;
    const previous = state;
    setState({ ...previous, saving: mode, error: '' });
    try {
      const response = await request(backendUrl, getAccessToken, { mode });
      if (!response.ok) throw new Error('Jarvis could not switch mode. Try again.');
      const presence = readPresence(await response.json().catch(() => null)) ?? { mode, source: 'manual', changedAt: new Date().toISOString() };
      setState({ status: 'ready', ...presence, saving: null, error: '' });
    } catch (error) {
      setState({ ...previous, saving: null, error: error instanceof Error ? error.message : 'Jarvis could not switch mode. Try again.' });
    }
  }, [backendUrl, getAccessToken]);

  const retry = useCallback(() => {
    if (!backendUrl || inflight) return;
    inflight = load(backendUrl, getAccessToken, false).finally(() => { inflight = null; });
  }, [backendUrl, getAccessToken]);

  return { presence: current, setMode, retry };
}
