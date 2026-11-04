import { describe, expect, it } from 'vitest';
import { healthPeriodFor, isHealthPeriod } from './period';
import { healthQuerySources as sources } from '@jarvis/contracts';
import { healthRequest } from './presentation';

describe('Health periods', () => {
  it('accepts at most 366 inclusive calendar days', () => {
    expect(isHealthPeriod({ startDate: '2024-01-01', endDate: '2024-12-31' })).toBe(true);
    expect(isHealthPeriod({ startDate: '2024-01-01', endDate: '2025-01-01' })).toBe(false);
  });

  it('rejects reverse and impossible dates before a request can be made', () => {
    expect(isHealthPeriod({ startDate: '2026-02-01', endDate: '2026-01-31' })).toBe(false);
    expect(isHealthPeriod({ startDate: '2026-02-30', endDate: '2026-03-01' })).toBe(false);
    expect(healthRequest(sources.metrics, { startDate: '2024-01-01', endDate: '2025-01-01' })).toBeNull();
  });

  it('creates presets from Copenhagen calendar dates', () => {
    expect(healthPeriodFor('7', new Date('2026-01-01T23:30:00Z'))).toEqual({
      startDate: '2025-12-27', endDate: '2026-01-02',
    });
    expect(healthPeriodFor('year', new Date('2026-10-18T10:00:00Z'))).toEqual({
      startDate: '2026-01-01', endDate: '2026-10-18',
    });
  });

  it('creates single-day and fortnight presets', () => {
    const now = new Date('2026-03-01T10:00:00Z');
    expect(healthPeriodFor('today', now)).toEqual({ startDate: '2026-03-01', endDate: '2026-03-01' });
    expect(healthPeriodFor('yesterday', now)).toEqual({ startDate: '2026-02-28', endDate: '2026-02-28' });
    expect(healthPeriodFor('14', now)).toEqual({ startDate: '2026-02-16', endDate: '2026-03-01' });
  });
});
