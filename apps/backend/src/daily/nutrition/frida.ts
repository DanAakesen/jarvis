import { setTimeout as delay } from 'node:timers/promises';
import { ToolFailure } from '../../core/tool-registry.js';
import { text, type Nutrients } from './model.js';

export const fridaReference = Object.freeze({ provider: 'DTU Frida', version: '5.5', releaseId: 10,
  release: 'November 2025', datasetVersion: 8, datasetPublished: '2026-01-19',
  doi: 'https://doi.org/10.11583/DTU.29500682', license: 'CC BY 4.0 (XLSX/ODS data)',
  attribution: 'DTU National Food Institute, Frida 5.5, release 10; https://doi.org/10.11583/DTU.29500682', basis: '100 g edible food' });
const origin = 'https://fcdb.fooddata.dk/api';
const parameters = { energyKcal: [356, 'kcal'], proteinGrams: [218, 'g'], carbohydratesGrams: [172, 'g'], fatGrams: [141, 'g'], fiberGrams: [168, 'g'] } as const;
type Parameter = keyof typeof parameters;
interface Food { releaseId: number; id: number; nameDanish: string; nameEnglish: string | null; danishSynonyms: string[]; englishSynonyms: string[] }
export interface LookupComponent { name: string; grams: number | null; preparationMethod: string | null }
export interface FridaMatch {
  foodId: number; name: string; grams: number; values: Partial<Record<keyof Nutrients, number | null>>;
  provenance: Partial<Record<Parameter, { parameterId: number; unit: string; sourceIds: readonly number[] | null; sourceFoodIds: readonly number[] | null }>>;
  retrievedAt: string;
}
export interface FridaLookup {
  status: 'complete' | 'partial'; confirmationRequired: true; reference: typeof fridaReference;
  components: { input: LookupComponent; match: FridaMatch | null; candidates: { foodId: number; name: string }[]; unknowns: string[] }[];
  totals: Record<Parameter, number | null>; matchedSubtotals: Record<Parameter, number | null>;
  unknowns: string[];
}
function normalize(value: string): string {
  return value.toLowerCase().replaceAll('æ', 'ae').replaceAll('ø', 'oe').replaceAll('å', 'aa')
    .normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/gu, ' ').trim();
}
function names(food: Food): string[] {
  const synonyms = [...food.danishSynonyms, ...food.englishSynonyms];
  return [food.nameDanish, food.nameEnglish ?? '', ...synonyms].filter(Boolean).map(normalize);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid public food response');
  return value as Record<string, unknown>;
}
function id(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new TypeError('Invalid public food identifier');
}
function synonyms(value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some((item) => typeof item !== 'string' || item.length > 2000)) throw new TypeError('Invalid public food synonyms');
}
/** Verified release pin and DTO mapping; never accepts a caller URL or credentials. */
export class FridaLookupAdapter {
  private session: { token: string; cookie: string; until: number } | null = null;
  private catalogue: { rows: Food[]; until: number } | null = null;
  private readonly cache = new Map<number, { values: FridaMatch['values']; provenance: FridaMatch['provenance']; retrievedAt: string; until: number }>();
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly now: () => number = Date.now) {}

  private async response(path: string, signal: AbortSignal, headers: Record<string, string> = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      const response = await this.fetcher(`${origin}${path}`, { method: 'GET', redirect: 'error', headers, signal });
      if (response.ok) return response;
      await response.body?.cancel();
      if ([429, 502, 503, 504].includes(response.status) && attempt < 2) { await delay(100 * (attempt + 1), undefined, { signal }); continue; }
      throw new Error('Public food provider unavailable');
    }
  }
  private async json(response: Response, signal: AbortSignal): Promise<unknown> {
    const declared = response.headers.get('content-length');
    if (declared && (!/^\d+$/u.test(declared) || Number(declared) > 8 * 1024 * 1024)) { await response.body?.cancel(); throw new TypeError('Public food response exceeds limits'); }
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json') || !response.body) { await response.body?.cancel(); throw new TypeError('Invalid public food content type'); }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { signal.throwIfAborted(); const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
        if (size > 8 * 1024 * 1024) throw new TypeError('Public food response exceeds limits'); chunks.push(part.value); }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
  private async get(path: string, signal: AbortSignal): Promise<unknown> {
    if (!this.session || this.session.until <= this.now()) {
      const response = await this.response('/antiforgery', signal);
      // Verified public bootstrap is empty, with response header and XSRF-TOKEN cookie.
      const token = response.headers.get('X-XSRF-TOKEN');
      const cookies = response.headers.getSetCookie();
      const reader = response.body?.getReader();
      try {
        if (reader) {
          for (let chunks = 0; ; chunks++) { signal.throwIfAborted(); const part = await reader.read(); if (part.done) break;
            if (part.value.byteLength || chunks >= 2) throw new TypeError('Unexpected public food bootstrap body'); }
        }
      } finally { if (reader) { await reader.cancel().catch(() => undefined); reader.releaseLock(); } }
      if (!token || token.length > 4096 || /[\r\n]/u.test(token) || !cookies.length || cookies.length > 6) throw new TypeError('Public food session contract mismatch');
      const cookie = cookies.map((value) => value.split(';', 1)[0]!).join('; ');
      if (cookie.length > 16000 || /[\r\n]/u.test(cookie) || !cookies.some((value) => value.startsWith('XSRF-TOKEN=')) ||
          !cookies.every((value) => /^[^\s;=]+=[^;]*(?:;|$)/u.test(value))) throw new TypeError('Invalid public food session cookie');
      this.session = { token, cookie, until: this.now() + 10 * 60_000 };
    }
    return this.json(await this.response(path, signal, { 'X-XSRF-TOKEN': this.session.token, Cookie: this.session.cookie }), signal);
  }
  private async foods(signal: AbortSignal): Promise<Food[]> {
    if (this.catalogue && this.catalogue.until > this.now()) return this.catalogue.rows;
    const value = await this.get('/food/10', signal);
    // Coordinator verified this immutable release catalogue count; reject silent truncation.
    if (!Array.isArray(value) || value.length !== 1381) throw new TypeError('Pinned Frida catalogue is incomplete');
    const ids = new Set<number>();
    const rows = value.map((item) => {
      const row = object(item); id(row.id); if (row.releaseId !== 10 || ids.has(row.id)) throw new TypeError('Pinned food release or ID mismatch'); ids.add(row.id);
      text(row.nameDanish, 2000); if (row.nameEnglish !== null && (typeof row.nameEnglish !== 'string' || row.nameEnglish.length > 2000)) throw new TypeError('Invalid food name');
      synonyms(row.danishSynonyms); synonyms(row.englishSynonyms);
      for (const key of ['descriptionDanish', 'descriptionEnglish']) if (row[key] !== null && (typeof row[key] !== 'string' || (row[key] as string).length > 16000)) throw new TypeError('Invalid food description');
      return row as unknown as Food;
    });
    this.catalogue = { rows, until: this.now() + 10 * 60_000 }; return rows;
  }
  private async foodValues(foodId: number, signal: AbortSignal) {
    const cached = this.cache.get(foodId); if (cached && cached.until > this.now()) return cached;
    const groups = await this.get(`/foodParameter/10/${foodId}/consumer`, signal);
    if (!Array.isArray(groups) || groups.length > 100) throw new TypeError('Invalid food parameter groups');
    const entries = groups.flatMap((group) => { const row = object(group);
      if (row.foodId !== foodId || row.releaseId !== 10) throw new TypeError('Food parameter group identity mismatch');
      const items = row.foodParameters; if (!Array.isArray(items) || items.length > 1000) throw new TypeError('Invalid food parameters'); return items; });
    if (entries.length > 5000) throw new TypeError('Food parameters exceed limits');
    const result: { values: FridaMatch['values']; provenance: FridaMatch['provenance']; retrievedAt: string; until: number } = { values: {}, provenance: {}, retrievedAt: new Date(this.now()).toISOString(), until: this.now() + 10 * 60_000 };
    const seen = new Set<number>();
    for (const item of entries) {
      const row = object(item); id(row.id); if (seen.has(row.id)) throw new TypeError('Duplicate food parameter'); seen.add(row.id);
      const key = (Object.keys(parameters) as Parameter[]).find((key) => parameters[key][0] === row.id); if (!key) continue;
      if (row.foodId !== foodId || row.releaseId !== 10) throw new TypeError('Food parameter identity mismatch');
      if (row.unitName !== parameters[key][1] || row.value !== null && row.value !== undefined && (typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value < 0)) throw new TypeError('Invalid nutrient value or unit');
      const sources = (value: unknown) => { if (value === null || value === undefined) return null;
        if (!Array.isArray(value) || value.length > 1000 || value.some((value) => typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)) throw new TypeError('Invalid nutrient provenance'); return value as number[]; };
      result.values[key] = row.value === undefined || row.value === null ? null : row.value as number;
      result.provenance[key] = { parameterId: row.id, unit: row.unitName as string, sourceIds: sources(row.sourceIds), sourceFoodIds: sources(row.sourceFoodIds) };
    }
    if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(foodId, result); return result;
  }
  async lookup(input: readonly LookupComponent[], signal: AbortSignal): Promise<FridaLookup> {
    if (!Array.isArray(input) || input.length < 1 || input.length > 25) throw new TypeError('Invalid food components');
    for (const component of input) {
      if (!component || Object.keys(component).some((key) => !['name', 'grams', 'preparationMethod'].includes(key))) throw new TypeError('Invalid food component fields');
      text(component.name, 120); if (component.preparationMethod !== null) text(component.preparationMethod, 120);
      if (component.grams !== null && (typeof component.grams !== 'number' || !Number.isFinite(component.grams) || component.grams <= 0 || component.grams > 5000)) throw new TypeError('Invalid food amount');
    }
    input = structuredClone(input); const deadline = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
    try {
      const foods = await this.foods(deadline); const components: FridaLookup['components'] = [];
      for (const component of input) {
        const query = normalize(component.name); if (!query) throw new TypeError('Invalid food search');
        const ranked = foods.map((food) => ({ food, score: Math.max(...names(food).map((name) => name === query ? 1 :
          (() => { const a = new Set(query.split(' ')); const b = new Set(name.split(' ')); const overlap = [...a].filter((token) => b.has(token)).length; return overlap / Math.max(a.size, b.size); })())) }))
          .filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.food.id - b.food.id);
        const exact = ranked.filter((item) => item.score === 1);
        const chosen = exact.length === 1 ? exact[0] : exact.length === 0 && ranked[0] && ranked[0].score >= 0.8 && ranked[0].score - (ranked[1]?.score ?? 0) >= 0.2 ? ranked[0] : null;
        const unknowns: string[] = []; let match: FridaMatch | null = null;
        if (!chosen) unknowns.push(ranked.length ? 'ambiguous_match' : 'no_match');
        if (component.grams === null) unknowns.push('amount_missing');
        // Preparation is disclosed, never treated as a guessed yield factor.
        if (chosen && component.grams !== null) {
          const data = await this.foodValues(chosen.food.id, deadline); const values: FridaMatch['values'] = {};
          for (const key of Object.keys(parameters) as Parameter[]) {
            const value = data.values[key]; values[key] = value === undefined || value === null ? null : value * (component.grams / 100);
            if (values[key] !== null && !Number.isFinite(values[key])) throw new TypeError('Scaled food quantity exceeds finite limits');
            if (values[key] === null) unknowns.push(`nutrient_missing:${key}`);
            const provenance = data.provenance[key];
            if (!provenance || provenance.sourceIds === null || provenance.sourceFoodIds === null) unknowns.push(`provenance_unavailable:${key}`);
          }
          match = { foodId: chosen.food.id, name: chosen.food.nameDanish, grams: component.grams, values, provenance: structuredClone(data.provenance), retrievedAt: data.retrievedAt };
          if (component.preparationMethod && !names(chosen.food).some((name) => name.includes(normalize(component.preparationMethod!)))) unknowns.push('preparation_unverified');
        }
        components.push({ input: component, match, candidates: ranked.slice(0, 3).map(({ food }) => ({ foodId: food.id, name: food.nameDanish })), unknowns });
      }
      const totals = {} as FridaLookup['totals']; const matchedSubtotals = {} as FridaLookup['totals'];
      for (const key of Object.keys(parameters) as Parameter[]) {
        const known = components.flatMap((component) => { const value = component.match?.values[key]; return typeof value === 'number' ? [value] : []; });
        matchedSubtotals[key] = known.length ? known.reduce((a, b) => a + b, 0) : null;
        if (matchedSubtotals[key] !== null && !Number.isFinite(matchedSubtotals[key])) throw new TypeError('Food total exceeds finite limits');
        totals[key] = known.length === components.length ? matchedSubtotals[key] : null;
      }
      const unknowns = components.flatMap((component, index) => component.unknowns.map((unknown) => `${index}:${unknown}`));
      return { status: unknowns.length ? 'partial' : 'complete', confirmationRequired: true, reference: fridaReference, components, totals, matchedSubtotals, unknowns };
    } catch {
      if (signal.aborted) throw signal.reason;
      this.session = null;
      throw new ToolFailure('Pinned Frida reference lookup is unavailable or invalid. No complete nutrient estimate is claimed.');
    }
  }
}
