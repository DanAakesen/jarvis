/**
 * Pure arithmetic for the personalised food budget (P12-09, #724). No I/O, no clock, no estimates.
 *
 *   allowance  = resting burn target + ACTIVE energy burned so far today - daily deficit target
 *   kcal left  = allowance - energy eaten so far today
 *   protein left = protein target - protein eaten so far today
 *
 * Nothing projects the rest of the day and nothing estimates a BMR/TDEE from body measurements. A missing
 * target, a missing or malformed burn reading, an unknown macro or an incomplete meal read is reported with a
 * reason code and leaves the dependent figure null; it is never treated as zero. The owner's figures are private
 * health data, so tests use synthetic numbers and nothing here carries a default.
 */
import { nutrients, text, type Suggestion } from './model.js';
import type { NutritionTargets } from './targets.js';

/**
 * The exact exporter name for the day's ACTIVE energy. Resting (basal) and total energy are never read, so
 * the resting target is never counted twice. The name is trusted as stored; it is not verified against a live export.
 */
export const activeEnergyMetric = 'active_energy';

// "+ 0" turns a rounded -0 into 0, so JSON output and equality checks agree.
export const round1 = (value: number): number => Math.round(value * 10) / 10 + 0;

const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const optionalText = (value: unknown): string | null => typeof value === 'string' && value.length > 0 ? value : null;
const dateKey = (value: unknown): string | null => value instanceof Date
  ? Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null
  : typeof value === 'string' ? value.slice(0, 10) : null;
