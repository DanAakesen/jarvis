import { z } from 'zod';

const text = z.string().min(1).max(120).refine(value => value.trim() === value &&
  Array.from(value).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127));
export const foodLookupGramsSchema = z.number().finite().gt(0).max(5000).nullable();
export const foodLookupPreparationSchema = text.nullable();
export const foodLookupComponentSchema = z.object({
  name: text, grams: foodLookupGramsSchema, preparationMethod: foodLookupPreparationSchema,
}).strict();
export const foodLookupComponents = z.array(foodLookupComponentSchema).min(1).max(25);
export const foodLookupSchema = z.object({ components: foodLookupComponents }).strict();
export const foodLookupInputSchema = z.toJSONSchema(foodLookupSchema, {
  target: 'draft-7', io: 'input',
  override: ({ zodSchema, jsonSchema }) => {
    const nullable = [foodLookupGramsSchema, foodLookupPreparationSchema].find(schema => schema === zodSchema);
    if (!nullable) return;
    const inner = z.toJSONSchema(nullable.unwrap(), { target: 'draft-7', io: 'input' });
    delete inner.$schema;
    Object.assign(jsonSchema, inner, { type: [inner.type, 'null'] });
    delete jsonSchema.anyOf;
  },
});
