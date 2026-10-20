import type { DailyPeriod } from '../types';
import { numeric, text, workoutDate, workoutType, type Workout } from './summary';

export type WorkoutClass = 'Gym' | 'Run' | 'Activity' | 'Other';

export function classifyWorkout(row: Workout): WorkoutClass {
  const type = workoutType(row).replace(/^HKWorkoutActivityType[._ -]*/iu, '').replace(/[\s_.-]/gu, '').toLowerCase();
  if (['gym', 'strengthtraining', 'traditionalstrengthtraining', 'functionalstrengthtraining',
    'highintensityintervaltraining', 'hiit', 'crosstraining', 'coretraining'].includes(type)) return 'Gym';
  if (['run', 'running'].includes(type)) return 'Run';
  if (['activity', 'walking', 'hiking'].includes(type)) return 'Activity';
  return 'Other';
}

export function periodWorkouts(rows: readonly Workout[], period: DailyPeriod) {
  return rows.filter(row => {
    const date = workoutDate(row.workout_date) ?? workoutDate(row.start_at);
    return date !== null && date >= period.startDate && date <= period.endDate;
  });
}

export function nonnegative(value: Workout[string] | undefined) {
  const number = numeric(value);
  return number !== null && number >= 0 ? number : null;
}

export function sumKnown(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}

export function calories(value: Workout[string] | undefined, unit: Workout[string] | undefined) {
  const number = nonnegative(value);
  if (number === null) return null;
  if (unit === 'kcal') return number;
  if (unit === 'kJ') return number / 4.184;
  return null;
}

export function trainingSummary(rows: readonly Workout[], period: DailyPeriod) {
  const selected = periodWorkouts(rows, period);
  const start = Date.parse(`${period.startDate}T12:00:00Z`);
  const end = Date.parse(`${period.endDate}T12:00:00Z`);
  const days = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.min(367, (end - start) / 86_400_000 + 1)) : 0;
  const buckets = Array.from({ length: days }, (_, index) => {
    const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
    const daily = selected.filter(row => (workoutDate(row.workout_date) ?? workoutDate(row.start_at)) === date);
    return {
      date,
      values: Object.fromEntries(['Gym', 'Run', 'Other'].map(group => [group, sumKnown(daily
        .filter(row => (['Gym', 'Run'].includes(classifyWorkout(row)) ? classifyWorkout(row) : 'Other') === group)
        .map(row => calories(row.active_energy_value, row.active_energy_unit)))])) as Record<'Gym' | 'Run' | 'Other', number | null>,
    };
  });
  return {
    rows: selected, count: selected.length, days, buckets,
    energy: sumKnown(selected.map(row => calories(row.active_energy_value, row.active_energy_unit))),
    missingEnergy: selected.filter(row => calories(row.active_energy_value, row.active_energy_unit) === null).length,
  };
}

export function periodTarget(weeklyTarget: number | null, days: number) {
  return weeklyTarget !== null && Number.isFinite(weeklyTarget) && weeklyTarget > 0 && days > 0
    ? weeklyTarget * days / 7 : null;
}

export function activityFigures(rows: readonly Workout[], period: DailyPeriod) {
  const selected = rows.filter(row => {
    const date = workoutDate(row.metric_date);
    return date !== null && date >= period.startDate && date <= period.endDate;
  });
  const total = (names: string[], convert: (row: Workout) => number | null) =>
    sumKnown(selected.filter(row => names.includes(String(row.metric_name))).map(convert));
  return {
    steps: total(['step_count', 'steps'], row => row.unit === 'count' ? nonnegative(row.value) : null),
    energy: total(['active_energy_burned', 'active_energy'], row => calories(row.value, row.unit)),
    seconds: total(['apple_exercise_time', 'exercise_time'], row => {
      const value = nonnegative(row.value);
      return value === null ? null : ['min', 'minutes'].includes(String(row.unit)) ? value * 60
        : ['s', 'sec', 'seconds'].includes(String(row.unit)) ? value
          : ['h', 'hr', 'hours'].includes(String(row.unit)) ? value * 3600 : null;
    }),
  };
}

export function availableData(rows: readonly Workout[], catalogue: readonly Workout[], period: DailyPeriod) {
  const selected = periodWorkouts(rows, period);
  const groups: Record<string, string[]> = {
    'Summary candidates': selected.length ? ['Sessions'] : [],
    'Per-workout figures': [],
    'Heart and provenance': [],
  };
  const fields = [
    ['duration_seconds', 'Time', 'Per-workout figures'],
    ['active_energy_value', 'Active energy', 'Per-workout figures'],
    ['distance_value', 'Distance', 'Per-workout figures'],
    ['workout_type', 'Workout type', 'Per-workout figures'],
    ['start_at', 'Start time', 'Per-workout figures'],
    ['end_at', 'End time', 'Per-workout figures'],
    ['is_indoor', 'Environment', 'Per-workout figures'],
    ['avg_heart_rate', 'Average heart rate', 'Heart and provenance'],
    ['max_heart_rate', 'Maximum heart rate', 'Heart and provenance'],
    ['source_name', 'Source name', 'Heart and provenance'],
    ['ingestion_id', 'Ingestion reference', 'Heart and provenance'],
    ['updated_at', 'Updated time', 'Heart and provenance'],
  ] as const;
  for (const [key, label, group] of fields) {
    if (selected.some(row => typeof row[key] === 'number' ? nonnegative(row[key]) !== null :
      typeof row[key] === 'boolean' || text(row[key]) !== null)) groups[group]!.push(label);
  }
  for (const row of catalogue) {
    const name = text(row.metric_name);
    const first = workoutDate(row.first_date);
    const last = workoutDate(row.last_date);
    const count = nonnegative(row.day_count);
    if (!name || count === null || count === 0 || !first || !last || first > period.endDate || last < period.startDate) continue;
    const units = Array.isArray(row.units) ? row.units.flatMap(unit => text(unit) ? [String(unit)] : []) : [];
    const label = name.replaceAll('_', ' ');
    const entry = `${label.charAt(0).toUpperCase()}${label.slice(1)} — ${count} recorded ${count === 1 ? 'day' : 'days'}${units.length ? ` · ${units.join(', ')}` : ''}`;
    const group = /heart|vo2/iu.test(name) ? 'Heart and provenance' : 'Summary candidates';
    groups[group]!.push(entry);
  }
  return groups;
}
