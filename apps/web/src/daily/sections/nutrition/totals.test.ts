import { describe, expect, it } from 'vitest';
import { chartLayout } from '../../../chart-data';
import { dateStep, groupedMeals, mealDate, planItems, proteinTargetComparison, sumNutrient, targetBaseline, trendSeries, weeklyAverages, type Row } from './totals';

const meal = (overrides: Row = {}): Row => ({
  id: 'synthetic-meal-9001', meal_date: '2026-10-18', occurred_at: '2026-10-18T09:00:00Z',
  energy_kcal: 9001, protein_grams: 9002, deleted_at: null, ...overrides,
});
describe('nutrition totals', () => {
  it('keeps all-null and no-meal totals unknown, not zero', () => {
    expect(sumNutrient([], 'energy_kcal')).toEqual({ value: null, missing: 0, count: 0 });
    expect(sumNutrient([meal({ energy_kcal: null })], 'energy_kcal')).toEqual({ value: null, missing: 1, count: 1 });
  });
  it('sums complete and partial values and retains recorded zero', () => {
    expect(sumNutrient([meal(), meal()], 'energy_kcal')).toEqual({ value: 18002, missing: 0, count: 2 });
    expect(sumNutrient([meal({ energy_kcal: 0 }), meal({ energy_kcal: null })], 'energy_kcal')).toEqual({ value: 0, missing: 1, count: 2 });
  });
  it('excludes deleted rows', () => {
    expect(sumNutrient([meal(), meal({ deleted_at: '2026-10-18T12:00:00Z' })], 'energy_kcal').value).toBe(9001);
    expect(groupedMeals([meal({ deleted_at: '2026-10-18T12:00:00Z' })])).toEqual([]);
  });
  it('uses stored dates, falling back to Copenhagen across midnight and DST', () => {
    expect(mealDate(meal({ meal_date: null, occurred_at: '2026-10-17T23:30:00Z' }))).toBe('2026-10-18');
    expect(mealDate(meal({ meal_date: null, occurred_at: '2026-10-25T23:30:00Z' }))).toBe('2026-10-26');
    expect(mealDate(meal({ occurred_at: '2026-10-17T23:30:00Z' }))).toBe('2026-10-18');
    expect(dateStep('2026-10-25', 1)).toBe('2026-10-26');
  });
  it('groups known types and Other, sorted by actual instant', () => {
    const groups = groupedMeals([
      meal({ id: 'synthetic-9002', meal_type: 'breakfast', occurred_at: '2026-10-18T09:30:00+02:00' }),
      meal({ id: 'synthetic-9003', meal_type: 'breakfast', occurred_at: '2026-10-18T07:00:00Z' }),
      meal({ meal_type: 'synthetic-unknown' }),
    ]);
    expect(groups.map(([group]) => group)).toEqual(['Breakfast', 'Other']);
    expect(groups[0]?.[1].map(row => row.id)).toEqual(['synthetic-9003', 'synthetic-9002']);
  });
  it.each([
    [null, null, null], [9001, null, null], [null, 9002, null], [9003, 9001, 2],
  ])('requires both resting %s and deficit %s; protein is independent', (resting, deficit, expected) => {
    for (const protein of [null, 9004]) expect(targetBaseline({ restingKcal: resting, deficitKcal: deficit, proteinGrams: protein })).toBe(expected);
  });
  it('compares protein only with a set target, preserving unknowns, partial intake, and capped progress', () => {
    expect(proteinTargetComparison([meal()], null)).toBeNull();
    expect(proteinTargetComparison([meal({ protein_grams: null })], 9004))
      .toEqual({ value: null, missing: 1, count: 1, target: 9004, progressValue: null });
    expect(proteinTargetComparison([meal(), meal({ protein_grams: null })], 9004))
      .toEqual({ value: 9002, missing: 1, count: 2, target: 9004, progressValue: 9002 });
    expect(proteinTargetComparison([meal(), meal(), meal({ deleted_at: '2026-10-18T12:00:00Z' })], 9004))
      .toEqual({ value: 18004, missing: 0, count: 2, target: 9004, progressValue: 9004 });
  });
  it('averages Monday weeks using each nutrient known logged-day denominator', () => {
    const weeks = weeklyAverages([
      meal({ meal_date: '2026-10-18', meal_count: 9001, energy_kcal: 9001, protein_grams: null }),
      meal({ meal_date: '2026-10-17', meal_count: 9002, energy_kcal: 9003, protein_grams: 9004 }),
      meal({ meal_date: '2026-10-19', meal_count: 9001, energy_kcal: null }),
      meal({ meal_date: '2026-10-20', meal_count: 0 }),
    ]);
    expect(weeks.map(week => week.week)).toEqual(['2026-10-12', '2026-10-19']);
    expect(weeks[0]?.values[0]).toMatchObject({ value: 9002, count: 2, partial: false });
    expect(weeks[0]?.values[1]).toMatchObject({ value: 9004, count: 1, partial: true });
    expect(weeks[1]?.values[0]?.value).toBeNull();
  });
  it('splits at unlogged and unknown days and aligns flat target dates', () => {
    const rows = [
      meal({ meal_date: '2026-10-11', energy_kcal: null }),
      meal({ meal_date: '2026-10-12' }),
      meal({ meal_date: '2026-10-14' }),
      meal({ meal_date: '2026-10-15', energy_kcal: null }),
      meal({ meal_date: '2026-10-16' }),
    ];
    const runs = trendSeries(rows, 'energy_kcal', 9005);
    expect(runs[0]?.name).toBe('Resting burn minus deficit (before activity)');
    expect(runs.filter(run => run.points.length)).toHaveLength(4);
    expect(runs[0]?.points.map(point => point.x)).toEqual(rows.map(row => row.meal_date));
    expect(chartLayout(runs).categories).toEqual(rows.map(row => row.meal_date));
    expect(runs[0]?.points.every(point => point.y === 9005)).toBe(true);
    expect(runs.slice(1).filter(run => run.points.length).every(run => run.points.length === 1)).toBe(true);
    const noTarget = trendSeries(rows, 'energy_kcal', null);
    expect(noTarget.filter(run => run.points.length)).toHaveLength(3);
    expect(chartLayout(noTarget).categories).toEqual(['2026-10-12', '2026-10-14', '2026-10-16']);
    for (const series of [runs, noTarget]) {
      expect(series.flatMap((run, index) => run.name.startsWith('Recorded') ? [index % 2] : []).every(index => index === 1)).toBe(true);
    }
  });
  it('derives null-aware plan totals from stored item nutrients instead of trusting cached totals', () => {
    const items = planItems([
      { mealKey: 'synthetic-plan-item-9001', name: 'Synthetic plan item 9001', slot: 'breakfast',
        favoriteId: 'synthetic-favorite-9001', components: [], provenance: { source: 'synthetic-label-9001' },
        nutrients: { energyKcal: 9001, proteinGrams: null, carbohydratesGrams: null, fatGrams: null, fiberGrams: null } },
      { name: 'Synthetic plan item 9002', nutrients: { energyKcal: 9002, proteinGrams: 9003 } },
    ])!;
    expect(sumNutrient(items, 'energy_kcal')).toEqual({ value: 18003, missing: 0, count: 2 });
    expect(sumNutrient(items, 'protein_grams')).toEqual({ value: 9003, missing: 1, count: 2 });
    expect(sumNutrient(items, 'fat_grams')).toEqual({ value: null, missing: 2, count: 2 });
    expect(planItems('synthetic malformed JSON')).toBeNull();
    expect(planItems('[{"energy_kcal":9004}]')?.[0]?.energy_kcal).toBe(9004);
  });
});
