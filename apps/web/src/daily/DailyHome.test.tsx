import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Link, MemoryRouter, useSearchParams } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { dailyCapabilitiesVersion, dailyQuerySources as sources, isDailyQuery, type DailyJson, type DailyQuery, type DailySourceId } from '@jarvis/contracts';
import { AreaSectionsContext, areaSectionLinks, type AreaSections } from '../area-sections';
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
const trainingReply = {
  targets: { gymSessionsPerWeek: 3, runSessionsPerWeek: null, dailySteps: 8_000 }, missing: ['runSessionsPerWeek'], updatedAt: '2026-10-17T10:00:00.000Z',
  bounds: {
    gymSessionsPerWeek: { label: 'Gym sessions', unit: 'sessions/week', min: 0, max: 21 },
    runSessionsPerWeek: { label: 'Run sessions', unit: 'sessions/week', min: 0, max: 21 },
    dailySteps: { label: 'Steps per day', unit: 'steps/day', min: 0, max: 100_000 },
  },
};
function gate() {
  let open = () => {};
  const opened = new Promise<void>(resolve => { open = resolve; });
  return { opened, open };
}

function fixture({ capabilities = () => capabilityList(), answer = query => jsonResponse(dailyFixture(query, items(query))), targets = () => jsonResponse(trainingReply) }: {
  capabilities?: () => Response | Promise<Response>;
  answer?: (query: DailyQuery) => Response | Promise<Response>;
  targets?: () => Response | Promise<Response>;
} = {}) {
  const queries: DailyQuery[] = [];
  const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith('/daily/capabilities')) return capabilities();
    if (String(url).endsWith('/daily/training-targets')) return targets();
    const input: unknown = JSON.parse(String(init?.body));
    if (!isDailyQuery(input)) throw new Error('Invalid synthetic query');
    queries.push(input);
    return answer(input);
  });
  vi.stubGlobal('fetch', fetch);
  return {
    queries, fetch,
    capabilityCalls: () => fetch.mock.calls.filter(([url]) => String(url).endsWith('/daily/capabilities')).length,
    targetCalls: () => fetch.mock.calls.filter(([url]) => String(url).endsWith('/daily/training-targets')).length,
  };
}
function SectionUrlProbe() {
  const [params] = useSearchParams();
  return <output data-testid="daily-section-url">{params.get('section') ?? 'no section parameter'}</output>;
}
// Stands in for the shell's navigation panel: it lists the pages the area publishes and links to them.
function ShellSections({ children }: { children: ReactNode }) {
  const [sections, setSections] = useState<AreaSections | null>(null);
  const links = sections ? areaSectionLinks('health', sections) : [];
  return <AreaSectionsContext.Provider value={setSections}>
    <nav aria-label="Health pages">
      {links.map(link => <Link key={link.id} to={link.to} aria-current={link.current ? 'page' : undefined}>{link.label}</Link>)}
    </nav>
    {children}
  </AreaSectionsContext.Provider>;
}
function home(refreshVersion = 0, initialPath = '/health') {
  return <MemoryRouter initialEntries={[initialPath]}>
    <ShellSections>
      <DailyRefreshContext.Provider value={refreshVersion}><DailyHome backendUrl={backendUrl} getAccessToken={token} /></DailyRefreshContext.Provider>
    </ShellSections>
    <SectionUrlProbe />
  </MemoryRouter>;
}
const settled = () => screen.findByRole('heading', { name: 'Training' });
const sectionLinks = () => within(screen.getByRole('navigation', { name: 'Health pages' }));
const sectionLink = (name: string) => sectionLinks().getByRole('link', { name });
// The area publishes its pages from an effect, so the list can follow the page content by a tick.
const listed = () => sectionLinks().findByRole('link', { name: 'Overview' });
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

