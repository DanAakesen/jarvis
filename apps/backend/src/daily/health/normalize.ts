import { day, extreme, firstNumber, HealthPayloadError, instant, isNutrition, key, mean, name, number, object, optionalInstant, optionalObject, rounded, sanitize, sum, text, unitConversion, type HealthObject } from './value.js';

export interface Metric extends HealthObject {
  metric_name: string; metric_date: string; unit: string | null; value: number | null; min_value: number | null;
  avg_value: number | null; max_value: number | null; sample_count: number; start_at: string | null; end_at: string | null; fields_json: HealthObject;
}
export interface NormalizedHealth {
  metrics: Metric[]; sleep: HealthObject[]; workouts: HealthObject[]; workoutMetrics: HealthObject[]; heartRateMinutes: HealthObject[];
  feedKinds: ('metrics' | 'workouts')[]; counts: Record<string, number>;
}
type Point = { row: HealthObject; unit: string | null; factor: number; order: string };
const metricStrategy = (n: string) => /(^|_)(body_mass|body_weight|weight|height|body_mass_index|bmi|body_fat_percentage|lean_body_mass|waist_circumference|temperature|blood_glucose)$/u.test(n) ? 'latest' :
  /(^|_)(step_count|flights_climbed|(active|basal|resting|total)_energy(_burned)?|(walking_running|walking_and_running|cycling|swimming|wheelchair)_distance|distance|(exercise|stand|move)_time|(swimming_)?stroke_count|push_count)$/u.test(n) ? 'sum' : 'average';
