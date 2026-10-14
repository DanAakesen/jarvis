/** Pure source-contract helpers. Never reads a device, credential, or original Daily data. */
export type HealthObject = Record<string, unknown>;
// The shared transaction boundary preserves validation errors without leaking SQL/provider errors.
export class HealthPayloadError extends TypeError {
  constructor(readonly code: 'invalid_payload' | 'invalid_timestamp' | 'invalid_identifier' | 'payload_complexity' | 'conflicting_workout' | 'unsupported_unit') { super(code); }
}
export function object(value: unknown): HealthObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HealthPayloadError('invalid_payload');
  return value as HealthObject;
}
export function optionalObject(value: unknown): HealthObject { return value && typeof value === 'object' && !Array.isArray(value) ? value as HealthObject : {}; }
export function number(value: unknown): number | null {
  if (typeof value !== 'number' && !(typeof value === 'string' && value.trim() && /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/iu.test(value.trim()))) return null;
  const result = Number(value); return Number.isFinite(result) ? result : null;
}
export function firstNumber(...values: unknown[]): number | null { for (const value of values) { const result = number(value); if (result !== null) return result; } return null; }
export function text(...values: unknown[]): string | null { return values.find((value): value is string => typeof value === 'string' && Boolean(value.trim()))?.trim() ?? null; }
export function key(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 256 || value.trim() !== value || [...value].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw new HealthPayloadError('invalid_identifier');
  return value;
}
export function name(value: unknown): string { return (text(value) ?? '').replace(/([a-z0-9])([A-Z])/gu, '$1_$2').replace(/[^a-zA-Z0-9]+/gu, '_').replace(/^_+|_+$/gu, '').toLowerCase(); }
export function rounded(value: number | null): number | null {
  if (value === null) return null;
  const result = Math.round(value * 1e6) / 1e6;
  if (!Number.isFinite(result)) throw new HealthPayloadError('invalid_payload');
  return result;
}
export function sum(values: (number | null)[]): number | null { const valid = values.filter((v): v is number => v !== null); return valid.length ? rounded(valid.reduce((a, b) => a + b, 0)) : null; }
export function mean(values: (number | null)[]): number | null { const valid = values.filter((v): v is number => v !== null); return valid.length ? rounded(valid.reduce((a, b) => a + b / valid.length, 0)) : null; }
export function extreme(values: (number | null)[], kind: 'min' | 'max'): number | null {
  const valid = values.filter((v): v is number => v !== null);
  return valid.length ? rounded(valid.reduce((a, b) => kind === 'min' ? Math.min(a, b) : Math.max(a, b))) : null;
}
export function dateOnly(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || value.startsWith('0000-')) throw new HealthPayloadError('invalid_timestamp');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new HealthPayloadError('invalid_timestamp');
  return value;
}
/** HAE offsets are explicit. Never let the host's local timezone reinterpret a timestamp. */
export function instant(value: unknown): string {
  if (typeof value !== 'string') throw new HealthPayloadError('invalid_timestamp');
  const normalized = value.trim().replace(' ', 'T').replace(/\s*([+-]\d{2})(\d{2})$/u, '$1:$2');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(normalized)) throw new HealthPayloadError('invalid_timestamp');
  dateOnly(normalized.slice(0, 10));
  if (Number(normalized.slice(11, 13)) > 23 || Number(normalized.slice(14, 16)) > 59 || Number(normalized.slice(17, 19)) > 59) throw new HealthPayloadError('invalid_timestamp');
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) throw new HealthPayloadError('invalid_timestamp');
  return parsed.toISOString();
}
const copenhagen = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' });
export function day(value: unknown): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)) return dateOnly(value);
  const parts = Object.fromEntries(copenhagen.formatToParts(new Date(instant(value))).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function optionalInstant(...values: unknown[]): string | null { const value = text(...values); return value ? instant(value) : null; }

const nutrition = new Set(['energy_consumed', 'water', 'caffeine', 'protein', 'carbohydrates', 'fiber', 'sugar', 'fat_total', 'total_fat', 'saturated_fat', 'monounsaturated_fat', 'polyunsaturated_fat', 'cholesterol', 'sodium', 'calcium', 'iron', 'potassium', 'magnesium', 'zinc', 'selenium', 'copper', 'manganese', 'chloride', 'iodine', 'phosphorus', 'biotin', 'folate', 'niacin', 'riboflavin', 'thiamin']);
export function isNutrition(value: unknown): boolean { const n = name(value); return nutrition.has(n) || /^(dietary|nutrition)(_|$)|^vitamin_[a-z0-9]+$/u.test(n); }
const spatial = new Set(['coordinate', 'coordinates', 'geo', 'geolocation', 'gps', 'lat', 'latitude', 'lng', 'location', 'locations', 'lon', 'longitude', 'route', 'routes']);
const classifications = new Set(['category', 'datatype', 'identifier', 'kind', 'metric', 'metricname', 'name', 'type']);
/** Preserve non-spatial workout details, but never copy GPS/routes or nutrition feedback into read models. */
export function sanitize(value: unknown): unknown {
  let nodes = 0;
  function visit(item: unknown, depth: number): unknown {
    if (++nodes > 100000 || depth > 20) throw new HealthPayloadError('payload_complexity');
    if (Array.isArray(item)) return item.map(child => visit(child, depth + 1)).filter(child => child !== undefined);
    if (!item || typeof item !== 'object') return item;
    const entries = Object.entries(item);
    if (entries.some(([k, v]) => classifications.has(name(k).replaceAll('_', '')) && isNutrition(v))) return undefined;
    return Object.fromEntries(entries.filter(([k]) => {
      const n = name(k); const compact = n.replaceAll('_', '');
      return !['__proto__', 'prototype', 'constructor'].includes(k) && !n.split('_').some(token => spatial.has(token)) &&
        !/coordinate|geolocation|gpsdata|locationdata|routedata|workoutroute|dietary|nutrition/u.test(compact);
    }).map(([k, v]) => [k, visit(v, depth + 1)]).filter(([, v]) => v !== undefined));
  }
  return visit(value, 0);
}
/** Normalize supported physical units; unknown dimensions retain their declared unit. */
export function unitConversion(metric: string, input: unknown): { unit: string | null; factor: number } {
  const declared = text(input); const u = declared?.toLowerCase().replaceAll(' ', '') ?? '';
  const energy = /energy|calories/u.test(metric);
  const mass = /^(body_mass|body_weight|weight|lean_body_mass)$/u.test(metric);
  const length = /distance|^height$|waist_circumference/u.test(metric);
  const sleep = metric === 'sleep_analysis';
  const bodyFat = metric === 'body_fat_percentage';
  // Rate metrics are not heart-rate variability (a duration, commonly milliseconds).
  const heartRate = ['heart_rate', 'resting_heart_rate', 'walking_heart_rate_average', 'avg_heart_rate', 'max_heart_rate', 'min_heart_rate', 'heart_rate_data', 'heart_rate_recovery'].includes(metric);
  // Do not guess whether ambiguous "cal" means thermochemical calories or food Calories.
  const mappings: Record<string, number> | null = energy ? { kcal: 1, kilocalories: 1, kj: 1 / 4.184, kilojoules: 1 / 4.184, j: 1 / 4184, joules: 1 / 4184 } :
    mass ? { kg: 1, kilograms: 1, g: 0.001, lb: 0.45359237, lbs: 0.45359237, pounds: 0.45359237 } :
      length ? { m: 1, meter: 1, meters: 1, km: 1000, kilometers: 1000, mi: 1609.344, miles: 1609.344, cm: 0.01, ft: 0.3048, feet: 0.3048, in: 0.0254 } :
        sleep ? { '': 1, h: 1, hr: 1, hrs: 1, hours: 1, min: 1 / 60, minutes: 1 / 60, s: 1 / 3600, sec: 1 / 3600, seconds: 1 / 3600 } :
          heartRate ? { bpm: 1, 'count/min': 1, 'beats/min': 1 } :
            bodyFat ? { '%': 1, percent: 1, fraction: 100, '1': 100 } : null;
  if (mappings) {
    if (!u && !sleep) return { unit: null, factor: 1 }; // Missing units stay unknown, never silently acquire a unit.
    const factor = Object.hasOwn(mappings, u) ? mappings[u] : undefined; if (factor === undefined) throw new HealthPayloadError('unsupported_unit');
    return { unit: energy ? 'kcal' : mass ? 'kg' : length ? 'm' : sleep ? 'h' : heartRate ? 'bpm' : '%', factor };
  }
  return { unit: declared, factor: 1 };
}
