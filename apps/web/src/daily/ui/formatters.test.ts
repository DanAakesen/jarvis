import { describe, expect, it } from 'vitest';
import { formatClockTime, formatDate, formatDuration, formatNumber, formatTime, formatUnit } from './formatters';

describe('Daily formatters', () => {
  it('keeps unavailable and invalid measurements unknown', () => {
    expect(formatNumber(null)).toBe('Unknown');
    expect(formatNumber(Number.NaN)).toBe('Unknown');
    expect(formatUnit(undefined, 'kg')).toBe('Unknown');
    expect(formatDate('2026-02-30')).toBe('—');
  });

  it('formats numbers, units and durations without treating zero as missing', () => {
    expect(formatNumber(0, 2, 'en-US')).toBe('0');
    expect(formatUnit(0, 'kg', 'en-US')).toBe('0 kg');
    expect(formatDuration(0, 'en-US')).toMatch(/0/);
    expect(formatDuration(3660, 'en-US')).toMatch(/1 hr.*1 min/u);
    expect(formatDuration(-1, 'en-US')).toBe('Unknown');
  });

  it('formats calendar dates and timestamps with the shared en-GB format and Copenhagen timezone', () => {
    expect(formatDate('2026-10-17')).toBe('17 Oct 2026');
    expect(formatTime('2026-10-17T07:00:00Z')).toBe('17 Oct 2026, 09:00');
    expect(formatClockTime('2026-10-17T07:00:00Z')).toBe('09:00');
    expect(formatClockTime('not-a-date')).toBe('—');
    expect(formatTime('not-a-date')).toBe('—');
  });
});
