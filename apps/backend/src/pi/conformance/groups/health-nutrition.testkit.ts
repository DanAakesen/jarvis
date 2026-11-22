import { randomUUID } from 'node:crypto';
import { ToolRefusal } from '../../../core/tool-registry.js';
import {
  authorizeIntake, canonicalJson, copenhagenDate, date, favoriteSearchKey, instant, normalizeSearchText, preparePlan, suggest, text, writeDefinition, writeMeal,
  type BudgetContext, type FavoriteAuthority, type FavoriteInput, type IntakeAuthority, type MealInput, type PlanRequest, type Suggestion,
} from '../../../health/nutrition/model.js';
import type { DaysPage, HistoryPage, NutritionStore } from '../../../health/nutrition/store.js';
import { emptyNutritionTargets, nutritionTargetFields, parseNutritionTargetsPatch, type NutritionTargetsPatch, type StoredNutritionTargets } from '../../../health/nutrition/targets.js';
import type { NutritionTargetsStore } from '../../../health/nutrition/targets-store.js';
import { favoriteFingerprint } from '../../../health/records.js';
import type { HealthChangeSink } from '../../../health/revisions.js';
import type { ConformanceContext } from '../types.testkit.js';

type Row = Record<string, unknown>;

/** The methods the health tools call on the owner's nutrition store; the fake implements exactly these, with the production rules. */
export type NutritionPort = Pick<NutritionStore, 'log' | 'correct' | 'remove' | 'intake' | 'history' | 'days' | 'feedback' | 'preferences' | 'disliked' | 'suggestions'
  | 'favorite' | 'findFavorite' | 'lookupSaved' | 'favorites' | 'favoriteRecords' | 'savePlan' | 'plans' | 'planRecord' | 'findPlan' | 'removePlan'>;

const clone = <T>(value: T): T => structuredClone(value);
const dateOf = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const bigintOf = (row: Row) => BigInt(String(row.revision));

const mealColumns = ['meal_name', 'meal_type', 'occurred_at', 'expires_at', 'energy_kcal', 'protein_grams', 'carbohydrates_grams', 'fat_grams', 'fiber_grams', 'confidence', 'capture_method'] as const;

function mealRow(input: MealInput, at: string): Row {
  return {
    id: input.id, idempotency_key: input.idempotencyKey, meal_name: input.mealName, meal_type: input.mealType, occurred_at: input.occurredAt,
    meal_date: asDate(input.mealDate), expires_at: input.expiresAt, energy_kcal: input.energyKcal, protein_grams: input.proteinGrams,
    carbohydrates_grams: input.carbohydratesGrams, fat_grams: input.fatGrams, fiber_grams: input.fiberGrams, confidence: input.confidence,
    capture_method: input.captureMethod, components_json: canonicalJson(input.components), nutrient_provenance_json: canonicalJson(input.provenance),
    source: 'jarvis', revision: '1', deleted_at: null, created_at: at, updated_at: at,
  };
}

function sameMeal(row: Row, input: MealInput): boolean {
  const wanted = mealRow(input, '');
  return row.id === wanted.id && row.idempotency_key === wanted.idempotency_key && dateOf(row.meal_date) === input.mealDate
    && mealColumns.every((column) => row[column] === wanted[column])
    && canonicalJson(JSON.parse(String(row.components_json))) === canonicalJson(input.components)
    && canonicalJson(JSON.parse(String(row.nutrient_provenance_json))) === canonicalJson(input.provenance);
}

function favoriteNames(row: Row): string[] {
  const aliases = JSON.parse(String(row.aliases_json)) as string[];
  return [row.normalized_name as string, row.favorite_name as string, ...aliases].map(normalizeSearchText);
}

/**
 * An owner's nutrition store held in memory. The write rules (authorisation, idempotent replay, revisions, one favourite name
 * space) are the production ones.
 */
export class FakeNutrition implements NutritionPort {
  private meals: Row[] = [];
  private favoriteRows: Row[] = [];
  private planRows: Row[] = [];
  private feedbackRows: Row[] = [];

  constructor(private readonly context: ConformanceContext, private readonly changes: HealthChangeSink, private readonly now: () => string = () => new Date().toISOString()) {}

