import type { DailyJson } from '@jarvis/contracts';
import type { ChartSeries } from '../../../chart-data';
import type { NutritionTargetValues } from '../../nutrition-targets';
import { copenhagenDate, isDailyPeriod } from '../../period';

export type Row = Record<string, DailyJson>;
export const nutrients = [
  { key: 'energy_kcal', label: 'Energy', unit: 'kcal' },
  { key: 'protein_grams', label: 'Protein', unit: 'g' },
  { key: 'carbohydrates_grams', label: 'Carbohydrates', unit: 'g' },
  { key: 'fat_grams', label: 'Fat', unit: 'g' },
  { key: 'fiber_grams', label: 'Fiber', unit: 'g' },
] as const;
export type Nutrient = typeof nutrients[number]['key'];
export const numeric = (value: DailyJson | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
export const text = (value: DailyJson | undefined, fallback = 'Unknown'): string =>
  typeof value === 'string' && value.trim() ? value : fallback;
export const deleted = (row: Row) => row.deleted_at !== null && row.deleted_at !== undefined;

/** Escaped by React at the call site; bounded stored text is never executed as markup. */
export function readableJson(value: Row[string] | undefined): string {
  if (value === null || value === undefined) return 'Not recorded.';
  let parsed: unknown = value;
  if (typeof value === 'string') {
    if (value.length > 16_000) return `${value.slice(0, 4000)}\n[Stored text truncated]`;
    try { parsed = JSON.parse(value); } catch { return `${value.slice(0, 4000)}${value.length > 4000 ? '\n[Stored text truncated]' : ''}`; }
  }
  try {
    const rendered = JSON.stringify(parsed, null, 2);
    return rendered.length > 16_000 ? `${rendered.slice(0, 16_000)}\n[Stored detail truncated]` : rendered;
  } catch { return 'Stored detail could not be displayed safely.'; }
}

export function sumNutrient(rows: readonly Row[], key: Nutrient) {
  const active = rows.filter(row => !deleted(row));
  const values = active.map(row => numeric(row[key])).filter(value => value !== null);
  return { value: values.length ? values.reduce((sum, value) => sum + value, 0) : null,
    missing: active.length - values.length, count: active.length };
}

const planNutrientKeys: Record<Nutrient, string> = {
  energy_kcal: 'energyKcal', protein_grams: 'proteinGrams', carbohydrates_grams: 'carbohydratesGrams',
  fat_grams: 'fatGrams', fiber_grams: 'fiberGrams',
};

export function planItems(value: DailyJson | undefined): Row[] | null {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    if (value.length > 100_000) return null;
    try { parsed = JSON.parse(value); } catch { return null; }
  }
  if (!Array.isArray(parsed) || parsed.length > 1000 ||
    !parsed.every(item => typeof item === 'object' && item !== null && !Array.isArray(item))) return null;
  return (parsed as Row[]).map(item => {
    const nested = item.nutrients;
    const values = typeof nested === 'object' && nested !== null && !Array.isArray(nested) ? nested : item;
    return { ...item, ...Object.fromEntries(nutrients.map(({ key }) => [key,
      numeric(values[planNutrientKeys[key]] ?? values[key])])) };
  });
}

export function mealDate(row: Row) {
  const stored = text(row.meal_date, '');
  if (isDailyPeriod({ startDate: stored, endDate: stored })) return stored;
  const instant = new Date(text(row.occurred_at, ''));
  return Number.isFinite(instant.getTime()) ? copenhagenDate(instant) : null;
}

