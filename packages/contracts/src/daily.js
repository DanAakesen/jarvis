/** Reserved native Daily views; these are not registered renderers or navigation. */
export const dailyViewIds = Object.freeze({
  status: 'daily-status',
  recomp: 'daily-recomp',
  review: 'daily-review',
  ready: 'daily-ready',
});
export const dailyModuleId = 'daily';
export const dailyContractVersion = 1;

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
export const dailyQuerySourcesV1 = Object.freeze(Object.values(legacyQuerySources));
export const dailyCapabilitiesVersion = 5;
export const dailyCapabilitiesAccept = 'application/json;version=5, application/json;version=4, application/json;version=3, application/json;version=2, application/json';
export const dailyQuerySources = Object.freeze({
  ...legacyQuerySources,
  briefs: 'daily.briefs.history',
  brief: 'daily.briefs.detail',
  metricCatalog: 'daily.health.metric-catalog',
  days: 'daily.nutrition.days',
  attention: 'daily.attention',
  calendar: 'daily.calendar',
  trainingTargets: 'daily.health.training-targets',
});
export const dailyQuerySourcesV2 = Object.freeze([
  ...dailyQuerySourcesV1, dailyQuerySources.briefs, dailyQuerySources.brief,
]);
export const dailyQuerySourcesV3 = Object.freeze([
  ...dailyQuerySourcesV2, dailyQuerySources.metricCatalog, dailyQuerySources.days,
]);
export const dailyQuerySourcesV4 = Object.freeze([
  ...dailyQuerySourcesV3, dailyQuerySources.attention, dailyQuerySources.calendar,
]);
export const dailyQuerySourcesV5 = Object.freeze([...dailyQuerySourcesV4, dailyQuerySources.trainingTargets]);
export const dailyQuerySourcesV5WithoutFeeds = Object.freeze([...dailyQuerySourcesV3, dailyQuerySources.trainingTargets]);
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
export function isDailyQuery(v) {
  if (!record(v) || !Object.values(dailyQuerySources).includes(v.source)) return false;
  if (Object.values(v).some(value => value === undefined)) return false;
  if (v.source === dailyQuerySources.sync || v.source === dailyQuerySources.trainingTargets) return keys(v, ['source']);
  if (v.source === dailyQuerySources.attention) return keys(v, ['source']);
  if (v.source === dailyQuerySources.calendar) {
    if (!keys(v, ['source', 'from', 'to']) || !instant(v.from) || !instant(v.to)) return false;
    const range = Date.parse(v.to) - Date.parse(v.from);
    return range > 0 && range <= 62 * 86400000;
  }
  if (v.source === dailyQuerySources.workout) return keys(v, ['source', 'workoutId']) && key(v.workoutId);
  if (v.source === dailyQuerySources.brief) return keys(v, ['source', 'briefId']) && briefId(v.briefId);
  if (v.source === dailyQuerySources.briefs) {
    if (!keys(v, ['source', 'limit', 'cursor']) ||
        (v.limit !== undefined && (!Number.isInteger(v.limit) || v.limit < 1 || v.limit > 100))) return false;
    return v.cursor === undefined || (record(v.cursor) && keys(v.cursor, ['startedAt', 'id']) &&
      typeof v.cursor.startedAt === 'string' && v.cursor.startedAt.length <= 64 && briefId(v.cursor.id));
  }
  if (v.source === dailyQuerySources.favorites || v.source === dailyQuerySources.plans) {
    if (!keys(v, ['source', 'limit', 'cursor']) ||
        (v.limit !== undefined && (!Number.isInteger(v.limit) || v.limit < 1 || v.limit > 100))) return false;
    return v.cursor === undefined || (record(v.cursor) && keys(v.cursor, ['id']) && key(v.cursor.id));
  }
  const heartRate = v.source === dailyQuerySources.heartRate;
  const meals = v.source === dailyQuerySources.meals;
  const metricCatalog = v.source === dailyQuerySources.metricCatalog;
  const days = v.source === dailyQuerySources.days;
  const metric = v.source === dailyQuerySources.metrics;
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

export const dailyQuerySchema = Object.freeze({
  type: 'object',
  properties: {
    source: { type: 'string', enum: Object.values(dailyQuerySources) },
    startDate: { type: 'string', description: 'Inclusive Europe/Copenhagen date, YYYY-MM-DD; required for health/nutrition history, not briefs.' },
    endDate: { type: 'string', description: 'Inclusive calendar date; at most 366 days after startDate.' },
    from: { type: 'string', description: 'Inclusive ISO instant; only for daily.calendar. The range is at most 62 days.' },
    to: { type: 'string', description: 'Exclusive ISO instant; only for daily.calendar.' },
    metric: { type: 'string', minLength: 1, maxLength: 256, description: 'Metric_name key or its readable name; only for daily.health.metrics and daily.health.heart-rate. Applied before the row limit.' },
    workoutId: { type: 'string', maxLength: 256 },
    briefId: { type: 'string', minLength: 1, maxLength: 256, description: 'Exact returned legacy brief ID, without trimming; only for brief detail.' },
    limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Meals and brief history allow at most 100; daily.nutrition.days at most 400; default 50 (metric catalogue defaults to 100).' },
    // Per-source validation deliberately runs on the original cursor, not Ajv-stripped fields.
    cursor: { type: 'object', additionalProperties: true, description: 'Replay exactly the previous result coverage.next cursor.' },
  },
  required: ['source'],
  additionalProperties: false,
});