  private published(source: 'daily.nutrition.meals' | 'daily.nutrition.favorites' | 'daily.nutrition.plans') {
    this.changes.publish({ owner: this.context.owner, sources: [source as never] });
  }

  private record(key: string): Row | undefined {
    return [...this.meals].reverse().find((row) => row.idempotency_key === key);
  }

  /** Seed one meal. `key` is an exact intake key a case can address (corrections, deletions, favourites made from an intake). */
  seedMeal(input: { key: string; name: string; type: string | null; occurredAt: string; energyKcal: number; proteinGrams: number | null; carbohydratesGrams?: number | null; fatGrams?: number | null; fiberGrams?: number | null; components?: unknown[] }): void {
    const at = input.occurredAt;
    const row = mealRow({
      id: randomUUID(), idempotencyKey: input.key, mealName: input.name, mealType: input.type, components: input.components ?? [], occurredAt: input.occurredAt,
      mealDate: copenhagenDate(input.occurredAt), expiresAt: '9999-12-31T23:59:59Z', captureMethod: 'text', confidence: 'accurate',
      provenance: { energyKcal: { source: 'user-exact', unit: 'kcal' } }, energyKcal: input.energyKcal, proteinGrams: input.proteinGrams,
      carbohydratesGrams: input.carbohydratesGrams ?? null, fatGrams: input.fatGrams ?? null, fiberGrams: input.fiberGrams ?? null,
    }, at);
    this.meals.push(row);
  }

  seedFavorite(input: { id: string; name: string; aliases?: string[]; meal: string; type: string | null; energyKcal: number; proteinGrams: number | null; carbohydratesGrams?: number | null; fatGrams?: number | null; fiberGrams?: number | null; components?: unknown[] }): void {
    const at = this.now();
    this.favoriteRows.push({
      id: input.id, favorite_name: input.name, normalized_name: normalizeSearchText(input.name), aliases_json: canonicalJson(input.aliases ?? []),
      meal_name: input.meal, meal_type: input.type, components_json: canonicalJson(input.components ?? []), energy_kcal: input.energyKcal,
      protein_grams: input.proteinGrams, carbohydrates_grams: input.carbohydratesGrams ?? null, fat_grams: input.fatGrams ?? null, fiber_grams: input.fiberGrams ?? null,
      confidence: 'accurate', nutrient_provenance_json: canonicalJson({ energyKcal: { source: 'user-exact', unit: 'kcal' } }), source_meal_id: null,
      source_idempotency_key: null, revision: '1', created_at: at, updated_at: at,
    });
  }

  seedPlan(input: { id: string; name: string; description: string; entries: { slot: 'breakfast' | 'lunch' | 'dinner' | 'snack'; favoriteId: string }[] }): void {
    const at = this.now();
    const snapshot = preparePlan({ id: input.id, name: input.name, description: input.description, entries: input.entries }, this.favoriteRows);
    this.planRows.push({
      id: input.id, plan_name: input.name, normalized_name: normalizeSearchText(input.name), description: input.description, items_json: canonicalJson(snapshot.items),
      energy_kcal: snapshot.energyKcal, protein_grams: snapshot.proteinGrams, carbohydrates_grams: snapshot.carbohydratesGrams, fat_grams: snapshot.fatGrams,
      fiber_grams: snapshot.fiberGrams, revision: '1', deleted_at: null, created_at: at, updated_at: at,
    });
  }

  // ---- Meals ---------------------------------------------------------------------------------------------------------------

  async log(input: MealInput, authority: IntakeAuthority, signal: AbortSignal): Promise<Row> {
    signal.throwIfAborted();
    writeMeal(input, this.now()); input = clone(input); authorizeIntake(input, authority);
    if (authority.favorite) {
      text(authority.favorite.id);
      if (!/^[a-f0-9]{64}$/u.test(authority.favorite.fingerprint)) throw new TypeError('Invalid favourite snapshot');
      const favorite = this.favoriteRows.find((row) => row.id === authority.favorite!.id);
      if (!favorite || favoriteFingerprint(favorite) !== authority.favorite.fingerprint) {
        throw new ToolRefusal('The selected favourite changed before intake logging. Read it again; no new intake was committed.');
      }
    }
    const existing = this.record(input.idempotencyKey);
    if (existing) {
      if (!sameMeal(existing, input) || existing.deleted_at !== null) throw new ToolRefusal('This operation key already belongs to a different or corrected intake.');
      return clone(existing);
    }
    const row = mealRow(input, this.now());
    this.meals.push(row);
    this.published('daily.nutrition.meals');
    return clone(row);
  }

