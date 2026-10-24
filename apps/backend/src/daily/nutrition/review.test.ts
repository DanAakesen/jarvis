import { describe, expect, it } from 'vitest';
import { canonicalJson, storedMeal } from './model.js';
import { foodRecordRevision, foodReviewFingerprint, foodReviewInputSchema, foodReviewSchema, foodReviewSummary, hasFoodReview, reviewedCorrection } from './review.js';

const row = () => ({
  id: 'meal', idempotency_key: 'retained-key', meal_name: 'Synthetic meal', meal_type: null,
  components_json: '[]', nutrient_provenance_json: '{"energyKcal":{"source":"user-exact","unit":"kcal"},"jarvisIntake":{"retained":true}}',
  occurred_at: '2026-01-01T23:30:00+01:00', meal_date: new Date('2026-01-01T00:00:00Z'),
  expires_at: '9999-12-31T23:59:59Z', energy_kcal: 123, protein_grams: 10, carbohydrates_grams: null,
  fat_grams: null, fiber_grams: null, confidence: 'accurate', capture_method: 'mixed', revision: '2',
});
const origin = { sourceMessageId: '42', sourceFingerprint: 'source', operation: 'correct', proposalFingerprint: 'proposal' };
const now = '2026-10-17T03:00:00Z';

describe('internal nutrition review contracts', () => {
  it('uses one nullable numeric input type so HTTP validation cannot coerce unknowns to zero', () => {
    const nutrients = Object.fromEntries(['proteinGrams', 'carbohydratesGrams', 'fatGrams', 'fiberGrams']
      .map(key => [key, { type: ['number', 'null'], minimum: 0, maximum: 1000 }]));
    expect(foodReviewInputSchema).toMatchObject({
      properties: { change: { properties: {
        food: { properties: nutrients }, changes: { properties: nutrients },
      } } },
    });
  });
  it('defaults unknown macros without allowing caller authority or confidence', () => {
    expect(foodReviewSchema.parse({ change: { operation: 'log_estimate', food: { mealName: 'Synthetic meal', energyKcal: 200 } } }).change).toMatchObject({
      food: { mealType: null, components: [], proteinGrams: null, carbohydratesGrams: null, fatGrams: null, fiberGrams: null },
    });
    for (const extra of [{ userConfirmed: true }, { owner: 'model-owner' }, { confidence: 'accurate' }, { captureMethod: 'photo' }, { provenance: {} }]) {
      expect(foodReviewSchema.safeParse({ change: { operation: 'log_estimate', food: { mealName: 'Synthetic meal', energyKcal: 200, ...extra } } }).success).toBe(false);
    }
  });
  it.each([
    { operation: 'correct', idempotencyKey: 'key', expectedRevision: '1', changes: {} },
    { operation: 'delete', idempotencyKey: 'key', expectedRevision: '0' },
    { operation: 'delete', idempotencyKey: 'key', expectedRevision: '9223372036854775807' },
    { operation: 'delete', idempotencyKey: 'key ', expectedRevision: '1' },
    { operation: 'correct', idempotencyKey: 'key', expectedRevision: '1', changes: { id: 'other' } },
    { operation: 'log_estimate', food: { mealName: 'meal', energyKcal: 10001 } },
    { operation: 'log_estimate', food: { mealName: 'meal', energyKcal: 100, proteinGrams: 1001 } },
  ])('rejects invalid or authority-changing proposals %j', change => {
    expect(foodReviewSchema.safeParse({ change }).success).toBe(false);
  });
  it('preserves exact quantities/provenance on a name-only correction and never mutates the source', () => {
    const source = row();
    const result = reviewedCorrection(source, { mealName: 'Corrected name' }, origin, now);
    expect(result).toMatchObject({ mealName: 'Corrected name', energyKcal: 123, confidence: 'accurate',
      captureMethod: 'mixed', mealDate: '2026-01-01', provenance: { energyKcal: { source: 'user-exact' }, jarvisIntake: { retained: true }, jarvisReview: origin } });
    expect(source.meal_name).toBe('Synthetic meal');
  });
  it('marks changed nutrient proposals as estimates and keeps explicit nulls/zero honest', () => {
    const result = reviewedCorrection(row(), { energyKcal: 0, proteinGrams: null }, origin, now);
    expect(result).toMatchObject({ energyKcal: 0, proteinGrams: null, confidence: 'estimate',
      provenance: { energyKcal: { source: 'estimate', unit: 'kcal' }, proteinGrams: { source: 'unknown', unit: 'g' } } });
  });
  it('marks component replacements as estimates without inventing unknown nutrients', () => {
    expect(reviewedCorrection(row(), { components: [{ name: 'Revised portion' }] }, origin, now)).toMatchObject({
      confidence: 'estimate', carbohydratesGrams: null, provenance: { carbohydratesGrams: { source: 'unknown' } },
    });
  });
  it('does not retain a whole-meal verification claim after changing proposed nutrients', () => {
    const source = { ...row(), nutrient_provenance_json: '{"source":"verified-label","independentlyVerified":true,"proteinGrams":{"source":"user-exact","unit":"g"}}' };
    expect(reviewedCorrection(source, { energyKcal: 222 }, origin, now)).toMatchObject({
      confidence: 'estimate', provenance: { source: 'jarvis-reviewed-proposal', independentlyVerified: false,
        energyKcal: { source: 'estimate' }, proteinGrams: { source: 'user-exact' } },
    });
  });
  it('recalculates Copenhagen date for an old corrected occurrence and rejects future/invalid times', () => {
    expect(reviewedCorrection(row(), { occurredAt: '2026-01-01T23:30:00Z' }, origin, now)).toMatchObject({ mealDate: '2026-01-02' });
    expect(() => reviewedCorrection(row(), { occurredAt: '2027-01-01T00:00:00Z' }, origin, now)).toThrow('trusted time');
    expect(() => storedMeal({ ...row(), components_json: 'invalid-private-synthetic' })).toThrow('could not be read safely');
  });
  it('shows changed values, units, time zone, unknowns and exact target revision without repeating snapshots', () => {
    const before = storedMeal(row());
    const after = reviewedCorrection(row(), { proteinGrams: null }, origin, now);
    const summary = foodReviewSummary('correct', before, after, '2');
    expect(summary).toContain('Nothing has changed');
    expect(summary).toContain('Record revision: 2');
    expect(summary).toContain('Europe/Copenhagen');
    expect(summary).toContain('energy 123 kcal (unchanged)');
    expect(summary).toContain('protein 10 → unknown (not zero) g');
    expect(summary).not.toContain('jarvisIntake');
    expect(summary).not.toContain('"before":');
    expect(summary).not.toContain('"after":');
    expect(() => foodReviewSummary('log_estimate', null, { ...after, components: ['x'.repeat(4000)] }))
      .toThrow('Now’s 4,000-character review limit');
  });
  it('keeps long but accepted meal names and a 25-component estimate within the existing review bound', () => {
    const before = storedMeal({ ...row(), meal_name: 'b'.repeat(1500) });
    const after = reviewedCorrection(row(), { mealName: 'a'.repeat(1500) }, origin, now);
    const renamed = foodReviewSummary('correct', before, after, '2');
    expect(renamed.length).toBeLessThanOrEqual(4000);
    expect(renamed).toContain('b'.repeat(1500));
    expect(renamed).toContain('a'.repeat(1500));

    const meal = { ...before, components: Array.from({ length: 25 }, (_, index) => ({
      name: `Synthetic component ${index + 1}`, grams: 10, preparationMethod: null,
    })) };
    const estimate = foodReviewSummary('log_estimate', null, meal);
    expect(estimate).toContain('Components (25)');
    expect(estimate.length).toBeLessThanOrEqual(4000);
  });
  it('retains long uncertainty and component labels when they fit and refuses rather than hiding them when they do not', () => {
    const component = (index: number, uncertaintyLength: number) => ({
      name: `Synthetic component ${index} ${'l'.repeat(200)}`, grams: 10, preparationMethod: null,
      unknowns: [`Synthetic uncertainty ${'u'.repeat(uncertaintyLength)}`],
    });
    const before = storedMeal({ ...row(), components_json: JSON.stringify([
      component(1, 650), component(2, 650), component(3, 650),
    ]) });
    const nearLimit = foodReviewSummary('delete', before, null, '2');
    expect(nearLimit.length).toBeGreaterThan(3000);
    expect(nearLimit.length).toBeLessThanOrEqual(4000);
    expect(nearLimit).toContain('Synthetic uncertainty');
    expect(nearLimit).toContain('l'.repeat(200));

    const tooLarge = storedMeal({ ...row(), components_json: JSON.stringify([
      component(1, 900), component(2, 900), component(3, 900), component(4, 900),
    ]) });
    expect(() => foodReviewSummary('delete', tooLarge, null, '2'))
      .toThrow('you do not need to split an existing meal');
  });
  it('binds replay to the actual source, exact operation and reviewed payload', () => {
    const change = foodReviewSchema.parse({ change: { operation: 'delete', idempotencyKey: 'retained-key', expectedRevision: '2' } }).change;
    expect(foodReviewFingerprint(change, 'source')).toBe(foodReviewFingerprint({ ...change }, 'source'));
    expect(foodReviewFingerprint(change, 'other-source')).not.toBe(foodReviewFingerprint(change, 'source'));
    const updated = { ...row(), nutrient_provenance_json: canonicalJson({ jarvisReview: origin }) };
    expect(hasFoodReview(updated, origin)).toBe(true);
    expect(hasFoodReview(updated, { ...origin, sourceMessageId: '43' })).toBe(false);
    expect(foodRecordRevision(row())).toBe(2n);
    expect(() => foodRecordRevision({ revision: '0' })).toThrow('revision');
  });
});
