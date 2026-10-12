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
export function resolveNutrients(exact: Partial<Nutrients>, estimate: Nutrients | null): { values: Nutrients; confidence: 'exact' | 'estimate'; provenance: Record<string, { source: 'user-exact' | 'estimate' | 'unknown'; unit: 'kcal' | 'g' }> } {
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
  return { values, provenance, confidence: estimated ? 'estimate' : 'exact' };
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
  captureMethod: 'text' | 'voice' | 'photo';
  confidence: 'exact' | 'estimate';
  provenance: Readonly<Record<string, unknown>>;
}
/** Supplied by the existing trusted evidence/confirmation boundary, not tool arguments. */
export interface IntakeAuthority {
  intent: 'log-intake' | 'lookup' | 'recommendation' | 'plan';
  explicit: boolean;
  estimateAccepted: boolean;
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
  text(input.id); text(input.idempotencyKey); text(input.mealName, 2000);
  if (input.mealType !== null) text(input.mealType);
  date(input.mealDate); instant(input.occurredAt); instant(input.expiresAt);
  if (!['text', 'voice', 'photo'].includes(input.captureMethod) || !['exact', 'estimate'].includes(input.confidence)) throw new TypeError('Invalid meal evidence');
  if (!Array.isArray(input.components) || input.components.length > 100 || !input.provenance || Array.isArray(input.provenance) || typeof input.provenance !== 'object' ||
      canonicalJson(input.components).length > 32000 || canonicalJson(input.provenance).length > 16000) throw new TypeError('Invalid meal provenance');
  nutrients(input);
}
export function authorizeIntake(input: MealInput, authority: IntakeAuthority): void {
  if (authority.intent !== 'log-intake' || !authority.explicit || input.confidence === 'estimate' && !authority.estimateAccepted) {
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
  for (const value of [context.remainingKcal, context.remainingProteinGrams]) if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new TypeError('Invalid remaining budget');
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
