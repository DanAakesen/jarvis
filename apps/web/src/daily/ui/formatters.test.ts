import { describe, expect, it } from 'vitest';
import { formatClockTime, formatDate, formatDuration, formatNumber, formatTime, formatUnit } from './formatters';

describe('Daily formatters', () => {
  it('keeps unavailable and invalid measurements unknown', () => {
    expect(formatNumber(null)).toBe('Unknown');
    expect(formatNumber(Number.NaN)).toBe('Unknown');
    expect(formatUnit(undefined, 'kg')).toBe('Unknown');
    expect(formatDate('2026-02-30')).toBe('Unknown');
  });

  it('formats numbers, units and durations without treating zero as missing', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatUnit(0, 'kg')).toBe('0 kg');
    expect(formatDuration(0)).toMatch(/0/);
    expect(formatDuration(3660)).toMatch(/1 hr.*1 min/u);
    expect(formatDuration(-1)).toBe('Unknown');
  });

  it('formats calendar dates and timestamps with a Copenhagen timezone', () => {
    expect(formatDate('2026-10-17')).not.toBe('Unknown');
    expect(formatTime('2026-10-17T07:00:00Z')).not.toBe('Unknown');
    expect(formatClockTime('2026-10-17T07:00:00Z')).not.toContain('2026');
    expect(formatClockTime('not-a-date')).toBe('Unknown');
    expect(formatTime('not-a-date')).toBe('Unknown');
  });
});
