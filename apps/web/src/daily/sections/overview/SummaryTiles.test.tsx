import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { dailyQuerySources as sources, isDailyQuery, type DailyJson, type DailyQuery, type DailySourceId } from '@jarvis/contracts';
import { DailyRefreshContext } from '../../refresh';
import { formatDate } from '../../ui/formatters';
import { dailyFixture, jsonResponse } from '../../test-support';
import { overviewPeriods } from './summary';
import { OverviewSummaryTiles } from './SummaryTiles';

const token = async () => 'synthetic-fixture';
const available = [sources.workouts, sources.meals, sources.days, sources.metrics, sources.metricCatalog,
  sources.sleep, sources.briefs, sources.brief];
const period = overviewPeriods();
const latestWorkout = { id: 'synthetic-workout-a', workout_date: period.sevenDays.endDate, workout_type: 'running', duration_seconds: 1800 };
const earlierWorkout = { id: 'synthetic-workout-b', workout_date: period.thisWeek.startDate, workout_type: 'walking', duration_seconds: 600 };
const nutritionDay = {
  meal_date: period.sevenDays.endDate, meal_count: 2, energy_kcal: 1200, protein_grams: 80,
  carbohydrates_grams: 100, fat_grams: 30, fiber_grams: 10, unknown_nutrients: [], partial_nutrients: [],
  latest_updated_at: '2026-10-18T07:00:00Z',
};
const summaryRows: Partial<Record<DailySourceId, Record<string, DailyJson>[]>> = {
  [sources.workouts]: [latestWorkout, earlierWorkout],
  [sources.days]: [nutritionDay],
  [sources.metrics]: [
    { metric_name: 'body_mass', metric_date: period.sevenDays.endDate, value: 70, unit: 'kg' },
    { metric_name: 'body_mass', metric_date: period.thisWeek.startDate, value: 69, unit: 'kg' },
    { metric_name: 'step_count', metric_date: period.sevenDays.endDate, value: 5000, unit: 'count' },
    { metric_name: 'heart_rate', metric_date: period.sevenDays.endDate, value: null, unit: 'bpm' },
  ],
  [sources.sleep]: [{ sleep_date: period.sevenDays.endDate, total_sleep_hours: 8, asleep_hours: 7, deep_hours: 1 }],
  [sources.briefs]: [{
    id: 'synthetic-brief-a', trigger: 'scheduled', started_at: '2026-10-18T07:00:00',
    status: 'completed', delivery_status: 'not_requested',
  }],
};
const targetReply = {
  targets: { restingKcal: 2000, deficitKcal: 300, proteinGrams: 100 },
  bounds: {
    restingKcal: { label: 'Resting burn', unit: 'kcal', min: 0, max: 5000 },
    deficitKcal: { label: 'Deficit', unit: 'kcal', min: 0, max: 2000 },
    proteinGrams: { label: 'Protein', unit: 'g', min: 0, max: 500 },
  },
  updatedAt: '2026-10-18T07:00:00Z',
};

function fixture({ failWorkouts = false, partialWorkouts = false, rows = summaryRows }: {
  failWorkouts?: boolean; partialWorkouts?: boolean;
  rows?: Partial<Record<DailySourceId, Record<string, DailyJson>[]>>;
} = {}) {
  let fail = failWorkouts;
  const queries: DailyQuery[] = [];
  const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith('/daily/nutrition-targets')) return jsonResponse(targetReply);
    const query: unknown = JSON.parse(String(init?.body));
    if (!isDailyQuery(query)) throw new Error('Invalid synthetic query');
    queries.push(query);
    if (fail && query.source === sources.workouts) { fail = false; return jsonResponse({ error: 'synthetic' }, 503); }
    return jsonResponse(dailyFixture(query, rows[query.source] ?? [],
      partialWorkouts && query.source === sources.workouts ? { date: period.sevenDays.endDate, key: 'synthetic-next' } : null));
  });
  vi.stubGlobal('fetch', fetch);
  return { queries, fetch };
}

function view(ids: readonly DailySourceId[] = available) {
  return <MemoryRouter><DailyRefreshContext.Provider value={0}>
    <OverviewSummaryTiles backendUrl="http://localhost:3999" getAccessToken={token} refreshVersion={0} available={ids} />
  </DailyRefreshContext.Provider></MemoryRouter>;
}

