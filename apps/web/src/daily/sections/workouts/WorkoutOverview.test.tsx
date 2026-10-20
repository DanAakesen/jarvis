import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dailyQuerySources as sources, type DailyQuery } from '@jarvis/contracts';
import { queryDaily } from '../../client';
import { dailyFixture } from '../../test-support';
import type { DailyPages } from '../../ui/useDailyPages';
import type { DailySectionProps } from '../types';
import { TrainingRing, WorkoutOverview } from './WorkoutOverview';
import type { Workout } from './summary';

vi.mock('../../client', async original => ({
  ...await original<typeof import('../../client')>(), queryDaily: vi.fn(),
}));
const read = vi.mocked(queryDaily);
const props: DailySectionProps = {
  backendUrl: 'http://localhost:3999', getAccessToken: async () => 'synthetic-fixture',
  sources: [sources.workouts, sources.metrics, sources.metricCatalog],
  period: { startDate: '2026-10-01', endDate: '2026-10-07' },
  onPeriodChange: vi.fn(), refreshVersion: 0,
};
const rows: Workout[] = [
  { id: 'synthetic-gym', workout_date: '2026-10-02', workout_type: 'traditional_strength_training',
    duration_seconds: 600, active_energy_value: 100, active_energy_unit: 'kcal', avg_heart_rate: 100, max_heart_rate: 130 },
  { id: 'synthetic-run', workout_date: '2026-10-03', workout_type: 'running',
    duration_seconds: 1200, active_energy_value: 200, active_energy_unit: 'kcal',
    distance_value: 3, distance_unit: 'km', avg_heart_rate: 120, max_heart_rate: 150 },
];
function pages(items: Workout[] = rows, overrides: Partial<DailyPages> = {}): DailyPages {
  const result = dailyFixture({ source: sources.workouts, ...props.period }, items);
  return { items, first: result, last: result, status: 'ready', pages: 1, hasMore: false, capped: false,
    loadingMore: false, error: null, loadMore: vi.fn(), reload: vi.fn(), ...overrides };
}
function mount(result = pages(), overrides: Partial<DailySectionProps> = {}) {
  return render(<MemoryRouter><WorkoutOverview {...props} {...overrides} pages={result} rows={result.items} /></MemoryRouter>);
}
const card = (name: string) => screen.getByRole('region', { name: `${name} class` });
function figure(name: string, label: string) {
  return within(card(name)).getByText(label, { selector: 'dt' }).nextElementSibling;
}
beforeEach(() => {
  read.mockReset();
  vi.mocked(props.onPeriodChange).mockClear();
  read.mockImplementation(async (_url, query) => dailyFixture(query));
});
afterEach(cleanup);

