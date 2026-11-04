import { describe, expect, it } from 'vitest';
import { activeEnergyMetric, deriveBudget, pickActiveEnergy, round1, toCandidate, totalMeals, type ActiveEnergy, type MealTotals } from './budget.js';
import type { NutritionTargets } from './targets.js';

// Synthetic placeholders. They are not anyone's real figures.
const synthetic: NutritionTargets = { restingKcal: 1750, deficitKcal: 350, proteinGrams: 110 };
const today = '2026-10-17';
const now = '2026-10-17T12:00:00.000Z';

const healthRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  metric_name: 'active_energy', metric_date: new Date('2026-10-17T00:00:00.000Z'), unit: 'kcal', value: 312.46,
  min_value: null, avg_value: null, max_value: null, sample_count: '12',
  start_at: '2026-10-17T05:00:00.000Z', end_at: '2026-10-17T11:30:00.000Z', ingestion_id: 'ingestion-1', updated_at: '2026-10-17T11:40:00.000Z',
  ...over,
});
const pick = (rows: readonly Record<string, unknown>[], complete = true) => pickActiveEnergy(rows, { today, now, complete });

describe('round1', () => {
  it('rounds to one decimal and never produces negative zero', () => {
    expect(round1(1712.46)).toBe(1712.5);
    expect(round1(0.1 + 0.2)).toBe(0.3);
    expect(round1(-0.04)).toBe(0);
    expect(Object.is(round1(-0.04), 0)).toBe(true);
    expect(round1(-300.04)).toBe(-300);
  });
});

describe('pickActiveEnergy', () => {
  it('reads only the exact active-energy metric for today and reports where the figure came from', () => {
    expect(activeEnergyMetric).toBe('active_energy');
    expect(pick([healthRow()])).toEqual({
      known: true, kcal: 312.5, sampleCount: 12,
      sourceStartAt: '2026-10-17T05:00:00.000Z', sourceEndAt: '2026-10-17T11:30:00.000Z',
      storedAt: '2026-10-17T11:40:00.000Z', ageMinutes: 20,
    });
  });

  it('accepts a date-only string for the metric date and ignores other days', () => {
    expect(pick([healthRow({ metric_date: '2026-10-17' })])).toMatchObject({ known: true, kcal: 312.5 });
    expect(pick([healthRow({ metric_date: new Date('2026-10-16T00:00:00.000Z') })])).toEqual({ known: false, reason: 'health_no_row_today' });
  });

  it('never counts resting, total or look-alike metrics, so resting energy cannot be counted twice', () => {
    const others = ['basal_energy_burned', 'resting_energy', 'total_energy', 'active_energy_burned', 'Active_Energy', 'active_energy '].map((metric_name) => healthRow({ metric_name }));
    expect(pick(others)).toEqual({ known: false, reason: 'health_no_row_today' });
    expect(pick([...others, healthRow({ value: 100 })])).toMatchObject({ known: true, kcal: 100 });
  });

  it('separates "no row" from "not found yet" and never turns either into zero', () => {
    expect(pick([])).toEqual({ known: false, reason: 'health_no_row_today' });
    expect(pick([], false)).toEqual({ known: false, reason: 'health_scan_incomplete' });
    expect(pick([healthRow({ metric_name: 'step_count' })], false)).toEqual({ known: false, reason: 'health_scan_incomplete' });
  });

  it('uses a row it did find even when the scan stopped early', () => {
    expect(pick([healthRow()], false)).toMatchObject({ known: true, kcal: 312.5 });
  });

  it('keeps a stored zero as a known zero', () => {
    expect(pick([healthRow({ value: 0 })])).toMatchObject({ known: true, kcal: 0 });
  });

  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, '312', {}])('treats value %j as invalid', (value) => {
    expect(pick([healthRow({ value })])).toEqual({ known: false, reason: 'active_energy_invalid' });
  });

  it('treats a duplicated row as invalid rather than choosing one', () => {
    expect(pick([healthRow(), healthRow({ value: 99 })])).toEqual({ known: false, reason: 'active_energy_invalid' });
  });

  it.each([null, undefined, 'kJ', 'count', 'KCAL', ''])('does not trust unit %j', (unit) => {
    expect(pick([healthRow({ unit })])).toEqual({ known: false, reason: 'active_energy_unit_unknown' });
  });

  it('keeps unreadable sample counts and times as null instead of guessing', () => {
    const bare = pick([healthRow({ sample_count: null, start_at: null, end_at: '', updated_at: null })]);
    expect(bare).toEqual({ known: true, kcal: 312.5, sampleCount: null, sourceStartAt: null, sourceEndAt: null, storedAt: null, ageMinutes: null });
    for (const sample_count of ['abc', '-3', '1.5', -3, 1.5, Number.NaN, 2 ** 60]) {
      expect(pick([healthRow({ sample_count })])).toMatchObject({ sampleCount: null });
    }
    expect(pick([healthRow({ sample_count: 7 })])).toMatchObject({ sampleCount: 7 });
    expect(pick([healthRow({ sample_count: 7n })])).toMatchObject({ sampleCount: 7 });
  });

  it('derives age from the stored time, clamps a future time to zero and leaves an unparseable one null', () => {
    expect(pick([healthRow({ updated_at: '2026-10-17T11:59:30.000Z' })])).toMatchObject({ ageMinutes: 0 });
    expect(pick([healthRow({ updated_at: '2026-10-17T13:00:00.000Z' })])).toMatchObject({ ageMinutes: 0 });
    expect(pick([healthRow({ updated_at: '2026-10-17T07:00:00.000Z' })])).toMatchObject({ ageMinutes: 300 });
    expect(pick([healthRow({ updated_at: 'yesterday' })])).toMatchObject({ storedAt: 'yesterday', ageMinutes: null });
  });
});