// SQL bigint arrives as a string; keep only safe, non-negative integers.
function count(value: unknown): number | null {
  const parsed = typeof value === 'bigint' ? Number(value) : typeof value === 'string' && /^\d{1,15}$/u.test(value) ? Number(value) : value;
  return typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export type ActiveEnergyReason =
  | 'health_no_row_today'
  | 'health_scan_incomplete'
  | 'health_read_failed'
  | 'active_energy_invalid'
  | 'active_energy_unit_unknown';

export type ActiveEnergy =
  | {
    readonly known: true;
    readonly kcal: number;
    readonly sampleCount: number | null;
    /** Verbatim source range; a day-level export may carry a bucket time rather than the last sample. */
    readonly sourceStartAt: string | null;
    readonly sourceEndAt: string | null;
    /** When Jarvis accepted the payload that last supplied this row. */
    readonly storedAt: string | null;
    readonly ageMinutes: number | null;
  }
  | { readonly known: false; readonly reason: ActiveEnergyReason };

/**
 * Today's stored active-energy row, or the reason there is none. `complete` says whether the metric rows for
 * today were read to the end; an unread remainder is "not found yet", never "no burn".
 */
export function pickActiveEnergy(
  rows: readonly Record<string, unknown>[],
  context: { readonly today: string; readonly now: string; readonly complete: boolean },
): ActiveEnergy {
  const matches = rows.filter((row) => row.metric_name === activeEnergyMetric && dateKey(row.metric_date) === context.today);
  if (matches.length === 0) return { known: false, reason: context.complete ? 'health_no_row_today' : 'health_scan_incomplete' };
  const row = matches[0]!;
  const kcal = finite(row.value);
  if (matches.length > 1 || kcal === null || kcal < 0) return { known: false, reason: 'active_energy_invalid' };
  if (row.unit !== 'kcal') return { known: false, reason: 'active_energy_unit_unknown' };
  const storedAt = optionalText(row.updated_at);
  const stored = storedAt === null ? Number.NaN : Date.parse(storedAt);
  return {
    known: true,
    kcal: round1(kcal),
    sampleCount: count(row.sample_count),
    sourceStartAt: optionalText(row.start_at),
    sourceEndAt: optionalText(row.end_at),
    storedAt,
    ageMinutes: Number.isFinite(stored) ? Math.max(0, Math.floor((Date.parse(context.now) - stored) / 60_000)) : null,
  };
}

export interface MealTotals {
  /** Meals that count (tombstones excluded). */
  readonly meals: number;
  /** False when the day's meals were not read to the end, so every total below is an undercount. */
  readonly complete: boolean;
  readonly invalidEnergyMeals: number;
  readonly unknownProteinMeals: number;
  readonly countedKcal: number;
  readonly countedProteinGrams: number;
}

/** Totals for one local day's logged meals. A deleted meal never counts; unknown or malformed values are counted, not summed. */
export function totalMeals(rows: readonly Record<string, unknown>[], complete: boolean): MealTotals {
  let meals = 0;
  let invalidEnergyMeals = 0;
  let unknownProteinMeals = 0;
  let kcal = 0;
  let protein = 0;
  for (const row of rows) {
    if (row.deleted_at !== null && row.deleted_at !== undefined) continue;
    meals += 1;
    const energy = finite(row.energy_kcal);
    if (energy === null || energy < 0) invalidEnergyMeals += 1; else kcal += energy;
    const grams = finite(row.protein_grams);
    if (grams === null || grams < 0) unknownProteinMeals += 1; else protein += grams;
  }
  return { meals, complete, invalidEnergyMeals, unknownProteinMeals, countedKcal: round1(kcal), countedProteinGrams: round1(protein) };
}

export type KcalReason =
  | 'resting_target_not_set'
  | 'deficit_target_not_set'
  | 'active_energy_unknown'
  | 'meals_incomplete'
  | 'meal_energy_invalid';
export type ProteinReason = 'protein_target_not_set' | 'meals_incomplete' | 'meal_protein_unknown';

export interface BudgetFigures {
  readonly kcal: {
    readonly state: 'ready' | 'unknown';
    readonly reasons: readonly KcalReason[];
    readonly restingKcal: number | null;
    readonly deficitKcal: number | null;
    readonly activeKcal: number | null;
    readonly allowanceKcal: number | null;
    readonly eatenKcal: number | null;
    /** Negative means over today's allowance; reported as is. */
    readonly remainingKcal: number | null;
  };
  readonly protein: {
    /** partial: some logged meals have unknown protein, so the remaining figure is an upper bound. */
    readonly state: 'ready' | 'partial' | 'unknown';
    readonly reasons: readonly ProteinReason[];
    readonly targetGrams: number | null;
    /** Protein from meals with a known value only; unknown meals are counted separately, never as zero. */
    readonly eatenKnownGrams: number | null;
    readonly unknownProteinMeals: number;
    readonly remainingGrams: number | null;
  };
}

export function deriveBudget(input: { readonly targets: NutritionTargets; readonly burn: ActiveEnergy; readonly meals: MealTotals }): BudgetFigures {
  const { targets, burn, meals } = input;
  const kcalReasons: KcalReason[] = [];
  if (targets.restingKcal === null) kcalReasons.push('resting_target_not_set');
  if (targets.deficitKcal === null) kcalReasons.push('deficit_target_not_set');
  if (!burn.known) kcalReasons.push('active_energy_unknown');
  if (!meals.complete) kcalReasons.push('meals_incomplete');
  if (meals.invalidEnergyMeals > 0) kcalReasons.push('meal_energy_invalid');
  const allowanceKcal = targets.restingKcal !== null && targets.deficitKcal !== null && burn.known
    ? round1(targets.restingKcal + burn.kcal - targets.deficitKcal)
    : null;
  const eatenKcal = meals.complete && meals.invalidEnergyMeals === 0 ? meals.countedKcal : null;
  const remainingKcal = kcalReasons.length === 0 && allowanceKcal !== null && eatenKcal !== null ? round1(allowanceKcal - eatenKcal) : null;

  const proteinTarget = targets.proteinGrams;
  const proteinRemaining = proteinTarget !== null && meals.complete ? round1(proteinTarget - meals.countedProteinGrams) : null;
  const proteinReasons: ProteinReason[] = [];
  if (proteinTarget === null) proteinReasons.push('protein_target_not_set');
  if (!meals.complete) proteinReasons.push('meals_incomplete');
  if (proteinRemaining !== null && meals.unknownProteinMeals > 0) proteinReasons.push('meal_protein_unknown');

  return {
    kcal: {
      state: remainingKcal === null ? 'unknown' : 'ready',
      reasons: kcalReasons,
      restingKcal: targets.restingKcal,
      deficitKcal: targets.deficitKcal,
      activeKcal: burn.known ? burn.kcal : null,
      allowanceKcal,
      eatenKcal,
      remainingKcal,
    },
    protein: {
      state: proteinRemaining === null ? 'unknown' : meals.unknownProteinMeals > 0 ? 'partial' : 'ready',
      reasons: proteinReasons,
      targetGrams: proteinTarget,
      eatenKnownGrams: meals.complete ? meals.countedProteinGrams : null,
      unknownProteinMeals: meals.unknownProteinMeals,
      remainingGrams: proteinRemaining,
    },
  };
}

const macro = (value: unknown): number | null => value === null || value === undefined ? null : value as number;

/** A saved favourite as a suggestion candidate, or null when its stored data would break the suggestion model. */
export function toCandidate(row: Record<string, unknown>): Suggestion | null {
  const candidate: Suggestion = {
    mealKey: row.id as string,
    name: row.favorite_name as string,
    energyKcal: row.energy_kcal as number,
    proteinGrams: macro(row.protein_grams),
    carbohydratesGrams: macro(row.carbohydrates_grams),
    fatGrams: macro(row.fat_grams),
    fiberGrams: macro(row.fiber_grams),
    localTimeWindows: [],
  };
  try {
    text(candidate.mealKey);
    text(candidate.name);
    nutrients(candidate);
    return candidate;
  } catch {
    return null;
  }
}
