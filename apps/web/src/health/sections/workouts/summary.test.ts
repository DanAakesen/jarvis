import { describe, expect, it } from 'vitest';
import { loadedScope, numeric, summarizeWorkouts, text, typeLabel, volumeBuckets, workoutType, type Workout } from './summary';

describe('workout values', () => {
  it('only accepts nonblank strings and finite numbers without coercion', () => {
    expect(text(' Running ')).toBe('Running');
    for (const value of [undefined, null, '', '  ', 3, false, [], {}]) expect(text(value)).toBeNull();
    expect(numeric(0)).toBe(0);
    expect(numeric(1.5)).toBe(1.5);
    for (const value of [undefined, null, '', '12', false, [], {}, NaN, Infinity, -Infinity]) {
      expect(numeric(value)).toBeNull();
    }
  });
});

describe('workout types', () => {
  it('keeps stable raw filter keys and falls back to the activity identifier', () => {
    expect(workoutType({ workout_type: 'HKWorkoutActivityTypeRunning', activity_identifier: 'walking' }))
      .toBe('HKWorkoutActivityTypeRunning');
    expect(workoutType({ workout_type: ' ', activity_identifier: 'cycling' })).toBe('cycling');
    expect(workoutType({ workout_type: null })).toBe('unknown');
    expect(workoutType({})).toBe('unknown');
  });

  it.each([
    ['running', 'Running'],
    ['walking', 'Walking'],
    ['cycling', 'Cycling'],
    ['swimming', 'Swimming'],
    ['strength_training', 'Strength training'],
    ['HKWorkoutActivityTypeTraditionalStrengthTraining', 'Strength training'],
    ['HKWorkoutActivityTypeFunctionalStrengthTraining', 'Functional strength training'],
    ['HKWorkoutActivityType.highIntensityIntervalTraining', 'High-intensity interval training'],
    ['HKWorkoutActivityTypeRunning', 'Running'],
    ['high_intensity_interval_training', 'High-intensity interval training'],
    ['newOutdoorSport', 'New outdoor sport'],
    ['custom_activity', 'Custom activity'],
    ['unknown', 'Unknown'],
    ['constructor', 'Constructor'],
  ])('labels %s without changing its filter key', (value, expected) => {
    expect(typeLabel({ workout_type: value })).toBe(expected);
    expect(typeLabel({ activity_identifier: value })).toBe(expected);
    expect(workoutType({ workout_type: value })).toBe(value);
  });

  it('never hides missing or unfamiliar types', () => {
    expect(typeLabel({})).toBe('Unknown');
    expect(typeLabel({ workout_type: null, activity_identifier: 'HKWorkoutActivityTypeYoga' })).toBe('Yoga');
    expect(typeLabel({ workout_type: 'HKWorkoutActivityType' })).toBe('Unknown');
  });
});

