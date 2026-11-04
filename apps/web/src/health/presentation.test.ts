import { describe, expect, it } from 'vitest';
import { healthQuerySources as sources, isHealthQuery } from '@jarvis/contracts';
import { healthCellValue, healthColumns, healthPlots, healthRequest, healthRowKey, healthSources, healthValue, healthSourceLabel, initialHealthPeriod } from './presentation';
import { formatTime } from './ui/formatters';

describe('retained Health record presentation', () => {
  it('keeps the query-only training-target source out of collection presentation', () => {
    expect(healthColumns(sources.trainingTargets)).toEqual([]);
    expect(healthSources.some(source => source.id === sources.trainingTargets)).toBe(false);
  });

  it('shows a human Health label instead of internal source ids', () => {
    expect(healthSourceLabel('daily.metrics')).toBe('Health · metrics');
    expect(healthSourceLabel('daily-sql')).toBe('Health · data store');
    expect(healthSourceLabel('other-source')).toBe('other-source');
    expect(healthSourceLabel('daily.metrics')).not.toMatch(/\bdaily\b/iu);
  });

  it('chooses Copenhagen calendar days across UTC midnight and year boundaries', () => {
    expect(initialHealthPeriod(new Date('2026-01-01T23:30:00Z'))).toEqual({ startDate: '2025-12-27', endDate: '2026-01-02' });
  });
  it('builds only valid shared-source requests and keeps collections periodless', () => {
    const period = { startDate: '2026-10-01', endDate: '2026-10-07' };
    for (const source of healthSources) expect(isHealthQuery(healthRequest(source.id, period))).toBe(true);
    expect(healthRequest(sources.favorites, period)).not.toHaveProperty('startDate');
    expect(healthRequest(sources.sync, period)).toEqual({ source: sources.sync });
    expect(healthRequest(sources.workout, period, undefined, 'synthetic-workout')).toEqual({ source: sources.workout, workoutId: 'synthetic-workout' });
    expect(healthRequest(sources.heartRate, period, { minute: '2026-10-01T07:00:00Z', metric: 'heart_rate' }, 'synthetic-workout')).toMatchObject({ workoutId: 'synthetic-workout', cursor: { metric: 'heart_rate' } });
    expect(healthRequest(sources.metrics, { ...period, startDate: 'invalid' })).toBeNull();
  });
  it('does not replace unknowns with zero or explicit false with absence', () => {
    expect(healthValue(null)).toBe('Unknown');
    expect(healthValue(undefined)).toBe('Unknown');
    expect(healthValue(0)).toBe('0');
    expect(healthValue(false)).toBe('No');
    expect(healthValue([])).toBe('None');
  });
  it('formats date-time values with the shared format regardless of the numeric locale', () => {
    const instant = '2026-10-18T08:30:00Z';
    expect(healthValue(instant, 'en-US')).toBe(formatTime(instant));
    expect(healthValue(instant, 'en-GB')).toBe(formatTime(instant));
    expect(healthValue(instant, 'en-US')).toBe('18 Oct 2026, 10:30');
  });
  it('keeps historical brief timestamps verbatim and uses exact stored-text cursors without guessed periods', () => {
    const period = { startDate: '2026-10-01', endDate: '2026-10-07' };
    const cursor = { startedAt: 'raw time', id: ' padded ' };
    expect(healthRequest(sources.briefs, period, cursor)).toEqual({ source: sources.briefs, limit: 50, cursor });
    expect(healthRequest(sources.brief, period, undefined, ' padded ')).toEqual({ source: sources.brief, briefId: ' padded ' });
    expect(healthCellValue(sources.briefs, 'started_at', '2026-10-01T12:00:00')).toBe('2026-10-01T12:00:00');
    expect(healthCellValue(sources.brief, 'completed_at', null)).toBe('Unknown');
    expect(healthPlots(sources.briefs, [{ value: 10 }])).toEqual([]);
  });
  it('keeps every same-date observation, zero and per-record units without daily aggregation', () => {
    const rows = [
      { metric_date: '2026-10-01', metric_name: 'scan_mass', value: 0, unit: 'kg' },
      { metric_date: '2026-10-01', metric_name: 'scan_mass', value: 2, unit: 'kg' },
      { metric_date: '2026-10-02', metric_name: 'scan_mass', value: null, unit: 'kg' },
      { metric_date: '2026-10-03', metric_name: 'scan_mass', value: 4, unit: 'lb' },
    ];
    const plots = healthPlots(sources.metrics, rows);
    expect(plots).toHaveLength(2);
    expect(plots[0]!.series[0]!.points.map(point => point.y)).toEqual([0, 2]);
    expect(new Set(plots[0]!.series[0]!.points.map(point => point.x)).size).toBe(2);
    expect(plots[0]!.unit).toBe('kg'); expect(plots[1]!.unit).toBe('lb');
    expect(healthRowKey(rows[0]!, sources.metrics, 0)).not.toBe(healthRowKey(rows[1]!, sources.metrics, 1));
  });
  it('labels reported averages separately and refuses to plot unknown units', () => {
    expect(healthPlots(sources.metrics, [{ metric_name: 'weight', metric_date: '2026-10-01', value: 10, unit: null }])).toEqual([]);
    const [plot] = healthPlots(sources.metrics, [{ metric_name: 'weight', metric_date: '2026-10-01', avg_value: 10, unit: 'kg' }]);
    expect(plot!.label).toContain('average');
    expect(healthPlots(sources.meals, [{ energy_kcal: 100, deleted_at: '2026-10-01' }])).toEqual([]);
  });
  it('keeps canonical minute values and Copenhagen time without interpolating missing samples', () => {
    const [plot] = healthPlots(sources.heartRate, [
      { sample_minute: '2026-10-17T07:00:00Z', avg_value: 80, unit: 'bpm' },
      { sample_minute: '2026-10-17T07:01:00Z', avg_value: null, unit: 'bpm' },
      { sample_minute: '2026-10-17T07:02:00Z', avg_value: 0, unit: 'bpm' },
    ], 'en-US');
    expect(plot!.series[0]!.points.map(point => point.y)).toEqual([80, 0]);
    expect(plot!.series[0]!.points[0]!.x).toBe('1: 17 Oct 2026, 09:00');
    expect(healthPlots(sources.heartRate, [
      { sample_minute: '2026-10-17T07:00:00Z', avg_value: 80, unit: 'bpm' },
    ], 'en-GB')[0]!.series[0]!.points[0]!.x).toBe('1: 17 Oct 2026, 09:00');
    expect(healthColumns(sources.sleep).find(column => column.key === 'asleep_hours')?.unit).toBe('h');
  });
});
