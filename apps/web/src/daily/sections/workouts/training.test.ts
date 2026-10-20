import { describe, expect, it } from 'vitest';
import type { Workout } from './summary';
import { activityFigures, availableData, classifyWorkout, periodTarget, trainingSummary } from './training';

const period = { startDate: '2026-10-24', endDate: '2026-10-26' };

describe('training from synthetic retained rows', () => {
  it.each([
    ['HKWorkoutActivityTypeTraditionalStrengthTraining', 'Gym'],
    ['functional_strength_training', 'Gym'], ['HIIT', 'Gym'], ['coreTraining', 'Gym'],
    ['running', 'Run'], ['HKWorkoutActivityType.Running', 'Run'],
    ['walking', 'Activity'], ['hiking', 'Activity'], ['activity', 'Activity'],
    ['cycling', 'Other'], ['new_future_sport', 'Other'], ['', 'Other'],
  ])('classifies %s as %s', (workout_type, expected) => {
    expect(classifyWorkout({ workout_type })).toBe(expected);
  });

  it('classifies activity_identifier when the type is absent', () => {
    expect(classifyWorkout({ workout_type: null, activity_identifier: 'Running' })).toBe('Run');
  });

  it('reconciles totals and day buckets through Copenhagen midnight and the autumn DST change', () => {
    const rows: Workout[] = [
      { workout_type: 'running', start_at: '2026-10-23T22:30:00Z', active_energy_value: 100, active_energy_unit: 'kcal' },
      { workout_type: 'strength_training', start_at: '2026-10-24T23:30:00Z', active_energy_value: 418.4, active_energy_unit: 'kJ' },
      { workout_type: 'walking', start_at: '2026-10-25T23:30:00Z', active_energy_value: 20, active_energy_unit: 'kcal' },
      { workout_type: 'cycling', workout_date: '2026-10-26', active_energy_value: 30, active_energy_unit: 'kcal' },
      { workout_type: 'running', workout_date: '2026-10-26', active_energy_value: 0, active_energy_unit: 'kcal' },
      { workout_type: 'running', workout_date: '2026-10-26', active_energy_value: null },
      { workout_type: 'running', workout_date: '2026-10-26', active_energy_value: 10 },
      { workout_type: 'running', workout_date: '2026-10-26', active_energy_value: -10, active_energy_unit: 'kcal' },
      { workout_type: 'running', workout_date: '2026-10-27', active_energy_value: 999, active_energy_unit: 'kcal' },
      { workout_type: 'running', start_at: 'not-a-date', active_energy_value: 999, active_energy_unit: 'kcal' },
    ];
    const summary = trainingSummary(rows, period);
    expect(summary.count).toBe(8);
    expect(summary.energy).toBeCloseTo(250);
    expect(summary.missingEnergy).toBe(3);
    expect(summary.buckets).toEqual([
      { date: '2026-10-24', values: { Gym: null, Run: 100, Other: null } },
      { date: '2026-10-25', values: { Gym: 418.4 / 4.184, Run: null, Other: null } },
      { date: '2026-10-26', values: { Gym: null, Run: 0, Other: 50 } },
    ]);
    expect(summary.buckets.flatMap(bucket => Object.values(bucket.values))
      .reduce<number>((sum, value) => sum + (value ?? 0), 0)).toBeCloseTo(summary.energy!);
  });

  it('keeps missing calories and unrecorded days unknown, respects an explicit workout date', () => {
    const summary = trainingSummary([{ workout_date: '2026-10-24', start_at: '2026-10-26T23:30:00Z' }], period);
    expect(summary.count).toBe(1);
    expect(summary.energy).toBeNull();
    expect(summary.buckets.every(bucket => Object.values(bucket.values).every(value => value === null))).toBe(true);
    expect(trainingSummary([], period).energy).toBeNull();
  });

  it('scales only non-negative finite weekly targets to the selected days and keeps a target of 0', () => {
    expect(periodTarget(3, 7)).toBe(3);
    expect(periodTarget(3, 14)).toBe(6);
    expect(periodTarget(7, 1)).toBe(1);
    expect(periodTarget(0, 7)).toBe(0);
    for (const target of [null, -1, NaN, Infinity]) expect(periodTarget(target, 7)).toBeNull();
    expect(periodTarget(3, 0)).toBeNull();
  });

  it('uses daily metric totals, preserves recorded zero, and does not substitute averages for missing totals', () => {
    expect(activityFigures([
      { metric_name: 'step_count', metric_date: '2026-10-24', value: 100, unit: 'count' },
      { metric_name: 'step_count', metric_date: '2026-10-25', value: 0, unit: 'count' },
      { metric_name: 'step_count', metric_date: '2026-10-26', value: null, avg_value: 999, unit: 'count' },
      { metric_name: 'step_count', metric_date: '2026-10-23', value: 999, unit: 'count' },
      { metric_name: 'active_energy_burned', metric_date: '2026-10-24', value: 50, unit: 'kcal' },
      { metric_name: 'apple_exercise_time', metric_date: '2026-10-24', value: 10, unit: 'min' },
      { metric_name: 'exercise_time', metric_date: '2026-10-25', value: 1, unit: 'hours' },
      { metric_name: 'exercise_time', metric_date: '2026-10-26', value: 60, unit: 's' },
    ], period)).toEqual({ steps: 100, energy: 50, seconds: 4260 });
    expect(activityFigures([
      { metric_name: 'step_count', metric_date: '2026-10-24', value: 99, unit: null },
      { metric_name: 'active_energy_burned', metric_date: '2026-10-24', value: -1, unit: 'kcal' },
      { metric_name: 'exercise_time', metric_date: '2026-10-24', value: 60, unit: 'unknown' },
    ], period)).toEqual({ steps: null, energy: null, seconds: null });
  });

  it('builds three inventory groups from present fields and catalogue evidence in the period only', () => {
    const groups = availableData([
      { workout_date: '2026-10-24', workout_type: 'running', duration_seconds: 0, avg_heart_rate: null,
        max_heart_rate: 140, source_name: 'Synthetic watch', is_indoor: false, detail_json: { invented: true } },
      { workout_date: '2026-10-23', avg_heart_rate: 100, distance_value: 10 },
    ], [
      { metric_name: 'step_count', units: ['count'], first_date: '2026-10-24', last_date: '2026-10-25', day_count: 2 },
      { metric_name: 'resting_heart_rate', units: ['bpm'], first_date: '2026-10-24', last_date: '2026-10-24', day_count: 1 },
      { metric_name: 'not_received', units: [], first_date: '2026-10-24', last_date: '2026-10-24', day_count: 0 },
      { metric_name: 'outside_period', units: [], first_date: '2026-09-01', last_date: '2026-09-02', day_count: 2 },
    ], period);
    expect(groups).toEqual({
      'Summary candidates': ['Sessions', 'Step count — 2 recorded days · count'],
      'Per-workout figures': ['Time', 'Workout type', 'Environment'],
      'Heart and provenance': ['Maximum heart rate', 'Source name', 'Resting heart rate — 1 recorded day · bpm'],
    });
    expect(availableData([], [], period)).toEqual({
      'Summary candidates': [], 'Per-workout figures': [], 'Heart and provenance': [],
    });
  });

  it('humanizes technical catalogue names without exposing the former area name', () => {
    const catalogue = ['daily.metrics', 'daily.health.step_count', 'daily_steps'].map(metric_name => ({
      metric_name, units: ['count'], first_date: '2026-10-24', last_date: '2026-10-24', day_count: 1,
    }));
    expect(availableData([], catalogue, period)['Summary candidates']).toEqual([
      'Metrics — 1 recorded day · count',
      'Health step count — 1 recorded day · count',
      'Per day steps — 1 recorded day · count',
    ]);
  });
});
