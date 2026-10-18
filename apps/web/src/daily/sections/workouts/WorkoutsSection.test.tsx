import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useNavigate, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dailyQuerySources as sources, type DailyQuery, type DailyQueryResult } from '@jarvis/contracts';
import { DailyReadError, queryDaily } from '../../client';
import { dailyFixture } from '../../test-support';
import type { DailySectionProps } from '../types';
import { discoverDailySections, loadDailySectionModules } from '../discovery';
import type { DailySectionDefinition } from '../types';
import WorkoutsSection from './WorkoutsSection';
import { section } from './index';
import type { Workout } from './summary';

vi.mock('../../client', async importOriginal => ({
  ...await importOriginal<typeof import('../../client')>(), queryDaily: vi.fn(),
}));

const read = vi.mocked(queryDaily);
const props: DailySectionProps = {
  backendUrl: 'http://localhost:3999', getAccessToken: async () => 'synthetic-fixture',
  sources: [sources.workouts, sources.workout, sources.heartRate],
  period: { startDate: '2026-10-01', endDate: '2026-10-18' },
  onPeriodChange: () => {}, refreshVersion: 0,
};
const workouts: Workout[] = [
  { id: 'synthetic-run', workout_type: 'running', workout_date: '2026-10-16', start_at: '2026-10-16T08:00:00Z',
    end_at: '2026-10-16T08:20:00Z', duration_seconds: 1200, distance_value: 3, distance_unit: 'km',
    active_energy_value: 123, active_energy_unit: 'kcal', avg_heart_rate: 111, max_heart_rate: 141,
    is_indoor: false, source_name: 'Synthetic watch' },
  { id: 'synthetic-cycle', workout_type: 'cycling', workout_date: '2026-10-17', start_at: '2026-10-17T08:00:00Z',
    duration_seconds: 600, distance_value: 5, distance_unit: 'km', active_energy_value: 89, active_energy_unit: 'kcal' },
  { id: 'synthetic-unknown', workout_type: 'new_future_sport', workout_date: '2026-10-15', duration_seconds: null },
];
const samples: Workout[] = [
  { sample_minute: '2026-10-16T08:00:00Z', metric_name: 'heart_rate_data', min_value: 90, avg_value: 110, max_value: 130, unit: 'bpm', sample_count: 4 },
  { sample_minute: '2026-10-16T08:01:00Z', metric_name: 'heart_rate_data', min_value: 95, avg_value: 115, max_value: 135, unit: 'bpm', sample_count: 4 },
  { sample_minute: '2026-10-16T08:01:00Z', metric_name: 'synthetic_other', min_value: 1, avg_value: 2, max_value: 3, unit: 'count', sample_count: 1 },
  { sample_minute: '2026-10-16T08:21:00Z', metric_name: 'heart_rate_recovery', min_value: 100, avg_value: 105, max_value: 110, unit: 'bpm', sample_count: 2 },
];
function respond(query: DailyQuery): DailyQueryResult {
  return dailyFixture(query, query.source === sources.workouts ? workouts :
    query.source === sources.heartRate ? samples : [{ id: 'synthetic-run', detail: { synthetic: true } }]);
}
function Navigation() {
  const navigate = useNavigate();
  const location = useLocation();
  return <><output aria-label="URL">{location.search}</output><button onClick={() => navigate(-1)}>Browser Back</button></>;
}
function mount(overrides: Partial<DailySectionProps> = {}, entry = '/daily?section=workouts') {
  const view = (version: number) => <MemoryRouter initialEntries={[entry]}>
    <Navigation /><WorkoutsSection {...props} {...overrides} refreshVersion={version} />
  </MemoryRouter>;
  const rendered = render(view(overrides.refreshVersion ?? 0));
  return { ...rendered, refresh: () => rendered.rerender(view(1)) };
}
function table() {
  const disclosure = screen.getByText('View as table');
  if (!disclosure.closest('details')?.open) fireEvent.click(disclosure);
  return screen.getByRole('region', { name: 'Workouts in the loaded rows' });
}
async function openRun() {
  const button = (await within(table()).findAllByRole('button', { name: /^Open Running/u }))[0]!;
  fireEvent.click(button);
  await screen.findByRole('heading', { name: /^Running ·/u });
  return button;
}
function deferred() {
  let resolve!: (result: DailyQueryResult) => void;
  const promise = new Promise<DailyQueryResult>(yes => { resolve = yes; });
  return { promise, resolve };
}