describe('Daily overview', () => {
  it('shows the three cards and no collection list, through the two Daily endpoints only', async () => {
    const f = fixture();
    render(home());
    await settled();
    await waitFor(() => expect(f.queries).toHaveLength(todayReads + shellReads));
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeTruthy();
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
  it('lists only implemented sections in the shell panel and keeps the shared period when switching sections', async () => {
    const f = fixture({ capabilities: () => capabilityList(Object.values(sources).filter(source => source !== sources.workouts)) });
    render(home());
    await settled();
    await listed();
    expect(sectionLink('Overview')).toBeTruthy();
    expect(sectionLink('Briefs')).toBeTruthy();
    expect(sectionLink('Data')).toBeTruthy();
    expect(sectionLinks().queryByRole('link', { name: 'Workouts' })).toBeNull();
    expect(sectionLink('Nutrition')).toBeTruthy();
    expect(sectionLink('Body & sleep')).toBeTruthy();
    expect(screen.queryByRole('tablist', { name: 'Health sections' })).toBeNull();
    expect(document.querySelector('.daily-section-panel')?.hasAttribute('role')).toBe(false);

    fireEvent.click(sectionLink('Data'));
    await screen.findByLabelText('Browse');
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '30' } });
    await waitFor(() => expect(f.queries.at(-1)).toMatchObject({ source: sources.metrics }));
    expect((screen.getByLabelText('Period') as HTMLSelectElement).value).toBe('30');
    fireEvent.click(sectionLink('Briefs'));
    await screen.findByRole('heading', { level: 2, name: 'Briefs' });
    fireEvent.click(sectionLink('Data'));
    await screen.findByLabelText('Browse');
    expect((screen.getByLabelText('Period') as HTMLSelectElement).value).toBe('30');
  });

  it('publishes nothing until availability is known, then marks the active section, and stores the choice in the URL', async () => {
    const hold = gate();
    fixture({ capabilities: async () => { await hold.opened; return capabilityList(Object.values(sources).filter(source => source !== sources.workouts)); } });
    render(home(0, '/daily?section=unknown'));
    expect(sectionLinks().queryAllByRole('link')).toHaveLength(0);
    hold.open();
    await settled();
    await listed();
    // An unknown id falls back to the first section and leaves the address as it was.
    expect(sectionLinks().getAllByRole('link').map(link => link.textContent))
      .toEqual(['Overview', 'Nutrition', 'Body & sleep', 'Briefs', 'Data', 'Rules & sources']);
    expect(sectionLink('Overview').getAttribute('aria-current')).toBe('page');
    expect(sectionLinks().getAllByRole('link').filter(link => link.hasAttribute('aria-current'))).toHaveLength(1);
    expect(screen.getByTestId('daily-section-url').textContent).toBe('unknown');

    fireEvent.click(sectionLink('Nutrition'));
    expect(screen.getByTestId('daily-section-url').textContent).toBe('nutrition');
    expect(sectionLink('Nutrition').getAttribute('aria-current')).toBe('page');
    expect(sectionLink('Overview').hasAttribute('aria-current')).toBe(false);
    fireEvent.click(sectionLink('Rules & sources'));
    expect(screen.getByTestId('daily-section-url').textContent).toBe('rules');
    expect(sectionLink('Rules & sources').getAttribute('aria-current')).toBe('page');
  });

  it('keeps the section from the address on a reload and has no section row in the page', async () => {
    fixture();
    render(home(0, '/health?section=briefs'));
    await screen.findByRole('heading', { level: 2, name: 'Briefs' });
    expect((await sectionLinks().findByRole('link', { name: 'Briefs' })).getAttribute('aria-current')).toBe('page');
    expect(document.querySelector('.daily-section-nav')).toBeNull();
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
      const navigation = await screen.findByRole('navigation', { name: 'Health pages' });
      fireEvent.click(await within(navigation).findByRole('link', { name: names[index % names.length]! }));
      await flush();
    }
    await waitFor(() => expect(aborted).toBeGreaterThan(0));
    expect(maximumActive).toBeLessThanOrEqual(2);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('reaches the record browser through the Data page without another availability request and returns through the Overview page', async () => {
    const f = fixture();
    render(home());
    await settled();
    await listed();
    fireEvent.click(sectionLink('Data'));
    const browse = await screen.findByLabelText('Browse');
    expect((browse as HTMLSelectElement).value).toBe(sources.metrics);
    await waitFor(() => expect(f.queries.at(-1)).toMatchObject({ source: sources.metrics, limit: 50 }));
    expect(screen.queryByRole('heading', { name: 'Training' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back to overview' })).toBeNull();
    fireEvent.click(sectionLink('Overview'));
    await settled();
    expect(sectionLink('Overview').getAttribute('aria-current')).toBe('page');
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
  it('keeps keyboard order as each card link, the period dropdown in the Training card and each carousel dot', async () => {
    fixture({ answer: query => jsonResponse(dailyFixture(query)) });
    render(<MemoryRouter><DailyOverview backendUrl={backendUrl} getAccessToken={token}
      capabilities={{ sources: Object.values(sources) }} onRetryAvailability={() => {}} /></MemoryRouter>);
    await settled();
    const user = userEvent.setup();
    await user.tab();
    const named = (element: Element | null) => element?.getAttribute('aria-label') ?? element?.textContent;
    for (const name of ['Training', 'Overview period', 'Health', 'Body',
      'Show Training', 'Show Health', 'Show Body']) {
      expect(named(document.activeElement)).toBe(name);
      await user.tab();
    }
    expect(document.activeElement).toBe(document.body);
  });
});
