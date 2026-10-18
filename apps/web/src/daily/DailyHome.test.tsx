import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { dailyQuerySources as sources, isDailyQuery, type DailyJson, type DailyQuery, type DailySourceId } from '@jarvis/contracts';
import { DailyHome } from './DailyHome';
import { dailySources } from './presentation';
import { DailyRefreshContext } from './refresh';
import { dailyFixture, jsonResponse } from './test-support';

const token = async () => 'synthetic-fixture';
const backendUrl = 'http://localhost:3999';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

const records: Partial<Record<DailySourceId, Record<string, DailyJson>>> = {
  [sources.metrics]: { metric_name: 'synthetic_scan_mass', metric_date: '2026-10-17', value: 2, unit: 'kg' },
  [sources.meals]: { meal_date: '2026-10-17', meal_name: 'Synthetic meal', energy_kcal: 120, confidence: 'estimate' },
  [sources.plans]: { plan_name: 'Synthetic plan', energy_kcal: 100, protein_grams: 10, revision: 1 },
};
// The sync source always answers with one summary item, even when the phone has never sent anything.
const emptySync = { feeds: [], heartbeat: null, inbox: { retained: 0, pending: 0, quarantined: 0, last_accepted_at: null, last_processed_upload_at: null } };
function items(query: DailyQuery): Record<string, DailyJson>[] {
  if (query.source === sources.sync) return [emptySync];
  const record = records[query.source];
  return record ? [record] : [];
}
const capabilityList = (ids: readonly DailySourceId[] = Object.values(sources)) => jsonResponse({ module: 'daily', version: 2, sources: ids });
function gate() {
  let open = () => {};
  const opened = new Promise<void>(resolve => { open = resolve; });
  return { opened, open };
}

function fixture({ capabilities = () => capabilityList(), answer = query => jsonResponse(dailyFixture(query, items(query))) }: {
  capabilities?: () => Response | Promise<Response>;
  answer?: (query: DailyQuery) => Response | Promise<Response>;
} = {}) {
  const queries: DailyQuery[] = [];
  const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith('/daily/capabilities')) return capabilities();
    const input: unknown = JSON.parse(String(init?.body));
    if (!isDailyQuery(input)) throw new Error('Invalid synthetic query');
    queries.push(input);
    return answer(input);
  });
  vi.stubGlobal('fetch', fetch);
  return { queries, fetch, capabilityCalls: () => fetch.mock.calls.filter(([url]) => String(url).endsWith('/daily/capabilities')).length };
}
function SectionUrlProbe() {
  const [params] = useSearchParams();
  return <output data-testid="daily-section-url">{params.get('section') ?? 'no section parameter'}</output>;
}
function home(refreshVersion = 0, initialPath = '/daily') {
  return <MemoryRouter initialEntries={[initialPath]}>
    <DailyRefreshContext.Provider value={refreshVersion}><DailyHome backendUrl={backendUrl} getAccessToken={token} /></DailyRefreshContext.Provider>
    <SectionUrlProbe />
  </MemoryRouter>;
}
const settled = () => screen.findByText(/^Checked \d+ collections?:/u);
function row(name: string) {
  const item = screen.getByRole('heading', { level: 3, name }).closest('li');
  if (item === null) throw new Error(`No overview row for ${name}`);
  return within(item);
}
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