beforeEach(() => { read.mockReset(); read.mockImplementation(async (_url, query) => respond(query)); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Workouts section', () => {
  it('is discovered from its folder and requires only the list source', async () => {
    const modules = import.meta.glob<{ section: DailySectionDefinition }>('./index.tsx');
    const loaded = await loadDailySectionModules(modules);
    expect(Object.values(loaded)[0]?.section).toBe(section);
    const entries = { './sections/workouts/index.tsx': { section } };
    expect(discoverDailySections(entries, [sources.workouts])).toEqual([section]);
    expect(discoverDailySections(entries, [sources.heartRate, sources.workout])).toEqual([]);
  });

  it('shows the shared loader while the initial read is pending', () => {
    read.mockReturnValue(new Promise(() => {}));
    mount();
    expect(screen.getByText('Loading Daily history')).toBeTruthy();
    expect(read.mock.calls[0]?.[1]).toEqual({ source: sources.workouts, ...props.period, limit: 500 });
  });

  it('uses the standard empty sentence without inventing totals', async () => {
    read.mockImplementation(async (_url, query) => dailyFixture(query));
    mount();
    expect(await screen.findByText(/History appears after an import/u)).toBeTruthy();
    expect(screen.queryByLabelText('Workout summary')).toBeNull();
  });

  it('shows freshness, a compact overview, type breakdown, and one visible history layout', async () => {
    mount();
    expect(await screen.findByRole('list', { name: 'Recorded workout history' })).toBeTruthy();
    expect(screen.getByText(/3 records/u)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'By type' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Recorded workout minutes per week' })).toBeTruthy();
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);
    expect(screen.getByText('About this data').closest('details')?.open).toBe(false);
    expect(screen.queryByRole('region', { name: 'Workouts in the loaded rows' })).toBeNull();
    table();
    expect(screen.getByRole('region', { name: 'Workouts in the loaded rows' })).toBeTruthy();
  });

  it('shows errors with a working retry', async () => {
    read.mockRejectedValueOnce(new DailyReadError('Synthetic outage'));
    mount();
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Synthetic outage'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('list', { name: 'Recorded workout history' });
    table();
  });

  it('sorts only loaded rows and keeps missing values last', async () => {
    mount();
    await screen.findByRole('list', { name: 'Recorded workout history' });
    table();
    const firstType = () => within(table()).getAllByRole('row')[1]?.textContent;
    expect(firstType()).toContain('Cycling');
    fireEvent.change(screen.getByLabelText('Sort loaded workouts'), { target: { value: 'duration' } });
    expect(firstType()).toContain('Running');
    fireEvent.change(screen.getByLabelText('Sort loaded workouts'), { target: { value: 'distance' } });
    expect(firstType()).toContain('Cycling');
    fireEvent.change(screen.getByLabelText('Sort loaded workouts'), { target: { value: 'energy' } });
    expect(firstType()).toContain('Running');
    expect(within(table()).getAllByRole('row').at(-1)?.textContent).toMatch(/New future sport/iu);
    expect(within(table()).getAllByLabelText('Not recorded').length).toBeGreaterThan(0);
    expect(within(table()).getAllByText(/Not recorded/u).length).toBeGreaterThan(0);
  });

  it('sorts dates by instants, not the spelling of timezone offsets', async () => {
    read.mockImplementation(async (_url, query) => dailyFixture(query, [
      { id: 'synthetic-offset', workout_type: 'running', workout_date: '2026-10-16', start_at: '2026-10-16T10:00:00+02:00' },
      { id: 'synthetic-utc', workout_type: 'cycling', workout_date: '2026-10-16', start_at: '2026-10-16T09:00:00Z' },
    ]));
    mount();
    await screen.findByRole('list', { name: 'Recorded workout history' });
    table();
    expect(within(table()).getAllByRole('row')[1]?.textContent).toContain('Cycling');
  });

  it('filters both the summary and history, with All and counts first', async () => {
    mount();
    await screen.findByRole('list', { name: 'Recorded workout history' });
    table();
    expect(within(screen.getByLabelText('Workout type')).getAllByRole('option')[0]?.textContent).toBe('All (3)');
    fireEvent.change(screen.getByLabelText('Workout type'), { target: { value: 'running' } });
    expect(within(table()).queryByText('Cycling')).toBeNull();
    const summary = screen.getByLabelText('Workout summary');
    expect(within(summary).getAllByRole('article')[0]?.textContent).toMatch(/Workouts1/u);
    expect(within(summary).getByText('3 km')).toBeTruthy();
  });

  it('caps automatic reads at ten pages, scopes totals, and loads more on request', async () => {
    read.mockImplementation(async (_url, query) => {
      const page = 'cursor' in query && query.cursor && 'key' in query.cursor ? Number(query.cursor.key) : 0;
      return dailyFixture(query, [{ ...workouts[0]!, id: `synthetic-${page}` }],
        page < 10 ? { date: '2026-10-16', key: String(page + 1) } : null);
    });
    mount();
    expect(await screen.findByText('Showing 10 workouts; more exist in this period')).toBeTruthy();
    expect(read).toHaveBeenCalledTimes(10);
    expect(screen.getAllByText(/in the 10 loaded/u).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /^Load more$/u }));
    await waitFor(() => expect(screen.queryByText(/more exist in this period/u)).toBeNull());
    expect(within(table()).getAllByRole('row')).toHaveLength(12);
  });

  it('keeps loaded totals scoped when a subsequent page fails', async () => {
    read.mockImplementation(async (_url, query) => {
      if ('cursor' in query && query.cursor) throw new DailyReadError('Synthetic page failure');
      return dailyFixture(query, workouts, { date: '2026-10-15', key: 'synthetic-next' });
    });
    mount();
    expect(await screen.findByText('Synthetic page failure')).toBeTruthy();
    expect(screen.getAllByText(/in the 3 loaded/u).length).toBeGreaterThan(0);
    expect(within(table()).getAllByRole('row')).toHaveLength(4);
  });

  it('refreshes the whole period on focus after an explicit continuation', async () => {
    let refreshed = false;
    read.mockImplementation(async (_url, query) => {
      if (refreshed) return dailyFixture(query, [{ ...workouts[0]!, id: 'synthetic-refreshed', source_name: 'Synthetic refreshed source' }]);
      const page = 'cursor' in query && query.cursor && 'key' in query.cursor ? Number(query.cursor.key) : 0;
      return dailyFixture(query, [{ ...workouts[0]!, id: `synthetic-${page}` }],
        page < 10 ? { date: '2026-10-16', key: String(page + 1) } : null);
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /^Load more$/u }));
    await waitFor(() => expect(within(table()).getAllByRole('row')).toHaveLength(12));
    refreshed = true;
    fireEvent.focus(window);
    await waitFor(() => expect(within(table()).getAllByRole('row')).toHaveLength(2));
    expect(within(table()).getByText('Synthetic refreshed source')).toBeTruthy();
    expect(read.mock.calls.at(-1)?.[1]).not.toHaveProperty('cursor');
  });

  it('opens URL-backed detail, heart-rate lines, metric selection, and bounded recorded JSON', async () => {
    mount();
    await screen.findByRole('list', { name: 'Recorded workout history' });
    table();
    await openRun();
    expect(screen.getByLabelText('URL').textContent).toContain('workout=synthetic-run');
    const heartRate = await screen.findByRole('img', { name: /Heart rate \(bpm\), elapsed minutes/u });
    const chart = heartRate.closest('figure')!;
    expect(chart.querySelector('.daily-chart-range path')).toBeTruthy();
    expect(chart.querySelectorAll('.daily-chart-series')).toHaveLength(3);
    expect(within(chart).getByText('Average (bpm)')).toBeTruthy();
    expect(within(chart).getByText('Minimum (bpm)')).toBeTruthy();
    expect(within(chart).getByText('Maximum (bpm)')).toBeTruthy();
    expect(within(chart).queryByRole('table')).toBeNull();
    fireEvent.click(within(chart).getByText('View data table'));
    expect(within(chart).getByRole('table', { name: /Heart rate \(bpm\), elapsed minutes/u })).toBeTruthy();
    expect(screen.getByLabelText('Metric')).toHaveProperty('value', 'heart_rate_data');
    const metric = within(screen.getByLabelText('Metric'));
    expect(metric.getByRole('option', { name: 'Heart rate' })).toHaveProperty('value', 'heart_rate_data');
    expect(metric.getByRole('option', { name: 'Heart rate recovery' })).toHaveProperty('value', 'heart_rate_recovery');
    fireEvent.change(screen.getByLabelText('Metric'), { target: { value: 'heart_rate_recovery' } });
    expect(screen.getByRole('img', { name: /Heart rate recovery \(bpm\), elapsed minutes/u })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Metric'), { target: { value: 'synthetic_other' } });
    expect(screen.getByRole('img', { name: /synthetic_other/u })).toBeTruthy();
    fireEvent.click(screen.getByText('Recorded detail'));
    expect(await screen.findByText(/"synthetic": true/u)).toBeTruthy();
  });

  it('restores focus and ancestor scroll on Back and on browser Back', async () => {
    mount();
    await screen.findByRole('list', { name: 'Recorded workout history' });
    table();
    table().scrollTop = 55;
    const button = await openRun();
    fireEvent.click(screen.getByRole('button', { name: 'Back to workouts' }));
    expect(document.activeElement).toBe(button);
    expect(table().scrollTop).toBe(55);
    await openRun();
    fireEvent.click(screen.getByRole('button', { name: 'Browser Back' }));
    expect(document.activeElement).toBe(button);
    expect(screen.getByLabelText('URL').textContent).not.toContain('workout=');
  });

  it('keeps the opened workout through a refresh and reads its sources again', async () => {
    const rendered = mount();
    await screen.findByRole('list', { name: 'Recorded workout history' });
    table();
    await openRun();
    const before = read.mock.calls.length;
    rendered.refresh();
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThanOrEqual(before + 3));
    expect(screen.getByRole('heading', { name: /^Running ·/u })).toBeTruthy();
    expect(screen.getByLabelText('URL').textContent).toContain('synthetic-run');
  });

  it('opens a workout directly from its URL and handles an unknown id', async () => {
    mount({}, '/daily?section=workouts&workout=missing-synthetic-id');
    expect(await screen.findByText('Workout not found in the loaded period.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to workouts' }));
    expect(table()).toBeTruthy();
  });

  it('gates detail and heart-rate reads independently by exposed sources', async () => {
    mount({ sources: [sources.workouts] }, '/daily?section=workouts&workout=synthetic-run');
    await screen.findByRole('heading', { name: /^Running ·/u });
    expect(screen.queryByText('Recorded detail')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Heart rate' })).toBeNull();
    expect(read.mock.calls.every(call => call[1].source === sources.workouts)).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: /^Running ·/u }));
  });

  it('shows heart-rate loading, an explicit empty result, and an error with Retry', async () => {
    const pending = deferred();
    read.mockImplementation(async (_url, query) => query.source === sources.heartRate ? pending.promise : respond(query));
    mount({}, '/daily?section=workouts&workout=synthetic-run');
    await screen.findByRole('heading', { name: /^Running ·/u });
    expect(screen.getAllByText('Loading Daily history').length).toBeGreaterThan(0);
    await waitFor(() => expect(read.mock.calls.some(call => call[1].source === sources.heartRate)).toBe(true));
    const query = read.mock.calls.find(call => call[1].source === sources.heartRate)![1];
    await act(async () => pending.resolve(dailyFixture(query)));
    expect(await screen.findByText(/No heart-rate samples were returned/u)).toBeTruthy();
    cleanup();
    let failed = true;
    read.mockImplementation(async (_url, input) => {
      if (input.source === sources.heartRate && failed) throw new DailyReadError('Synthetic sample failure');
      return respond(input);
    });
    mount({}, '/daily?section=workouts&workout=synthetic-run');
    expect(await screen.findByText('Synthetic sample failure')).toBeTruthy();
    failed = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('img', { name: /Heart rate/u })).toBeTruthy();
  });
});
