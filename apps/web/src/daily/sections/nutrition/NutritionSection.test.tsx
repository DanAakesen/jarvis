import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dailyQuerySources as ids, type DailyQuery, type DailySourceId } from '@jarvis/contracts';
import { dailyFixture, jsonResponse } from '../../test-support';
import { discoverDailySections } from '../discovery';
import type { DailySectionProps } from '../types';
import NutritionSection from './NutritionSection';
import { section } from './index';
import { readableJson, type Row } from './totals';

const token = async () => 'synthetic-token';
const props: DailySectionProps = {
  backendUrl: 'https://synthetic.example', getAccessToken: token,
  sources: [ids.meals], period: { startDate: '2026-10-12', endDate: '2026-10-18' },
  onPeriodChange: () => {}, refreshVersion: 0,
};
const syntheticMeal: Row = {
  id: 'synthetic-meal-9001', meal_name: 'Synthetic meal 9001', meal_type: 'breakfast',
  meal_date: '2026-10-18', occurred_at: '2026-10-18T09:00:00Z', energy_kcal: 9001, protein_grams: null,
  carbohydrates_grams: 9002, fat_grams: 9003, fiber_grams: null,
  deleted_at: null, components_json: [{ name: 'Synthetic component 9001' }],
  nutrient_provenance_json: { source: 'synthetic-label-9001' },
};
let queries: DailyQuery[];
let meals: Row[];
let rows: Partial<Record<DailySourceId, Row[]>>;
let targets: { restingKcal: number | null; deficitKcal: number | null; proteinGrams: number | null };
let pending: (() => Promise<Response>) | undefined;
let mealMore: boolean;
function Location() { return <output aria-label="URL">{useLocation().search}</output>; }
function Wrapper({ version = 0, sources = props.sources, entry = '/daily?section=nutrition' }: {
  version?: number; sources?: readonly DailySourceId[]; entry?: string;
}) {
  return <MemoryRouter initialEntries={[entry]}><NutritionSection {...props} sources={sources} refreshVersion={version} /><Location /></MemoryRouter>;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-18T10:00:00Z'));
  queries = []; meals = [syntheticMeal]; rows = {}; pending = undefined; mealMore = false;
  targets = { restingKcal: null, deficitKcal: null, proteinGrams: null };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/daily/nutrition-targets')) return jsonResponse({
      targets, updatedAt: null,
      bounds: Object.fromEntries(Object.keys(targets).map(key => [key, { label: `Synthetic ${key}`, unit: key === 'proteinGrams' ? 'g' : 'kcal', min: 0, max: 99999 }])),
    });
    const query = JSON.parse(String(init?.body)) as DailyQuery;
    queries.push(query);
    if (query.source === ids.meals && pending) return pending();
    const items = query.source === ids.meals
      ? meals.filter(row => row.meal_date === ('startDate' in query ? query.startDate : ''))
      : rows[query.source] ?? [];
    return jsonResponse(dailyFixture(query, items, query.source === ids.meals && mealMore ? { createdAt: '2026-10-18T09:00:00Z', id: 'synthetic-cursor-9001' } : null));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe('Nutrition section', () => {
  it('discovers automatically only with meals, and requires no optional collections', () => {
    expect(discoverDailySections({ './sections/nutrition/index.tsx': { section } }, []).map(item => item.id)).toEqual([]);
    expect(discoverDailySections({ './sections/nutrition/index.tsx': { section } }, [ids.meals]).map(item => item.id)).toEqual(['nutrition']);
    expect(section.usesPeriod).toBe(true);
  });
  it('shows four null-aware meters, collapsed unknown nutrients and safe provenance', async () => {
    render(<Wrapper entry="/daily?section=nutrition&nutritionDate=2026-10-18" />);
    await screen.findByText(/Synthetic meal 9001/u);
    const meters = document.querySelector('.nutrition-meters')!;
    expect(meters.querySelectorAll('.daily-meter')).toHaveLength(4);
    expect(within(meters as HTMLElement).getByText('Not recorded')).toBeTruthy();
    expect(within(meters as HTMLElement).getAllByText('Target not set')).toHaveLength(4);
    const unknown = screen.getByText('Not recorded', { selector: 'summary' }).closest('details')!;
    expect(unknown.open).toBe(false);
    expect(within(unknown).getByText('Fiber: Not recorded')).toBeTruthy();
    expect(document.querySelector('.daily-freshness')?.textContent).toContain('1 meal');
    expect(screen.getByRole('link', { name: 'Set them in Settings' }).getAttribute('href')).toBe('/settings#nutrition-targets');
    expect(screen.queryByRole('progressbar')).toBeNull();
    const provenance = screen.getByText('Nutrient provenance').closest('details')!;
    expect(provenance.open).toBe(false);
    fireEvent.click(within(provenance).getByText('Nutrient provenance'));
    expect(provenance.textContent).toContain('synthetic-label-9001');
    expect(document.querySelectorAll('.nutrition-other-nutrients .daily-stat-tile')).toHaveLength(0);
    expect(queries[0]).toMatchObject({ source: ids.meals, limit: 100, startDate: '2026-10-18', endDate: '2026-10-18' });
  });
  it('steps dates, returns Today and never enables next beyond today', async () => {
    render(<Wrapper entry="/daily?nutritionDate=2026-10-18" />);
    await screen.findByText(/Synthetic meal 9001/u);
    expect((screen.getByRole('button', { name: /^Next day/u }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Previous day/u }));
    expect((screen.getByLabelText('Meal date') as HTMLInputElement).value).toBe('2026-10-17');
    expect(screen.getByLabelText('URL').textContent).toContain('nutritionDate=2026-10-17');
    fireEvent.click(screen.getByRole('button', { name: /^Today/u }));
    await screen.findByText(/Synthetic meal 9001/u);
    fireEvent.change(screen.getByLabelText('Meal date'), { target: { value: '2099-10-18' } });
    expect((screen.getByLabelText('Meal date') as HTMLInputElement).value).toBe('2026-10-18');
  });
  it('shows empty-day recovery and known previous/next logged dates', async () => {
    meals = [];
    rows[ids.days] = ['2026-10-16', '2026-10-18'].map(date => ({
      meal_date: date, meal_count: 9001, energy_kcal: 9001, protein_grams: null, carbohydrates_grams: null,
      fat_grams: null, fiber_grams: null, unknown_nutrients: ['protein_grams', 'carbohydrates_grams', 'fat_grams', 'fiber_grams'],
      partial_nutrients: [], latest_updated_at: '2026-10-18T09:00:00Z',
    }));
    render(<Wrapper sources={[ids.meals, ids.days]} entry="/daily?nutritionDate=2026-10-17" />);
    await screen.findByText('No meals recorded.');
    expect(screen.getByRole('link', { name: 'Open Health upload in Settings' }).getAttribute('href')).toBe('/settings#health-upload');
    await screen.findByRole('button', { name: 'Previous logged day: 2026-10-16' });
    fireEvent.click(screen.getByRole('button', { name: 'Next logged day: 2026-10-18' }));
    expect((screen.getByLabelText('Meal date') as HTMLInputElement).value).toBe('2026-10-18');
  });
  it('gates trend and each library source independently; tabs use roving focus and URL', async () => {
    const { unmount } = render(<Wrapper />);
    expect(screen.queryByRole('tab', { name: 'Trend' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Library' })).toBeNull();
    unmount();
    render(<Wrapper sources={[ids.meals, ids.days, ids.favorites]} />);
    const day = screen.getByRole('tab', { name: 'Day' });
    fireEvent.keyDown(day, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Trend' })).toBe(document.activeElement);
    expect(screen.getByLabelText('URL').textContent).toContain('nutritionView=trend');
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Library' })).toBe(document.activeElement);
    await screen.findByRole('heading', { name: 'Favourites' });
    expect(screen.queryByRole('heading', { name: 'Meal plans' })).toBeNull();
    await waitFor(() => expect(queries.every(query => query.source !== ids.plans)).toBe(true));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Day' })).toBe(document.activeElement);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Library' })).toBe(document.activeElement);
  });
  it.each(['trend', 'library'])('falls back to Day for unavailable URL view %s', async view => {
    render(<Wrapper entry={`/daily?nutritionView=${view}&nutritionDate=2026-10-18`} />);
    expect(screen.getByRole('tab', { name: 'Day' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('tab', { name: 'Trend' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Library' })).toBeNull();
    await screen.findByText(/Synthetic meal 9001/u);
  });
  it('filters loaded favourites by alias and shows plans with unknown totals and items', async () => {
    rows[ids.favorites] = [{ ...syntheticMeal, favorite_name: 'Synthetic favourite 9001', aliases_json: ['Synthetic alias 9002'] }];
    rows[ids.plans] = [{ id: 'synthetic-plan-9001', plan_name: 'Synthetic plan 9001', items_json: [{ favoriteId: 'synthetic-meal-9001', servings: 9001 }], energy_kcal: null }];
    render(<Wrapper sources={[ids.meals, ids.favorites, ids.plans]} entry="/daily?nutritionView=library" />);
    await screen.findByText('Synthetic favourite 9001');
    await screen.findByText('Synthetic plan 9001');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Synthetic alias 9002' } });
    expect(screen.getByText('Synthetic favourite 9001')).not.toBeNull();
    expect(screen.queryByText('Synthetic plan 9001')).toBeNull();
    expect(queries.some(query => query.source === ids.meals)).toBe(false);
  });
  it('preserves opened detail, selected date, filter and content while refreshing', async () => {
    const { rerender } = render(<Wrapper entry="/daily?nutritionDate=2026-10-18" />);
    await screen.findByText(/Synthetic meal 9001/u);
    const meal = screen.getByText('Synthetic meal 9001', { exact: false }).closest('details')!;
    fireEvent.click(meal.querySelector('summary')!);
    expect(meal.open).toBe(true);
    let resolve!: (value: Response) => void;
    pending = () => new Promise<Response>(done => { resolve = done; });
    rerender(<Wrapper version={1} entry="/daily?nutritionDate=2026-10-18" />);
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    expect(meal.open).toBe(true);
    expect(screen.getByText('Synthetic meal 9001', { exact: false })).not.toBeNull();
    expect((screen.getByLabelText('Meal date') as HTMLInputElement).value).toBe('2026-10-18');
    await act(async () => { resolve(jsonResponse(dailyFixture(queries.at(-1)!, [syntheticMeal]))); });
    expect(meal.open).toBe(true);
  });
  it('displays partial page and deleted meals without counting tombstones', async () => {
    meals = [syntheticMeal, { ...syntheticMeal, id: 'synthetic-deleted-9001', meal_name: 'Synthetic deleted 9001', deleted_at: '2026-10-18T09:00:00Z' }];
    mealMore = true;
    render(<Wrapper entry="/daily?nutritionDate=2026-10-18" />);
    const deletedGroup = (await screen.findByText(/Deleted meals \(1/u)).closest('details')!;
    expect(deletedGroup.open).toBe(false);
    expect(document.querySelector('.nutrition-meters .daily-meter-values')?.textContent).toContain('9,001 kcal');
    expect(document.querySelector('.daily-freshness')?.textContent).toContain('1 meal, partial');
    expect(document.querySelector('.nutrition-meters')?.textContent).toContain('lower bound');
  });
  it.each([
    [9001, 9002, 9003], [9001, null, null], [null, 9002, 9003], [null, null, null],
  ])('uses only explicitly set resting %s deficit %s protein %s targets', async (resting, deficit, protein) => {
    targets = { restingKcal: resting, deficitKcal: deficit, proteinGrams: protein };
    meals = [{ ...syntheticMeal, protein_grams: 9004 }];
    render(<Wrapper entry="/daily?nutritionDate=2026-10-18" />);
    await screen.findByText(/Synthetic meal 9001/u);
    await waitFor(() => expect(screen.queryByText('Loading nutrition targets')).toBeNull());
    const proteinMeter = screen.getByText('Protein', { selector: '.daily-meter-label' }).closest('.daily-meter')! as HTMLElement;
    expect(within(proteinMeter).queryByRole('progressbar') !== null).toBe(protein !== null);
    if (protein !== null) expect(proteinMeter.textContent).toContain(`${formatSynthetic(protein)} g`);
    expect(screen.queryByText('Calorie target: baseline before activity.') !== null).toBe(resting !== null && deficit !== null);
  });
  it('shows day/trend partial and unknown values, logged-day coverage and day drilldown', async () => {
    rows[ids.days] = ['2026-10-12', '2026-10-14'].map(date => ({
      meal_date: date, meal_count: 9001, energy_kcal: 9001, protein_grams: null, carbohydrates_grams: null,
      fat_grams: null, fiber_grams: null, unknown_nutrients: ['protein_grams', 'carbohydrates_grams', 'fat_grams', 'fiber_grams'],
      partial_nutrients: ['energy_kcal'], latest_updated_at: '2026-10-18T09:00:00Z',
    }));
    render(<Wrapper sources={[ids.meals, ids.days]} entry="/daily?nutritionView=trend&nutritionDate=2026-10-18" />);
    await screen.findByText(/2 of 7 days have meals/u);
    expect(screen.getByRole('img', { name: 'Calories (kcal) by logged date' })).not.toBeNull();
    expect(screen.getByText('Average over 2 logged days')).not.toBeNull();
    expect(screen.getAllByText(/lower bound/u).length).toBeGreaterThan(0);
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(within(screen.getByText('Calories (kcal) by logged date').closest('figure')!).getByText('View data table'));
    fireEvent.click(screen.getByRole('button', { name: '2026-10-12' }));
    expect((screen.getByLabelText('Meal date') as HTMLInputElement).value).toBe('2026-10-12');
    await screen.findByText('No meals recorded.');
  });
  it('keeps zero-of-period coverage visible for a ready empty Trend', async () => {
    render(<Wrapper sources={[ids.meals, ids.days]} entry="/daily?nutritionView=trend" />);
    await screen.findByText(/0 of 7 days have meals/u);
    expect(screen.getByText('No records')).not.toBeNull();
  });
  it('keeps known-zero nutrients, partial bounds and compact non-macro tiles distinct from missing data', async () => {
    meals = [{ ...syntheticMeal, fiber_grams: 0, protein_grams: 0 },
      { ...syntheticMeal, id: 'synthetic-meal-9002', meal_name: 'Synthetic meal 9002', protein_grams: null, fiber_grams: null }];
    render(<Wrapper />);
    await screen.findByText('Synthetic meal 9002');
    const protein = screen.getByText('Protein', { selector: '.daily-meter-label' }).closest('.daily-meter')!;
    expect(protein.textContent).toContain('0 g');
    expect(protein.textContent).toContain('lower bound');
    expect(protein.textContent).not.toContain('Not recorded');
    const fiber = screen.getByRole('heading', { name: 'Fiber' }).closest('article')!;
    expect(fiber.className).toContain('daily-stat-tile--compact');
    expect(fiber.textContent).toContain('0 g');
    expect(fiber.textContent).toContain('lower bound');
    expect(fiber.querySelector('.daily-stat-value')?.textContent).toBe('0 g (lower bound)');
    expect(fiber.querySelector('.daily-stat-note')).toBeNull();
    expect(screen.queryByText('Not recorded', { selector: 'summary' })).toBeNull();
    expect(document.querySelector('.daily-freshness')?.textContent).toContain('2 meals');
    expect(document.querySelector('.nutrition-group-subtotal')?.textContent).toContain('Protein: 0 g (partial: lower bound)');
  });
  it.each([
    [200, true, false, 'At most 600 kcal remaining against baseline.'],
    [900, false, true, 'At least 100 kcal over baseline.'],
    [200, false, false, '600 kcal remaining against baseline.'],
    [900, false, false, '100 kcal over baseline.'],
  ])('keeps calorie comparisons honest for consumed %s, partial page %s and missing energy %s', async (consumed, partialPage, missing, comparison) => {
    targets = { restingKcal: 1000, deficitKcal: 200, proteinGrams: null };
    mealMore = partialPage;
    meals = [{ ...syntheticMeal, energy_kcal: consumed },
      ...(missing ? [{ ...syntheticMeal, id: 'synthetic-meal-9002', meal_name: 'Synthetic meal 9002', energy_kcal: null }] : [])];
    render(<Wrapper />);
    const line = await screen.findByText(new RegExp(comparison.replace('.', '\\.'), 'u'));
    expect(line.textContent).toContain(`Calories consumed: ${consumed} kcal${partialPage || missing ? ' (lower bound)' : ''}.`);
  });
  it('does not calculate remaining calories from an unknown consumed total', async () => {
    targets = { restingKcal: 1000, deficitKcal: 200, proteinGrams: null };
    meals = [{ ...syntheticMeal, energy_kcal: null }];
    render(<Wrapper />);
    expect(await screen.findByText('Calories consumed: Not recorded. Remaining against baseline: Not recorded.')).toBeTruthy();
  });
  it('keeps long meal names and only time and four macro chips in collapsed summaries', async () => {
    const name = `Synthetic long meal ${'recorded ingredient '.repeat(30)}`.trim();
    meals = [{ ...syntheticMeal, meal_name: name, confidence: 'synthetic confidence', capture_method: 'synthetic capture' }];
    render(<Wrapper />);
    const meal = (await screen.findByText(name)).closest('details')!;
    const summary = meal.querySelector('summary')!;
    expect(meal.open).toBe(false);
    expect(summary.textContent).toContain(name.trim());
    expect(summary.querySelector('time')).not.toBeNull();
    expect(summary.querySelectorAll('.nutrition-macro-chip')).toHaveLength(4);
    expect(summary.textContent).not.toContain('Fiber');
    expect(summary.textContent).not.toContain('Confidence');
    fireEvent.click(summary);
    expect(meal.open).toBe(true);
    expect(meal.textContent).toContain('Confidence: synthetic confidence');
    expect(within(meal).getByText('Components')).toBeTruthy();
  });
  it('presents recorded custom meal groups without renaming them Other', async () => {
    meals = [{ ...syntheticMeal, meal_type: 'After training' }];
    render(<Wrapper />);
    expect(await screen.findByRole('heading', { name: 'After training' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Other' })).toBeNull();
    expect(document.querySelector('.nutrition-group-subtotal')?.textContent).toContain('Calories: 9,001 kcal');
  });
  it('charts all four macros without guessing carbohydrate or fat targets and keeps weekly tables collapsed', async () => {
    targets = { restingKcal: 9500, deficitKcal: 500, proteinGrams: 9003 };
    rows[ids.days] = ['2026-10-12', '2026-10-14'].map(date => ({
      meal_date: date, meal_count: 1, energy_kcal: 9001, protein_grams: 9004,
      carbohydrates_grams: 9002, fat_grams: 9003, fiber_grams: null, partial_nutrients: [],
      unknown_nutrients: ['fiber_grams'], latest_updated_at: '2026-10-18T09:00:00Z',
    }));
    render(<Wrapper sources={[ids.meals, ids.days]} entry="/daily?nutritionView=trend" />);
    await screen.findByRole('img', { name: 'Fat (g) by logged date' });
    await waitFor(() => expect(screen.queryByText('Loading nutrition targets')).toBeNull());
    expect(screen.getAllByRole('img')).toHaveLength(4);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getAllByText('View data table')).toHaveLength(4);
    const carb = screen.getByText('Carbohydrates (g) by logged date').closest('figure')!;
    expect(carb.textContent).not.toContain('target');
    expect(carb.querySelectorAll('.daily-chart-series')).toHaveLength(1);
    expect(carb.querySelector('.daily-chart-line')?.getAttribute('d')?.match(/M/gu)).toHaveLength(2);
    expect(carb.querySelector('.daily-chart-target')).toBeNull();
    expect(carb.querySelectorAll('.daily-chart-legend li')).toHaveLength(1);
    const fat = screen.getByText('Fat (g) by logged date').closest('figure')!;
    expect(fat.textContent).not.toContain('target');
    expect(fat.querySelector('.daily-chart-target')).toBeNull();
    const protein = screen.getByText('Protein (g) by logged date').closest('figure')!;
    expect(protein.querySelector('.daily-chart-target')?.textContent).toContain('Protein target (g)');
    const calories = screen.getByText('Calories (kcal) by logged date').closest('figure')!;
    expect(calories.querySelector('.daily-chart-target')?.textContent).toContain('Baseline before activity (kcal)');
    fireEvent.click(within(protein).getByText('View data table'));
    expect(screen.getByRole('table', { name: 'Monday-based weekly averages over logged days only' })).toBeTruthy();
    expect(document.querySelector('.nutrition-weekly-list')?.textContent).toContain('2 known days');
  });
  it('retains day drilldown and weekly data tables when all chart observations are unknown', async () => {
    rows[ids.days] = [{
      meal_date: '2026-10-12', meal_count: 1, energy_kcal: null, protein_grams: null,
      carbohydrates_grams: null, fat_grams: null, fiber_grams: null,
      unknown_nutrients: ['energy_kcal', 'protein_grams', 'carbohydrates_grams', 'fat_grams', 'fiber_grams'],
      partial_nutrients: [], latest_updated_at: '2026-10-18T09:00:00Z',
    }];
    render(<Wrapper sources={[ids.meals, ids.days]} entry="/daily?nutritionView=trend" />);
    const calories = (await screen.findByText('Calories (kcal) by logged date')).closest('figure')!;
    const protein = screen.getByText('Protein (g) by logged date').closest('figure')!;
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(within(calories).getByText('No recorded values to chart.')).toBeTruthy();
    expect(within(protein).getByText('No recorded values to chart.')).toBeTruthy();
    fireEvent.click(within(calories).getByText('View data table'));
    expect(screen.getByRole('table', { name: 'Logged day totals' })).toBeTruthy();
    fireEvent.click(within(protein).getByText('View data table'));
    const weekly = screen.getByRole('table', { name: 'Monday-based weekly averages over logged days only' });
    expect(weekly.textContent).toContain('0 known days');
    expect(weekly.textContent).toContain('Average over 1 logged day');
    expect(weekly.textContent).toContain('excludes 1 unknown logged day)');
    expect(weekly.textContent).toContain('Not recorded');
    fireEvent.click(screen.getByRole('button', { name: '2026-10-12' }));
    expect((screen.getByLabelText('Meal date') as HTMLInputElement).value).toBe('2026-10-12');
    expect(screen.getByLabelText('URL').textContent).toContain('nutritionView=day');
  });
  it('uses singular wording for a single logged and known day', async () => {
    rows[ids.days] = [{
      meal_date: '2026-10-12', meal_count: 1, energy_kcal: 9001, protein_grams: 9002,
      carbohydrates_grams: 9003, fat_grams: 9004, fiber_grams: 9005, unknown_nutrients: [],
      partial_nutrients: [], latest_updated_at: '2026-10-18T09:00:00Z',
    }];
    render(<Wrapper sources={[ids.meals, ids.days]} entry="/daily?nutritionView=trend" />);
    await screen.findByText('Average over 1 logged day');
    expect(screen.getByText('1 of 7 days has meals.')).toBeTruthy();
    const weekly = document.querySelector('.nutrition-weekly-list')!.textContent!;
    expect(weekly).toContain('1 known day');
    expect(weekly).not.toMatch(/\b1 (known|logged) days\b/u);
  });
  it('shows failed meal reads and recovers on Retry without changing date', async () => {
    pending = () => Promise.reject(new Error('synthetic-read-failure-9001'));
    render(<Wrapper entry="/daily?nutritionDate=2026-10-18" />);
    await screen.findByRole('alert');
    pending = undefined;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText(/Synthetic meal 9001/u);
    expect((screen.getByLabelText('Meal date') as HTMLInputElement).value).toBe('2026-10-18');
  });
  it('keeps the date controls usable while the first meal page is loading', async () => {
    let resolve!: (response: Response) => void;
    pending = () => new Promise<Response>(done => { resolve = done; });
    render(<Wrapper />);
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    expect(screen.getByText('Loading Daily history')).toBeTruthy();
    expect((screen.getByLabelText('Meal date') as HTMLInputElement).value).toBe('2026-10-18');
    await act(async () => { resolve(jsonResponse(dailyFixture(queries[0]!, [syntheticMeal]))); });
    await screen.findByText('Synthetic meal 9001');
    expect(screen.queryByText('Loading Daily history')).toBeNull();
  });
  it('shows independent target recovery without hiding recorded meals or inventing targets', async () => {
    const previous = vi.mocked(fetch).getMockImplementation()!;
    let failTargets = true;
    vi.mocked(fetch).mockImplementation(async (input, init) =>
      failTargets && String(input).endsWith('/daily/nutrition-targets') ? jsonResponse({}, 503) : previous(input, init));
    meals = [{ ...syntheticMeal, protein_grams: 9004 }];
    targets = { restingKcal: null, deficitKcal: null, proteinGrams: 9003 };
    render(<Wrapper />);
    await screen.findByRole('alert');
    expect(screen.getByText('Synthetic meal 9001')).toBeTruthy();
    expect(document.querySelector('.nutrition-meters')?.textContent).toContain('Target not set');
    failTargets = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('progressbar', { name: 'Protein' });
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('bounds automatic library paging at five pages and preserves loaded-only scope', async () => {
    const previous = vi.mocked(fetch).getMockImplementation()!;
    let pages = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (!String(input).endsWith('/daily/query')) return previous(input, init);
      const query = JSON.parse(String(init?.body)) as DailyQuery;
      if (query.source !== ids.favorites) return previous(input, init);
      pages += 1;
      return jsonResponse(dailyFixture(query, [{ id: `synthetic-favorite-${9000 + pages}`, favorite_name: `Synthetic favourite ${9000 + pages}` }],
        { id: `synthetic-favorite-${9000 + pages}` }));
    });
    render(<Wrapper sources={[ids.meals, ids.favorites]} entry="/daily?nutritionView=library" />);
    expect(await screen.findByText('Page limit reached.')).toBeTruthy();
    expect(pages).toBe(5);
    expect(screen.getByText('Synthetic favourite 9005')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });
  it('derives plan totals from items with unknown and lower-bound labels', async () => {
    rows[ids.plans] = [{
      id: 'synthetic-plan-9001', plan_name: 'Synthetic plan 9001', energy_kcal: 99999,
      items_json: [
        { mealKey: 'synthetic-item-9001', name: 'Synthetic item 9001',
          nutrients: { energyKcal: 9001, proteinGrams: null, carbohydratesGrams: 9004, fatGrams: null, fiberGrams: 9005 } },
        { mealKey: 'synthetic-item-9002', name: 'Synthetic item 9002',
          nutrients: { energyKcal: 9002, proteinGrams: 9003, carbohydratesGrams: null, fatGrams: null, fiberGrams: null } },
      ],
    }];
    render(<Wrapper sources={[ids.meals, ids.plans]} entry="/daily?nutritionView=library" />);
    fireEvent.click(await screen.findByText('Synthetic plan 9001'));
    expect(screen.getByText('18,003 kcal')).not.toBeNull();
    expect(screen.getByText(/9,003 g \(lower bound: at least, 1 item has no value\)/u)).not.toBeNull();
    expect(screen.getByText(/9,004 g \(lower bound: at least, 1 item has no value\)/u)).not.toBeNull();
    expect(screen.getByText(/9,005 g \(lower bound: at least, 1 item has no value\)/u)).not.toBeNull();
    expect(screen.getAllByText(/Not recorded \(unknown: at least, 2 items have no value\)/u)).toHaveLength(1);
    expect(screen.queryByText('99,999 kcal')).toBeNull();
  });
  it('filters loaded plans by their descriptions and retained item names', async () => {
    rows[ids.plans] = [{
      id: 'synthetic-plan-9001', plan_name: 'Synthetic plan 9001', description: 'Synthetic description 9002',
      items_json: [{ mealKey: 'synthetic-item-9001', name: 'Synthetic item name 9003', nutrients: { energyKcal: 9001 } }],
    }];
    render(<Wrapper sources={[ids.meals, ids.plans]} entry="/daily?nutritionView=library" />);
    await screen.findByText('Synthetic plan 9001');
    for (const filter of ['description 9002', 'item name 9003']) {
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: filter } });
      expect(screen.getByText('Synthetic plan 9001')).not.toBeNull();
    }
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Synthetic absent item 9004' } });
    expect(screen.queryByText('Synthetic plan 9001')).toBeNull();
  });
  it('bounds malformed stored JSON and escapes embedded markup', () => {
    expect(readableJson('not synthetic JSON')).toBe('not synthetic JSON');
    expect(readableJson('x'.repeat(20_000)).length).toBeLessThan(4100);
    expect(readableJson({ source: '<script>synthetic</script>' })).toContain('<script>');
  });

  function formatSynthetic(value: number) { return new Intl.NumberFormat('en-US').format(value); }
});
