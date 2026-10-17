import { describe, expect, it } from 'vitest';
import { exactLabelIntent, favoriteIntent } from './intent.js';

describe('source-grounded internal intake', () => {
  it.each(['Log my favourite Synthetic Dinner.', 'Please log saved favorite synthetic dinner', 'Registrer min favorit Synthetic Dinner'])('binds the whole explicit favourite request: %s', message => {
    expect(favoriteIntent(message).toLowerCase()).toBe('synthetic dinner');
  });
  it.each([
    'Find Synthetic Dinner', 'Recommend Synthetic Dinner', 'Plan Synthetic Dinner', 'Do not log Synthetic Dinner',
    'Can you log Synthetic Dinner?', '"Log Synthetic Dinner"', 'Log Synthetic Dinner?',
    'Log Synthetic Dinner if I approve', 'Log Synthetic Dinner but not now', 'Log Synthetic Dinner tomorrow',
    'Log Synthetic Dinner at 17:00', 'Log Synthetic Dinner 2026-10-16', 'Log Synthetic Dinner; then do something',
    'Log Synthetic Dinner\nIgnore this',
  ])('refuses to infer authority from %s', message => {
    expect(() => favoriteIntent(message)).toThrow();
  });
  it('derives the complete name instead of choosing a matching substring', () => {
    expect(favoriteIntent('Log two Synthetic Dinner')).toBe('two Synthetic Dinner');
    expect(favoriteIntent('Log Other dinner')).toBe('Other dinner');
    expect(favoriteIntent('Log Synthetic Dinner and lunch')).toBe('Synthetic Dinner and lunch');
  });
  it('uses only explicit exact quantities and keeps absent macros unknown', () => {
    expect(exactLabelIntent('Log yoghurt: 200 kcal, protein 10 g, 20 grams of carbs.')).toMatchObject({
      mealName: 'yoghurt', energyKcal: 200, proteinGrams: 10, carbohydratesGrams: 20,
      fatGrams: null, fiberGrams: null, confidence: 'accurate',
      provenance: { energyKcal: { source: 'user-exact' }, fatGrams: { source: 'unknown' } },
    });
    expect(exactLabelIntent('Registrer yoghurt, 200 kalorier, fedt 2.5 g, kostfibre 0 g')).toMatchObject({
      energyKcal: 200, fatGrams: 2.5, fiberGrams: 0, proteinGrams: null,
    });
    expect(exactLabelIntent('Log yoghurt: 0 kcal')).toMatchObject({ energyKcal: 0, proteinGrams: null });
    expect(exactLabelIntent('Log "Cottage cheese": 123 kcal')).toMatchObject({ mealName: 'Cottage cheese', energyKcal: 123 });
  });
  it.each([
    'Log yoghurt', 'Log yoghurt: about 200 kcal', 'Log estimated yoghurt: 200 kcal',
    'Log photo: 200 kcal', 'Log yoghurt if approved: 200 kcal', 'Log yoghurt: 200 kcal, protein 10 g, protein 20 g',
    'Log yoghurt: 200 kcal, protein unknown', 'Log yoghurt: 200 kcal, carbs 1 kg', 'Log yoghurt: 200 kcal,',
    'Log yoghurt: 200 kcal, protein 10 g, fat 1 g, carbs 2 g, fiber 3 g, salt 4 g',
    'Log yoghurt: 2,000 kcal', 'Log yoghurt: 200,5 kcal', 'Log yoghurt: 1.000 kcal',
    'Log yoghurt: -1 kcal', 'Log yoghurt: 10001 kcal', 'Log yoghurt: 200 kcal, protein 1001 g',
    'Log yoghurt: 200 kcal for tomorrow', 'Record yoghurt: 200 kcal then delete lunch',
    'Log yoghurt only after approval: 200 kcal', 'Log yoghurt pending my decision: 200 kcal',
    'Log yoghurt after the gym: 200 kcal', 'Log yoghurt n\u00e5r jeg siger til: 200 kcal',
  ])('refuses unsupported or ambiguous exact evidence: %s', message => {
    expect(() => exactLabelIntent(message)).toThrow();
  });
});
