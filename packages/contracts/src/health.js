/** Reserved native Health views; these are not registered renderers or navigation. */
export const healthViewIds = Object.freeze({
  status: 'health-status',
  recomp: 'health-recomp',
  review: 'health-review',
  ready: 'health-ready',
});
export const healthModuleId = 'health';
export const healthContractVersion = 1;

const legacyQuerySources = Object.freeze({
  metrics: 'daily.health.metrics',
  sleep: 'daily.health.sleep',
  workouts: 'daily.health.workouts',
  workout: 'daily.health.workout',
  heartRate: 'daily.health.heart-rate',
  meals: 'daily.nutrition.meals',
  favorites: 'daily.nutrition.favorites',
  plans: 'daily.nutrition.plans',
  sync: 'daily.sync',
});
export const healthQuerySourcesV1 = Object.freeze(Object.values(legacyQuerySources));
export const healthCapabilitiesVersion = 6;
export const healthCapabilitiesAccept = 'application/json;version=6, application/json;version=5, application/json;version=4, application/json;version=3, application/json;version=2, application/json';
export const healthQuerySources = Object.freeze({
  ...legacyQuerySources,
  briefs: 'daily.briefs.history',
  brief: 'daily.briefs.detail',
  metricCatalog: 'daily.health.metric-catalog',
  days: 'daily.nutrition.days',
  trainingTargets: 'daily.health.training-targets',
  lifts: 'daily.health.lifts',
});
export const healthQuerySourcesV2 = Object.freeze([
  ...healthQuerySourcesV1, healthQuerySources.briefs, healthQuerySources.brief,
]);
export const healthQuerySourcesV3 = Object.freeze([
  ...healthQuerySourcesV2, healthQuerySources.metricCatalog, healthQuerySources.days,
]);
export const healthQuerySourcesV5 = Object.freeze([...healthQuerySourcesV3, healthQuerySources.trainingTargets]);
export const healthQuerySourcesV6 = Object.freeze([...healthQuerySourcesV5, healthQuerySources.lifts]);
export const healthQuerySourcesV6WithoutTrainingTargets = Object.freeze([...healthQuerySourcesV3, healthQuerySources.lifts]);
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v, allowed) => Object.keys(v).every((key) => allowed.includes(key));
const key = (v) => typeof v === 'string' && v.length > 0 && v.length <= 256 &&
  v.trim() === v && ![...v].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const briefId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 256;
const date = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(v) &&
  !v.startsWith('0000-') && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const instant = (v) => typeof v === 'string' && v.length <= 64 &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(v) &&
  date(v.slice(0, 10)) && Number(v.slice(11, 13)) < 24 && Number(v.slice(14, 16)) < 60 &&
  Number(v.slice(17, 19)) < 60 && Number.isFinite(Date.parse(v));

