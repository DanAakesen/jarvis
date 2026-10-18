import type { DailyJson } from '@jarvis/contracts';
import { copenhagenDate } from '../../period';

export type Workout = Record<string, DailyJson>;

export type UnitTotals = {
  values: { unit: string; value: number }[];
  missing: number;
};

export function text(value: DailyJson | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function numeric(value: DailyJson | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function durationValue(value: DailyJson | undefined): number | null {
  const seconds = numeric(value);
  return seconds !== null && seconds >= 0 ? seconds : null;
}

export function workoutType(row: Workout): string {
  return text(row.workout_type) ?? text(row.activity_identifier) ?? 'unknown';
}

const labels: Record<string, string> = {
  running: 'Running',
  walking: 'Walking',
  cycling: 'Cycling',
  swimming: 'Swimming',
  strengthtraining: 'Strength training',
  traditionalstrengthtraining: 'Strength training',
  functionalstrengthtraining: 'Functional strength training',
  highintensityintervaltraining: 'High-intensity interval training',
  hiit: 'High-intensity interval training',
  crosstraining: 'Cross training',
  mixedcardio: 'Mixed cardio',
  cardiotraining: 'Cardio training',
  coretraining: 'Core training',
  flexibility: 'Flexibility',
  yoga: 'Yoga',
  pilates: 'Pilates',
  rowing: 'Rowing',
  hiking: 'Hiking',
  elliptical: 'Elliptical',
  stairclimbing: 'Stair climbing',
  stairstepper: 'Stair stepper',
  dance: 'Dance',
  dancing: 'Dancing',
  soccer: 'Football',
  football: 'Football',
  americanfootball: 'American football',
  badminton: 'Badminton',
  basketball: 'Basketball',
  tennis: 'Tennis',
  tabletennis: 'Table tennis',
  golf: 'Golf',
  boxing: 'Boxing',
  kickboxing: 'Kickboxing',
  martialarts: 'Martial arts',
  mindandbody: 'Mind and body',
  cooldown: 'Cooldown',
  other: 'Other',
  unknown: 'Unknown',
};

export function typeLabel(row: Workout): string {
  const raw = workoutType(row).replace(/^HKWorkoutActivityType[._ -]*/iu, '');
  const key = raw.replace(/[\s_.-]/gu, '').toLowerCase();
  const known = Object.hasOwn(labels, key) ? labels[key] : undefined;
  if (known !== undefined) return known;
  const words = raw.replace(/([a-z\d])([A-Z])/gu, '$1 $2').replace(/[_\s.-]+/gu, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1).toLowerCase() : 'Unknown';
}

const dayMilliseconds = 86_400_000;

function calendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function workoutDate(input: DailyJson | undefined): string | null {
  const value = text(input);
  if (!value) return null;
  if (calendarDate(value)) return value;
  if (!/^\d{4}-\d{2}-\d{2}T/iu.test(value) || !calendarDate(value.slice(0, 10))) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? copenhagenDate(date) : null;
}

function unitTotals(rows: readonly Workout[], valueKey: string, unitKey: string): UnitTotals {
  const totals = new Map<string, number>();
  const ungrouped: UnitTotals['values'] = [];
  let missing = 0;
  for (const row of rows) {
    const value = numeric(row[valueKey]);
    if (value === null) {
      missing += 1;
      continue;
    }
    const unit = text(row[unitKey]);
    if (unit === null) ungrouped.push({ unit: 'Unknown unit (not summed)', value });
    else totals.set(unit, (totals.get(unit) ?? 0) + value);
  }
  const grouped = [...totals].map(([unit, value]) => ({ unit, value }));
  return { values: [...grouped, ...ungrouped], missing };
}

export function summarizeWorkouts(rows: readonly Workout[]): {
  count: number;
  activeDays: number;
  durationSeconds: number | null;
  missingDuration: number;
  distance: UnitTotals;
  energy: UnitTotals;
} {
  const dates = new Set<string>();
  let durationSeconds: number | null = null;
  let missingDuration = 0;
  for (const row of rows) {
    const date = workoutDate(row.workout_date);
    if (date) dates.add(date);
    const duration = durationValue(row.duration_seconds);
    if (duration === null) missingDuration += 1;
    else durationSeconds = (durationSeconds ?? 0) + duration;
  }
  return {
    count: rows.length,
    activeDays: dates.size,
    durationSeconds,
    missingDuration,
    distance: unitTotals(rows, 'distance_value', 'distance_unit'),
    energy: unitTotals(rows, 'active_energy_value', 'active_energy_unit'),
  };
}

export function loadedScope(count: number, partial: boolean): string {
  return partial ? `in the ${count} loaded` : 'in this period';
}

type VolumeBucket = { start: string; minutes: number | null; count: number; missingDuration: number };

function bucketStart(date: Date, grain: 'week' | 'month'): string {
  const start = new Date(date);
  if (grain === 'month') start.setUTCDate(1);
  else start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  return start.toISOString().slice(0, 10);
}

export function volumeBuckets(
  rows: readonly Workout[],
  period: { startDate: string; endDate: string },
): { grain: 'week' | 'month'; buckets: VolumeBucket[] } {
  const start = calendarDate(period.startDate);
  const end = calendarDate(period.endDate);
  if (!start || !end || start > end) return { grain: 'week', buckets: [] };
  const days = (end.getTime() - start.getTime()) / dayMilliseconds + 1;
  const grain = days <= 120 ? 'week' : 'month';
  const buckets = new Map<string, VolumeBucket>();
  const cursor = new Date(`${bucketStart(start, grain)}T00:00:00Z`);
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    buckets.set(key, { start: key, minutes: null, count: 0, missingDuration: 0 });
    if (grain === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  for (const row of rows) {
    const date = workoutDate(text(row.workout_date) ?? row.start_at);
    if (!date || date < period.startDate || date > period.endDate) continue;
    const bucket = buckets.get(bucketStart(new Date(`${date}T00:00:00Z`), grain));
    if (!bucket) continue;
    bucket.count += 1;
    const duration = durationValue(row.duration_seconds);
    if (duration === null) bucket.missingDuration += 1;
    else bucket.minutes = (bucket.minutes ?? 0) + duration / 60;
  }
  return { grain, buckets: [...buckets.values()] };
}
