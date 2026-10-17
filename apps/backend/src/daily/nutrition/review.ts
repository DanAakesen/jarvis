import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ToolFailure, ToolRefusal } from '../../core/tool-registry.js';
import { canonicalJson, copenhagenDate, storedMeal, writeMeal, type MealInput } from './model.js';

const label = (max = 256) => z.string().min(1).max(max).refine(value =>
  value.trim() === value && Array.from(value).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127));
const macro = z.number().finite().min(0).max(1000).nullable();
const fields = {
  mealName: label(2000), mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'other']).nullable(),
  components: z.array(z.json()).max(25), occurredAt: z.iso.datetime({ offset: true }),
  energyKcal: z.number().finite().min(0).max(10000),
  proteinGrams: macro, carbohydratesGrams: macro, fatGrams: macro, fiberGrams: macro,
};
const target = {
  idempotencyKey: label(),
  expectedRevision: z.string().regex(/^[1-9]\d{0,18}$/u).refine(value => BigInt(value) < 9223372036854775807n),
};
const food = z.object({
  ...fields, mealType: fields.mealType.default(null), components: fields.components.default([]),
  occurredAt: fields.occurredAt.optional(), proteinGrams: macro.default(null),
  carbohydratesGrams: macro.default(null), fatGrams: macro.default(null), fiberGrams: macro.default(null),
}).strict();
const changes = z.object(fields).partial().strict().refine(value => Object.keys(value).length > 0);
export const foodReviewSchema = z.object({ change: z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('log_estimate'), food }).strict(),
  z.object({ operation: z.literal('correct'), ...target, changes }).strict(),
  z.object({ operation: z.literal('delete'), ...target }).strict(),
]) }).strict();
// Ajv removes valid branch fields with strict anyOf; the tool enforces the union.
export const foodReviewInputSchema = z.toJSONSchema(z.object({
  change: z.object({
    operation: z.enum(['log_estimate', 'correct', 'delete']), food: food.optional(),
    idempotencyKey: target.idempotencyKey.optional(), expectedRevision: target.expectedRevision.optional(), changes: changes.optional(),
  }).strict(),
}).strict(), { target: 'draft-7', io: 'input' });
export type FoodReviewChange = z.infer<typeof foodReviewSchema>['change'];
export interface FoodReviewOrigin {
  sourceMessageId: string; sourceFingerprint: string; operation: string; proposalFingerprint: string;
}
export function foodReviewFingerprint(change: FoodReviewChange, sourceFingerprint: string): string {
  return createHash('sha256').update(canonicalJson({ change, sourceFingerprint })).digest('hex');
}
export function reviewedCorrection(row: Record<string, unknown>, changes: Extract<FoodReviewChange, { operation: 'correct' }>['changes'],
  origin: FoodReviewOrigin, requestTime: string): MealInput {
  const saved = storedMeal(row);
  const nutrients = ['energyKcal', 'proteinGrams', 'carbohydratesGrams', 'fatGrams', 'fiberGrams'] as const;
  const estimated = changes.components !== undefined || nutrients.some(key => Object.hasOwn(changes, key));
  const provenance: Record<string, unknown> = { ...saved.provenance, jarvisReview: origin };
  if (estimated) {
    provenance.source = 'jarvis-reviewed-proposal';
    provenance.independentlyVerified = false;
    for (const key of nutrients) {
      if (changes.components !== undefined || Object.hasOwn(changes, key)) {
        const value = Object.hasOwn(changes, key) ? changes[key] : saved[key];
        provenance[key] = { source: value === null ? 'unknown' : 'estimate', unit: key === 'energyKcal' ? 'kcal' : 'g' };
      }
    }
  }
  const result: MealInput = {
    ...saved,
    ...(changes.mealName !== undefined ? { mealName: changes.mealName } : {}),
    ...(changes.mealType !== undefined ? { mealType: changes.mealType } : {}),
    ...(changes.components !== undefined ? { components: changes.components } : {}),
    ...(changes.energyKcal !== undefined ? { energyKcal: changes.energyKcal } : {}),
    ...(changes.proteinGrams !== undefined ? { proteinGrams: changes.proteinGrams } : {}),
    ...(changes.carbohydratesGrams !== undefined ? { carbohydratesGrams: changes.carbohydratesGrams } : {}),
    ...(changes.fatGrams !== undefined ? { fatGrams: changes.fatGrams } : {}),
    ...(changes.fiberGrams !== undefined ? { fiberGrams: changes.fiberGrams } : {}),
    ...(changes.occurredAt !== undefined ? { occurredAt: changes.occurredAt, mealDate: copenhagenDate(changes.occurredAt) } : {}),
    confidence: estimated ? 'estimate' : saved.confidence, provenance,
  };
  writeMeal(result, requestTime);
  return result;
}
function display(input: MealInput) {
  return {
    mealName: input.mealName, mealType: input.mealType, occurredAt: input.occurredAt,
    mealDate: input.mealDate, timeZone: 'Europe/Copenhagen', captureMethod: input.captureMethod,
    confidence: input.confidence, components: input.components,
    energyKcal: input.energyKcal, proteinGrams: input.proteinGrams, carbohydratesGrams: input.carbohydratesGrams,
    fatGrams: input.fatGrams, fiberGrams: input.fiberGrams,
  };
}
export function foodReviewSummary(operation: FoodReviewChange['operation'], before: MealInput | null, after: MealInput | null, expectedRevision?: string): string {
  const details = { operation, ...(before ? { idempotencyKey: before.idempotencyKey, expectedRevision, before: display(before) } : {}),
    ...(after ? { after: display(after) } : {}) };
  const summary = `Review this exact food ${operation === 'delete' ? 'soft deletion' : operation === 'correct' ? 'correction' : 'estimate for logging'} in Now. Nothing has changed. Approve only if this is eaten food and the details are right. Estimates are not independently verified. No Apple Health write or deletion.\n${JSON.stringify(details, null, 2)}`;
  if (summary.length > 4000) throw new ToolRefusal('This food proposal is too large to review safely. Use a smaller entry.');
  return summary;
}
export function foodRecordRevision(row: Record<string, unknown>): bigint {
  const value = String(row.revision ?? '');
  if (!/^[1-9]\d{0,18}$/u.test(value) || BigInt(value) > 9223372036854775807n) throw new ToolFailure('The stored intake revision is unavailable.');
  return BigInt(value);
}
export function hasFoodReview(row: Record<string, unknown>, origin: FoodReviewOrigin): boolean {
  const saved = storedMeal(row).provenance.jarvisReview;
  return !!saved && typeof saved === 'object' && !Array.isArray(saved) && canonicalJson(saved) === canonicalJson(origin);
}
