import { describe, expect, it } from 'vitest';
import { dailyQuerySources as sources, isDailyQuery, type DailyJson, type DailySourceId } from '@jarvis/contracts';
import { dailyProbe, overviewSummary, probeState, rowView, type DailyProbe } from './overview';
import { dailyRequest, dailySources } from './presentation';
import { dailyFixture } from './test-support';

const period = { startDate: '2026-10-10', endDate: '2026-10-16' };
const observedAt = '2026-10-17T07:00:00Z';
function probeQuery(source: DailySourceId) {
  const query = dailyProbe(source, period);
  if (query === null) throw new Error(`No probe for ${source}`);
  return query;
}
const inbox = { retained: 0, pending: 0, quarantined: 0, last_accepted_at: null, last_processed_upload_at: null };
const syncItem = (overrides: Record<string, DailyJson> = {}): Record<string, DailyJson> => ({ feeds: [], heartbeat: null, inbox, ...overrides });

describe('Daily overview probes', () => {
  it('reads every browsable collection one record deep, otherwise exactly as the record browser asks', () => {
    for (const source of dailySources) {
      const ordinary = dailyRequest(source.id, period);
      expect(ordinary, source.label).not.toBeNull();
      const query = probeQuery(source.id);
      expect(isDailyQuery(query), source.label).toBe(true);
      expect(query, source.label).toEqual(ordinary !== null && 'limit' in ordinary ? { ...ordinary, limit: 1 } : ordinary);
    }
    expect(probeQuery(sources.metrics)).toEqual({ source: sources.metrics, ...period, limit: 1 });
    expect(probeQuery(sources.favorites)).toEqual({ source: sources.favorites, limit: 1 });
    expect(probeQuery(sources.sync)).toEqual({ source: sources.sync });
  });
  it('refuses an invalid period instead of guessing one', () => {
    expect(dailyProbe(sources.metrics, { ...period, startDate: 'invalid' })).toBeNull();
  });
  it('gives every collection its own plain-English purpose and no figure', () => {
    const purposes = dailySources.map(source => source.purpose);
    expect(new Set(purposes).size).toBe(purposes.length);
    for (const purpose of purposes) {
      expect(purpose.length).toBeGreaterThan(20);
      expect(purpose).not.toMatch(/\d/u);
    }
  });
});

describe('probeState', () => {
  it('reports records only when a record came back', () => {
    const query = probeQuery(sources.meals);
    expect(probeState(dailyFixture(query))).toBe('none');
    expect(probeState(dailyFixture(query, [{ meal_name: 'Synthetic meal', energy_kcal: 0 }]))).toBe('records');
  });
  it.each([
    ['no feed, no phone contact and nothing retained', syncItem(), 'none'],
    ['a malformed inbox', syncItem({ inbox: null }), 'none'],
    ['an inbox that is not a row', syncItem({ inbox: [] }), 'none'],
    ['an unknown retained count', syncItem({ inbox: { ...inbox, retained: null } }), 'none'],
    ['a feed', syncItem({ feeds: [{ feed_kind: 'metrics' }] }), 'records'],
    ['a phone contact', syncItem({ heartbeat: { last_received_at: '2026-10-17T06:00:00Z' } }), 'records'],
    ['a retained upload', syncItem({ inbox: { ...inbox, retained: 3, pending: 1 } }), 'records'],
  ] as const)('does not let the always-present sync summary count as records: %s', (_label, item, expected) => {
    expect(probeState(dailyFixture(probeQuery(sources.sync), [item]))).toBe(expected);
  });
});

describe('rowView', () => {
  const settled = (state: 'records' | 'none'): DailyProbe => ({ state, observedAt });
  const failed: DailyProbe = { state: 'failed', message: 'Health is unavailable (HTTP 503).' };
  it('checks until a first result exists', () => {
    expect(rowView(undefined, true, true)).toEqual({ tone: 'checking', label: 'Checking' });
    expect(rowView(undefined, false, true)).toEqual({ tone: 'checking', label: 'Checking' });
  });
  it('keeps a settled result visible while the next read runs', () => {
    expect(rowView(settled('records'), true, true)).toEqual({ tone: 'records', label: 'Has records' });
    expect(rowView(settled('none'), true, false)).toMatchObject({ tone: 'none', label: 'None returned' });
  });
  it('shows a retried failure as checking, and a settled failure with its reason', () => {
    expect(rowView(failed, true, true)).toEqual({ tone: 'checking', label: 'Checking' });
    expect(rowView(failed, false, true)).toEqual({ tone: 'failed', label: 'Could not read', detail: failed.message });
  });
  it('never claims the original source is empty, and says whether a period applied', () => {
    expect(rowView(settled('none'), false, true)).toEqual({ tone: 'none', label: 'None returned',
      detail: 'No records in this period; older ones may exist. This does not prove the original source is empty.' });
    expect(rowView(settled('none'), false, false)).toEqual({ tone: 'none', label: 'None returned',
      detail: 'No records are stored. This does not prove the original source is empty.' });
  });
});

describe('overviewSummary', () => {
  it('counts each outcome once and agrees with the number of collections', () => {
    expect(overviewSummary([{ state: 'records', observedAt }, { state: 'none', observedAt }, { state: 'failed', message: 'x' }, { state: 'records', observedAt }]))
      .toBe('Checked 4 collections: 2 with records, 1 with none returned, 1 that could not be read.');
    expect(overviewSummary([{ state: 'none', observedAt }])).toBe('Checked 1 collection: 0 with records, 1 with none returned, 0 that could not be read.');
  });
});
