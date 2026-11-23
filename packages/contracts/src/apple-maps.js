// Requests travel to a foreground iPhone. Results contain only the places and routes MapKit returned.
const string = (maxLength) => ({ type: 'string', minLength: 1, maxLength });
const object = (properties, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const mode = { type: 'string', enum: ['driving', 'walking'] };
const instant = { type: 'string', format: 'date-time', maxLength: 40 };
const bufferMinutes = { type: 'integer', minimum: 0, maximum: 1_440 };
const searchSchema = object({
  query: string(300), origin: string(300), searchOnly: { type: 'boolean' }, mode, arriveBy: instant, bufferMinutes,
  nearby: { type: 'string', enum: ['name', 'category'], description: 'For a local business search, use name with the business name alone, or category with the kind of place.' },
}, ['query']);
// Only the original lookup and its handle may live in conversation history.
const lookupId = '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$';
const lookupIdPattern = new RegExp(lookupId, 'u');
const selectionSchema = object({ lookupId: { type: 'string', pattern: lookupId }, ordinal: { type: 'integer', minimum: 1, maximum: 3 } });
export const appleMapsQuerySchema = {
  ...object({ ...searchSchema.properties, ...selectionSchema.properties }, []),
  oneOf: [searchSchema, selectionSchema],
};
export const appleMapsViewSchema = object({
  lookupId: { type: 'string', pattern: lookupId }, request: searchSchema,
}, ['lookupId']);

const hasKeys = (value, schema) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  schema.required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => Object.hasOwn(schema.properties, key));
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const inRange = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const dated = value => text(value, 40) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/u.test(value) && Number.isFinite(Date.parse(value));
const validTiming = value => (value.arriveBy === undefined || dated(value.arriveBy)) &&
  (value.bufferMinutes === undefined || (Number.isInteger(value.bufferMinutes) && inRange(value.bufferMinutes, 0, 1_440)));

function isSearch(value) {
  return hasKeys(value, searchSchema) && text(value.query, 300) &&
    (value.origin === undefined || text(value.origin, 300)) && (value.searchOnly === undefined || typeof value.searchOnly === 'boolean') &&
    (value.nearby === undefined || (['name', 'category'].includes(value.nearby) && value.searchOnly !== true)) &&
    (value.mode === undefined || mode.enum.includes(value.mode)) && validTiming(value);
}

export function isAppleMapsQuery(value) {
  if (!hasKeys(value, selectionSchema)) return isSearch(value);
  return typeof value.lookupId === 'string' && lookupIdPattern.test(value.lookupId) &&
    Number.isInteger(value.ordinal) && inRange(value.ordinal, 1, 3);
}

export function isAppleMapsView(value) {
  return hasKeys(value, appleMapsViewSchema) && typeof value.lookupId === 'string' &&
    lookupIdPattern.test(value.lookupId) && (value.request === undefined || isSearch(value.request));
}
