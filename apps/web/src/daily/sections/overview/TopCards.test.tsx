import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { dailyQuerySources as sources, isDailyQuery, type DailyJson, type DailySourceId } from '@jarvis/contracts';
import { dailyFixture, jsonResponse } from '../../test-support';
import { TopCards } from './TopCards';

type Row = Record<string, DailyJson>;
const token = async () => 'synthetic-fixture';
const everything = [sources.workouts, sources.days, sources.meals, sources.metrics, sources.metricCatalog, sources.sleep];
// 2026-10-20 is a Tuesday and still summer time in Copenhagen.
const now = '2026-10-20T10:00:00Z';
const today = '2026-10-20';

const rows: Record<string, Row[]> = {
  [sources.workouts]: [
    { id: 'w1', workout_date: '2026-10-19', start_at: '2026-10-19T07:00:00Z', workout_type: 'traditionalstrengthtraining', duration_seconds: 1800, active_energy_value: 200, active_energy_unit: 'kcal' },
    { id: 'w2', workout_date: today, start_at: `${today}T06:00:00Z`, workout_type: 'running', duration_seconds: 1200, active_energy_value: 150, active_energy_unit: 'kcal' },
    { id: 'w3', workout_date: today, start_at: `${today}T08:00:00Z`, workout_type: 'yoga', duration_seconds: 600, active_energy_value: 50, active_energy_unit: 'kcal' },
  ],
  [sources.days]: [{
    meal_date: today, meal_count: 2, energy_kcal: 1200, protein_grams: 80, carbohydrates_grams: 100,
    fat_grams: 30, fiber_grams: 10, unknown_nutrients: [], partial_nutrients: [], latest_updated_at: '2026-10-20T07:00:00Z',
  }],
  [sources.meals]: [
    { id: 'm2', meal_name: 'Synthetic dinner', occurred_at: `${today}T16:00:00Z`, energy_kcal: 700, protein_grams: 50, deleted_at: null },
    { id: 'm1', meal_name: 'Synthetic breakfast', occurred_at: `${today}T06:00:00Z`, energy_kcal: 500, protein_grams: 30, deleted_at: null },
    { id: 'm3', meal_name: 'Synthetic removed meal', occurred_at: `${today}T09:00:00Z`, energy_kcal: 100, protein_grams: 5, deleted_at: `${today}T09:30:00Z` },
  ],
  [`${sources.metrics}:step_count`]: [{ metric_name: 'step_count', metric_date: today, value: 6500 }],
  [`${sources.metrics}:body_mass`]: [
    { metric_name: 'body_mass', metric_date: '2026-10-10', value: 81.2, unit: 'kg' },
    { metric_name: 'body_mass', metric_date: today, value: 80.4, unit: 'kg' },
  ],
  // The client rejects a catalogue that is not in name order or lacks a retained span.
  [sources.metricCatalog]: [
    { metric_name: 'body_mass', units: ['kg'], first_date: '2026-10-10', last_date: today, day_count: 2, latest_updated_at: '2026-10-20T07:00:00Z' },
    { metric_name: 'step_count', units: ['count'], first_date: today, last_date: today, day_count: 1, latest_updated_at: '2026-10-20T07:00:00Z' },
  ],
  [sources.sleep]: [{ sleep_date: today, total_sleep_hours: 7.8, asleep_hours: 0 }],
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

type Asked = { source: string; metric?: string; startDate: string; endDate: string };
let asked: Asked[] = [];

function stub(data: Record<string, Row[]> = rows, targets: unknown = targetReply, failing: readonly string[] = []) {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith('/daily/nutrition-targets')) return jsonResponse(targets);
    const query: unknown = JSON.parse(String(init?.body));
    if (!isDailyQuery(query)) throw new Error('Invalid synthetic query');
    const { startDate, endDate, metric } = query as { startDate: string; endDate: string; metric?: string };
    asked.push({ source: query.source, ...(metric ? { metric } : {}), startDate, endDate });
    if (failing.includes(query.source)) return jsonResponse({ error: 'synthetic failure' }, 500);
    return jsonResponse(dailyFixture(query, data[metric ? `${query.source}:${metric}` : query.source] ?? []));
  }));
}

