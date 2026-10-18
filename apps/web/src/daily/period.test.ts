import { describe, expect, it } from 'vitest';
import { dailyPeriodFor, isDailyPeriod } from './period';
import { dailyQuerySources as sources } from '@jarvis/contracts';
import { dailyRequest } from './presentation';

describe('Daily periods', () => {
  it('accepts at most 366 inclusive calendar days', () => {
    expect(isDailyPeriod({ startDate: '2024-01-01', endDate: '2024-12-31' })).toBe(true);
    expect(isDailyPeriod({ startDate: '2024-01-01', endDate: '2025-01-01' })).toBe(false);
  });

  it('rejects reverse and impossible dates before a request can be made', () => {
    expect(isDailyPeriod({ startDate: '2026-02-01', endDate: '2026-01-31' })).toBe(false);
    expect(isDailyPeriod({ startDate: '2026-02-30', endDate: '2026-03-01' })).toBe(false);
    expect(dailyRequest(sources.metrics, { startDate: '2024-01-01', endDate: '2025-01-01' })).toBeNull();
  });

  it('creates presets from Copenhagen calendar dates', () => {
    expect(dailyPeriodFor('7', new Date('2026-01-01T23:30:00Z'))).toEqual({
      startDate: '2025-12-27', endDate: '2026-01-02',
    });
    expect(dailyPeriodFor('year', new Date('2026-10-18T10:00:00Z'))).toEqual({
      startDate: '2026-01-01', endDate: '2026-10-18',
    });
  });
});
