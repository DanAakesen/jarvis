import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { suggest, type BudgetContext, type Suggestion } from './model.js';
import { readNutritionSuggestions, type NutritionSuggestionSources } from './suggestion-adapter.js';
import type { NutritionTargets } from './targets.js';
import type { NutritionTargetsAccess } from './targets-store.js';

// Synthetic placeholders. They are not anyone's real figures.
const synthetic: NutritionTargets = { restingKcal: 1750, deficitKcal: 350, proteinGrams: 110 };
const now = '2026-10-17T10:30:00.000Z'; // 12:30 in Copenhagen (summer time)
const today = '2026-10-17';
const request = { principal: { objectId: '11111111-1111-4111-8111-111111111111' } } as unknown as FastifyRequest;
const signal = () => new AbortController().signal;

afterEach(() => { vi.useRealTimers(); });

type Rows = Record<string, unknown>[];
const meal = (id: string, energy: number | null, protein: number | null, over: Record<string, unknown> = {}) => ({
  id, energy_kcal: energy, protein_grams: protein, created_at: '2026-10-17T08:00:00.000Z', deleted_at: null, ...over,
});
const favourite = (id: string, energy: number | null, protein: number | null) => ({
  id, favorite_name: `Favourite ${id}`, energy_kcal: energy, protein_grams: protein, carbohydrates_grams: null, fat_grams: null, fiber_grams: null,
});
const metric = (metric_name: string, value: number, over: Record<string, unknown> = {}) => ({
  metric_name, metric_date: new Date('2026-10-17T00:00:00.000Z'), unit: 'kcal', value, sample_count: '8',
  start_at: null, end_at: null, updated_at: '2026-10-17T10:00:00.000Z', ...over,
});
const active = (value = 300) => metric('active_energy', value);

interface HistoryInput { limit: number; from?: string; to?: string; after?: { createdAt: string; id: string } }
interface Overrides {
  targets?: NutritionTargets;
  updatedAt?: string | null;
  now?: string;
  realClock?: boolean;
  history?: (input: HistoryInput, signal: AbortSignal) => Promise<{ rows: Rows; next: { createdAt: string; id: string } | null }>;
  favorites?: (input: { limit: number; afterId?: string }, signal: AbortSignal) => Promise<{ rows: Rows; nextId: string | null }>;
  healthHistory?: (kind: string, range: { startDate: string; endDate: string; limit: number; after?: { date: string; key: string } }, signal: AbortSignal)
    => Promise<{ items: Rows; truncated: boolean; next: { date: string; key: string } | null }>;
  disliked?: readonly string[];
}

function build(over: Overrides = {}) {
  const read = vi.fn(async () => ({
    targets: over.targets ?? synthetic,
    updatedAt: over.updatedAt === undefined ? '2026-10-10T08:00:00.000Z' : over.updatedAt,
  }));
  const targetsAccess = vi.fn(() => ({ read, write: vi.fn() }));
  const history = vi.fn(over.history ?? (async () => ({ rows: [], next: null })));
  const favorites = vi.fn(over.favorites ?? (async () => ({ rows: [], nextId: null })));
  const disliked = new Set(over.disliked ?? []);
  const suggestions = vi.fn(async (candidates: readonly Suggestion[], context: BudgetContext) => suggest(candidates, disliked, context));
  const nutritionAccess = vi.fn(() => ({ history, favorites, suggestions }));
  const healthHistory = vi.fn(over.healthHistory ?? (async () => ({ items: [active()], truncated: false, next: null })));
  const healthAccess = vi.fn(() => ({ history: healthHistory }));
  const sources = {
    nutrition: nutritionAccess, health: healthAccess, ...(over.realClock ? {} : { now: () => over.now ?? now }),
  } as unknown as NutritionSuggestionSources;
  const run = (limit = 5, operationSignal = signal()) => readNutritionSuggestions(sources, targetsAccess as unknown as NutritionTargetsAccess, request, limit, operationSignal);
  return { run, read, targetsAccess, history, favorites, suggestions, nutritionAccess, healthHistory, healthAccess };
}

