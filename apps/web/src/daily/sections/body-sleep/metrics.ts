import type { DailyJson } from '@jarvis/contracts';
import type { DailyPeriod } from '../types';

export type Row = Record<string, DailyJson>;
export const metricGroups = ['Body composition', 'Activity', 'Heart', 'Other'] as const;
type Group = typeof metricGroups[number];

const names: Record<string, { label: string; group: Group }> = {
  body_mass: { label: 'Body mass', group: 'Body composition' },
  weight: { label: 'Weight', group: 'Body composition' },
  body_fat_percentage: { label: 'Body fat', group: 'Body composition' },
  lean_body_mass: { label: 'Lean body mass', group: 'Body composition' },
  body_mass_index: { label: 'Body mass index', group: 'Body composition' },
  height: { label: 'Height', group: 'Body composition' },
  step_count: { label: 'Steps', group: 'Activity' },
  steps: { label: 'Steps', group: 'Activity' },
  flights_climbed: { label: 'Flights climbed', group: 'Activity' },
  active_energy_burned: { label: 'Active energy', group: 'Activity' },
  basal_energy_burned: { label: 'Resting energy', group: 'Activity' },
  distance_walking_running: { label: 'Walking and running distance', group: 'Activity' },
  apple_exercise_time: { label: 'Exercise time', group: 'Activity' },
  heart_rate: { label: 'Heart rate', group: 'Heart' },
  resting_heart_rate: { label: 'Resting heart rate', group: 'Heart' },
  walking_heart_rate_average: { label: 'Walking heart rate', group: 'Heart' },
  heart_rate_variability_sdnn: { label: 'Heart rate variability (SDNN)', group: 'Heart' },
  vo2_max: { label: 'VO₂ max', group: 'Heart' },
};

export function metricDisplay(name: string): { label: string; group: Group } {
  return Object.hasOwn(names, name) ? names[name]! : { label: name, group: 'Other' };
}

export function finite(value: DailyJson | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function dateOnly(value: DailyJson | undefined): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const time = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? value : null;
}

export function periodDays(period: DailyPeriod) {
  return Math.round((Date.parse(`${period.endDate}T12:00:00Z`) -
    Date.parse(`${period.startDate}T12:00:00Z`)) / 86_400_000) + 1;
}

export function periodDates(period: DailyPeriod) {
  return Array.from({ length: periodDays(period) }, (_, index) =>
    new Date(Date.parse(`${period.startDate}T12:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10));
}

export function metricValue(row: Row) {
  const value = finite(row.value);
  return { value: value ?? finite(row.avg_value), average: value === null && finite(row.avg_value) !== null };
}

export function splitUnits(rows: readonly Row[], declaredUnits: readonly string[] = []) {
  const groups = new Map<string | null, Row[]>(declaredUnits.map(unit => [unit, []]));
  for (const row of rows) {
    const unit = typeof row.unit === 'string' && row.unit.trim() ? row.unit : null;
    const group = groups.get(unit) ?? [];
    group.push(row);
    groups.set(unit, group);
  }
  return [...groups].map(([unit, items]) => ({ unit, rows: items }));
}

export function metricSummary(rows: readonly Row[], period: DailyPeriod) {
  const byDate = new Map<string, number[]>();
  for (const row of rows) {
    const date = dateOnly(row.metric_date);
    const { value } = metricValue(row);
    if (!date || date < period.startDate || date > period.endDate || value === null) continue;
    const values = byDate.get(date) ?? [];
    values.push(value);
    byDate.set(date, values);
  }
  // Give each recorded day equal weight, even if retained rows share a date.
  const days = [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => {
    const ranges = rows.flatMap(row => {
      if (dateOnly(row.metric_date) !== date) return [];
      const low = finite(row.min_value);
      const high = finite(row.max_value);
      return low !== null && high !== null && low <= high ? [{ low, high }] : [];
    });
    return {
      date, value: values.reduce((sum, value) => sum + value, 0) / values.length,
      low: ranges.length ? Math.min(...ranges.map(range => range.low)) : null,
      high: ranges.length ? Math.max(...ranges.map(range => range.high)) : null,
    };
  });
  const first = days[0] ?? null;
  const latest = days.at(-1) ?? null;
  const minimum = days.reduce<typeof first>((best, day) => !best || day.value < best.value ? day : best, null);
  const maximum = days.reduce<typeof first>((best, day) => !best || day.value > best.value ? day : best, null);
  return {
    days, first, latest, minimum, maximum, count: days.length, total: periodDays(period),
    average: days.length ? days.reduce((sum, day) => sum + day.value, 0) / days.length : null,
    change: days.length >= 2 && first && latest ? latest.value - first.value : null,
  };
}
