import { describe, expect, it } from 'vitest';
import { foodLookupComponents, foodLookupInputSchema, foodLookupSchema } from './lookup-schema.js';

const component = { name: 'Synthetic food', grams: 100, preparationMethod: null };
describe('shared public food lookup inputs', () => {
  it('preserves explicit unknown quantities and preparation without defaults or invented amounts', () => {
    const input = { components: [{ ...component, grams: null }] };
    expect(foodLookupSchema.parse(input)).toEqual(input);
    expect(foodLookupComponents.parse(input.components)).toEqual(input.components);
    expect(foodLookupSchema.safeParse({ components: [{ name: 'Synthetic food' }] }).success).toBe(false);
  });
  it.each([0, -1, 5001, Infinity, NaN, '100'])('refuses unsupported grams %s', grams => {
    expect(foodLookupSchema.safeParse({ components: [{ ...component, grams }] }).success).toBe(false);
  });
  it('bounds the collection and exact fields without allowing URLs, owners or credentials', () => {
    expect(foodLookupSchema.safeParse({ components: Array(25).fill(component) }).success).toBe(true);
    expect(foodLookupSchema.safeParse({ components: [] }).success).toBe(false);
    expect(foodLookupSchema.safeParse({ components: Array(26).fill(component) }).success).toBe(false);
    for (const key of ['owner', 'url', 'token', 'confirmed']) {
      expect(foodLookupSchema.safeParse({ components: [component], [key]: 'untrusted' }).success).toBe(false);
      expect(foodLookupSchema.safeParse({ components: [{ ...component, [key]: 'untrusted' }] }).success).toBe(false);
    }
    expect(foodLookupSchema.safeParse({ components: [{ ...component, name: ' padded ' }] }).success).toBe(false);
  });
  it('emits a single nullable numeric/string type to prevent HTTP null coercion', () => {
    const schema = foodLookupInputSchema as { properties: { components: { items: { properties: Record<string, unknown> } } } };
    const properties = schema.properties.components.items.properties;
    expect(properties.grams).toMatchObject({ type: ['number', 'null'], exclusiveMinimum: 0, maximum: 5000 });
    expect(properties.preparationMethod).toMatchObject({ type: ['string', 'null'], minLength: 1, maxLength: 120 });
    expect(properties.grams).not.toHaveProperty('anyOf');
  });
});
