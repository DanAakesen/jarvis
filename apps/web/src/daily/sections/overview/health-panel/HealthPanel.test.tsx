import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dailyQuerySources as sources, type DailyJson, type DailyQuery } from '@jarvis/contracts';
import { dailyFixture, jsonResponse, trainingTargetsFixture } from '../../../test-support';
import { TrainingTargetsContext } from '../../../training-targets-context';
import { HealthPanel } from './HealthPanel';

const getAccessToken = async () => 'synthetic-fixture';
const allSources = [sources.metrics, sources.metricCatalog, sources.sleep, sources.workouts, sources.days, sources.sync];
const rows: Partial<Record<string, Record<string, DailyJson>[]>> = {};

function Location() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output aria-label="URL">{location.search}</output>
    <button onClick={() => navigate(-1)}>Back fixture</button>
    <button onClick={() => navigate('?panel=health&healthTab=body&keep=yes')}>Deep link fixture</button></>;
}
function mount(url = '/', available = allSources, targets: Parameters<typeof trainingTargetsFixture>[0] = {}, actions: Parameters<typeof trainingTargetsFixture>[1] = {}) {
  return render(<MemoryRouter initialEntries={[url]}><Location />
    <TrainingTargetsContext.Provider value={trainingTargetsFixture(targets, actions)}>
      <HealthPanel backendUrl="https://synthetic.invalid" getAccessToken={getAccessToken} sources={available} refreshVersion={0} />
    </TrainingTargetsContext.Provider></MemoryRouter>);
}
function panel() { return screen.getByRole('tabpanel'); }
async function settled() {
  await waitFor(() => expect(screen.getByText('No sync received')).toBeTruthy());
  await waitFor(() => expect(screen.queryAllByText('Loading Health history')).toHaveLength(0));
  await waitFor(() => expect(within(panel()).getAllByText(/Read /u).length).toBeGreaterThan(0));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
  for (const key of Object.keys(rows)) delete rows[key];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const query = JSON.parse(init.body as string) as DailyQuery;
    return jsonResponse(dailyFixture(query, rows[query.source] ?? []));
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Health panel', () => {
  it('announces Health while loading without exposing internal source ids', async () => {
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const query = JSON.parse(init!.body as string) as DailyQuery;
      await hold;
      return jsonResponse(dailyFixture(query));
    });
    const { container } = mount();
    expect(screen.getAllByText('Loading Health history').length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/\bdaily\b/iu);
    expect(container.textContent).not.toContain(sources.sleep);
    release();
    await settled();
    expect(container.textContent).not.toMatch(/\bdaily\b/iu);
  });

  it.each([
    [401, 'Health access could not be verified. Sign in as the configured owner.'],
    [403, 'Health access could not be verified. Sign in as the configured owner.'],
    [404, 'Health is not enabled on this backend.'],
    [503, 'Health is unavailable (HTTP 503).'],
  ])('uses Health in collection and sync errors (HTTP %i)', async (status, message) => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, status));
    const { container } = mount();
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(6));
    expect(screen.getByText(`Sleep: ${message}`)).toBeTruthy();
    expect(screen.getByText(`Sync: ${message}`)).toBeTruthy();
    expect(container.textContent).not.toMatch(/\bdaily\b/iu);
    expect(container.textContent).not.toContain(sources.sleep);
  });

  it('uses Health for unexpected read failures', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Synthetic network failure'));
    const { container } = mount();
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(6));
    expect(screen.getByText('Sleep: Health could not be loaded.')).toBeTruthy();
    expect(screen.getByText('Sync: Health could not be loaded.')).toBeTruthy();
    expect(container.textContent).not.toMatch(/\bdaily\b/iu);
  });

  it('renders seven labelled tabs with roving focus, arrows, Home and End', async () => {
    mount();
    await settled();
    expect(screen.getByRole('tablist', { name: 'Health views' })).toBeTruthy();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(tab => tab.textContent)).toEqual(['Overview', 'Sleep', 'Activity', 'Workouts', 'Body', 'Nutrition', 'All data']);
    expect(tabs.filter(tab => tab.tabIndex === 0)).toHaveLength(1);
    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    expect(panel().getAttribute('aria-labelledby')).toBe(tabs[1]!.id);
    fireEvent.keyDown(tabs[1]!, { key: 'End' });
    expect(document.activeElement).toBe(tabs[6]);
    fireEvent.keyDown(tabs[6]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[0]);
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tabs[6]);
    fireEvent.keyDown(tabs[6]!, { key: 'Home' });
    expect(document.activeElement).toBe(tabs[0]);
  });

  it('opens by default and drives disclosure, active tab and history through URL params', async () => {
    mount('/?healthTab=sleep&keep=yes');
    await settled();
    expect(screen.getByRole('tab', { name: 'Sleep' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Health' }));
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByLabelText('URL').textContent).toContain('panel=closed');
    fireEvent.click(screen.getByRole('button', { name: 'Back fixture' }));
    expect(screen.getByRole('tablist')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'All data' }));
    expect(screen.getByLabelText('URL').textContent).toContain('healthTab=all');
    expect(screen.getByLabelText('URL').textContent).toContain('keep=yes');
    fireEvent.click(screen.getByRole('button', { name: 'Deep link fixture' }));
    expect(screen.getByRole('tab', { name: 'Body' }).getAttribute('aria-selected')).toBe('true');
  });

  it('honours a collapsed deep link and safely falls back for invalid tabs', () => {
    mount('/?panel=closed&healthTab=invalid');
    expect(screen.queryByRole('tab')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Health' }));
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
  });

  it('renders value, Not received and Unavailable without a false zero or fabricated target', async () => {
    rows[sources.metrics] = [{ metric_name: 'step_count', metric_date: '2026-10-20', unit: 'count', value: 0 }];
    rows[sources.workouts] = [{ workout_date: '2026-10-20', duration_seconds: null }];
    mount();
    await settled();
    expect(within(screen.getByRole('heading', { name: 'Steps today' }).closest('article')!).getByText('0')).toBeTruthy();
    expect(within(screen.getByRole('heading', { name: "Last night's sleep" }).closest('article')!).getByText('Not received')).toBeTruthy();
    expect(within(screen.getByRole('heading', { name: 'Workout duration today' }).closest('article')!).getByText('Unavailable')).toBeTruthy();
    expect(screen.getAllByText('No target set')).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'Set training targets' })[0]!.getAttribute('href')).toBe('/settings#training-targets');
    expect(screen.queryByText(/retention/iu)).toBeNull();
  });

  it.each([
    ['loading', 'Loading target'],
    ['failed', 'Targets unavailable'],
    ['unavailable', 'Targets unavailable'],
  ] as const)('says "%s" targets in words and never "No target set"', async (read, text) => {
    mount('/', allSources, read);
    await settled();
    expect(screen.getAllByText(text)).toHaveLength(2);
    expect(screen.queryByText('No target set')).toBeNull();
    expect(screen.queryByText(/sessions remaining/u)).toBeNull();
  });

  it('retries a failed targets read from the weekly tiles', async () => {
    const retry = vi.fn();
    mount('/', allSources, 'failed', { retry });
    await settled();
    const tile = screen.getByRole('heading', { name: 'Gym weekly target' }).closest('article')!;
    fireEvent.click(within(tile).getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('offers no retry for targets that are not served at all', async () => {
    mount('/', allSources, 'unavailable');
    await settled();
    const tile = screen.getByRole('heading', { name: 'Gym weekly target' }).closest('article')!;
    expect(within(tile).queryByRole('button', { name: 'Retry' })).toBeNull();
  });
  it('renders weekly target arithmetic and inclusive days remaining', async () => {
    rows[sources.workouts] = [
      { workout_date: '2026-10-19', workout_type: 'strength_training' },
      { workout_date: '2026-10-20', workout_type: 'running' },
    ];
    mount('/', allSources, { gymSessionsPerWeek: 3, runSessionsPerWeek: 1 });
    await settled();
    expect(screen.getByText('1 / 3 sessions')).toBeTruthy();
    expect(screen.getByText('2 sessions remaining · 6 days remaining including today')).toBeTruthy();
    expect(screen.getByText('0 sessions remaining · 6 days remaining including today')).toBeTruthy();
  });

  it('keeps a weekly target of 0 apart from a target nobody set', async () => {
    rows[sources.workouts] = [{ workout_date: '2026-10-19', workout_type: 'strength_training' }];
    mount('/', allSources, { gymSessionsPerWeek: 0, runSessionsPerWeek: null });
    await settled();
    const gym = screen.getByRole('heading', { name: 'Gym weekly target' }).closest('article')!;
    expect(within(gym).getByText('1 / 0 sessions')).toBeTruthy();
    expect(within(gym).queryByRole('link', { name: 'Set training targets' })).toBeNull();
    const run = screen.getByRole('heading', { name: 'Run weekly target' }).closest('article')!;
    expect(within(run).getByText('No target set')).toBeTruthy();
    expect(within(run).getByRole('link', { name: 'Set training targets' }).getAttribute('href')).toBe('/settings#training-targets');
    expect(gym.textContent).not.toMatch(/NaN|Infinity/u);
  });

  it('shows catalogue categories, latest values, units and sample dates', async () => {
    rows[sources.metricCatalog] = [{ metric_name: 'synthetic_metric', category: 'body', units: ['kg'],
      first_date: '2026-10-20', last_date: '2026-10-20', day_count: 1, latest_updated_at: '2026-10-20T10:00:00Z' }];
    rows[sources.metrics] = [{ metric_name: 'synthetic_metric', metric_date: '2026-10-20', value: 42, unit: 'kg' }];
    mount('/?healthTab=body');
    await settled();
    expect(within(panel()).getByRole('heading', { name: 'Synthetic metric' })).toBeTruthy();
    expect(within(panel()).getByText('kg')).toBeTruthy();
    expect(panel().querySelector('time[datetime="2026-10-20"]')).toBeTruthy();
  });

  it('shows honest empty and unavailable-source states separately', async () => {
    const view = mount('/?healthTab=activity');
    await settled();
    expect(screen.getByText('No data received for this view.')).toBeTruthy();
    view.unmount();
    mount('/?healthTab=activity', []);
    expect(screen.getByText('Health metrics is not served by this backend.')).toBeTruthy();
    expect(screen.queryByText('No data received for this view.')).toBeNull();
  });

  it('does not label missing catalogue categories as an empty category', async () => {
    rows[sources.metricCatalog] = [{ metric_name: 'synthetic_metric', units: ['kg'],
      first_date: '2026-10-20', last_date: '2026-10-20', day_count: 1, latest_updated_at: '2026-10-20T10:00:00Z' }];
    rows[sources.metrics] = [{ metric_name: 'synthetic_metric', metric_date: '2026-10-20', value: 42, unit: 'kg' }];
    mount('/?healthTab=body');
    await settled();
    expect(screen.getByText('Category grouping is unavailable without catalogue categories. See All data for received metrics.')).toBeTruthy();
    expect(screen.queryByText('No data received for this view.')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'All data' }));
    expect(screen.getByRole('heading', { name: 'Synthetic metric' })).toBeTruthy();
  });

  it('exposes errors and retries through the existing read lifecycle', async () => {
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const query = JSON.parse(init!.body as string) as DailyQuery;
      return query.source === sources.sleep ? jsonResponse({}, 503) : jsonResponse(dailyFixture(query));
    });
    mount('/?healthTab=sleep');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('HTTP 503'));
    expect(screen.queryByText('No data received for this view.')).toBeNull();
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const query = JSON.parse(init!.body as string) as DailyQuery;
      return jsonResponse(dailyFixture(query));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('No data received for this view.')).toBeTruthy());
  });

  it('keeps partial totals unavailable and exposes the loaded page boundary', async () => {
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const query = JSON.parse(init!.body as string) as DailyQuery;
      return jsonResponse(dailyFixture(query, query.source === sources.workouts
        ? [{ id: 'synthetic', workout_date: '2026-10-20', workout_type: 'running' }] : [],
      query.source === sources.workouts ? { date: '2026-10-20', key: 'synthetic' } : null));
    });
    mount('/', allSources, { gymSessionsPerWeek: null, runSessionsPerWeek: 2 });
    await waitFor(() => expect(screen.getByText('Showing the first 10.')).toBeTruthy());
    expect(within(screen.getByRole('heading', { name: 'Run weekly target' }).closest('article')!).getByText('Unavailable')).toBeTruthy();
    expect(within(screen.getByRole('heading', { name: 'Workouts, rolling 7 days' }).closest('article')!).getByText('Unavailable')).toBeTruthy();
    expect(screen.queryByText(/sessions remaining ·/u)).toBeNull();
  });

  it('reads only served sources over the Copenhagen window', async () => {
    mount('/', [sources.sleep]);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await act(async () => {});
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => {
      const query = JSON.parse(init!.body as string) as DailyQuery;
      return query.source === sources.sleep && query.startDate === '2026-10-14' && query.endDate === '2026-10-20';
    })).toBe(true);
  });
});
