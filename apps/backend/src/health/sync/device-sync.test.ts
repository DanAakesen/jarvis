import { describe, expect, it } from 'vitest';
import { normalizeHealth } from '../health/normalize.js';
import { deviceSyncId, deviceSyncPayload, maxDeviceSyncItems, parseDeviceSync, type DeviceSyncBatch } from './device-sync.js';

const sample = (id: string, extra: Record<string, unknown> = {}) => ({
  id, metric: 'step_count', unit: 'count', start: '2026-11-04T08:00:00.000Z', end: '2026-11-04T08:05:00.000Z', value: 120, source: 'iPhone', ...extra,
});
const body = () => ({
  anchor: '2026-11-04T00:00:00.000Z',
  samples: [sample('a'), sample('b', { start: '2026-11-04T09:00:00.000Z', end: '2026-11-04T09:05:00.000Z', value: 30 })],
  sleep: [{ id: 's1', stage: 'deep', start: '2026-11-03T22:00:00.000Z', end: '2026-11-03T23:00:00.000Z' }],
  workouts: [{ id: 'w1', activity: 'Running', start: '2026-11-04T06:00:00.000Z', end: '2026-11-04T06:30:00.000Z', activeEnergyKcal: 250, distanceMetres: 5000 }],
});
const parse = (value: unknown): DeviceSyncBatch => {
  const result = parseDeviceSync(value);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
};

describe('parseDeviceSync validation', () => {
  it('accepts a well-formed batch and normalises instants', () => {
    const batch = parse(body());
    expect(batch.samples).toHaveLength(2);
    expect(batch.workouts[0]).toMatchObject({ id: 'w1', activeEnergyKcal: 250, distanceMetres: 5000 });
    expect(batch.anchor).toBe('2026-11-04T00:00:00.000Z');
  });

  it.each([
    ['non-object', 'x'],
    ['unknown key', { ...body(), owner: 'someone' }],
    ['bad anchor', { ...body(), anchor: 'yesterday' }],
    ['empty batch', { samples: [], sleep: [], workouts: [] }],
    ['bad metric name', { samples: [sample('a', { metric: 'Bad Metric' })] }],
    ['non-finite value', { samples: [sample('a', { value: null })] }],
    ['end before start', { samples: [sample('a', { end: '2026-11-04T07:00:00.000Z' })] }],
    ['bad id', { samples: [sample('has space')] }],
    ['unknown sleep stage', { sleep: [{ id: 's', stage: 'nap', start: '2026-11-03T22:00:00Z', end: '2026-11-03T23:00:00Z' }] }],
    ['negative workout energy', { workouts: [{ id: 'w', activity: 'Run', start: '2026-11-04T06:00:00Z', end: '2026-11-04T06:30:00Z', activeEnergyKcal: -1 }] }],
    ['same id with different content', { samples: [sample('a'), sample('a', { value: 1 })] }],
    ['too many items', { samples: Array.from({ length: maxDeviceSyncItems + 1 }, (_, index) => sample(`id${index}`)) }],
  ])('rejects %s', (_name, value) => {
    expect(parseDeviceSync(value).ok).toBe(false);
  });
});

describe('merged HealthKit day totals and local workout dates', () => {
  it('preserves the merged total instead of summing overlapping iPhone and Watch samples', () => {
    const rawSources = normalizeHealth(deviceSyncPayload(parse({ samples: [
      sample('phone', { value: 600, source: 'iPhone' }),
      sample('watch', { value: 600, source: 'Apple Watch' }),
    ] })));
    expect(rawSources.metrics[0]?.value).toBe(1200); // Reproduces the former raw-sample upload bug.
    const corrected = normalizeHealth(deviceSyncPayload(parse({ samples: [sample('steps-1793746800', {
      start: '2026-11-03T23:00:00Z', end: '2026-11-04T23:00:00Z',
      value: 600, source: 'Apple Health merged statistics',
    })] })));
    expect(corrected.metrics[0]).toMatchObject({ metric_date: '2026-11-04', value: 600, sample_count: 1 });
  });

  it('converts the HealthKit body-fat fraction into the stored percentage', () => {
    const normalized = normalizeHealth(deviceSyncPayload(parse({ samples: [sample('body-fat', {
      metric: 'body_fat_percentage', unit: 'fraction', value: 0.2,
    })] })));
    expect(normalized.metrics[0]).toMatchObject({ metric_name: 'body_fat_percentage', value: 20, unit: '%' });
  });

  it('keeps a workout near UTC midnight on its Copenhagen date through sync normalization', () => {
    const normalized = normalizeHealth(deviceSyncPayload(parse({ workouts: [{
      id: 'boundary', activity: 'traditional_strength_training',
      start: '2026-11-01T23:30:00Z', end: '2026-11-02T00:15:00Z',
    }] })));
    expect(normalized.workouts[0]).toMatchObject({ workout_date: '2026-11-02', duration_seconds: 2700 });
  });
});