const meal = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'meal-1', meal_date: new Date('2026-10-17T00:00:00.000Z'), energy_kcal: 400, protein_grams: 30,
  created_at: '2026-10-17T08:00:00.000Z', deleted_at: null, ...over,
});

describe('totalMeals', () => {
  it('totals the day and keeps zero meals as a known, complete zero', () => {
    expect(totalMeals([], true)).toEqual({ meals: 0, complete: true, invalidEnergyMeals: 0, unknownProteinMeals: 0, countedKcal: 0, countedProteinGrams: 0 });
    expect(totalMeals([meal(), meal({ id: 'meal-2', energy_kcal: 250.5, protein_grams: 12.25 })], true)).toEqual({
      meals: 2, complete: true, invalidEnergyMeals: 0, unknownProteinMeals: 0, countedKcal: 650.5, countedProteinGrams: 42.3,
    });
  });

  it('never counts a deleted meal, even as a meal', () => {
    const totals = totalMeals([meal(), meal({ id: 'gone', energy_kcal: 999, protein_grams: 99, deleted_at: '2026-10-17T09:00:00.000Z' })], true);
    expect(totals).toMatchObject({ meals: 1, countedKcal: 400, countedProteinGrams: 30 });
  });

  it('counts unknown protein and invalid energy instead of summing them as zero', () => {
    const totals = totalMeals([
      meal({ protein_grams: null }),
      meal({ protein_grams: undefined }),
      meal({ protein_grams: -1 }),
      meal({ energy_kcal: null }),
      meal({ energy_kcal: -5, protein_grams: 20 }),
      meal({ energy_kcal: Number.NaN, protein_grams: Number.NaN }),
    ], true);
    expect(totals).toEqual({ meals: 6, complete: true, invalidEnergyMeals: 3, unknownProteinMeals: 4, countedKcal: 1200, countedProteinGrams: 50 });
  });

  it('removes float noise and passes the completeness flag straight through', () => {
    expect(totalMeals([meal({ energy_kcal: 0.1 }), meal({ energy_kcal: 0.2 })], false)).toMatchObject({ complete: false, countedKcal: 0.3 });
  });
});