  async correct(input: MealInput, expectedRevision: bigint, signal: AbortSignal): Promise<Row> {
    signal.throwIfAborted();
    writeMeal(input, this.now()); input = clone(input);
    if (typeof expectedRevision !== 'bigint' || expectedRevision < 1n || expectedRevision >= 9223372036854775807n) throw new TypeError('Invalid meal revision');
    const row = this.record(input.idempotencyKey);
    if (!row || row.deleted_at !== null || row.id !== input.id) throw new ToolRefusal('Intake not found or unavailable for correction.');
    if (bigintOf(row) === expectedRevision + 1n && sameMeal(row, input)) return clone(row);
    if (bigintOf(row) !== expectedRevision) throw new ToolRefusal('Intake changed. Read the latest revision before correcting it.');
    const changed = mealRow(input, this.now());
    for (const column of [...mealColumns, 'meal_date', 'components_json', 'nutrient_provenance_json']) row[column] = changed[column];
    row.revision = String(expectedRevision + 1n);
    row.updated_at = this.now();
    this.published('daily.nutrition.meals');
    return clone(row);
  }

  async remove(idempotencyKey: string, expectedRevision: bigint, signal: AbortSignal): Promise<Row> {
    signal.throwIfAborted();
    text(idempotencyKey);
    if (typeof expectedRevision !== 'bigint' || expectedRevision < 1n || expectedRevision >= 9223372036854775807n) throw new TypeError('Invalid meal revision');
    const row = this.record(idempotencyKey);
    if (!row) throw new ToolRefusal('Intake not found.');
    if (row.deleted_at !== null && bigintOf(row) === expectedRevision + 1n) return clone(row);
    if (row.deleted_at !== null || bigintOf(row) !== expectedRevision) throw new ToolRefusal('Intake changed. Read the latest revision before deleting it.');
    row.deleted_at = this.now(); row.updated_at = row.deleted_at; row.revision = String(expectedRevision + 1n);
    this.published('daily.nutrition.meals');
    return clone(row);
  }

  async intake(idempotencyKey: string, signal: AbortSignal): Promise<Row | null> {
    signal.throwIfAborted();
    text(idempotencyKey);
    const row = this.record(idempotencyKey);
    return row ? clone(row) : null;
  }

