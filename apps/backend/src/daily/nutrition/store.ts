import sql from 'mssql';
import type { FastifyRequest } from 'fastify';
import { setTimeout as delay } from 'node:timers/promises';
import { resolveDailyOwner } from '../owner.js';
import { ToolFailure, ToolRefusal } from '../../core/tool-registry.js';
import { authorizeIntake, canonicalJson, date, foodDefinition, instant, meal, nutrients, plan, suggest, text, type BudgetContext, type FavoriteAuthority, type FavoriteInput, type IntakeAuthority, type MealInput, type PlanInput, type PlanRequest, type Suggestion } from './model.js';

const fields = {
  id: ['id', sql.NVarChar(256)], idempotencyKey: ['idempotency_key', sql.NVarChar(256)],
  mealName: ['meal_name', sql.NVarChar(sql.MAX)], mealType: ['meal_type', sql.NVarChar(256)],
  occurredAt: ['occurred_at', sql.NVarChar(64)], mealDate: ['meal_date', sql.Date], expiresAt: ['expires_at', sql.NVarChar(64)],
  energyKcal: ['energy_kcal', sql.Float], proteinGrams: ['protein_grams', sql.Float], carbohydratesGrams: ['carbohydrates_grams', sql.Float],
  fatGrams: ['fat_grams', sql.Float], fiberGrams: ['fiber_grams', sql.Float], confidence: ['confidence', sql.NVarChar(256)],
  captureMethod: ['capture_method', sql.NVarChar(256)], components: ['components_json', sql.NVarChar(sql.MAX)], provenance: ['nutrient_provenance_json', sql.NVarChar(sql.MAX)],
} as const;
const select = Object.values(fields).map(([column]) => `[${column}]`).join(', ') + ', source, revision, deleted_at, created_at, updated_at';
const equalKey = (column: string, param: string) => `[${column}]=@${param} AND DATALENGTH([${column}])=DATALENGTH(@${param})`;
function bind(request: sql.Request, input: MealInput): sql.Request {
  for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
    const [, type] = fields[key];
    const value = key === 'components' || key === 'provenance' ? canonicalJson(input[key]) : key === 'mealDate' ? new Date(`${input.mealDate}T00:00:00Z`) : input[key];
    request.input(key, type, value);
  }
  return request;
}
function same(row: Record<string, unknown>, input: MealInput): boolean {
  return Object.entries(fields).every(([key, [column]]) => {
    const value = input[key as keyof MealInput];
    if (key === 'mealDate') return row[column] instanceof Date && (row[column] as Date).toISOString().slice(0, 10) === value;
    if (key === 'components' || key === 'provenance') return canonicalJson(JSON.parse(row[column] as string)) === canonicalJson(value);
    return row[column] === value;
  });
}
export interface HistoryPage { rows: Record<string, unknown>[]; next: { createdAt: string; id: string } | null }

