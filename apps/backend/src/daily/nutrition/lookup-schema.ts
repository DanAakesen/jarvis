import { z } from 'zod';

const text = z.string().min(1).max(120).refine(value => value.trim() === value &&
  Array.from(value).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127));
const grams = z.number().finite().gt(0).max(5000).nullable();
const preparation = text.nullable();
export const foodLookupComponents = z.array(z.object({
  name: text, grams, preparationMethod: preparation,
}).strict()).min(1).max(25);
export const foodLookupSchema = z.object({ components: foodLookupComponents }).strict();
export const foodLookupInputSchema = z.toJSONSchema(foodLookupSchema, {
  target: 'draft-7', io: 'input',
  override: ({ zodSchema, jsonSchema }) => {
    const nullable = [grams, preparation].find(schema => schema === zodSchema);
    if (!nullable) return;
    const inner = z.toJSONSchema(nullable.unwrap(), { target: 'draft-7', io: 'input' });
    delete inner.$schema;
    Object.assign(jsonSchema, inner, { type: [inner.type, 'null'] });
    delete jsonSchema.anyOf;
  },
});
