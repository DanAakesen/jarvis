import { describe, expect, it } from 'vitest';
import { readMealTotal, readMetric, readProfile } from './evidence.js';
describe('mapped coaching evidence, synthetic rows only', () => {
  const metric = { metric_date: '2026-10-15', metric_name: 'weight', value: 90, unit: 'kg', ingestion_id: 'synthetic' };
  it('preserves zero and missing units without selecting conflicting aliases or converting twice', () => {
    expect(readMetric([{ ...metric, value: 0 }], metric.metric_date, ['weight'], 'kg')).toMatchObject({ value: 0, coverage: 'partial' });
    expect(readMetric([{ ...metric, unit: null }], metric.metric_date, ['weight'], 'kg')).toMatchObject({ value: null, coverage: 'missing' });
    expect(() => readMetric([{ ...metric, unit: 'lb' }], metric.metric_date, ['weight'], 'kg')).toThrow();
    expect(() => readMetric([metric, { ...metric, metric_name: 'body_mass', value: 91 }], metric.metric_date, ['weight', 'body_mass'], 'kg')).toThrow('Conflicting');
  });
  it('excludes tombstones, propagates unknown nutrients and never treats an absent/partial meal list as complete', () => {
    const row = { meal_date: '2026-10-15', energy_kcal: 100, protein_grams: null, deleted_at: null };
    expect(readMealTotal([], row.meal_date, 'energy_kcal')).toMatchObject({ value: null, coverage: 'missing' });
    expect(readMealTotal([row, { ...row, energy_kcal: 999, deleted_at: '2026-10-15' }], row.meal_date, 'energy_kcal')).toMatchObject({ value: 100, coverage: 'partial' });
    expect(readMealTotal([row], row.meal_date, 'protein_grams')).toMatchObject({ value: null, coverage: 'partial' });
  });
  it('maps only existing policy fields and does not expose birth date or invent a profile', () => {
    expect(readProfile(null)).toBeNull();
    expect(readProfile({ deficit_rate: 0.2, protein_minimum_grams: 180, protein_per_kg: 2, steps_target: '8000',
      sleep_target_hours: 7, coaching_intensity: 'direct', profanity_preference: 'natural', date_of_birth: '2000-01-01' })).toEqual({
      deficitRate: 0.2, proteinMinimumGrams: 180, proteinPerKg: 2, stepsTarget: 8000, sleepTargetHours: 7, coachingIntensity: 'direct', profanityPreference: 'natural',
    });
  });
});
