import { ToolRefusal } from '../../core/tool-registry.js';
import { normalizeSearchText, resolveNutrients, text, writeDefinition, type FoodDefinition, type Nutrients } from './model.js';

const command = /^(?:(?:can|could|would)\s+you\s+|kan\s+du\s+)?(?:(?:please|venligst)\s+)?(?:logge|log|record|registrere|registrer|registr\u00e9r)\s+(.+?)[.!?]?\s*$/iu;
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
  const normalized = message.trim().replace(/\s+(?:today|i dag)(?=[.!?]?\s*$)/iu, '');
  if (/[\r\n;]/u.test(normalized) || /\?/.test(normalized.slice(0, -1))) {
    throw new ToolRefusal('Use one food-log request. No intake was logged.');
  }
  const food = command.exec(normalized)?.[1]?.trim();
  if (!food) throw new ToolRefusal('health_food logs only a message that starts with log, record, logge or registrer (optionally after "can you", "please" or "kan du"), as in "Log banana: 105 kcal, protein 1 g" or "Log my favourite oatmeal". This message does not, so no intake was logged. To log a meal Dan described in other words, use health_food_review.');
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
  if (uncertain.test(food)) {
    throw new ToolRefusal('This message has a word such as about, roughly or estimate, so it is not an exact label and no intake was logged. health_food logs exact label values only; log an estimated or photographed meal with health_food_review.');
  }
  if (/\d,\d/u.test(food)) {
    throw new ToolRefusal('This message has a comma between two digits, which this path does not read as a decimal, so no intake was logged. Ask Dan to write decimals with a dot ("protein 1.3 g", not "1,3 g") and send the message again.');
  }
  const match = new RegExp(`^("[^"]+"|[\\p{L}\\p{N}][\\p{L}\\p{N}'\\u2019_-]*)\\s*[:,]\\s*${quantity}\\s*(?:kcal|calories|kalorier)(.*)$`, 'iu').exec(food);
  if (!match) throw new ToolRefusal('This message is not an exact label, so no intake was logged. health_food needs the food name, a colon or comma, then calories: "Log yoghurt: 200 kcal, protein 10 g". Put a name of several words in quotes, as in "Log "Greek yoghurt": 200 kcal". For a meal without a label, use health_food_review.');
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
