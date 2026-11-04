import { describe, expect, it } from 'vitest';
import { internalSavedInput, internalSavedInputSchema, savedChangeSchema, savedReadSchema } from './saved-schema.js';

describe('shared saved-food inputs', () => {
  it('preserves existing external operations, defaults, revisions and exact source choice', () => {
    const favorite = savedChangeSchema.parse({ change: {
      operation: 'save_favorite', operationId: 'stable', expectedRevision: '0', name: 'Synthetic',
      definition: { mealName: 'Synthetic meal', confidence: 'estimate', energyKcal: 100 },
    } }).change;
    expect(favorite).toMatchObject({ aliases: [], definition: { mealType: null, proteinGrams: null, components: [] } });
    for (const change of [
      { operation: 'save_plan', operationId: 'stable', expectedRevision: '0', name: 'Synthetic', entries: [
        { slot: 'breakfast', favoriteId: 'a' }, { slot: 'lunch', favoriteId: 'b' }, { slot: 'dinner', favoriteId: 'c' },
      ] },
      { operation: 'delete_plan', id: 'plan', expectedRevision: '1' },
      { operation: 'set_feedback', favoriteId: 'favorite', expectedRevision: '0', preference: null },
    ]) expect(savedChangeSchema.safeParse({ change }).success).toBe(true);
    for (const change of [
      { ...favorite, sourceIdempotencyKey: 'also-a-source' },
      { operation: 'save_favorite', operationId: 'stable', expectedRevision: '0', name: 'Missing source' },
      { operation: 'delete_plan', id: 'plan', expectedRevision: '0' },
      { operation: 'set_feedback', favoriteId: 'favorite', expectedRevision: '9223372036854775807', preference: 'like' },
    ]) expect(savedChangeSchema.safeParse({ change }).success).toBe(false);
  });
  it.each(['owner', 'confirmed', 'operationId', 'provenance', 'confidence'])('rejects caller %s authority', key => {
    expect(internalSavedInput.safeParse({ operation: 'lookup_saved', name: 'Synthetic', [key]: true }).success).toBe(false);
  });
  it('rejects nested claimed confidence and provenance for internal definitions', () => {
    for (const extra of [{ confidence: 'accurate' }, { provenance: { verified: true } }]) {
      expect(internalSavedInput.safeParse({ operation: 'save_favorite', name: 'Synthetic', expectedRevision: '0',
        definition: { mealName: 'Synthetic', energyKcal: 100, ...extra } }).success).toBe(false);
    }
  });
  it('retains zero, null and omitted nutrients, and distinguishes clearing from absence', () => {
    const input = internalSavedInput.parse({ operation: 'save_favorite', name: 'Synthetic', expectedRevision: '0',
      definition: { mealName: 'Synthetic', energyKcal: 0, proteinGrams: null, fatGrams: 0 } });
    expect(input.definition).toMatchObject({ energyKcal: 0, proteinGrams: null, fatGrams: 0, carbohydratesGrams: null });
    expect(internalSavedInput.parse({ operation: 'set_feedback', favoriteId: 'a', expectedRevision: '0', preference: null }).preference).toBeNull();
    expect(internalSavedInput.parse({ operation: 'set_feedback', favoriteId: 'a', expectedRevision: '0' }).preference).toBeUndefined();
  });
  it('uses non-coercing nullable HTTP types, including nullable strings and enums', () => {
    const schema = internalSavedInputSchema as { properties: Record<string, Record<string, unknown>> };
    expect(schema.properties.preference).toMatchObject({ type: ['string', 'null'], enum: ['like', 'dislike', null] });
    expect(schema.properties.description).toMatchObject({ type: ['string', 'null'], maxLength: 4000 });
    const definition = schema.properties.definition as { properties: Record<string, unknown> };
    expect(definition.properties.proteinGrams).toMatchObject({ type: ['number', 'null'], minimum: 0, maximum: 1000 });
    expect(definition.properties.mealType).toMatchObject({ type: ['string', 'null'] });
    expect(definition.properties).not.toHaveProperty('confidence');
  });
  it('bounds exact owned reads and rejects mixed selectors', () => {
    expect(savedReadSchema.safeParse({ operation: 'lookup_saved', name: 'Synthetic', favoriteIds: ['a'] }).success).toBe(false);
    expect(savedReadSchema.safeParse({ operation: 'read_preferences', favoriteIds: [] }).success).toBe(false);
    expect(savedReadSchema.safeParse({ operation: 'read_preferences', favoriteIds: Array(51).fill('a') }).success).toBe(false);
    expect(savedReadSchema.safeParse({ operation: 'lookup_saved', name: ' padded ' }).success).toBe(false);
  });
});
