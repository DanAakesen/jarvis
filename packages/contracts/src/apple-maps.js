// Requests travel to a foreground iPhone. Results contain only the places and routes MapKit returned.
const string = (maxLength) => ({ type: 'string', minLength: 1, maxLength });
const number = (minimum, maximum) => ({ type: 'number', minimum, maximum });
const object = (properties, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const point = { latitude: number(-90, 90), longitude: number(-180, 180) };
const mode = { type: 'string', enum: ['driving', 'walking'] };
const instant = { type: 'string', format: 'date-time', maxLength: 40 };
const bufferMinutes = { type: 'integer', minimum: 0, maximum: 1_440 };
export const appleMapsQuerySchema = object({
  query: string(300), origin: string(300), mode, arriveBy: instant, bufferMinutes,
}, ['query']);
const place = object({
  name: string(300), address: string(500), ...point, travelSeconds: number(0, 31_536_000),
  distanceMeters: number(0, 100_000_000), path: { type: 'array', minItems: 2, maxItems: 64, items: object(point) },
}, ['name', 'address', 'latitude', 'longitude']);
export const appleMapsResultSchema = object({
  places: { type: 'array', maxItems: 3, items: place }, mode, observedAt: instant,
  origin: object({ name: string(300), ...point }), arriveBy: instant, bufferMinutes, reason: string(300),
}, ['places', 'mode', 'observedAt']);

const hasKeys = (value, schema) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  schema.required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => Object.hasOwn(schema.properties, key));
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const inRange = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const coordinate = value => inRange(value.latitude, -90, 90) && inRange(value.longitude, -180, 180);
const dated = value => text(value, 40) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/u.test(value) && Number.isFinite(Date.parse(value));
const validTiming = value => (value.arriveBy === undefined || dated(value.arriveBy)) &&
  (value.bufferMinutes === undefined || (Number.isInteger(value.bufferMinutes) && inRange(value.bufferMinutes, 0, 1_440)));

export function isAppleMapsQuery(value) {
  return hasKeys(value, appleMapsQuerySchema) && text(value.query, 300) &&
    (value.origin === undefined || text(value.origin, 300)) &&
    (value.mode === undefined || mode.enum.includes(value.mode)) && validTiming(value);
}

export function isAppleMapsResult(value) {
  return hasKeys(value, appleMapsResultSchema) && mode.enum.includes(value.mode) && dated(value.observedAt) &&
    validTiming(value) && (value.reason === undefined || text(value.reason, 300)) &&
    (value.origin === undefined || (hasKeys(value.origin, appleMapsResultSchema.properties.origin) &&
      text(value.origin.name, 300) && coordinate(value.origin))) &&
    Array.isArray(value.places) && value.places.length <= 3 && value.places.every(p =>
      hasKeys(p, place) && coordinate(p) && text(p.name, 300) && text(p.address, 500) &&
      (p.travelSeconds === undefined || inRange(p.travelSeconds, 0, 31_536_000)) &&
      (p.distanceMeters === undefined || inRange(p.distanceMeters, 0, 100_000_000)) &&
      (p.path === undefined || (Array.isArray(p.path) && p.path.length >= 2 && p.path.length <= 64 &&
        p.path.every(v => hasKeys(v, place.properties.path.items) && coordinate(v)))));
}
