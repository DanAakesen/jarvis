import { z } from 'zod';

const text = (max = 256) => z.string().min(1).max(max).refine(value =>
  value.trim() === value && Array.from(value).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127));
const macro = z.number().finite().min(0).max(1000).nullable();
const mealType = z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'other']).nullable();
const description = text(4000).nullable();
const preference = z.enum(['like', 'dislike']).nullable();
const revision = z.string().regex(/^[1-9]\d{0,18}$/u).refine(value => BigInt(value) < 9223372036854775807n);
const newRevision = z.union([z.literal('0'), revision]);
const definition = z.object({
  mealName: text(2000), mealType: mealType.default(null),
  components: z.array(z.json()).max(100).default([]),
  confidence: z.enum(['accurate', 'approximate', 'estimate']),
  energyKcal: z.number().finite().min(0).max(10000),
  proteinGrams: macro.default(null), carbohydratesGrams: macro.default(null),
  fatGrams: macro.default(null), fiberGrams: macro.default(null),
}).strict();
const aliases = z.array(text()).max(30);
const entries = z.array(z.object({
  slot: z.enum(['breakfast', 'lunch', 'dinner', 'snack']), favoriteId: text(),
}).strict()).min(3).max(50);

export const savedChangeSchema = z.object({
  change: z.discriminatedUnion('operation', [
    z.object({
      operation: z.literal('save_favorite'), operationId: text(120), expectedRevision: newRevision,
      name: text(), aliases: aliases.default([]), sourceIdempotencyKey: text().optional(),
      definition: definition.optional(),
    }).strict().refine(value => (value.sourceIdempotencyKey !== undefined) !== (value.definition !== undefined)),
    z.object({
      operation: z.literal('save_plan'), operationId: text(120), expectedRevision: newRevision,
      name: text(), description: description.default(null), entries,
    }).strict(),
    z.object({ operation: z.literal('delete_plan'), id: text(), expectedRevision: revision }).strict(),
    z.object({
      operation: z.literal('set_feedback'), favoriteId: text(), expectedRevision: newRevision, preference,
    }).strict(),
  ]),
}).strict();

// Flat HTTP properties survive Ajv's branch-property removal; domain parsing remains strict.
export const internalSavedInput = z.object({
  operation: z.enum(['lookup_saved', 'read_preferences', 'save_favorite', 'save_plan', 'delete_plan', 'set_feedback']),
  name: text(2000).optional(), favoriteIds: z.array(text()).min(1).max(50).optional(),
  expectedRevision: newRevision.optional(), aliases: aliases.optional(),
  sourceIdempotencyKey: text().optional(), definition: definition.omit({ confidence: true }).optional(),
  description: description.optional(), entries: entries.optional(),
  id: text().optional(), favoriteId: text().optional(), preference: preference.optional(),
}).strict();
export const savedReadSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('lookup_saved'), name: text(2000) }).strict(),
  z.object({ operation: z.literal('read_preferences'), favoriteIds: z.array(text()).min(1).max(50) }).strict(),
]);
export const internalSavedInputSchema = z.toJSONSchema(internalSavedInput, {
  target: 'draft-7', io: 'input',
  override: ({ zodSchema, jsonSchema }) => {
    const nullable = [macro, mealType, description, preference].find(schema => schema === zodSchema);
    if (!nullable) return;
    const inner = z.toJSONSchema(nullable.unwrap(), { target: 'draft-7', io: 'input' });
    delete inner.$schema;
    Object.assign(jsonSchema, inner, { type: [inner.type, 'null'] });
    if (Array.isArray(inner.enum)) jsonSchema.enum = [...inner.enum, null];
    delete jsonSchema.anyOf;
  },
});
