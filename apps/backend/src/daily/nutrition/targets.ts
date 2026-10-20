/**
 * Owner-entered nutrition targets for the Daily budget (P12-09, #724).
 *
 * The owner supplies three numbers and nothing here estimates anything: no BMR or TDEE from
 * body measurements, no coaching, no defaults. An unset target is "needs configuration", never a
 * guessed figure. The values are private health data, so tests use synthetic numbers and no
 * source file, fixture or document carries a real one.
 */
export const nutritionTargetFields = ['restingKcal', 'deficitKcal', 'proteinGrams'] as const;
export type NutritionTargetField = (typeof nutritionTargetFields)[number];
export type NutritionTargets = Readonly<Record<NutritionTargetField, number | null>>;
export type NutritionTargetsPatch = Readonly<Partial<Record<NutritionTargetField, number | null>>>;

export interface NutritionTargetBound {
  readonly label: string;
  readonly unit: 'kcal' | 'g';
  readonly min: number;
  readonly max: number;
}

const bound = (label: string, unit: 'kcal' | 'g', min: number, max: number): NutritionTargetBound =>
  Object.freeze({ label, unit, min, max });

/** Sanity bounds that catch typos and unit slips; they are not recommendations. */
export const nutritionTargetBounds: Readonly<Record<NutritionTargetField, NutritionTargetBound>> = Object.freeze({
  restingKcal: bound('Resting energy burn', 'kcal', 1000, 4000),
  deficitKcal: bound('Per-day deficit', 'kcal', 0, 2000),
  proteinGrams: bound('Protein target', 'g', 30, 400),
});

export const emptyNutritionTargets: NutritionTargets = Object.freeze({ restingKcal: null, deficitKcal: null, proteinGrams: null });

export interface StoredNutritionTargets {
  readonly targets: NutritionTargets;
  /** Latest save time of a value that is currently stored, or null when nothing is set. */
  readonly updatedAt: string | null;
}

export function isNutritionTargetField(value: string): value is NutritionTargetField {
  return (nutritionTargetFields as readonly string[]).includes(value);
}

const ownerPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/u;
const keySuffix: Readonly<Record<NutritionTargetField, string>> = {
  restingKcal: 'resting-kcal',
  deficitKcal: 'deficit-kcal',
  proteinGrams: 'protein-grams',
};

/** One Daily-owned, owner-namespaced `dbo.settings` key per target. An unusable owner id fails closed. */
export function nutritionTargetKey(owner: string, field: NutritionTargetField): string {
  const id = typeof owner === 'string' ? owner.toLowerCase() : '';
  if (!ownerPattern.test(id)) throw new TypeError('Invalid Daily owner');
  return `daily.nutrition.${id}.${keySuffix[field]}`;
}

/** A stored value that is malformed or out of range reads as unset, so a bad row can never become a budget. */
export function parseStoredNutritionTarget(field: NutritionTargetField, stored: unknown): number | null {
  if (typeof stored !== 'string' || stored.length > 16) return null;
  let value: unknown;
  try { value = JSON.parse(stored); } catch { return null; }
  const range = nutritionTargetBounds[field];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= range.min && value <= range.max ? value : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export type NutritionTargetsParse =
  | { readonly ok: true; readonly patch: NutritionTargetsPatch }
  | { readonly ok: false; readonly reason: string };

/**
 * Strict partial update: a plain object naming at least one known target as a whole number in
 * range, or null to clear it. Reasons describe the rule and never echo the submitted value.
 */
export function parseNutritionTargetsPatch(value: unknown): NutritionTargetsParse {
  if (!isPlainRecord(value)) return { ok: false, reason: 'Send an object naming the targets to change.' };
  const keys = Object.keys(value);
  if (keys.length === 0) return { ok: false, reason: 'Name at least one target to change.' };
  const patch: { -readonly [K in NutritionTargetField]?: number | null } = {};
  for (const key of keys) {
    if (!isNutritionTargetField(key)) {
      return { ok: false, reason: `Unknown target. Use only ${nutritionTargetFields.join(', ')}.` };
    }
    const entry = value[key];
    if (entry === null) { patch[key] = null; continue; }
    const range = nutritionTargetBounds[key];
    if (typeof entry !== 'number' || !Number.isSafeInteger(entry) || entry < range.min || entry > range.max) {
      return { ok: false, reason: `${range.label} must be a whole number from ${range.min} to ${range.max} ${range.unit}, or null to clear it.` };
    }
    patch[key] = entry;
  }
  return { ok: true, patch };
}

/** The named targets whose value would actually change, in a fixed order. */
export function changedNutritionTargets(current: NutritionTargets, patch: NutritionTargetsPatch): NutritionTargetField[] {
  return nutritionTargetFields.filter((field) => {
    const next = patch[field];
    return next !== undefined && next !== current[field];
  });
}

/** Identical shape for the Settings route and the chat/voice tool; bounds let the UI avoid duplicating them. */
export function presentNutritionTargets(stored: StoredNutritionTargets) {
  return {
    targets: { ...stored.targets },
    missing: nutritionTargetFields.filter((field) => stored.targets[field] === null),
    updatedAt: stored.updatedAt,
    bounds: nutritionTargetBounds,
  };
}