describe('summarizeWorkouts', () => {
  it('totals one unit and counts distinct active dates', () => {
    const rows: Workout[] = [
      { workout_date: '2026-10-01', duration_seconds: 60, distance_value: 100, distance_unit: 'm', active_energy_value: 20, active_energy_unit: 'kcal' },
      { workout_date: '2026-10-01', duration_seconds: 120, distance_value: 200, distance_unit: 'm', active_energy_value: 30, active_energy_unit: 'kcal' },
      { workout_date: '2026-10-02', duration_seconds: 0, distance_value: 0, distance_unit: 'm', active_energy_value: 0, active_energy_unit: 'kcal' },
    ];
    expect(summarizeWorkouts(rows)).toEqual({
      count: 3, activeDays: 2, durationSeconds: 180, missingDuration: 0,
      distance: { values: [{ unit: 'm', value: 300 }], missing: 0 },
      energy: { values: [{ unit: 'kcal', value: 50 }], missing: 0 },
    });
  });

  it('keeps mixed and missing units separate and never substitutes total energy for active energy', () => {
    const result = summarizeWorkouts([
      { distance_value: 1000, distance_unit: 'm', active_energy_value: 100, active_energy_unit: 'kcal' },
      { distance_value: 2, distance_unit: 'km', active_energy_value: 400, active_energy_unit: 'kJ' },
      { distance_value: 3, distance_unit: null, active_energy_value: 25, active_energy_unit: null },
      { distance_value: 4, active_energy_value: 5 },
      { distance_value: null, distance_unit: 'm', active_energy_value: null, total_energy_value: 99, total_energy_unit: 'kcal' },
    ]);
    expect(result.distance).toEqual({
      values: [
        { unit: 'm', value: 1000 }, { unit: 'km', value: 2 },
        { unit: 'Unknown unit (not summed)', value: 3 }, { unit: 'Unknown unit (not summed)', value: 4 },
      ], missing: 1,
    });
    expect(result.energy).toEqual({
      values: [
        { unit: 'kcal', value: 100 }, { unit: 'kJ', value: 400 },
        { unit: 'Unknown unit (not summed)', value: 25 }, { unit: 'Unknown unit (not summed)', value: 5 },
      ], missing: 1,
    });
    expect(result.durationSeconds).toBeNull();
    expect(result.missingDuration).toBe(5);
  });

  it('keeps every blank-unit value separate, including zero', () => {
    const result = summarizeWorkouts([
      { distance_value: 3, distance_unit: '', active_energy_value: 25, active_energy_unit: '' },
      { distance_value: 4, distance_unit: '  ', active_energy_value: 5, active_energy_unit: '  ' },
      { distance_value: 0, distance_unit: null, active_energy_value: 0, active_energy_unit: null },
    ]);
    expect(result.distance).toEqual({
      values: [3, 4, 0].map(value => ({ unit: 'Unknown unit (not summed)', value })), missing: 0,
    });
    expect(result.energy).toEqual({
      values: [25, 5, 0].map(value => ({ unit: 'Unknown unit (not summed)', value })), missing: 0,
    });
  });

  it('treats negative durations as missing without subtracting from valid duration', () => {
    expect(summarizeWorkouts([{ duration_seconds: 120 }, { duration_seconds: -60 }, {}])).toMatchObject({
      durationSeconds: 120, missingDuration: 2,
    });
    expect(summarizeWorkouts([{ duration_seconds: -60 }])).toMatchObject({
      durationSeconds: null, missingDuration: 1,
    });
  });

  it('preserves unknown values rather than inventing zeroes', () => {
    expect(summarizeWorkouts([])).toEqual({
      count: 0, activeDays: 0, durationSeconds: null, missingDuration: 0,
      distance: { values: [], missing: 0 }, energy: { values: [], missing: 0 },
    });
    expect(summarizeWorkouts([{ duration_seconds: null }, { duration_seconds: Infinity }])).toMatchObject({
      count: 2, durationSeconds: null, missingDuration: 2,
      distance: { values: [], missing: 2 }, energy: { values: [], missing: 2 },
    });
    expect(summarizeWorkouts([{ duration_seconds: 120 }, {}])).toMatchObject({
      durationSeconds: 120, missingDuration: 1,
    });
  });

  it('counts distinct Copenhagen workout dates without inferring active days from start_at', () => {
    expect(summarizeWorkouts([
      { workout_date: '2026-10-01' },
      { workout_date: '2026-09-30T22:30:00Z' },
      { workout_date: null, start_at: '2026-10-01T22:30:00Z' },
      { start_at: '2026-10-02T05:00:00Z' },
      { workout_date: 'invalid', start_at: '2026-10-03T12:00:00Z' },
      { workout_date: '2026-02-30' },
      { workout_date: '2026-02-30T12:00:00Z' },
      {},
    ])).toMatchObject({ count: 8, activeDays: 1 });
    expect(summarizeWorkouts([
      { workout_date: null, start_at: '2026-10-01T22:30:00Z' },
      { start_at: '2026-10-02T05:00:00Z' },
    ])).toMatchObject({ count: 2, activeDays: 0 });
  });
});

describe('loadedScope', () => {
  it('qualifies partial results with the number actually loaded', () => {
    expect(loadedScope(200, true)).toBe('in the 200 loaded');
    expect(loadedScope(0, true)).toBe('in the 0 loaded');
    expect(loadedScope(200, false)).toBe('in this period');
  });
});

