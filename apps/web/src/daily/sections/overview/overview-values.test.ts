import { describe, expect, it } from 'vitest';
import {
  bodyMetricNames, bodyTrend, calorieBalance, cumulativeProtein, dailyProtein, nutritionForWindow, scaledTarget,
  sleepForWindow, stepsForWindow, windowWorkouts,
} from './overview-values';
import { overviewWindow } from './overview-window';

const today = overviewWindow('today', '2026-10-20');
const week = overviewWindow('week', '2026-10-20');
const day = (date: string, extra: Record<string, unknown> = {}) => ({
  meal_date: date, meal_count: 2, energy_kcal: 1200, protein_grams: 80, partial_nutrients: [], ...extra,
}) as never;

describe('nutritionForWindow', () => {
  it('gives the day total for one date', () => {
    expect(nutritionForWindow([day('2026-10-20'), day('2026-10-19')], today)).toEqual({
      loggedDays: 1, energy: { value: 1200, partial: false }, protein: { value: 80, partial: false },
    });
  });

  it('averages the logged days of a range and skips days without meals', () => {
    const rows = [day('2026-10-19', { energy_kcal: 1000, protein_grams: 60 }), day('2026-10-20', { energy_kcal: 2000, protein_grams: 100 }),
      day('2026-10-18', { meal_count: 0, energy_kcal: 0, protein_grams: 0 })];
    expect(nutritionForWindow(rows, week)).toEqual({
      loggedDays: 2, energy: { value: 1500, partial: false }, protein: { value: 80, partial: false },
    });
  });

  it('flags a lower bound when a nutrient is partial or missing on a day', () => {
    const partial = nutritionForWindow([day('2026-10-20', { partial_nutrients: ['energy_kcal'] })], today);
    expect(partial?.energy.partial).toBe(true);
    expect(partial?.protein.partial).toBe(false);
    const missing = nutritionForWindow([day('2026-10-19'), day('2026-10-20', { protein_grams: null })], week);
    expect(missing?.protein).toEqual({ value: 40, partial: true });
  });

  it('spreads the known amount over every logged day, so an unknown day keeps the average a lower bound', () => {
    const rows = [day('2026-10-19', { protein_grams: 80 }), day('2026-10-20', { protein_grams: null })];
    expect(nutritionForWindow(rows, week)?.protein).toEqual({ value: 40, partial: true });
    expect(nutritionForWindow([day('2026-10-20', { protein_grams: null })], today)?.protein).toEqual({ value: null, partial: true });
  });

  it('is null when nothing was logged', () => {
    expect(nutritionForWindow([], today)).toBeNull();
    expect(nutritionForWindow([day('2026-10-20', { meal_count: 0 })], today)).toBeNull();
  });
});

describe('stepsForWindow', () => {
  it('sums the recorded days', () => {
    const rows = [{ metric_date: '2026-10-19', value: 4000 }, { metric_date: '2026-10-20', value: 2500 }, { metric_date: '2026-10-01', value: 9 }];
    expect(stepsForWindow(rows, week)).toEqual({ total: 6500, days: 2 });
  });

  it('is null without recorded days', () => {
    expect(stepsForWindow([], week)).toBeNull();
  });
});

describe('sleepForWindow', () => {
  it('reads the total when staged exports report zero asleep hours', () => {
    const rows = [{ sleep_date: '2026-10-20', total_sleep_hours: 7.5, asleep_hours: 0 }];
    expect(sleepForWindow(rows, today)).toEqual({ value: 7.5, nights: 1, date: '2026-10-20' });
  });

  it('falls back to asleep hours when there is no total, and ignores a zero fallback', () => {
    expect(sleepForWindow([{ sleep_date: '2026-10-20', asleep_hours: 6 }], today)?.value).toBe(6);
    expect(sleepForWindow([{ sleep_date: '2026-10-20', asleep_hours: 0 }], today)).toBeNull();
  });

  it('shows last night on Today until today has been processed', () => {
    const rows = [{ sleep_date: '2026-10-19', total_sleep_hours: 8 }];
    expect(sleepForWindow(rows, today)).toEqual({ value: 8, nights: 1, date: '2026-10-19' });
  });

  it('needs the exact night for Yesterday and never borrows the night before', () => {
    const yesterday = overviewWindow('yesterday', '2026-10-20');
    expect(sleepForWindow([{ sleep_date: '2026-10-18', total_sleep_hours: 8 }], yesterday)).toBeNull();
    expect(sleepForWindow([{ sleep_date: '2026-10-19', total_sleep_hours: 6.5 }], yesterday))
      .toEqual({ value: 6.5, nights: 1, date: '2026-10-19' });
  });

  it('averages the nights of a range', () => {
    const rows = [{ sleep_date: '2026-10-19', total_sleep_hours: 6 }, { sleep_date: '2026-10-20', total_sleep_hours: 8 }];
    expect(sleepForWindow(rows, week)).toEqual({ value: 7, nights: 2, date: null });
  });
});

describe('cumulativeProtein', () => {
  // 2026-10-20 is still summer time in Copenhagen (UTC+2).
  const meals = [
    { id: 'a', occurred_at: '2026-10-20T07:00:00Z', protein_grams: 30, deleted_at: null },
    { id: 'b', occurred_at: '2026-10-20T18:00:00Z', protein_grams: 40, deleted_at: null },
    { id: 'c', occurred_at: '2026-10-20T10:00:00Z', protein_grams: 500, deleted_at: '2026-10-20T10:30:00Z' },
    { id: 'd', occurred_at: '2026-10-19T10:00:00Z', protein_grams: 500, deleted_at: null },
  ] as never[];

  it('accumulates by Copenhagen hour and leaves future hours empty for the live day', () => {
    const { points, total } = cumulativeProtein(meals, '2026-10-20', 12);
    expect(total).toBe(70);
    expect(points).toHaveLength(24);
    expect(points[8]?.value).toBe(0);
    expect(points[9]?.value).toBe(30);
    expect(points[12]?.value).toBe(30);
    expect(points[13]?.value).toBeNull();
  });

  it('runs to the end of a past day', () => {
    expect(cumulativeProtein(meals, '2026-10-20', null).points[23]?.value).toBe(70);
  });

  it('has no total when no meal carries protein', () => {
    expect(cumulativeProtein([], '2026-10-20', null).total).toBeNull();
  });
});

