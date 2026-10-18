import { describe, expect, it } from 'vitest';
import {
  dayKey, isQuietHour, latestSlotAtOrBefore, localDateTimeInstant, localSlotInstant, localTimeLabel, monthKey,
  nextSlotAfter, slotKey,
} from './time.js';

describe('Copenhagen proactive time', () => {
  it('formats local day, time, quiet window and month on an ordinary day', () => {
    const morning = new Date('2026-10-20T05:00:00Z');
    expect(dayKey(morning)).toBe('2026-10-20');
    expect(localTimeLabel(morning)).toBe('07:00');
    expect(isQuietHour(morning)).toBe(false);
    expect(isQuietHour(new Date('2026-10-20T20:00:00Z'))).toBe(true);
    expect(isQuietHour(new Date('2026-10-20T05:00:00Z'))).toBe(false);
    expect(monthKey(morning)).toBe('2026-10');
    expect(slotKey(morning, '07:00')).toBe('2026-10-20T07:00');
    expect(localSlotInstant('2026-10-20T07:00').toISOString()).toBe('2026-10-20T05:00:00.000Z');
  });

  it('keeps both slots correct on the 25-hour autumn transition day', () => {
    const before = new Date('2026-10-25T00:30:00Z');
    const after = new Date('2026-10-25T02:30:00Z');
    expect(dayKey(before)).toBe('2026-10-25');
    expect(localTimeLabel(before)).toBe('02:30');
    expect(localTimeLabel(after)).toBe('03:30');
    expect(localSlotInstant('2026-10-25T07:00').toISOString()).toBe('2026-10-25T06:00:00.000Z');
    expect(localSlotInstant('2026-10-25T07:00').getTime() -
      localSlotInstant('2026-10-24T07:00').getTime()).toBe(25 * 60 * 60_000);
    expect(nextSlotAfter(before).key).toBe('2026-10-25T07:00');
  });

  it('keeps both slots correct on the 23-hour spring transition day', () => {
    const before = new Date('2027-03-28T00:30:00Z');
    const after = new Date('2027-03-28T05:30:00Z');
    expect(dayKey(before)).toBe('2027-03-28');
    expect(localTimeLabel(before)).toBe('01:30');
    expect(localTimeLabel(after)).toBe('07:30');
    expect(localSlotInstant('2027-03-28T07:00').toISOString()).toBe('2027-03-28T05:00:00.000Z');
    expect(localSlotInstant('2027-03-28T07:00').getTime() -
      localSlotInstant('2027-03-27T07:00').getTime()).toBe(23 * 60 * 60_000);
    expect(latestSlotAtOrBefore(after).key).toBe('2027-03-28T07:00');
  });

  it('resolves todo due times against the Copenhagen offset on both DST transition dates', () => {
    expect(localDateTimeInstant('2026-10-25', '14:30').toISOString()).toBe('2026-10-25T13:30:00.000Z');
    expect(localDateTimeInstant('2027-03-28', '14:30').toISOString()).toBe('2027-03-28T12:30:00.000Z');
    expect(() => localDateTimeInstant('2027-03-28', '02:30')).toThrow('does not exist');
  });

  it('crosses year and local month boundaries using Copenhagen calendar time', () => {
    const newYear = new Date('2026-12-31T23:30:00Z');
    expect(dayKey(newYear)).toBe('2027-01-01');
    expect(monthKey(newYear)).toBe('2027-01');
    expect(latestSlotAtOrBefore(newYear).key).toBe('2026-12-31T18:00');
    const midnight = new Date('2026-12-31T23:00:00Z');
    expect(monthKey(midnight)).toBe('2027-01');
    expect(nextSlotAfter(midnight).key).toBe('2027-01-01T07:00');
  });

  it('returns the latest and next exact slots including just-at-slot boundaries', () => {
    const before = new Date('2026-10-20T04:59:59Z');
    const at = new Date('2026-10-20T05:00:00Z');
    expect(latestSlotAtOrBefore(before).key).toBe('2026-10-19T18:00');
    expect(nextSlotAfter(before).key).toBe('2026-10-20T07:00');
    expect(latestSlotAtOrBefore(at).key).toBe('2026-10-20T07:00');
    expect(nextSlotAfter(at).key).toBe('2026-10-20T18:00');
  });
});
