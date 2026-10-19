import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { dailyQuerySources as sources, isDailyQuery, type DailyJson, type DailyQuery, type DailySourceId } from '@jarvis/contracts';
import { DailyHome } from './DailyHome';
import { DailyOverview } from './DailyOverview';
import { dailySources } from './presentation';
import { DailyRefreshContext } from './refresh';
import { dailyFixture, jsonResponse } from './test-support';

const token = async () => 'synthetic-fixture';
const backendUrl = 'http://localhost:3999';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState({}, '', '/'); });

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
const capabilityList = (ids: readonly DailySourceId[] = Object.values(sources)) => jsonResponse({ module: 'daily', version: 3, sources: ids });
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
const probes = (queries: readonly DailyQuery[]) => queries.filter(query => !('limit' in query) || query.limit === 1);
function row(name: string) {
  const item = screen.getAllByRole('heading', { name }).map(heading => heading.closest('li')).find(Boolean) ?? null;
  if (item === null) throw new Error(`No overview row for ${name}`);
  return within(item);
}
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

describe('Daily overview', () => {
  it('lists compact coverage and discloses collection purposes, through the two Daily endpoints only', async () => {
    const f = fixture();
    render(home());
    await settled();
    await screen.findByText('No meals recorded in the last 7 days');
    await screen.findByText('No sleep recorded in the last 7 days');
    expect(screen.getByRole('heading', { level: 1, name: 'Daily' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'What Daily holds today' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(dailySources.length);
    const notes = screen.getByText('About this data').closest('details')!;
    expect(notes.open).toBe(false);
    for (const source of dailySources) {
      expect(row(source.label).queryByText(source.purpose)).toBeNull();
      expect(notes.textContent).toContain(source.purpose);
    }
    expect(dailySources.map(source => source.id)).not.toContain(sources.metricCatalog);
    expect(dailySources.map(source => source.id)).not.toContain(sources.days);
    expect(row('Measurements').getByText('Has records')).toBeTruthy();
    expect(row('Meal plans').getByText('Has records')).toBeTruthy();
    expect(row('Sleep').getByText('No records')).toBeTruthy();
    expect(row('Saved favourites').getByText('No records')).toBeTruthy();
    expect(row('Sync evidence').getByText('No records')).toBeTruthy();
    expect(notes.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-17T07:00:00Z');
    expect(screen.getByText('Checked 8 collections: 3 with records, 5 with none returned, 0 that could not be read.')).toBeTruthy();
    expect(new Set(probes(f.queries).map(query => query.source))).toEqual(new Set(dailySources.map(source => source.id)));
    expect(f.queries.some(query => query.source === sources.days && 'limit' in query && query.limit === 400)).toBe(true);
    expect(probes(f.queries).every(query => !('limit' in query) || query.limit === 1)).toBe(true);
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
  it('links to Health Auto Export settings only when all visible health collections are empty', async () => {
    fixture({ answer: query => jsonResponse(dailyFixture(query, query.source === sources.sync ? [emptySync] : [])) });
    render(home());
    await settled();
    expect(screen.getByRole('link', { name: 'Set up Health Auto Export in Settings' }).getAttribute('href')).toBe('/settings#health-upload');
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
    expect(f.queries).toHaveLength(dailySources.length + 5);
  });
  it('shows a failed collection on its own row, keeps the rest, and Retry reads again and keeps keyboard focus in that row', async () => {
    let sleepFails = true;
    const f = fixture({ answer: query => query.source === sources.sleep && sleepFails
      ? jsonResponse({ error: 'synthetic' }, 503) : jsonResponse(dailyFixture(query, items(query))) });
    render(home());
    await settled();
    expect(screen.getByText('Checked 8 collections: 3 with records, 4 with none returned, 1 that could not be read.')).toBeTruthy();
    expect(row('Sleep').getByText('Could not be read')).toBeTruthy();
    expect(row('Sleep').getByText('Daily is unavailable (HTTP 503).')).toBeTruthy();
    expect(row('Measurements').getByText('Has records')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Retry / })).toHaveLength(1);
    const retry = row('Sleep').getByRole('button', { name: 'Retry Sleep' });
    retry.focus();
    sleepFails = false;
    fireEvent.click(retry);
    await waitFor(() => expect(row('Sleep').getByText('No records')).toBeTruthy());
    await settled();
    expect(screen.queryByRole('button', { name: /^Retry / })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(row('Sleep').getByRole('button', { name: 'Open Sleep' })));
    expect(probes(f.queries).filter(query => query.source === sources.sleep)).toHaveLength(2);
  });
  it('refreshes every collection on request and keeps settled rows on screen while it reads', async () => {
    const hold = gate();
    let gated = false;
    const f = fixture({ answer: async query => { if (gated) await hold.opened; return jsonResponse(dailyFixture(query, items(query))); } });
    render(home());
    await settled();
    await waitFor(() => expect(f.queries).toHaveLength(dailySources.length + 5));
    gated = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh overview' }));
    const busy = await screen.findByRole('button', { name: 'Refreshing…' });
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    expect(row('Measurements').getByText('Has records')).toBeTruthy();
    await waitFor(() => expect(probes(f.queries).length).toBe(dailySources.length + 2));
    fireEvent.click(busy);
    await flush();
    expect(probes(f.queries)).toHaveLength(dailySources.length + 2);
    hold.open();
    await screen.findByRole('button', { name: 'Refresh overview' });
    await waitFor(() => expect(f.queries).toHaveLength((dailySources.length + 5) * 2));
    expect(screen.queryByRole('button', { name: 'Refreshing…' })).toBeNull();
  });
  it('re-reads when the existing Daily refresh stream advances', async () => {
    const f = fixture();
    const { rerender } = render(home(0));
    await settled();
    rerender(home(1));
    await waitFor(() => expect(f.queries).toHaveLength((dailySources.length + 5) * 2));
    await settled();
  });
  it('shows only implemented sections and keeps the shared period when switching sections', async () => {
    const f = fixture({ capabilities: () => capabilityList(Object.values(sources).filter(source => source !== sources.workouts)) });
    render(home());
    await settled();
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Briefs' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Data' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Workouts' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Nutrition' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Body & sleep' })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Data' }));
    await screen.findByLabelText('Browse');
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '30' } });
    await waitFor(() => expect(f.queries.at(-1)).toMatchObject({ source: sources.metrics }));
    expect((screen.getByLabelText('Period') as HTMLSelectElement).value).toBe('30');
    fireEvent.click(screen.getByRole('tab', { name: 'Briefs' }));
    await screen.findByRole('heading', { level: 2, name: 'Briefs' });
    fireEvent.click(screen.getByRole('tab', { name: 'Data' }));
    await screen.findByLabelText('Browse');
    expect((screen.getByLabelText('Period') as HTMLSelectElement).value).toBe('30');
  });

  it('supports roving tab keys, stores selection in the URL and falls back from an unknown id', async () => {
    fixture({ capabilities: () => capabilityList(Object.values(sources).filter(source => source !== sources.workouts)) });
    render(home(0, '/daily?section=unknown'));
    await settled();
    const overview = screen.getByRole('tab', { name: 'Overview' });
    await waitFor(() => expect(overview.getAttribute('aria-selected')).toBe('true'));
    expect(screen.getByTestId('daily-section-url').textContent).toBe('unknown');

    const tablist = within(screen.getByRole('tablist', { name: 'Daily sections' }));
    const tabs = tablist.getAllByRole('tab');
    const nextTab = tabs[1]!;
    expect(screen.getByRole('navigation', { name: 'Daily sections' })).toBeTruthy();
    expect(tabs.filter(tab => tab.getAttribute('tabindex') === '0')).toHaveLength(1);
    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    expect(nextTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(nextTab);
    expect(screen.getByTestId('daily-section-url').textContent).toBe(nextTab.id.replace('daily-tab-', ''));
    fireEvent.keyDown(nextTab, { key: 'End' });
    const data = screen.getByRole('tab', { name: 'Data' });
    expect(data.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(data);
    expect(screen.getByTestId('daily-section-url').textContent).toBe('data');
    fireEvent.keyDown(data, { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(overview);
    expect(tablist.getAllByRole('tab').filter(tab => tab.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  it('centres the selected tab by scrolling the tab strip only, instantly on first paint and under reduced motion', async () => {
    const scrolls: { element: unknown; options: ScrollToOptions }[] = [];
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value(this: HTMLElement, options: ScrollToOptions) { scrolls.push({ element: this, options }); },
    });
    try {
      fixture();
      render(home());
      await settled();
      const strip = screen.getByRole('navigation', { name: 'Daily sections' });
      const stripScrolls = () => scrolls.filter(scroll => scroll.element === strip);
      expect(stripScrolls().length).toBeGreaterThan(0);
      expect(stripScrolls().every(scroll => scroll.options.behavior === 'auto')).toBe(true);

      Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 390 });
      const data = screen.getByRole('tab', { name: 'Data' });
      Object.defineProperty(data, 'offsetLeft', { configurable: true, value: 600 });
      Object.defineProperty(data, 'offsetWidth', { configurable: true, value: 80 });
      scrolls.length = 0;
      fireEvent.click(data);
      expect(stripScrolls()).toEqual([{ element: strip, options: { left: 445, behavior: 'smooth' } }]);

      document.documentElement.dataset.motion = 'reduced';
      scrolls.length = 0;
      fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
      expect(stripScrolls()).toEqual([{ element: strip, options: { left: 0, behavior: 'auto' } }]);
    } finally {
      delete document.documentElement.dataset.motion;
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
    }
  });

  it('flags which edges of the tab strip have more tabs beyond them as it scrolls', async () => {
    fixture();
    render(home());
    await settled();
    const strip = screen.getByRole('navigation', { name: 'Daily sections' });
    const edges = () => [strip.dataset.overflowStart, strip.dataset.overflowEnd];
    expect(edges()).toEqual([undefined, undefined]);

    let scrollLeft = 0;
    Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: 600 });
    Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 300 });
    Object.defineProperty(strip, 'scrollLeft', { configurable: true, get: () => scrollLeft });
    const scrollTo = (left: number) => {
      scrollLeft = left;
      fireEvent.scroll(strip);
    };

    scrollTo(0);
    expect(edges()).toEqual([undefined, 'true']);
    scrollTo(120);
    expect(edges()).toEqual(['true', 'true']);
    scrollTo(300);
    expect(edges()).toEqual(['true', undefined]);
    scrollTo(0);
    expect(edges()).toEqual([undefined, 'true']);
  });

  it('aborts old requests during twenty rapid section switches without warnings or a request backlog', async () => {
    let active = 0;
    let maximumActive = 0;
    let aborted = 0;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetch = vi.fn((url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith('/daily/capabilities')) return Promise.resolve(capabilityList());
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const signal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          active -= 1;
          aborted += 1;
          reject(signal.reason);
        }, { once: true });
      });
    });
    vi.stubGlobal('fetch', fetch);
    render(home());
    const names = ['Overview', 'Briefs', 'Workouts', 'Nutrition', 'Body & sleep'];
    for (let index = 0; index < 20; index += 1) {
      fireEvent.click(await screen.findByRole('tab', { name: names[index % names.length]! }));
      await flush();
    }
    await waitFor(() => expect(aborted).toBeGreaterThan(0));
    expect(maximumActive).toBeLessThanOrEqual(2);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('opens one collection in the record browser without another availability request and returns through the shell tab', async () => {
    const f = fixture();
    render(home());
    await settled();
    fireEvent.click(row('Measurements').getByRole('button', { name: 'Open Measurements' }));
    const browse = await screen.findByLabelText('Browse');
    expect((browse as HTMLSelectElement).value).toBe(sources.metrics);
    await waitFor(() => expect(document.activeElement?.id).toBe('daily-heading'));
    await waitFor(() => expect(f.queries.at(-1)).toMatchObject({ source: sources.metrics, limit: 50 }));
    expect(screen.queryByRole('heading', { name: 'What Daily holds today' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back to overview' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    await settled();
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
    expect(row('Measurements').getByRole('button', { name: 'Open Measurements' })).toBeTruthy();
    expect(f.capabilityCalls()).toBe(1);
    expect(f.queries.filter(query => !('limit' in query) || query.limit === 1)).toHaveLength(dailySources.length * 2);
  });
  it.each([
    [404, 'Daily is not enabled on this backend.'],
    [403, 'Daily access could not be verified. Sign in as the configured owner.'],
    [503, 'Daily is unavailable (HTTP 503).'],
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
    await screen.findByText('No Daily data');
    expect(f.queries).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Refresh overview' })).toBeNull();
  });
  it('keeps a single page heading when Overview is embedded in the Daily shell', async () => {
    fixture();
    render(home());
    await settled();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Today', level: 2 })).toBeTruthy();
    expect(screen.queryByText('Your workouts, nutrition, body, sleep and latest brief at a glance.')).toBeNull();
  });
  it('shows the health-upload recovery link only for settled empty health probes, not failed or populated reads', async () => {
    let state: 'empty' | 'failed' | 'populated' = 'empty';
    fixture({ answer: query => state === 'failed' ? jsonResponse({}, 503) :
      jsonResponse(dailyFixture(query, state === 'populated' ? items(query) : [])) });
    render(home());
    await settled();
    expect(screen.getByRole('link', { name: 'Set up Health Auto Export in Settings' }).getAttribute('href')).toBe('/settings#health-upload');
    state = 'failed';
    fireEvent.click(screen.getByRole('button', { name: 'Refresh overview' }));
    await screen.findByRole('button', { name: 'Retry Measurements' });
    await settled();
    expect(screen.queryByRole('link', { name: 'Set up Health Auto Export in Settings' })).toBeNull();
    state = 'populated';
    fireEvent.click(screen.getByRole('button', { name: 'Refresh overview' }));
    await waitFor(() => expect(row('Measurements').getByText('Has records')).toBeTruthy());
    expect(screen.queryByRole('link', { name: 'Set up Health Auto Export in Settings' })).toBeNull();
  });
  it('keeps keyboard order as refresh, section cards, collection actions and the data disclosure', async () => {
    fixture({ answer: query => jsonResponse(dailyFixture(query)) });
    const open = vi.fn();
    render(<MemoryRouter><DailyOverview backendUrl={backendUrl} getAccessToken={token}
      capabilities={{ sources: Object.values(sources) }} onRetryAvailability={() => {}} onOpen={open} /></MemoryRouter>);
    await settled();
    await screen.findByText('No briefs returned');
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Refresh overview' }));
    for (const name of ['Workouts', 'Nutrition', 'Body', 'Sleep', 'Briefs']) {
      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole('link', { name }));
    }
    for (const source of dailySources) {
      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: `Open ${source.label}` }));
    }
    await user.keyboard('{Enter}');
    expect(open).toHaveBeenCalledWith(sources.sync);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Set up Health Auto Export in Settings' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByText('About this data'));
    await user.click(screen.getByText('About this data'));
    expect(screen.getByText('About this data').closest('details')?.open).toBe(true);
  });
});
