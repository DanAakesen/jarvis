import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  sources: [ids.meals, ids.days], period: { startDate: '2026-10-12', endDate: '2026-10-18' },
  onPeriodChange: () => {}, refreshVersion: 0,
};
const syntheticMeal: Row = {
  id: 'synthetic-meal-9001', meal_name: 'Synthetic meal 9001', meal_type: 'breakfast',
  meal_date: '2026-10-18', occurred_at: '2026-10-18T09:00:00Z', energy_kcal: 901, protein_grams: 42,
  carbohydrates_grams: 105, fat_grams: 30, fiber_grams: null,
  deleted_at: null, components_json: [{ name: 'Synthetic component 9001', grams: 125 }],
  confidence: 'estimate', capture_method: 'photo',
  nutrient_provenance_json: { energyKcal: { source: 'estimate' }, proteinGrams: { source: 'user-exact' } },
};
let queries: DailyQuery[];
let meals: Row[];
let rows: Partial<Record<DailySourceId, Row[]>>;
let targets: { restingKcal: number | null; deficitKcal: number | null; proteinGrams: number | null };
let failMeals: boolean;
let failTargets: boolean;
let mealPages: Row[][] | null;
function Location() { return <output aria-label="URL">{useLocation().search}</output>; }
function Wrapper({ version = 0, sources = props.sources, entry = '?section=nutrition' }: {
  version?: number; sources?: readonly DailySourceId[]; entry?: string;
}) {
  return <MemoryRouter initialEntries={[entry]}><NutritionSection {...props} sources={sources} refreshVersion={version} /><Location /></MemoryRouter>;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-18T10:00:00Z'));
  queries = []; meals = [syntheticMeal]; rows = {}; failMeals = false; failTargets = false; mealPages = null;
  targets = { restingKcal: null, deficitKcal: null, proteinGrams: null };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/daily/nutrition-targets')) {
      if (failTargets) return jsonResponse({}, 503);
      return jsonResponse({
        targets, updatedAt: null,
        bounds: Object.fromEntries(Object.keys(targets).map(key => [key, { label: `Synthetic ${key}`, unit: key === 'proteinGrams' ? 'g' : 'kcal', min: 0, max: 99999 }])),
      });
    }
    const query = JSON.parse(String(init?.body)) as DailyQuery;
    queries.push(query);
    if (query.source === ids.meals && failMeals) return jsonResponse({}, 503);
    if (query.source === ids.meals && mealPages) {
      const page = 'cursor' in query ? 1 : 0;
      const next = page === 0 ? { createdAt: '2026-10-18T09:00:00Z', id: 'synthetic-cursor-9001' } : null;
      return jsonResponse(dailyFixture(query, mealPages[page] ?? [], next));
    }
    const items = query.source === ids.meals
      ? meals.filter(row => typeof row.meal_date === 'string' && row.meal_date >= query.startDate && row.meal_date <= query.endDate)
      : rows[query.source] ?? [];
    return jsonResponse(dailyFixture(query, items));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Nutrition section', () => {
  it('discovers with meals and keeps the existing library independently gated', () => {
    expect(discoverDailySections({ './sections/nutrition/index.tsx': { section } }, []).map(item => item.id)).toEqual([]);
    expect(discoverDailySections({ './sections/nutrition/index.tsx': { section } }, [ids.meals]).map(item => item.id)).toEqual(['nutrition']);
    expect(section.usesPeriod).toBe(true);
  });

  it('shows today kcal left, protein left, meal count, missing targets and unknown freshness', async () => {
    rows[ids.days] = [{
      meal_date: '2026-10-18', meal_count: 2, energy_kcal: 1000, protein_grams: 50,
      carbohydrates_grams: 80, fat_grams: 20, fiber_grams: null,
      unknown_nutrients: ['fiber_grams'], partial_nutrients: [], latest_updated_at: '2026-10-18T09:00:00Z',
    }];
    targets = { restingKcal: 2000, deficitKcal: 500, proteinGrams: 100 };
    render(<Wrapper entry="?nutritionView=day" />);
    await screen.findByText('500 kcal left');
    expect(screen.getByText('50 g left')).toBeTruthy();
    expect(document.querySelector('.nutrition-today-values')?.textContent).toContain('2');
    expect(screen.getByText('Staleness unknown')).toBeTruthy();
    expect(screen.getByText(/Read/u)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bDaily\b/u);
    expect(queries.some(query => query.source === ids.days && query.startDate === '2026-10-18' && query.endDate === '2026-10-18')).toBe(true);
  });

  it('labels partial day balances as bounds and links unset targets to Settings', async () => {
    rows[ids.days] = [{
      meal_date: '2026-10-18', meal_count: 2, energy_kcal: 1000, protein_grams: 50,
      carbohydrates_grams: null, fat_grams: null, fiber_grams: null,
      unknown_nutrients: ['carbohydrates_grams', 'fat_grams', 'fiber_grams'],
      partial_nutrients: ['energy_kcal', 'protein_grams'], latest_updated_at: '2026-10-18T09:00:00Z',
    }];
    targets = { restingKcal: 2000, deficitKcal: 500, proteinGrams: 100 };
    render(<Wrapper entry="?nutritionView=day" />);
    await screen.findByText('At most 500 kcal left');
    expect(screen.getByText('At most 50 g left')).toBeTruthy();
    expect(document.querySelector('.nutrition-today-card')?.textContent).not.toContain('Live');
  });

  it('links targets that are not set to Settings', async () => {
    render(<Wrapper entry="?nutritionView=day" />);
    expect(await screen.findAllByText('Target not set')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Set targets in Settings' }).getAttribute('href')).toBe('/settings#nutrition-targets');
  });

  it('uses an explicit unavailable state when day totals are not served', async () => {
    render(<Wrapper sources={[ids.meals]} entry="?nutritionView=day" />);
    expect(await screen.findByText('Health nutrition totals are not available.')).toBeTruthy();
    expect(screen.queryByText('0 kcal left')).toBeNull();
  });

  it('refreshes the served Today row after Copenhagen midnight when the page regains focus', async () => {
    render(<Wrapper entry="?nutritionView=day" />);
    await waitFor(() => expect(queries.some(query => query.source === ids.days && query.startDate === '2026-10-18')).toBe(true));
    vi.setSystemTime(new Date('2026-10-18T22:30:00Z'));
    fireEvent.focus(window);
    await waitFor(() => expect(queries.some(query => query.source === ids.days && query.startDate === '2026-10-19')).toBe(true));
  });

  it('lists period meals with every served field and explicit unavailable export state', async () => {
    meals = [{ ...syntheticMeal, components_json: [
      { name: 'Synthetic component 9001', grams: 125 },
      { name: 'Synthetic component 9002', grams: null },
    ] }];
    render(<Wrapper entry="?nutritionView=day" />);
    const name = await screen.findByRole('heading', { name: 'Synthetic meal 9001' });
    const meal = name.closest('article')!;
    expect(meal.textContent).toContain('2026');
    expect(meal.textContent).toContain('11:00');
    expect(meal.textContent).toContain('Synthetic component 9001 · 125 g');
    expect(meal.textContent).toContain('Synthetic component 9002 · Not recorded');
    expect(meal.textContent).toContain('Calories901 kcal (estimate)');
    expect(meal.textContent).toContain('Protein42 g');
    expect(meal.textContent).toContain('Confidence / uncertaintyestimate');
    expect(meal.textContent).toContain('Capture methodphoto');
    expect(meal.textContent).toContain('Export stateNot recorded');
    expect(queries.find(query => query.source === ids.meals)).toMatchObject({
      source: ids.meals, startDate: '2026-10-12', endDate: '2026-10-18', limit: 100,
    });
    expect(screen.getByRole('heading', { name: 'Today so far' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Meals' })).toBeTruthy();
  });

  it('shows explicit not-recorded states for absent meal name, time, components, macros and capture method', async () => {
    meals = [{
      ...syntheticMeal, meal_name: null, occurred_at: null, components_json: null,
      energy_kcal: null, protein_grams: null, carbohydrates_grams: null, fat_grams: null,
      confidence: null, capture_method: null, nutrient_provenance_json: null,
    }];
    render(<Wrapper entry="?nutritionView=day" />);
    const meal = (await screen.findByRole('heading', { name: 'Not recorded' })).closest('article')!;
    expect(meal.textContent).toContain('Not recorded');
    expect(meal.textContent).toContain('Export stateNot recorded');
    expect(meal.textContent).toContain('ComponentsNot recorded');
    expect(meal.textContent).toContain('Capture methodNot recorded');
    expect(meal.querySelector('.nutrition-meal-macros')?.textContent).toContain('CaloriesNot recorded');
  });

  it('paginates the period list and keeps earlier rows when loading another page', async () => {
    mealPages = [
      [{ ...syntheticMeal, id: 'synthetic-meal-page-1', meal_name: 'Synthetic first-page meal' }],
      [{ ...syntheticMeal, id: 'synthetic-meal-page-2', meal_name: 'Synthetic second-page meal' }],
    ];
    render(<Wrapper entry="?nutritionView=day" />);
    await screen.findByRole('heading', { name: 'Synthetic first-page meal' });
    fireEvent.click(screen.getByRole('button', { name: 'Load more meals' }));
    await screen.findByRole('heading', { name: 'Synthetic second-page meal' });
    expect(screen.getByRole('heading', { name: 'Synthetic first-page meal' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more meals' })).toBeNull();
  });

  it('shows period averages, partial-day inventory and both chart data series', async () => {
    targets = { restingKcal: 2000, deficitKcal: 500, proteinGrams: 100 };
    rows[ids.days] = [
      { meal_date: '2026-10-12', meal_count: 1, energy_kcal: 1000, protein_grams: 50,
        carbohydrates_grams: null, fat_grams: null, fiber_grams: null,
        unknown_nutrients: ['carbohydrates_grams', 'fat_grams', 'fiber_grams'],
        partial_nutrients: ['energy_kcal', 'protein_grams'], latest_updated_at: '2026-10-12T22:30:00Z' },
      { meal_date: '2026-10-14', meal_count: 1, energy_kcal: 1200, protein_grams: 60,
        carbohydrates_grams: 80, fat_grams: 20, fiber_grams: null, unknown_nutrients: ['fiber_grams'],
        partial_nutrients: [], latest_updated_at: '2026-10-14T10:00:00Z' },
      { meal_date: '2026-10-18', meal_count: 1, energy_kcal: null, protein_grams: null,
        carbohydrates_grams: null, fat_grams: null, fiber_grams: null,
        unknown_nutrients: ['energy_kcal', 'protein_grams', 'carbohydrates_grams', 'fat_grams', 'fiber_grams'],
        partial_nutrients: [], latest_updated_at: '2026-10-18T09:00:00Z' },
    ];
    render(<Wrapper entry="?nutritionView=trend" />);
    await screen.findByRole('img', { name: 'Health calorie balance (kcal)' });
    expect(screen.getByRole('img', { name: 'Health protein intake (g)' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bDaily\b/u);
    expect(screen.getByText(/At most 400 kcal below baseline/u)).toBeTruthy();
    expect(screen.getByText(/At least 55 g\/day \(lower bound\)/u)).toBeTruthy();
    expect(screen.getByText('3 of 7 days have meals; 1 day has partial nutrients.')).toBeTruthy();
    expect(screen.getByText(/Partial energy totals are lower bounds/u)).toBeTruthy();
    expect(document.querySelectorAll('.daily-chart-bars path')).toHaveLength(2);
    expect(document.querySelectorAll('.daily-chart-series circle')).toHaveLength(2);
    const balance = screen.getByRole('img', { name: 'Health calorie balance (kcal)' }).closest('figure')!;
    fireEvent.click(balance.querySelector('summary')!);
    expect(balance.querySelector('table')?.textContent).toContain('At most 500 kcal below baseline');
    expect(balance.querySelector('table')?.textContent).toContain('Lower-bound source total');
  });

  it('keeps an empty trend readable and reserves space for settled states', async () => {
    meals = [];
    render(<Wrapper entry="?nutritionView=trend" />);
    await screen.findByText('No records');
    expect(screen.getByText('0 of 7 days have meals; 0 days have partial nutrients.')).toBeTruthy();
    expect(document.querySelector('.nutrition-trend')?.className).toContain('nutrition-trend');
    fireEvent.click(screen.getByRole('tab', { name: 'Day' }));
    await screen.findByText('No meals recorded in this period.');
    expect(document.querySelector('.nutrition-meals-list')?.className).toContain('nutrition-meals-list');
  });

  it('preserves favourites and meal plans in the existing library view', async () => {
    rows[ids.favorites] = [{ ...syntheticMeal, favorite_name: 'Synthetic favourite 9001', aliases_json: ['Synthetic alias 9002'] }];
    rows[ids.plans] = [{
      id: 'synthetic-plan-9001', plan_name: 'Synthetic plan 9001',
      energy_kcal: 99999, items_json: [
        { name: 'Synthetic plan item 9001', nutrients: { energyKcal: 9001, proteinGrams: null, carbohydratesGrams: 9004 } },
        { name: 'Synthetic plan item 9002', nutrients: { energyKcal: 9002, proteinGrams: 9003 } },
      ],
    }];
    render(<Wrapper sources={[ids.meals, ids.days, ids.favorites, ids.plans]} entry="?nutritionView=library" />);
    expect(await screen.findByText('Synthetic favourite 9001')).toBeTruthy();
    const plan = screen.getByText('Synthetic plan 9001');
    fireEvent.click(plan);
    expect(screen.getByText('18,003 kcal')).toBeTruthy();
    expect(screen.getByText(/9,003 g \(lower bound: at least, 1 item has no value\)/u)).toBeTruthy();
    expect(screen.getByText(/9,004 g \(lower bound: at least, 1 item has no value\)/u)).toBeTruthy();
    expect(screen.queryByText('99,999 kcal')).toBeNull();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Synthetic alias 9002' } });
    expect(screen.getByText('Synthetic favourite 9001')).toBeTruthy();
    expect(screen.queryByText('Synthetic plan 9001')).toBeNull();
  });

  it('keeps loaded-only filtering for plan descriptions and retained item names', async () => {
    rows[ids.plans] = [{
      id: 'synthetic-plan-9001', plan_name: 'Synthetic plan 9001', description: 'Synthetic description 9002',
      items_json: [{ name: 'Synthetic plan item 9003', nutrients: { energyKcal: 9001 } }],
    }];
    render(<Wrapper sources={[ids.meals, ids.plans]} entry="?nutritionView=library" />);
    await screen.findByText('Synthetic plan 9001');
    for (const filter of ['description 9002', 'item 9003']) {
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: filter } });
      expect(screen.getByText('Synthetic plan 9001')).toBeTruthy();
    }
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Synthetic absent 9004' } });
    expect(screen.queryByText('Synthetic plan 9001')).toBeNull();
  });

  it('retains the library page cap and makes its partial coverage visible', async () => {
    const previousFetch = vi.mocked(fetch).getMockImplementation()!;
    let page = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const query = url.endsWith('/daily/query') ? JSON.parse(String(init?.body)) as DailyQuery : null;
      if (query?.source !== ids.favorites) return previousFetch(input, init);
      page += 1;
      return jsonResponse(dailyFixture(query, [{
        id: `synthetic-favorite-${9000 + page}`, favorite_name: `Synthetic favourite ${9000 + page}`,
      }], page < 6 ? { id: `synthetic-favorite-${9000 + page}` } : null));
    });
    render(<Wrapper sources={[ids.meals, ids.favorites]} entry="?nutritionView=library" />);
    expect(await screen.findByText('Page limit reached.')).toBeTruthy();
    expect(page).toBe(5);
    expect(screen.getByText('Synthetic favourite 9005')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('shows a recoverable meal read error without hiding the today card', async () => {
    failMeals = true;
    render(<Wrapper entry="?nutritionView=day" />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Today so far' })).toBeTruthy();
    failMeals = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Synthetic meal 9001' })).toBeTruthy();
  });

  it('shows independent target-load failure and retries without changing nutrition reads', async () => {
    failTargets = true;
    render(<Wrapper entry="?nutritionView=day" />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(document.querySelector('.nutrition-meals-list')?.textContent).toContain('Synthetic meal 9001');
    failTargets = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByRole('link', { name: 'Set targets in Settings' })).toBeTruthy();
  });

  it('keeps period filter behavior for loaded favourites and safely bounds stored JSON', async () => {
    expect(readableJson('not synthetic JSON')).toBe('not synthetic JSON');
    expect(readableJson('x'.repeat(20_000)).length).toBeLessThan(4100);
    expect(readableJson({ source: '<script>synthetic</script>' })).toContain('<script>');
  });
  it('labels provenance sources but keeps every other stored string exact', () => {
    const rendered = readableJson({
      source: 'daily.metrics', origin: { source: 'daily-sql', alias: 'daily.com' }, aliases: ['daily.com'],
    });
    expect(rendered).toContain('"source": "Health · metrics"');
    expect(rendered).toContain('"source": "Health · data store"');
    expect(rendered).toContain('"alias": "daily.com"');
    expect(rendered).toMatch(/\[\s*"daily\.com"\s*\]/u);
  });
});
