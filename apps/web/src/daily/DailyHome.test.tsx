import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { dailyCapabilitiesVersion, dailyQuerySources as sources, isDailyQuery, type DailyJson, type DailyQuery, type DailySourceId } from '@jarvis/contracts';
import { DailyHome } from './DailyHome';
import { DailyOverview } from './DailyOverview';
import { DailyRefreshContext } from './refresh';
import { dailyFixture, jsonResponse } from './test-support';

const token = async () => 'synthetic-fixture';
const backendUrl = 'http://localhost:3999';
// The shell's freshness pill reads the sync source once per mount and once per refresh-stream step.
const shellReads = 1;
// Overview cards: week workouts, steps, nutrition days, meals, sleep and the metric catalogue.
const todayReads = 6;
// Health panel, once expanded: metrics, catalogue, sleep, workouts, nutrition days and sync.
const healthReads = 6;
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
const capabilityList = (ids: readonly DailySourceId[] = Object.values(sources)) => jsonResponse({ module: 'daily', version: dailyCapabilitiesVersion, sources: ids });
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
function home(refreshVersion = 0, initialPath = '/health') {
  return <MemoryRouter initialEntries={[initialPath]}>
    <DailyRefreshContext.Provider value={refreshVersion}><DailyHome backendUrl={backendUrl} getAccessToken={token} /></DailyRefreshContext.Provider>
    <SectionUrlProbe />
  </MemoryRouter>;
}
const settled = () => screen.findByRole('heading', { name: 'Training' });
const sectionTabs = () => within(screen.getByRole('tablist', { name: 'Health sections' }));
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