export function dateStep(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

export function targetBaseline(targets: NutritionTargetValues) {
  return targets.restingKcal !== null && targets.deficitKcal !== null
    ? targets.restingKcal - targets.deficitKcal : null;
}

export function proteinTargetComparison(rows: readonly Row[], target: number | null) {
  if (target === null) return null;
  const total = sumNutrient(rows, 'protein_grams');
  return { ...total, target, progressValue: total.value !== null && target > 0 ? Math.min(total.value, target) : null };
}

export function groupedMeals(rows: readonly Row[]) {
  const known = ['breakfast', 'lunch', 'dinner', 'snack', 'other'];
  const groups = new Map<string, Row[]>();
  for (const row of rows.filter(row => !deleted(row)).sort((a, b) => {
    const first = Date.parse(text(a.occurred_at, ''));
    const second = Date.parse(text(b.occurred_at, ''));
    return (Number.isFinite(first) ? first : Infinity) - (Number.isFinite(second) ? second : Infinity);
  })) {
    const recordedType = text(row.meal_type, 'Other').trim();
    const type = recordedType.toLowerCase();
    const group = known.includes(type) ? type[0]!.toUpperCase() + type.slice(1) : recordedType;
    groups.set(group, [...(groups.get(group) ?? []), row]);
  }
  return [...groups].sort(([a], [b]) => {
    const order = ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Other'];
    const aIndex = order.indexOf(a);
    const bIndex = order.indexOf(b);
    return (aIndex < 0 ? order.length : aIndex) - (bIndex < 0 ? order.length : bIndex) || a.localeCompare(b);
  });
}

export function weeklyAverages(rows: readonly Row[]) {
  const weeks = new Map<string, Row[]>();
  for (const row of rows.filter(row => numeric(row.meal_count) !== null && Number(row.meal_count) > 0)) {
    const date = text(row.meal_date, '');
    if (!isDailyPeriod({ startDate: date, endDate: date })) continue;
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const monday = dateStep(date, -((weekday + 6) % 7));
    weeks.set(monday, [...(weeks.get(monday) ?? []), row]);
  }
  return [...weeks].sort(([a], [b]) => a.localeCompare(b)).map(([week, days]) => ({
    week, days: days.length,
    values: nutrients.map(({ key }) => {
      const known = days.map(day => numeric(day[key])).filter(value => value !== null);
      return { key, count: known.length, value: known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null,
        missing: days.length - known.length,
        lowerBound: days.some(day => Array.isArray(day.partial_nutrients) && day.partial_nutrients.includes(key)),
        partial: known.length < days.length || days.some(day => Array.isArray(day.partial_nutrients) && day.partial_nutrients.includes(key)) };
    }),
  }));
}

export function trendPoints(rows: readonly Row[], key: Nutrient) {
  const sorted = [...rows].sort((a, b) => text(a.meal_date).localeCompare(text(b.meal_date)));
  return sorted.flatMap((row, index) => {
    const date = text(row.meal_date);
    const previous = index > 0 ? text(sorted[index - 1]!.meal_date) : null;
    const point = { x: date, y: numeric(row[key]) };
    return previous !== null && dateStep(previous, 1) < date
      ? [{ x: dateStep(previous, 1), y: null }, point] : [point];
  });
}

/** Separate runs stop the shared chart from drawing through an unlogged/unknown day. */
export function trendSeries(rows: readonly Row[], key: Nutrient, target: number | null): ChartSeries[] {
  const unit = key === 'energy_kcal' ? 'kcal' : 'g';
  const label = nutrients.find(nutrient => nutrient.key === key)!.label;
  const recordedName = `${label} (${unit})`;
  const sorted = [...rows].sort((a, b) => text(a.meal_date).localeCompare(text(b.meal_date)));
  const runs: ChartSeries[] = [];
  let previous = '';
  let run: ChartSeries | undefined;
  for (const row of sorted) {
    const date = text(row.meal_date, '');
    const value = numeric(row[key]);
    if (value === null) { run = undefined; previous = ''; continue; }
    if (!run || dateStep(previous, 1) !== date) {
      run = { name: recordedName, points: [] };
      runs.push(run);
    }
    run.points.push({ x: date, y: value });
    previous = date;
  }
  // DailyChart assigns two colors by index. Empty series reserve palette slots, not values,
  // so every observed run keeps the same color and never impersonates the target.
  // Its categories follow series traversal, so the target seeds all returned dates first,
  // including initial unknown observations. A target second would reorder those dates.
  return [{ name: key === 'energy_kcal' ? 'Resting burn minus deficit (before activity) (kcal)' : `${label} target (${unit})`,
    points: target === null ? [] : sorted.map(row => ({ x: text(row.meal_date), y: target })) },
    ...runs.flatMap((entry, index) => index === 0 ? [entry] : [{ name: `Gap before ${entry.name}`, points: [] }, entry])];
}
