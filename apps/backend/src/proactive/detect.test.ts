import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLASH_WINDOW_HOURS, DEADLINE_WINDOW_HOURS, detectFindings,
  deterministicDedupeKey, normaliseFactText, todosDueWithin,
} from './detect.js';
import type { SourceFact } from './types.js';

const now = new Date('2026-10-18T12:00:00.000Z');
const hour = 3_600_000;
const iso = (offset: number) => new Date(now.getTime() + offset).toISOString();
const todo = (offset: number, overrides: Partial<SourceFact> = {}): SourceFact => ({
  ref: 'todos:1', kind: 'todo', label: 'Todo', text: 'Send report',
  observedAt: now.toISOString(), dueAt: iso(offset), ...overrides,
});
const event = (start: number, end: number, overrides: Partial<SourceFact> = {}): SourceFact => ({
  ref: 'calendar:1', kind: 'event', label: 'Calendar', text: 'Planning',
  observedAt: now.toISOString(), startsAt: iso(start), endsAt: iso(end), ...overrides,
});
const clash = (start: number, end: number) => [
  event(start, end),
  event(start, end, { ref: 'calendar:2', text: 'Review' }),
];

afterEach(() => vi.useRealTimers());

describe('bounded finding copy', () => {
  it.each(['da', 'en'] as const)('fits long source text within SQL UTF-16 limits in %s', (language) => {
    const longText = '😀Å report '.repeat(1_000);
    const findings = detectFindings([
      todo(hour, { text: longText }),
      ...clash(hour, 2 * hour).map((fact) => ({ ...fact, text: `${fact.text} ${longText}` })),
    ], now, language);
    expect(findings).toHaveLength(2);
    for (const finding of findings) {
      expect(finding.title.length).toBeLessThanOrEqual(200);
      expect(finding.body.length).toBeLessThanOrEqual(500);
      expect(finding.body).toContain('…');
      expect(finding.body).toContain(iso(hour));
      expect(finding.body).not.toMatch(/[\uD800-\uDFFF]/u);
    }
    expect(findings[0]?.body).toBe(language === 'da'
      ? `Opgaven "${longText.slice(0, 299)}…" har frist ${iso(hour)}.`
      : `The task "${longText.slice(0, 299)}…" is due at ${iso(hour)}.`);
    expect(findings[1]?.body).toContain(iso(2 * hour));
  });

  it.each([
    [300, 'deadline'], [160, 'clash'],
  ] as const)('does not split a surrogate pair at the %s-unit %s boundary', (limit, category) => {
    const text = `${'a'.repeat(limit - 2)}😀${'z'.repeat(1_000)}`;
    const facts = category === 'deadline' ? [todo(hour, { text })] : [
      event(hour, 2 * hour, { text }), event(hour, 2 * hour, { text, ref: 'other' }),
    ];
    const finding = detectFindings(facts, now, 'en')[0]!;
    expect(finding.body).toContain(`"${'a'.repeat(limit - 2)}…"`);
    expect(finding.body).not.toMatch(/[\uD800-\uDFFF]/u);
    expect(finding.body.length).toBeLessThanOrEqual(500);
  });

  it('preserves source text exactly at its snippet limit and uses full text for identity', () => {
    const text = '😀'.repeat(150);
    const first = detectFindings([todo(hour, { text })], now, 'en')[0]!;
    expect(first.body).toContain(`"${text}"`);
    expect(first.body).not.toContain('…');
    const longText = `${text}x`.repeat(10);
    const long = detectFindings([todo(hour, { text: longText })], now, 'en')[0]!;
    expect(long.dedupeKey).toBe(deterministicDedupeKey('deadline', longText, iso(hour)));
    expect(long.dedupeKey).not.toBe(first.dedupeKey);
    const changed = detectFindings([todo(hour, { text: `${longText}different suffix` })], now, 'en')[0]!;
    expect(changed.body).toBe(long.body);
    expect(changed.dedupeKey).not.toBe(long.dedupeKey);
  });
});

