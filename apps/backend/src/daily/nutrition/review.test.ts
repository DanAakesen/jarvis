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
  it('shows actual before/after details, units, time zone, unknowns and exact target revision', () => {
    const before = storedMeal(row());
    const after = reviewedCorrection(row(), { proteinGrams: null }, origin, now);
    const summary = foodReviewSummary('correct', before, after, '2');
    expect(summary).toContain('Nothing has changed');
    expect(summary).toContain('"expectedRevision": "2"');
    expect(summary).toContain('"idempotencyKey": "retained-key"');
    expect(summary).toContain('"timeZone": "Europe/Copenhagen"');
    expect(summary).toContain('"energyKcal": 123');
    expect(summary).toContain('"proteinGrams": null');
    expect(summary).not.toContain('jarvisIntake');
    expect(() => foodReviewSummary('log_estimate', null, { ...after, components: ['x'.repeat(4000)] })).toThrow('too large');
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