/** Reject selectors and cursor fields before framework coercion/removal can hide them. */
export function isHealthQuery(v) {
  if (!record(v) || !Object.values(healthQuerySources).includes(v.source)) return false;
  if (Object.values(v).some(value => value === undefined)) return false;
  if (v.source === healthQuerySources.sync || v.source === healthQuerySources.trainingTargets) return keys(v, ['source']);
  if (v.source === healthQuerySources.lifts) {
    if (!keys(v, ['source', 'limit', 'cursor', 'lastPerExercise']) ||
        v.limit !== undefined && (!Number.isInteger(v.limit) || v.limit < 1 || v.limit > 100) ||
        v.lastPerExercise !== undefined && typeof v.lastPerExercise !== 'boolean') return false;
    return v.cursor === undefined || (record(v.cursor) && keys(v.cursor, ['performedAt', 'id']) &&
      instant(v.cursor.performedAt) && key(v.cursor.id));
  }
  if (v.source === healthQuerySources.workout) return keys(v, ['source', 'workoutId']) && key(v.workoutId);
  if (v.source === healthQuerySources.brief) return keys(v, ['source', 'briefId']) && briefId(v.briefId);
  if (v.source === healthQuerySources.briefs) {
    if (!keys(v, ['source', 'limit', 'cursor']) ||
        (v.limit !== undefined && (!Number.isInteger(v.limit) || v.limit < 1 || v.limit > 100))) return false;
    return v.cursor === undefined || (record(v.cursor) && keys(v.cursor, ['startedAt', 'id']) &&
      typeof v.cursor.startedAt === 'string' && v.cursor.startedAt.length <= 64 && briefId(v.cursor.id));
  }
  if (v.source === healthQuerySources.favorites || v.source === healthQuerySources.plans) {
    if (!keys(v, ['source', 'limit', 'cursor']) ||
        (v.limit !== undefined && (!Number.isInteger(v.limit) || v.limit < 1 || v.limit > 100))) return false;
    return v.cursor === undefined || (record(v.cursor) && keys(v.cursor, ['id']) && key(v.cursor.id));
  }
  const heartRate = v.source === healthQuerySources.heartRate;
  const meals = v.source === healthQuerySources.meals;
  const metricCatalog = v.source === healthQuerySources.metricCatalog;
  const days = v.source === healthQuerySources.days;
  const metric = v.source === healthQuerySources.metrics;
  const allowed = heartRate ? ['source', 'workoutId', 'metric', 'limit', 'cursor']
    : ['source', 'startDate', 'endDate', 'limit', 'cursor',
      ...(metric ? ['metric'] : [])];
  if (!keys(v, allowed)) return false;
  const maxLimit = meals ? 100 : metricCatalog ? 500 : days ? 400 : 500;
  if (v.limit !== undefined && (!Number.isInteger(v.limit) || v.limit < 1 || v.limit > maxLimit)) return false;
  if ((metric || heartRate) && v.metric !== undefined && !key(v.metric)) return false;
  if (heartRate ? !key(v.workoutId) : !date(v.startDate) || !date(v.endDate) ||
      v.endDate < v.startDate || Date.parse(v.endDate) - Date.parse(v.startDate) > 366 * 86400000) return false;
  if (v.cursor === undefined) return true;
  if (!record(v.cursor)) return false;
  if (heartRate) return keys(v.cursor, ['minute', 'metric']) && instant(v.cursor.minute) && key(v.cursor.metric);
  if (meals) return keys(v.cursor, ['createdAt', 'id']) && instant(v.cursor.createdAt) && key(v.cursor.id);
  if (metricCatalog) return keys(v.cursor, ['key']) && key(v.cursor.key);
  if (days) return keys(v.cursor, ['date']) && date(v.cursor.date) &&
    v.cursor.date >= v.startDate && v.cursor.date <= v.endDate;
  return keys(v.cursor, ['date', 'key']) && date(v.cursor.date) && key(v.cursor.key) &&
    v.cursor.date >= v.startDate && v.cursor.date <= v.endDate;
}

export const healthQuerySchema = Object.freeze({
  type: 'object',
  properties: {
    source: { type: 'string', enum: Object.values(healthQuerySources) },
    startDate: { type: 'string', description: 'Inclusive Europe/Copenhagen date, YYYY-MM-DD; required for health/nutrition history, not briefs.' },
    endDate: { type: 'string', description: 'Inclusive calendar date; at most 366 days after startDate.' },
    metric: { type: 'string', minLength: 1, maxLength: 256, description: 'Metric_name key or its readable name; only for daily.health.metrics and daily.health.heart-rate. Applied before the row limit.' },
    workoutId: { type: 'string', maxLength: 256 },
    briefId: { type: 'string', minLength: 1, maxLength: 256, description: 'Exact returned legacy brief ID, without trimming; only for brief detail.' },
    limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Meals and brief history allow at most 100; daily.nutrition.days at most 400; default 50 (metric catalogue defaults to 100).' },
    // Per-source validation deliberately runs on the original cursor, not Ajv-stripped fields.
    cursor: { type: 'object', additionalProperties: true, description: 'Replay exactly the previous result coverage.next cursor.' },
    lastPerExercise: { type: 'boolean', description: 'For daily.health.lifts, return the latest non-deleted entry per exercise.' },
  },
  required: ['source'],
  additionalProperties: false,
});
