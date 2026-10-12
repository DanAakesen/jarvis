import { describe, expect, it } from 'vitest';
import { authorizeIntake, canonicalJson, meal, normalizeSearchText, plan, prepareMeal, resolveNutrients, suggest, writeDefinition, writeMeal, type MealInput, type Suggestion } from './model.js';

export const syntheticMeal: MealInput = {
  id: 'synthetic-01', idempotencyKey: 'synthetic-message-01', mealName: 'Synthetic meal', mealType: null,
  components: [], occurredAt: '2026-01-01T23:30:00+01:00', mealDate: '2026-01-01', expiresAt: '2028-01-01T00:00:00Z',
  energyKcal: 123, proteinGrams: null, carbohydratesGrams: null, fatGrams: null, fiberGrams: null,
  captureMethod: 'text', confidence: 'accurate', provenance: { energyKcal: { source: 'user-exact', unit: 'kcal' } },
};
describe('nutrition evidence and budgets', () => {
  it('matches legacy accent/punctuation search normalization without altering display text', () => {
    expect(normalizeSearchText('  Crème-BRÛLÉE / Dinner! ')).toBe('creme brulee dinner');
    expect(normalizeSearchText('MÝ Raw.Alias')).toBe('my raw alias');
  });
  it.each([
    { mealType: 'supper' }, { energyKcal: -1 }, { energyKcal: 10001 }, { proteinGrams: 1001 },
    { carbohydratesGrams: 1001 }, { fatGrams: 1001 }, { fiberGrams: 1001 },
    { occurredAt: '2026-10-12T15:05:00.001Z', mealDate: '2026-10-12' }, { mealDate: '2026-01-02' },
  ])('rejects invalid new writes %j', (patch) => {
    expect(() => writeMeal({ ...syntheticMeal, ...patch }, '2026-10-12T15:00:00Z')).toThrow();
  });
  it('accepts historical/null writes and inclusive caps/time grace while keeping plan totals uncapped', () => {
    expect(() => writeMeal(syntheticMeal, '2026-10-12T15:00:00Z')).not.toThrow();
    expect(() => writeMeal({ ...syntheticMeal, occurredAt: '2026-10-12T15:05:00Z', mealDate: '2026-10-12', mealType: 'other', energyKcal: 10000, proteinGrams: 1000 }, '2026-10-12T15:00:00Z')).not.toThrow();
    expect(() => writeDefinition({ ...syntheticMeal, mealType: 'snack' })).not.toThrow();
    const large = { ...syntheticMeal, energyKcal: 10000 };
    expect(() => plan({ id: 'plan', name: 'Large plan', description: null, items: [1,2,3].map((id) => ({ mealKey: String(id), name: 'Meal', nutrients: large })), energyKcal: 30000, proteinGrams: null, carbohydratesGrams: null, fatGrams: null, fiberGrams: null })).not.toThrow();
    // Read-side/import shapes do not apply new-write caps or meal-type policy.
    expect(() => meal({ ...syntheticMeal, energyKcal: 10001, mealType: 'legacy-type' })).not.toThrow();
  });
  it('defaults occurrence to trusted request time/Copenhagen date and keeps missing macros null', () => {
    const input = { id: syntheticMeal.id, idempotencyKey: syntheticMeal.idempotencyKey, mealName: syntheticMeal.mealName, mealType: null,
      components: [], provenance: {}, energyKcal: syntheticMeal.energyKcal, confidence: syntheticMeal.confidence, captureMethod: syntheticMeal.captureMethod };
    const result = prepareMeal(input, '2026-10-12T23:30:00Z');
    expect(result).toMatchObject({ occurredAt: '2026-10-12T23:30:00Z', mealDate: '2026-10-13', proteinGrams: null });
    expect(prepareMeal({ ...input, occurredAt: syntheticMeal.occurredAt, mealDate: syntheticMeal.mealDate }, '2026-10-12T23:30:00Z')).toMatchObject({ occurredAt: syntheticMeal.occurredAt, mealDate: syntheticMeal.mealDate });
  });
  it.each(['accurate','approximate','estimate'] as const)('preserves imported %s/mixed vocabulary', (confidence) => {
    const input = { ...syntheticMeal, confidence, captureMethod: 'mixed' as const }; meal(input); expect(input.confidence).toBe(confidence);
  });
  it('canonicalizes only JSON object order and rejects silent value loss/deep payloads', () => {
    expect(canonicalJson({ b: 1, a: [null, { d: 2, c: 3 }] })).toBe(canonicalJson({ a: [null, { c: 3, d: 2 }], b: 1 }));
    for (const value of [{ x: undefined }, [NaN], { x: 1n }, new Date()]) expect(() => canonicalJson(value)).toThrow();
    let deep: unknown = null; for (let i = 0; i < 18; i++) deep = [deep];
    expect(() => canonicalJson(deep)).toThrow('limits');
  });
  it('gives exact user quantities priority and never fills absent macros with zero', () => {
    const result = resolveNutrients({ energyKcal: 321, proteinGrams: null }, { ...syntheticMeal, energyKcal: 999, proteinGrams: 80, fatGrams: 10 });
    expect(result.values).toEqual({ energyKcal: 321, proteinGrams: null, carbohydratesGrams: null, fatGrams: 10, fiberGrams: null });
    expect(result.provenance.energyKcal).toEqual({ source: 'user-exact', unit: 'kcal' });
    expect(result.provenance.carbohydratesGrams?.source).toBe('unknown');
    expect(resolveNutrients({ energyKcal: 321 }, null).values.proteinGrams).toBeNull();
    expect(() => resolveNutrients({}, null)).toThrow('calorie quantity');
    expect(() => resolveNutrients({ energyKcal: 321, proteinGrams: undefined }, null)).toThrow();
  });
  it('keeps unknown plan totals unknown and rejects fabricated totals', () => {
    const input = { id: 'plan', name: 'Plan', description: null, items: [{ mealKey: 'meal', name: 'Meal', nutrients: syntheticMeal }],
      energyKcal: 123, proteinGrams: null, carbohydratesGrams: null, fatGrams: null, fiberGrams: null };
    expect(() => plan(input)).not.toThrow();
    expect(() => plan({ ...input, proteinGrams: 0 })).toThrow('totals');
    expect(() => plan({ ...input, energyKcal: 1 })).toThrow('totals');
  });
  it('preserves exact values and null unknowns without demanding redundant confirmation', () => {
    const copy = structuredClone(syntheticMeal);
    meal(copy); authorizeIntake(copy, { intent: 'log-intake', explicit: true, estimateAccepted: false, proposalRequired: false });
    expect(copy).toEqual(syntheticMeal);
  });
  it.each(['lookup', 'recommendation', 'plan'] as const)('never treats %s as eaten food', (intent) => {
    expect(() => authorizeIntake(syntheticMeal, { intent, explicit: true, estimateAccepted: true, proposalRequired: false })).toThrow('Suggestions and plans');
  });
  it('requires explicit acceptance of ambiguous/photo estimates', () => {
    const estimated = { ...syntheticMeal, captureMethod: 'photo' as const, confidence: 'estimate' as const };
    expect(() => authorizeIntake(estimated, { intent: 'log-intake', explicit: true, estimateAccepted: false, proposalRequired: true })).toThrow('Confirm');
    expect(() => authorizeIntake(estimated, { intent: 'log-intake', explicit: true, estimateAccepted: true, proposalRequired: true })).not.toThrow();
    expect(() => authorizeIntake(syntheticMeal, { intent: 'log-intake', explicit: false, estimateAccepted: true, proposalRequired: false })).toThrow();
    expect(() => authorizeIntake({ ...syntheticMeal, captureMethod: 'photo' }, { intent: 'log-intake', explicit: true, estimateAccepted: false, proposalRequired: true })).toThrow('Confirm');
  });
  it.each([
    { proteinGrams: undefined }, { energyKcal: NaN }, { fatGrams: -1 }, { mealDate: '2026-02-30' },
    { occurredAt: '2026-01-01' }, { occurredAt: '2026-01-01T24:00:00Z' }, { id: '\ud800' }, { owner: 'other' }, { ownerEmail: 'not-an-owner' }, { components: Array(101).fill({}) },
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
    expect(suggest(candidates, new Set(), { ...context, remainingKcal: -10 })).toEqual([]);
    expect(() => suggest(candidates, new Set(), { ...context, localTime: '07:00' })).toThrow('authoritative time');
  });
});