describe('Daily overview', () => {
  it('shows the three cards and no collection list, through the two Daily endpoints only', async () => {
    const f = fixture();
    render(home());
    await settled();
    await waitFor(() => expect(f.queries).toHaveLength(todayReads + shellReads));
    expect(screen.getByRole('heading', { level: 1, name: 'Health' })).toBeTruthy();
    for (const name of ['Training', 'Health', 'Body']) expect(screen.getByRole('heading', { level: 3, name })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'What Health holds today' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'What Health holds today' })).toBeNull();
    expect(screen.queryByText('About this data')).toBeNull();
    expect(screen.queryByRole('button', { name: /^(Open |Refresh overview)/u })).toBeNull();
    expect(new Set(f.fetch.mock.calls.map(([url, init]) => `${init?.method} ${new URL(String(url)).pathname}`)))
      .toEqual(new Set(['GET /daily/capabilities', 'POST /daily/query']));
  });
  it('shows an availability loader until the backend answers', async () => {
    const hold = gate();
    const f = fixture({ capabilities: async () => { await hold.opened; return capabilityList(); } });
    render(home());
    expect(screen.getByText('Checking Health availability')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Training' })).toBeNull();
    expect(f.queries).toHaveLength(0);
    hold.open();
    await settled();
  });
  it('keeps the Health panel closed until the Health card opens it, and returns focus to the card when it closes', async () => {
    const f = fixture();
    render(home());
    await settled();
    await waitFor(() => expect(f.queries).toHaveLength(todayReads + shellReads));
    expect(document.getElementById('health-panel')).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Health' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe('health-panel');
    fireEvent.click(toggle);
    await waitFor(() => expect(document.getElementById('health-panel')).not.toBeNull());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => expect(f.queries).toHaveLength(todayReads + shellReads + healthReads));
    const collapse = screen.getByRole('button', { name: 'Collapse Health' });
    collapse.focus();
    fireEvent.click(collapse);
    await waitFor(() => expect(document.getElementById('health-panel')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(toggle));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    await waitFor(() => expect(document.getElementById('health-panel')).not.toBeNull());
    fireEvent.click(toggle);
    await waitFor(() => expect(document.getElementById('health-panel')).toBeNull());
  });
  it('opens the Health panel straight from an address that asks for it', async () => {
    fixture();
    render(home(0, '/health?section=overview&panel=health&healthTab=sleep'));
    await settled();
    expect(await screen.findByRole('tab', { name: 'Sleep', selected: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Health' }).getAttribute('aria-expanded')).toBe('true');
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
    await waitFor(() => expect(f.queries).toHaveLength(todayReads + shellReads));
  });
  it('re-reads when the existing Health refresh stream advances', async () => {
    const f = fixture();
    const { rerender } = render(home(0));
    await settled();
    await waitFor(() => expect(f.queries).toHaveLength(todayReads + shellReads));
    rerender(home(1));
    await waitFor(() => expect(f.queries).toHaveLength(todayReads * 2 + shellReads * 2));
  });
  it('shows only implemented sections and keeps the shared period when switching sections', async () => {
    const f = fixture({ capabilities: () => capabilityList(Object.values(sources).filter(source => source !== sources.workouts)) });
    render(home());
    await settled();
    expect(sectionTabs().getByRole('tab', { name: 'Overview' })).toBeTruthy();
    expect(sectionTabs().getByRole('tab', { name: 'Briefs' })).toBeTruthy();
    expect(sectionTabs().getByRole('tab', { name: 'Data' })).toBeTruthy();
    expect(sectionTabs().queryByRole('tab', { name: 'Workouts' })).toBeNull();
    expect(sectionTabs().getByRole('tab', { name: 'Nutrition' })).toBeTruthy();
    expect(sectionTabs().getByRole('tab', { name: 'Body & sleep' })).toBeTruthy();

    fireEvent.click(sectionTabs().getByRole('tab', { name: 'Data' }));
    await screen.findByLabelText('Browse');
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '30' } });
    await waitFor(() => expect(f.queries.at(-1)).toMatchObject({ source: sources.metrics }));
    expect((screen.getByLabelText('Period') as HTMLSelectElement).value).toBe('30');
    fireEvent.click(sectionTabs().getByRole('tab', { name: 'Briefs' }));
    await screen.findByRole('heading', { level: 2, name: 'Briefs' });
    fireEvent.click(sectionTabs().getByRole('tab', { name: 'Data' }));
    await screen.findByLabelText('Browse');
    expect((screen.getByLabelText('Period') as HTMLSelectElement).value).toBe('30');
  });

  it('supports roving tab keys, stores selection in the URL and falls back from an unknown id', async () => {
    fixture({ capabilities: () => capabilityList(Object.values(sources).filter(source => source !== sources.workouts)) });
    render(home(0, '/daily?section=unknown'));
    await settled();
    const overview = sectionTabs().getByRole('tab', { name: 'Overview' });
    await waitFor(() => expect(overview.getAttribute('aria-selected')).toBe('true'));
    expect(screen.getByTestId('daily-section-url').textContent).toBe('unknown');

    const tablist = within(screen.getByRole('tablist', { name: 'Health sections' }));
    const tabs = tablist.getAllByRole('tab');
    const nextTab = tabs[1]!;
    expect(screen.getByRole('navigation', { name: 'Health sections' })).toBeTruthy();
    expect(tabs.filter(tab => tab.getAttribute('tabindex') === '0')).toHaveLength(1);
    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    expect(nextTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(nextTab);
    expect(screen.getByTestId('daily-section-url').textContent).toBe(nextTab.id.replace('daily-tab-', ''));
    fireEvent.keyDown(nextTab, { key: 'End' });
    const rules = sectionTabs().getByRole('tab', { name: 'Rules & sources' });
    expect(rules.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(rules);
    expect(screen.getByTestId('daily-section-url').textContent).toBe('rules');
    fireEvent.keyDown(rules, { key: 'Home' });
    expect(sectionTabs().getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
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
      const strip = screen.getByRole('navigation', { name: 'Health sections' });
      const stripScrolls = () => scrolls.filter(scroll => scroll.element === strip);
      expect(stripScrolls().length).toBeGreaterThan(0);
      expect(stripScrolls().every(scroll => scroll.options.behavior === 'auto')).toBe(true);

      Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 390 });
      const data = sectionTabs().getByRole('tab', { name: 'Data' });
      Object.defineProperty(data, 'offsetLeft', { configurable: true, value: 600 });
      Object.defineProperty(data, 'offsetWidth', { configurable: true, value: 80 });
      scrolls.length = 0;
      fireEvent.click(data);
      expect(stripScrolls()).toEqual([{ element: strip, options: { left: 445, behavior: 'smooth' } }]);

      document.documentElement.dataset.motion = 'reduced';
      scrolls.length = 0;
      fireEvent.click(sectionTabs().getByRole('tab', { name: 'Overview' }));
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
    const strip = screen.getByRole('navigation', { name: 'Health sections' });
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
      const tablist = await screen.findByRole('tablist', { name: 'Health sections' });
      fireEvent.click(within(tablist).getByRole('tab', { name: names[index % names.length]! }));
      await flush();
    }
    await waitFor(() => expect(aborted).toBeGreaterThan(0));
    expect(maximumActive).toBeLessThanOrEqual(2);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('reaches the record browser through the Data tab without another availability request and returns through the Overview tab', async () => {
    const f = fixture();
    render(home());
    await settled();
    fireEvent.click(screen.getByRole('tab', { name: 'Data' }));
    const browse = await screen.findByLabelText('Browse');
    expect((browse as HTMLSelectElement).value).toBe(sources.metrics);
    await waitFor(() => expect(f.queries.at(-1)).toMatchObject({ source: sources.metrics, limit: 50 }));
    expect(screen.queryByRole('heading', { name: 'Training' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back to overview' })).toBeNull();
    fireEvent.click(sectionTabs().getByRole('tab', { name: 'Overview' }));
    await settled();
    expect(sectionTabs().getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
    expect(f.capabilityCalls()).toBe(1);
  });
  it.each([
    [404, 'Health is not enabled on this backend.'],
    [403, 'Health access could not be verified. Sign in as the configured owner.'],
    [503, 'Health is unavailable (HTTP 503).'],
  ])('explains a failed availability check (HTTP %i), reads nothing, and retries on request', async (status, message) => {
    let failing = true;
    const f = fixture({ capabilities: () => failing ? jsonResponse({ error: 'synthetic' }, status) : capabilityList() });
    render(home());
    expect((await screen.findByRole('alert')).textContent).toContain(message);
    expect(f.queries).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'Training' })).toBeNull();
    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry availability' }));
    await settled();
    await waitFor(() => expect(f.queries).toHaveLength(todayReads + shellReads));
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('says so plainly when the backend exposes no browsable collection', async () => {
    const f = fixture({ capabilities: () => capabilityList([sources.workout]) });
    render(home());
    await screen.findByText('No Health data');
    expect(f.queries).toHaveLength(0);
  });
  it('keeps a single page heading when Overview is embedded in the Daily shell', async () => {
    fixture();
    render(home());
    await settled();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'Today' })).toBeNull();
    expect(screen.queryByText('Your workouts, nutrition, body, sleep and latest brief at a glance.')).toBeNull();
  });
  it('keeps keyboard order as the period presets, then each card link and its carousel dot', async () => {
    fixture({ answer: query => jsonResponse(dailyFixture(query)) });
    render(<MemoryRouter><DailyOverview backendUrl={backendUrl} getAccessToken={token}
      capabilities={{ sources: Object.values(sources) }} onRetryAvailability={() => {}} /></MemoryRouter>);
    await settled();
    const user = userEvent.setup();
    await user.tab();
    const named = (element: Element | null) => element?.getAttribute('aria-label') ?? element?.textContent;
    for (const name of ['Today', 'Yesterday', '1 week', '2 weeks', '1 month', 'Training', 'Health', 'Body',
      'Show Training', 'Show Health', 'Show Body']) {
      expect(named(document.activeElement)).toBe(name);
      await user.tab();
    }
    expect(document.activeElement).toBe(document.body);
  });
});
