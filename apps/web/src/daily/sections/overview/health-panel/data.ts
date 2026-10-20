import type { DailyJson } from '@jarvis/contracts';
import { copenhagenDate } from '../../../period';
import { dateOnly, finite, metricLabel, metricValue, type Row } from '../../body-sleep/metrics';
import { hours } from '../../body-sleep/sleep';
import { dateStep } from '../../nutrition/totals';
import { trainingCounts, overviewPeriods } from '../summary';
import { workoutDate } from '../../workouts/summary';

export const healthTabs = ['overview', 'sleep', 'activity', 'workouts', 'body', 'nutrition', 'all'] as const;
export type HealthTab = typeof healthTabs[number];
export type HealthTargets = { gymSessionsPerWeek: number | null; runSessionsPerWeek: number | null } | null;
export type Tile = { key: string; label: string; value: number | string; unit?: string | undefined; date?: string; note?: string };
export type Records = { metrics: Row[]; catalog: Row[]; sleep: Row[]; workouts: Row[]; nutrition: Row[] };

const missing = 'Not received';
const unavailable = 'Unavailable';

function category(value: DailyJson | undefined): HealthTab {
  if (typeof value !== 'string') return 'all';
  const name = value.trim().toLowerCase();
  return healthTabs.find(tab => tab !== 'overview' && tab === name) ??
    (name === 'body composition' ? 'body' : 'all');
}