describe('volumeBuckets', () => {
  it('counts negative durations as missing without reducing known volume or inventing zero', () => {
    expect(volumeBuckets([
      { workout_date: '2026-10-05', duration_seconds: 60 },
      { workout_date: '2026-10-06', duration_seconds: -120 },
      { workout_date: '2026-10-12', duration_seconds: -60 },
    ], { startDate: '2026-10-05', endDate: '2026-10-12' })).toEqual({
      grain: 'week',
      buckets: [
        { start: '2026-10-05', minutes: 1, count: 2, missingDuration: 1 },
        { start: '2026-10-12', minutes: null, count: 1, missingDuration: 1 },
      ],
    });
  });

  it('starts weeks on Monday across the year boundary and emits empty buckets', () => {
    expect(volumeBuckets([
      { workout_date: '2024-12-29', duration_seconds: 600 },
      { workout_date: '2024-12-30', duration_seconds: 120 },
      { workout_date: '2025-01-05', duration_seconds: null },
      { workout_date: '2025-01-06', duration_seconds: null },
      { workout_date: '2025-01-21', duration_seconds: 600 },
    ], { startDate: '2024-12-30', endDate: '2025-01-20' })).toEqual({
      grain: 'week',
      buckets: [
        { start: '2024-12-30', minutes: 2, count: 2, missingDuration: 1 },
        { start: '2025-01-06', minutes: null, count: 1, missingDuration: 1 },
        { start: '2025-01-13', minutes: null, count: 0, missingDuration: 0 },
        { start: '2025-01-20', minutes: null, count: 0, missingDuration: 0 },
      ],
    });
  });

  it('uses weekly buckets for exactly 120 inclusive days and monthly buckets for 121', () => {
    expect(volumeBuckets([], { startDate: '2025-01-01', endDate: '2025-04-30' }).grain).toBe('week');
    expect(volumeBuckets([], { startDate: '2025-01-01', endDate: '2025-05-01' }).grain).toBe('month');
  });

  it('emits every month including partial edge months and distinguishes empty, unknown and zero duration', () => {
    expect(volumeBuckets([
      { workout_date: '2025-01-14', duration_seconds: 999 },
      { workout_date: '2025-01-15', duration_seconds: 90 },
      { workout_date: '2025-02-05' },
      { workout_date: '2025-04-01', duration_seconds: 0 },
      { workout_date: '2025-06-02', duration_seconds: 999 },
    ], { startDate: '2025-01-15', endDate: '2025-06-01' })).toEqual({
      grain: 'month',
      buckets: [
        { start: '2025-01-01', minutes: 1.5, count: 1, missingDuration: 0 },
        { start: '2025-02-01', minutes: null, count: 1, missingDuration: 1 },
        { start: '2025-03-01', minutes: null, count: 0, missingDuration: 0 },
        { start: '2025-04-01', minutes: 0, count: 1, missingDuration: 0 },
        { start: '2025-05-01', minutes: null, count: 0, missingDuration: 0 },
        { start: '2025-06-01', minutes: null, count: 0, missingDuration: 0 },
      ],
    });
  });

  it.each([
    ['2026-03-29T22:30:00Z', '2026-03-30'],
    ['2026-10-25T23:30:00Z', '2026-10-26'],
    ['2026-01-04T23:30:00Z', '2026-01-05'],
  ])('groups %s into the Copenhagen Monday %s across DST and winter time', (timestamp, monday) => {
    expect(volumeBuckets([
      { workout_date: timestamp, duration_seconds: 60 },
      { start_at: timestamp, duration_seconds: 120 },
      { workout_date: monday, duration_seconds: 0 },
    ], { startDate: monday, endDate: monday })).toEqual({
      grain: 'week', buckets: [{ start: monday, minutes: 3, count: 3, missingDuration: 0 }],
    });
  });

  it('applies Copenhagen month boundaries before filtering and grouping', () => {
    const result = volumeBuckets([
      { workout_date: '2025-01-31T23:30:00Z', duration_seconds: 60 },
      { start_at: '2025-03-31T22:30:00Z', duration_seconds: 120 },
    ], { startDate: '2025-01-01', endDate: '2025-05-01' });
    expect(result.buckets[0]?.count).toBe(0);
    expect(result.buckets[1]).toMatchObject({ start: '2025-02-01', minutes: 1, count: 1 });
    expect(result.buckets[3]).toMatchObject({ start: '2025-04-01', minutes: 2, count: 1 });
  });

  it('ignores invalid dates and refuses invalid or inverted periods', () => {
    expect(volumeBuckets([
      { workout_date: '2025-02-30', duration_seconds: 60 },
      { workout_date: 'invalid', start_at: '2025-02-03T00:00:00Z' },
      {},
    ], { startDate: '2025-02-03', endDate: '2025-02-03' }).buckets).toEqual([
      { start: '2025-02-03', minutes: null, count: 0, missingDuration: 0 },
    ]);
    for (const period of [
      { startDate: 'bad', endDate: '2025-02-03' },
      { startDate: '2025-02-03', endDate: '2025-02-30' },
      { startDate: '2025-02-04', endDate: '2025-02-03' },
    ]) expect(volumeBuckets([], period).buckets).toEqual([]);
  });
});