describe('Daily overview', () => {
  it('lists each collection with what it is for and what a one-record read found, through the two Daily endpoints only', async () => {
    const f = fixture();
    render(home());
    await settled();
    expect(screen.getByRole('heading', { level: 1, name: 'Daily' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'What Daily holds today' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(dailySources.length);
    for (const source of dailySources) expect(row(source.label).getByText(source.purpose)).toBeTruthy();
    expect(row('Measurements').getByText('Has records')).toBeTruthy();
    expect(row('Measurements').getByText('Checked for the last 7 days (Europe/Copenhagen).')).toBeTruthy();
    expect(row('Meal plans').getByText('Has records')).toBeTruthy();
    expect(row('Meal plans').getByText('Not limited to a period.')).toBeTruthy();
    expect(row('Sleep').getByText('None returned')).toBeTruthy();
    expect(row('Sleep').getByText(/No records in this period; older ones may exist\. This does not prove the original source is empty\./u)).toBeTruthy();
    expect(row('Saved favourites').getByText(/No records are stored\./u)).toBeTruthy();
    expect(row('Sync evidence').getByText('None returned')).toBeTruthy();
    expect(row('Measurements').getByText(/^Read /u).querySelector('time')?.getAttribute('datetime')).toBe('2026-10-17T07:00:00Z');
    expect(screen.getByText('Checked 8 collections: 3 with records, 5 with none returned, 0 that could not be read.')).toBeTruthy();
    expect(new Set(f.queries.map(query => query.source))).toEqual(new Set(dailySources.map(source => source.id)));
    expect(f.queries.every(query => !('limit' in query) || query.limit === 1)).toBe(true);
    expect(new Set(f.fetch.mock.calls.map(([url, init]) => `${init?.method} ${new URL(String(url)).pathname}`)))
      .toEqual(new Set(['GET /daily/capabilities', 'POST /daily/query']));
  });
  it('counts sync evidence as records only when a feed, a phone contact or a retained upload exists', async () => {
    fixture({ answer: query => jsonResponse(dailyFixture(query, query.source === sources.sync
      ? [{ ...emptySync, inbox: { ...emptySync.inbox, retained: 2, pending: 1 } }] : items(query))) });
    render(home());
    await settled();
    expect(row('Sync evidence').getByText('Has records')).toBeTruthy();
  });
  it('shows an availability loader until the backend answers', async () => {
    const hold = gate();
    const f = fixture({ capabilities: async () => { await hold.opened; return capabilityList(); } });
    render(home());
    expect(screen.getByText('Checking Daily availability')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'What Daily holds today' })).toBeNull();
    expect(f.queries).toHaveLength(0);
    hold.open();
    await settled();
  });
  it('reads at most two collections at a time', async () => {
    const hold = gate();
    const f = fixture({ answer: async query => { await hold.opened; return jsonResponse(dailyFixture(query, items(query))); } });
    render(home());
    await waitFor(() => expect(f.queries.length).toBeGreaterThanOrEqual(2));
    await flush();
    expect(f.queries).toHaveLength(2);
    hold.open();
    await settled();
    expect(f.queries).toHaveLength(dailySources.length);
  });
  it('shows a failed collection on its own row, keeps the rest, and Retry reads again and keeps keyboard focus in that row', async () => {
    let sleepFails = true;
    const f = fixture({ answer: query => query.source === sources.sleep && sleepFails
      ? jsonResponse({ error: 'synthetic' }, 503) : jsonResponse(dailyFixture(query, items(query))) });
    render(home());
    await settled();
    expect(screen.getByText('Checked 8 collections: 3 with records, 4 with none returned, 1 that could not be read.')).toBeTruthy();
    expect(row('Sleep').getByText('Could not read')).toBeTruthy();
    expect(row('Sleep').getByText('Daily is unavailable (HTTP 503). Retry without changing your records.')).toBeTruthy();
    expect(row('Measurements').getByText('Has records')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Retry / })).toHaveLength(1);
    const retry = row('Sleep').getByRole('button', { name: 'Retry Sleep' });
    retry.focus();
    sleepFails = false;
    fireEvent.click(retry);
    await waitFor(() => expect(row('Sleep').getByText('None returned')).toBeTruthy());
    await settled();
    expect(screen.queryByRole('button', { name: /^Retry / })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(row('Sleep').getByRole('button', { name: 'Open Sleep' })));
    expect(f.queries.filter(query => query.source === sources.sleep)).toHaveLength(2);
  });
  it('refreshes every collection on request and keeps settled rows on screen while it reads', async () => {
    const hold = gate();
    let gated = false;
    const f = fixture({ answer: async query => { if (gated) await hold.opened; return jsonResponse(dailyFixture(query, items(query))); } });
    render(home());
    await settled();
    gated = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh overview' }));
    const busy = await screen.findByRole('button', { name: 'Refreshing…' });
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    expect(row('Measurements').getByText('Has records')).toBeTruthy();
    await waitFor(() => expect(f.queries).toHaveLength(dailySources.length + 2));
    fireEvent.click(busy);
    await flush();
    expect(f.queries).toHaveLength(dailySources.length + 2);
    hold.open();
    await screen.findByRole('button', { name: 'Refresh overview' });
    expect(f.queries).toHaveLength(dailySources.length * 2);
    expect(screen.queryByRole('button', { name: 'Refreshing…' })).toBeNull();
  });
  it('re-reads when the existing Daily refresh stream advances', async () => {
    const f = fixture();
    const { rerender } = render(home(0));
    await settled();
    rerender(home(1));
    await waitFor(() => expect(f.queries).toHaveLength(dailySources.length * 2));
    await settled();
  });
  it('shows only implemented sections and keeps the shared period when switching sections', async () => {
    const f = fixture();
    render(home());
    await settled();
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Briefs' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Data' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Workouts' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Nutrition' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Body & sleep' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Data' }));
    await screen.findByLabelText('Browse');
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '30' } });
    await waitFor(() => expect(f.queries.at(-1)).toMatchObject({ source: sources.metrics }));
    expect((screen.getByLabelText('Period') as HTMLSelectElement).value).toBe('30');
    fireEvent.click(screen.getByRole('tab', { name: 'Briefs' }));
    await screen.findByRole('heading', { name: 'Brief history' });
    fireEvent.click(screen.getByRole('tab', { name: 'Data' }));
    await screen.findByLabelText('Browse');
    expect((screen.getByLabelText('Period') as HTMLSelectElement).value).toBe('30');
  });

  it('supports roving tab keys, stores selection in the URL and falls back from an unknown id', async () => {
    fixture();
    render(home(0, '/daily?section=unknown'));
    await settled();
    const overview = screen.getByRole('tab', { name: 'Overview' });
    await waitFor(() => expect(overview.getAttribute('aria-selected')).toBe('true'));
    expect(screen.getByTestId('daily-section-url').textContent).toBe('unknown');

    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    const briefs = screen.getByRole('tab', { name: 'Briefs' });
    expect(briefs.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('daily-section-url').textContent).toBe('briefs');
    fireEvent.keyDown(briefs, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Data' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('daily-section-url').textContent).toBe('data');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Data' }), { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
  });

  it('opens one collection in the record browser without another availability request, and Back returns to that row', async () => {
    const f = fixture();
    render(home());
    await settled();
    fireEvent.click(row('Measurements').getByRole('button', { name: 'Open Measurements' }));
    const browse = await screen.findByLabelText('Browse');
    expect((browse as HTMLSelectElement).value).toBe(sources.metrics);
    await waitFor(() => expect(document.activeElement?.id).toBe('daily-heading'));
    await waitFor(() => expect(f.queries.at(-1)).toMatchObject({ source: sources.metrics, limit: 50 }));
    expect(screen.queryByRole('heading', { name: 'What Daily holds today' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to overview' }));
    await settled();
    await waitFor(() => expect(document.activeElement).toBe(row('Measurements').getByRole('button', { name: 'Open Measurements' })));
    expect(f.capabilityCalls()).toBe(1);
    expect(f.queries.filter(query => !('limit' in query) || query.limit === 1)).toHaveLength(dailySources.length * 2);
  });
  it.each([
    [404, 'Daily is not enabled on this backend. Your original Daily remains in use.'],
    [403, 'Daily access could not be verified. Sign in as the configured owner.'],
    [503, 'Daily is unavailable (HTTP 503). Retry without changing your records.'],
  ])('explains a failed availability check (HTTP %i), reads nothing, and retries on request', async (status, message) => {
    let failing = true;
    const f = fixture({ capabilities: () => failing ? jsonResponse({ error: 'synthetic' }, status) : capabilityList([sources.metrics]) });
    render(home());
    expect((await screen.findByRole('alert')).textContent).toContain(message);
    expect(f.queries).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'What Daily holds today' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh overview' })).toBeNull();
    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry availability' }));
    await settled();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(f.queries).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('says so plainly when the backend exposes no browsable collection', async () => {
    const f = fixture({ capabilities: () => capabilityList([sources.workout]) });
    render(home());
    await screen.findByText('This backend has not exposed a browsable Daily collection.');
    expect(f.queries).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Refresh overview' })).toBeNull();
  });
});