export function metricTiles(metrics: readonly Row[], catalog: readonly Row[]) {
  const groups = new Map<string, Tile & { category: HealthTab }>();
  const catalogue = new Map(catalog.map(row => [row.metric_name, row]));
  for (const row of metrics) {
    if (typeof row.metric_name !== 'string') continue;
    const date = dateOnly(row.metric_date);
    if (!date) continue;
    const unit = typeof row.unit === 'string' && row.unit.trim() ? row.unit : undefined;
    const entry = catalogue.get(row.metric_name);
    const key = JSON.stringify(['metrics', row.metric_name, unit]);
    const previous = groups.get(key);
    if (previous?.date && previous.date > date) continue;
    groups.set(key, {
      key, label: metricLabel(row.metric_name), value: metricValue(row).value ?? unavailable,
      unit, date, category: unit && Array.isArray(entry?.units) && entry.units.includes(unit) ? category(entry.category) : 'all',
      ...(metricValue(row).average ? { note: 'Average of the latest sample day.' } : {}),
    });
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function latest(rows: readonly Row[], date: (row: Row) => string | null) {
  const started = (row: Row) => typeof row.start_at === 'string' && Number.isFinite(Date.parse(row.start_at)) ? Date.parse(row.start_at) : 0;
  return rows.filter(row => date(row)).sort((a, b) => date(b)!.localeCompare(date(a)!) || started(b) - started(a))[0];
}

export function categoryTiles(records: Records, tab: HealthTab): Tile[] {
  const tiles: Tile[] = metricTiles(records.metrics, records.catalog).filter(tile => tab === 'all' || tile.category === tab);
  const add = (source: string, row: Row | undefined, date: string | null, fields: { key: string; unit?: string | undefined; label?: string }[]) => {
    if (!row || !date) return;
    for (const field of fields) {
      if (!(field.key in row)) continue;
      tiles.push({
        key: `${source}:${field.key}`, label: field.label ?? metricLabel(field.key),
        value: finite(row[field.key]) ?? unavailable, date, unit: field.unit,
        ...(Array.isArray(row.partial_nutrients) && row.partial_nutrients.includes(field.key)
          ? { note: 'Partial: some received meals have no value for this nutrient.' } : {}),
      });
    }
  };
  if (tab === 'sleep' || tab === 'all') {
    const row = latest(records.sleep, row => dateOnly(row.sleep_date));
    add('sleep', row, dateOnly(row?.sleep_date), Object.keys(row ?? {})
      .filter(key => key.endsWith('_hours') || key === 'segment_count')
      .map(key => ({ key, unit: key.endsWith('_hours') ? 'h' : 'segments', label: metricLabel(key.replace(/_hours$/u, '')) })));
  }
  if (tab === 'workouts' || tab === 'all') {
    const date = (row: Row) => workoutDate(row.workout_date) ?? workoutDate(row.start_at);
    const row = latest(records.workouts, date);
    add('workouts', row, row ? date(row) : null, [
      { key: 'duration_seconds', label: 'Workout duration', unit: 's' },
      { key: 'active_energy_value', label: 'Workout active energy', unit: typeof row?.active_energy_unit === 'string' ? row.active_energy_unit : undefined },
      { key: 'total_energy_value', label: 'Workout total energy', unit: typeof row?.total_energy_unit === 'string' ? row.total_energy_unit : undefined },
      { key: 'distance_value', label: 'Workout distance', unit: typeof row?.distance_unit === 'string' ? row.distance_unit : undefined },
      { key: 'avg_heart_rate', label: 'Workout average heart rate', unit: 'bpm' },
      { key: 'max_heart_rate', label: 'Workout maximum heart rate', unit: 'bpm' },
    ]);
  }
  if (tab === 'nutrition' || tab === 'all') {
    const row = latest(records.nutrition, row => dateOnly(row.meal_date));
    add('nutrition', row, dateOnly(row?.meal_date), Object.keys(row ?? {})
      .filter(key => key.endsWith('_grams') || key === 'energy_kcal' || key === 'meal_count')
      .map(key => ({ key, label: metricLabel(key.replace(/_(?:grams|kcal)$/u, '')),
        unit: key.endsWith('_grams') ? 'g' : key === 'energy_kcal' ? 'kcal' : 'meals' })));
  }
  return tiles;
}

export function healthSummary(records: Records, now: Date): Tile[] {
  const { sevenDays, thisWeek } = overviewPeriods(now);
  const today = copenhagenDate(now);
  const inRange = (date: string | null, start = sevenDays.startDate) => date !== null && date >= start && date <= today;
  const nights = records.sleep.filter(row => inRange(dateOnly(row.sleep_date)));
  const night = nights.find(row => row.sleep_date === today);
  // Staged exports report asleep_hours as 0, so total sleep leads and asleep is the fallback.
  const sleepHours = (row: Row) => hours(row.total_sleep_hours) ?? hours(row.asleep_hours);
  const sleepValues = nights.map(sleepHours);
  const workouts = records.workouts.filter(row => inRange(workoutDate(row.workout_date) ?? workoutDate(row.start_at)));
  const todaysWorkouts = workouts.filter(row => (workoutDate(row.workout_date) ?? workoutDate(row.start_at)) === today);
  const week = workouts.filter(row => inRange(workoutDate(row.workout_date) ?? workoutDate(row.start_at), thisWeek.startDate));
  // An empty workouts list is a received zero once the panel has a complete read; other sources stay "Not received".
  const sum = (rows: Row[], field: string, unitField?: string, empty: number | string = missing): number | string => {
    if (!rows.length) return empty;
    const values = rows.map(row => finite(row[field]));
    if (values.some(value => value === null || value < 0) ||
      unitField && rows.some(row => row[unitField] !== 'kcal')) return unavailable;
    return values.reduce<number>((total, value) => total + value!, 0);
  };
  const metric = (pattern: RegExp, unit: string) => {
    const rows = records.metrics.filter(row => row.metric_date === today &&
      typeof row.metric_name === 'string' && pattern.test(row.metric_name));
    if (!rows.length) return missing;
    // Aliases are alternative series, not additive observations.
    if (rows.length !== 1 || rows[0]!.unit !== unit) return unavailable;
    return finite(rows[0]!.value) ?? unavailable;
  };
  const food = records.nutrition.filter(row => row.meal_date === today);
  const foodPartial = food.some(row => Array.isArray(row.partial_nutrients) && row.partial_nutrients.includes('energy_kcal'));
  const duration = sum(todaysWorkouts, 'duration_seconds', undefined, 0);
  return [
    { key: 'night', label: "Last night's sleep", value: night ? sleepHours(night) ?? unavailable : missing, unit: 'h' },
    { key: 'sleep-average', label: 'Sleep, trailing 7-day average', value: nights.length
      ? sleepValues.some(value => value === null) ? unavailable : sleepValues.reduce<number>((total, value) => total + value!, 0) / nights.length
      : missing, unit: 'h', note: `${nights.length} received nights; missing nights are not zero.` },
    { key: 'steps', label: 'Steps today', value: metric(/^(?:step_count|steps)$/u, 'count'), unit: 'steps' },
    { key: 'active', label: 'Active calories', value: metric(/^(?:active_energy_burned|active_energy)$/u, 'kcal'), unit: 'kcal' },
    { key: 'resting', label: 'Resting calories', value: metric(/^(?:basal|resting)_energy_burned$/u, 'kcal'), unit: 'kcal' },
    { key: 'food', label: 'Food today', value: foodPartial ? unavailable : sum(food, 'energy_kcal'), unit: 'kcal' },
    { key: 'workouts', label: 'Workouts, rolling 7 days', value: workouts.length, unit: 'sessions' },
    { key: 'workout-energy', label: 'Workout calories, rolling 7 days', value: sum(workouts, 'active_energy_value', 'active_energy_unit', 0), unit: 'kcal' },
    { key: 'workout-duration', label: 'Workout duration today', value: typeof duration === 'number' ? duration / 60 : duration, unit: 'min' },
    { key: 'week', label: 'Workouts this week', value: week.length, unit: 'sessions' },
  ];
}

export function weeklyProgress(workouts: readonly Row[], target: number | null | undefined, kind: 'gym' | 'run', now: Date) {
  const { thisWeek } = overviewPeriods(now);
  const counts = trainingCounts(workouts, thisWeek);
  const done = kind === 'gym' ? counts.strength : counts.running;
  const weekday = new Date(`${thisWeek.endDate}T12:00:00Z`).getUTCDay();
  const days = weekday === 0 ? 1 : 8 - weekday;
  const valid = typeof target === 'number' && Number.isInteger(target) && target >= 0;
  return { done, target: valid ? target : null, remaining: valid ? Math.max(0, target - done) : null, days };
}

export function syncStatus(items: readonly Row[], now: Date) {
  const feeds = items[0]?.feeds;
  const times = (Array.isArray(feeds) ? feeds : []).flatMap(feed => {
    if (!feed || typeof feed !== 'object' || Array.isArray(feed)) return [];
    const value = feed.accepted_evidence_at;
    return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? [value] : [];
  }).sort((a, b) => Date.parse(b) - Date.parse(a));
  const at = times[0];
  if (!at) return 'No sync received';
  const minutes = Math.floor((now.getTime() - Date.parse(at)) / 60_000);
  if (minutes < 0) return 'Sync time is ahead of this device';
  const age = minutes < 1 ? 'less than a minute' : minutes < 60 ? `${minutes} min` :
    minutes < 1440 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 1440)} days`;
  return `Last synced ${age} ago`;
}

export function healthWindow(now: Date) {
  const endDate = copenhagenDate(now);
  return { startDate: dateStep(endDate, -6), endDate };
}
