import { ToolRefusal } from '../../core/tool-registry.js';
import { normalizeSearchText, resolveNutrients, text, writeDefinition, type FoodDefinition, type Nutrients } from './model.js';

const command = /^(?:please\s+)?(?:log|record|registrer|registr\u00e9r)\s+(.+?)[.!]?\s*$/iu;
const uncertain = /\b(?:approx(?:imate(?:ly)?)?|about|roughly|estimate[ds]?|maybe|photo|picture|image|guess|omkring|cirka)\b/iu;
const qualified = /\b(?:if|unless|when|provided|not|never|don['\u2019]t|instead|but|ikke|aldrig|hvis|men|yesterday|tomorrow|earlier|later|last|next|today|tonight|morgen|tidligere|senere)\b|\bi\s+g\u00e5r\b|\b\d{1,4}[-/]\d{1,2}\b|\b(?:at|kl)\s+\d/iu;
const quantity = '(\\d{1,5}(?:\\.\\d{1,2})?)';
const macroNames: Readonly<Record<string, Exclude<keyof Nutrients, 'energyKcal'>>> = {
  protein: 'proteinGrams', carbs: 'carbohydratesGrams', carbohydrates: 'carbohydratesGrams',
  kulhydrat: 'carbohydratesGrams', kulhydrater: 'carbohydratesGrams', fat: 'fatGrams', fedt: 'fatGrams',
  fiber: 'fiberGrams', fibre: 'fiberGrams', kostfibre: 'fiberGrams',
};
const macroPattern = Object.keys(macroNames).join('|');
const namedMacro = new RegExp(`^(${macroPattern})\\s*:?\\s*${quantity}\\s*(?:g|grams?)$`, 'iu');
const measuredMacro = new RegExp(`^${quantity}\\s*(?:g|grams?)\\s+(?:of\\s+)?(${macroPattern})$`, 'iu');

function requestedFood(message: string): string {
  text(message, 4000);
  if (/[\r\n;?]/u.test(message)) throw new ToolRefusal('Use one explicit food-log request. No intake was logged.');
  const food = command.exec(message.trim())?.[1]?.trim();
  if (!food) throw new ToolRefusal('An explicit food-log request from Dan is required. No intake was logged.');
  if (qualified.test(food)) throw new ToolRefusal('Conditional, negated or time-qualified requests are not supported by this direct path. No intake was logged.');
  return food;
}

export function favoriteIntent(message: string): string {
  const food = requestedFood(message);
  const withoutPossessive = food.replace(/^(?:my|the|min|mit)\s+/iu, '');
  const name = withoutPossessive.replace(/^(?:(?:saved\s+)?(?:favourite|favorite)|favorit)\s+/iu, '');
  normalizeSearchText(name);
  return name;
}

/** Values come from the human message, never the tool's proposed nutrients. */
export function exactLabelIntent(message: string): FoodDefinition {
  const food = requestedFood(message);
  if (uncertain.test(food) || /\d,\d/u.test(food)) {
    throw new ToolRefusal('Estimated or ambiguous quantities require a reviewed proposal. No intake was logged.');
  }
  const match = new RegExp(`^("[^"]+"|[\\p{L}\\p{N}][\\p{L}\\p{N}'\\u2019_-]*)\\s*[:,]\\s*${quantity}\\s*(?:kcal|calories|kalorier)(.*)$`, 'iu').exec(food);
  if (!match) throw new ToolRefusal('Supply an exact label as "Log food: 200 kcal, protein 10 g"; quote multiword food names. New estimates are not authorised by this path.');
  const exact: Partial<Nutrients> = { energyKcal: Number(match[2]) };
  const rest = match[3]!.trim();
  if (rest && !rest.startsWith(',')) throw new ToolRefusal('All label quantities must be explicit named values. No intake was logged.');
  const fields = rest ? rest.slice(1).split(',').map(field => field.trim()) : [];
  if (fields.length > 4) throw new ToolRefusal('The label has too many nutrient fields. No intake was logged.');
  for (const field of fields) {
    const named = namedMacro.exec(field);
    const measured = named ? null : measuredMacro.exec(field);
    const key = macroNames[(named?.[1] ?? measured?.[2] ?? '').toLowerCase()];
    const value = named?.[2] ?? measured?.[1];
    if (!key || value === undefined || Object.hasOwn(exact, key)) throw new ToolRefusal('Every label nutrient must be a unique explicit gram quantity. No intake was logged.');
    exact[key] = Number(value);
  }
  const resolved = resolveNutrients(exact, null);
  const result: FoodDefinition = {
    mealName: match[1]!.replace(/^"|"$/gu, ''), mealType: null, components: [], ...resolved.values,
    confidence: resolved.confidence, provenance: resolved.provenance,
  };
  writeDefinition(result);
  return result;
}
