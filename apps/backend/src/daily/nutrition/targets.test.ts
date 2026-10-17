import { describe, expect, it } from 'vitest';
import {
  changedNutritionTargets, emptyNutritionTargets, isNutritionTargetField, nutritionTargetBounds, nutritionTargetFields,
  nutritionTargetKey, parseNutritionTargetsPatch, parseStoredNutritionTarget, presentNutritionTargets,
  type NutritionTargets,
} from './targets.js';

// Synthetic placeholders. They are not anyone's real figures.
const owner = 'abcdef01-2345-4678-89ab-cdef01234567';
const synthetic: NutritionTargets = { restingKcal: 1750, deficitKcal: 350, proteinGrams: 110 };
const databaseKey = /^[a-z][-a-z0-9._]*$/u;

describe('nutrition target bounds', () => {
  it('are fixed, ordered and frozen so nothing can drift at runtime', () => {
    expect(nutritionTargetFields).toEqual(['restingKcal', 'deficitKcal', 'proteinGrams']);
    expect(Object.isFrozen(nutritionTargetBounds)).toBe(true);
    for (const field of nutritionTargetFields) {
      const range = nutritionTargetBounds[field];
      expect(Object.isFrozen(range)).toBe(true);
      expect(range.min).toBeLessThan(range.max);
      expect(range.label.length).toBeGreaterThan(0);
    }
    expect(Object.isFrozen(emptyNutritionTargets)).toBe(true);
    expect(Object.values(emptyNutritionTargets)).toEqual([null, null, null]);
  });

  it('recognises only the three known fields', () => {
    expect(nutritionTargetFields.every(isNutritionTargetField)).toBe(true);
    for (const other of ['bmr', 'tdee', 'weightKg', '__proto__', 'constructor', '', 'RestingKcal']) {
      expect(isNutritionTargetField(other)).toBe(false);
    }
  });
});

describe('nutritionTargetKey', () => {
  it('returns one lower-case, owner-namespaced key per field that the settings table accepts', () => {
    const keys = nutritionTargetFields.map((field) => nutritionTargetKey(owner.toUpperCase(), field));
    expect(keys).toEqual([
      `daily.nutrition.${owner}.resting-kcal`,
      `daily.nutrition.${owner}.deficit-kcal`,
      `daily.nutrition.${owner}.protein-grams`,
    ]);
    expect(new Set(keys).size).toBe(3);
    for (const key of keys) {
      expect(key).toMatch(databaseKey);
      expect(key.length).toBeLessThanOrEqual(128);
    }
  });

  it('keeps two owners apart', () => {
    const other = '99999999-9999-4999-8999-999999999999';
    expect(nutritionTargetKey(other, 'restingKcal')).not.toBe(nutritionTargetKey(owner, 'restingKcal'));
  });

  it.each([
    '', 'owner', 'not-a-guid', `${owner}.extra`, `{${owner}}`, ` ${owner}`, `${owner}\n`, 'x'.repeat(200),
    '%', `${owner.slice(0, 35)}%`, `${owner.slice(0, 35)}g`,
  ])('fails closed for an unusable owner id (%j)', (bad) => {
    expect(() => nutritionTargetKey(bad, 'restingKcal')).toThrow(TypeError);
  });

  it('fails closed when the owner id is not a string', () => {
    expect(() => nutritionTargetKey(undefined as unknown as string, 'restingKcal')).toThrow(TypeError);
    expect(() => nutritionTargetKey(null as unknown as string, 'restingKcal')).toThrow(TypeError);
  });
});

