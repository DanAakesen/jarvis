import { describe, expect, it } from 'vitest';
import { categoryTiles, healthSummary, healthWindow, metricTiles, syncStatus, weeklyProgress, type Records } from './data';

const empty = (): Records => ({ metrics: [], catalog: [], sleep: [], workouts: [], nutrition: [] });
const now = new Date('2026-10-20T12:00:00Z');
const values = (rows: Records, time = now) => Object.fromEntries(healthSummary(rows, time).map(tile => [tile.key, tile.value]));

describe('Health panel calculations', () => {
  it('uses Copenhagen today across UTC midnight and a DST transition', () => {
    const time = new Date('2026-10-25T23:30:00Z');
    expect(healthWindow(time)).toEqual({ startDate: '2026-10-20', endDate: '2026-10-26' });
    const rows = empty();
    rows.metrics = [
      { metric_name: 'step_count', metric_date: '2026-10-25', value: 900, unit: 'count' },
      { metric_name: 'step_count', metric_date: '2026-10-26', value: 0, unit: 'count' },
    ];
    rows.workouts = [
      { start_at: '2026-10-25T23:15:00Z', duration_seconds: 1800 },
      { start_at: '2026-10-25T22:15:00Z', duration_seconds: 600 },
    ];
    expect(values(rows, time).steps).toBe(0);
    expect(values(rows, time)['workout-duration']).toBe(30);
  });

  it('keeps rolling seven days, today and Monday-based this week separate', () => {
    const rows = empty();
    rows.sleep = [
      { sleep_date: '2026-10-13', asleep_hours: 24 },
      { sleep_date: '2026-10-14', asleep_hours: 6 },
      { sleep_date: '2026-10-20', asleep_hours: 8 },
      { sleep_date: '2026-10-21', asleep_hours: 20 },
    ];
    rows.workouts = ['2026-10-13', '2026-10-14', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21']
      .map(workout_date => ({ workout_date, duration_seconds: 1200, active_energy_value: 100, active_energy_unit: 'kcal' }));
    rows.nutrition = [{ meal_date: '2026-10-19', energy_kcal: 500 }, { meal_date: '2026-10-20', energy_kcal: 700 }];
    expect(values(rows)).toMatchObject({
      night: 8, 'sleep-average': 7, workouts: 4, 'workout-energy': 400, 'workout-duration': 20, week: 2, food: 700,
    });
  });

  it('distinguishes absent records, uncomputable totals, zero and incompatible units', () => {
    const rows = empty();
    expect(Object.values(values(rows)).every(value => value === 'Not received')).toBe(true);
    rows.metrics = [{ metric_name: 'active_energy_burned', metric_date: '2026-10-20', value: 80, unit: 'kJ' }];
    rows.workouts = [
      { workout_date: '2026-10-20', duration_seconds: null, active_energy_value: 100, active_energy_unit: 'kcal' },
      { workout_date: '2026-10-19', active_energy_value: 100, active_energy_unit: 'kJ' },
    ];
    rows.sleep = [{ sleep_date: '2026-10-20', asleep_hours: null }];
    rows.nutrition = [{ meal_date: '2026-10-20', energy_kcal: 50, partial_nutrients: ['energy_kcal'] }];
    expect(values(rows)).toMatchObject({
      active: 'Unavailable', 'workout-energy': 'Unavailable', 'workout-duration': 'Unavailable',
      night: 'Unavailable', 'sleep-average': 'Unavailable', food: 'Unavailable',
    });
    rows.nutrition = [{ meal_date: '2026-10-20', energy_kcal: 0 }];
    expect(values(rows).food).toBe(0);
  });

  it('never sums alternative metric series or substitutes an average for daily steps', () => {
    const rows = empty();
    rows.metrics = [{ metric_name: 'steps', metric_date: '2026-10-20', avg_value: 123, unit: 'count' }];
    expect(values(rows).steps).toBe('Unavailable');
    rows.metrics = ['steps', 'step_count'].map(metric_name => ({ metric_name, metric_date: '2026-10-20', value: 50, unit: 'count' }));
    expect(values(rows).steps).toBe('Unavailable');
  });
});

describe('Health catalogue views', () => {
  it('groups arbitrary catalogue metrics by category and keeps units separate', () => {
    const records = empty();
    records.catalog = [
      { metric_name: 'synthetic_a', category: 'body', units: ['kg', 'lb'] },
      { metric_name: 'synthetic_b', category: 'activity', units: ['count'] },
      { metric_name: 'synthetic_c', category: 'sleep', units: ['h'] },
      { metric_name: 'synthetic_d', category: 'nutrition', units: ['g'] },
      { metric_name: 'synthetic_e', category: 'workouts', units: ['min'] },
    ];
    records.metrics = records.catalog.flatMap(row => (row.units as string[]).map(unit => ({
      metric_name: row.metric_name!, metric_date: '2026-10-20', unit, value: 12,
    })));
    expect(categoryTiles(records, 'body').map(tile => tile.unit)).toEqual(['kg', 'lb']);
    for (const tab of ['activity', 'sleep', 'nutrition', 'workouts'] as const) {
      expect(categoryTiles(records, tab)).toHaveLength(1);
    }
    expect(categoryTiles(records, 'all')).toHaveLength(6);
  });

  it('keeps uncategorised and unrecognised metrics in All data, without guessing', () => {
    const records = empty();
    records.catalog = [{ metric_name: 'synthetic_metric', units: ['kg'] }];
    records.metrics = [{ metric_name: 'synthetic_metric', metric_date: '2026-10-20', unit: 'kg', value: 0 }];
    expect(categoryTiles(records, 'body')).toEqual([]);
    expect(categoryTiles(records, 'all')[0]).toMatchObject({ value: 0, unit: 'kg', date: '2026-10-20' });
    expect(metricTiles([{ ...records.metrics[0], metric_date: 'invalid' }], records.catalog)).toEqual([]);
  });

  it('shows the latest sample including unavailable values, not an older usable value', () => {
    const metrics = [
      { metric_name: 'synthetic_metric', metric_date: '2026-10-20', value: null, unit: 'g' },
      { metric_name: 'synthetic_metric', metric_date: '2026-10-19', value: 10, unit: 'g' },
    ];
    expect(metricTiles(metrics, [])[0]).toMatchObject({ value: 'Unavailable', date: '2026-10-20' });
    expect(metricTiles([{ ...metrics[1], value: null, avg_value: 5 }], [])[0]?.value).toBe(5);
  });

  it('adds received sleep, workout and nutrition fields with source units and dates', () => {
    const records = empty();
    records.sleep = [{ sleep_date: '2026-10-20', asleep_hours: 7, rem_hours: null }];
    records.workouts = [{ workout_date: '2026-10-20', duration_seconds: 1800, distance_value: 5, distance_unit: 'km' }];
    records.nutrition = [{ meal_date: '2026-10-20', energy_kcal: 500, protein_grams: 30, meal_count: 1 }];
    expect(categoryTiles(records, 'sleep')).toEqual(expect.arrayContaining([expect.objectContaining({ value: 7, unit: 'h' })]));
    expect(categoryTiles(records, 'workouts')).toEqual(expect.arrayContaining([expect.objectContaining({ value: 5, unit: 'km' })]));
    expect(categoryTiles(records, 'nutrition')).toEqual(expect.arrayContaining([expect.objectContaining({ value: 30, unit: 'g' })]));
    expect(categoryTiles(records, 'all')).toHaveLength(7);
  });
});

describe('Health weekly targets and sync', () => {
  const workouts = [
    { workout_date: '2026-10-18', workout_type: 'Running' },
    { workout_date: '2026-10-19', workout_type: 'traditional_strength_training' },
    { workout_date: '2026-10-20', workout_type: 'HKWorkoutActivityTypeRunning' },
    { workout_date: '2026-10-21', workout_type: 'Running' },
  ];
  it('counts only received sessions in this week and clamps remaining sessions at zero', () => {
    expect(weeklyProgress(workouts, 3, 'gym', now)).toEqual({ done: 1, target: 3, remaining: 2, days: 6 });
    expect(weeklyProgress(workouts, 0, 'run', now)).toEqual({ done: 1, target: 0, remaining: 0, days: 6 });
    expect(weeklyProgress([], 2, 'gym', new Date('2026-10-25T12:00:00Z')).days).toBe(1);
    expect(weeklyProgress([], 2, 'gym', new Date('2026-10-26T12:00:00Z')).days).toBe(7);
  });
  it('does not turn absent or invalid targets into defaults', () => {
    for (const target of [null, undefined, -1, 1.5, Number.NaN]) {
      expect(weeklyProgress(workouts, target, 'gym', now)).toMatchObject({ target: null, remaining: null });
    }
  });
  it('uses upload evidence from sync, never a read time or heartbeat', () => {
    expect(syncStatus([{ heartbeat: { last_received_at: now.toISOString() } }], now)).toBe('No sync received');
    expect(syncStatus([{ feeds: [
      { accepted_evidence_at: 'invalid' },
      { accepted_evidence_at: '2026-10-20T10:00:00Z' },
      { accepted_evidence_at: '2026-10-20T11:30:00Z' },
    ] }], now)).toBe('Last synced 30 min ago');
    expect(syncStatus([{ feeds: [{ accepted_evidence_at: '2026-10-20T13:00:00Z' }] }], now)).toContain('ahead');
  });
});