describe('idempotency', () => {
  it('derives the same id for reordered and repeated samples', () => {
    const original = body();
    const shuffled = { ...original, samples: [original.samples[1], original.samples[0], original.samples[0]] };
    expect(deviceSyncId(parse(shuffled))).toBe(deviceSyncId(parse(original)));
  });

  it('derives a new id when a sample changes or is added', () => {
    const original = deviceSyncId(parse(body()));
    expect(deviceSyncId(parse({ ...body(), samples: [sample('a', { value: 121 })] }))).not.toBe(original);
    expect(deviceSyncId(parse({ ...body(), samples: [...body().samples, sample('c')] }))).not.toBe(original);
  });

  it('builds a payload the existing normaliser accepts, one row per metric day and workout id', () => {
    const normalized = normalizeHealth(deviceSyncPayload(parse(body())));
    const steps = normalized.metrics.find(row => row.metric_name === 'step_count');
    expect(steps).toMatchObject({ metric_date: '2026-11-04', value: 150, sample_count: 2 });
    expect(normalized.workouts).toHaveLength(1);
    expect(normalized.workouts[0]).toMatchObject({ id: 'w1', distance_unit: 'm', distance_value: 5000 });
    expect(normalized.sleep).toHaveLength(1);
    expect(normalizeHealth(deviceSyncPayload(parse(body())))).toEqual(normalized);
  });

  it('keeps the workout feed out of a metrics-only batch', () => {
    const normalized = normalizeHealth(deviceSyncPayload(parse({ samples: [sample('a')] })));
    expect(normalized.feedKinds).toEqual(['metrics']);
  });
});

describe('all-day activity provenance', () => {
  it('keeps non-workout activity, true zero and latest merged day without raw-source double counting', () => {
    const batch = parse({ samples: [
      sample('energy-early', { metric: 'active_energy_burned', unit: 'kcal', value: 200, aggregation: 'daily_total',
        start: '2026-11-03T23:00:00Z', end: '2026-11-04T10:00:00Z' }),
      sample('energy-late', { metric: 'active_energy_burned', unit: 'kcal', value: 420, aggregation: 'daily_total',
        start: '2026-11-03T23:00:00Z', end: '2026-11-04T15:00:00Z' }),
      sample('energy-watch', { metric: 'active_energy_burned', unit: 'kcal', value: 400, source: 'Watch' }),
      sample('exercise', { metric: 'apple_exercise_time', unit: 'min', value: 24, aggregation: 'daily_total' }),
      sample('zero', { metric: 'active_energy_burned', unit: 'kcal', value: 0, aggregation: 'daily_total',
        start: '2026-11-04T23:00:00Z', end: '2026-11-05T12:00:00Z' }),
    ] });
    const result = normalizeHealth(deviceSyncPayload(batch));
    expect(result.workouts).toHaveLength(0);
    expect(result.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric_name: 'active_energy_burned', metric_date: '2026-11-04', value: 420 }),
      expect.objectContaining({ metric_name: 'apple_exercise_time', value: 24 }),
      expect.objectContaining({ metric_name: 'active_energy_burned', metric_date: '2026-11-05', value: 0 }),
    ]));
    expect(deviceSyncId(batch)).toBe(deviceSyncId(parse({ samples: [...batch.samples].reverse() })));
  });
  it('rejects invented aggregation and negative daily totals', () => {
    expect(parseDeviceSync({ samples: [sample('invalid', { aggregation: 'sum' })] }).ok).toBe(false);
    expect(parseDeviceSync({ samples: [sample('invalid', { aggregation: 'daily_total', value: -1 })] }).ok).toBe(false);
  });
});