describe('parseStoredNutritionTarget', () => {
  it('reads a stored whole number inside the range', () => {
    expect(parseStoredNutritionTarget('restingKcal', '1750')).toBe(1750);
    expect(parseStoredNutritionTarget('deficitKcal', '0')).toBe(0);
    expect(parseStoredNutritionTarget('proteinGrams', String(nutritionTargetBounds.proteinGrams.max))).toBe(nutritionTargetBounds.proteinGrams.max);
  });

  it.each([
    ['restingKcal', String(nutritionTargetBounds.restingKcal.min - 1)],
    ['restingKcal', String(nutritionTargetBounds.restingKcal.max + 1)],
    ['deficitKcal', '-1'],
    ['proteinGrams', '12.5'],
    ['proteinGrams', '"110"'],
    ['proteinGrams', 'null'],
    ['proteinGrams', 'true'],
    ['proteinGrams', '[110]'],
    ['proteinGrams', '{"value":110}'],
    ['proteinGrams', 'not json'],
    ['proteinGrams', ''],
    ['proteinGrams', '9'.repeat(40)],
  ] as const)('reads a malformed or out-of-range %s row (%j) as unset', (field, stored) => {
    expect(parseStoredNutritionTarget(field, stored)).toBeNull();
  });

  it('reads a non-text value as unset', () => {
    expect(parseStoredNutritionTarget('restingKcal', 1750)).toBeNull();
    expect(parseStoredNutritionTarget('restingKcal', null)).toBeNull();
    expect(parseStoredNutritionTarget('restingKcal', undefined)).toBeNull();
  });
});

describe('parseNutritionTargetsPatch', () => {
  it('accepts a partial update of whole numbers in range', () => {
    expect(parseNutritionTargetsPatch({ restingKcal: 1750 })).toEqual({ ok: true, patch: { restingKcal: 1750 } });
    expect(parseNutritionTargetsPatch(synthetic)).toEqual({ ok: true, patch: synthetic });
  });

  it('accepts null to clear a target', () => {
    expect(parseNutritionTargetsPatch({ proteinGrams: null })).toEqual({ ok: true, patch: { proteinGrams: null } });
    expect(parseNutritionTargetsPatch({ restingKcal: null, deficitKcal: null, proteinGrams: null })).toMatchObject({ ok: true });
  });

  it('accepts exactly the bounds and nothing beyond them', () => {
    for (const field of nutritionTargetFields) {
      const { min, max } = nutritionTargetBounds[field];
      expect(parseNutritionTargetsPatch({ [field]: min })).toEqual({ ok: true, patch: { [field]: min } });
      expect(parseNutritionTargetsPatch({ [field]: max })).toEqual({ ok: true, patch: { [field]: max } });
      expect(parseNutritionTargetsPatch({ [field]: min - 1 })).toMatchObject({ ok: false });
      expect(parseNutritionTargetsPatch({ [field]: max + 1 })).toMatchObject({ ok: false });
    }
  });

  it('accepts a null-prototype object', () => {
    const value = Object.assign(Object.create(null) as Record<string, unknown>, { deficitKcal: 350 });
    expect(parseNutritionTargetsPatch(value)).toEqual({ ok: true, patch: { deficitKcal: 350 } });
  });

  it.each([
    ['null', null], ['undefined', undefined], ['an array', [{ restingKcal: 1750 }]], ['a string', '{"restingKcal":1750}'],
    ['a number', 1750], ['a boolean', true], ['an empty object', {}],
    ['a class instance', new (class Targets { restingKcal = 1750; })()],
    ['an inherited field', Object.create({ restingKcal: 1750 }) as object],
  ])('refuses %s', (_label, value) => {
    expect(parseNutritionTargetsPatch(value)).toMatchObject({ ok: false });
  });

  it.each([
    ['an estimated BMR field', { bmr: 1700 }],
    ['an unknown field beside a valid one', { restingKcal: 1750, tdee: 2200 }],
    ['a prototype key', JSON.parse('{"__proto__":{"restingKcal":1750}}') as unknown],
    ['a constructor key', { constructor: 1750 }],
    ['a differently cased field', { RestingKcal: 1750 }],
  ])('refuses %s', (_label, value) => {
    expect(parseNutritionTargetsPatch(value)).toMatchObject({ ok: false });
  });

  it.each([
    ['a decimal', { restingKcal: 1750.5 }],
    ['a numeric string', { restingKcal: '1750' }],
    ['an empty string', { proteinGrams: '' }],
    ['NaN', { proteinGrams: Number.NaN }],
    ['Infinity', { proteinGrams: Number.POSITIVE_INFINITY }],
    ['a boolean', { deficitKcal: true }],
    ['an array', { deficitKcal: [350] }],
    ['an object', { deficitKcal: { value: 350 } }],
    ['an unsafe integer', { restingKcal: Number.MAX_SAFE_INTEGER + 1 }],
    ['undefined', { restingKcal: undefined }],
  ])('refuses %s', (_label, value) => {
    expect(parseNutritionTargetsPatch(value)).toMatchObject({ ok: false });
  });

  it('never echoes a submitted value or key in its reason', () => {
    const results = [
      parseNutritionTargetsPatch({ restingKcal: 987654 }),
      parseNutritionTargetsPatch({ restingKcal: 'secret-text' }),
      parseNutritionTargetsPatch({ secretField: 1750 }),
    ];
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).not.toContain('987654');
        expect(result.reason).not.toContain('secret');
      }
    }
  });

  it('names the allowed range in a range reason so the model can ask for a valid number', () => {
    const result = parseNutritionTargetsPatch({ proteinGrams: nutritionTargetBounds.proteinGrams.max + 1 });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('Protein target') });
    if (!result.ok) {
      expect(result.reason).toContain(String(nutritionTargetBounds.proteinGrams.min));
      expect(result.reason).toContain(String(nutritionTargetBounds.proteinGrams.max));
    }
  });
});

