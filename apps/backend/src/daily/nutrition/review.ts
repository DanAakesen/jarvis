import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ToolFailure, ToolRefusal } from '../../core/tool-registry.js';
import { canonicalJson, copenhagenDate, storedMeal, writeMeal, type MealInput } from './model.js';
import {
  foodLookupComponentSchema, foodLookupComponents, foodLookupGramsSchema, foodLookupPreparationSchema,
} from './lookup-schema.js';

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
const estimateComponents = z.array(foodLookupComponentSchema.extend({
  grams: foodLookupGramsSchema.unwrap(),
})).min(1).max(25);
const food = z.object({
  ...fields, energyKcal: fields.energyKcal.optional(), mealType: fields.mealType.default(null),
  components: fields.components.default([]), occurredAt: fields.occurredAt.optional(),
  proteinGrams: macro.default(null), carbohydratesGrams: macro.default(null), fatGrams: macro.default(null),
  fiberGrams: macro.default(null), referenceComponents: estimateComponents.optional(),
}).strict();
const changes = z.object(fields).partial().strict().refine(value => Object.keys(value).length > 0);
export const foodReviewSchema = z.object({ change: z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('log_estimate'), food }).strict(),
  z.object({ operation: z.literal('lookup_components'), components: foodLookupComponents }).strict(),
  z.object({ operation: z.literal('correct'), ...target, changes }).strict(),
  z.object({ operation: z.literal('delete'), ...target }).strict(),
]) }).strict();
// Ajv removes valid branch fields with strict anyOf; the tool enforces the union.
export const foodReviewInputSchema = z.toJSONSchema(z.object({
  change: z.object({
    operation: z.enum(['log_estimate', 'lookup_components', 'correct', 'delete']), food: food.optional(),
    components: foodLookupComponents.optional(),
    idempotencyKey: target.idempotencyKey.optional(), expectedRevision: target.expectedRevision.optional(), changes: changes.optional(),
  }).strict(),
}).strict(), {
  target: 'draft-7', io: 'input',
  override: ({ zodSchema, jsonSchema }) => {
    const nullable = [macro, foodLookupGramsSchema, foodLookupPreparationSchema].find(schema => schema === zodSchema);
    if (!nullable) return;
    // A single nullable type prevents Ajv coercing unknown nulls into zero.
    const numeric = z.toJSONSchema(nullable.unwrap(), { target: 'draft-7', io: 'input' });
    delete numeric.$schema;
    Object.assign(jsonSchema, numeric, { type: nullable === foodLookupPreparationSchema ? ['string', 'null'] : ['number', 'null'] });
    delete jsonSchema.anyOf;
  },
});
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
  const reference = input.provenance.source === 'frida-estimate' && input.provenance.reference &&
    typeof input.provenance.reference === 'object' && !Array.isArray(input.provenance.reference)
    ? input.provenance.reference as Record<string, unknown> : null;
  const components = reference ? input.components.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const component = value as Record<string, unknown>;
    const match = component.reference && typeof component.reference === 'object' && !Array.isArray(component.reference)
      ? component.reference as Record<string, unknown> : null;
    return {
      name: component.name, grams: component.grams, preparationMethod: component.preparationMethod,
      referenceFood: match?.name ?? null, nutrients: match?.values ?? null, unknowns: component.unknowns,
    };
  }) : input.components;
  return {
    mealName: input.mealName, mealType: input.mealType, occurredAt: input.occurredAt,
    mealDate: input.mealDate, timeZone: 'Europe/Copenhagen', captureMethod: input.captureMethod,
    confidence: input.confidence, components,
    energyKcal: input.energyKcal, proteinGrams: input.proteinGrams, carbohydratesGrams: input.carbohydratesGrams,
    fatGrams: input.fatGrams, fiberGrams: input.fiberGrams,
    ...(reference ? { nutrientReference: {
      provider: reference.provider, version: reference.version, releaseId: reference.releaseId,
      attribution: reference.attribution, basis: reference.basis, unknowns: input.provenance.unknowns,
    } } : {}),
  };
}
function shown(value: unknown, missing = 'not set'): string {
  if (value === null || value === undefined) return missing;
  return typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value) ?? String(value);
}
export function nutritionSummary(input: { energyKcal: number | null; proteinGrams: number | null; carbohydratesGrams: number | null; fatGrams: number | null; fiberGrams: number | null }): string {
  return [
    `Protein: ${shown(input.proteinGrams, 'unknown (not zero)')} g`,
    `Calories: ${shown(input.energyKcal, 'unknown (not zero)')} kcal`,
    `Fat: ${shown(input.fatGrams, 'unknown (not zero)')} g`,
    `Carbohydrates: ${shown(input.carbohydratesGrams, 'unknown (not zero)')} g`,
    `Fiber: ${shown(input.fiberGrams, 'unknown (not zero)')} g`,
  ].map(line => `- ${line}`).join('\n');
}
function referenceSummary(input: MealInput): string {
  const reference = display(input).nutrientReference;
  if (!reference) return '';
  const provider = [reference.provider, reference.version].filter(Boolean).join(' ');
  return [provider, reference.attribution, reference.basis].filter(Boolean).map(String).join('; ');
}
function uncertaintySummary(input: MealInput): string {
  const unknowns = new Set<string>();
  const add = (value: unknown) => {
    if (Array.isArray(value)) for (const item of value) unknowns.add(String(item));
  };
  add(input.provenance.unknowns);
  for (const [index, component] of input.components.entries()) {
    if (!component || typeof component !== 'object' || Array.isArray(component)) continue;
    const componentUnknowns = (component as Record<string, unknown>).unknowns;
    if (Array.isArray(componentUnknowns)) {
      for (const item of componentUnknowns) unknowns.add(`component ${index + 1}: ${String(item)}`);
    }
    const values = (component as Record<string, unknown>).reference;
    if (values && typeof values === 'object' && !Array.isArray(values)) {
      const nutrients = (values as Record<string, unknown>).values;
      if (nutrients && typeof nutrients === 'object' && !Array.isArray(nutrients)) {
        for (const [key, value] of Object.entries(nutrients)) if (value === null) unknowns.add(`component ${index + 1}: ${key} unknown`);
      }
    }
  }
  return unknowns.size ? [...unknowns].map(value => JSON.stringify(value)).join(', ') : 'none reported';
}
function componentSummary(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const component = { ...value as Record<string, unknown> };
    delete component.unknowns;
    return JSON.stringify(component) ?? String(component);
  }
  return JSON.stringify(value) ?? String(value);
}
function snapshot(input: MealInput): string[] {
  const shownMeal = display(input);
  const components = shownMeal.components as unknown[];
  const reference = referenceSummary(input);
  return [
    `Meal: ${shown(input.mealName)}`,
    `Type: ${shown(input.mealType)}`,
    `When: ${input.occurredAt} (${shownMeal.mealDate}, ${shownMeal.timeZone})`,
    `Capture: ${shown(input.captureMethod)}; confidence: ${shown(input.confidence)}`,
    `Components (${components.length}):`,
    ...components.map((component, index) => `${index + 1}. ${componentSummary(component)}`),
    `Nutrition:\n${nutritionSummary(input)}`,
    `Source: ${shown(input.provenance.source)}${reference ? `; ${reference}` : ''}`,
    `Independently verified: ${shown(input.provenance.independentlyVerified)}`,
    `Uncertainty: ${uncertaintySummary(input)}`,
  ];
}
function correctionDetails(before: MealInput, after: MealInput): string[] {
  const beforeShown = display(before);
  const afterShown = display(after);
  const componentsChanged = canonicalJson(before.components) !== canonicalJson(after.components);
  const nutrients = [
    ['energy', 'energyKcal', 'kcal'],
    ['protein', 'proteinGrams', 'g'],
    ['carbohydrates', 'carbohydratesGrams', 'g'],
    ['fat', 'fatGrams', 'g'],
    ['fiber', 'fiberGrams', 'g'],
  ] as const;
  const changedNutrients = nutrients.filter(([, key]) => before[key] !== after[key]);
  const nutritionChanges = nutrients.map(([name, key, unit]) => before[key] === after[key]
    ? `${name} ${shown(after[key], 'unknown (not zero)')} ${unit} (unchanged)`
    : `${name} ${shown(before[key], 'unknown (not zero)')} → ${shown(after[key], 'unknown (not zero)')} ${unit}`);
  const beforeUncertainty = uncertaintySummary(before);
  const afterUncertainty = uncertaintySummary(after);
  const lines = [
    `Meal: ${before.mealName === after.mealName ? shown(after.mealName) : `${shown(before.mealName)} → ${shown(after.mealName)}`}`,
    `Type: ${before.mealType === after.mealType ? shown(after.mealType) : `${shown(before.mealType)} → ${shown(after.mealType)}`}`,
    `When: ${before.occurredAt === after.occurredAt
      ? `${after.occurredAt} (${shown(afterShown.mealDate)}, ${shown(afterShown.timeZone)})`
      : `${before.occurredAt} (${shown(beforeShown.mealDate)}) → ${after.occurredAt} (${shown(afterShown.mealDate)}, ${shown(afterShown.timeZone)})`}`,
    `Capture: ${shown(after.captureMethod)}; confidence: ${before.confidence === after.confidence
      ? shown(after.confidence) : `${shown(before.confidence)} → ${shown(after.confidence)}`}`,
    componentsChanged
      ? `Components before (${before.components.length}):\n${beforeShown.components.map((component, index) => `${index + 1}. ${componentSummary(component)}`).join('\n')}\nComponents after (${after.components.length}):\n${afterShown.components.map((component, index) => `${index + 1}. ${componentSummary(component)}`).join('\n')}`
      : `Portion: ${after.components.length} components unchanged`,
    ...(changedNutrients.length
      ? [`Nutrition:\n${nutritionChanges.map(line => `- ${line}`).join('\n')}`]
      : [`Nutrition unchanged:\n${nutritionSummary(after)}`]),
    `Source: ${shown(before.provenance.source)} → ${shown(after.provenance.source)}${referenceSummary(after) ? `; ${referenceSummary(after)}` : ''}`,
    `Independently verified: ${shown(after.provenance.independentlyVerified)}`,
    `Uncertainty: ${beforeUncertainty === afterUncertainty ? afterUncertainty : `${beforeUncertainty} → ${afterUncertainty}`}`,
  ];
  return lines;
}
export function foodReviewSummary(operation: FoodReviewChange['operation'], before: MealInput | null, after: MealInput | null, expectedRevision?: string): string {
  const lines = [
    `Review this exact food ${operation === 'delete' ? 'deletion' : operation === 'correct' ? 'correction' : 'estimate for logging'} in Now. Nothing has changed. Approve only if this is eaten food and the details are right. Estimates are not independently verified. No Apple Health write or deletion.`,
  ];
  if (operation === 'correct' && before && after) {
    lines.push(`Record revision: ${expectedRevision ?? 'unavailable'}`, ...correctionDetails(before, after));
  } else if (operation === 'delete' && before) {
    lines.push(`Record revision: ${expectedRevision ?? 'unavailable'}`, ...snapshot(before));
  } else if (operation === 'log_estimate' && after) lines.push(...snapshot(after));
  const summary = lines.join('\n');
  if (summary.length > 4000) {
    throw new ToolRefusal('The complete food details exceed Now’s 4,000-character review limit, so nothing was changed. Shorten the changed labels or uncertainty details and retry. For a name-only correction, change only the meal name; you do not need to split an existing meal.');
  }
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
