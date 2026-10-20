import { formatTimeOnly } from '../../../format/date-time';
import { copenhagenDate } from '../../period';
import { dateOnly, metricSummary, metricValue, type Row as MetricRow } from '../body-sleep/metrics';
import { hours } from '../body-sleep/sleep';
import { dateStep, deleted, numeric, sumNutrient, text, type Row as NutritionRow } from '../nutrition/totals';
import { summarizeWorkouts, workoutDate, type Workout } from '../workouts/summary';
import type { OverviewWindow } from './overview-window';

/** Eaten values for the window: the day's total for one date, the average per logged day for a range. */
export function nutritionForWindow(rows: readonly NutritionRow[], window: OverviewWindow) {
  const logged = rows.filter(row => {
    const date = row.meal_date;
    return !deleted(row) && typeof date === 'string' && date >= window.startDate && date <= window.endDate &&
      (numeric(row.meal_count) ?? 0) > 0;
  });
  if (logged.length === 0) return null;
  const figure = (key: 'energy_kcal' | 'protein_grams') => {
    const sum = sumNutrient(logged, key);
    const partial = sum.missing > 0
      || logged.some(row => Array.isArray(row.partial_nutrients) && row.partial_nutrients.includes(key));
    // The known amount is spread over every logged day, so a day that lacks the nutrient keeps the average a lower bound.
    return { value: sum.value === null ? null : sum.value / sum.count, partial };
  };
  return { loggedDays: logged.length, energy: figure('energy_kcal'), protein: figure('protein_grams') };
}

/** Steps for the window: the sum of the recorded days. */
export function stepsForWindow(rows: readonly MetricRow[], window: OverviewWindow) {
  const summary = metricSummary(rows, { startDate: window.startDate, endDate: window.endDate });
  return summary.count === 0 ? null : { total: summary.days.reduce((sum, day) => sum + day.value, 0), days: summary.count };
}

/** One night for a single date, the average per recorded night for a range. Only Today may show last night, until today's is processed. */
export function sleepForWindow(rows: readonly MetricRow[], window: OverviewWindow) {
  const from = window.preset === 'today' ? dateStep(window.endDate, -1) : window.startDate;
  const nights = rows.flatMap(row => {
    const date = dateOnly(row.sleep_date);
    if (date === null || date < from || date > window.endDate) return [];
    const asleep = hours(row.asleep_hours);
    const value = hours(row.total_sleep_hours) ?? (asleep !== null && asleep > 0 ? asleep : null);
    return value === null ? [] : [{ date, value }];
  });
  if (nights.length === 0) return null;
  if (window.single) {
    const latest = nights.reduce((best, night) => night.date > best.date ? night : best);
    return { value: latest.value, nights: 1, date: latest.date };
  }
  return { value: nights.reduce((sum, night) => sum + night.value, 0) / nights.length, nights: nights.length, date: null };
}

export function copenhagenHour(date: Date) {
  return Number.parseInt(formatTimeOnly(date, { timeZone: 'Europe/Copenhagen' }), 10);
}

const pad = (hour: number) => String(hour).padStart(2, '0');

/** Cumulative protein by hour for one date; hours after `liveHour` are not recorded yet, so they stay empty rather than flat. */
export function cumulativeProtein(meals: readonly NutritionRow[], date: string, liveHour: number | null) {
  const byHour = Array.from({ length: 24 }, () => 0);
  let recorded = 0;
  for (const meal of meals) {
    if (deleted(meal)) continue;
    const at = new Date(text(meal.occurred_at, ''));
    const protein = numeric(meal.protein_grams);
    if (!Number.isFinite(at.getTime()) || protein === null || copenhagenDate(at) !== date) continue;
    byHour[copenhagenHour(at)] = (byHour[copenhagenHour(at)] ?? 0) + protein;
    recorded += 1;
  }
  let running = 0;
  const points = byHour.map((grams, hour) => {
    running += grams;
    return { label: `${pad(hour)}:00`, value: liveHour !== null && hour > liveHour ? null : running };
  });
  return { points, total: recorded === 0 ? null : running };
}