const known = (kcal: number): ActiveEnergy => ({ known: true, kcal, sampleCount: 4, sourceStartAt: null, sourceEndAt: null, storedAt: null, ageMinutes: null });
const unknownBurn: ActiveEnergy = { known: false, reason: 'health_no_row_today' };
const totals = (over: Partial<MealTotals> = {}): MealTotals => ({ meals: 2, complete: true, invalidEnergyMeals: 0, unknownProteinMeals: 0, countedKcal: 900, countedProteinGrams: 40, ...over });

describe('deriveBudget', () => {
  it('works out allowance, kcal left and protein left with no projection of the rest of the day', () => {
    expect(deriveBudget({ targets: synthetic, burn: known(300), meals: totals() })).toEqual({
      kcal: { state: 'ready', reasons: [], restingKcal: 1750, deficitKcal: 350, activeKcal: 300, allowanceKcal: 1700, eatenKcal: 900, remainingKcal: 800 },
      protein: { state: 'ready', reasons: [], targetGrams: 110, eatenKnownGrams: 40, unknownProteinMeals: 0, remainingGrams: 70 },
    });
  });

  it('reports over-budget as a negative figure instead of clamping it', () => {
    const figures = deriveBudget({ targets: synthetic, burn: known(300), meals: totals({ countedKcal: 2000, countedProteinGrams: 150 }) });
    expect(figures.kcal).toMatchObject({ state: 'ready', remainingKcal: -300 });
    expect(figures.protein).toMatchObject({ state: 'ready', remainingGrams: -40 });
  });

  it('treats a deficit of zero as a real value, not as unset', () => {
    const figures = deriveBudget({ targets: { ...synthetic, deficitKcal: 0 }, burn: known(300), meals: totals() });
    expect(figures.kcal).toMatchObject({ state: 'ready', reasons: [], deficitKcal: 0, allowanceKcal: 2050, remainingKcal: 1150 });
  });

  it('treats no logged meals as a known zero', () => {
    const figures = deriveBudget({ targets: synthetic, burn: known(0), meals: totals({ meals: 0, countedKcal: 0, countedProteinGrams: 0 }) });
    expect(figures.kcal).toMatchObject({ state: 'ready', activeKcal: 0, allowanceKcal: 1400, eatenKcal: 0, remainingKcal: 1400 });
    expect(figures.protein).toMatchObject({ state: 'ready', eatenKnownGrams: 0, remainingGrams: 110 });
  });

  it.each([
    ['restingKcal', 'resting_target_not_set'],
    ['deficitKcal', 'deficit_target_not_set'],
  ] as const)('leaves kcal unknown without the %s target and still computes protein', (field, reason) => {
    const figures = deriveBudget({ targets: { ...synthetic, [field]: null }, burn: known(300), meals: totals() });
    expect(figures.kcal).toMatchObject({ state: 'unknown', reasons: [reason], allowanceKcal: null, remainingKcal: null });
    expect(figures.protein).toMatchObject({ state: 'ready', remainingGrams: 70 });
  });

  it('leaves protein unknown without a protein target and still computes kcal', () => {
    const figures = deriveBudget({ targets: { ...synthetic, proteinGrams: null }, burn: known(300), meals: totals() });
    expect(figures.protein).toEqual({ state: 'unknown', reasons: ['protein_target_not_set'], targetGrams: null, eatenKnownGrams: 40, unknownProteinMeals: 0, remainingGrams: null });
    expect(figures.kcal).toMatchObject({ state: 'ready', remainingKcal: 800 });
  });

  it('leaves kcal unknown without a burn reading, never treating the burn as zero', () => {
    const figures = deriveBudget({ targets: synthetic, burn: unknownBurn, meals: totals() });
    expect(figures.kcal).toEqual({
      state: 'unknown', reasons: ['active_energy_unknown'], restingKcal: 1750, deficitKcal: 350, activeKcal: null, allowanceKcal: null, eatenKcal: 900, remainingKcal: null,
    });
    expect(figures.protein).toMatchObject({ state: 'ready', remainingGrams: 70 });
  });

  it('keeps the allowance but not the remainder when the day\'s meals were not read to the end', () => {
    const figures = deriveBudget({ targets: synthetic, burn: known(300), meals: totals({ complete: false }) });
    expect(figures.kcal).toMatchObject({ state: 'unknown', reasons: ['meals_incomplete'], allowanceKcal: 1700, eatenKcal: null, remainingKcal: null });
    expect(figures.protein).toEqual({ state: 'unknown', reasons: ['meals_incomplete'], targetGrams: 110, eatenKnownGrams: null, unknownProteinMeals: 0, remainingGrams: null });
  });

  it('leaves kcal unknown when a logged meal has no usable energy', () => {
    const figures = deriveBudget({ targets: synthetic, burn: known(300), meals: totals({ invalidEnergyMeals: 1 }) });
    expect(figures.kcal).toMatchObject({ state: 'unknown', reasons: ['meal_energy_invalid'], allowanceKcal: 1700, eatenKcal: null, remainingKcal: null });
  });

  it('flags protein as partial, an upper bound, when some meals have no protein value', () => {
    const figures = deriveBudget({ targets: synthetic, burn: known(300), meals: totals({ unknownProteinMeals: 1 }) });
    expect(figures.protein).toEqual({ state: 'partial', reasons: ['meal_protein_unknown'], targetGrams: 110, eatenKnownGrams: 40, unknownProteinMeals: 1, remainingGrams: 70 });
    expect(figures.kcal.state).toBe('ready');
  });

  it('lists every reason in a fixed order and never reports a figure it cannot support', () => {
    const figures = deriveBudget({
      targets: { restingKcal: null, deficitKcal: null, proteinGrams: null }, burn: unknownBurn,
      meals: totals({ complete: false, invalidEnergyMeals: 2, unknownProteinMeals: 2 }),
    });
    expect(figures.kcal).toEqual({
      state: 'unknown',
      reasons: ['resting_target_not_set', 'deficit_target_not_set', 'active_energy_unknown', 'meals_incomplete', 'meal_energy_invalid'],
      restingKcal: null, deficitKcal: null, activeKcal: null, allowanceKcal: null, eatenKcal: null, remainingKcal: null,
    });
    expect(figures.protein).toEqual({ state: 'unknown', reasons: ['protein_target_not_set', 'meals_incomplete'], targetGrams: null, eatenKnownGrams: null, unknownProteinMeals: 2, remainingGrams: null });
  });
});

