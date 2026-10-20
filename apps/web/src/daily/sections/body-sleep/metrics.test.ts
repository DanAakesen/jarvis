import { describe, expect, it } from 'vitest';
import { dateOnly, finite, metricDisplay, metricLabel, metricSummary, metricValue, periodDays, splitUnits } from './metrics';

const period = { startDate: '2026-10-01', endDate: '2026-10-07' };

describe('Body measurements (synthetic)', () => {
  it('reads unmapped snake_case keys in words while mapped and free-form names stay as they were', () => {
    expect(metricLabel('active_energy')).toBe('Active energy');
    expect(metricLabel('synthetic_walking_speed')).toBe('Synthetic walking speed');
    expect(metricLabel('body_mass')).toBe('Body mass');
    expect(metricLabel('synthetic_NEW_metric')).toBe('synthetic_NEW_metric');
    expect(metricLabel('__proto__')).toBe('__proto__');
    expect(metricLabel('Unknown metric')).toBe('Unknown metric');
  });
  it('maps known names to readable groups and preserves unknown raw identifiers', () => {
    expect(metricDisplay('body_mass')).toEqual({ label: 'Body mass', group: 'Body composition' });
    expect(metricDisplay('step_count').group).toBe('Activity');
    expect(metricDisplay('heart_rate_variability_sdnn').group).toBe('Heart');
    expect(metricDisplay('heart_rate_data')).toEqual({ label: 'Heart rate', group: 'Heart' });
    expect(metricDisplay('heart_rate_recovery')).toEqual({ label: 'Heart rate recovery', group: 'Heart' });
    expect(metricDisplay('synthetic_NEW_metric')).toEqual({ label: 'synthetic_NEW_metric', group: 'Other' });
    expect(metricDisplay('__proto__')).toEqual({ label: '__proto__', group: 'Other' });
  });

  it('treats only finite numbers as values, preserving zero and average fallback', () => {
    expect(metricValue({ value: 0, avg_value: 200 })).toEqual({ value: 0, average: false });
    expect(metricValue({ value: null, avg_value: 12 })).toEqual({ value: 12, average: true });
    expect(metricValue({ value: '12', avg_value: null })).toEqual({ value: null, average: false });
    expect(finite(Infinity)).toBeNull();
    expect(finite(NaN)).toBeNull();
  });

  it('keeps mixed and unknown units separate without converting, including catalogue units', () => {
    const rows = [{ unit: 'kg', value: 2 }, { unit: 'lb', value: 4 }, { unit: null, value: 8 }, { value: 9 }];
    expect(splitUnits(rows, ['kg', 'lb', 'g'])).toEqual([
      { unit: 'kg', rows: [rows[0]] }, { unit: 'lb', rows: [rows[1]] }, { unit: 'g', rows: [] },
      { unit: null, rows: [rows[2], rows[3]] },
    ]);
  });

  it('summarizes observed days with gaps, dates, daily extrema and first-to-last change', () => {
    const summary = metricSummary([
      { metric_date: '2026-10-06', value: 6 },
      { metric_date: '2026-10-01', value: 0 },
      { metric_date: '2026-10-03', value: null, avg_value: 12 },
      { metric_date: '2026-10-04', value: null },
      { metric_date: '2026-09-30', value: 999 },
      { metric_date: '2026-02-30', value: 999 },
    ], period);
    expect(summary).toMatchObject({
      average: 6, count: 3, total: 7, change: 6,
      latest: { date: '2026-10-06', value: 6 },
      minimum: { date: '2026-10-01', value: 0 }, maximum: { date: '2026-10-03', value: 12 },
    });
  });

  it('weights duplicate-date observations equally within the day, not across days', () => {
    const summary = metricSummary([
      { metric_date: '2026-10-01', value: 0 },
      { metric_date: '2026-10-01', value: 4 },
      { metric_date: '2026-10-02', value: 10 },
    ], period);
    expect(summary.average).toBe(6);
    expect(summary.count).toBe(2);
    expect(summary.change).toBe(8);
  });

  it('never turns all-null observations into zero or a single day into a change', () => {
    expect(metricSummary([{ metric_date: '2026-10-01', value: null, avg_value: null }], period))
      .toMatchObject({ average: null, latest: null, minimum: null, maximum: null, count: 0, change: null });
    expect(metricSummary([{ metric_date: '2026-10-01', value: 0 }], period).change).toBeNull();
  });

  it('counts inclusive calendar days across DST and leap days', () => {
    expect(periodDays({ startDate: '2026-10-24', endDate: '2026-10-26' })).toBe(3);
    expect(periodDays({ startDate: '2024-02-28', endDate: '2024-03-01' })).toBe(3);
    expect(dateOnly('2026-02-30')).toBeNull();
    expect(dateOnly('not-a-date')).toBeNull();
  });
});