function stats(points: Point[], metric: string) {
  const scaled = (point: Point, ...keys: string[]) => { const v = firstNumber(...keys.map(k => point.row[k])); return v === null ? null : rounded(v * point.factor); };
  const values = points.map(p => scaled(p, 'qty', 'Avg', 'avg', 'average', 'value'));
  const strategy = metricStrategy(metric);
  const unit = points[0]?.unit ?? null;
  if (points.some(point => point.unit !== unit)) throw new HealthPayloadError('unsupported_unit');
  return { unit, value: strategy === 'latest' ? values.at(-1) ?? null : strategy === 'sum' ? sum(values) : mean(values),
    min_value: extreme(points.map(p => scaled(p, 'Min', 'min', 'minimum', 'qty', 'value')), 'min'),
    avg_value: mean(points.map(p => scaled(p, 'Avg', 'avg', 'average', 'qty', 'value'))),
    max_value: extreme(points.map(p => scaled(p, 'Max', 'max', 'maximum', 'qty', 'value')), 'max'), sample_count: points.length,
    fields_json: { aggregation: strategy, sources: [...new Set(points.map(p => text(p.row.source, p.row.sourceName)).filter(Boolean))],
      latest: points.at(-1)?.row ?? null, latest_value_is_source_units: true, latest_conversion_factor: points.at(-1)?.factor ?? null } };
}
function optionalRange(values: (string | null)[], end = false): string | null { const valid = values.filter((v): v is string => v !== null).sort(); return (end ? valid.at(-1) : valid[0]) ?? null; }
function samplePoints(samples: unknown[], metric: string, inputUnit?: unknown): Point[] {
  return samples.map(value => { const row = object(value); return { row, ...unitConversion(metric, text(row.units, row.unit, inputUnit)), order: text(row.date, row.endDate, row.startDate) ?? '' }; });
}
function sleepRows(groups: HealthObject[]): HealthObject[] {
  const nights = new Map<string, { aggregates: Point[]; segments: Point[] }>();
  for (const group of groups) for (const point of samplePoints(group.data as unknown[], 'sleep_analysis', text(group.units, group.unit))) {
    const r = point.row;
    const aggregate = ['totalSleep', 'asleep', 'core', 'deep', 'rem', 'awake', 'inBed'].some(k => number(r[k]) !== null) && !text(r.value);
    const date = day(aggregate ? text(r.date, r.sleepEnd, r.inBedEnd, r.endDate) : text(r.sleepEnd, r.inBedEnd, r.date, r.endDate));
    const night = nights.get(date) ?? { aggregates: [], segments: [] };
    (aggregate ? night.aggregates : night.segments).push(point); nights.set(date, night);
  }
  return [...nights].map(([sleep_date, night]) => {
    const all = [...night.aggregates, ...night.segments];
    const field = (k: string, states: string[]) => {
      const explicit = night.aggregates.map(p => { const v = number(p.row[k]); return v === null ? null : v * p.factor; });
      if (explicit.some(v => v !== null)) return extreme(explicit, 'max');
      const matching = night.segments.filter(p => states.includes(name(p.row.value)));
      return sum(matching.map(p => { const v = number(p.row.qty); return v === null ? null : v * p.factor; }));
    };
    for (const p of night.aggregates) for (const k of ['totalSleep', 'asleep', 'core', 'deep', 'rem', 'awake', 'inBed']) {
      const v = number(p.row[k]); if (v !== null && v < 0) throw new HealthPayloadError('invalid_payload');
    }
    for (const p of night.segments) if (!['core', 'deep', 'rem', 'asleep', 'unspecified', 'awake', 'in_bed', 'inbed'].includes(name(p.row.value)) || number(p.row.qty) === null || number(p.row.qty)! < 0) throw new HealthPayloadError('invalid_payload');
    const core = field('core', ['core']); const deep = field('deep', ['deep']); const rem = field('rem', ['rem']);
    const asleep = field('asleep', ['core', 'deep', 'rem', 'asleep', 'unspecified']);
    const total = field('totalSleep', ['core', 'deep', 'rem', 'asleep', 'unspecified']) ?? asleep ?? sum([core, deep, rem]);
    return { sleep_date, sleep_start: optionalRange(all.map(p => optionalInstant(p.row.sleepStart, p.row.inBedStart, p.row.startDate))),
      sleep_end: optionalRange(all.map(p => optionalInstant(p.row.sleepEnd, p.row.inBedEnd, p.row.endDate)), true),
      total_sleep_hours: total, asleep_hours: asleep ?? total, core_hours: core, deep_hours: deep, rem_hours: rem,
      awake_hours: field('awake', ['awake']), in_bed_hours: field('inBed', ['in_bed', 'inbed']),
      source_json: [...new Set(all.map(p => text(p.row.source, p.row.sourceName)).filter(Boolean))], segment_count: all.length };
  });
}
function quantity(value: unknown, metric: string): { value: number | null; unit: string | null } {
  const r = optionalObject(value); const v = firstNumber(r.qty, r.value); const conversion = unitConversion(metric, text(r.units, r.unit));
  return { value: v === null ? null : rounded(v * conversion.factor), unit: conversion.unit };
}
function firstQuantity(metric: string, ...values: unknown[]): { value: number | null; unit: string | null } {
  for (const value of values) {
    const row = optionalObject(value);
    if (firstNumber(row.qty, row.value) !== null) return quantity(row, metric);
  }
  return { value: null, unit: null };
}
function workoutHeartRate(direct: unknown, heart: HealthObject, field: 'avg' | 'max'): number | null {
  const flat = optionalObject(direct); const nested = optionalObject(heart[field]); const parentUnit = text(heart.units, heart.unit);
  // Preserve the original summary slots and precedence, including their implicit BPM contract.
  // Validate every declared rate unit, even on an unselected fallback; never infer a summary from a series.
  return firstNumber(...[
    { value: flat.qty, unit: text(flat.units, flat.unit) },
    { value: nested.qty, unit: text(nested.units, nested.unit, parentUnit) },
    { value: heart[field === 'avg' ? 'Avg' : 'Max'], unit: parentUnit },
    { value: heart[field], unit: parentUnit },
  ].map(({ value, unit }) => {
    const conversion = unitConversion('heart_rate', unit); const v = number(value);
    return v === null ? null : rounded(v * conversion.factor);
  }));
}
function workoutRows(input: unknown[], output: NormalizedHealth) {
  const seen = new Map<string, string>();
  for (const value of input) {
    const w = object(sanitize(value)); const id = key(w.id ?? w.uuid); const serialized = JSON.stringify(w);
    if (seen.has(id)) { if (seen.get(id) !== serialized) throw new HealthPayloadError('conflicting_workout'); continue; }
    seen.set(id, serialized);
    const workout_type = key(text(w.name, w.workoutType, w.activityType));
    const start_at = instant(text(w.start, w.startDate));
    const suppliedEnd = optionalInstant(w.end, w.endDate); let duration_seconds = firstNumber(w.duration, w.durationSeconds);
    if (duration_seconds === null && suppliedEnd) duration_seconds = (Date.parse(suppliedEnd) - Date.parse(start_at)) / 1000;
    if (duration_seconds === null || duration_seconds < 0 || duration_seconds > 604800) throw new HealthPayloadError('invalid_payload');
    const end_at = suppliedEnd ?? new Date(Date.parse(start_at) + duration_seconds * 1000).toISOString();
    if (end_at < start_at) throw new HealthPayloadError('invalid_timestamp');
    const active = firstQuantity('active_energy', w.activeEnergyBurned, w.activeEnergy, w.activeCalories, w.workoutCalories);
    const total = firstQuantity('total_energy', w.totalEnergy, w.totalEnergyBurned); const distance = quantity(w.distance, 'distance');
    const metadata = optionalObject(w.metadata); const heart = optionalObject(w.heartRate);
    const detail: HealthObject = { originalIdentity: Object.fromEntries(['name', 'workoutType', 'activityType', 'activityIdentifier', 'activityTypeIdentifier', 'workoutActivityType', 'identifier'].filter(k => w[k] !== undefined).map(k => [k, w[k]])) };
    const nestedSources: (string | null)[] = [];
    for (const [k, v] of Object.entries(w)) {
      if (['id', 'uuid', 'name', 'workoutType', 'activityType', 'start', 'startDate', 'end', 'endDate', 'duration', 'durationSeconds'].includes(k)) continue;
      const metric_name = key(name(k));
      if (Array.isArray(v)) {
        // Unknown non-sample detail remains detail, never a fabricated numeric series.
        if (!v.length || !v.every(item => item && typeof item === 'object' && !Array.isArray(item))) { detail[k] = v; continue; }
        const points = samplePoints(v, metric_name); nestedSources.push(...points.map(p => text(p.row.source, p.row.sourceName, p.row.device)));
        const summary = stats(points, metric_name);
        if (summary.value === null && summary.min_value === null && summary.max_value === null) { detail[k] = v; continue; }
        output.workoutMetrics.push({ workout_id: id, metric_name, ...summary });
        detail[k] = { ...summary, samples: points.length };
        if (['heart_rate_data', 'heart_rate_recovery'].includes(metric_name)) {
          const minutes = new Map<string, Point[]>();
          for (const point of points) { const minute = `${instant(point.row.date).slice(0, 16)}:00.000Z`; const bucket = minutes.get(minute) ?? []; bucket.push(point); minutes.set(minute, bucket); }
          for (const [sample_minute, bucket] of minutes) {
            const s = stats(bucket, metric_name);
            output.heartRateMinutes.push({ workout_id: id, metric_name, sample_minute, unit: s.unit, min_value: s.min_value, avg_value: s.avg_value, max_value: s.max_value,
              source_json: s.fields_json.sources, sample_count: bucket.length });
          }
        }
      } else {
        const q = quantity(v, metric_name);
        if (q.value !== null) output.workoutMetrics.push({ workout_id: id, metric_name, unit: q.unit, value: q.value, min_value: q.value, avg_value: q.value, max_value: q.value, sample_count: 1, fields_json: {} });
        detail[k] = v;
      }
    }
    output.workouts.push({ id, workout_type, activity_identifier: text(w.activityIdentifier, w.activityTypeIdentifier, w.workoutActivityType, w.identifier),
      workout_date: day(start_at), start_at, end_at, duration_seconds: rounded(duration_seconds), source_name: text(w.source, w.sourceName, w.device, metadata.source, metadata.sourceName, metadata.device, ...nestedSources),
      is_indoor: typeof w.isIndoor === 'boolean' ? w.isIndoor : null,
      active_energy_value: active.value, active_energy_unit: active.unit, total_energy_value: total.value, total_energy_unit: total.unit,
      distance_value: distance.value, distance_unit: distance.unit, avg_heart_rate: workoutHeartRate(w.avgHeartRate, heart, 'avg'),
      max_heart_rate: workoutHeartRate(w.maxHeartRate, heart, 'max'), detail_json: detail });
  }
}

