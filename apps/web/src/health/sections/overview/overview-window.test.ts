import { describe, expect, it } from 'vitest';
import { defaultOverviewPreset, overviewPresets, overviewWindow, sessionScope } from './overview-window';

describe('overview window', () => {
  it('offers the five periods with Today first', () => {
    expect(overviewPresets.map(item => item.label)).toEqual(['Today', 'Yesterday', '1 week', '2 weeks', '1 month']);
    expect(defaultOverviewPreset).toBe('today');
  });

  it('reads one date for Today and counts sessions from the Monday of that week', () => {
    // 2026-10-20 is a Tuesday.
    expect(overviewWindow('today', '2026-10-20')).toEqual({
      preset: 'today', startDate: '2026-10-20', endDate: '2026-10-20', days: 1, single: true,
      sessionStart: '2026-10-19', sessionWeeks: 1,
    });
  });

  it('starts a Sunday week on the previous Monday', () => {
    expect(overviewWindow('today', '2026-10-18').sessionStart).toBe('2026-10-12');
  });

  it('moves Yesterday back one date, including its week', () => {
    const window = overviewWindow('yesterday', '2026-10-19');
    expect(window).toMatchObject({ startDate: '2026-10-18', endDate: '2026-10-18', single: true, sessionStart: '2026-10-12' });
  });

  it('ends ranges today and counts sessions across the whole range', () => {
    expect(overviewWindow('week', '2026-10-20')).toMatchObject({
      startDate: '2026-10-14', endDate: '2026-10-20', days: 7, single: false, sessionStart: '2026-10-14', sessionWeeks: 1,
    });
    expect(overviewWindow('fortnight', '2026-10-20')).toMatchObject({ startDate: '2026-10-07', days: 14, sessionWeeks: 2 });
    expect(overviewWindow('month', '2026-10-20')).toMatchObject({ startDate: '2026-09-21', days: 30, sessionWeeks: 4 });
  });

  it('describes what a session count covers', () => {
    expect(sessionScope(overviewWindow('today', '2026-10-20'))).toBe('week to date');
    expect(sessionScope(overviewWindow('fortnight', '2026-10-20'))).toBe('last 14 days');
  });
});
