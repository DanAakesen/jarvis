import type { FastifyRequest } from 'fastify';
import type { DailyHealthReadModel, HealthCursor } from '../health/read-model.js';
import { activeEnergyMetric, deriveBudget, pickActiveEnergy, toCandidate, totalMeals, type ActiveEnergy } from './budget.js';
import { copenhagenDate, copenhagenTime, type Suggestion } from './model.js';
import type { NutritionStore } from './store.js';
import { presentNutritionTargets } from './targets.js';
import type { NutritionTargetsAccess } from './targets-store.js';

/**
 * Read boundaries for the personalised suggestion budget (P12-09, #724). Each is resolved per request, so the
 * existing stores keep their own fail-closed owner resolution. No production caller exists until Daily is composed.
 */
export interface NutritionSuggestionSources {
  readonly nutrition: (request: FastifyRequest) => Pick<NutritionStore, 'history' | 'favorites' | 'suggestions'>;
  readonly health: (request: FastifyRequest) => Pick<DailyHealthReadModel, 'history'>;
  /** Trusted clock; one reading fixes the local date and time for the whole report. */
  readonly now?: () => string;
}

export const defaultSuggestionLimit = 5;
export const maxSuggestionLimit = 10;

// Every read is bounded. Running out of pages is reported as incomplete, never silently treated as complete.
const mealPages = 3;
const healthPages = 3;
const favouritePages = 3;

type MealCursor = { createdAt: string; id: string };

async function readMeals(nutrition: Pick<NutritionStore, 'history'>, today: string, signal: AbortSignal) {
  const rows: Record<string, unknown>[] = [];
  let after: MealCursor | undefined;
  for (let page = 0; page < mealPages; page += 1) {
    const result = await nutrition.history({ limit: 100, from: today, to: today, ...(after ? { after } : {}) }, signal);
    rows.push(...result.rows);
    if (result.next === null) return { rows, complete: true };
    after = result.next;
  }
  return { rows, complete: false };
}

/** A failed health read degrades to "burn unknown" with a reason; an abort or deadline is rethrown untouched. */
async function readActiveEnergy(health: Pick<DailyHealthReadModel, 'history'>, today: string, now: string, signal: AbortSignal): Promise<ActiveEnergy> {
  const rows: Record<string, unknown>[] = [];
  let after: HealthCursor | undefined;
  try {
    for (let page = 0; page < healthPages; page += 1) {
      const result = await health.history('metrics', { startDate: today, endDate: today, limit: 250, ...(after ? { after } : {}) }, signal);
      rows.push(...result.items);
      if (rows.some((row) => row.metric_name === activeEnergyMetric) || !result.truncated || result.next === null) {
        return pickActiveEnergy(rows, { today, now, complete: !result.truncated });
      }
      after = result.next;
    }
    return pickActiveEnergy(rows, { today, now, complete: false });
  } catch {
    signal.throwIfAborted();
    return { known: false, reason: 'health_read_failed' };
  }
}

async function readCandidates(nutrition: Pick<NutritionStore, 'favorites'>, signal: AbortSignal) {
  const candidates: Suggestion[] = [];
  let considered = 0;
  let skippedInvalid = 0;
  let afterId: string | undefined;
  for (let page = 0; page < favouritePages; page += 1) {
    const result = await nutrition.favorites({ limit: 100, ...(afterId === undefined ? {} : { afterId }) }, signal);
    for (const row of result.rows) {
      considered += 1;
      const candidate = toCandidate(row);
      if (candidate) candidates.push(candidate); else skippedInvalid += 1;
    }
    if (result.nextId === null) return { candidates, considered, skippedInvalid, truncated: false };
    afterId = result.nextId;
  }
  return { candidates, considered, skippedInvalid, truncated: true };
}

function presentBurn(burn: ActiveEnergy, today: string) {
  const base = { source: 'apple-health', metric: activeEnergyMetric, date: today } as const;
  if (!burn.known) return { ...base, state: 'unknown', reason: burn.reason } as const;
  return {
    ...base, state: 'known', kcal: burn.kcal, unit: 'kcal', sampleCount: burn.sampleCount,
    sourceStartAt: burn.sourceStartAt, sourceEndAt: burn.sourceEndAt, storedAt: burn.storedAt, ageMinutes: burn.ageMinutes,
  } as const;
}

/**
 * What is left of today's owner-configured food budget, and which saved favourites fit it. Read-only: it writes
 * nothing, projects nothing and estimates nothing. Every unknown (an unset target, no burn reading, an unread
 * page, a meal without a value) is named in the report and leaves the dependent figure null.
 */
export async function readNutritionSuggestions(
  sources: NutritionSuggestionSources,
  targets: NutritionTargetsAccess,
  request: FastifyRequest,
  limit: number,
  signal: AbortSignal,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > maxSuggestionLimit) throw new TypeError('Invalid suggestion limit');
  signal.throwIfAborted();
  const now = (sources.now ?? (() => new Date().toISOString()))();
  const today = copenhagenDate(now);
  const localTime = copenhagenTime(now);

  const stored = await targets(request).read(signal);
  const nutrition = sources.nutrition(request);
  const meals = await readMeals(nutrition, today, signal);
  const burn = await readActiveEnergy(sources.health(request), today, now, signal);
  const totals = totalMeals(meals.rows, meals.complete);
  const figures = deriveBudget({ targets: stored.targets, burn, meals: totals });
  const pool = await readCandidates(nutrition, signal);
  const matches = await nutrition.suggestions(pool.candidates, {
    now, localTime, remainingKcal: figures.kcal.remainingKcal, remainingProteinGrams: figures.protein.remainingGrams,
  }, signal);

  return {
    status: figures.kcal.state === 'ready' && figures.protein.state === 'ready' && !pool.truncated && pool.skippedInvalid === 0 ? 'ready' : 'partial',
    asOf: now,
    localDate: today,
    localTime,
    missingTargets: presentNutritionTargets(stored).missing,
    kcal: figures.kcal,
    protein: figures.protein,
    burn: presentBurn(burn, today),
    eaten: { source: 'jarvis-meal-log', date: today, meals: totals.meals, complete: totals.complete, invalidEnergyMeals: totals.invalidEnergyMeals },
    candidates: { source: 'favourites', considered: pool.considered, skippedInvalid: pool.skippedInvalid, truncated: pool.truncated },
    suggestions: matches.slice(0, limit).map((match) => ({
      favoriteId: match.mealKey, name: match.name, energyKcal: match.energyKcal, proteinGrams: match.proteinGrams,
      carbohydratesGrams: match.carbohydratesGrams, fatGrams: match.fatGrams, fiberGrams: match.fiberGrams,
    })),
    totalMatches: matches.length,
    filters: {
      kcalFilterApplied: figures.kcal.remainingKcal !== null,
      proteinOrderingApplied: figures.protein.remainingGrams !== null,
      dislikesApplied: true,
    },
    provenance: {
      targets: { store: 'daily-settings', enteredBy: 'owner', updatedAt: stored.updatedAt },
      formula: 'resting target plus active energy burned so far today, minus the deficit target, minus energy eaten so far; the rest of the day is not projected',
    },
  } as const;
}

export type NutritionSuggestionReport = Awaited<ReturnType<typeof readNutritionSuggestions>>;