/** HAE v2 contract derived from pure original code at 9e193554; no original fixtures/records copied. */
export function normalizeHealth(payload: unknown): NormalizedHealth {
  const raw = object(object(payload).data);
  const feedKinds = (['metrics', 'workouts'] as const).filter(k => raw[k] !== undefined);
  if (!feedKinds.length || feedKinds.some(k => !Array.isArray(raw[k]))) throw new HealthPayloadError('invalid_payload');
  // One bounded walk checks nesting/complexity before subsequent processing, including excluded content.
  sanitize(payload);
  const output: NormalizedHealth = { metrics: [], sleep: [], workouts: [], workoutMetrics: [], heartRateMinutes: [], feedKinds: [...feedKinds], counts: {} };
  const grouped = new Map<string, { metric: string; date: string; points: Point[] }>(); const sleeps: HealthObject[] = [];
  let excludedNutrition = 0;
  for (const item of (raw.metrics ?? []) as unknown[]) {
    const rawGroup = object(item); const metric = key(name(rawGroup.name));
    if (!Array.isArray(rawGroup.data)) throw new HealthPayloadError('invalid_payload');
    if (isNutrition(metric)) { excludedNutrition++; continue; } // Sites/Jarvis canonical meals, never Apple Health feedback.
    const group = object(sanitize(rawGroup));
    if (metric === 'sleep_analysis') sleeps.push(group);
    for (const point of samplePoints(group.data as unknown[], metric, text(group.units, group.unit))) {
      const sourceDate = text(point.row.date, point.row.endDate, point.row.sleepEnd, point.row.startDate); const date = day(sourceDate);
      point.order = sourceDate?.length === 10 ? `${date}T00:00:00.000Z` : instant(sourceDate);
      const groupKey = JSON.stringify([metric, date]); const bucket = grouped.get(groupKey) ?? { metric, date, points: [] }; bucket.points.push(point); grouped.set(groupKey, bucket);
    }
  }
  for (const bucket of grouped.values()) {
    bucket.points.sort((a, b) => a.order.localeCompare(b.order));
    output.metrics.push({ metric_name: bucket.metric, metric_date: bucket.date, ...stats(bucket.points, bucket.metric),
      start_at: optionalRange(bucket.points.map(p => optionalInstant(p.row.startDate, p.row.sleepStart))),
      end_at: optionalRange(bucket.points.map(p => optionalInstant(p.row.endDate, p.row.sleepEnd) ?? (p.row.date && String(p.row.date).length > 10 ? instant(p.row.date) : null)), true) });
  }
  output.sleep = sleepRows(sleeps); workoutRows((raw.workouts ?? []) as unknown[], output);
  const counts = { metrics: output.metrics.length, sleepNights: output.sleep.length, workouts: output.workouts.length, workoutMetrics: output.workoutMetrics.length, heartRateMinutes: output.heartRateMinutes.length };
  if (Object.values(counts).reduce((a, b) => a + b, 0) > 10000) throw new HealthPayloadError('payload_complexity');
  output.counts = { ...counts, excludedNutritionGroups: excludedNutrition };
  return output;
}
