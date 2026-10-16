/** Reserved native Daily views; these are not registered renderers or navigation. */
export const dailyViewIds = Object.freeze({
  status: 'daily-status',
  recomp: 'daily-recomp',
  review: 'daily-review',
  ready: 'daily-ready',
});
export const dailyModuleId = 'daily';
export const dailyContractVersion = 1;

export const dailyQuerySources = Object.freeze({
  metrics: 'daily.health.metrics',
  sleep: 'daily.health.sleep',
  workouts: 'daily.health.workouts',
  workout: 'daily.health.workout',
  heartRate: 'daily.health.heart-rate',
  meals: 'daily.nutrition.meals',
  sync: 'daily.sync',
});
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v, allowed) => Object.keys(v).every((key) => allowed.includes(key));
const key = (v) => typeof v === 'string' && v.length > 0 && v.length <= 256 &&
  v.trim() === v && ![...v].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const date = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(v) &&
  !v.startsWith('0000-') && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const instant = (v) => typeof v === 'string' && v.length <= 64 &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(v) &&
  date(v.slice(0, 10)) && Number(v.slice(11, 13)) < 24 && Number(v.slice(14, 16)) < 60 &&
  Number(v.slice(17, 19)) < 60 && Number.isFinite(Date.parse(v));

/** Reject selectors and cursor fields before framework coercion/removal can hide them. */
export function isDailyQuery(v) {
  if (!record(v) || !Object.values(dailyQuerySources).includes(v.source)) return false;
  if (Object.values(v).some(value => value === undefined)) return false;
  if (v.source === dailyQuerySources.sync) return keys(v, ['source']);
  if (v.source === dailyQuerySources.workout) return keys(v, ['source', 'workoutId']) && key(v.workoutId);
  const heartRate = v.source === dailyQuerySources.heartRate;
  const meals = v.source === dailyQuerySources.meals;
  if (!keys(v, heartRate ? ['source', 'workoutId', 'limit', 'cursor'] : ['source', 'startDate', 'endDate', 'limit', 'cursor'])) return false;
  if (v.limit !== undefined && (!Number.isInteger(v.limit) || v.limit < 1 || v.limit > (meals ? 100 : 500))) return false;
  if (heartRate ? !key(v.workoutId) : !date(v.startDate) || !date(v.endDate) ||
      v.endDate < v.startDate || Date.parse(v.endDate) - Date.parse(v.startDate) > 366 * 86400000) return false;
  if (v.cursor === undefined) return true;
  if (!record(v.cursor)) return false;
  if (heartRate) return keys(v.cursor, ['minute', 'metric']) && instant(v.cursor.minute) && key(v.cursor.metric);
  if (meals) return keys(v.cursor, ['createdAt', 'id']) && instant(v.cursor.createdAt) && key(v.cursor.id);
  return keys(v.cursor, ['date', 'key']) && date(v.cursor.date) && key(v.cursor.key) &&
    v.cursor.date >= v.startDate && v.cursor.date <= v.endDate;
}

export const dailyQuerySchema = Object.freeze({
  type: 'object',
  properties: {
    source: { type: 'string', enum: Object.values(dailyQuerySources) },
    startDate: { type: 'string', description: 'Inclusive Europe/Copenhagen calendar date, YYYY-MM-DD; required for history.' },
    endDate: { type: 'string', description: 'Inclusive calendar date; at most 366 days after startDate.' },
    workoutId: { type: 'string', maxLength: 256 },
    limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Meals allow at most 100; default 50.' },
    // Per-source validation deliberately runs on the original cursor, not Ajv-stripped fields.
    cursor: { type: 'object', additionalProperties: true, description: 'Replay exactly the previous result coverage.next cursor.' },
  },
  required: ['source'],
  additionalProperties: false,
});
