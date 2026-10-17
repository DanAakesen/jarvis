import { ToolRefusal } from '../../core/tool-registry.js';

export interface Nutrients {
  energyKcal: number;
  proteinGrams: number | null;
  carbohydratesGrams: number | null;
  fatGrams: number | null;
  fiberGrams: number | null;
}
/** Deterministic JSON identity, with bounded depth and no silent undefined/NaN loss. */
export function canonicalJson(value: unknown): string {
  let nodes = 0;
  const visit = (item: unknown, depth: number): unknown => {
    if (++nodes > 10000 || depth > 16) throw new TypeError('Nutrition JSON exceeds limits');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map((child) => visit(child, depth + 1));
    if (typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype) {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, visit((item as Record<string, unknown>)[key], depth + 1)]));
    }
    throw new TypeError('Invalid nutrition JSON');
  };
  return JSON.stringify(visit(value, 0));
}
/** Explicit quantities (including an explicit unknown) outrank estimated values. */
export function resolveNutrients(exact: Partial<Nutrients>, estimate: Nutrients | null): { values: Nutrients; confidence: 'accurate' | 'estimate'; provenance: Record<string, { source: 'user-exact' | 'estimate' | 'unknown'; unit: 'kcal' | 'g' }> } {
  const keys = ['energyKcal', 'proteinGrams', 'carbohydratesGrams', 'fatGrams', 'fiberGrams'] as const;
  if (!exact || Object.keys(exact).some((key) => !(keys as readonly string[]).includes(key))) throw new TypeError('Invalid exact nutrient fields');
  if (estimate) nutrients(estimate);
  const values = {} as Nutrients;
  const provenance: Record<string, { source: 'user-exact' | 'estimate' | 'unknown'; unit: 'kcal' | 'g' }> = {};
  let estimated = false;
  for (const key of keys) {
    const provided = Object.hasOwn(exact, key);
    const value = provided ? exact[key] : estimate?.[key] ?? null;
    if (provided && value === undefined) throw new TypeError('Invalid exact nutrient quantity');
    if (key === 'energyKcal' && value === null) throw new ToolRefusal('A calorie quantity or accepted estimate is required.');
    (values as unknown as Record<string, unknown>)[key] = value;
    const source = provided ? 'user-exact' : value === null ? 'unknown' : 'estimate';
    estimated ||= source === 'estimate';
    provenance[key] = { source, unit: key === 'energyKcal' ? 'kcal' : 'g' };
  }
  nutrients(values);
  return { values, provenance, confidence: estimated ? 'estimate' : 'accurate' };
}
export interface MealInput extends Nutrients {
  id: string;
  idempotencyKey: string;
  mealName: string;
  mealType: string | null;
  components: readonly unknown[];
  occurredAt: string;
  mealDate: string;
  expiresAt: string;
  captureMethod: 'text' | 'voice' | 'photo' | 'mixed';
  confidence: 'accurate' | 'approximate' | 'estimate';
  provenance: Readonly<Record<string, unknown>>;
}
export interface FoodDefinition extends Nutrients {
  mealName: string; mealType: string | null; components: readonly unknown[];
  confidence: MealInput['confidence']; provenance: Readonly<Record<string, unknown>>;
}
export function foodDefinition(input: FoodDefinition): void {
  text(input.mealName, 2000); if (input.mealType !== null) text(input.mealType);
  if (!['accurate','approximate','estimate'].includes(input.confidence) || !Array.isArray(input.components) || input.components.length > 100 ||
      !input.provenance || Array.isArray(input.provenance) || typeof input.provenance !== 'object' || canonicalJson(input.components).length > 32000 || canonicalJson(input.provenance).length > 16000) throw new TypeError('Invalid food definition');
  nutrients(input);
}
/** Valid history names need not fit the smaller favourite search-key domain. */
export function favoriteSearchKey(value: string): string | null {
  text(value, 2000);
  if (value.length > 256) return null;
  const normalized = value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/gu, ' ').trim();
  return normalized.length > 0 && normalized.length <= 256 ? normalized : null;
}
/** Source-compatible search keys; display names/aliases and stable IDs stay untouched. */
export function normalizeSearchText(value: string): string {
  text(value);
  const normalized = favoriteSearchKey(value);
  if (normalized === null) throw new TypeError('Invalid nutrition text');
  return normalized;
}
/** New writes only: imported history is readable without retroactive validation. */
export function writeDefinition(input: FoodDefinition): void {
  foodDefinition(input);
  if (input.mealType !== null && !['breakfast', 'lunch', 'dinner', 'snack', 'other'].includes(input.mealType)) throw new TypeError('Invalid meal type');
  for (const key of ['energyKcal', 'proteinGrams', 'carbohydratesGrams', 'fatGrams', 'fiberGrams'] as const) {
    if (input[key] !== null && input[key]! > (key === 'energyKcal' ? 10000 : 1000)) throw new TypeError('Meal nutrient exceeds limits');
  }
}
export function writeMeal(input: MealInput, requestTime: string): void {
  meal(input); writeDefinition(input); instant(requestTime);
  if (Date.parse(input.occurredAt) > Date.parse(requestTime) + 5 * 60_000) throw new TypeError('Meal occurrence exceeds trusted time');
  if (input.mealDate !== copenhagenDate(input.occurredAt)) throw new TypeError('Meal date disagrees with Copenhagen occurrence');
}
export interface FavoriteInput {
  id: string; name: string; aliases: readonly string[];
  sourceIdempotencyKey?: string; definition?: FoodDefinition;
}
export interface FavoriteAuthority {
  explicit: boolean; estimateAccepted: boolean;
  expectedRevision?: bigint; sourceRevision?: bigint;
}
export interface PlanRequest {
  id: string; name: string; description: string | null;
  entries: readonly { slot: 'breakfast' | 'lunch' | 'dinner' | 'snack'; favoriteId: string }[];
}
export function preparePlan(input: PlanRequest, favorites: readonly Record<string, unknown>[]): PlanInput {
  if (!input || Object.keys(input).some(key => !['id', 'name', 'description', 'entries'].includes(key)) ||
      !Array.isArray(input.entries) || input.entries.length < 3 || input.entries.length > 50) throw new TypeError('Invalid plan definition');
  text(input.id); text(input.name); if (input.description !== null) text(input.description, 4000);
  for (const entry of input.entries) {
    if (Object.keys(entry).some(key => !['slot', 'favoriteId'].includes(key)) ||
        !['breakfast', 'lunch', 'dinner', 'snack'].includes(entry.slot)) throw new TypeError('Invalid plan slot');
    text(entry.favoriteId);
  }
  for (const slot of ['breakfast', 'lunch', 'dinner']) {
    if (input.entries.filter(entry => entry.slot === slot).length !== 1) throw new TypeError('Plan requires one breakfast, lunch and dinner');
  }
  const items = input.entries.map(entry => {
    const favorite = favorites.find(row => row.id === entry.favoriteId);
    if (!favorite) throw new ToolRefusal('Every plan slot must reference an owned favourite.');
    const values: Nutrients = {
      energyKcal: favorite.energy_kcal as number, proteinGrams: favorite.protein_grams as number | null,
      carbohydratesGrams: favorite.carbohydrates_grams as number | null, fatGrams: favorite.fat_grams as number | null,
      fiberGrams: favorite.fiber_grams as number | null,
    };
    nutrients(values);
    return { mealKey: entry.favoriteId, name: favorite.meal_name as string, nutrients: values,
      slot: entry.slot, favoriteId: entry.favoriteId, components: JSON.parse(favorite.components_json as string),
      provenance: JSON.parse(favorite.nutrient_provenance_json as string) };
  });
  const sum = (key: keyof Nutrients): number | null => items.some(item => item.nutrients[key] === null)
    ? null : items.reduce((total, item) => total + item.nutrients[key]!, 0);
  const result = { id: input.id, name: input.name, description: input.description, items,
    energyKcal: sum('energyKcal')!, proteinGrams: sum('proteinGrams'), carbohydratesGrams: sum('carbohydratesGrams'),
    fatGrams: sum('fatGrams'), fiberGrams: sum('fiberGrams') };
  plan(result);
  return result;
}
/** Occurrence defaults use trusted request time, not a model-selected clock/owner. */
export function copenhagenDate(occurredAt: string): string {
  instant(occurredAt);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(occurredAt));
  const part = (name: string) => parts.find((part) => part.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function prepareMeal(input: Omit<MealInput, 'occurredAt' | 'mealDate' | 'expiresAt' | 'proteinGrams' | 'carbohydratesGrams' | 'fatGrams' | 'fiberGrams'> & Partial<Pick<Nutrients,'proteinGrams'|'carbohydratesGrams'|'fatGrams'|'fiberGrams'>> & { occurredAt?: string; mealDate?: string }, requestTime: string): MealInput {
  if (Object.hasOwn(input, 'expiresAt')) throw new TypeError('Meal lifetime is not caller-selected');
  instant(requestTime); const occurredAt = input.occurredAt ?? requestTime; instant(occurredAt);
  const result = { ...input, proteinGrams: input.proteinGrams ?? null, carbohydratesGrams: input.carbohydratesGrams ?? null,
    fatGrams: input.fatGrams ?? null, fiberGrams: input.fiberGrams ?? null, occurredAt, mealDate: input.mealDate ?? copenhagenDate(occurredAt),
    // Existing non-null source column is retained as metadata. Meals have no expiry cleanup.
    expiresAt: '9999-12-31T23:59:59Z' };
  writeMeal(result, requestTime); return result;
}
/** Supplied by the existing trusted evidence/confirmation boundary, not tool arguments. */
export interface IntakeAuthority {
  intent: 'log-intake' | 'lookup' | 'recommendation' | 'plan';
  explicit: boolean;
  estimateAccepted: boolean;
  proposalRequired: boolean;
  favorite?: { readonly id: string; readonly fingerprint: string };
}
export function text(value: unknown, max = 256): asserts value is string {
  if (typeof value !== 'string' || !value.length || value.length > max || Buffer.from(value, 'utf8').toString('utf8') !== value) throw new TypeError('Invalid nutrition text');
}
export function date(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value) || value.startsWith('0000-') ||
      !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new TypeError('Invalid nutrition date');
  }
}
export function instant(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 64 || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.test(value) ||
      !Number.isFinite(Date.parse(value))) throw new TypeError('Invalid nutrition timestamp');
  date(value.slice(0, 10));
}
export function nutrients(value: Nutrients): void {
  for (const key of ['energyKcal', 'proteinGrams', 'carbohydratesGrams', 'fatGrams', 'fiberGrams'] as const) {
    const n = value[key];
    if (n === null && key !== 'energyKcal') continue;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) throw new TypeError('Invalid nutrient quantity');
  }
}
export function meal(input: MealInput): void {
  const allowed = ['id', 'idempotencyKey', 'mealName', 'mealType', 'components', 'occurredAt', 'mealDate', 'expiresAt', 'captureMethod', 'confidence', 'provenance', 'energyKcal', 'proteinGrams', 'carbohydratesGrams', 'fatGrams', 'fiberGrams'];
  if (!input || typeof input !== 'object' || Object.keys(input).some((key) => !allowed.includes(key))) throw new TypeError('Invalid meal fields');
  text(input.id); text(input.idempotencyKey); foodDefinition(input);
  date(input.mealDate); instant(input.occurredAt); instant(input.expiresAt);
  if (!['text', 'voice', 'photo', 'mixed'].includes(input.captureMethod) || !['accurate', 'approximate', 'estimate'].includes(input.confidence)) throw new TypeError('Invalid meal evidence');
}
export function authorizeIntake(input: MealInput, authority: IntakeAuthority): void {
  if (authority.intent !== 'log-intake' || authority.explicit !== true || typeof authority.proposalRequired !== 'boolean' ||
      (authority.proposalRequired || input.confidence !== 'accurate') && authority.estimateAccepted !== true) {
    throw new ToolRefusal('Confirm this estimated intake before logging it. Suggestions and plans are not eaten food.');
  }
}

