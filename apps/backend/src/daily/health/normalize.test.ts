import { describe, expect, it } from 'vitest';
import { normalizeHealth } from './normalize.js';
import { validateNormalized } from './persistence.js';
import { day, HealthPayloadError, instant, number, sanitize } from './value.js';

const metric = (name: string, units: string, data: unknown[]) => ({ name, units, data });
const point = (qty: unknown, date = '2026-10-13 10:00:00 +0200') => ({ qty, date });
const workout = (id = 'synthetic-workout') => ({ id, name: 'Traditional Strength Training', start: '2026-10-13 10:00:00 +0200', duration: 3600, source: 'Synthetic Watch',
  activeEnergyBurned: { qty: 418.4, units: 'kJ' }, distance: { qty: 1, units: 'mi' }, metadata: { label: 'synthetic', gpsData: [{ lat: 1, lon: 2 }] },
  heartRateData: [{ date: '2026-10-13 10:00:10 +0200', qty: 100, units: 'bpm' }, { date: '2026-10-13 10:00:50 +0200', qty: 120, units: 'bpm' }] });

describe('source-shaped synthetic health normalization', () => {
  it('preserves factual zero while null, empty strings, booleans and absent numbers remain unknown', () => {
    for (const value of [null, undefined, '', ' ', false, true, [], {}, 'Infinity']) expect(number(value)).toBeNull();
    expect(number('0')).toBe(0); expect(number(0)).toBe(0);
    const output = normalizeHealth({ data: { metrics: [metric('bodyMass', 'kg', [point(null)])] } });
    expect(output.metrics[0]).toMatchObject({ value: null, min_value: null, avg_value: null, max_value: null });
  });
  it('converts physical units, combines day snapshots, and uses the latest timestamp rather than array order', () => {
    const output = normalizeHealth({ data: { metrics: [metric('active_energy', 'kJ', [point(418.4), point(41.84)]),
      metric('body_mass', 'lb', [point(200, '2026-10-13T20:00:00Z'), point(180, '2026-10-13T06:00:00Z')]),
      metric('walking_running_distance', 'km', [point(2)]), metric('body_fat_percentage', 'fraction', [point(0.2)])] } });
    expect(output.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric_name: 'active_energy', value: 110, unit: 'kcal' }),
      expect.objectContaining({ metric_name: 'body_mass', value: 90.718474, unit: 'kg' }),
      expect.objectContaining({ metric_name: 'walking_running_distance', value: 2000, unit: 'm' }),
      expect.objectContaining({ metric_name: 'body_fat_percentage', value: 20, unit: '%' }),
    ]));
    validateNormalized(output);
  });
  it('uses Copenhagen days across summer, winter and the DST fold, independent of host timezone', () => {
    expect(day('2026-07-01T22:30:00Z')).toBe('2026-07-02');
    expect(day('2026-12-01T23:30:00Z')).toBe('2026-12-02');
    expect(day('2026-10-25 02:30:00 +0200')).toBe('2026-10-25');
    expect(instant('2026-10-25 02:30:00 +0100')).not.toBe(instant('2026-10-25 02:30:00 +0200'));
    expect(day('2026-10-13')).toBe('2026-10-13');
  });
  it('rejects rolled-over dates, ambiguous offset-free times and malformed feed arrays', () => {
    for (const value of ['2026-02-30', '2026-10-13T10:00:00', '2026-10-13T25:00:00Z']) expect(() => day(value)).toThrow(HealthPayloadError);
    for (const payload of [{}, { data: {} }, { data: { workouts: null } }, { data: { metrics: [null] } }]) expect(() => normalizeHealth(payload)).toThrow(HealthPayloadError);
  });
  it('keeps unknown units unknown and refuses unsupported or mixed canonical units', () => {
    expect(normalizeHealth({ data: { metrics: [{ name: 'body_mass', data: [point(75)] }] } }).metrics[0]?.unit).toBeNull();
    expect(() => normalizeHealth({ data: { metrics: [metric('body_mass', 'made-up', [point(75)])] } })).toThrow('unsupported_unit');
    expect(() => normalizeHealth({ data: { metrics: [metric('active_energy', 'cal', [point(75)])] } })).toThrow('unsupported_unit');
    expect(() => normalizeHealth({ data: { metrics: [metric('body_mass', 'kg', [point(75)]), { name: 'body_mass', data: [point(75)] }] } })).toThrow('unsupported_unit');
  });
  it('keeps sleep assigned to its wake day and converts segment minutes to hours without double counting aggregates', () => {
    const output = normalizeHealth({ data: { metrics: [metric('sleep_analysis', 'min', [
      { value: 'core', qty: 180, date: '2026-10-14', startDate: '2026-10-13T22:00:00Z', endDate: '2026-10-14T01:00:00Z' },
      { value: 'deep', qty: 60, date: '2026-10-14', startDate: '2026-10-14T01:00:00Z', endDate: '2026-10-14T02:00:00Z' },
      { totalSleep: 240, core: 180, deep: 60, date: '2026-10-14', sleepStart: '2026-10-13T22:00:00Z', sleepEnd: '2026-10-14T02:00:00Z' },
    ])] } });
    expect(output.sleep[0]).toMatchObject({ sleep_date: '2026-10-14', total_sleep_hours: 4, core_hours: 3, deep_hours: 1, rem_hours: null, asleep_hours: 4 });
    expect(output.sleep[0]?.sleep_start).toBe('2026-10-13T22:00:00.000Z');
  });
  it('preserves two same-day workout identities, details and exact UTC minute HR aggregates', () => {
    const output = normalizeHealth({ data: { workouts: [workout('one'), workout('two')] } });
    expect(output.workouts).toHaveLength(2); expect(output.heartRateMinutes).toHaveLength(2);
    expect(output.workouts[0]).toMatchObject({ id: 'one', workout_date: '2026-10-13', active_energy_value: 100, active_energy_unit: 'kcal', distance_value: 1609.344, distance_unit: 'm' });
    expect(output.heartRateMinutes[0]).toMatchObject({ sample_minute: '2026-10-13T08:00:00.000Z', min_value: 100, avg_value: 110, max_value: 120, sample_count: 2 });
    expect(JSON.stringify(output)).not.toMatch(/gpsData|"lat"|"lon"/u);
    expect(output.workouts[0]?.detail_json).toMatchObject({ metadata: { label: 'synthetic' } });
    validateNormalized(output);
  });
  it('deduplicates identical workout IDs in one export but refuses changed duplicates', () => {
    expect(normalizeHealth({ data: { workouts: [workout(), workout()] } }).workouts).toHaveLength(1);
    expect(() => normalizeHealth({ data: { workouts: [workout(), { ...workout(), duration: 1 }] } })).toThrow('conflicting_workout');
  });
  it('accepts explicitly empty exports and never invents measurement values', () => {
    expect(normalizeHealth({ data: { workouts: [] } })).toMatchObject({ workouts: [], feedKinds: ['workouts'], counts: { workouts: 0 } });
    expect(normalizeHealth({ data: { metrics: [] } }).metrics).toEqual([]);
  });
  it('excludes Apple Health nutrition and nested spatial/nutrition data without modifying input', () => {
    const payload = { data: { metrics: [metric('dietary_energy', 'kcal', [point(100)]), metric('protein', 'g', [point(20)])], workouts: [workout()] } };
    const before = JSON.stringify(payload); const result = normalizeHealth(payload);
    expect(result.metrics).toEqual([]); expect(result.counts.excludedNutritionGroups).toBe(2); expect(JSON.stringify(payload)).toBe(before);
    expect(sanitize({ GPS: 123, nested: { coordinates: [1, 2], nice: true }, hidden: { type: 'dietary_energy', qty: 500 } })).toEqual({ nested: { nice: true } });
  });
  it('fails closed on excessive nesting and identifiers rather than silently truncating evidence', () => {
    let nested: unknown = {}; for (let i = 0; i < 22; i++) nested = { nested };
    expect(() => normalizeHealth({ data: { workouts: [], nested } })).toThrow('payload_complexity');
    expect(() => normalizeHealth({ data: { workouts: [workout('x'.repeat(257))] } })).toThrow('invalid_identifier');
    const output = normalizeHealth({ data: { workouts: [{ ...workout(), source: 'x'.repeat(257) }] } });
    expect(() => validateNormalized(output)).toThrow('invalid_identifier');
  });
});