  async history(input: { limit: number; from?: string; to?: string; after?: { createdAt: string; id: string } }, signal: AbortSignal): Promise<HistoryPage> {
    signal.throwIfAborted();
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100 || Object.keys(input).some((key) => !['limit', 'from', 'to', 'after'].includes(key))) throw new TypeError('Invalid history page');
    if (input.from) date(input.from);
    if (input.to) date(input.to);
    if (input.from && input.to && input.from > input.to) throw new TypeError('Invalid history range');
    if (input.after) { instant(input.after.createdAt); text(input.after.id); }
    const rows = this.meals
      .filter((row) => (!input.from || dateOf(row.meal_date) >= input.from) && (!input.to || dateOf(row.meal_date) <= input.to)
        && (!input.after || String(row.created_at) > input.after.createdAt || (row.created_at === input.after.createdAt && String(row.id) > input.after.id)))
      .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)) || String(left.id).localeCompare(String(right.id)));
    const more = rows.length > input.limit;
    const page = rows.slice(0, input.limit).map(clone);
    const last = page.at(-1);
    return { rows: page, next: more && last ? { createdAt: last.created_at as string, id: last.id as string } : null };
  }

  async days(input: { from: string; to: string; limit: number; after?: { date: string } }, signal: AbortSignal): Promise<DaysPage> {
    signal.throwIfAborted();
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 400 || Object.keys(input).some((key) => !['from', 'to', 'limit', 'after'].includes(key))) throw new TypeError('Invalid nutrition day page');
    date(input.from); date(input.to);
    if (input.from > input.to || Date.parse(input.to) - Date.parse(input.from) > 366 * 86_400_000) throw new TypeError('Invalid nutrition day range');
    const byDay = new Map<string, Row[]>();
    for (const row of this.meals) {
      const day = dateOf(row.meal_date);
      if (row.deleted_at !== null || day < input.from || day > input.to || (input.after && day <= input.after.date)) continue;
      byDay.set(day, [...(byDay.get(day) ?? []), row]);
    }
    const nutrients = ['energy_kcal', 'protein_grams', 'carbohydrates_grams', 'fat_grams', 'fiber_grams'] as const;
    const all = [...byDay.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([day, rows]) => {
      const known = (nutrient: typeof nutrients[number]) => rows.filter((row) => typeof row[nutrient] === 'number');
      const sum = (nutrient: typeof nutrients[number]) => known(nutrient).length ? known(nutrient).reduce((total, row) => total + (row[nutrient] as number), 0) : null;
      return {
        meal_date: asDate(day), meal_count: rows.length, energy_kcal: sum('energy_kcal'), protein_grams: sum('protein_grams'),
        carbohydrates_grams: sum('carbohydrates_grams'), fat_grams: sum('fat_grams'), fiber_grams: sum('fiber_grams'),
        unknown_nutrients: nutrients.filter((nutrient) => known(nutrient).length === 0),
        partial_nutrients: nutrients.filter((nutrient) => known(nutrient).length > 0 && known(nutrient).length < rows.length),
        latest_updated_at: rows.map((row) => String(row.updated_at)).sort().at(-1) ?? null,
      };
    });
    const page = all.slice(0, input.limit);
    return { rows: page, next: all.length > input.limit && page.at(-1) ? { date: dateOf(page.at(-1)!.meal_date) } : null };
  }

  // ---- Preferences and suggestions ----------------------------------------------------------------------------------------

  async feedback(mealKey: string, preference: 'like' | 'dislike' | null, signal: AbortSignal, expectedRevision?: bigint, reviewedFavorite?: string): Promise<Row> {
    signal.throwIfAborted();
    text(mealKey);
    if (preference !== null && preference !== 'like' && preference !== 'dislike') throw new TypeError('Invalid meal preference');
    if (reviewedFavorite !== undefined) {
      const favorite = this.favoriteRows.find((row) => row.id === mealKey);
      if (!favorite || favoriteFingerprint(favorite) !== reviewedFavorite) throw new ToolRefusal('The reviewed favourite changed. Review it again.');
    }
    const current = this.feedbackRows.find((row) => row.meal_key === mealKey);
    const currentRevision = current ? bigintOf(current) : 0n;
    if (expectedRevision !== undefined && currentRevision !== expectedRevision) {
      if (current && currentRevision === expectedRevision + 1n && current.preference === preference) return clone(current);
      throw new ToolRefusal('Food preference changed. Read the latest revision before updating it.');
    }
    if (current && current.preference === preference) return clone(current);
    const at = this.now();
    if (current) { current.preference = preference; current.revision = String(currentRevision + 1n); current.updated_at = at; return clone(current); }
    const created = { meal_key: mealKey, preference, revision: '1', created_at: at, updated_at: at };
    this.feedbackRows.push(created);
    this.published('daily.nutrition.favorites');
    return clone(created);
  }

  async preferences(keys: readonly string[], signal: AbortSignal): Promise<Row[]> {
    signal.throwIfAborted();
    if (!Array.isArray(keys) || keys.length < 1 || keys.length > 50) throw new TypeError('Invalid feedback keys');
    keys.forEach((key) => text(key));
    return this.feedbackRows.filter((row) => keys.includes(row.meal_key as string)).map(clone);
  }

  async disliked(keys: readonly string[], signal: AbortSignal): Promise<Set<string>> {
    signal.throwIfAborted();
    keys.forEach((key) => text(key));
    return new Set(this.feedbackRows.filter((row) => row.preference === 'dislike' && keys.includes(row.meal_key as string)).map((row) => row.meal_key as string));
  }

  async suggestions(candidates: readonly Suggestion[], context: BudgetContext, signal: AbortSignal): Promise<Suggestion[]> {
    suggest(candidates, new Set(), context);
    return suggest(clone([...candidates]), await this.disliked(candidates.map((candidate) => candidate.mealKey), signal), clone(context));
  }

  // ---- Favourites ----------------------------------------------------------------------------------------------------------

  async favorite(input: FavoriteInput, authority: FavoriteAuthority, signal: AbortSignal): Promise<Row> {
    signal.throwIfAborted();
    text(input.id); text(input.name);
    if (Number(input.sourceIdempotencyKey !== undefined) + Number(input.definition !== undefined) !== 1) throw new TypeError('Choose exactly one favourite source');
    if (authority.explicit !== true) throw new ToolRefusal('Explicit intent to save this favourite is required.');
    if (input.definition) {
      writeDefinition(input.definition);
      if (input.definition.confidence !== 'accurate' && authority.estimateAccepted !== true) throw new ToolRefusal('Accept the displayed estimated favourite definition first.');
    }
    input = clone(input);
    const normalized = normalizeSearchText(input.name);
    const aliases = [...new Set(input.aliases.map((alias) => { normalizeSearchText(alias); return alias; }))];
    const source = input.sourceIdempotencyKey === undefined ? null : this.meals.find((row) => row.deleted_at === null && row.idempotency_key === input.sourceIdempotencyKey) ?? null;
    if (input.sourceIdempotencyKey !== undefined && !source) throw new ToolRefusal('The source intake is unavailable.');
    if (authority.sourceRevision !== undefined && (!source || bigintOf(source) !== authority.sourceRevision)) throw new ToolRefusal('The reviewed source intake changed. Review it again.');
    const matches = this.favoriteRows.filter((row) => row.id === input.id || favoriteNames(row).slice(0, 2).includes(normalized));
    if (matches.length > 1) throw new ToolRefusal('The favourite name is ambiguous.');
    const existing = matches[0];
    const favoriteId = existing?.id as string | undefined ?? input.id;
    const proposed = new Set([normalized, ...aliases.map(normalizeSearchText)]);
    if (this.favoriteRows.some((row) => row.id !== favoriteId && favoriteNames(row).some((name) => proposed.has(name)))) throw new ToolRefusal('This favourite name or alias is already used.');
    const definition = input.definition;
    const values: Row = source
      ? Object.fromEntries(['meal_name', 'meal_type', 'components_json', 'energy_kcal', 'protein_grams', 'carbohydrates_grams', 'fat_grams', 'fiber_grams', 'confidence', 'nutrient_provenance_json'].map((column) => [column, source[column]]))
      : { meal_name: definition!.mealName, meal_type: definition!.mealType, components_json: canonicalJson(definition!.components), energy_kcal: definition!.energyKcal,
        protein_grams: definition!.proteinGrams, carbohydrates_grams: definition!.carbohydratesGrams, fat_grams: definition!.fatGrams, fiber_grams: definition!.fiberGrams,
        confidence: definition!.confidence, nutrient_provenance_json: canonicalJson(definition!.provenance) };
    const desired: Row = { favorite_name: input.name, normalized_name: normalized, aliases_json: JSON.stringify(aliases), source_meal_id: source?.id ?? null,
      source_idempotency_key: source?.idempotency_key ?? null, ...values };
    const unchanged = existing && Object.entries(desired).every(([column, value]) => existing[column] === value);
    if (authority.expectedRevision !== undefined) {
      const currentRevision = existing ? bigintOf(existing) : 0n;
      if (currentRevision !== authority.expectedRevision) {
        if (existing && unchanged && currentRevision === authority.expectedRevision + 1n) return clone(existing);
        throw new ToolRefusal('Favourite changed. Read the latest revision before saving it.');
      }
    }
    if (existing && unchanged) return clone(existing);
    const at = this.now();
    if (existing) {
      Object.assign(existing, desired, { revision: String(bigintOf(existing) + 1n), updated_at: at });
      this.published('daily.nutrition.favorites');
      return clone(existing);
    }
    const created = { id: favoriteId, ...desired, revision: '1', created_at: at, updated_at: at };
    this.favoriteRows.push(created);
    this.published('daily.nutrition.favorites');
    return clone(created);
  }

  async findFavorite(name: string, signal: AbortSignal): Promise<Row | null> {
    signal.throwIfAborted();
    const normalized = normalizeSearchText(name);
    const matches = this.favoriteRows.filter((row) => favoriteNames(row).includes(normalized));
    if (matches.length > 1) throw new ToolRefusal('The favourite alias is ambiguous.');
    return matches[0] ? clone(matches[0]) : null;
  }

  async lookupSaved(name: string, signal: AbortSignal): Promise<{ source: 'favorite' | 'history'; row: Row } | null> {
    const favorite = favoriteSearchKey(name) === null ? null : await this.findFavorite(name, signal);
    if (favorite) return { source: 'favorite', row: favorite };
    const row = this.meals.filter((candidate) => candidate.deleted_at === null && candidate.meal_name === name)
      .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))[0];
    return row ? { source: 'history', row: clone(row) } : null;
  }

  async favorites(input: { limit: number; afterId?: string }, signal: AbortSignal): Promise<{ rows: Row[]; nextId: string | null }> {
    signal.throwIfAborted();
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100 || Object.keys(input).some((key) => !['limit', 'afterId'].includes(key))) throw new TypeError('Invalid favourite page');
    const rows = [...this.favoriteRows].sort((left, right) => String(left.id).localeCompare(String(right.id))).filter((row) => input.afterId === undefined || String(row.id) > input.afterId);
    const page = rows.slice(0, input.limit).map(clone);
    return { rows: page, nextId: rows.length > input.limit ? page.at(-1)!.id as string : null };
  }

  async favoriteRecords(ids: readonly string[], signal: AbortSignal): Promise<Row[]> {
    signal.throwIfAborted();
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50) throw new TypeError('Invalid favourite keys');
    ids.forEach((id) => text(id));
    return [...new Set(ids)].map((id) => {
      const row = this.favoriteRows.find((candidate) => candidate.id === id);
      if (!row) throw new ToolRefusal('Every saved-food reference must be an owned favourite.');
      return clone(row);
    });
  }

  // ---- Plans ---------------------------------------------------------------------------------------------------------------

  async savePlan(input: PlanRequest, expectedRevision: bigint, signal: AbortSignal, reviewedFavorites?: ReadonlyMap<string, string>): Promise<Row> {
    signal.throwIfAborted();
    input = clone(input);
    if (typeof expectedRevision !== 'bigint' || expectedRevision < 0n || expectedRevision >= 9223372036854775807n) throw new TypeError('Invalid plan revision');
    const normalized = normalizeSearchText(input.name);
    const existing = this.planRows.filter((row) => row.id === input.id || normalizeSearchText(row.normalized_name as string) === normalized || normalizeSearchText(row.plan_name as string) === normalized);
    if (existing.length > 1) throw new ToolRefusal('Plan name conflicts with another existing plan.');
    const row = existing[0];
    const snapshots = [...new Set(input.entries.map((entry) => entry.favoriteId))].sort().map((favoriteId) => {
      const favorite = this.favoriteRows.find((candidate) => candidate.id === favoriteId);
      if (!favorite) throw new ToolRefusal('Every plan slot must reference an owned favourite.');
      if (reviewedFavorites && favoriteFingerprint(favorite) !== reviewedFavorites.get(favoriteId)) throw new ToolRefusal('A reviewed plan favourite changed. Review the plan again.');
      return favorite;
    });
    const { items, ...totals } = preparePlan(input, snapshots);
    const columns = { plan_name: input.name, normalized_name: normalized, description: input.description, items_json: canonicalJson(items), energy_kcal: totals.energyKcal,
      protein_grams: totals.proteinGrams, carbohydrates_grams: totals.carbohydratesGrams, fat_grams: totals.fatGrams, fiber_grams: totals.fiberGrams };
    if (row) {
      if (row.deleted_at !== null) throw new ToolRefusal('Plan unavailable or key conflict.');
      if (bigintOf(row) === expectedRevision + 1n && Object.entries(columns).every(([key, value]) => row[key] === value)) return clone(row);
      if (bigintOf(row) !== expectedRevision) throw new ToolRefusal('Plan changed. Read the latest revision first.');
    } else if (expectedRevision !== 0n) throw new ToolRefusal('Plan not found.');
    const at = this.now();
    if (row) { Object.assign(row, columns, { revision: String(bigintOf(row) + 1n), updated_at: at }); this.published('daily.nutrition.plans'); return clone(row); }
    const created = { id: input.id, ...columns, revision: '1', deleted_at: null, created_at: at, updated_at: at };
    this.planRows.push(created);
    this.published('daily.nutrition.plans');
    return clone(created);
  }

  async plans(input: { limit: number; afterId?: string }, signal: AbortSignal): Promise<{ rows: Row[]; nextId: string | null }> {
    signal.throwIfAborted();
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100 || Object.keys(input).some((key) => !['limit', 'afterId'].includes(key))) throw new TypeError('Invalid plan page');
    const rows = [...this.planRows].sort((left, right) => String(left.id).localeCompare(String(right.id))).filter((row) => input.afterId === undefined || String(row.id) > input.afterId);
    const page = rows.slice(0, input.limit).map(clone);
    return { rows: page, nextId: rows.length > input.limit ? page.at(-1)!.id as string : null };
  }

  async planRecord(id: string, signal: AbortSignal): Promise<Row | null> {
    signal.throwIfAborted();
    text(id);
    const row = this.planRows.find((candidate) => candidate.id === id);
    return row ? clone(row) : null;
  }

  async findPlan(name: string, signal: AbortSignal): Promise<Row | null> {
    signal.throwIfAborted();
    const normalized = normalizeSearchText(name);
    const matches = this.planRows.filter((row) => normalizeSearchText(row.normalized_name as string) === normalized || normalizeSearchText(row.plan_name as string) === normalized);
    if (matches.length > 1) throw new ToolRefusal('Plan name conflicts with another existing plan.');
    return matches[0] ? clone(matches[0]) : null;
  }

  async removePlan(id: string, expectedRevision: bigint, signal: AbortSignal): Promise<Row> {
    signal.throwIfAborted();
    text(id);
    if (typeof expectedRevision !== 'bigint' || expectedRevision < 1n || expectedRevision >= 9223372036854775807n) throw new TypeError('Invalid plan revision');
    const row = this.planRows.find((candidate) => candidate.id === id);
    if (!row) throw new ToolRefusal('Plan not found.');
    if (row.deleted_at !== null && bigintOf(row) === expectedRevision + 1n) return clone(row);
    if (row.deleted_at !== null || bigintOf(row) !== expectedRevision) throw new ToolRefusal('Plan changed. Read the latest revision first.');
    row.deleted_at = this.now(); row.updated_at = row.deleted_at; row.revision = String(expectedRevision + 1n);
    this.published('daily.nutrition.plans');
    return clone(row);
  }
}

