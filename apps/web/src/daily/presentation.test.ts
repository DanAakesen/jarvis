import { describe, expect, it } from 'vitest';
import { dailyQuerySources as sources, isDailyQuery } from '@jarvis/contracts';
import { dailyCellValue, dailyColumns, dailyPlots, dailyRequest, dailyRowKey, dailySources, dailyValue, initialDailyPeriod } from './presentation';
import { formatTime } from './ui/formatters';

describe('retained Daily record presentation', () => {
  it('chooses Copenhagen calendar days across UTC midnight and year boundaries', () => {
    expect(initialDailyPeriod(new Date('2026-01-01T23:30:00Z'))).toEqual({ startDate: '2025-12-27', endDate: '2026-01-02' });
  });
  it('builds only valid shared-source requests and keeps collections periodless', () => {
    const period = { startDate: '2026-10-01', endDate: '2026-10-07' };
    for (const source of dailySources) expect(isDailyQuery(dailyRequest(source.id, period))).toBe(true);
    expect(dailyRequest(sources.favorites, period)).not.toHaveProperty('startDate');
    expect(dailyRequest(sources.sync, period)).toEqual({ source: sources.sync });
    expect(dailyRequest(sources.workout, period, undefined, 'synthetic-workout')).toEqual({ source: sources.workout, workoutId: 'synthetic-workout' });
    expect(dailyRequest(sources.heartRate, period, { minute: '2026-10-01T07:00:00Z', metric: 'heart_rate' }, 'synthetic-workout')).toMatchObject({ workoutId: 'synthetic-workout', cursor: { metric: 'heart_rate' } });
    expect(dailyRequest(sources.metrics, { ...period, startDate: 'invalid' })).toBeNull();
  });
  it('does not replace unknowns with zero or explicit false with absence', () => {
    expect(dailyValue(null)).toBe('Unknown');
    expect(dailyValue(undefined)).toBe('Unknown');
    expect(dailyValue(0)).toBe('0');
    expect(dailyValue(false)).toBe('No');
    expect(dailyValue([])).toBe('None');
  });
  it('formats the same instant through the shared locale source in both locale conventions', () => {
    const instant = '2026-10-18T08:30:00Z';
    for (const locale of ['en-US', 'en-GB']) {
      expect(dailyValue(instant, locale)).toBe(formatTime(instant, locale));
    }
    expect(dailyValue(instant, 'en-US')).toBe('Oct 18, 2026, 10:30 AM');
    expect(dailyValue(instant, 'en-GB')).toBe('18 Oct 2026, 10:30');
  });
  it('keeps historical brief timestamps verbatim and uses exact stored-text cursors without guessed periods', () => {
    const period = { startDate: '2026-10-01', endDate: '2026-10-07' };
    const cursor = { startedAt: 'raw time', id: ' padded ' };
    expect(dailyRequest(sources.briefs, period, cursor)).toEqual({ source: sources.briefs, limit: 50, cursor });
    expect(dailyRequest(sources.brief, period, undefined, ' padded ')).toEqual({ source: sources.brief, briefId: ' padded ' });
    expect(dailyCellValue(sources.briefs, 'started_at', '2026-10-01T12:00:00')).toBe('2026-10-01T12:00:00');
    expect(dailyCellValue(sources.brief, 'completed_at', null)).toBe('Unknown');
    expect(dailyPlots(sources.briefs, [{ value: 10 }])).toEqual([]);
  });
  it('keeps every same-date observation, zero and per-record units without daily aggregation', () => {
    const rows = [
      { metric_date: '2026-10-01', metric_name: 'scan_mass', value: 0, unit: 'kg' },
      { metric_date: '2026-10-01', metric_name: 'scan_mass', value: 2, unit: 'kg' },
      { metric_date: '2026-10-02', metric_name: 'scan_mass', value: null, unit: 'kg' },
      { metric_date: '2026-10-03', metric_name: 'scan_mass', value: 4, unit: 'lb' },
    ];
    const plots = dailyPlots(sources.metrics, rows);
    expect(plots).toHaveLength(2);
    expect(plots[0]!.series[0]!.points.map(point => point.y)).toEqual([0, 2]);
    expect(new Set(plots[0]!.series[0]!.points.map(point => point.x)).size).toBe(2);
    expect(plots[0]!.unit).toBe('kg'); expect(plots[1]!.unit).toBe('lb');
    expect(dailyRowKey(rows[0]!, sources.metrics, 0)).not.toBe(dailyRowKey(rows[1]!, sources.metrics, 1));
  });
  it('labels reported averages separately and refuses to plot unknown units', () => {
    expect(dailyPlots(sources.metrics, [{ metric_name: 'weight', metric_date: '2026-10-01', value: 10, unit: null }])).toEqual([]);
    const [plot] = dailyPlots(sources.metrics, [{ metric_name: 'weight', metric_date: '2026-10-01', avg_value: 10, unit: 'kg' }]);
    expect(plot!.label).toContain('average');
    expect(dailyPlots(sources.meals, [{ energy_kcal: 100, deleted_at: '2026-10-01' }])).toEqual([]);
  });
  it('keeps canonical minute values and Copenhagen time without interpolating missing samples', () => {
    const [plot] = dailyPlots(sources.heartRate, [
      { sample_minute: '2026-10-17T07:00:00Z', avg_value: 80, unit: 'bpm' },
      { sample_minute: '2026-10-17T07:01:00Z', avg_value: null, unit: 'bpm' },
      { sample_minute: '2026-10-17T07:02:00Z', avg_value: 0, unit: 'bpm' },
    ], 'en-US');
    expect(plot!.series[0]!.points.map(point => point.y)).toEqual([80, 0]);
    expect(plot!.series[0]!.points[0]!.x).toBe('1: Oct 17, 2026, 9:00 AM');
    expect(dailyPlots(sources.heartRate, [
      { sample_minute: '2026-10-17T07:00:00Z', avg_value: 80, unit: 'bpm' },
    ], 'en-GB')[0]!.series[0]!.points[0]!.x).toBe('1: 17 Oct 2026, 09:00');
    expect(dailyColumns(sources.sleep).find(column => column.key === 'asleep_hours')?.unit).toBe('h');
  });
});
