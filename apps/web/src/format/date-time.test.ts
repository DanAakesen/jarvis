import { describe, expect, it } from 'vitest';
import { formatDateOnly, formatDateTime, formatTimeOnly } from './date-time';

describe('shared date and time formatting', () => {
  it('uses the stable en-GB date-time format in UTC and explicit time zones', () => {
    expect(formatDateTime('2026-10-19T06:30:00.000Z', { timeZone: 'UTC' })).toBe('19 Oct 2026, 06:30');
    expect(formatDateTime('2026-10-19T06:30:00.000Z', { timeZone: 'America/Los_Angeles' })).toBe('18 Oct 2026, 23:30');
  });

  it('uses a 24-hour clock at midnight and noon', () => {
    expect(formatDateTime('2026-10-19T00:05:00.000Z', { timeZone: 'UTC' })).toBe('19 Oct 2026, 00:05');
    expect(formatDateTime('2026-10-19T12:05:00.000Z', { timeZone: 'UTC' })).toBe('19 Oct 2026, 12:05');
  });

  it('formats date-only and time-only values', () => {
    expect(formatDateOnly('2026-10-19', { timeZone: 'UTC' })).toBe('19 Oct 2026');
    expect(formatDateOnly('2026-10-19', { timeZone: 'America/Los_Angeles' })).toBe('19 Oct 2026');
    expect(formatTimeOnly('2026-10-19T00:05:00.000Z', { timeZone: 'UTC' })).toBe('00:05');
  });

  it('returns a fallback for missing, invalid, and unformattable values', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateOnly(undefined)).toBe('—');
    expect(formatTimeOnly('2026-02-30')).toBe('—');
    expect(formatDateTime('2026-02-30T00:00:00Z', { timeZone: 'UTC' })).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('—');
    expect(formatDateTime('2026-10-19T06:30:00Z', { timeZone: 'not-a-zone' })).toBe('—');
  });
});