/** No production registration. Construct only after existing Jarvis authentication. */
export class NutritionStore {
  private constructor(private readonly pool: sql.ConnectionPool, private readonly owner: string, private readonly now: () => string) {}
  static forRequest(pool: sql.ConnectionPool, request: FastifyRequest, now = () => new Date().toISOString()): NutritionStore {
    return new NutritionStore(pool, resolveDailyOwner(request), now);
  }
  private request(parent: sql.Transaction | sql.ConnectionPool, signal: AbortSignal): sql.Request {
    signal.throwIfAborted();
    return (parent instanceof sql.Transaction ? new sql.Request(parent) : new sql.Request(parent)).input('owner', sql.UniqueIdentifier, this.owner);
  }
  private async query(request: sql.Request, query: string, signal: AbortSignal) {
    const cancel = () => request.cancel();
    signal.addEventListener('abort', cancel, { once: true });
    try { signal.throwIfAborted(); return await request.query<Record<string, unknown>>(query); }
    finally { signal.removeEventListener('abort', cancel); }
  }
  private async read(request: sql.Request, query: string, signal: AbortSignal) {
    try { return await this.query(request, query, signal); }
    catch {
      if (signal.aborted) throw signal.reason;
      throw new ToolFailure('Nutrition read failed. No record content or provider diagnostics are exposed.');
    }
  }
  private async transaction<T>(signal: AbortSignal, action: (transaction: sql.Transaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      const transaction = new sql.Transaction(this.pool);
      try {
        await transaction.begin();
        const result = await action(transaction);
        signal.throwIfAborted();
        await transaction.commit();
        return result;
      } catch (error) {
        await transaction.rollback().catch(() => undefined);
        if (signal.aborted) throw signal.reason;
        if ((error as { number?: number }).number === 1205 && attempt < 2) { await delay(20 * (attempt + 1), undefined, { signal }); continue; }
        if (error instanceof ToolRefusal) throw error;
        if ([2601, 2627, 51001].includes((error as { number?: number }).number ?? 0)) throw new ToolRefusal('This nutrition key conflicts with an existing exact key.');
        throw new ToolFailure('Nutrition persistence failed. Retry with the same operation key; no successful write is claimed.');
      }
    }
  }
  async log(input: MealInput, authority: IntakeAuthority, signal: AbortSignal): Promise<Record<string, unknown>> {
    meal(input); input = structuredClone(input); authorizeIntake(input, authority);
    return this.transaction(signal, async (transaction) => {
      const lookup = this.request(transaction, signal).input('key', sql.NVarChar(256), input.idempotencyKey);
      const existing = (await this.query(lookup, `SELECT ${select} FROM daily.nutrition_meals WITH (UPDLOCK,HOLDLOCK)
        WHERE owner_object_id=@owner AND idempotency_key=@key;`, signal)).recordset[0];
      if (existing) {
        if (!same(existing, input) || existing.deleted_at !== null) throw new ToolRefusal('This operation key already belongs to a different or corrected intake.');
        return existing;
      }
      const now = this.now(); instant(now);
      const request = bind(this.request(transaction, signal), input).input('now', sql.NVarChar(64), now);
      return (await this.query(request, `INSERT daily.nutrition_meals(owner_object_id,${Object.values(fields).map(([c]) => `[${c}]`).join(',')},source,created_at,updated_at)
        OUTPUT ${select.split(', ').map((c) => `INSERTED.${c}`).join(', ')}
        VALUES(@owner,${Object.keys(fields).map((key) => `@${key}`).join(',')},N'jarvis',@now,@now);`, signal)).recordset[0]!;
    });
  }
  async correct(input: MealInput, expectedRevision: bigint, signal: AbortSignal): Promise<Record<string, unknown>> {
    meal(input); input = structuredClone(input); if (typeof expectedRevision !== 'bigint' || expectedRevision < 1n || expectedRevision >= 9223372036854775807n) throw new TypeError('Invalid meal revision');
    return this.transaction(signal, async (transaction) => {
      const lookup = this.request(transaction, signal).input('key', sql.NVarChar(256), input.idempotencyKey);
      const row = (await this.query(lookup, `SELECT ${select} FROM daily.nutrition_meals WITH (UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner AND ${equalKey('idempotency_key', 'key')};`, signal)).recordset[0];
      if (!row || row.deleted_at !== null || row.id !== input.id) throw new ToolRefusal('Intake not found or unavailable for correction.');
      if (BigInt(row.revision as string) === expectedRevision + 1n && same(row, input)) return row;
      if (BigInt(row.revision as string) !== expectedRevision) throw new ToolRefusal('Intake changed. Read the latest revision before correcting it.');
      const now = this.now(); instant(now);
      const request = bind(this.request(transaction, signal), input).input('now', sql.NVarChar(64), now);
      const assignments = Object.entries(fields).filter(([key]) => key !== 'id' && key !== 'idempotencyKey').map(([key, [column]]) => `[${column}]=@${key}`);
      return (await this.query(request, `UPDATE daily.nutrition_meals SET ${assignments.join(',')},revision=revision+1,updated_at=@now
        OUTPUT ${select.split(', ').map((c) => `INSERTED.${c}`).join(', ')} WHERE owner_object_id=@owner AND ${equalKey('id', 'id')};`, signal)).recordset[0]!;
    });
  }
  async remove(idempotencyKey: string, expectedRevision: bigint, signal: AbortSignal): Promise<Record<string, unknown>> {
    text(idempotencyKey); if (typeof expectedRevision !== 'bigint' || expectedRevision < 1n || expectedRevision >= 9223372036854775807n) throw new TypeError('Invalid meal revision');
    return this.transaction(signal, async (transaction) => {
      const lookup = this.request(transaction, signal).input('key', sql.NVarChar(256), idempotencyKey);
      const row = (await this.query(lookup, `SELECT ${select} FROM daily.nutrition_meals WITH (UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner AND ${equalKey('idempotency_key', 'key')};`, signal)).recordset[0];
      if (!row) throw new ToolRefusal('Intake not found.');
      if (row.deleted_at !== null && BigInt(row.revision as string) === expectedRevision + 1n) return row;
      if (row.deleted_at !== null || BigInt(row.revision as string) !== expectedRevision) throw new ToolRefusal('Intake changed. Read the latest revision before deleting it.');
      const now = this.now(); instant(now);
      return (await this.query(this.request(transaction, signal).input('key', sql.NVarChar(256), idempotencyKey).input('now', sql.NVarChar(64), now),
        `UPDATE daily.nutrition_meals SET deleted_at=@now,updated_at=@now,revision=revision+1 OUTPUT ${select.split(', ').map((c) => `INSERTED.${c}`).join(', ')} WHERE owner_object_id=@owner AND ${equalKey('idempotency_key', 'key')};`, signal)).recordset[0]!;
    });
  }
  /** Stable keyset pages over all dates, including tombstones. No seven-day restriction. */
  async intake(idempotencyKey: string, signal: AbortSignal): Promise<Record<string, unknown> | null> {
    text(idempotencyKey);
    return (await this.read(this.request(this.pool, signal).input('key', sql.NVarChar(256), idempotencyKey),
      `SELECT ${select} FROM daily.nutrition_meals WHERE owner_object_id=@owner AND ${equalKey('idempotency_key','key')};`, signal)).recordset[0] ?? null;
  }
  async history(input: { limit: number; from?: string; to?: string; after?: { createdAt: string; id: string } }, signal: AbortSignal): Promise<HistoryPage> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100 || Object.keys(input).some((key) => !['limit', 'from', 'to', 'after'].includes(key))) throw new TypeError('Invalid history page');
    if (input.from) date(input.from); if (input.to) date(input.to);
    if (input.from && input.to && input.from > input.to) throw new TypeError('Invalid history range');
    if (input.after) { instant(input.after.createdAt); text(input.after.id); }
    const request = this.request(this.pool, signal).input('limit', sql.Int, input.limit + 1)
      .input('from', sql.Date, input.from ? new Date(`${input.from}T00:00:00Z`) : null).input('to', sql.Date, input.to ? new Date(`${input.to}T00:00:00Z`) : null)
      .input('afterTime', sql.NVarChar(64), input.after?.createdAt ?? null).input('afterId', sql.NVarChar(256), input.after?.id ?? null);
    const rows = (await this.read(request, `SELECT TOP (@limit) ${select} FROM daily.nutrition_meals WHERE owner_object_id=@owner
      AND (@from IS NULL OR meal_date>=@from) AND (@to IS NULL OR meal_date<=@to)
      AND (@afterTime IS NULL OR created_at>@afterTime OR (created_at=@afterTime AND id>@afterId)) ORDER BY created_at,id;`, signal)).recordset;
    const more = rows.length > input.limit; if (more) rows.pop();
    const last = rows.at(-1);
    return { rows, next: more && last ? { createdAt: last.created_at as string, id: last.id as string } : null };
  }
  async feedback(mealKey: string, preference: 'like' | 'dislike', signal: AbortSignal): Promise<void> {
    text(mealKey); if (preference !== 'like' && preference !== 'dislike') throw new TypeError('Invalid meal preference');
    await this.transaction(signal, async (transaction) => {
      const now = this.now(); instant(now);
      const request = this.request(transaction, signal).input('key', sql.NVarChar(256), mealKey).input('preference', sql.NVarChar(256), preference).input('now', sql.NVarChar(64), now);
      await this.query(request, `IF EXISTS(SELECT 1 FROM daily.nutrition_recommendation_feedback WITH (UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner AND meal_key=@key AND DATALENGTH(meal_key)<>DATALENGTH(@key)) THROW 51001,'Nutrition key conflict',1;
        IF EXISTS(SELECT 1 FROM daily.nutrition_recommendation_feedback WITH (UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner AND meal_key=@key)
        UPDATE daily.nutrition_recommendation_feedback SET preference=@preference,updated_at=@now WHERE owner_object_id=@owner AND ${equalKey('meal_key', 'key')};
        ELSE INSERT daily.nutrition_recommendation_feedback(owner_object_id,meal_key,preference,created_at,updated_at) VALUES(@owner,@key,@preference,@now,@now);`, signal);
    });
  }
  async disliked(keys: readonly string[], signal: AbortSignal): Promise<Set<string>> {
    if (!Array.isArray(keys) || keys.length > 1000) throw new TypeError('Invalid suggestion keys');
    keys.forEach((key) => text(key)); signal.throwIfAborted();
    if (!keys.length) return new Set();
    const request = this.request(this.pool, signal);
    keys.forEach((key, index) => request.input(`key${index}`, sql.NVarChar(256), key));
    const rows = (await this.read(request, `SELECT meal_key FROM daily.nutrition_recommendation_feedback WHERE owner_object_id=@owner AND preference=N'dislike'
      AND (${keys.map((_, index) => `(${equalKey('meal_key', `key${index}`)})`).join(' OR ')});`, signal)).recordset;
    return new Set(rows.map((row) => row.meal_key as string));
  }
  async suggestions(candidates: readonly Suggestion[], context: BudgetContext, signal: AbortSignal): Promise<Suggestion[]> {
    // Validate context/candidate bounds before SQL, then always consult persisted owner feedback.
    suggest(candidates, new Set(), context);
    candidates = structuredClone(candidates); context = structuredClone(context);
    return suggest(candidates, await this.disliked(candidates.map((candidate) => candidate.mealKey), signal), context);
  }

  /** Exactly one retained source operation key or explicitly accepted definition. */
  async favorite(input: FavoriteInput, authority: FavoriteAuthority, signal: AbortSignal): Promise<void> {
    text(input.id); text(input.name);
    if (Object.keys(input).some((key) => !['id', 'sourceIdempotencyKey', 'definition', 'name', 'aliases'].includes(key)) || !Array.isArray(input.aliases) || input.aliases.length > 30 ||
        Number(input.sourceIdempotencyKey !== undefined) + Number(input.definition !== undefined) !== 1) throw new TypeError('Choose exactly one favourite source');
    if (authority.explicit !== true) throw new ToolRefusal('Explicit intent to save this favourite is required.');
    if (input.sourceIdempotencyKey !== undefined) text(input.sourceIdempotencyKey);
    if (input.definition) {
      const definition = input.definition;
      if (Object.keys(definition).some((key) => !['mealName','mealType','components','confidence','provenance','energyKcal','proteinGrams','carbohydratesGrams','fatGrams','fiberGrams'].includes(key))) throw new TypeError('Invalid favourite definition');
      foodDefinition(definition);
      if (definition.confidence !== 'accurate' && authority.estimateAccepted !== true) throw new ToolRefusal('Accept the displayed estimated favourite definition first.');
    }
    input = structuredClone(input);
    const normalized = input.name.normalize('NFKC').toLocaleLowerCase('en-US').trim(); text(normalized);
    const aliases = [...new Set(input.aliases.map((alias) => { text(alias); const result = alias.normalize('NFKC').toLocaleLowerCase('en-US').trim(); text(result); return result; }))];
    await this.transaction(signal, async (transaction) => {
      const source = input.sourceIdempotencyKey === undefined ? null : (await this.query(this.request(transaction, signal).input('key', sql.NVarChar(256), input.sourceIdempotencyKey),
        `SELECT ${select} FROM daily.nutrition_meals WITH (UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner AND ${equalKey('idempotency_key', 'key')};`, signal)).recordset[0];
      if (input.sourceIdempotencyKey !== undefined && !source) throw new ToolRefusal('The source intake is unavailable.');
      const existing = (await this.query(this.request(transaction, signal).input('name', sql.NVarChar(256), normalized),
        `SELECT id FROM daily.nutrition_favorites WITH (UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner AND ${equalKey('normalized_name', 'name')};`, signal)).recordset[0];
      const favoriteId = existing?.id as string | undefined ?? input.id;
      // One owner-local name/alias namespace; do not silently redirect a favourite.
      const conflicts = (await this.query(this.request(transaction, signal).input('id', sql.NVarChar(256), favoriteId)
        .input('names', sql.NVarChar(sql.MAX), JSON.stringify([normalized, ...aliases])),
        `SELECT TOP (1) id FROM daily.nutrition_favorites WITH (UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner
          AND NOT (${equalKey('id', 'id')}) AND (
            EXISTS(SELECT 1 FROM OPENJSON(@names) n WHERE n.[value] COLLATE Latin1_General_100_BIN2=normalized_name AND DATALENGTH(n.[value])=DATALENGTH(normalized_name))
            OR EXISTS(SELECT 1 FROM OPENJSON(aliases_json) a JOIN OPENJSON(@names) n ON a.[value] COLLATE Latin1_General_100_BIN2=n.[value] COLLATE Latin1_General_100_BIN2 AND DATALENGTH(a.[value])=DATALENGTH(n.[value])));`, signal)).recordset;
      if (conflicts.length) throw new ToolRefusal('This favourite name or alias is already used.');
      const now = this.now(); instant(now);
      const request = this.request(transaction, signal).input('id', sql.NVarChar(256), favoriteId).input('name', sql.NVarChar(sql.MAX), input.name)
        .input('normalized', sql.NVarChar(256), normalized).input('aliases', sql.NVarChar(sql.MAX), JSON.stringify(aliases)).input('now', sql.NVarChar(64), now);
      const definition = input.definition;
      const valuesFromDefinition: Record<string, unknown> = definition ? { meal_name: definition.mealName, meal_type: definition.mealType, components_json: canonicalJson(definition.components),
        energy_kcal: definition.energyKcal, protein_grams: definition.proteinGrams, carbohydrates_grams: definition.carbohydratesGrams, fat_grams: definition.fatGrams,
        fiber_grams: definition.fiberGrams, confidence: definition.confidence, nutrient_provenance_json: canonicalJson(definition.provenance) } : {};
      for (const column of ['meal_name', 'meal_type', 'components_json', 'energy_kcal', 'protein_grams', 'carbohydrates_grams', 'fat_grams', 'fiber_grams', 'confidence', 'nutrient_provenance_json'] as const) {
        const type = ['energy_kcal', 'protein_grams', 'carbohydrates_grams', 'fat_grams', 'fiber_grams'].includes(column) ? sql.Float : sql.NVarChar(sql.MAX);
        request.input(column, type, source ? source[column] : valuesFromDefinition[column]);
      }
      request.input('mealId', sql.NVarChar(256), source?.id ?? null).input('sourceKey', sql.NVarChar(256), source?.idempotency_key ?? null);
      const values = ['meal_name', 'meal_type', 'components_json', 'energy_kcal', 'protein_grams', 'carbohydrates_grams', 'fat_grams', 'fiber_grams', 'confidence', 'nutrient_provenance_json'];
      await this.query(request, `IF EXISTS(SELECT 1 FROM daily.nutrition_favorites WHERE owner_object_id=@owner AND id=@id AND DATALENGTH(id)<>DATALENGTH(@id)) THROW 51001,'Nutrition key conflict',1;
        IF EXISTS(SELECT 1 FROM daily.nutrition_favorites WHERE owner_object_id=@owner AND id=@id)
        UPDATE daily.nutrition_favorites SET favorite_name=@name,normalized_name=@normalized,aliases_json=@aliases,${values.map((c) => `[${c}]=@${c}`).join(',')},source_meal_id=@mealId,source_idempotency_key=@sourceKey,updated_at=@now WHERE owner_object_id=@owner AND ${equalKey('id', 'id')};
        ELSE INSERT daily.nutrition_favorites(owner_object_id,id,favorite_name,normalized_name,aliases_json,${values.join(',')},source_meal_id,source_idempotency_key,created_at,updated_at)
        VALUES(@owner,@id,@name,@normalized,@aliases,${values.map((c) => `@${c}`).join(',')},@mealId,@sourceKey,@now,@now);`, signal);
    });
  }
  async findFavorite(name: string, signal: AbortSignal): Promise<Record<string, unknown> | null> {
    text(name); const normalized = name.normalize('NFKC').toLocaleLowerCase('en-US').trim(); text(normalized);
    const result = await this.read(this.request(this.pool, signal).input('name', sql.NVarChar(256), normalized),
      `SELECT TOP (2) * FROM daily.nutrition_favorites WHERE owner_object_id=@owner AND
        ((${equalKey('normalized_name', 'name')}) OR EXISTS(SELECT 1 FROM OPENJSON(aliases_json) WHERE [value] COLLATE Latin1_General_100_BIN2=@name AND DATALENGTH([value])=DATALENGTH(@name)));`, signal);
    if (result.recordset.length > 1) throw new ToolRefusal('The favourite alias is ambiguous. Choose its exact name.');
    return result.recordset[0] ?? null;
  }
  /** Exact owner-owned favourites/aliases outrank historical meal-name matches. */
  async lookupSaved(name: string, signal: AbortSignal): Promise<{ source: 'favorite' | 'history'; row: Record<string, unknown> } | null> {
    const favorite = await this.findFavorite(name, signal); if (favorite) return { source: 'favorite', row: favorite };
    text(name, 2000);
    const row = (await this.read(this.request(this.pool, signal).input('name', sql.NVarChar(sql.MAX), name),
      `SELECT TOP (1) ${select} FROM daily.nutrition_meals WHERE owner_object_id=@owner AND deleted_at IS NULL
        AND meal_name COLLATE Latin1_General_100_BIN2=@name AND DATALENGTH(meal_name)=DATALENGTH(@name) ORDER BY created_at DESC,id DESC;`, signal)).recordset[0];
    return row ? { source: 'history', row } : null;
  }
  async favorites(input: { limit: number; afterId?: string }, signal: AbortSignal): Promise<{ rows: Record<string, unknown>[]; nextId: string | null }> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100 || Object.keys(input).some((key) => !['limit', 'afterId'].includes(key))) throw new TypeError('Invalid favourite page');
    if (input.afterId !== undefined) text(input.afterId);
    const request = this.request(this.pool, signal).input('limit', sql.Int, input.limit + 1).input('after', sql.NVarChar(256), input.afterId ?? null);
    const rows = (await this.read(request, 'SELECT TOP (@limit) * FROM daily.nutrition_favorites WHERE owner_object_id=@owner AND (@after IS NULL OR id>@after) ORDER BY id;', signal)).recordset;
    const more = rows.length > input.limit; if (more) rows.pop();
    return { rows, nextId: more ? rows.at(-1)!.id as string : null };
  }
  /** Plans never call log, nutrition_queue or Apple Health export. */
  async savePlan(input: PlanRequest, expectedRevision: bigint, signal: AbortSignal): Promise<Record<string, unknown>> {
    if (!input || Object.keys(input).some((key) => !['id','name','description','entries'].includes(key)) || !Array.isArray(input.entries) || input.entries.length < 3 || input.entries.length > 50) throw new TypeError('Invalid plan definition');
    text(input.id); text(input.name); if (input.description !== null) text(input.description, 4000);
    for (const entry of input.entries) { if (Object.keys(entry).some((key) => !['slot','favoriteId'].includes(key)) || !['breakfast','lunch','dinner','snack'].includes(entry.slot)) throw new TypeError('Invalid plan slot'); text(entry.favoriteId); }
    for (const slot of ['breakfast','lunch','dinner']) if (input.entries.filter((entry) => entry.slot === slot).length !== 1) throw new TypeError('Plan requires one breakfast, lunch and dinner');
    input = structuredClone(input); if (typeof expectedRevision !== 'bigint' || expectedRevision < 0n || expectedRevision >= 9223372036854775807n) throw new TypeError('Invalid plan revision');
    const normalized = input.name.normalize('NFKC').toLocaleLowerCase('en-US').trim(); text(normalized);
    return this.transaction(signal, async (transaction) => {
      const lookup = this.request(transaction, signal).input('id', sql.NVarChar(256), input.id).input('name', sql.NVarChar(256), normalized);
      const existing = (await this.query(lookup, `SELECT * FROM daily.nutrition_meal_plans WITH (UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner AND ((${equalKey('id', 'id')}) OR (${equalKey('normalized_name', 'name')}));`, signal)).recordset;
      if (existing.length > 1) throw new ToolRefusal('Plan name conflicts with another existing plan.');
      const row = existing[0];
      const items: PlanInput['items'][number][] = [];
      const snapshots = new Map<string, Record<string, unknown>>();
      for (const favoriteId of [...new Set(input.entries.map((entry) => entry.favoriteId))].sort()) {
        const favorite = (await this.query(this.request(transaction, signal).input('id', sql.NVarChar(256), favoriteId),
          `SELECT * FROM daily.nutrition_favorites WITH (UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner AND ${equalKey('id','id')};`, signal)).recordset[0];
        if (!favorite) throw new ToolRefusal('Every plan slot must reference an owned favourite.'); snapshots.set(favoriteId, favorite);
      }
      for (const entry of input.entries) {
        const favorite = snapshots.get(entry.favoriteId)!;
        const values = { energyKcal: favorite.energy_kcal as number, proteinGrams: favorite.protein_grams as number | null,
          carbohydratesGrams: favorite.carbohydrates_grams as number | null, fatGrams: favorite.fat_grams as number | null, fiberGrams: favorite.fiber_grams as number | null };
        nutrients(values);
        items.push({ mealKey: entry.favoriteId, name: favorite.meal_name as string, nutrients: values,
          ...{ slot: entry.slot, favoriteId: entry.favoriteId, components: JSON.parse(favorite.components_json as string), provenance: JSON.parse(favorite.nutrient_provenance_json as string) } });
      }
      const totals = {} as Pick<PlanInput,'energyKcal'|'proteinGrams'|'carbohydratesGrams'|'fatGrams'|'fiberGrams'>;
      for (const key of ['energyKcal','proteinGrams','carbohydratesGrams','fatGrams','fiberGrams'] as const) {
        const values = items.map((item) => item.nutrients[key]);
        (totals as Record<string, number | null>)[key] = values.some((value) => value === null) ? null : values.reduce<number>((sum,value) => sum + value!, 0);
      }
      plan({ id: row?.id as string | undefined ?? input.id, name: input.name, description: input.description, items, ...totals });
      const columns = { plan_name: input.name, normalized_name: normalized, description: input.description, items_json: canonicalJson(items),
        energy_kcal: totals.energyKcal, protein_grams: totals.proteinGrams, carbohydrates_grams: totals.carbohydratesGrams, fat_grams: totals.fatGrams, fiber_grams: totals.fiberGrams };
      if (row) {
        if (row.deleted_at !== null) throw new ToolRefusal('Plan unavailable or key conflict.');
        if (BigInt(row.revision as string) === expectedRevision + 1n && Object.entries(columns).every(([key, value]) => row[key] === value)) return row;
        if (BigInt(row.revision as string) !== expectedRevision) throw new ToolRefusal('Plan changed. Read the latest revision first.');
      } else if (expectedRevision !== 0n) throw new ToolRefusal('Plan not found.');
      const now = this.now(); instant(now);
      const request = this.request(transaction, signal).input('id', sql.NVarChar(256), row?.id ?? input.id).input('now', sql.NVarChar(64), now);
      for (const [column, value] of Object.entries(columns)) request.input(column, column.endsWith('_kcal') || column.endsWith('_grams') ? sql.Float : sql.NVarChar(sql.MAX), value);
      const query = row ? `UPDATE daily.nutrition_meal_plans SET ${Object.keys(columns).map((c) => `[${c}]=@${c}`).join(',')},revision=revision+1,updated_at=@now OUTPUT INSERTED.* WHERE owner_object_id=@owner AND ${equalKey('id', 'id')};`
        : `INSERT daily.nutrition_meal_plans(owner_object_id,id,${Object.keys(columns).join(',')},created_at,updated_at) OUTPUT INSERTED.* VALUES(@owner,@id,${Object.keys(columns).map((c) => `@${c}`).join(',')},@now,@now);`;
      return (await this.query(request, query, signal)).recordset[0]!;
    });
  }
  async plans(input: { limit: number; afterId?: string }, signal: AbortSignal): Promise<{ rows: Record<string, unknown>[]; nextId: string | null }> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100 || Object.keys(input).some((key) => !['limit', 'afterId'].includes(key))) throw new TypeError('Invalid plan page');
    if (input.afterId !== undefined) text(input.afterId);
    const request = this.request(this.pool, signal).input('limit', sql.Int, input.limit + 1).input('after', sql.NVarChar(256), input.afterId ?? null);
    const rows = (await this.read(request, 'SELECT TOP (@limit) * FROM daily.nutrition_meal_plans WHERE owner_object_id=@owner AND (@after IS NULL OR id>@after) ORDER BY id;', signal)).recordset;
    const more = rows.length > input.limit; if (more) rows.pop();
    return { rows, nextId: more ? rows.at(-1)!.id as string : null };
  }
  async removePlan(id: string, expectedRevision: bigint, signal: AbortSignal): Promise<Record<string, unknown>> {
    text(id); if (typeof expectedRevision !== 'bigint' || expectedRevision < 1n || expectedRevision >= 9223372036854775807n) throw new TypeError('Invalid plan revision');
    return this.transaction(signal, async (transaction) => {
      const row = (await this.query(this.request(transaction, signal).input('id', sql.NVarChar(256), id),
        `SELECT * FROM daily.nutrition_meal_plans WITH (UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner AND ${equalKey('id', 'id')};`, signal)).recordset[0];
      if (!row) throw new ToolRefusal('Plan not found.');
      if (row.deleted_at !== null && BigInt(row.revision as string) === expectedRevision + 1n) return row;
      if (row.deleted_at !== null || BigInt(row.revision as string) !== expectedRevision) throw new ToolRefusal('Plan changed. Read the latest revision first.');
      const now = this.now(); instant(now);
      return (await this.query(this.request(transaction, signal).input('id', sql.NVarChar(256), id).input('now', sql.NVarChar(64), now),
        `UPDATE daily.nutrition_meal_plans SET deleted_at=@now,updated_at=@now,revision=revision+1 OUTPUT INSERTED.* WHERE owner_object_id=@owner AND ${equalKey('id', 'id')};`, signal)).recordset[0]!;
    });
  }
}
