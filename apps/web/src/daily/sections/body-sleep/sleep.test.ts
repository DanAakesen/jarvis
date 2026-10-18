import { describe, expect, it } from 'vitest';
import { hours, nightStages, sleepSummary, sleepTime } from './sleep';

const period = { startDate: '2026-10-01', endDate: '2026-10-07' };

describe('Sleep evidence (synthetic)', () => {
  it('averages only known asleep hours and gives dated extrema, without filling gaps', () => {
    expect(sleepSummary([
      { sleep_date: '2026-10-01', asleep_hours: 0 },
      { sleep_date: '2026-10-03', asleep_hours: 12 },
      { sleep_date: '2026-10-04', asleep_hours: null, total_sleep_hours: 99 },
      { sleep_date: '2026-09-30', asleep_hours: 99 },
    ], period)).toEqual({
      average: 6, count: 2, total: 7,
      longest: { date: '2026-10-03', value: 12 }, shortest: { date: '2026-10-01', value: 0 },
    });
  });

  it('keeps totals-only and all-unknown nights out of asleep summaries', () => {
    expect(sleepSummary([{ sleep_date: '2026-10-01', total_sleep_hours: 3 }], period))
      .toMatchObject({ average: null, count: 0, longest: null, shortest: null });
    expect(nightStages({ total_sleep_hours: 3 })).toMatchObject({ recorded: [], total: 3, totalLabel: 'Total sleep' });
    expect(nightStages({ asleep_hours: 0 })).toMatchObject({ recorded: [], total: 0, totalLabel: 'Asleep' });
    expect(nightStages({ total_sleep_hours: null, deep_hours: null })).toMatchObject({ recorded: [], total: null });
  });

  it('does not invent unrecorded stages, preserves zero, and never sums in a separate total', () => {
    expect(nightStages({ deep_hours: 0, core_hours: 3, rem_hours: null, total_sleep_hours: 10 }))
      .toMatchObject({ recorded: [{ key: 'deep_hours', value: 0 }, { key: 'core_hours', value: 3 }], partial: true, total: null });
    expect(nightStages({ deep_hours: 1, core_hours: 2, rem_hours: 3, awake_hours: 0 }).partial).toBe(false);
    expect(hours(-2)).toBeNull();
    expect(hours('3')).toBeNull();
  });

  it('renders midnight-crossing instants in Copenhagen without averaging clock times', () => {
    expect(sleepTime('2026-10-01T21:30:00Z', 'en-GB')).toBe('1 Oct 2026, 23:30');
    expect(sleepTime('2026-10-02T05:00:00Z', 'en-GB')).toBe('2 Oct 2026, 07:00');
    expect(sleepTime('2026-10-02T22:30:00Z', 'en-GB')).toBe('3 Oct 2026, 00:30');
    expect(sleepTime('2026-10-25T00:30:00Z', 'en-GB')).toBe('25 Oct 2026, 02:30');
    expect(sleepTime('2026-10-25T01:30:00Z', 'en-GB')).toBe('25 Oct 2026, 02:30');
  });

  it('preserves naive or opaque stored times verbatim instead of assuming a timezone', () => {
    expect(sleepTime('2026-10-01T23:30:00')).toBe('2026-10-01T23:30:00');
    expect(sleepTime('source time unknown')).toBe('source time unknown');
    expect(sleepTime(null)).toBeNull();
    expect(sleepTime('')).toBeNull();
  });
});
