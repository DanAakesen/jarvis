import { dateOnly, number } from '../health/value.js';
import { missingReading, validateExperiment, type CoachingProfile, type Experiment, type Reading } from './model.js';

export type CoachingRow = Record<string, unknown>;
export const storedDate = (value: unknown) => dateOnly(value instanceof Date ? value.toISOString().slice(0, 10) : typeof value === 'string' ? value : '');
export function storedNumber(value: unknown): number {
  const parsed = number(value);
  if (parsed === null) throw new TypeError('Stored coaching numeric evidence is invalid');
  return parsed;
}
export function storedText(value: unknown, max = 4096): string {
  if (typeof value !== 'string' || value.length > max) throw new TypeError('Stored coaching text is invalid');
  return value;
}
export function readProfile(row: CoachingRow | null): CoachingProfile | null {
  return row ? { deficitRate: storedNumber(row.deficit_rate), proteinMinimumGrams: storedNumber(row.protein_minimum_grams), proteinPerKg: storedNumber(row.protein_per_kg),
    stepsTarget: storedNumber(row.steps_target), sleepTargetHours: storedNumber(row.sleep_target_hours),
    coachingIntensity: storedText(row.coaching_intensity, 256), profanityPreference: storedText(row.profanity_preference, 256) } : null;
}
export function readExperiment(row: CoachingRow): Experiment {
  const variables: unknown = JSON.parse(storedText(row.locked_variables_json, 16384));
  if (!Array.isArray(variables) || variables.some(value => typeof value !== 'string')) throw new TypeError('Stored experiment variables are invalid');
  const result = { id: storedText(row.id, 256), metric: storedText(row.metric, 256), instruction: storedText(row.instruction),
    targetValue: storedNumber(row.target_value), targetDays: storedNumber(row.target_days), unit: storedText(row.unit, 256),
    startsOn: storedDate(row.starts_on), endsOn: storedDate(row.ends_on), lockedVariables: variables as string[],
    baselineValue: row.baseline_value === null ? null : storedNumber(row.baseline_value),
    baselineDays: row.baseline_days === null ? null : storedNumber(row.baseline_days),
    rationale: row.rationale === null ? null : storedText(row.rationale) };
  validateExperiment(result); return result;
}
/** Mapped SQL values have canonical units but no per-day completeness promise. */
export function readMetric(rows: CoachingRow[], date: string, names: readonly string[], unit: string): Reading {
  const selected = rows.filter(row => storedDate(row.metric_date) === date && names.includes(String(row.metric_name)));
  if (!selected.length) return missingReading();
  if (selected.some(row => row.unit !== null && row.unit !== unit || row.value !== null && number(row.value) === null)) throw new TypeError('Health units or values are unavailable for coaching');
  const sources = selected.map(row => storedText(row.ingestion_id, 256));
  if (selected.some(row => row.unit === null)) return { ...missingReading(), sources };
  const values = selected.map(row => row.value === null ? null : storedNumber(row.value));
  if (values.some(value => value !== values[0])) throw new TypeError('Conflicting same-date health metrics require reconciliation');
  return { value: values[0] ?? null, coverage: values[0] === null ? 'missing' : 'partial', sources };
}
export function readMealTotal(rows: CoachingRow[], date: string, column: 'energy_kcal' | 'protein_grams'): Reading {
  const selected = rows.filter(row => storedDate(row.meal_date) === date && row.deleted_at === null);
  if (!selected.length) return missingReading();
  const values = selected.map(row => row[column] === null ? null : storedNumber(row[column]));
  return { value: values.some(value => value === null) ? null : values.reduce<number>((total, value) => total + value!, 0),
    coverage: 'partial', sources: ['daily.nutrition_meals'] };
}
