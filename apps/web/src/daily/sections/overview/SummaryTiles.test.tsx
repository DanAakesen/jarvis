import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { dailyQuerySources as sources, isDailyQuery, type DailyJson, type DailyQuery, type DailySourceId } from '@jarvis/contracts';
import { DailyRefreshContext } from '../../refresh';
import { formatClockTime, formatDate, formatTime } from '../../ui/formatters';
import { dailyFixture, jsonResponse } from '../../test-support';
import { overviewPeriods } from './summary';
import { OverviewSummaryTiles } from './SummaryTiles';

const token = async () => 'synthetic-fixture';
const available = [sources.workouts, sources.meals, sources.days, sources.metrics, sources.metricCatalog,
  sources.sleep, sources.briefs, sources.brief];
const period = overviewPeriods();
const latestWorkout = { id: 'synthetic-workout-a', workout_date: period.sevenDays.endDate, start_at: `${period.sevenDays.endDate}T07:00:00Z`, workout_type: 'running', duration_seconds: 1800 };
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

function fixture({ failWorkouts = false, partialWorkouts = false, failSource, partialSource, rows = summaryRows }: {
  failWorkouts?: boolean; partialWorkouts?: boolean;
  failSource?: DailySourceId; partialSource?: DailySourceId;
  rows?: Partial<Record<DailySourceId, Record<string, DailyJson>[]>>;
} = {}) {
  let fail = failWorkouts || failSource !== undefined;
  const queries: DailyQuery[] = [];
  const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith('/daily/nutrition-targets')) return jsonResponse(targetReply);
    const query: unknown = JSON.parse(String(init?.body));
    if (!isDailyQuery(query)) throw new Error('Invalid synthetic query');
    queries.push(query);
    if (fail && query.source === (failSource ?? sources.workouts)) { fail = false; return jsonResponse({ error: 'synthetic' }, 503); }
    return jsonResponse(dailyFixture(query, rows[query.source] ?? [],
      (partialWorkouts && query.source === sources.workouts || query.source === partialSource)
        ? query.source === sources.briefs ? { startedAt: '2026-10-18T07:00:00', id: 'synthetic-next' }
          : query.source === sources.days ? { date: period.sevenDays.startDate }
            : { date: period.sevenDays.endDate, key: 'synthetic-next' } : null));
  });
  vi.stubGlobal('fetch', fetch);
  return { queries, fetch };
}

function view(ids: readonly DailySourceId[] = available, refreshVersion = 0) {
  return <MemoryRouter><DailyRefreshContext.Provider value={0}>
    <OverviewSummaryTiles backendUrl="http://localhost:3999" getAccessToken={token} refreshVersion={refreshVersion} available={ids} />
  </DailyRefreshContext.Provider></MemoryRouter>;
}

