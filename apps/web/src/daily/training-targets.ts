import { useCallback, useEffect, useState } from 'react';
import { awaitWithSignal, backendFetch } from '../backend-request';
import { runDailyRead } from './client';

export const trainingTargetKeys = ['gymSessionsPerWeek', 'runSessionsPerWeek', 'dailySteps'] as const;
export type TrainingTargetKey = (typeof trainingTargetKeys)[number];
export type TrainingTargetValues = Readonly<Record<TrainingTargetKey, number | null>>;
export type TrainingTargetChanges = Readonly<Partial<Record<TrainingTargetKey, number | null>>>;

export interface TrainingTargetBound {
  readonly label: string;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
}

export interface TrainingTargetsState {
  readonly targets: TrainingTargetValues;
  readonly bounds: Readonly<Record<TrainingTargetKey, TrainingTargetBound>>;
  readonly missing: readonly TrainingTargetKey[];
  readonly updatedAt: string | null;
}

export type TrainingDraft =
  | { readonly ok: true; readonly value: number | null }
  | { readonly ok: false; readonly message: string };

export type TrainingTargetsFailure = 'unavailable' | 'denied' | 'rejected' | 'invalid' | 'failed';

export class TrainingTargetsError extends Error {
  constructor(readonly kind: TrainingTargetsFailure) {
    super(kind);
    this.name = 'TrainingTargetsError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function readBound(value: unknown): TrainingTargetBound | null {
  if (!isRecord(value)) return null;
  const { label, unit, min, max } = value;
  if (typeof label !== 'string' || !label.trim() || label.length > 80 ||
      typeof unit !== 'string' || !unit.trim() || unit.length > 16 ||
      typeof min !== 'number' || !Number.isSafeInteger(min) || min < 0 ||
      typeof max !== 'number' || !Number.isSafeInteger(max) || max < min) return null;
  return { label, unit, min, max };
}

/** Rejects off-contract server replies. Bounds and labels are always read from the server, never duplicated here. */
export function parseTrainingTargets(value: unknown): TrainingTargetsState | null {
  if (!isRecord(value) || !isRecord(value.targets) || !isRecord(value.bounds) ||
      !Array.isArray(value.missing) || !Object.hasOwn(value, 'updatedAt') ||
      !hasExactKeys(value.targets, trainingTargetKeys) || !hasExactKeys(value.bounds, trainingTargetKeys)) return null;
  const { updatedAt } = value;
  if (updatedAt !== null && (typeof updatedAt !== 'string' || !/^\d{4}-\d\d-\d\dT/u.test(updatedAt) ||
      !Number.isFinite(Date.parse(updatedAt)) || new Date(updatedAt).toISOString() !== updatedAt)) return null;
  const targets: Partial<Record<TrainingTargetKey, number | null>> = {};
  const bounds: Partial<Record<TrainingTargetKey, TrainingTargetBound>> = {};
  for (const key of trainingTargetKeys) {
    const bound = readBound(value.bounds[key]);
    const target = value.targets[key];
    if (!bound || target !== null &&
        (typeof target !== 'number' || !Number.isSafeInteger(target) || target < bound.min || target > bound.max)) return null;
    bounds[key] = bound;
    targets[key] = target;
  }
  const settled = targets as TrainingTargetValues;
  const missing = trainingTargetKeys.filter((key) => settled[key] === null);
  if (value.missing.length !== missing.length || value.missing.some((key, index) => key !== missing[index])) return null;
  return {
    targets: settled,
    bounds: bounds as Readonly<Record<TrainingTargetKey, TrainingTargetBound>>,
    missing,
    updatedAt,
  };
}

export function draftText(value: number | null): string {
  return value === null ? '' : String(value);
}

export function parseTrainingDraft(draft: string, bound: TrainingTargetBound): TrainingDraft {
  const text = draft.trim();
  if (text === '') return { ok: true, value: null };
  const value = /^\d{1,9}$/u.test(text) ? Number(text) : Number.NaN;
  if (Number.isSafeInteger(value) && value >= bound.min && value <= bound.max) return { ok: true, value };
  return {
    ok: false,
    message: `${bound.label}: enter a whole number from ${bound.min} to ${bound.max} ${bound.unit}, or leave it empty.`,
  };
}

export function trainingTargetChanges(
  saved: TrainingTargetValues,
  drafts: Readonly<Record<TrainingTargetKey, TrainingDraft>>,
): TrainingTargetChanges | null {
  const changes: { -readonly [Key in TrainingTargetKey]?: number | null } = {};
  for (const key of trainingTargetKeys) {
    const draft = drafts[key];
    if (draft.ok && draft.value !== saved[key]) changes[key] = draft.value;
  }
  return Object.keys(changes).length ? changes : null;
}

export function trainingTargetsFailureMessage(kind: TrainingTargetsFailure, action: 'load' | 'save'): string {
  if (kind === 'unavailable') return 'Training targets are not available here.';
  if (kind === 'denied') {
    return `Training targets are private to the Jarvis owner. Sign in as the owner to ${action === 'load' ? 'read' : 'change'} them.`;
  }
  if (kind === 'rejected') {
    return 'Training targets were not saved. Check that each value is a whole number in its range, then try again.';
  }
  if (kind === 'invalid') {
    return action === 'load'
      ? 'Jarvis answered in a form this page cannot read. Nothing was changed. Try again.'
      : 'Training targets were sent, but the reply could not be read. Reload Settings to see what is stored.';
  }
  return action === 'load'
    ? 'Training targets could not be loaded. Try again.'
    : 'Training targets could not be saved. Your entries are kept: save again, or reload Settings to see what is stored.';
}

async function request(
  backendUrl: string | null,
  getAccessToken: () => Promise<string>,
  signal: AbortSignal,
  change?: TrainingTargetChanges,
): Promise<TrainingTargetsState> {
  if (!backendUrl) throw new TrainingTargetsError('unavailable');
  return runDailyRead(signal, async () => {
    let token: string;
    try {
      token = await awaitWithSignal(getAccessToken, signal);
    } catch {
      signal.throwIfAborted();
      throw new TrainingTargetsError('denied');
    }
    let response: Response;
    try {
      response = await backendFetch(`${backendUrl.replace(/\/+$/u, '')}/daily/training-targets`, {
        method: change ? 'PATCH' : 'GET',
        signal,
        cache: 'no-store',
        headers: {
          Authorization: `${['Bear', 'er'].join('')} ${token}`,
          Accept: 'application/json',
          ...(change ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(change ? { body: JSON.stringify(change) } : {}),
      });
    } catch {
      signal.throwIfAborted();
      throw new TrainingTargetsError('failed');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 404 || response.status === 405 || response.status === 501) throw new TrainingTargetsError('unavailable');
      if (response.status === 401 || response.status === 403) throw new TrainingTargetsError('denied');
      throw new TrainingTargetsError(change && response.status === 400 ? 'rejected' : 'failed');
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      signal.throwIfAborted();
      throw new TrainingTargetsError('invalid');
    }
    const state = parseTrainingTargets(body);
    if (!state) throw new TrainingTargetsError('invalid');
    return state;
  });
}

export function loadTrainingTargets(
  backendUrl: string | null,
  getAccessToken: () => Promise<string>,
  signal: AbortSignal,
): Promise<TrainingTargetsState> {
  return request(backendUrl, getAccessToken, signal);
}

export function saveTrainingTargets(
  backendUrl: string | null,
  getAccessToken: () => Promise<string>,
  change: TrainingTargetChanges,
  signal: AbortSignal,
): Promise<TrainingTargetsState> {
  return request(backendUrl, getAccessToken, signal, change);
}

export type TrainingTargetsView =
  | { readonly status: 'loading' }
  | { readonly status: 'settled'; readonly state: TrainingTargetsState }
  | { readonly status: 'error'; readonly kind: TrainingTargetsFailure; readonly message: string };

/**
 * One training target read. The Health area mounts it once through `TrainingTargetsProvider`, and the overview, health panel
 * and workouts views take their targets from that single source. Each caller gets loading/settled/error state, a retry
 * callback and `apply` for a state the server has just returned, and renders targets only from the validated response.
 */
export function useTrainingTargets(backendUrl: string | null, getAccessToken: () => Promise<string>, enabled = true) {
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([backendUrl, attempt, enabled]);
  const [loaded, setLoaded] = useState<{ key: string; view: TrainingTargetsView }>({ key, view: { status: 'loading' } });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void loadTrainingTargets(backendUrl, getAccessToken, controller.signal).then(
      (state) => { if (!controller.signal.aborted) setLoaded({ key, view: { status: 'settled', state } }); },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const kind = error instanceof TrainingTargetsError ? error.kind : 'failed';
        setLoaded({ key, view: { status: 'error', kind, message: trainingTargetsFailureMessage(kind, 'load') } });
      },
    );
    return () => controller.abort();
  }, [backendUrl, getAccessToken, key, enabled]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  // A save made elsewhere on the page is already the server's answer, so consumers take it without another read.
  const apply = useCallback((state: TrainingTargetsState) => setLoaded({ key, view: { status: 'settled', state } }), [key]);
  const view: TrainingTargetsView = !enabled
    ? { status: 'error', kind: 'unavailable', message: trainingTargetsFailureMessage('unavailable', 'load') }
    : loaded.key === key ? loaded.view : { status: 'loading' };
  return { view, retry, apply };
}

/** One target as a card shows it: still loading, unreadable (never shown as "not set"), or read, with null meaning the owner set none. */
export type TargetRead =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly value: number | null };

export function readTarget(view: TrainingTargetsView, key: TrainingTargetKey): TargetRead {
  if (view.status === 'loading') return { status: 'loading' };
  if (view.status === 'error') return { status: 'failed' };
  return { status: 'ready', value: view.state.targets[key] };
}