describe('deterministic deadlines', () => {
  it('keeps the documented windows explicit', () => {
    expect(DEADLINE_WINDOW_HOURS).toBe(24);
    expect(CLASH_WINDOW_HOURS).toBe(48);
  });

  it.each([
    [-25 * hour, 'normal'], [-24 * hour - 1, 'normal'],
    [-24 * hour, 'time_critical'], [-1, 'time_critical'],
    [0, 'time_critical'], [24 * hour, 'time_critical'],
  ] as const)('classifies due offset %s with urgency %s', (offset, urgency) => {
    expect(detectFindings([todo(offset)], now, 'en')).toEqual([{
      title: offset < 0 ? 'Overdue task' : 'Task deadline approaching',
      body: `The task "Send report" ${offset < 0 ? 'was' : 'is'} due at ${iso(offset)}.`,
      category: 'deadline', urgency, dueAt: iso(offset),
      evidence: ['todos:1'], dedupeKey: deterministicDedupeKey('deadline', 'Send report', iso(offset)),
    }]);
  });

  it('omits later, undated, invalid and non-todo deadlines', () => {
    expect(detectFindings([
      todo(24 * hour + 1), todo(0, { dueAt: null }), todo(0, { dueAt: undefined }),
      todo(0, { dueAt: 'not a date' }), todo(0, { kind: 'mail' }),
      todo(0, { kind: 'factory' }),
    ], now, 'en')).toEqual([]);
  });

  it('uses injected time, not the wall clock, and does not mutate facts', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2040-01-01T00:00:00Z');
    const fact = Object.freeze(todo(hour));
    const facts = [fact];
    expect(detectFindings(facts, now, 'en')[0]?.urgency).toBe('time_critical');
    expect(facts).toEqual([todo(hour)]);
    expect(detectFindings(facts, new Date('invalid'), 'en')).toEqual([]);
  });

  it('uses fixed Danish deadline templates with original source text', () => {
    expect(detectFindings([todo(hour, { text: 'Send årsrapport' })], now, 'da')[0]).toMatchObject({
      title: 'Opgavefrist nærmer sig',
      body: `Opgaven "Send årsrapport" har frist ${iso(hour)}.`,
    });
    expect(detectFindings([todo(-hour)], now, 'da')[0]).toMatchObject({
      title: 'Overskredet opgavefrist',
      body: `Opgaven "Send report" havde frist ${iso(-hour)}.`,
    });
  });

  it('canonicalizes equivalent timestamp offsets for persisted deadlines and keys', () => {
    const utc = detectFindings([todo(hour)], now, 'en')[0];
    const offset = detectFindings([todo(hour, { dueAt: '2026-10-18T15:00:00+02:00' })], now, 'en')[0];
    expect(offset).toEqual(utc);
  });
});

