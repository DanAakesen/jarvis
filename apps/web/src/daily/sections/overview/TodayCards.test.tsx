import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { dailyQuerySources as sources, isDailyQuery, type DailyJson, type DailySourceId } from '@jarvis/contracts';
import { dailyFixture, jsonResponse } from '../../test-support';
import { overviewPeriods } from './summary';
import { TodayCards } from './TodayCards';

const token = async () => 'synthetic-fixture';
const available = [sources.workouts, sources.days, sources.meals];
const today = overviewPeriods().sevenDays.endDate;
const rows: Partial<Record<DailySourceId, Record<string, DailyJson>[]>> = {
  [sources.workouts]: [
    { id: 'w1', workout_date: today, start_at: `${today}T07:00:00Z`, workout_type: 'traditionalstrengthtraining' },
    { id: 'w2', workout_date: today, start_at: `${today}T09:00:00Z`, workout_type: 'running' },
    { id: 'w3', workout_date: today, start_at: `${today}T10:00:00Z`, workout_type: 'running' },
    { id: 'w4', workout_date: today, start_at: `${today}T11:00:00Z`, workout_type: 'yoga' },
  ],
  [sources.days]: [{
    meal_date: today, meal_count: 2, energy_kcal: 1200, protein_grams: 80, carbohydrates_grams: 100,
    fat_grams: 30, fiber_grams: 10, unknown_nutrients: [], partial_nutrients: [], latest_updated_at: '2026-10-18T07:00:00Z',
  }],
  [sources.meals]: [
    { id: 'm2', meal_name: 'Synthetic dinner', occurred_at: `${today}T18:00:00Z`, energy_kcal: 700, deleted_at: null },
    { id: 'm1', meal_name: 'Synthetic breakfast', occurred_at: `${today}T07:00:00Z`, energy_kcal: 500, deleted_at: null },
    { id: 'm3', meal_name: 'Synthetic removed meal', occurred_at: `${today}T12:00:00Z`, energy_kcal: 100, deleted_at: '2026-10-18T12:30:00Z' },
  ],
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

function stub(data = rows) {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith('/daily/nutrition-targets')) return jsonResponse(targetReply);
    const query: unknown = JSON.parse(String(init?.body));
    if (!isDailyQuery(query)) throw new Error('Invalid synthetic query');
    return jsonResponse(dailyFixture(query, data[query.source] ?? []));
  }));
}

function view(ids: readonly DailySourceId[] = available) {
  return <MemoryRouter><TodayCards backendUrl="http://localhost:3999" getAccessToken={token} refreshVersion={0} available={ids} /></MemoryRouter>;
}

function card(title: string) {
  const article = screen.getByRole('heading', { level: 3, name: title }).closest('article');
  if (!article) throw new Error(`Missing card: ${title}`);
  return within(article);
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Today cards', () => {
  it('shows session counts in rings and says the weekly targets are not served', async () => {
    stub();
    render(view());
    await waitFor(() => expect(card('Training this week').getByRole('img', { name: 'Running: 2 sessions this week, no target' })).toBeTruthy());
    const training = card('Training this week');
    expect(training.getByRole('img', { name: 'Strength: 1 session this week, no target' })).toBeTruthy();
    expect(training.getByRole('img', { name: 'Other: 1 session this week, no target' })).toBeTruthy();
    expect(training.getByText(/Weekly session targets are not served/u)).toBeTruthy();
  });

  it('shows protein against its target and calories left against the baseline', async () => {
    stub();
    render(view());
    await waitFor(() => expect(card('Protein today').getByRole('img', { name: 'Protein: 80 g of 100 g' })).toBeTruthy());
    await waitFor(() => expect(card('Calories left today').getByRole('img', { name: 'Calories: 500 kcal left of 1,700 kcal' })).toBeTruthy());
    expect(card('Calories left today').getByText(/before activity/u)).toBeTruthy();
  });

  it('lists today\'s meals in time order without removed meals', async () => {
    stub();
    render(view());
    const meals = await waitFor(() => {
      const items = card('Meals today').getAllByRole('listitem');
      expect(items).toHaveLength(2);
      return items;
    });
    expect(meals[0]!.textContent).toContain('Synthetic breakfast');
    expect(meals[1]!.textContent).toContain('Synthetic dinner');
  });

  it('says so when nothing was logged today', async () => {
    stub({ ...rows, [sources.days]: [], [sources.meals]: [] });
    render(view());
    await waitFor(() => expect(card('Meals today').getByText('No meals logged today')).toBeTruthy());
    expect(card('Protein today').getByText('No meals logged today')).toBeTruthy();
  });

  it('marks every card unavailable when its source is not served', () => {
    stub();
    render(view([]));
    for (const title of ['Training this week', 'Protein today', 'Calories left today', 'Meals today']) {
      expect(card(title).getByRole('status').textContent).toContain('Unavailable.');
    }
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