/** Protein per day across the window; a day with no logged meals is not recorded rather than zero. */
export function dailyProtein(rows: readonly NutritionRow[], window: OverviewWindow) {
  const byDate = new Map<string, number>();
  for (const row of rows) {
    const date = row.meal_date;
    const protein = numeric(row.protein_grams);
    if (deleted(row) || typeof date !== 'string' || protein === null || (numeric(row.meal_count) ?? 0) <= 0) continue;
    byDate.set(date, (byDate.get(date) ?? 0) + protein);
  }
  return Array.from({ length: window.days }, (_, index) => {
    const date = dateStep(window.startDate, index);
    return { label: date, value: byDate.get(date) ?? null };
  });
}

/** Sessions, active energy and time inside the window. An empty window is zero, not unknown. */
export function windowWorkouts(rows: readonly Workout[], window: OverviewWindow) {
  const inside = rows.filter(row => {
    const date = workoutDate(row.workout_date) ?? workoutDate(row.start_at);
    return date !== null && date >= window.startDate && date <= window.endDate;
  });
  const summary = summarizeWorkouts(inside);
  const kcal = summary.energy.values.find(item => item.unit.toLowerCase() === 'kcal')?.value ?? null;
  return {
    sessions: summary.count,
    durationSeconds: summary.count === 0 ? 0 : summary.durationSeconds,
    kcal: summary.count === 0 ? 0 : kcal,
    // Each total is a lower bound only for its own missing figures.
    partialEnergy: summary.energy.missing > 0,
    partialDuration: summary.missingDuration > 0,
  };
}

const bodyMetricPatterns = {
  weight: /^(weight_body_mass|body_mass|weight)$/u,
  fatPercent: /^body_fat_percentage$/u,
  leanMass: /^lean_body_mass$/u,
  fatMass: /^(body_fat_mass|fat_mass)$/u,
} as const;

export type BodyMetricKey = keyof typeof bodyMetricPatterns;

export type TrainingTargets = { gymSessionsPerWeek: number | null; runSessionsPerWeek: number | null; dailySteps: number | null };

/** Owner-set targets are not served yet, so every ring says so instead of showing a made-up number. */
export const noTrainingTargets: TrainingTargets = { gymSessionsPerWeek: null, runSessionsPerWeek: null, dailySteps: null };

export const scaledTarget = (perPeriod: number | null, periods: number) => perPeriod === null ? null : perPeriod * periods;

/** What is left of the calorie baseline. A partial eaten total is a lower bound, so left is at most and over is at least. */
export function calorieBalance(energy: { value: number | null; partial: boolean } | null | undefined, baseline: number | null) {
  if (energy?.value == null || baseline === null) return null;
  const left = baseline - energy.value;
  return {
    amount: Math.abs(left),
    kind: left >= 0 ? 'left' as const : 'over' as const,
    bound: energy.partial ? left >= 0 ? 'at most' as const : 'at least' as const : null,
  };
}

/** Which body measurements exist in the served catalogue; nothing is queried or shown for a name that is not served. */
export function bodyMetricNames(catalogue: readonly MetricRow[]): Record<BodyMetricKey, string | null> {
  const names = catalogue.flatMap(row => typeof row.metric_name === 'string' ? [row.metric_name] : []);
  const pick = (key: BodyMetricKey) => names.find(name => bodyMetricPatterns[key].test(name)) ?? null;
  return { weight: pick('weight'), fatPercent: pick('fatPercent'), leanMass: pick('leanMass'), fatMass: pick('fatMass') };
}

/** Recorded days in order, the latest reading, and its unit. Only rows in the latest reading's unit are used, so units never mix. */
export function bodyTrend(rows: readonly MetricRow[], period: { startDate: string; endDate: string }) {
  const unitOf = (row: MetricRow) => typeof row.unit === 'string' && row.unit.trim() ? row.unit : null;
  let latest: { date: string; unit: string | null } | null = null;
  for (const row of rows) {
    const date = dateOnly(row.metric_date);
    if (date === null || date < period.startDate || date > period.endDate || metricValue(row).value === null) continue;
    if (latest === null || date >= latest.date) latest = { date, unit: unitOf(row) };
  }
  if (latest === null) return null;
  const { unit } = latest;
  const summary = metricSummary(rows.filter(row => unitOf(row) === unit), period);
  return summary.latest === null ? null
    : { latest: summary.latest.value, values: summary.days.map(day => day.value), count: summary.count, unit };
}