describe('upcoming todo window', () => {
  it('includes only todos strictly after now and at or before the minute boundary', () => {
    const first = todo(1, { ref: 'first' });
    const last = todo(60 * 60_000, { ref: 'last' });
    expect(todosDueWithin([
      todo(-1), todo(0), first, last, todo(hour + 1),
      todo(1, { kind: 'mail' }), todo(1, { dueAt: 'invalid' }), todo(1, { dueAt: null }),
    ], now, 60)).toEqual([first, last]);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('returns no upcoming todos for window %s', (minutes) => {
    expect(todosDueWithin([todo(1)], now, minutes)).toEqual([]);
  });
});

describe('calendar clashes', () => {
  it('finds a strict overlap and retains its bounded timing and evidence', () => {
    expect(detectFindings([
      event(hour, 3 * hour),
      event(2 * hour, 4 * hour, { ref: 'calendar:2', text: 'Review' }),
    ], now, 'en')).toEqual([{
      title: 'Calendar clash',
      body: `"Planning" and "Review" overlap from ${iso(2 * hour)} to ${iso(3 * hour)}.`,
      category: 'clash', urgency: 'time_critical', dueAt: iso(2 * hour),
      evidence: ['calendar:1', 'calendar:2'],
      dedupeKey: deterministicDedupeKey('clash', '["planning","review"]', iso(2 * hour)),
      eventStartAt: iso(2 * hour), eventEndAt: iso(3 * hour),
    }]);
  });

  it.each([
    [-hour, hour, 'normal'],
    [-1, hour, 'normal'],
    [0, hour, 'time_critical'],
    [48 * hour, 49 * hour, 'time_critical'],
    [48 * hour + 1, 49 * hour, 'normal'],
    [7 * 24 * hour, 7 * 24 * hour + hour, 'normal'],
  ] as const)('classifies overlap %s..%s as %s', (start, end, urgency) => {
    expect(detectFindings(clash(start, end), now, 'en')).toMatchObject([{ urgency }]);
  });

  it('excludes touching, separate and past overlaps including one that just ended', () => {
    for (const facts of [
      [event(hour, 2 * hour), event(2 * hour, 3 * hour, { ref: 'other' })],
      [event(hour, 2 * hour), event(3 * hour, 4 * hour, { ref: 'other' })],
      clash(-2 * hour, -hour), clash(-hour, 0),
      [event(-2 * hour, hour), event(-hour, 0, { ref: 'other' })],
    ]) expect(detectFindings(facts, now, 'en')).toEqual([]);
  });

  it('excludes all-day, malformed, reversed, zero-length and non-event intervals', () => {
    for (const overrides of [
      { allDay: true }, { startsAt: null }, { endsAt: undefined },
      { startsAt: 'invalid' }, { endsAt: 'invalid' },
      { startsAt: iso(2 * hour), endsAt: iso(hour) },
      { startsAt: iso(hour), endsAt: iso(hour) },
      { kind: 'weather' as const },
    ]) {
      expect(detectFindings([
        event(hour, 2 * hour), event(hour, 2 * hour, { ref: 'other', ...overrides }),
      ], now, 'en')).toEqual([]);
    }
  });

  it('does not clash an event with a repeated reference', () => {
    expect(detectFindings([event(hour, 2 * hour), event(hour, 2 * hour)], now, 'en')).toEqual([]);
  });

  it('emits each pair once, including contained and identical intervals', () => {
    const events = [
      event(hour, 4 * hour), event(2 * hour, 3 * hour, { ref: 'two', text: 'Review' }),
      event(hour, 4 * hour, { ref: 'three', text: 'Workshop' }),
    ];
    const result = detectFindings(events, now, 'en');
    expect(result).toHaveLength(3);
    expect(new Set(result.map((finding) => finding.dedupeKey)).size).toBe(3);
    expect(detectFindings([...events].reverse(), now, 'en')).toEqual(result);
  });

  it('uses fixed Danish clash text and language-independent keys', () => {
    const facts = clash(hour, 2 * hour);
    const danish = detectFindings(facts, now, 'da')[0];
    expect(danish).toMatchObject({
      title: 'Kalenderkonflikt',
      body: `"Planning" og "Review" overlapper fra ${iso(hour)} til ${iso(2 * hour)}.`,
      dedupeKey: detectFindings(facts, now, 'en')[0]?.dedupeKey,
    });
  });
});

describe('stable fact identity', () => {
  it('normalizes NFC, Unicode whitespace and case without locale-sensitive folding', () => {
    expect(normaliseFactText(' \tA\u030A R S \n\u00a0Report  ')).toBe('å r s report');
    expect(normaliseFactText('I İ')).toBe('i i\u0307');
  });

  it('hashes pipe-joined normalized text with SHA-256 truncated to 32 hex characters', () => {
    const expected = createHash('sha256').update(`deadline|å report|${iso(hour)}`).digest('hex').slice(0, 32);
    expect(deterministicDedupeKey('deadline', ' A\u030A \n REPORT ', iso(hour))).toBe(expected);
    expect(expected).toMatch(/^[a-f0-9]{32}$/u);
    expect(deterministicDedupeKey('clash', 'å report', iso(hour))).not.toBe(expected);
    expect(deterministicDedupeKey('deadline', 'å report', iso(2 * hour))).not.toBe(expected);
  });

  it('ignores run-local refs and observation times but changes keys when deadlines change', () => {
    const first = detectFindings([todo(hour)], now, 'en')[0]!;
    const next = detectFindings([todo(hour, {
      ref: 'todos:99', observedAt: iso(hour), text: ' SEND \n REPORT ',
    })], now, 'da')[0]!;
    expect(next.dedupeKey).toBe(first.dedupeKey);
    expect(next.evidence).toEqual(['todos:99']);
    expect(detectFindings([todo(2 * hour)], now, 'en')[0]?.dedupeKey).not.toBe(first.dedupeKey);
  });

  it('canonicalizes clash pair text despite reordered facts and regenerated refs', () => {
    const original = detectFindings(clash(hour, 2 * hour), now, 'en')[0]!;
    const next = detectFindings([
      event(hour, 2 * hour, { ref: 'new-review', text: ' REVIEW ' }),
      event(hour, 2 * hour, { ref: 'new-planning', text: 'planning' }),
    ], now, 'da')[0]!;
    expect(next.dedupeKey).toBe(original.dedupeKey);
    expect(next.evidence).toEqual(['new-planning', 'new-review']);
  });

  it('separates ambiguous pairs without relying on concatenated source refs', () => {
    const pair = (a: string, b: string) => detectFindings([
      event(hour, 2 * hour, { text: a }),
      event(hour, 2 * hour, { text: b, ref: 'other' }),
    ], now, 'en')[0]!.dedupeKey;
    expect(pair('a|b', 'c')).not.toBe(pair('a', 'b|c'));
  });
});
