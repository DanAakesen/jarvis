import { createHash } from 'node:crypto';

/** Wire contract of `POST /health/sync`, sent by the iPhone app. */
export interface DeviceSample { id: string; metric: string; unit: string; start: string; end: string; value: number; source: string | null }
export interface DeviceSleepSegment { id: string; stage: string; start: string; end: string; source: string | null }
export interface DeviceWorkout { id: string; activity: string; start: string; end: string; activeEnergyKcal: number | null; distanceMetres: number | null }
export interface DeviceSyncBatch {
  anchor: string | null;
  samples: DeviceSample[];
  sleep: DeviceSleepSegment[];
  workouts: DeviceWorkout[];
}
export type DeviceSyncParse = { ok: true; value: DeviceSyncBatch } | { ok: false; reason: string };

export const deviceSyncAutomationId = 'jarvis-ios';
export const maxDeviceSyncItems = 20_000;
const stages = new Set(['core', 'deep', 'rem', 'asleep', 'awake', 'in_bed']);
const identifier = /^[\w.-]{1,128}$/u;
const metricName = /^[a-z][a-z0-9_]{0,95}$/u;
const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12;
const instant = (value: unknown): string | null => {
  if (typeof value !== 'string' || !isoInstant.test(value)) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
};
const optionalText = (value: unknown): string | null | undefined =>
  value === undefined || value === null ? null : typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : undefined;

type Row = Record<string, unknown>;
function rows(value: unknown): Row[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxDeviceSyncItems) return null;
  const parsed = value.map(record);
  return parsed.every((row): row is Row => row !== null) ? parsed : null;
}
function range(row: Row): { start: string; end: string } | null {
  const start = instant(row.start); const end = instant(row.end);
  return start && end && end >= start ? { start, end } : null;
}
/** Identical repeats collapse; the same id carrying different content is a conflict. */
function unique<T extends { id: string }>(items: T[]): T[] | null {
  const seen = new Map<string, string>();
  const output: T[] = [];
  for (const item of items) {
    const serialized = JSON.stringify(item);
    const prior = seen.get(item.id);
    if (prior === undefined) { seen.set(item.id, serialized); output.push(item); } else if (prior !== serialized) return null;
  }
  return output;
}

export function parseDeviceSync(body: unknown): DeviceSyncParse {
  const root = record(body);
  if (!root || Object.keys(root).some(key => !['anchor', 'samples', 'sleep', 'workouts'].includes(key))) return { ok: false, reason: 'Invalid Health sync request.' };
  const anchor = root.anchor === undefined || root.anchor === null ? null : instant(root.anchor);
  if (root.anchor !== undefined && root.anchor !== null && anchor === null) return { ok: false, reason: 'Invalid sync anchor.' };
  const rawSamples = rows(root.samples); const rawSleep = rows(root.sleep); const rawWorkouts = rows(root.workouts);
  if (!rawSamples || !rawSleep || !rawWorkouts) return { ok: false, reason: 'Invalid Health sync request.' };
  if (rawSamples.length + rawSleep.length + rawWorkouts.length > maxDeviceSyncItems) return { ok: false, reason: 'Too many Health samples.' };

  const samples: DeviceSample[] = [];
  for (const row of rawSamples) {
    const times = range(row); const source = optionalText(row.source);
    if (typeof row.id !== 'string' || !identifier.test(row.id) || typeof row.metric !== 'string' || !metricName.test(row.metric) ||
        typeof row.unit !== 'string' || row.unit.length < 1 || row.unit.length > 32 || !times || !finite(row.value) || source === undefined) {
      return { ok: false, reason: 'Invalid Health sample.' };
    }
    samples.push({ id: row.id, metric: row.metric, unit: row.unit, ...times, value: row.value, source });
  }
  const sleep: DeviceSleepSegment[] = [];
  for (const row of rawSleep) {
    const times = range(row); const source = optionalText(row.source);
    if (typeof row.id !== 'string' || !identifier.test(row.id) || typeof row.stage !== 'string' || !stages.has(row.stage) || !times || source === undefined) {
      return { ok: false, reason: 'Invalid sleep segment.' };
    }
    sleep.push({ id: row.id, stage: row.stage, ...times, source });
  }
  const workouts: DeviceWorkout[] = [];
  for (const row of rawWorkouts) {
    const times = range(row);
    const energy = row.activeEnergyKcal ?? null; const distance = row.distanceMetres ?? null;
    if (typeof row.id !== 'string' || !identifier.test(row.id) || typeof row.activity !== 'string' || row.activity.length < 1 || row.activity.length > 100 || !times ||
        (energy !== null && (!finite(energy) || energy < 0)) || (distance !== null && (!finite(distance) || distance < 0))) {
      return { ok: false, reason: 'Invalid workout.' };
    }
    workouts.push({ id: row.id, activity: row.activity, ...times, activeEnergyKcal: energy, distanceMetres: distance });
  }
  const dedupedSamples = unique(samples); const dedupedSleep = unique(sleep); const dedupedWorkouts = unique(workouts);
  if (!dedupedSamples || !dedupedSleep || !dedupedWorkouts) return { ok: false, reason: 'Conflicting Health sample ids.' };
  if (!dedupedSamples.length && !dedupedSleep.length && !dedupedWorkouts.length) return { ok: false, reason: 'Nothing to sync.' };
  const byId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return { ok: true, value: { anchor, samples: dedupedSamples.sort(byId), sleep: dedupedSleep.sort(byId), workouts: dedupedWorkouts.sort(byId) } };
}

/** Same samples give the same id, whichever order or repeats the device sent, so a retry is a replay. */
export function deviceSyncId(batch: DeviceSyncBatch): string {
  return `ios-${createHash('sha256').update(JSON.stringify({ samples: batch.samples, sleep: batch.sleep, workouts: batch.workouts })).digest('hex')}`;
}

/** Health Auto Export-shaped payload, so the existing normaliser and tables are reused unchanged. */
export function deviceSyncPayload(batch: DeviceSyncBatch): unknown {
  const groups = new Map<string, DeviceSample[]>();
  for (const sample of batch.samples) {
    const key = `${sample.metric}\u0000${sample.unit}`;
    groups.set(key, [...(groups.get(key) ?? []), sample]);
  }
  const metrics: unknown[] = [...groups.values()].map(group => ({
    name: group[0]!.metric, units: group[0]!.unit,
    data: group.map(sample => ({ date: sample.start, endDate: sample.end, qty: sample.value, ...(sample.source ? { source: sample.source } : {}) })),
  }));
  if (batch.sleep.length) {
    metrics.push({
      name: 'sleep_analysis', units: 'hr',
      data: batch.sleep.map(segment => ({
        startDate: segment.start, endDate: segment.end, date: segment.end, value: segment.stage,
        qty: (Date.parse(segment.end) - Date.parse(segment.start)) / 3_600_000, ...(segment.source ? { source: segment.source } : {}),
      })),
    });
  }
  const workouts = batch.workouts.map(workout => ({
    id: workout.id, name: workout.activity, start: workout.start, end: workout.end,
    duration: (Date.parse(workout.end) - Date.parse(workout.start)) / 1000,
    ...(workout.activeEnergyKcal !== null ? { activeEnergyBurned: { qty: workout.activeEnergyKcal, units: 'kcal' } } : {}),
    ...(workout.distanceMetres !== null ? { distance: { qty: workout.distanceMetres / 1000, units: 'km' } } : {}),
  }));
  return { data: { ...(metrics.length ? { metrics } : {}), ...(workouts.length ? { workouts } : {}) } };
}