export interface Suggestion extends Nutrients { mealKey: string; name: string; localTimeWindows: readonly { from: string; to: string }[] }
export interface BudgetContext { now: string; localTime: string; remainingKcal: number | null; remainingProteinGrams: number | null }
export interface PlanInput extends Nutrients {
  id: string; name: string; description: string | null;
  items: readonly { mealKey: string; name: string; nutrients: Nutrients }[];
}
export function plan(input: PlanInput): void {
  if (!input || Object.keys(input).some((key) => !['id', 'name', 'description', 'items', 'energyKcal', 'proteinGrams', 'carbohydratesGrams', 'fatGrams', 'fiberGrams'].includes(key))) throw new TypeError('Invalid plan');
  text(input.id); text(input.name); if (input.description !== null) text(input.description, 4000);
  nutrients(input);
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100 || canonicalJson(input.items).length > 64000) throw new TypeError('Invalid plan items');
  for (const item of input.items) { text(item.mealKey); text(item.name, 2000); nutrients(item.nutrients); }
  // Totals must come from supplied quantities. An unknown component keeps its total unknown.
  for (const key of ['energyKcal', 'proteinGrams', 'carbohydratesGrams', 'fatGrams', 'fiberGrams'] as const) {
    const values = input.items.map((item) => item.nutrients[key]);
    const total = values.some((value) => value === null) ? null : values.reduce<number>((sum, value) => sum + value!, 0);
    if (total === null ? input[key] !== null : !Number.isFinite(total) || input[key] === null || Math.abs(input[key]! - total) > 1e-8 * Math.max(1, total)) throw new TypeError('Plan totals disagree with provided quantities');
  }
}
/** Caller supplies the authoritative remaining budget and local clock; no maintenance calculation. */
export function suggest(candidates: readonly Suggestion[], disliked: ReadonlySet<string>, context: BudgetContext): Suggestion[] {
  instant(context.now);
  const clock = /^([01]\d|2[0-3]):([0-5]\d)$/u;
  if (!clock.test(context.localTime) || candidates.length > 1000) throw new TypeError('Invalid suggestion context');
  const authoritativeClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(context.now));
  if (context.localTime !== authoritativeClock) throw new TypeError('Suggestion clock disagrees with authoritative time');
  for (const value of [context.remainingKcal, context.remainingProteinGrams]) if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) throw new TypeError('Invalid remaining budget');
  return candidates.filter((candidate) => {
    text(candidate.mealKey); nutrients(candidate);
    if (disliked.has(candidate.mealKey)) return false;
    if (context.remainingKcal !== null && candidate.energyKcal > context.remainingKcal) return false;
    if (candidate.localTimeWindows.length > 24) throw new TypeError('Invalid meal time windows');
    return candidate.localTimeWindows.length === 0 || candidate.localTimeWindows.some(({ from, to }) => {
      if (!clock.test(from) || !clock.test(to)) throw new TypeError('Invalid meal time window');
      return from <= to ? context.localTime >= from && context.localTime < to : context.localTime >= from || context.localTime < to;
    });
  }).sort((a, b) => {
    if (context.remainingProteinGrams === null) return 0;
    const gap = (x: Suggestion) => x.proteinGrams === null ? Infinity : Math.abs(context.remainingProteinGrams! - x.proteinGrams);
    return gap(a) - gap(b);
  });
}
