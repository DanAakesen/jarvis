import { describe, expect, it } from 'vitest';
import { metricValue } from '../body-sleep/metrics';
import { hours } from '../body-sleep/sleep';
import { sumNutrient } from '../nutrition/totals';
import { summarizeWorkouts } from '../workouts/summary';
import { latestNutritionDay, latestSleepNight, nutritionSummaryValues, overviewPeriods, recentMeasurements, sleepSummaryValues, workoutOverview } from './summary';

describe('Daily overview summaries', () => {
  it('uses Copenhagen periods with a Monday-start week', () => {
    expect(overviewPeriods(new Date('2026-10-18T10:00:00Z'))).toEqual({
      sevenDays: { startDate: '2026-10-12', endDate: '2026-10-18' },
      thirtyDays: { startDate: '2026-09-19', endDate: '2026-10-18' },
      thisWeek: { startDate: '2026-10-12', endDate: '2026-10-18' },
    });
  });

  it('agrees with the Workouts section summary and keeps the latest dated workout', () => {
    const rows = [
      { workout_date: '2026-10-17', workout_type: 'running', duration_seconds: 120 },
      { workout_date: '2026-09-18', workout_type: 'cycling', duration_seconds: 3600 },
      { workout_date: '2026-10-18', workout_type: 'walking', duration_seconds: null },
    ];
    const period = { startDate: '2026-09-19', endDate: '2026-10-18' };
    const summary = workoutOverview(rows, period, { startDate: '2026-10-12', endDate: '2026-10-18' });
    expect(summary.latest?.row).toBe(rows[2]!);
    expect(summary.week).toEqual(summarizeWorkouts([rows[0]!, rows[2]!]));
  });

  it('uses Nutrition section nutrient totals and ignores days without meals', () => {
    const rows = [
      { meal_date: '2026-10-17', meal_count: 1, energy_kcal: 900, protein_grams: null },
      { meal_date: '2026-10-18', meal_count: 0, energy_kcal: 0, protein_grams: 0 },
    ];
    const latest = latestNutritionDay(rows, { startDate: '2026-10-12', endDate: '2026-10-18' })!;
    expect(latest).toBe(rows[0]);
    expect(nutritionSummaryValues(latest)).toEqual({
      energy: sumNutrient([latest], 'energy_kcal'),
      protein: sumNutrient([latest], 'protein_grams'),
    });
  });

  it('selects the latest start time when multiple workouts share a date', () => {
    const period = { startDate: '2026-10-12', endDate: '2026-10-18' };
    const rows = [
      { workout_date: '2026-10-18', start_at: '2026-10-18T06:00:00Z' },
      { workout_date: '2026-10-18', start_at: '2026-10-18T17:00:00Z' },
      { workout_date: '2026-10-18', start_at: null },
      { workout_date: '2026-10-17', start_at: '2026-10-17T23:00:00Z' },
    ];
    expect(workoutOverview(rows, period, period).latest?.row).toBe(rows[1]);
  });

  it('keeps body sparkline observations in recorded order, with null gaps and separate units', () => {
    const recent = recentMeasurements([
      { metric_name: 'body_mass', metric_date: '2026-10-18', value: 70, unit: 'kg' },
      { metric_name: 'body_mass', metric_date: '2026-10-17', value: null, unit: 'kg' },
      { metric_name: 'body_mass', metric_date: '2026-10-16', value: 69, unit: 'kg' },
      { metric_name: 'body_mass', metric_date: '2026-10-15', value: 150, unit: 'lb' },
    ]);
    expect(recent[0]?.readings.map(reading => reading.value)).toEqual([69, null, 70]);
    expect(recent[1]?.readings.map(reading => reading.value)).toEqual([150]);
  });

  it('uses Body display names and the same null-aware values for recent readings', () => {
    const rows = [
      { metric_name: 'body_mass', metric_date: '2026-10-18', value: 70, unit: 'kg' },
      { metric_name: 'body_mass', metric_date: '2026-10-17', value: 69, unit: 'kg' },
      { metric_name: 'step_count', metric_date: '2026-10-16', value: null, unit: 'count' },
    ];
    const recent = recentMeasurements(rows);
    expect(recent[0]).toMatchObject({
      label: 'Body mass', unit: 'kg', latest: { date: '2026-10-18', value: metricValue(rows[0]!).value },
      previous: { date: '2026-10-17', value: 69 }, change: 1,
    });
    expect(recent[1]?.latest?.value).toBe(metricValue(rows[2]!).value);
    expect(recentMeasurements(rows, 1)).toHaveLength(1);
  });

  it('uses Sleep section stage and nullable-value functions', () => {
    const rows = [
      { sleep_date: '2026-10-18', total_sleep_hours: 8, asleep_hours: 7, deep_hours: 1, rem_hours: null },
      { sleep_date: '2026-10-11', total_sleep_hours: 9 },
    ];
    const latest = latestSleepNight(rows, { startDate: '2026-10-12', endDate: '2026-10-18' })!;
    expect(latest).toBe(rows[0]);
    expect(sleepSummaryValues(latest)).toMatchObject({ total: hours(latest.total_sleep_hours), asleep: 7 });
    expect(sleepSummaryValues(latest).stages.map(stage => stage.label)).toEqual(['Deep']);
  });
});
