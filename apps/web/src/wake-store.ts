import { useSyncExternalStore } from 'react';

// Wake word (P9-17): the PC bridge hears "Wake up Jarvis", the backend sends `voice-wake` on the Now stream, and the
// mounted voice controls start voice. The last detection and its outcome are kept for status.

export type WakeOutcome = 'heard' | 'ignored' | 'started' | 'already-active' | 'needs-click' | 'unavailable' | 'error';
export interface WakeStatus { at: string; outcome: WakeOutcome; message: string }

const isoMilliseconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
/** Detections older than this when they arrive (a reconnect replay, a sleeping tab) are recorded but do not start voice. */
const freshFor = 30_000;

let status: WakeStatus | null = null;
const statusListeners = new Set<() => void>();
const wakeListeners = new Set<(at: string) => void>();

function setStatus(next: WakeStatus | null) {
  status = next;
  for (const listener of statusListeners) listener();
}

/** Reads `{ type: 'voice.wake', at }` and returns its timestamp, or null for anything else. */
export function readVoiceWake(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const { type, at } = value as Record<string, unknown>;
  return type === 'voice.wake' && typeof at === 'string' && isoMilliseconds.test(at) && !Number.isNaN(Date.parse(at)) ? at : null;
}

/** Applies a `voice-wake` event once per detection; the voice controls decide what happens next. */
export function publishVoiceWake(at: string) {
  if (status?.at === at) return;
  if (Date.now() - Date.parse(at) > freshFor) {
    setStatus({ at, outcome: 'error', message: 'Heard too long ago to start voice.' });
    return;
  }
  setStatus({ at, outcome: 'heard', message: 'Heard “Wake up Jarvis”.' });
  if (wakeListeners.size === 0) {
    setStatus({ at, outcome: 'unavailable', message: 'Voice is not available on this page.' });
    return;
  }
  for (const listener of wakeListeners) listener(at);
}

export function reportWakeOutcome(at: string, outcome: WakeOutcome, message: string) {
  if (status?.at === at) setStatus({ at, outcome, message });
}

export function onVoiceWake(listener: (at: string) => void) {
  wakeListeners.add(listener);
  return () => { wakeListeners.delete(listener); };
}

function subscribe(listener: () => void) {
  statusListeners.add(listener);
  return () => { statusListeners.delete(listener); };
}

export function useWakeStatus() {
  return useSyncExternalStore(subscribe, () => status, () => status);
}

export function resetWakeForTests() {
  status = null;
  wakeListeners.clear();
}
