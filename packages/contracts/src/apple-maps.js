// Requests travel to a foreground iPhone. Results contain only the places and routes MapKit returned.
const string = (maxLength) => ({ type: 'string', minLength: 1, maxLength });
const object = (properties, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const mode = { type: 'string', enum: ['driving', 'walking'] };
const instant = { type: 'string', format: 'date-time', maxLength: 40 };
const bufferMinutes = { type: 'integer', minimum: 0, maximum: 1_440 };
export const appleMapsQuerySchema = object({
  query: string(300), origin: string(300), searchOnly: { type: 'boolean' }, mode, arriveBy: instant, bufferMinutes,
}, ['query']);
// Only the original lookup and its handle may live in conversation history.
const lookupId = '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$';
const lookupIdPattern = new RegExp(lookupId, 'u');
export const appleMapsViewSchema = object({
  lookupId: { type: 'string', pattern: lookupId }, request: appleMapsQuerySchema,
});

const hasKeys = (value, schema) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  schema.required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => Object.hasOwn(schema.properties, key));
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const inRange = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const dated = value => text(value, 40) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/u.test(value) && Number.isFinite(Date.parse(value));
const validTiming = value => (value.arriveBy === undefined || dated(value.arriveBy)) &&
  (value.bufferMinutes === undefined || (Number.isInteger(value.bufferMinutes) && inRange(value.bufferMinutes, 0, 1_440)));

export function isAppleMapsQuery(value) {
  return hasKeys(value, appleMapsQuerySchema) && text(value.query, 300) &&
    (value.origin === undefined || text(value.origin, 300)) && (value.searchOnly === undefined || typeof value.searchOnly === 'boolean') &&
    (value.mode === undefined || mode.enum.includes(value.mode)) && validTiming(value);
}

export function isAppleMapsView(value) {
  return hasKeys(value, appleMapsViewSchema) && typeof value.lookupId === 'string' &&
    lookupIdPattern.test(value.lookupId) && isAppleMapsQuery(value.request);
}