/** The owner's three nutrition targets, held in memory with the production parser, so a change is validated and read back the same way. */
export class FakeNutritionTargets implements Pick<NutritionTargetsStore, 'read' | 'write'> {
  private stored: StoredNutritionTargets;

  constructor(initial: NutritionTargetsPatch, private readonly now: () => string = () => new Date().toISOString()) {
    this.stored = { targets: { ...emptyNutritionTargets }, updatedAt: null };
    this.apply(initial);
  }

  private apply(patch: NutritionTargetsPatch) {
    const targets = { ...this.stored.targets };
    for (const field of nutritionTargetFields) if (patch[field] !== undefined) targets[field] = patch[field]!;
    const anySet = nutritionTargetFields.some((field) => targets[field] !== null);
    this.stored = { targets, updatedAt: anySet ? this.now() : null };
  }

  async read(signal: AbortSignal): Promise<StoredNutritionTargets> {
    signal.throwIfAborted();
    return clone(this.stored);
  }

  async write(patch: NutritionTargetsPatch, signal: AbortSignal): Promise<StoredNutritionTargets> {
    signal.throwIfAborted();
    const checked = parseNutritionTargetsPatch(patch);
    if (!checked.ok) throw new TypeError('A nutrition-target change must name valid targets');
    this.apply(checked.patch);
    return clone(this.stored);
  }
}