function tile(title: string) {
  const heading = screen.getByRole('heading', { level: 3, name: title });
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
    expect(tile('Workouts').getByText(`Started ${formatClockTime(latestWorkout.start_at)}`)).toBeTruthy();
    expect(tile('Workouts').getByText(`Started ${formatClockTime(latestWorkout.start_at)}`).textContent)
      .not.toContain(formatDate(period.sevenDays.endDate));
    expect(tile('Workouts').getByRole('link', { name: 'Workouts' }).getAttribute('href')).toBe('/?section=workouts');

    expect(await tile('Nutrition').findByRole('progressbar')).toBeTruthy();
    expect(tile('Nutrition').getByText('1,700 kcal')).toBeTruthy();
    expect(tile('Nutrition').getByText('Protein: 80 g.')).toBeTruthy();
    expect(tile('Nutrition').getByText('Protein target: 100 g')).toBeTruthy();
    expect(tile('Nutrition').getByRole('link', { name: 'Nutrition' }).getAttribute('href')).toBe('/?section=nutrition');

    expect(tile('Body').getByText(/Body mass/u)).toBeTruthy();
    expect(tile('Body').getByText(/Change since previous: 1 kg/u)).toBeTruthy();
    expect(tile('Body').getByRole('img', { name: /Body mass \(kg\), recorded observations/u })).toBeTruthy();
    expect(tile('Body').getByRole('link', { name: 'Body' }).getAttribute('href')).toBe('/?section=body-sleep');
    expect(tile('Sleep').getByText('8 h total sleep')).toBeTruthy();
    expect(tile('Sleep').getByText('Asleep: 7 h')).toBeTruthy();
    expect(tile('Sleep').getByText(/Deep: 1 h/u)).toBeTruthy();
    expect(tile('Sleep').getByRole('link', { name: 'Sleep' }).getAttribute('href')).toBe('/?section=body-sleep');
    expect(tile('Briefs').getByText('Scheduled brief')).toBeTruthy();
    expect(tile('Briefs').getByText(formatTime('2026-10-18T07:00:00'))).toBeTruthy();
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
    expect(tile('Sleep').getByText(/8 h total sleep/u)).toBeTruthy();
    fireEvent.click(workouts.getByRole('button', { name: 'Retry' }));
    expect(await workouts.findByText('Running')).toBeTruthy();
    await waitFor(() => expect(f.queries.filter(query => query.source === sources.workouts)).toHaveLength(2));
  });

  it('omits tiles whose source or destination section is unavailable', async () => {
    const f = fixture();
    render(view([sources.days, sources.workouts]));
    expect(await screen.findByRole('heading', { level: 3, name: 'Workouts' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 3, name: 'Nutrition' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 3, name: 'Body' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 3, name: 'Sleep' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 3, name: 'Briefs' })).toBeNull();
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
      .some(status => status.textContent?.includes('20 records, partial'))).toBe(true));
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

  it('keeps one linked headline per card and uses the Daily grid, meter and workout glyph', async () => {
    fixture();
    const { container } = render(view());
    await screen.findByText('This week: 2 workouts · 40 minutes');
    expect(container.querySelector('.daily-grid.daily-summary-grid')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Recent summaries' })).toBeNull();
    for (const title of ['Workouts', 'Nutrition', 'Body', 'Sleep', 'Briefs']) {
      expect(tile(title).getAllByRole('heading')).toHaveLength(1);
      expect(tile(title).getByText(/^Read /u).className).toBe('daily-freshness');
    }
    expect(container.querySelector('.daily-workout-glyph[data-kind="running"]')).toBeTruthy();
    const meter = await tile('Nutrition').findByRole('progressbar');
    expect(meter.getAttribute('aria-valuenow')).toBe('1200');
    expect(meter.getAttribute('aria-valuemax')).toBe('1700');
    expect(tile('Nutrition').getByText('Carbohydrate: 100 g.')).toBeTruthy();
    expect(tile('Nutrition').getByText('Fat: 30 g.')).toBeTruthy();
  });

  it('shows loading and empty states for every card without removing their section links', async () => {
    let finish!: () => void;
    const held = new Promise<void>(resolve => { finish = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      await held;
      return jsonResponse(dailyFixture(JSON.parse(String(init?.body)) as DailyQuery));
    }));
    render(view());
    for (const title of ['Workouts', 'Nutrition', 'Body', 'Sleep', 'Briefs']) {
      expect(tile(title).getByText(`Loading ${title.toLowerCase()} summary`)).toBeTruthy();
      expect(tile(title).getByRole('link', { name: title })).toBeTruthy();
    }
    await act(async () => { finish(); });
    for (const message of ['No workout in the last 30 days', 'No meals recorded in the last 7 days',
      'No measurements returned in the last 30 days', 'No sleep recorded in the last 7 days', 'No briefs returned']) {
      expect(await screen.findByText(message)).toBeTruthy();
    }
    expect(screen.getAllByText(/^Read /u)).toHaveLength(5);
  });

  it.each([
    ['Workouts', sources.workouts], ['Nutrition', sources.days], ['Body', sources.metrics],
    ['Sleep', sources.sleep], ['Briefs', sources.briefs],
  ] as const)('keeps %s failures isolated and offers a working Retry', async (title, source) => {
    const f = fixture({ failSource: source });
    render(view());
    expect(await tile(title).findByRole('alert')).toBeTruthy();
    fireEvent.click(tile(title).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(tile(title).queryByRole('alert')).toBeNull());
    await waitFor(() => expect(f.queries.filter(query => query.source === source)).toHaveLength(2));
    expect(tile(title).getByText(/^Read /u)).toBeTruthy();
  });

  it.each([
    ['Workouts', sources.workouts], ['Nutrition', sources.days], ['Body', sources.metrics],
    ['Sleep', sources.sleep], ['Briefs', sources.briefs],
  ] as const)('labels %s partial history without hiding its values', async (title, source) => {
    fixture({ partialSource: source });
    render(view());
    await waitFor(() => expect(tile(title).getByText(/^Read /u).textContent).toContain('partial'));
    expect(tile(title).queryByText(/Showing the first/u)).toBeNull();
    expect(tile(title).queryByRole('button', { name: 'Load more' })).toBeNull();
    expect(tile(title).getByRole('link', { name: title })).toBeTruthy();
  });

  it('keeps unknowns and nutrient lower bounds beside their values and labels the latest logged day', async () => {
    fixture({ rows: {
      ...summaryRows,
      [sources.workouts]: [{ ...latestWorkout, duration_seconds: null, start_at: null }],
      [sources.days]: [{ ...nutritionDay, meal_date: period.sevenDays.startDate, energy_kcal: null, protein_grams: 0,
        carbohydrates_grams: 12, fat_grams: null, unknown_nutrients: ['energy_kcal', 'fat_grams'],
        partial_nutrients: ['protein_grams', 'carbohydrates_grams'] }],
      [sources.metrics]: [{ metric_name: 'body_mass', metric_date: period.sevenDays.endDate, value: null, unit: 'kg' }],
      [sources.sleep]: [{ sleep_date: period.sevenDays.endDate, asleep_hours: null, total_sleep_hours: null }],
      [sources.briefs]: [{ id: 'synthetic-unknown', started_at: null, trigger: null }],
    } });
    render(view());
    expect(await tile('Workouts').findByText('Started Unknown')).toBeTruthy();
    expect(tile('Workouts').getByText(/minutes \(partial\)/u)).toBeTruthy();
    expect(tile('Workouts').getByText('1 workout has unknown duration.')).toBeTruthy();
    expect(tile('Nutrition').getByText('Energy: Unknown kcal')).toBeTruthy();
    expect(tile('Nutrition').getByText('Protein: 0 g (lower bound).')).toBeTruthy();
    expect(tile('Nutrition').getByText('Carbohydrate: 12 g (lower bound).')).toBeTruthy();
    expect(tile('Nutrition').getByText('Fat: Unknown g.')).toBeTruthy();
    expect(tile('Nutrition').getByText(`Latest day with meals: ${formatDate(period.sevenDays.startDate)}`)).toBeTruthy();
    expect(tile('Body').getByText('Unknown kg')).toBeTruthy();
    expect(tile('Body').getByText('No trend available')).toBeTruthy();
    expect(tile('Sleep').getByText('Unknown')).toBeTruthy();
  });

  it('leads the Sleep headline with total sleep and falls back to asleep only without a total', async () => {
    fixture({ rows: { ...summaryRows, [sources.sleep]: [
      { sleep_date: period.sevenDays.endDate, total_sleep_hours: 7.5, asleep_hours: 0 },
    ] } });
    const rendered = render(view());
    expect(await tile('Sleep').findByText('7.5 h total sleep')).toBeTruthy();
    expect(tile('Sleep').queryByText(/0 h asleep/u)).toBeNull();
    expect(tile('Sleep').queryByText(/^Asleep:/u)).toBeNull();
    rendered.unmount();

    fixture({ rows: { ...summaryRows, [sources.sleep]: [
      { sleep_date: period.sevenDays.endDate, total_sleep_hours: null, asleep_hours: 6.5 },
    ] } });
    render(view());
    expect(await tile('Sleep').findByText('6.5 h asleep')).toBeTruthy();
  });

  it('reads a week without workouts as zero minutes, not unknown', async () => {
    const older = { id: 'synthetic-workout-old', workout_date: period.thirtyDays.startDate, workout_type: 'running', duration_seconds: 600 };
    fixture({ rows: { ...summaryRows, [sources.workouts]: [older] } });
    render(view());
    expect(await screen.findByText('This week: 0 workouts · 0 minutes')).toBeTruthy();
    expect(screen.queryByText(/Unknown minutes/u)).toBeNull();
  });

  it('labels raw snake_case body metric keys in words', async () => {
    fixture({ rows: { ...summaryRows, [sources.metrics]: [
      { metric_name: 'active_energy', metric_date: period.sevenDays.endDate, value: 500, unit: 'kcal' },
    ] } });
    render(view());
    expect(await tile('Body').findByText(/^Active energy ·/u)).toBeTruthy();
    expect(tile('Body').queryByText(/active_energy/u)).toBeNull();
  });

  it('keeps one tile structure from loading to loaded so the cards keep their height', async () => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      await held;
      if (String(url).endsWith('/daily/nutrition-targets')) return jsonResponse(targetReply);
      const query = JSON.parse(String(init?.body)) as DailyQuery;
      return jsonResponse(dailyFixture(query, summaryRows[query.source] ?? []));
    }));
    const { container } = render(view());
    const structure = () => [...container.querySelectorAll('article')].map(article => ({
      tile: article.getAttribute('data-tile'),
      children: [...article.children].map(child => `${child.tagName}.${child.className}`),
    }));
    const loading = structure();
    expect(loading.map(entry => entry.tile)).toEqual(['workouts', 'nutrition', 'body', 'sleep', 'briefs']);
    for (const entry of loading) expect(entry.children).toEqual(['H3.', 'DIV.daily-tile-body', 'DIV.daily-tile-status']);
    await act(async () => { release(); });
    await screen.findByText('This week: 2 workouts · 40 minutes');
    await waitFor(() => expect(screen.getAllByText(/^Read /u)).toHaveLength(5));
    expect(structure()).toEqual(loading);
  });

  it('keeps a capped tile at its loading structure and says partial in its freshness line', async () => {
    fixture({ partialWorkouts: true });
    const { container } = render(view([sources.workouts]));
    const article = () => container.querySelector('article')!;
    const loading = [...article().children].map(child => `${child.tagName}.${child.className}`);
    expect(loading).toEqual(['H3.', 'DIV.daily-tile-body', 'DIV.daily-tile-status']);
    await waitFor(() => expect(tile('Workouts').getByText(/^Read /u).textContent).toContain('20 records, partial'));
    expect([...article().children].map(child => `${child.tagName}.${child.className}`)).toEqual(loading);
    expect(tile('Workouts').queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('still offers Load more beside the error when a page fails part-way through auto-load', async () => {
    const stub = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const query = JSON.parse(String(init?.body)) as DailyQuery;
      if ('cursor' in query) return jsonResponse({ error: 'synthetic' }, 503);
      return jsonResponse(dailyFixture(query, [latestWorkout], { date: period.sevenDays.endDate, key: 'synthetic-next' }));
    });
    vi.stubGlobal('fetch', stub);
    render(view([sources.workouts]));
    expect(await tile('Workouts').findByRole('alert')).toBeTruthy();
    expect(tile('Workouts').getByText(/Showing the first 1\./u)).toBeTruthy();
    expect(tile('Workouts').getByRole('button', { name: 'Load more' })).toBeTruthy();
  });

  it('renders a multi-page auto-load once, with no partial row or Load more while it runs', async () => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const stub = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const query = JSON.parse(String(init?.body)) as DailyQuery;
      if ('cursor' in query) {
        await held;
        return jsonResponse(dailyFixture(query, [earlierWorkout]));
      }
      return jsonResponse(dailyFixture(query, [latestWorkout], { date: period.sevenDays.endDate, key: 'synthetic-next' }));
    });
    vi.stubGlobal('fetch', stub);
    render(view([sources.workouts]));
    const workouts = tile('Workouts');
    await waitFor(() => expect(stub).toHaveBeenCalledTimes(2));
    expect(workouts.getByText('Loading workouts summary')).toBeTruthy();
    expect(workouts.queryByText('Running')).toBeNull();
    expect(workouts.queryByRole('button', { name: 'Load more' })).toBeNull();
    expect(workouts.queryByText(/Showing the first/u)).toBeNull();
    await act(async () => { release(); });
    expect(await screen.findByText('This week: 2 workouts · 40 minutes')).toBeTruthy();
    expect(workouts.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('uses singular wording for one workout and one minute this week', async () => {
    fixture({ rows: { ...summaryRows, [sources.workouts]: [{ ...latestWorkout, duration_seconds: 60 }] } });
    render(view());
    expect(await screen.findByText('This week: 1 workout · 1 minute')).toBeTruthy();
    expect(screen.queryByText(/unknown duration/u)).toBeNull();
  });

  it('retains populated and empty cards while refreshing instead of returning to skeletons', async () => {
    const f = fixture({ rows: { ...summaryRows, [sources.sleep]: [] } });
    const rendered = render(view());
    await screen.findByText('This week: 2 workouts · 40 minutes');
    await screen.findByText('No sleep recorded in the last 7 days');
    let finish!: () => void;
    const held = new Promise<void>(resolve => { finish = resolve; });
    f.fetch.mockImplementation(async (_url: string | URL, init?: RequestInit) => {
      await held;
      return jsonResponse(dailyFixture(JSON.parse(String(init?.body)) as DailyQuery));
    });
    const articles = [...rendered.container.querySelectorAll('article')];
    rendered.rerender(view(available, 1));
    await waitFor(() => expect(screen.getAllByText('Refreshing…')).toHaveLength(5));
    expect(screen.getByText('This week: 2 workouts · 40 minutes')).toBeTruthy();
    expect(screen.getByText('No sleep recorded in the last 7 days')).toBeTruthy();
    expect(screen.queryByText('Loading workouts summary')).toBeNull();
    expect([...rendered.container.querySelectorAll('article')]).toEqual(articles);
    await act(async () => { finish(); });
  });
});