describe('changedNutritionTargets', () => {
  it('lists only the named targets whose value would change, in a fixed order', () => {
    expect(changedNutritionTargets(synthetic, { proteinGrams: 120, restingKcal: 1800 })).toEqual(['restingKcal', 'proteinGrams']);
    expect(changedNutritionTargets(synthetic, { deficitKcal: synthetic.deficitKcal })).toEqual([]);
    expect(changedNutritionTargets(synthetic, {})).toEqual([]);
  });

  it('treats setting an unset target and clearing a set one as changes, and clearing an unset one as none', () => {
    expect(changedNutritionTargets(emptyNutritionTargets, { restingKcal: 1750 })).toEqual(['restingKcal']);
    expect(changedNutritionTargets(synthetic, { restingKcal: null })).toEqual(['restingKcal']);
    expect(changedNutritionTargets(emptyNutritionTargets, { restingKcal: null, deficitKcal: null })).toEqual([]);
  });
});

describe('presentNutritionTargets', () => {
  it('reports every unset target as missing and carries the bounds for the UI', () => {
    const view = presentNutritionTargets({ targets: { restingKcal: 1750, deficitKcal: null, proteinGrams: null }, updatedAt: '2026-10-17T10:00:00.000Z' });
    expect(view.targets).toEqual({ restingKcal: 1750, deficitKcal: null, proteinGrams: null });
    expect(view.missing).toEqual(['deficitKcal', 'proteinGrams']);
    expect(view.updatedAt).toBe('2026-10-17T10:00:00.000Z');
    expect(view.bounds).toBe(nutritionTargetBounds);
  });

  it('reports nothing missing when all three are set, and everything missing when none is', () => {
    expect(presentNutritionTargets({ targets: synthetic, updatedAt: null }).missing).toEqual([]);
    expect(presentNutritionTargets({ targets: emptyNutritionTargets, updatedAt: null }).missing).toEqual([...nutritionTargetFields]);
  });

  it('copies the targets so a caller cannot mutate the stored view', () => {
    const stored = { targets: synthetic, updatedAt: null };
    const view = presentNutritionTargets(stored);
    expect(view.targets).not.toBe(stored.targets);
    expect(view.targets).toEqual(synthetic);
  });
});