const favourite = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'fav-1', favorite_name: 'Overnight oats', energy_kcal: 350, protein_grams: 18, carbohydrates_grams: 45, fat_grams: 9, fiber_grams: 7,
  owner_object_id: '11111111-1111-4111-8111-111111111111', ...over,
});

describe('toCandidate', () => {
  it('turns a saved favourite into a candidate that is eligible at any time of day', () => {
    expect(toCandidate(favourite())).toEqual({
      mealKey: 'fav-1', name: 'Overnight oats', energyKcal: 350, proteinGrams: 18, carbohydratesGrams: 45, fatGrams: 9, fiberGrams: 7, localTimeWindows: [],
    });
  });

  it('keeps unknown macros null and never fills them with zero', () => {
    expect(toCandidate(favourite({ protein_grams: null, carbohydrates_grams: undefined, fat_grams: null }))).toMatchObject({
      proteinGrams: null, carbohydratesGrams: null, fatGrams: null, fiberGrams: 7,
    });
  });

  it.each([
    ['empty id', { id: '' }],
    ['numeric id', { id: 7 }],
    ['empty name', { favorite_name: '' }],
    ['oversized name', { favorite_name: 'x'.repeat(257) }],
    ['missing energy', { energy_kcal: null }],
    ['text energy', { energy_kcal: '350' }],
    ['negative energy', { energy_kcal: -1 }],
    ['non-finite energy', { energy_kcal: Number.POSITIVE_INFINITY }],
    ['negative protein', { protein_grams: -1 }],
    ['text protein', { protein_grams: '18' }],
  ])('skips a favourite with %s', (_label, over) => {
    expect(toCandidate(favourite(over))).toBeNull();
  });
});
