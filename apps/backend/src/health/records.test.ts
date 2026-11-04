import { describe, expect, it } from 'vitest';
import { preparePlan, type PlanRequest } from './nutrition/model.js';
import { favoriteFingerprint, projectNutritionRecord } from './records.js';

const favorite = {
  id: 'synthetic-favorite', favorite_name: 'Synthetic favourite', meal_name: 'Synthetic meal', meal_type: null,
  aliases_json: '["Synthetic alias"]', components_json: '[]', nutrient_provenance_json: '{"source":"synthetic"}',
  energy_kcal: 200, protein_grams: 10, carbohydrates_grams: null, fat_grams: null, fiber_grams: null,
  confidence: 'accurate', revision: 1n, created_at: '2026-10-17T00:00:00Z', updated_at: '2026-10-17T00:00:00Z',
  owner_object_id: 'never-expose-owner', private_marker: 'never-expose-marker',
};
const request: PlanRequest = {
  id: 'synthetic-plan', name: 'Synthetic plan', description: null,
  entries: (['breakfast', 'lunch', 'dinner'] as const).map(slot => ({ slot, favoriteId: favorite.id })),
};

describe('shared saved-food projections and plan previews', () => {
  it('projects only the shared whitelist, including real revision strings and unknown nutrients', () => {
    expect(projectNutritionRecord(favorite, 'favorite')).toMatchObject({
      revision: '1', aliases_json: ['Synthetic alias'], nutrient_provenance_json: { source: 'synthetic' }, carbohydrates_grams: null,
    });
    expect(JSON.stringify(projectNutritionRecord(favorite, 'favorite'))).not.toContain('never-expose');
  });
  it('binds source revisions and values without binding private columns or JSON object-key order', () => {
    expect(favoriteFingerprint(favorite)).toBe(favoriteFingerprint({ ...favorite, private_marker: 'different' }));
    expect(favoriteFingerprint(favorite)).not.toBe(favoriteFingerprint({ ...favorite, revision: 2n }));
    expect(favoriteFingerprint(favorite)).not.toBe(favoriteFingerprint({ ...favorite, energy_kcal: 201 }));
    const row = { ...favorite, nutrient_provenance_json: '{"a":1,"b":2}' };
    expect(favoriteFingerprint(row)).toBe(favoriteFingerprint({ ...row, nutrient_provenance_json: '{"b":2,"a":1}' }));
  });
  it('uses exactly the same server plan snapshots and null-preserving totals for review and persistence', () => {
    const plan = preparePlan(request, [favorite]);
    expect(plan).toMatchObject({ energyKcal: 600, proteinGrams: 30, carbohydratesGrams: null, fatGrams: null });
    expect(plan.items).toHaveLength(3);
    expect(plan.items[0]).toMatchObject({ name: 'Synthetic meal', favoriteId: favorite.id, slot: 'breakfast', provenance: { source: 'synthetic' } });
    expect(JSON.stringify(plan)).not.toContain('never-expose');
  });
  it('refuses missing sources, invalid slots, invented totals and non-finite server sums', () => {
    expect(() => preparePlan(request, [])).toThrow('owned favourite');
    expect(() => preparePlan({ ...request, entries: request.entries.slice(0, 2) }, [favorite])).toThrow('definition');
    expect(() => preparePlan({ ...request, entries: request.entries.map(entry => ({ ...entry, slot: 'snack' })) }, [favorite])).toThrow('breakfast');
    expect(() => preparePlan({ ...request, energyKcal: 1 } as PlanRequest, [favorite])).toThrow('definition');
    expect(() => preparePlan(request, [{ ...favorite, energy_kcal: Number.MAX_VALUE }])).toThrow('Invalid nutrient');
  });
  it('preserves date-only history and plan tombstones through the extracted projection', () => {
    expect(projectNutritionRecord({ meal_date: new Date('2026-10-17T00:00:00Z'), revision: 2n }, 'history')).toEqual({ meal_date: '2026-10-17', revision: '2' });
    expect(projectNutritionRecord({ id: 'plan', revision: 3n, deleted_at: '2026-10-17T00:00:00Z', items_json: '[]', owner_object_id: 'private' }, 'plan'))
      .toEqual({ id: 'plan', revision: '3', deleted_at: '2026-10-17T00:00:00Z', items_json: [] });
  });
});