describe('dailyProtein', () => {
  it('lists every day of the window and leaves unlogged days empty', () => {
    const points = dailyProtein([day('2026-10-19', { protein_grams: 90 }), day('2026-10-20', { meal_count: 0 })], week);
    expect(points).toHaveLength(7);
    expect(points.at(-2)).toEqual({ label: '2026-10-19', value: 90 });
    expect(points.at(-1)).toEqual({ label: '2026-10-20', value: null });
  });
});

describe('windowWorkouts', () => {
  const row = (date: string, extra: Record<string, unknown> = {}) => ({
    workout_date: date, duration_seconds: 1800, active_energy_value: 200, active_energy_unit: 'kcal', ...extra,
  }) as never;

  it('counts zero, not unknown, for an empty window', () => {
    expect(windowWorkouts([row('2026-10-01')], week)).toEqual({
      sessions: 0, durationSeconds: 0, kcal: 0, partialEnergy: false, partialDuration: false,
    });
  });

  it('totals sessions, time and active energy inside the window', () => {
    const rows = [row('2026-10-19'), row('2026-10-20', { duration_seconds: 1200, active_energy_value: 150 }), row('2026-10-01')];
    expect(windowWorkouts(rows, week)).toEqual({
      sessions: 2, durationSeconds: 3000, kcal: 350, partialEnergy: false, partialDuration: false,
    });
  });

  it('marks totals as a lower bound when a session lacks a figure', () => {
    const rows = [row('2026-10-19'), row('2026-10-20', { duration_seconds: null, active_energy_value: null })];
    expect(windowWorkouts(rows, week)).toMatchObject({
      sessions: 2, durationSeconds: 1800, kcal: 200, partialEnergy: true, partialDuration: true,
    });
  });

  it('flags calories and duration separately', () => {
    expect(windowWorkouts([row('2026-10-19', { active_energy_value: null })], week))
      .toMatchObject({ partialEnergy: true, partialDuration: false });
    expect(windowWorkouts([row('2026-10-19', { duration_seconds: null })], week))
      .toMatchObject({ partialEnergy: false, partialDuration: true });
  });
});

describe('calorieBalance', () => {
  it('reports what is left or over', () => {
    expect(calorieBalance({ value: 1200, partial: false }, 1700)).toEqual({ amount: 500, kind: 'left', bound: null });
    expect(calorieBalance({ value: 2000, partial: false }, 1700)).toEqual({ amount: 300, kind: 'over', bound: null });
  });

  it('turns a partial eaten total into an upper bound on left and a lower bound on over', () => {
    expect(calorieBalance({ value: 1200, partial: true }, 1700)?.bound).toBe('at most');
    expect(calorieBalance({ value: 2000, partial: true }, 1700)?.bound).toBe('at least');
  });

  it('is null without a baseline or an eaten value', () => {
    expect(calorieBalance({ value: 1200, partial: false }, null)).toBeNull();
    expect(calorieBalance({ value: null, partial: false }, 1700)).toBeNull();
    expect(calorieBalance(null, 1700)).toBeNull();
  });
});

describe('scaledTarget', () => {
  it('multiplies an owner-set target by the periods and keeps a missing target missing', () => {
    expect(scaledTarget(3, 2)).toBe(6);
    expect(scaledTarget(0, 2)).toBe(0);
    expect(scaledTarget(null, 2)).toBeNull();
  });
});

describe('body measurements', () => {
  it('names only the measurements the catalogue serves', () => {
    const names = bodyMetricNames([{ metric_name: 'body_mass' }, { metric_name: 'step_count' }, { metric_name: 'body_fat_percentage' }]);
    expect(names).toEqual({ weight: 'body_mass', fatPercent: 'body_fat_percentage', leanMass: null });
  });

  it('keeps recorded days in order with the latest reading and the declared unit', () => {
    const rows = [{ metric_date: '2026-10-20', value: 80.4, unit: 'kg' }, { metric_date: '2026-10-10', value: 81.2, unit: 'kg' }];
    expect(bodyTrend(rows, { startDate: '2026-07-23', endDate: '2026-10-20' })).toEqual({
      latest: 80.4, values: [81.2, 80.4], count: 2, unit: 'kg',
    });
    expect(bodyTrend([], { startDate: '2026-07-23', endDate: '2026-10-20' })).toBeNull();
  });

  it('uses one unit, the latest reading\'s, so pounds and kilograms never mix in a value or a sparkline', () => {
    const period = { startDate: '2026-07-23', endDate: '2026-10-20' };
    const rows = [
      { metric_date: '2026-09-01', value: 180, unit: 'lb' }, { metric_date: '2026-09-15', value: 178, unit: 'lb' },
      { metric_date: '2026-10-01', value: 80.9, unit: 'kg' }, { metric_date: '2026-10-20', value: 80.4, unit: 'kg' },
    ];
    expect(bodyTrend(rows, period)).toEqual({ latest: 80.4, values: [80.9, 80.4], count: 2, unit: 'kg' });
    expect(bodyTrend([...rows].reverse(), period)).toEqual({ latest: 80.4, values: [80.9, 80.4], count: 2, unit: 'kg' });
  });
});
