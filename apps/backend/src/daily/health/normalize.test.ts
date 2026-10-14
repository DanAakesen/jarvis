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
  it.each([['%', 20], ['percent', 20], ['fraction', 0.2], ['1', 0.2], [' PERCENT ', 20]])('canonicalizes body-fat %s without changing zero or missing values', (units, qty) => {
    for (const value of [qty, 0, null]) {
      const output = normalizeHealth({ data: { metrics: [metric('body_fat_percentage', String(units), [point(value)])] } });
      expect(output.metrics[0]).toMatchObject({ unit: '%', value: value === null ? null : value === 0 ? 0 : 20 });
      expect(output.metrics[0]?.fields_json.latest).toMatchObject({ qty: value });
      validateNormalized(output);
    }
  });
  it.each(['kg', 'made-up', 'Hz', 'constructor', '__proto__'])('refuses unsupported body-fat %s at the group or point boundary', units => {
    for (const qty of [20, 0, null]) {
      expect(() => normalizeHealth({ data: { metrics: [metric('body_fat_percentage', units, [point(qty)])] } })).toThrow('unsupported_unit');
      for (const unitField of ['units', 'unit']) {
        expect(() => normalizeHealth({ data: { metrics: [metric('body_fat_percentage', '%', [{ ...point(qty), [unitField]: units }])] } })).toThrow('unsupported_unit');
      }
    }
  });
  it('keeps missing body-fat units unknown without changing unknown dimensions', () => {
    for (const units of [undefined, null, '', ' ']) {
      const output = normalizeHealth({ data: { metrics: [{ name: 'body_fat_percentage', units, data: [point(0.2)] }] } });
      expect(output.metrics[0]).toMatchObject({ value: 0.2, unit: null });
    }
    expect(normalizeHealth({ data: { metrics: [metric('custom_metric', 'made-up', [point(3)])] } }).metrics[0]).toMatchObject({ value: 3, unit: 'made-up' });
  });
  it('combines supported body-fat representations but rejects mixed known and missing units', () => {
    const supported = metric('body_fat_percentage', '%', [point(20), { ...point(0.25, '2026-10-13T12:00:00Z'), unit: 'fraction' }]);
    expect(normalizeHealth({ data: { metrics: [supported] } }).metrics[0]).toMatchObject({ value: 25, unit: '%', min_value: 20, max_value: 25, avg_value: 22.5 });
    expect(() => normalizeHealth({ data: { metrics: [supported, { name: 'body_fat_percentage', data: [point(0.2)] }] } })).toThrow('unsupported_unit');
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
  it.each(['bpm', 'count/min', 'beats/min', ' BPM ', 'Count / min'])('canonicalizes supported %s heart-rate summaries, series and daily rates consistently', units => {
    const w = { ...workout(), avgHeartRate: { qty: 110, units }, maxHeartRate: { qty: 120, units },
      heartRate: { units, avg: { qty: 105 }, Max: 115 },
      heartRateData: workout().heartRateData.map(row => ({ ...row, units })),
      heartRateRecovery: [{ date: '2026-10-13T09:00:00Z', qty: 95, unit: units }] };
    const result = normalizeHealth({ data: { workouts: [w], metrics: [metric('resting_heart_rate', units, [point(60)])] } });
    expect(result.workouts[0]).toMatchObject({ avg_heart_rate: 110, max_heart_rate: 120 });
    for (const metricName of ['avg_heart_rate', 'max_heart_rate', 'heart_rate_data', 'heart_rate_recovery']) {
      expect(result.workoutMetrics.find(row => row.metric_name === metricName)?.unit).toBe('bpm');
    }
    expect(result.heartRateMinutes).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric_name: 'heart_rate_data', min_value: 100, avg_value: 110, max_value: 120, unit: 'bpm' }),
      expect.objectContaining({ metric_name: 'heart_rate_recovery', avg_value: 95, unit: 'bpm' }),
    ]));
    expect(result.metrics[0]).toMatchObject({ value: 60, unit: 'bpm' });
    expect(result.workouts[0]?.detail_json).toMatchObject({ avgHeartRate: { qty: 110, units } });
  });
  it('preserves only the legacy implicit-BPM summary slots, precedence, zero and missing values', () => {
    const summary = (fields: Record<string, unknown>) => normalizeHealth({ data: { workouts: [{ ...workout(), ...fields }] } }).workouts[0];
    expect(summary({ avgHeartRate: { qty: 110 }, maxHeartRate: { qty: 150 } })).toMatchObject({ avg_heart_rate: 110, max_heart_rate: 150 });
    expect(summary({ heartRate: { avg: { qty: 111 }, max: { qty: 151 } } })).toMatchObject({ avg_heart_rate: 111, max_heart_rate: 151 });
    expect(summary({ heartRate: { Avg: 112, Max: 152 } })).toMatchObject({ avg_heart_rate: 112, max_heart_rate: 152 });
    expect(summary({ heartRate: { avg: 113, max: 153 } })).toMatchObject({ avg_heart_rate: 113, max_heart_rate: 153 });
    expect(summary({ heartRate: { unit: 'count/min', avg: { qty: 114 }, Max: 154 } })).toMatchObject({ avg_heart_rate: 114, max_heart_rate: 154 });
    expect(summary({ avgHeartRate: { qty: 0 }, maxHeartRate: { qty: 0 }, heartRate: { Avg: 100, Max: 150 } })).toMatchObject({ avg_heart_rate: 0, max_heart_rate: 0 });
    expect(summary({ avgHeartRate: { qty: null }, heartRate: { avg: { qty: 115 }, max: { qty: null } } })).toMatchObject({ avg_heart_rate: 115, max_heart_rate: null });
    for (const qty of [undefined, null, '', false, true, 'NaN']) expect(summary({ avgHeartRate: { qty }, maxHeartRate: { qty } })).toMatchObject({ avg_heart_rate: null, max_heart_rate: null });
    // A populated sample series cannot manufacture a missing summary; unsupported scalar summary shapes stay unknown.
    expect(summary({})).toMatchObject({ avg_heart_rate: null, max_heart_rate: null });
    expect(summary({ avgHeartRate: 110, maxHeartRate: { value: 150 } })).toMatchObject({ avg_heart_rate: null, max_heart_rate: null });
  });
  it.each(['Hz', 'ms', 'made-up', 'constructor'])('refuses explicit %s units across every recognized heart-rate path, including fallbacks', units => {
    const candidates = [
      { avgHeartRate: { qty: 2, units } }, { maxHeartRate: { qty: 3, unit: units } },
      { heartRate: { avg: { qty: 2, units } } }, { heartRate: { max: { qty: 3, unit: units } } },
      { heartRate: { units, Avg: 2, Max: 3 } }, { heartRate: { unit: units, avg: { qty: 2 }, max: 3 } },
      { avgHeartRate: { qty: 110, units: 'bpm' }, heartRate: { avg: { qty: 2, units } } },
      { avgHeartRate: { qty: null, units } },
      { heartRateData: [{ date: '2026-10-13T08:00:00Z', qty: 2, units }] },
      { heartRateRecovery: [{ date: '2026-10-13T09:00:00Z', qty: 2, units }] },
    ];
    for (const fields of candidates) expect(() => normalizeHealth({ data: { workouts: [{ ...workout(), ...fields }] } })).toThrow('unsupported_unit');
    for (const name of ['heart_rate', 'resting_heart_rate', 'walking_heart_rate_average']) {
      expect(() => normalizeHealth({ data: { metrics: [metric(name, units, [point(2)])] } })).toThrow('unsupported_unit');
    }
  });
  it('keeps missing series units unknown, rejects mixed units, and does not misclassify heart-rate variability', () => {
    const unknown = normalizeHealth({ data: { workouts: [{ ...workout(), heartRateData: [{ date: '2026-10-13T08:00:00Z', qty: 100 }] }],
      metrics: [{ name: 'heart_rate', data: [point(60)] }, metric('heart_rate_variability_sdnn', 'ms', [point(45)])] } });
    expect(unknown.workouts[0]?.avg_heart_rate).toBeNull(); expect(unknown.heartRateMinutes[0]).toMatchObject({ unit: null, avg_value: 100 });
    expect(unknown.metrics).toEqual(expect.arrayContaining([expect.objectContaining({ metric_name: 'heart_rate', value: 60, unit: null }),
      expect.objectContaining({ metric_name: 'heart_rate_variability_sdnn', value: 45, unit: 'ms' })]));
    expect(() => normalizeHealth({ data: { workouts: [{ ...workout(), heartRateData: [...workout().heartRateData, { date: '2026-10-13T08:00:30Z', qty: 110 }] }] } })).toThrow('unsupported_unit');
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