describe('Workout parity composition', () => {
  it('renders served totals, class figures, settings links and the Gym/Run/Other legend', async () => {
    mount();
    expect(screen.getByLabelText('Workout summary').textContent).toBe('Sessions2Calories burned300 kcal');
    expect(figure('Gym', 'Time')?.textContent).toBe('10 min');
    expect(figure('Gym', 'Energy')?.textContent).toBe('100 kcal');
    expect(figure('Gym', 'Average heart rate')?.textContent).toBe('100 bpm');
    expect(figure('Gym', 'Maximum heart rate')?.textContent).toBe('130 bpm');
    expect(figure('Run', 'Time')?.textContent).toBe('20 min');
    expect(figure('Run', 'Energy')?.textContent).toBe('200 kcal');
    expect(figure('Run', 'Distance')?.textContent).toBe('3 km');
    expect(figure('Run', 'Average heart rate')?.textContent).toBe('120 bpm');
    expect(figure('Run', 'Maximum heart rate')?.textContent).toBe('150 bpm');
    expect(screen.getAllByRole('link', { name: 'No target set' }).map(link => link.getAttribute('href')))
      .toEqual(['/settings#training-targets', '/settings#training-targets']);
    expect(within(screen.getByRole('list', { name: 'Workout energy legend' })).getAllByRole('listitem')
      .map(item => item.textContent)).toEqual(['1Gym', '2Run', '3Other']);
    expect(screen.getByRole('img', { name: 'Calories burned by Copenhagen day (kcal)' })).toBeTruthy();
    await waitFor(() => expect(figure('Activity', 'Steps')?.textContent).toBe('Not received'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Period' }), { target: { value: '14' } });
    expect(props.onPeriodChange).toHaveBeenCalledOnce();
  });

  it('shows every missing class figure as Not received without deriving heart rate or activity time from workouts', async () => {
    mount(pages([
      { workout_date: '2026-10-02', workout_type: 'strength_training' },
      { workout_date: '2026-10-03', workout_type: 'running' },
    ]));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    for (const name of ['Gym', 'Run', 'Activity']) {
      const figures = card(name).querySelectorAll('dd');
      expect(figures.length).toBe(name === 'Gym' ? 4 : name === 'Run' ? 5 : 3);
      expect([...figures].every(item => item.textContent === 'Not received')).toBe(true);
    }
    expect(screen.getByLabelText('Workout summary').textContent).toContain('Calories burnedNot received');
  });

  it('loads activity from metrics and inventory from catalogue rows, never workout detail', async () => {
    read.mockImplementation(async (_url, query) => dailyFixture(query, query.source === sources.metrics ? [
      { metric_name: 'step_count', metric_date: '2026-10-02', value: 123, unit: 'count' },
      { metric_name: 'active_energy_burned', metric_date: '2026-10-02', value: 42, unit: 'kcal' },
      { metric_name: 'apple_exercise_time', metric_date: '2026-10-02', value: 5, unit: 'min' },
    ] : [
      { metric_name: 'step_count', first_date: '2026-10-02', last_date: '2026-10-02', day_count: 1, units: ['count'] },
      { metric_name: 'heart_rate', first_date: '2026-10-02', last_date: '2026-10-02', day_count: 1, units: ['bpm'] },
    ]));
    mount();
    await waitFor(() => expect(figure('Activity', 'Steps')?.textContent).toBe('123 steps'));
    expect(figure('Activity', 'Active energy')?.textContent).toBe('42 kcal');
    expect(figure('Activity', 'Activity time')?.textContent).toBe('5 min');
    expect(within(screen.getByRole('region', { name: 'Summary candidates inventory' }))
      .getByText('Step count — 1 recorded day · count')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Heart and provenance inventory' }))
      .getByText('Heart rate — 1 recorded day · bpm')).toBeTruthy();
    expect(read.mock.calls.map(call => call[1].source).sort()).toEqual([sources.metricCatalog, sources.metrics].sort());
  });

  it('never reads an unserved source and explicitly marks it unavailable', () => {
    mount(pages(), { sources: [sources.workouts] });
    expect(read).not.toHaveBeenCalled();
    expect(screen.getByText('Unavailable. activity metrics is not served.')).toBeTruthy();
    expect(screen.getByText('Unavailable. metric catalogue is not served.')).toBeTruthy();
    expect(figure('Activity', 'Steps')?.textContent).toBe('Not received');
  });

  it('reserves the same card bodies in loading, empty, error and partial states', () => {
    const states: Partial<DailyPages>[] = [
      { first: null, last: null, status: 'loading' }, {},
      { first: null, last: null, status: 'error', error: 'Synthetic failure' },
      { hasMore: true, capped: true },
    ];
    for (const state of states) {
      const view = mount(pages([], state), { sources: [sources.workouts] });
      expect(view.container.querySelectorAll('.workouts-training-body')).toHaveLength(1);
      expect(view.container.querySelectorAll('.workouts-day-chart')).toHaveLength(1);
      expect(view.container.querySelectorAll('.workouts-class-figures')).toHaveLength(3);
      expect(view.container.querySelectorAll('.workouts-inventory-list')).toHaveLength(3);
      expect(view.container.querySelectorAll('.workouts-card-status')).toHaveLength(5);
      if (state.hasMore) expect(screen.getByText('Partial workout history.')).toBeTruthy();
      view.unmount();
    }
  });

  it('retains healthy workout data when activity fails and retries that source only', async () => {
    read.mockRejectedValueOnce(new Error('Synthetic metrics failure'));
    mount();
    expect(await screen.findByRole('button', { name: 'Retry activity metrics' })).toBeTruthy();
    expect(screen.getByLabelText('Workout summary').textContent).toContain('300 kcal');
    fireEvent.click(screen.getByRole('button', { name: 'Retry activity metrics' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry activity metrics' })).toBeNull());
    expect(read.mock.calls.filter(call => call[1].source === sources.metrics)).toHaveLength(2);
  });

  it('reports partial metric/catalogue pages instead of claiming full totals', async () => {
    read.mockImplementation(async (_url, query: DailyQuery) =>
      dailyFixture(query, [], query.source === sources.metrics ? { date: '2026-10-02', key: 'synthetic-next' } : { key: 'synthetic-next' }));
    mount();
    expect(await screen.findByText('Partial activity metrics: only loaded records are shown.')).toBeTruthy();
    expect(await screen.findByText('Partial metric catalogue: only loaded records are shown.')).toBeTruthy();
  });
});

describe('target-ready mini ring', () => {
  it.each([[2, 3, 7, 200 / 3], [9, 3, 7, 100], [3, 3, 14, 50], [0, 3, 7, 0]] as const)(
    'renders %s sessions with weekly target %s over %s days', (count, target, days, percent) => {
      const view = render(<MemoryRouter><TrainingRing label="Gym" count={count} target={target} days={days} /></MemoryRouter>);
      const fill = view.container.querySelector('.daily-ring-fill');
      if (percent === 0) expect(fill).toBeNull();
      else expect(Number(fill?.getAttribute('stroke-dasharray')?.split(' ')[0])).toBeCloseTo(percent);
      expect(screen.queryByRole('link', { name: 'No target set' })).toBeNull();
    });

  it('draws no progress arc without a target, but preserves the session count and settings link', () => {
    const view = render(<MemoryRouter><TrainingRing label="Run" count={4} target={null} days={7} /></MemoryRouter>);
    expect(view.container.querySelector('.daily-ring-fill')).toBeNull();
    expect(screen.getByRole('img', { name: 'Run: 4 sessions; no target set' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'No target set' }).getAttribute('href')).toBe('/settings#training-targets');
  });
});
