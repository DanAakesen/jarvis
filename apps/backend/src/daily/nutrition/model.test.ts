import { describe, expect, it } from 'vitest';
import { authorizeIntake, meal, suggest, type MealInput, type Suggestion } from './model.js';

export const syntheticMeal: MealInput = {
  id: 'synthetic-01', idempotencyKey: 'synthetic-message-01', mealName: 'Synthetic meal', mealType: null,
  components: [], occurredAt: '2026-01-01T23:30:00+01:00', mealDate: '2026-01-01', expiresAt: '2028-01-01T00:00:00Z',
  energyKcal: 123, proteinGrams: null, carbohydratesGrams: null, fatGrams: null, fiberGrams: null,
  captureMethod: 'text', confidence: 'exact', provenance: { energyKcal: { source: 'user-exact', unit: 'kcal' } },
};
describe('nutrition evidence and budgets', () => {
  it('preserves exact values and null unknowns without demanding redundant confirmation', () => {
    const copy = structuredClone(syntheticMeal);
    meal(copy); authorizeIntake(copy, { intent: 'log-intake', explicit: true, estimateAccepted: false });
    expect(copy).toEqual(syntheticMeal);
  });
  it.each(['lookup', 'recommendation', 'plan'] as const)('never treats %s as eaten food', (intent) => {
    expect(() => authorizeIntake(syntheticMeal, { intent, explicit: true, estimateAccepted: true })).toThrow('Suggestions and plans');
  });
  it('requires explicit acceptance of ambiguous/photo estimates', () => {
    const estimated = { ...syntheticMeal, captureMethod: 'photo' as const, confidence: 'estimate' as const };
    expect(() => authorizeIntake(estimated, { intent: 'log-intake', explicit: true, estimateAccepted: false })).toThrow('Confirm');
    expect(() => authorizeIntake(estimated, { intent: 'log-intake', explicit: true, estimateAccepted: true })).not.toThrow();
    expect(() => authorizeIntake(syntheticMeal, { intent: 'log-intake', explicit: false, estimateAccepted: true })).toThrow();
  });
  it.each([
    { proteinGrams: undefined }, { energyKcal: NaN }, { fatGrams: -1 }, { mealDate: '2026-02-30' },
    { occurredAt: '2026-01-01' }, { owner: 'other' }, { ownerEmail: 'not-an-owner' }, { components: Array(101).fill({}) },
  ])('rejects unsafe shapes %j', (patch) => {
    expect(() => meal({ ...syntheticMeal, ...patch } as MealInput)).toThrow();
  });
  it('uses authoritative remaining budgets, local windows and persistent dislikes without fabricated meals', () => {
    const candidate = (mealKey: string, energyKcal: number, proteinGrams: number | null, from = '18:00', to = '23:00'): Suggestion => ({
      ...syntheticMeal, mealKey, name: mealKey, energyKcal, proteinGrams, localTimeWindows: [{ from, to }],
    });
    const candidates = [candidate('disliked', 100, 20), candidate('morning', 100, 20, '06:00', '11:00'), candidate('over', 501, 30), candidate('unknown', 300, null), candidate('fit', 400, 30)];
    const context = { now: '2026-10-12T18:00:00+02:00', localTime: '18:00', remainingKcal: 500, remainingProteinGrams: 30 };
    expect(suggest(candidates, new Set(['disliked']), context).map((x) => x.mealKey)).toEqual(['fit', 'unknown']);
    expect(suggest(candidates, new Set(['disliked']), { ...context, remainingKcal: null, remainingProteinGrams: null }).map((x) => x.mealKey)).toEqual(['over', 'unknown', 'fit']);
    expect(suggest([], new Set(), context)).toEqual([]);
  });
});
