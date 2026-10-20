import { isDailyPeriod, copenhagenDate } from '../../period';
import { dateStep } from '../nutrition/totals';
import { dateOnly, metricDisplay, metricValue, type Row as MetricRow } from '../body-sleep/metrics';
import { hours, nightStages } from '../body-sleep/sleep';
import { numeric, sumNutrient, type Row as NutritionRow } from '../nutrition/totals';
import { summarizeWorkouts, type Workout, typeLabel, workoutDate } from '../workouts/summary';
import type { Row as SleepRow } from '../body-sleep/metrics';

export function overviewPeriods(now = new Date()) {
  const endDate = copenhagenDate(now);
  const weekday = new Date(`${endDate}T12:00:00Z`).getUTCDay();
  return {
    sevenDays: { startDate: dateStep(endDate, -6), endDate },
    thirtyDays: { startDate: dateStep(endDate, -29), endDate },
    thisWeek: { startDate: dateStep(endDate, -((weekday + 6) % 7)), endDate },
  };
}

export function workoutOverview(rows: readonly Workout[], period: { startDate: string; endDate: string },
  weekPeriod: { startDate: string; endDate: string }) {
  const dated = rows.flatMap(row => {
    const date = workoutDate(row.workout_date) ?? workoutDate(row.start_at);
    return date && date >= period.startDate && date <= period.endDate ? [{ row, date }] : [];
  });
  const startedAt = (row: Workout) => {
    const value = typeof row.start_at === 'string' ? Date.parse(row.start_at) : Number.NaN;
    return Number.isFinite(value) ? value : 0;
  };
  const latest = [...dated].sort((a, b) => b.date.localeCompare(a.date) || startedAt(b.row) - startedAt(a.row))[0] ?? null;
  const week = dated.filter(item => item.date >= weekPeriod.startDate && item.date <= weekPeriod.endDate).map(item => item.row);
  return { latest, week: summarizeWorkouts(week) };
}

/** Sessions in the period, grouped by what the recorded type says; nothing is inferred beyond the type. */
export function trainingCounts(rows: readonly Workout[], period: { startDate: string; endDate: string }) {
  const counts = { strength: 0, running: 0, other: 0 };
  for (const row of rows) {
    const date = workoutDate(row.workout_date) ?? workoutDate(row.start_at);
    if (!date || date < period.startDate || date > period.endDate) continue;
    const label = typeLabel(row);
    if (/strength/iu.test(label)) counts.strength += 1;
    else if (label === 'Running') counts.running += 1;
    else counts.other += 1;
  }
  return counts;
}

export function latestNutritionDay(rows: readonly NutritionRow[], period: { startDate: string; endDate: string }) {
  return [...rows]
    .filter(row => {
      const date = row.meal_date;
      return typeof date === 'string' && isDailyPeriod({ startDate: date, endDate: date }) &&
        date >= period.startDate && date <= period.endDate && (numeric(row.meal_count) ?? 0) > 0;
    })
    .sort((a, b) => String(b.meal_date).localeCompare(String(a.meal_date)))[0] ?? null;
}

export function recentMeasurements(rows: readonly MetricRow[], limit = 3) {
  const groups = new Map<string, { name: string; label: string; unit: string | null; readings: { date: string; value: number | null }[] }>();
  for (const row of rows) {
    if (typeof row.metric_name !== 'string') continue;
    const date = dateOnly(row.metric_date);
    if (date === null) continue;
    const unit = typeof row.unit === 'string' && row.unit.trim() ? row.unit : null;
    const key = JSON.stringify([row.metric_name, unit]);
    const group = groups.get(key) ?? {
      name: row.metric_name, label: metricDisplay(row.metric_name).label, unit, readings: [],
    };
    group.readings.push({ date, value: metricValue(row).value });
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(group => {
      const readings = [...group.readings].sort((a, b) => b.date.localeCompare(a.date));
      const latest = readings[0] ?? null;
      const previous = readings[1] ?? null;
      return {
        name: group.name, label: group.label, unit: group.unit, latest, previous, readings: [...readings].reverse(),
        change: latest?.value !== null && latest?.value !== undefined && previous?.value !== null && previous?.value !== undefined
          ? latest.value - previous.value : null,
      };
    })
    .sort((a, b) => (b.latest?.date ?? '').localeCompare(a.latest?.date ?? ''))
    .slice(0, Math.max(0, Math.floor(limit)));
}

export function latestSleepNight(rows: readonly SleepRow[], period: { startDate: string; endDate: string }) {
  return [...rows]
    .filter(row => {
      const date = dateOnly(row.sleep_date);
      return date !== null && date >= period.startDate && date <= period.endDate;
    })
    .sort((a, b) => String(b.sleep_date).localeCompare(String(a.sleep_date)))[0] ?? null;
}

export function nutritionSummaryValues(row: NutritionRow) {
  return {
    energy: sumNutrient([row], 'energy_kcal'),
    protein: sumNutrient([row], 'protein_grams'),
  };
}

export function sleepSummaryValues(row: SleepRow) {
  return {
    total: hours(row.total_sleep_hours),
    asleep: hours(row.asleep_hours),
    stages: nightStages(row).recorded,
  };
}