describe('readNutritionSuggestions', () => {
  it('works out what is left and returns the fitting favourites, closest protein match first', async () => {
    const t = build({
      history: async () => ({ rows: [meal('m1', 400, 30), meal('m2', 300, 20), meal('gone', 999, 99, { deleted_at: '2026-10-17T09:00:00.000Z' })], next: null }),
      healthHistory: async () => ({ items: [active(300), metric('basal_energy_burned', 1400), metric('step_count', 4000, { unit: 'count' })], truncated: false, next: null }),
      favorites: async () => ({
        rows: [favourite('a', 450, 30), favourite('b', 1200, 80), favourite('c', 200, 58), favourite('d', 300, null), favourite('e', 400, 60)], nextId: null,
      }),
      disliked: ['e'],
    });
    const report = await t.run(5);

    expect(report).toMatchObject({
      status: 'ready', asOf: now, localDate: today, localTime: '12:30', missingTargets: [],
      kcal: { state: 'ready', reasons: [], activeKcal: 300, allowanceKcal: 1700, eatenKcal: 700, remainingKcal: 1000 },
      protein: { state: 'ready', reasons: [], targetGrams: 110, eatenKnownGrams: 50, remainingGrams: 60 },
      eaten: { source: 'jarvis-meal-log', date: today, meals: 2, complete: true, invalidEnergyMeals: 0 },
      candidates: { source: 'favourites', considered: 5, skippedInvalid: 0, truncated: false },
      totalMatches: 3,
      filters: { kcalFilterApplied: true, proteinOrderingApplied: true, dislikesApplied: true },
    });
    expect(report.burn).toEqual({
      source: 'apple-health', metric: 'active_energy', date: today, state: 'known', kcal: 300, unit: 'kcal', sampleCount: 8,
      sourceStartAt: null, sourceEndAt: null, storedAt: '2026-10-17T10:00:00.000Z', ageMinutes: 30,
    });
    expect(report.suggestions.map((item) => item.favoriteId)).toEqual(['c', 'a', 'd']);
    expect(report.suggestions[0]).toEqual({
      favoriteId: 'c', name: 'Favourite c', energyKcal: 200, proteinGrams: 58, carbohydratesGrams: null, fatGrams: null, fiberGrams: null,
    });
    expect(report.provenance).toEqual({
      targets: { store: 'daily-settings', enteredBy: 'owner', updatedAt: '2026-10-10T08:00:00.000Z' },
      formula: expect.any(String),
    });
    expect(report.provenance.formula).not.toMatch(/\d/u);

    expect(t.history).toHaveBeenCalledTimes(1);
    expect(t.history.mock.calls[0]![0]).toStrictEqual({ limit: 100, from: today, to: today });
    expect(t.healthHistory).toHaveBeenCalledTimes(1);
    expect(t.healthHistory.mock.calls[0]!.slice(0, 2)).toStrictEqual(['metrics', { startDate: today, endDate: today, limit: 250 }]);
    expect(t.suggestions.mock.calls[0]![1]).toStrictEqual({ now, localTime: '12:30', remainingKcal: 1000, remainingProteinGrams: 60 });

    const short = await t.run(2);
    expect(short.suggestions.map((item) => item.favoriteId)).toEqual(['c', 'a']);
    expect(short.totalMatches).toBe(3);
  });

  it('takes the date and clock from one reading, including after local midnight and from the real clock by default', async () => {
    const late = build({ now: '2026-10-24T22:30:00.000Z' });
    const report = await late.run();
    expect(report).toMatchObject({ localDate: '2026-10-25', localTime: '00:30' });
    expect(late.history.mock.calls[0]![0]).toStrictEqual({ limit: 100, from: '2026-10-25', to: '2026-10-25' });
    expect(late.healthHistory.mock.calls[0]![1]).toStrictEqual({ startDate: '2026-10-25', endDate: '2026-10-25', limit: 250 });
    expect(report.burn).toMatchObject({ state: 'unknown', reason: 'health_no_row_today' });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-15T10:30:00.000Z'));
    const real = build({ realClock: true });
    expect(await real.run()).toMatchObject({ asOf: '2026-01-15T10:30:00.000Z', localDate: '2026-01-15', localTime: '11:30' });
  });

  it('pages through the day\'s meals and counts all of them', async () => {
    const t = build({
      history: async (input) => input.after
        ? { rows: [meal('m3', 250, 10)], next: null }
        : { rows: [meal('m1', 400, 30), meal('m2', 300, 20)], next: { createdAt: '2026-10-17T08:00:00.000Z', id: 'm2' } },
    });
    const report = await t.run();
    expect(report.eaten).toMatchObject({ meals: 3, complete: true });
    expect(report.kcal).toMatchObject({ state: 'ready', eatenKcal: 950, remainingKcal: 750 });
    expect(t.history).toHaveBeenCalledTimes(2);
    expect(t.history.mock.calls[1]![0]).toStrictEqual({ limit: 100, from: today, to: today, after: { createdAt: '2026-10-17T08:00:00.000Z', id: 'm2' } });
  });

  it('reports an unfinished meal read as unknown and applies no budget filter, never as a smaller total', async () => {
    const t = build({
      history: async () => ({ rows: [meal('m1', 400, 30)], next: { createdAt: '2026-10-17T08:00:00.000Z', id: 'm1' } }),
      favorites: async () => ({ rows: [favourite('a', 450, 30), favourite('b', 4000, 80)], nextId: null }),
    });
    const report = await t.run();
    expect(t.history).toHaveBeenCalledTimes(3);
    expect(report.status).toBe('partial');
    expect(report.eaten.complete).toBe(false);
    expect(report.kcal).toMatchObject({ state: 'unknown', reasons: ['meals_incomplete'], allowanceKcal: 1700, eatenKcal: null, remainingKcal: null });
    expect(report.protein).toMatchObject({ state: 'unknown', reasons: ['meals_incomplete'], remainingGrams: null });
    expect(report.filters).toEqual({ kcalFilterApplied: false, proteinOrderingApplied: false, dislikesApplied: true });
    expect(t.suggestions.mock.calls[0]![1]).toStrictEqual({ now, localTime: '12:30', remainingKcal: null, remainingProteinGrams: null });
    expect(report.suggestions.map((item) => item.favoriteId)).toEqual(['a', 'b']);
  });

  it('flags meals without usable values instead of counting them as zero', async () => {
    const t = build({ history: async () => ({ rows: [meal('m1', 400, null), meal('m2', 300, 20)], next: null }) });
    const report = await t.run();
    expect(report.status).toBe('partial');
    expect(report.kcal).toMatchObject({ state: 'ready', eatenKcal: 700 });
    expect(report.protein).toMatchObject({ state: 'partial', reasons: ['meal_protein_unknown'], unknownProteinMeals: 1, eatenKnownGrams: 20, remainingGrams: 90 });

    const bad = await build({ history: async () => ({ rows: [meal('m1', null, 30)], next: null }) }).run();
    expect(bad.kcal).toMatchObject({ state: 'unknown', reasons: ['meal_energy_invalid'], remainingKcal: null });
    expect(bad.eaten.invalidEnergyMeals).toBe(1);
  });

  it('keeps paging health rows until the active-energy row is found and then stops', async () => {
    const paged = build({
      healthHistory: async (_kind, range) => range.after
        ? { items: [active(250)], truncated: false, next: null }
        : { items: [metric('aaa_metric', 1, { unit: 'count' })], truncated: true, next: { date: today, key: 'aaa_metric' } },
    });
    expect((await paged.run()).burn).toMatchObject({ state: 'known', kcal: 250 });
    expect(paged.healthHistory).toHaveBeenCalledTimes(2);
    expect(paged.healthHistory.mock.calls[1]!.slice(0, 2)).toStrictEqual(['metrics', { startDate: today, endDate: today, limit: 250, after: { date: today, key: 'aaa_metric' } }]);

    const early = build({ healthHistory: async () => ({ items: [active(120)], truncated: true, next: { date: today, key: 'active_energy' } }) });
    expect((await early.run()).burn).toMatchObject({ state: 'known', kcal: 120 });
    expect(early.healthHistory).toHaveBeenCalledTimes(1);
  });

  it('says the scan was incomplete when the burn row was not reached, and "no row" when there is none', async () => {
    const endless = build({ healthHistory: async () => ({ items: [metric('aaa_metric', 1, { unit: 'count' })], truncated: true, next: { date: today, key: 'aaa_metric' } }) });
    const unreached = await endless.run();
    expect(endless.healthHistory).toHaveBeenCalledTimes(3);
    expect(unreached.burn).toMatchObject({ state: 'unknown', reason: 'health_scan_incomplete' });
    expect(unreached.kcal).toMatchObject({ state: 'unknown', reasons: ['active_energy_unknown'], activeKcal: null, remainingKcal: null });

    const none = await build({ healthHistory: async () => ({ items: [metric('step_count', 100, { unit: 'count' })], truncated: false, next: null }) }).run();
    expect(none.burn).toMatchObject({ state: 'unknown', reason: 'health_no_row_today' });
  });

  it('degrades a failed health read to an unknown burn without leaking the failure, and keeps protein', async () => {
    const t = build({ healthHistory: async () => { throw new Error('private connection detail'); } });
    const report = await t.run();
    expect(report.burn).toEqual({ source: 'apple-health', metric: 'active_energy', date: today, state: 'unknown', reason: 'health_read_failed' });
    expect(report.status).toBe('partial');
    expect(report.kcal).toMatchObject({ state: 'unknown', reasons: ['active_energy_unknown'], remainingKcal: null });
    expect(report.protein).toMatchObject({ state: 'ready', remainingGrams: 110 });
    expect(JSON.stringify(report)).not.toContain('private connection detail');
  });

  it('rethrows an abort or deadline instead of reporting it as a health failure', async () => {
    const controller = new AbortController();
    const t = build({ healthHistory: async () => { controller.abort(new Error('stopped by caller')); throw new Error('socket closed'); } });
    await expect(t.run(5, controller.signal)).rejects.toThrow('stopped by caller');
    expect(t.favorites).not.toHaveBeenCalled();
    expect(t.suggestions).not.toHaveBeenCalled();

    const early = new AbortController();
    early.abort(new Error('already stopped'));
    const untouched = build();
    await expect(untouched.run(5, early.signal)).rejects.toThrow('already stopped');
    expect(untouched.read).not.toHaveBeenCalled();
  });

  it('does not hide a failed meal read', async () => {
    const t = build({ history: async () => { throw new Error('meal store unavailable'); } });
    await expect(t.run()).rejects.toThrow('meal store unavailable');
    expect(t.favorites).not.toHaveBeenCalled();
  });

  it('names every unset target and applies no filter or ordering without them', async () => {
    const t = build({
      targets: { restingKcal: null, deficitKcal: null, proteinGrams: null }, updatedAt: null,
      favorites: async () => ({ rows: [favourite('a', 900, 10), favourite('b', 100, 50)], nextId: null }),
    });
    const report = await t.run();
    expect(report.status).toBe('partial');
    expect(report.missingTargets).toEqual(['restingKcal', 'deficitKcal', 'proteinGrams']);
    expect(report.kcal).toMatchObject({ state: 'unknown', reasons: ['resting_target_not_set', 'deficit_target_not_set'], allowanceKcal: null, remainingKcal: null });
    expect(report.protein).toMatchObject({ state: 'unknown', reasons: ['protein_target_not_set'], remainingGrams: null });
    expect(report.filters).toEqual({ kcalFilterApplied: false, proteinOrderingApplied: false, dislikesApplied: true });
    expect(report.provenance.targets.updatedAt).toBeNull();
    expect(report.suggestions.map((item) => item.favoriteId)).toEqual(['a', 'b']);
  });

  it('treats a deficit of zero as configured', async () => {
    const report = await build({ targets: { ...synthetic, deficitKcal: 0 } }).run();
    expect(report.missingTargets).toEqual([]);
    expect(report.kcal).toMatchObject({ state: 'ready', deficitKcal: 0, allowanceKcal: 2050 });
  });

  it('reports being over budget as a negative figure with no suggestions, not as missing data', async () => {
    const t = build({
      history: async () => ({ rows: [meal('m1', 2000, 100)], next: null }),
      favorites: async () => ({ rows: [favourite('a', 200, 30)], nextId: null }),
    });
    const report = await t.run();
    expect(report.status).toBe('ready');
    expect(report.kcal).toMatchObject({ state: 'ready', remainingKcal: -300 });
    expect(report.filters.kcalFilterApplied).toBe(true);
    expect(report.suggestions).toEqual([]);
    expect(report.totalMatches).toBe(0);
  });

  it('pages favourites, skips and counts unusable ones, and flags a truncated list', async () => {
    const paged = build({
      favorites: async (input) => input.afterId
        ? { rows: [favourite('c', 100, 20)], nextId: null }
        : { rows: [favourite('a', 100, 20), favourite('bad', null, 5)], nextId: 'bad' },
    });
    const report = await paged.run();
    expect(report.candidates).toEqual({ source: 'favourites', considered: 3, skippedInvalid: 1, truncated: false });
    expect(report.status).toBe('partial');
    expect(report.suggestions.map((item) => item.favoriteId)).toEqual(['a', 'c']);
    expect(paged.favorites.mock.calls[0]![0]).toStrictEqual({ limit: 100 });
    expect(paged.favorites.mock.calls[1]![0]).toStrictEqual({ limit: 100, afterId: 'bad' });

    const endless = build({ favorites: async () => ({ rows: [favourite('a', 100, 20)], nextId: 'a' }) });
    const truncated = await endless.run();
    expect(endless.favorites).toHaveBeenCalledTimes(3);
    expect(truncated.candidates).toMatchObject({ truncated: true, considered: 3 });
    expect(truncated.status).toBe('partial');
  });

  it('rejects an invalid limit before reading anything', async () => {
    for (const limit of [0, 11, 1.5, -1, Number.NaN]) {
      const t = build();
      await expect(t.run(limit)).rejects.toThrow('Invalid suggestion limit');
      expect(t.read).not.toHaveBeenCalled();
    }
  });

  it('stops before any other read when the owner cannot be resolved', async () => {
    const t = build();
    t.targetsAccess.mockImplementation(() => { throw new Error('owner denied'); });
    await expect(t.run()).rejects.toThrow('owner denied');
    for (const untouched of [t.nutritionAccess, t.healthAccess, t.history, t.healthHistory, t.favorites, t.suggestions]) expect(untouched).not.toHaveBeenCalled();
  });
});
