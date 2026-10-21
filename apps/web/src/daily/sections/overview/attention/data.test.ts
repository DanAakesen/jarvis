import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calendarRange, conflictingEvents, eventDays, type AgendaEvent } from './data';

describe('Calendar day boundaries', () => {
  it.each([
    ['2026-10-20', '2026-10-19T22:00:00.000Z', '2026-10-20T22:00:00.000Z'],
    ['2026-10-25', '2026-10-24T22:00:00.000Z', '2026-10-25T23:00:00.000Z'],
    ['2026-03-29', '2026-03-28T23:00:00.000Z', '2026-03-29T22:00:00.000Z'],
  ])('requests the exact Copenhagen day %s, independent of browser timezone', (date, from, to) => {
    expect(calendarRange({ startDate: date, endDate: date })).toEqual({ from, to });
  });

  it('marks overlapping timed events, not touching edges or all-day events', () => {
    const event = (id: string, start: string, end: string, allDay = false): AgendaEvent => ({
      id, title: `Synthetic ${id}`, startsAt: `2026-10-20T${start}:00Z`, endsAt: `2026-10-20T${end}:00Z`,
      startDate: '2026-10-20', endDate: allDay ? '2026-10-21' : '2026-10-20', allDay, calendarName: null, location: null,
    });
    const events = [event('a', '08:00', '10:00'), event('b', '09:00', '11:00'), event('c', '11:00', '12:00'), event('day', '00:00', '23:59', true)];
    expect([...conflictingEvents(events)]).toEqual(['a', 'b']);
    expect(eventDays(events, { startDate: '2026-10-20', endDate: '2026-10-21' })).toHaveLength(1);
  });
});

describe('Stable attention layout', () => {
  it('keeps fixed shells with scrollable content across data states and stacks on narrow screens', () => {
    const css = readFileSync(resolve('src/daily/sections/overview/attention/attention.css'), 'utf8');
    expect(css).toMatch(/\.attention-agenda\s*\{[^}]*height: 42rem/u);
    expect(css).toMatch(/\.attention-list, \.attention-waiting-unavailable\s*\{[^}]*height: 19rem/u);
    expect(css).toMatch(/\.attention-scroll\s*\{[^}]*overflow: auto/u);
    expect(css).toMatch(/@media \(min-width: 1000px\)/u);
    expect(css).not.toMatch(/transition: all/u);
  });
});