// ---- The Frida reference service (public DTU food data), as the adapter's `fetch` sees it ------------------------------------

interface StubFood { readonly id: number; readonly da: string; readonly en: string | null; readonly synonyms: readonly string[]; readonly values: readonly [kcal: number, protein: number, carbohydrates: number, fat: number, fiber: number] }

/** Per 100 g, rounded. A few foods Dan logs; the rest of the 1,381-food release is filler the adapter must still count. */
const stubFoods: readonly StubFood[] = [
  { id: 1001, da: 'Banan', en: 'Banana', synonyms: ['banana'], values: [89, 1.1, 22.8, 0.3, 2.6] },
  { id: 1002, da: 'Æg, hønse-, hel', en: 'Egg, whole', synonyms: ['egg', 'eggs', 'æg'], values: [143, 12.6, 0.7, 9.5, 0] },
  { id: 1003, da: 'Toastbrød, hvedebrød', en: 'Toast, white bread', synonyms: ['toast'], values: [265, 9, 49, 3.2, 2.7] },
  { id: 1004, da: 'Havregryn', en: 'Rolled oats', synonyms: ['oats', 'oatmeal'], values: [372, 13.5, 59, 7, 10] },
  { id: 1005, da: 'Sødmælk', en: 'Whole milk', synonyms: ['milk', 'mælk'], values: [64, 3.4, 4.7, 3.5, 0] },
  { id: 1006, da: 'Skyr, naturel', en: 'Skyr, plain', synonyms: ['skyr'], values: [63, 11, 4, 0.2, 0] },
  { id: 1007, da: 'Kyllingebryst, kogt', en: 'Chicken breast, cooked', synonyms: ['chicken breast', 'kyllingebryst'], values: [165, 31, 0, 3.6, 0] },
];
const releaseSize = 1381;
const parameterIds = [356, 218, 172, 141, 168] as const;
const parameterUnits = ['kcal', 'g', 'g', 'g', 'g'] as const;

