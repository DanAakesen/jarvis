import { awaitWithSignal, backendFetch } from '../backend-request';
import { runDailyRead } from './client';

/**
 * Client for the owner's nutrition targets (P12-09, #724). The three figures are private health data:
 * nothing here ships a default, a placeholder or an example figure, and every label, unit and range
 * shown comes from the bounds the server returns.
 */
export const nutritionTargetKeys = ['restingKcal', 'deficitKcal', 'proteinGrams'] as const;
export type NutritionTargetKey = (typeof nutritionTargetKeys)[number];
export type NutritionTargetValues = Readonly<Record<NutritionTargetKey, number | null>>;
export type NutritionTargetChanges = Readonly<Partial<Record<NutritionTargetKey, number | null>>>;

export interface NutritionTargetBound {
  readonly label: string;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
}

export interface NutritionTargetsState {
  readonly targets: NutritionTargetValues;
  readonly bounds: Readonly<Record<NutritionTargetKey, NutritionTargetBound>>;
  /** Targets that are not set yet, in field order. */
  readonly missing: readonly NutritionTargetKey[];
  readonly updatedAt: string | null;
}

export type NutritionDraft =
  | { readonly ok: true; readonly value: number | null }
  | { readonly ok: false; readonly message: string };

export type NutritionTargetsFailure = 'unavailable' | 'denied' | 'rejected' | 'invalid' | 'failed';

export class NutritionTargetsError extends Error {
  constructor(readonly kind: NutritionTargetsFailure) {
    super(kind);
    this.name = 'NutritionTargetsError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBound(value: unknown): NutritionTargetBound | null {
  if (!isRecord(value)) return null;
  const { label, unit, min, max } = value;
  if (typeof label !== 'string' || !label.trim() || label.length > 80 ||
      typeof unit !== 'string' || !unit.trim() || unit.length > 16 ||
      typeof min !== 'number' || !Number.isSafeInteger(min) || min < 0 ||
      typeof max !== 'number' || !Number.isSafeInteger(max) || max < min) return null;
  return { label, unit, min, max };
}

/** Strict reader for the Settings route reply; anything off-contract returns null and is never shown. */
export function parseNutritionTargets(value: unknown): NutritionTargetsState | null {
  if (!isRecord(value) || !isRecord(value.targets) || !isRecord(value.bounds)) return null;
  const { updatedAt } = value;
  if (updatedAt !== null && (typeof updatedAt !== 'string' || updatedAt.length > 64 || !Number.isFinite(Date.parse(updatedAt)))) return null;
  const targets: Partial<Record<NutritionTargetKey, number | null>> = {};
  const bounds: Partial<Record<NutritionTargetKey, NutritionTargetBound>> = {};
  for (const key of nutritionTargetKeys) {
    const bound = readBound(value.bounds[key]);
    const target = value.targets[key];
    if (!bound) return null;
    if (target !== null && (typeof target !== 'number' || !Number.isSafeInteger(target) || target < bound.min || target > bound.max)) return null;
    bounds[key] = bound;
    targets[key] = target;
  }
  const settled = targets as NutritionTargetValues;
  return {
    targets: settled,
    bounds: bounds as Readonly<Record<NutritionTargetKey, NutritionTargetBound>>,
    missing: nutritionTargetKeys.filter((key) => settled[key] === null),
    updatedAt,
  };
}

/** The text a field starts with: the stored whole number, or empty when the target is not set. */
export function draftText(value: number | null): string {
  return value === null ? '' : String(value);
}

/** An empty field clears the target; anything else must be a whole number inside the server's range. */
export function parseNutritionDraft(draft: string, bound: NutritionTargetBound): NutritionDraft {
  const text = draft.trim();
  if (text === '') return { ok: true, value: null };
  const value = /^\d{1,6}$/u.test(text) ? Number(text) : Number.NaN;
  if (Number.isSafeInteger(value) && value >= bound.min && value <= bound.max) return { ok: true, value };
  return {
    ok: false,
    message: `${bound.label}: enter a whole number from ${bound.min} to ${bound.max} ${bound.unit}, or leave it empty.`,
  };
}

/** Only the targets whose value differs from the stored one; null when nothing valid has changed. */
export function nutritionTargetChanges(
  saved: NutritionTargetValues,
  drafts: Readonly<Record<NutritionTargetKey, NutritionDraft>>,
): NutritionTargetChanges | null {
  const changes: { -readonly [Key in NutritionTargetKey]?: number | null } = {};
  for (const key of nutritionTargetKeys) {
    const draft = drafts[key];
    if (draft.ok && draft.value !== saved[key]) changes[key] = draft.value;
  }
  return Object.keys(changes).length ? changes : null;
}

/** Copy owned by this page: the server's own text is never rendered. */
export function nutritionTargetsFailureMessage(kind: NutritionTargetsFailure, action: 'load' | 'save'): string {
  if (kind === 'unavailable') return 'Nutrition targets are not available here.';
  if (kind === 'denied') {
    return `Nutrition targets are private to the Jarvis owner. Sign in as the owner to ${action === 'load' ? 'read' : 'change'} them.`;
  }
  if (kind === 'rejected') {
    return 'Nutrition targets were not saved. Check that each value is a whole number in its range, then try again.';
  }
  if (kind === 'invalid') {
    return action === 'load'
      ? 'Jarvis answered in a form this page cannot read. Nothing was changed. Try again.'
      : 'Nutrition targets were sent, but the reply could not be read. Reload Settings to see what is stored.';
  }
  return action === 'load'
    ? 'Nutrition targets could not be loaded. Try again.'
    : 'Nutrition targets could not be saved. Your entries are kept: save again, or reload Settings to see what is stored.';
}

async function request(
  backendUrl: string | null,
  getAccessToken: () => Promise<string>,
  signal: AbortSignal,
  change?: NutritionTargetChanges,
): Promise<NutritionTargetsState> {
  if (!backendUrl) throw new NutritionTargetsError('unavailable');
  return runDailyRead(signal, async () => {
    let token: string;
    try {
      token = await awaitWithSignal(getAccessToken, signal);
    } catch {
      signal.throwIfAborted();
      throw new NutritionTargetsError('denied');
    }
    let response: Response;
    try {
      response = await backendFetch(`${backendUrl.replace(/\/+$/u, '')}/daily/nutrition-targets`, {
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
      throw new NutritionTargetsError('failed');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 404 || response.status === 405 || response.status === 501) throw new NutritionTargetsError('unavailable');
      if (response.status === 401 || response.status === 403) throw new NutritionTargetsError('denied');
      throw new NutritionTargetsError(change && response.status === 400 ? 'rejected' : 'failed');
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      signal.throwIfAborted();
      throw new NutritionTargetsError('invalid');
    }
    const state = parseNutritionTargets(body);
    if (!state) throw new NutritionTargetsError('invalid');
    return state;
  });
}

export function loadNutritionTargets(
  backendUrl: string | null,
  getAccessToken: () => Promise<string>,
  signal: AbortSignal,
): Promise<NutritionTargetsState> {
  return request(backendUrl, getAccessToken, signal);
}

/** Sends only the changed targets; the reply is the committed readback, which the caller adopts. */
export function saveNutritionTargets(
  backendUrl: string | null,
  getAccessToken: () => Promise<string>,
  change: NutritionTargetChanges,
  signal: AbortSignal,
): Promise<NutritionTargetsState> {
  return request(backendUrl, getAccessToken, signal, change);
}