function tile(title: string) {
  const heading = screen.getByRole('heading', { level: 4, name: title });
  const article = heading.closest('article');
  if (!article) throw new Error(`Missing summary tile: ${title}`);
  return within(article);
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Daily overview summary tiles', () => {
  it('summarizes every exposed section with its shared calculations, freshness and section links', async () => {
    const f = fixture();
    render(view());
    expect(await screen.findByText('This week: 2 workouts · 40 minutes')).toBeTruthy();
    expect(tile('Workouts').getByText('Running')).toBeTruthy();
    expect(tile('Workouts').getByText(formatDate(period.sevenDays.endDate))).toBeTruthy();
    expect(tile('Workouts').getByRole('link', { name: 'Workouts' }).getAttribute('href')).toBe('/?section=workouts');

    expect(await screen.findByText('Resting burn minus deficit (before activity): 1,700 kcal baseline allowance.')).toBeTruthy();
    expect(tile('Nutrition').getByText('Protein: 80 g of 100 g target.')).toBeTruthy();
    expect(tile('Nutrition').getByRole('link', { name: 'Nutrition' }).getAttribute('href')).toBe('/?section=nutrition');

    expect(tile('Body').getByText(/Body mass/u)).toBeTruthy();
    expect(tile('Body').getByText(/Change since previous: 1 kg/u)).toBeTruthy();
    expect(tile('Body').getAllByText(/Unknown bpm/u)).toHaveLength(2);
    expect(tile('Body').getByRole('link', { name: 'Body' }).getAttribute('href')).toBe('/?section=body-sleep');
    expect(tile('Sleep').getByText(/Total: 8 h · Asleep: 7 h/u)).toBeTruthy();
    expect(tile('Sleep').getByText(/Deep: 1 h/u)).toBeTruthy();
    expect(tile('Sleep').getByRole('link', { name: 'Sleep' }).getAttribute('href')).toBe('/?section=body-sleep');
    expect(tile('Briefs').getByText('Scheduled brief')).toBeTruthy();
    expect(tile('Briefs').getByRole('link', { name: 'Briefs' }).getAttribute('href')).toBe('/?section=briefs');
    expect(screen.getAllByText(/^Read /u)).toHaveLength(5);
    expect(f.queries.some(query => query.source === sources.days &&
      query.startDate === period.sevenDays.startDate && query.endDate === period.sevenDays.endDate)).toBe(true);
    expect(f.queries.some(query => query.source === sources.workouts &&
      query.startDate === period.thirtyDays.startDate && query.endDate === period.thirtyDays.endDate)).toBe(true);
  });

  it('isolates a tile failure, retains other summaries and retries only the failed source', async () => {
    const f = fixture({ failWorkouts: true });
    render(view());
    const workouts = tile('Workouts');
    expect(await workouts.findByRole('alert')).toBeTruthy();
    expect(tile('Nutrition').getByText(/Energy: 1,200 kcal/u)).toBeTruthy();
    expect(tile('Sleep').getByText(/Total: 8 h/u)).toBeTruthy();
    fireEvent.click(workouts.getByRole('button', { name: 'Retry' }));
    expect(await workouts.findByText('Running')).toBeTruthy();
    await waitFor(() => expect(f.queries.filter(query => query.source === sources.workouts)).toHaveLength(2));
  });

  it('omits tiles whose source or destination section is unavailable', async () => {
    const f = fixture();
    render(view([sources.days, sources.workouts]));
    expect(await screen.findByRole('heading', { level: 4, name: 'Workouts' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 4, name: 'Nutrition' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 4, name: 'Body' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 4, name: 'Sleep' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 4, name: 'Briefs' })).toBeNull();
    await waitFor(() => expect(f.queries.length).toBe(1));
  });

  it('uses the shared empty, partial and loading states per tile', async () => {
    fixture({ rows: { ...summaryRows, [sources.workouts]: [], [sources.days]: [] } });
    render(view([sources.workouts, sources.meals, sources.days]));
    expect(await screen.findByText('No workout in the last 30 days')).toBeTruthy();
    expect(await screen.findByText('No meals recorded in the last 7 days')).toBeTruthy();
    cleanup();

    fixture({ partialWorkouts: true });
    render(view([sources.workouts]));
    await waitFor(() => expect(tile('Workouts').getAllByRole('status')
      .some(status => status.textContent?.includes('Showing the first 20'))).toBe(true));
    cleanup();

    let captured: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => await new Promise<Response>((_resolve, reject) => {
      captured = init?.signal as AbortSignal;
      captured.addEventListener('abort', () => reject(captured?.reason), { once: true });
    })));
    const rendered = render(view([sources.workouts]));
    expect(await screen.findByText('Loading workouts summary')).toBeTruthy();
    await waitFor(() => expect(captured).toBeDefined());
    rendered.unmount();
    expect(captured?.aborted).toBe(true);
  });
});