function catalogue() {
  const filler = Array.from({ length: releaseSize - stubFoods.length }, (_, index) => ({ id: 2001 + index, nameDanish: `Fyldmad ${String(index + 1).padStart(4, '0')}`, nameEnglish: null }));
  return [
    ...stubFoods.map((food) => ({ releaseId: 10, id: food.id, nameDanish: food.da, nameEnglish: food.en, danishSynonyms: [], englishSynonyms: [...food.synonyms],
      descriptionDanish: null, descriptionEnglish: null })),
    ...filler.map((food) => ({ releaseId: 10, ...food, danishSynonyms: [], englishSynonyms: [], descriptionDanish: null, descriptionEnglish: null })),
  ];
}

const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });

/**
 * The service behind the real `FridaLookupAdapter`: the anti-forgery bootstrap, the pinned release catalogue and the nutrient
 * parameters of one food. While `frida` is in `context.down` the network fails, as it does without a connection.
 */
export function fridaStubFetch(context: ConformanceContext): typeof fetch {
  const foods = catalogue();
  return (async (input: Parameters<typeof fetch>[0]) => {
    if (context.down.has('frida')) throw new TypeError('fetch failed');
    const path = new URL(String(input)).pathname.replace(/^\/api/u, '');
    if (path === '/antiforgery') {
      const headers = new Headers({ 'X-XSRF-TOKEN': 'conformance-token' });
      headers.append('set-cookie', 'XSRF-TOKEN=conformance-cookie; path=/; samesite=strict');
      return new Response(null, { status: 200, headers });
    }
    if (path === '/food/10') return json(foods);
    const parameters = /^\/foodParameter\/10\/(\d+)\/consumer$/u.exec(path);
    if (parameters) {
      const foodId = Number(parameters[1]);
      const food = stubFoods.find((candidate) => candidate.id === foodId);
      return json([{ foodId, releaseId: 10, foodParameters: parameterIds.map((id, index) => ({
        id, foodId, releaseId: 10, unitName: parameterUnits[index], value: food?.values[index] ?? 0, sourceIds: [11], sourceFoodIds: [21],
      })) }]);
    }
    return new Response('Not found', { status: 404 });
  }) as typeof fetch;
}