function view(ids: readonly DailySourceId[] = everything) {
  return <MemoryRouter><TopCards backendUrl="http://localhost:3999" getAccessToken={token} refreshVersion={0} available={ids} /></MemoryRouter>;
}

function article(title: string) {
  const found = screen.getByRole('heading', { level: 3, name: title }).closest('article');
  if (!found) throw new Error(`Missing card: ${title}`);
  return found;
}
const card = (title: string) => within(article(title));
const tile = (title: string, label: string) => card(title).getByRole('group', { name: label });

async function settled() {
  await waitFor(() => expect(tile('Training', 'Protein').textContent).toContain('80 g'));
}

beforeEach(() => {
  asked = [];
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(now));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Overview cards', () => {
  it('shows the three cards with Today selected, links Training and Body to their sections, and lets Health open its panel', async () => {
    stub();
    render(view());
    await settled();
    expect(screen.getByRole('button', { name: 'Today' }).getAttribute('aria-pressed')).toBe('true');
    for (const label of ['Yesterday', '1 week', '2 weeks', '1 month']) {
      expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('false');
    }
    expect(screen.getByRole('link', { name: 'Training' }).getAttribute('href')).toMatch(/\?section=workouts$/u);
    expect(screen.getByRole('link', { name: 'Body' }).getAttribute('href')).toMatch(/\?section=body-sleep$/u);
    expect(screen.queryByRole('link', { name: 'Health' })).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Health' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe('health-panel');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('counts sessions in rings and steps in the activity ring, and says no target is set', async () => {
    stub();
    render(view());
    const training = card('Training');
    await waitFor(() => expect(training.getByRole('img', { name: 'Gym: 1 session, week to date, no target set' })).toBeTruthy());
    expect(training.getByRole('img', { name: 'Run: 1 session, week to date, no target set' })).toBeTruthy();
    expect(training.getByRole('img', { name: 'Activity: 6,500 steps, no target set' })).toBeTruthy();
    expect(training.getAllByText('No target set')).toHaveLength(3);
  });

  it('shows protein against its target and calories left against the baseline', async () => {
    stub();
    render(view());
    await settled();
    await waitFor(() => expect(tile('Training', 'Protein').textContent).toContain('of 100 g'));
    await waitFor(() => expect(within(tile('Training', 'Calories left')).getByText('500 kcal left')).toBeTruthy());
    expect(tile('Training', 'Calories left').textContent).toContain('left');
  });

  it('turns calories left into an upper bound, and over into a lower bound, when eaten is a lower bound', async () => {
    const day = rows[sources.days]![0]!;
    stub({ ...rows, [sources.days]: [{ ...day, energy_kcal: 1200, partial_nutrients: ['energy_kcal'] }] });
    const first = render(view());
    await waitFor(() => expect(within(tile('Training', 'Calories left')).getByText('At most 500 kcal left')).toBeTruthy());
    expect(within(tile('Training', 'Calories left')).getByText('≤ 500 kcal')).toBeTruthy();
    first.unmount();
    stub({ ...rows, [sources.days]: [{ ...day, energy_kcal: 2000, partial_nutrients: ['energy_kcal'] }] });
    render(view());
    await waitFor(() => expect(within(tile('Training', 'Calories left')).getByText('At least 300 kcal over')).toBeTruthy());
    expect(within(tile('Training', 'Calories left')).getByText('≥ 300 kcal')).toBeTruthy();
  });

  it('lists the meals of the day in time order without removed meals', async () => {
    stub();
    render(view());
    const meals = await waitFor(() => {
      const items = card('Training').getAllByRole('listitem');
      expect(items).toHaveLength(2);
      return items;
    });
    expect(meals[0]!.textContent).toContain('Synthetic breakfast');
    expect(meals[1]!.textContent).toContain('Synthetic dinner');
    expect(card('Training').getByRole('region', { name: 'Meals' }).getAttribute('tabindex')).toBe('0');
  });

  it('says so when nothing was logged', async () => {
    stub({ ...rows, [sources.days]: [], [sources.meals]: [] });
    render(view());
    await waitFor(() => expect(card('Training').getByText('No meals logged')).toBeTruthy());
    expect(tile('Training', 'Protein').textContent).toContain('Not recorded');
    expect(tile('Training', 'Calories left').textContent).toContain('Not recorded');
    const dash = tile('Training', 'Protein').querySelector('.daily-top-tile-none');
    expect(dash?.textContent).toBe('—');
    expect(dash?.getAttribute('aria-hidden')).toBe('true');
    expect(tile('Training', 'Protein').querySelector('.visually-hidden')?.textContent).toBe('Not recorded');
  });

  it('points a missing nutrition target at the settings', async () => {
    stub(rows, { ...targetReply, targets: { restingKcal: null, deficitKcal: null, proteinGrams: null } });
    render(view());
    await waitFor(() => expect(within(tile('Training', 'Protein')).getByRole('link', { name: 'No target set' }).getAttribute('href'))
      .toBe('/settings#nutrition-targets'));
    expect(within(tile('Training', 'Calories left')).getByText('1,200 kcal eaten')).toBeTruthy();
  });

  it('reads sleep from the total and draws protein across the day against the target', async () => {
    stub();
    render(view());
    await waitFor(() => expect(tile('Health', 'Sleep').textContent).toContain('7.8 h'));
    expect(tile('Health', 'Sleep').textContent).not.toContain('0 h');
    const chart = await waitFor(() => card('Health').getByRole('img', { name: /^Protein across the day/u }));
    expect(chart.getAttribute('aria-label')).toContain('target 100 g');
  });

  it('shows body totals, trends from the catalogue, and not recorded for measurements it does not serve', async () => {
    stub();
    render(view());
    await waitFor(() => expect(tile('Body', 'Sessions').textContent).toContain('2'));
    expect(tile('Body', 'Calories').textContent).toContain('200 kcal');
    expect(tile('Body', 'Duration').textContent).toMatch(/30\s*min/u);
    await waitFor(() => expect(tile('Body', 'Weight').textContent).toContain('80.4 kg'));
    for (const label of ['Fat mass', 'Fat %', 'Lean mass']) expect(tile('Body', label).textContent).toContain('Not recorded');
  });

  it('shows zero minutes, not unknown, for an empty window', async () => {
    stub({ ...rows, [sources.workouts]: [] });
    render(view());
    await waitFor(() => expect(tile('Body', 'Duration').textContent).toContain('0 min'));
    expect(tile('Body', 'Sessions').textContent).toContain('0');
    expect(card('Body').queryByText(/Unknown/u)).toBeNull();
  });

  it('switches the period, asks for that range and drops the single-day meal strip', async () => {
    stub();
    render(view());
    await settled();
    fireEvent.click(screen.getByRole('button', { name: '1 week' }));
    expect(screen.getByRole('button', { name: '1 week' }).getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(asked.some(query => query.source === sources.days && query.startDate === '2026-10-14' && query.endDate === today)).toBe(true));
    expect(card('Training').queryByRole('region', { name: 'Meals' })).toBeNull();
    await waitFor(() => expect(tile('Training', 'Protein').textContent).toContain('average per day'));
    expect(card('Health').getByRole('img', { name: /^Protein per day/u })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Yesterday' }));
    await waitFor(() => expect(asked.some(query => query.source === sources.meals && query.startDate === '2026-10-19' && query.endDate === '2026-10-19')).toBe(true));
  });

  it('asks for the new date, not the old one, after Copenhagen midnight passes while mounted', async () => {
    stub();
    render(view());
    await waitFor(() => expect(asked.some(query => query.source === sources.meals && query.endDate === today)).toBe(true));
    vi.setSystemTime(new Date('2026-10-21T10:00:00Z'));
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => {
      for (const source of [sources.days, sources.meals]) {
        expect(asked.some(query => query.source === source && query.startDate === '2026-10-21' && query.endDate === '2026-10-21')).toBe(true);
      }
    });
  });

  it('keeps one card structure from loading to loaded', async () => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      await held;
      if (String(url).endsWith('/daily/nutrition-targets')) return jsonResponse(targetReply);
      const query: unknown = JSON.parse(String(init?.body));
      if (!isDailyQuery(query)) throw new Error('Invalid synthetic query');
      const { metric } = query as { metric?: string };
      return jsonResponse(dailyFixture(query, rows[metric ? `${query.source}:${metric}` : query.source] ?? []));
    }));
    const { container } = render(view());
    const structure = () => [...container.querySelectorAll('article')].map(item => ({
      card: item.getAttribute('data-card'),
      layout: [...item.children].filter(child => !child.classList.contains('visually-hidden')).map(child => child.tagName),
      tiles: item.querySelectorAll('.daily-top-tile').length,
      rings: item.querySelectorAll('.daily-ring').length,
      charts: item.querySelectorAll('.daily-minichart').length,
      strips: item.querySelectorAll('.daily-top-strip').length,
      captions: item.querySelectorAll('.daily-ring-caption').length,
      notes: item.querySelectorAll('.daily-top-tile-note').length,
    }));
    const loading = structure();
    expect(loading.map(entry => entry.card)).toEqual(['training', 'health', 'body']);
    await act(async () => { release(); });
    await settled();
    await waitFor(() => expect(tile('Body', 'Weight').textContent).toContain('80.4 kg'));
    expect(structure()).toEqual(loading);
  });

  it('marks every source as unavailable instead of inventing values when nothing is served', () => {
    stub();
    render(view([]));
    expect(card('Training').getByText('Meals are not served.')).toBeTruthy();
    expect(card('Health').getByText('Sleep is not served.')).toBeTruthy();
    expect(card('Body').getAllByText('Workouts are not served.').length).toBeGreaterThan(0);
    expect(asked).toEqual([]);
  });

  it('offers a retry when a read fails and reads again', async () => {
    stub(rows, targetReply, [sources.workouts]);
    render(view());
    const retry = await waitFor(() => card('Training').getByRole('button', { name: 'Retry' }));
    expect(card('Training').getAllByText('Could not load').length).toBeGreaterThan(0);
    const before = asked.filter(query => query.source === sources.workouts).length;
    fireEvent.click(retry);
    await waitFor(() => expect(asked.filter(query => query.source === sources.workouts).length).toBeGreaterThan(before));
  });

  it('has a dot per card that marks the chosen card', async () => {
    stub();
    render(view());
    await settled();
    const dots = within(screen.getByRole('group', { name: 'Choose a card' })).getAllByRole('button');
    expect(dots.map(dot => dot.getAttribute('aria-label'))).toEqual(['Show Training', 'Show Health', 'Show Body']);
    fireEvent.click(dots[2]!);
    expect(dots[2]!.getAttribute('aria-current')).toBe('true');
    expect(dots[0]!.getAttribute('aria-current')).toBeNull();
  });

  it('never says Daily in visible text or accessible names', async () => {
    stub();
    const { container } = render(view());
    await settled();
    const labelled = [...container.querySelectorAll('[aria-label], [title], [alt]')]
      .flatMap(element => [element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('alt')]);
    expect([container.textContent, ...labelled].filter(value => value && /daily/iu.test(value))).toEqual([]);
  });
});
