import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readMigrations, readDownMigration, revertMigration } from './migrations.js';
import { NutritionStore } from '../daily/nutrition/store.js';
import { type FoodDefinition, type MealInput, type PlanRequest } from '../daily/nutrition/model.js';
import { favoriteFingerprint } from '../daily/records.js';
import { dailyFoodTool } from '../daily/tools/food.js';
import { dailyFoodReviewTool } from '../daily/tools/food-review.js';
import { dailySavedFoodTool } from '../daily/tools/saved-food.js';
import { createOwnerInteractionService } from '../core/owner-interactions.js';
import { createConfirmationStore } from './confirmation-store.js';

const config = loadDatabaseConfig();
if (!config || process.env.NODE_ENV !== 'test' || config.server !== '127.0.0.1') throw new Error('Nutrition tests require isolated loopback SQL Server');
const database = `jarvis_nutrition_ci_${randomUUID().replaceAll('-', '')}`;
const admin = new sql.ConnectionPool({ ...config, database: 'master' });
const pool = new sql.ConnectionPool({ ...config, database });
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const request = (id: string, runner = false) => ({ server: { ownerObjectId: id }, principal: { objectId: id }, ...(runner ? { runnerPrincipal: { kind: 'jarvis-runner' } } : {}) }) as unknown as FastifyRequest;
const now = () => '2026-10-12T17:00:00+02:00';
const store = () => NutritionStore.forRequest(pool, request(owner), now);
const signal = () => new AbortController().signal;
const authority = { intent: 'log-intake' as const, explicit: true, estimateAccepted: false, proposalRequired: false };
const fixture = (id: string): MealInput => ({ id, idempotencyKey: `synthetic-${id}`, mealName: 'Synthetic food', mealType: null, components: [],
  occurredAt: '2026-01-01T23:30:00+01:00', mealDate: '2026-01-01', expiresAt: '2028-01-01T00:00:00Z',
  energyKcal: 123.5, proteinGrams: null, carbohydratesGrams: null, fatGrams: null, fiberGrams: null,
  captureMethod: 'text', confidence: 'accurate', provenance: { energyKcal: { source: 'user-exact', unit: 'kcal' } } });
beforeAll(async () => {
  await admin.connect(); await admin.request().batch(`CREATE DATABASE [${database}];`); await pool.connect();
  await applyMigrations(pool, await readMigrations());
});
afterAll(async () => {
  await pool.close();
  if (admin.connected) await admin.request().batch(`IF DB_ID(N'${database}') IS NOT NULL BEGIN ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}]; END;`);
  await admin.close();
});
describe('inactive nutrition services on real SQL Server', () => {
  it('commits concurrent retries exactly once per owner and preserves unknowns/provenance', async () => {
    const input = fixture('01');
    const rows = await Promise.all(Array.from({ length: 6 }, () => store().log(input, authority, signal())));
    expect(rows.every((row) => row.id === '01' && row.revision === '1')).toBe(true);
    expect(rows[0]).toMatchObject({ energy_kcal: 123.5, protein_grams: null, occurred_at: input.occurredAt, source: 'jarvis' });
    expect(JSON.parse(rows[0]!.nutrient_provenance_json as string)).toEqual(input.provenance);
    await expect(store().log({ ...input, energyKcal: 124 }, authority, signal())).rejects.toThrow('operation key');
    await NutritionStore.forRequest(pool, request(other), now).log(input, authority, signal());
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM daily.nutrition_meals')).recordset[0].count).toBe(2);
    expect(() => NutritionStore.forRequest(pool, request(owner, true), now)).toThrow();
  });
  it('refuses recommendations and unaccepted estimates before SQL', async () => {
    await expect(store().log(fixture('unconfirmed'), { ...authority, intent: 'recommendation' }, signal())).rejects.toThrow('Suggestions and plans');
    await expect(store().log({ ...fixture('photo'), confidence: 'estimate', captureMethod: 'photo' }, authority, signal())).rejects.toThrow('Confirm');
    expect((await pool.request().query("SELECT COUNT(*) AS count FROM daily.nutrition_meals WHERE id IN (N'unconfirmed',N'photo')")).recordset[0].count).toBe(0);
  });
  it('corrects old dates without rewriting time and refuses stale overlapping changes', async () => {
    const changed = { ...fixture('01'), energyKcal: 222, proteinGrams: 20 };
    const outcomes = await Promise.allSettled([store().correct(changed, 1n, signal()), store().correct({ ...changed, energyKcal: 333 }, 1n, signal())]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const row = (await store().history({ limit: 10 }, signal())).rows[0]!;
    expect(row).toMatchObject({ revision: '2', occurred_at: changed.occurredAt, carbohydrates_grams: null });
    const winning = { ...changed, energyKcal: row.energy_kcal as number };
    expect((await store().correct(winning, 1n, signal())).revision).toBe('2');
    await expect(store().correct({ ...winning, id: '01 ' }, 2n, signal())).rejects.toThrow('not found');
    await expect(NutritionStore.forRequest(pool, request(other), now).correct(winning, 2n, signal())).rejects.toThrow('changed');
  });
  it('pages all history deterministically including old records and tombstones', async () => {
    await store().log(fixture('1'), authority, signal()); await store().log(fixture('third'), authority, signal());
    const seen: string[] = []; let after: { createdAt: string; id: string } | null = null;
    do {
      const page = await store().history({ limit: 1, ...(after ? { after } : {}) }, signal());
      seen.push(...page.rows.map((row) => row.id as string)); after = page.next;
    } while (after);
    expect(seen).toEqual(['01', '1', 'third']);
    const row = await store().remove('synthetic-1', 1n, signal());
    expect(row).toMatchObject({ revision: '2', deleted_at: now(), energy_kcal: 123.5, protein_grams: null });
    expect(await store().remove('synthetic-1', 1n, signal())).toEqual(row);
    await expect(store().correct(fixture('1'), 2n, signal())).rejects.toThrow('unavailable');
    expect((await store().history({ limit: 100, from: '2026-01-01', to: '2026-01-01' }, signal())).rows).toHaveLength(3);
    expect((await NutritionStore.forRequest(pool, request(other), now).history({ limit: 100 }, signal())).rows).toHaveLength(1);
  });
  it('persists owner-local favourites and aliases, detects collisions and retains null macros', async () => {
    const input = { id: 'favorite', sourceIdempotencyKey: 'synthetic-01', name: 'Synthetic Dinner', aliases: ['Supper'] };
    const accepted = { explicit: true, estimateAccepted: true };
    await Promise.all([store().favorite(input, accepted, signal()), store().favorite(input, accepted, signal())]);
    expect(await store().findFavorite('SUPPER', signal())).toMatchObject({ id: 'favorite', source_meal_id: '01', carbohydrates_grams: null });
    expect(await NutritionStore.forRequest(pool, request(other), now).findFavorite('supper', signal())).toBeNull();
    expect((await store().favorites({ limit: 1 }, signal())).rows).toHaveLength(1);
    expect((await NutritionStore.forRequest(pool, request(other), now).favorites({ limit: 1 }, signal())).rows).toEqual([]);
    await expect(store().favorite({ ...input, id: 'collision', name: 'Other' }, accepted, signal())).rejects.toThrow('already used');
    await expect(store().favorite({ ...input, sourceIdempotencyKey: 'missing' }, accepted, signal())).rejects.toThrow('unavailable');
    await store().favorite({ ...input, id: 'not-a-duplicate', name: 'SYNTHETIC DINNER' }, accepted, signal());
    expect((await store().favorites({ limit: 100 }, signal())).rows).toHaveLength(1);
    expect(await store().findFavorite('supper', signal())).toMatchObject({ id: 'favorite' });
    await expect(store().favorite({ ...input, id: 'deleted-source', name: 'Deleted source', aliases: [], sourceIdempotencyKey: 'synthetic-1' }, accepted, signal())).rejects.toThrow('unavailable');
    expect(await store().findFavorite('Deleted source', signal())).toBeNull();
  });
  it('persists retry-safe likes/dislikes and never returns a disliked suggestion', async () => {
    await Promise.all([store().feedback('favorite', 'dislike', signal()), store().feedback('favorite', 'dislike', signal())]);
    const disliked = await store().disliked(['favorite'], signal());
    expect(disliked).toEqual(new Set(['favorite']));
    expect(await NutritionStore.forRequest(pool, request(other), now).disliked(['favorite'], signal())).toEqual(new Set());
    expect(await store().suggestions([{ ...fixture('candidate'), mealKey: 'favorite', name: 'Synthetic', localTimeWindows: [] }],
      { now: now(), localTime: '17:00', remainingKcal: 200, remainingProteinGrams: null }, signal())).toEqual([]);
    await store().feedback('favorite', 'like', signal()); expect(await store().disliked(['favorite'], signal())).toEqual(new Set());
    await expect(store().feedback('favorite ', 'dislike', signal())).rejects.toThrow('conflicts');
    await store().feedback('favorite', 'dislike', signal());
    const otherStore = NutritionStore.forRequest(pool, request(other), now);
    await otherStore.feedback('favorite', 'dislike', signal());
    await expect(store().feedback('favorite ', null, signal())).rejects.toThrow('conflicts');
    expect(await store().disliked(['favorite'], signal())).toEqual(new Set(['favorite']));
    await Promise.all([store().feedback('favorite', null, signal()), store().feedback('favorite', null, signal())]);
    expect(await store().disliked(['favorite'], signal())).toEqual(new Set());
    expect(await otherStore.disliked(['favorite'], signal())).toEqual(new Set(['favorite']));
    expect((await store().suggestions([{ ...fixture('candidate'), mealKey: 'favorite', name: 'Synthetic', localTimeWindows: [] }],
      { now: now(), localTime: '17:00', remainingKcal: 200, remainingProteinGrams: null }, signal())).map((row) => row.mealKey)).toEqual(['favorite']);
  });
  it('saves retry-safe revisioned plans with unknown macros without logging or enqueueing intake', async () => {
    const planInput: PlanRequest = { id: 'plan', name: 'Synthetic Plan', description: null,
      entries: [{ slot: 'breakfast', favoriteId: 'favorite' }, { slot: 'lunch', favoriteId: 'favorite' }, { slot: 'dinner', favoriteId: 'favorite' }] };
    const before = (await pool.request().query('SELECT COUNT(*) AS count FROM daily.nutrition_meals')).recordset[0].count;
    const rows = await Promise.all([store().savePlan(planInput, 0n, signal()), store().savePlan(planInput, 0n, signal())]);
    expect(rows[0]).toMatchObject({ revision: '1', carbohydrates_grams: null, protein_grams: 60 });
    expect(rows[0]!.energy_kcal).toBe(((await store().findFavorite('supper', signal()))!.energy_kcal as number) * 3);
    const changed = { ...planInput, id: 'not-a-duplicate-plan', description: 'Updated synthetic plan' };
    expect((await store().savePlan(changed, 1n, signal())).revision).toBe('2');
    expect((await store().savePlan(changed, 1n, signal())).revision).toBe('2');
    await expect(store().savePlan({ ...changed, description: 'Stale' }, 1n, signal())).rejects.toThrow('changed');
    expect((await store().plans({ limit: 1 }, signal())).rows).toHaveLength(1);
    expect((await NutritionStore.forRequest(pool, request(other), now).plans({ limit: 1 }, signal())).rows).toEqual([]);
    const removed = await store().removePlan('plan', 2n, signal());
    expect(removed).toMatchObject({ revision: '3', deleted_at: now(), carbohydrates_grams: null });
    expect(await store().removePlan('plan', 2n, signal())).toEqual(removed);
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM daily.nutrition_meals')).recordset[0].count).toBe(before);
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM daily.nutrition_queue')).recordset[0].count).toBe(0);
    await expect(store().savePlan({ ...planInput, entries: planInput.entries.slice(0, 2) }, 0n, signal())).rejects.toThrow('definition');
    await expect(store().savePlan({ ...planInput, entries: planInput.entries.map((entry) => ({ ...entry, favoriteId: 'unowned' })) }, 0n, signal())).rejects.toThrow('owned favourite');
    await expect(store().savePlan({ ...planInput, energyKcal: 0 } as PlanRequest, 0n, signal())).rejects.toThrow('definition');
  });
  it('saves accepted definitions without fake intake and protects their provenance on rollback', async () => {
    const definition: FoodDefinition = { mealName: 'Synthetic definition', mealType: null, components: [], confidence: 'accurate', provenance: { source: 'user-exact' },
      energyKcal: 55, proteinGrams: null, carbohydratesGrams: null, fatGrams: null, fiberGrams: null };
    const input = { id: 'definition', name: 'Synthetic definition', aliases: [], definition };
    const before = (await store().history({ limit: 100 }, signal())).rows.length;
    await store().favorite(input, { explicit: true, estimateAccepted: false }, signal());
    expect(await store().findFavorite(input.name, signal())).toMatchObject({ source_meal_id: null, source_idempotency_key: null, energy_kcal: 55, protein_grams: null });
    expect((await store().history({ limit: 100 }, signal())).rows).toHaveLength(before);
    await expect(store().favorite({ ...input, sourceIdempotencyKey: 'synthetic-01' }, { explicit: true, estimateAccepted: false }, signal())).rejects.toThrow('exactly one');
    const isolated = `${database}_favorite_rollback`; const rollbackPool = new sql.ConnectionPool({ ...config!, database: isolated });
    try {
      await admin.request().batch(`CREATE DATABASE [${isolated}];`); await rollbackPool.connect();
      const migrations = (await readMigrations()).filter(({ name }) => /^004[123]_daily/u.test(name));
      await applyMigrations(rollbackPool, migrations);
      await rollbackPool.request().input('owner', sql.UniqueIdentifier, owner).query(`INSERT daily.nutrition_favorites
        (owner_object_id,id,favorite_name,normalized_name,meal_name,energy_kcal,confidence,source_meal_id,source_idempotency_key,nutrient_provenance_json,created_at,updated_at)
        VALUES(@owner,N'synthetic',N'Synthetic',N'synthetic',N'Synthetic',55,N'accurate',NULL,NULL,N'{}',N'2026-01-01',N'2026-01-01');`);
      await expect(revertMigration(rollbackPool, migrations, await readDownMigration('0043_daily_favorite_definitions.sql'))).rejects.toThrow('cannot discard');
    } finally {
      await rollbackPool.close();
      await admin.request().batch(`IF DB_ID(N'${isolated}') IS NOT NULL BEGIN ALTER DATABASE [${isolated}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${isolated}]; END;`);
    }
  });
  it('refuses unknown-plan rollback with the exact isolated applied manifest', async () => {
    const isolated = `${database}_rollback`; const rollbackPool = new sql.ConnectionPool({ ...config!, database: isolated });
    try {
      await admin.request().batch(`CREATE DATABASE [${isolated}];`); await rollbackPool.connect();
      const migrations = (await readMigrations()).filter(({ name }) => /^004[12]_daily/u.test(name));
      await applyMigrations(rollbackPool, migrations);
      await rollbackPool.request().input('owner', sql.UniqueIdentifier, owner).batch(`INSERT daily.nutrition_meal_plans(owner_object_id,id,plan_name,normalized_name,energy_kcal,protein_grams,carbohydrates_grams,fat_grams,fiber_grams,created_at,updated_at)
        VALUES(@owner,N'synthetic',N'Synthetic',N'synthetic',100,NULL,NULL,NULL,NULL,N'2026-01-01',N'2026-01-01');`);
      await expect(revertMigration(rollbackPool, migrations, await readDownMigration('0042_daily_plan_unknown_nutrients.sql'))).rejects.toThrow('cannot replace unknown');
    } finally { await rollbackPool.close(); await admin.request().batch(`IF DB_ID(N'${isolated}') IS NOT NULL BEGIN ALTER DATABASE [${isolated}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${isolated}]; END;`); }
  });
  it('reuses legacy accented favourite/plan names and raw aliases, isolating owners and rejecting ambiguity', async () => {
    const accepted = { explicit: true, estimateAccepted: false };
    const cleanDefinition: FoodDefinition = { mealName: 'Synthetic capped definition', mealType: null, components: [], confidence: 'accurate', provenance: {},
      energyKcal: 10000, proteinGrams: 1000, carbohydratesGrams: null, fatGrams: null, fiberGrams: null };
    const favorite = { id: 'legacy-favorite-01', name: 'Crème-BRÛLÉE!', aliases: ['MÝ Raw.Alias'], definition: cleanDefinition };
    await store().favorite(favorite, accepted, signal());
    // Synthetic import shape: original normalization plus untouched display aliases.
    await pool.request().input('owner', sql.UniqueIdentifier, owner).query(`UPDATE daily.nutrition_favorites SET normalized_name=N'creme brulee',aliases_json=N'["MÝ Raw.Alias"]' WHERE owner_object_id=@owner AND id=N'legacy-favorite-01';`);
    expect(await store().findFavorite('my RAW alias', signal())).toMatchObject({ id: favorite.id, aliases_json: '["MÝ Raw.Alias"]' });
    const otherStore = NutritionStore.forRequest(pool, request(other), now);
    expect(await otherStore.findFavorite('my raw alias', signal())).toBeNull();
    await Promise.all([store().favorite({ ...favorite, id: 'duplicate-a', name: 'CREME / brulee' }, accepted, signal()),
      store().favorite({ ...favorite, id: 'duplicate-b', name: 'Crème Brûlée' }, accepted, signal())]);
    expect((await store().favorites({ limit: 100 }, signal())).rows.filter((row) => row.normalized_name === 'creme brulee').map((row) => row.id)).toEqual([favorite.id]);
    expect(await store().findFavorite('MÝ Raw.Alias', signal())).toMatchObject({ id: favorite.id, aliases_json: '["MÝ Raw.Alias"]' });
    await expect(store().favorite({ ...favorite, id: 'collision', name: 'Different', aliases: ['MY RAW-ALIAS'] }, accepted, signal())).rejects.toThrow('already used');
    await otherStore.favorite({ ...favorite, id: 'other-favorite' }, accepted, signal());
    expect(await otherStore.findFavorite('my raw alias', signal())).toMatchObject({ id: 'other-favorite' });
    const plan: PlanRequest = { id: 'legacy-plan-01', name: 'Crème / DAY!', description: null,
      entries: [{ slot: 'breakfast', favoriteId: favorite.id }, { slot: 'lunch', favoriteId: favorite.id }, { slot: 'dinner', favoriteId: favorite.id }] };
    const created = await store().savePlan(plan, 0n, signal());
    expect(created).toMatchObject({ id: plan.id, energy_kcal: 30000, protein_grams: 3000, carbohydrates_grams: null });
    await pool.request().input('owner', sql.UniqueIdentifier, owner).query(`UPDATE daily.nutrition_meal_plans SET normalized_name=N'creme day' WHERE owner_object_id=@owner AND id=N'legacy-plan-01';`);
    expect(await store().savePlan({ ...plan, id: 'duplicate-plan', name: 'CREME-DAY' }, 1n, signal())).toMatchObject({ id: plan.id, revision: '2' });
    expect((await store().plans({ limit: 100 }, signal())).rows.filter((row) => row.normalized_name === 'creme day').map((row) => row.id)).toEqual([plan.id]);
    await store().favorite({ ...favorite, id: 'ambiguous-favorite', name: 'Unique name', aliases: [] }, accepted, signal());
    await pool.request().input('owner', sql.UniqueIdentifier, owner).query(`UPDATE daily.nutrition_favorites SET aliases_json=N'["My Raw Alias"]' WHERE owner_object_id=@owner AND id=N'ambiguous-favorite';`);
    await expect(store().findFavorite('MÝ Raw.Alias', signal())).rejects.toThrow('ambiguous');
    await expect(store().favorite(favorite, accepted, signal())).rejects.toThrow('already used');
    await pool.request().input('owner', sql.UniqueIdentifier, owner).query(`UPDATE daily.nutrition_favorites SET favorite_name=N'Creme Brulee' WHERE owner_object_id=@owner AND id=N'ambiguous-favorite';`);
    await expect(store().favorite(favorite, accepted, signal())).rejects.toThrow('ambiguous');
  });
  it('rejects deleted source intake but retains an independent favourite snapshot', async () => {
    const intake = fixture('snapshot-source'); await store().log(intake, authority, signal());
    const input = { id: 'retained-snapshot', name: 'Retained snapshot', aliases: [], sourceIdempotencyKey: intake.idempotencyKey };
    await store().favorite(input, { explicit: true, estimateAccepted: false }, signal());
    await store().remove(intake.idempotencyKey, 1n, signal());
    await expect(store().favorite({ ...input, id: 'new-snapshot', name: 'New snapshot' }, { explicit: true, estimateAccepted: false }, signal())).rejects.toThrow('unavailable');
    expect(await store().findFavorite(input.name, signal())).toMatchObject({ id: input.id, source_meal_id: intake.id, energy_kcal: intake.energyKcal });
  });
  it('enforces new-write domains, caps, trusted time and Copenhagen dates without rejecting old/null intake', async () => {
    const input = fixture('write-guards');
    for (const patch of [{ energyKcal: -1 }, { energyKcal: 10001 }, { proteinGrams: 1001 }, { mealType: 'supper' },
      { occurredAt: '2026-10-12T15:05:01Z', mealDate: '2026-10-12' }, { mealDate: '2026-01-02' }]) {
      await expect(store().log({ ...input, ...patch }, authority, signal())).rejects.toThrow();
      await expect(store().correct({ ...input, ...patch }, 1n, signal())).rejects.toThrow();
    }
    expect(await store().intake(input.idempotencyKey, signal())).toBeNull();
    expect(await store().log(input, authority, signal())).toMatchObject({ protein_grams: null, occurred_at: input.occurredAt });
    expect(await store().correct({ ...input, mealType: 'other' }, 1n, signal())).toMatchObject({ revision: '2', protein_grams: null });
  });
  it('resolves retained full-length and non-key historical names without changing favourite-key rules', async () => {
    const names = ['x'.repeat(257), 'x'.repeat(2000), '\u5bff\u53f8', '\ufb03'.repeat(100)];
    for (const [index, mealName] of names.entries()) {
      const input = { ...fixture(`lookup-history-${index}`), mealName };
      await store().log(input, authority, signal());
      expect(await store().lookupSaved(mealName, signal())).toMatchObject({
        source: 'history', row: { id: input.id, meal_name: mealName, protein_grams: null },
      });
      expect(await NutritionStore.forRequest(pool, request(other), now).lookupSaved(mealName, signal())).toBeNull();
    }
  });
  it('returns real favourite revisions, replays without notifications and rejects changed reviewed sources under SQL locks', async () => {
    const notifications: string[] = [];
    const persistence = NutritionStore.forRequest(pool, request(owner), now, { publish: change => { notifications.push(...change.sources); } });
    const meal = fixture('saved-write-source');
    await persistence.log(meal, authority, signal());
    const favorite = { id: 'saved-write-favorite', name: 'Synthetic saved-write favourite', aliases: [], sourceIdempotencyKey: meal.idempotencyKey };
    const approved = { explicit: true, estimateAccepted: true, expectedRevision: 0n, sourceRevision: 1n };
    const saved = await persistence.favorite(favorite, approved, signal());
    expect(saved).toMatchObject({ id: favorite.id, revision: '1', source_idempotency_key: meal.idempotencyKey, protein_grams: null });
    expect(await persistence.favorite(favorite, approved, signal())).toEqual(saved);
    expect(notifications.filter(source => source === 'daily.nutrition.favorites')).toHaveLength(1);
    const reviewed = new Map([[favorite.id, favoriteFingerprint(saved)]]);
    await persistence.correct({ ...meal, energyKcal: 200 }, 1n, signal());
    await expect(persistence.favorite(favorite, { ...approved, expectedRevision: 1n }, signal())).rejects.toThrow('reviewed source intake changed');
    expect((await persistence.favorite(favorite, { ...approved, expectedRevision: 1n, sourceRevision: 2n }, signal())).revision).toBe('2');
    const plan: PlanRequest = { id: 'saved-write-plan', name: 'Synthetic saved-write plan', description: null,
      entries: (['breakfast', 'lunch', 'dinner'] as const).map(slot => ({ slot, favoriteId: favorite.id })) };
    await expect(persistence.savePlan(plan, 0n, signal(), reviewed)).rejects.toThrow('reviewed plan favourite changed');
    const sources = await persistence.favoriteRecords([favorite.id, favorite.id], signal());
    expect(sources).toHaveLength(1);
    const current = new Map([[favorite.id, favoriteFingerprint(sources[0]!)]]);
    const result = await persistence.savePlan(plan, 0n, signal(), current);
    expect(result).toMatchObject({ revision: '1', energy_kcal: 600, protein_grams: null });
    expect(await persistence.savePlan(plan, 0n, signal(), current)).toEqual(result);
    expect(notifications.filter(source => source === 'daily.nutrition.plans')).toHaveLength(1);
    const otherStore = NutritionStore.forRequest(pool, request(other), now);
    await expect(otherStore.favoriteRecords([favorite.id], signal())).rejects.toThrow('owned favourite');
    expect(await otherStore.planRecord(plan.id, signal())).toBeNull();
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM daily.nutrition_queue')).recordset[0].count).toBe(0);
  });
  it('retains versioned clears and refuses delayed preference replays after newer intent without losing owner isolation', async () => {
    const key = 'saved-write-favorite'; const persistence = store();
    const favorite = (await persistence.favoriteRecords([key], signal()))[0]!;
    const reviewed = favoriteFingerprint(favorite);
    expect(await persistence.preferences([key], signal())).toEqual([]);
    expect((await persistence.feedback(key, 'like', signal(), 0n, reviewed))?.revision).toBe('1');
    expect((await persistence.feedback(key, 'like', signal(), 0n, reviewed))?.revision).toBe('1');
    expect(await persistence.feedback(key, null, signal(), 1n, reviewed)).toMatchObject({ preference: null, revision: '2' });
    await expect(persistence.feedback(key, 'like', signal(), 0n, reviewed)).rejects.toThrow('preference changed');
    expect((await persistence.feedback(key, null, signal(), 1n, reviewed))?.revision).toBe('2');
    expect((await persistence.feedback(key, 'dislike', signal(), 2n, reviewed))?.revision).toBe('3');
    await expect(persistence.feedback(key, null, signal(), 1n, reviewed)).rejects.toThrow('preference changed');
    expect(await persistence.disliked([key], signal())).toEqual(new Set([key]));
    expect(await NutritionStore.forRequest(pool, request(other), now).preferences([key], signal())).toEqual([]);
    await expect(persistence.feedback(key, null, signal(), 3n, '0'.repeat(64))).rejects.toThrow('reviewed favourite changed');
    expect(await persistence.preferences([key], signal())).toMatchObject([{ meal_key: key, preference: 'dislike', revision: '3' }]);
  });
  it('stores the first clear as revision 1 and rejects an older initial like', async () => {
    const persistence = store(); const key = 'definition';
    const reviewed = favoriteFingerprint((await persistence.favoriteRecords([key], signal()))[0]!);
    expect(await persistence.preferences([key], signal())).toEqual([]);
    const cleared = await persistence.feedback(key, null, signal(), 0n, reviewed);
    expect(cleared).toMatchObject({ meal_key: key, preference: null, revision: '1' });
    expect(await persistence.feedback(key, null, signal(), 0n, reviewed)).toEqual(cleared);
    await expect(persistence.feedback(key, 'like', signal(), 0n, reviewed)).rejects.toThrow('preference changed');
    expect(await persistence.preferences([key], signal())).toMatchObject([{ preference: null, revision: '1' }]);
  });
  it('binds internal intake to the owned favourite snapshot and keeps the source unchanged on refusal', async () => {
    const input = { id: 'internal-source', name: 'Internal source', aliases: [], definition: {
      mealName: 'Synthetic internal source', mealType: null, components: [], confidence: 'accurate' as const, provenance: {},
      energyKcal: 55, proteinGrams: null, carbohydratesGrams: null, fatGrams: null, fiberGrams: null,
    } };
    const saved = await store().favorite(input, { explicit: true, estimateAccepted: false, expectedRevision: 0n }, signal());
    const reviewed = { ...authority, favorite: { id: input.id, fingerprint: favoriteFingerprint(saved) } };
    await store().favorite({ ...input, definition: { ...input.definition, energyKcal: 66 } },
      { explicit: true, estimateAccepted: false, expectedRevision: 1n }, signal());
    const meal = { ...fixture('internal-log'), energyKcal: 55 };
    await expect(store().log(meal, reviewed, signal())).rejects.toThrow('favourite changed');
    expect(await store().intake(meal.idempotencyKey, signal())).toBeNull();
    const otherStore = NutritionStore.forRequest(pool, request(other), now);
    await expect(otherStore.log(meal, reviewed, signal())).rejects.toThrow('favourite changed');
    const latest = (await store().findFavorite(input.name, signal()))!;
    const accepted = { ...authority, favorite: { id: input.id, fingerprint: favoriteFingerprint(latest) } };
    expect(await store().log({ ...meal, energyKcal: 66 }, accepted, signal())).toMatchObject({ energy_kcal: 66, revision: '1' });
    expect(await store().log({ ...meal, energyKcal: 66 }, accepted, signal())).toMatchObject({ revision: '1' });
  });
  it('runs the internal source-to-SQL workflow with concurrent retry, favourite changes and deleted receipts', async () => {
    const notifications: string[] = [];
    const at = new Date(now()); const sessionId = randomUUID();
    const source = { id: '123456', sessionId, role: 'dan' as const, text: 'Log my favourite Internal source', model: null, at };
    const req = { ...request(owner), headers: {}, jarvisConversationMessage: source,
      server: { ownerObjectId: owner, conversationStore: { getSession: async () => ({
        id: sessionId, channel: 'voice', language: 'en', startedAt: at, endedAt: null,
      }) } } } as unknown as FastifyRequest;
    const tool = dailyFoodTool(request => NutritionStore.forRequest(pool, request, now, {
      publish: change => { notifications.push(...change.sources); },
    }), () => at.getTime());
    const results = await Promise.all(Array.from({ length: 6 }, () => tool.execute({ operation: 'log_favorite' }, req, signal())));
    expect(results.every(result => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(true);
    const saved = results[0] as { status: string; record: { idempotency_key: string; revision: string } };
    expect(saved).toMatchObject({ status: 'committed', record: { revision: '1', energy_kcal: 66, protein_grams: null,
      capture_method: 'voice', occurred_at: at.toISOString(), meal_date: '2026-10-12' } });
    expect(notifications).toEqual(['daily.nutrition.meals']);
    const current = (await store().findFavorite('Internal source', signal()))!;
    await store().favorite({ id: current.id as string, name: 'Internal source', aliases: [], definition: {
      mealName: 'Changed synthetic source', mealType: null, components: [], provenance: {}, confidence: 'accurate',
      energyKcal: 99, proteinGrams: null, carbohydratesGrams: null, fatGrams: null, fiberGrams: null,
    } }, { explicit: true, estimateAccepted: false, expectedRevision: BigInt(current.revision as string) }, signal());
    expect(await tool.execute({ operation: 'log_favorite' }, req, signal())).toEqual(saved);
    expect(notifications).toEqual(['daily.nutrition.meals']);
    await store().remove(saved.record.idempotency_key, 1n, signal());
    await expect(tool.execute({ operation: 'log_favorite' }, req, signal())).rejects.toThrow('not recreated');
    req.jarvisConversationMessage = { ...source, id: '123457', text: 'Log "Synthetic exact": 123.5 kcal, protein 10 g' };
    expect(await tool.execute({ operation: 'log_exact' }, req, signal())).toMatchObject({
      status: 'committed', record: { energy_kcal: 123.5, protein_grams: 10, fat_grams: null, capture_method: 'voice' },
    });
    req.jarvisConversationMessage = { ...source, id: '123458' };
    let prepared!: () => void; let firstMayCommit!: () => void;
    const firstPrepared = new Promise<void>(resolve => { prepared = resolve; });
    const commitGate = new Promise<void>(resolve => { firstMayCommit = resolve; });
    let read!: () => void; let secondMayContinue!: () => void;
    const secondRead = new Promise<void>(resolve => { read = resolve; });
    const readGate = new Promise<void>(resolve => { secondMayContinue = resolve; });
    const first = dailyFoodTool(request => {
      const persistence = NutritionStore.forRequest(pool, request, now);
      return { intake: persistence.intake.bind(persistence), lookupSaved: persistence.lookupSaved.bind(persistence),
        log: async (input, authority, signal) => { prepared(); await commitGate; return persistence.log(input, authority, signal); } };
    }, () => at.getTime());
    const second = dailyFoodTool(request => {
      const persistence = NutritionStore.forRequest(pool, request, now);
      let initial = true;
      return { lookupSaved: persistence.lookupSaved.bind(persistence), log: persistence.log.bind(persistence),
        intake: async (key, signal) => {
          const result = await persistence.intake(key, signal);
          if (initial) { initial = false; read(); await readGate; }
          return result;
        } };
    }, () => at.getTime());
    const firstWrite = first.execute({ operation: 'log_favorite' }, req, signal());
    let secondWrite: Promise<unknown> | undefined;
    try {
      await firstPrepared;
      secondWrite = second.execute({ operation: 'log_favorite' }, req, signal());
      await secondRead;
      firstMayCommit();
      const committed = await firstWrite;
      const latest = (await store().findFavorite('Internal source', signal()))!;
      await store().favorite({ id: latest.id as string, name: 'Internal source', aliases: [], definition: {
        mealName: 'Racing synthetic source', mealType: null, components: [], provenance: {}, confidence: 'accurate',
        energyKcal: 111, proteinGrams: null, carbohydratesGrams: null, fatGrams: null, fiberGrams: null,
      } }, { explicit: true, estimateAccepted: false, expectedRevision: BigInt(latest.revision as string) }, signal());
      secondMayContinue();
      expect(await secondWrite).toEqual(committed);
      expect(committed).toMatchObject({ status: 'committed', record: { energy_kcal: 99, revision: '1' } });
    } finally {
      firstMayCommit(); secondMayContinue();
      await Promise.allSettled([firstWrite, ...(secondWrite ? [secondWrite] : [])]);
    }
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM daily.nutrition_queue')).recordset[0].count).toBe(0);
  });
  it('requires actual one-time browser approvals for internal estimate/correction/deletion on real SQL', async () => {
    const at = new Date(now()); const sessionId = randomUUID();
    const controller = new AbortController();
    const notifications: string[] = [];
    const confirmations = createOwnerInteractionService({
      ownerObjectId: owner, store: createConfirmationStore(pool), onWebNotification: async () => {},
    });
    const source = { id: '223001', sessionId, role: 'dan' as const, text: 'I ate a synthetic portion; review the estimate.', model: null, at };
    const req = { ...request(owner), headers: {}, jarvisConversationMessage: source,
      server: { ownerObjectId: owner, ownerInteractions: confirmations, awayModeStore: { read: async () => ({ mode: 'present' }) },
        conversationStore: { getSession: async () => ({ id: sessionId, channel: 'voice', language: 'en', startedAt: at, endedAt: null }) } } } as unknown as FastifyRequest;
    const tool = dailyFoodReviewTool(request => NutritionStore.forRequest(pool, request, now, {
      publish: change => { notifications.push(...change.sources); },
    }), () => at.getTime());
    let active: Promise<unknown> | undefined;
    const review = async (input: unknown, decision: 'approve' | 'reject' = 'approve') => {
      active = tool.execute(input, req, controller.signal);
      const outcome = active.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
      await vi.waitFor(() => expect(confirmations.pendingBrowserConfirmations()).toHaveLength(1), { timeout: 10000 });
      const confirmation = confirmations.pendingBrowserConfirmations()[0]!;
      const remaining = Date.parse(confirmation.expiresAt) - Date.now();
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(120_000);
      expect(confirmation.summary).toContain('Nothing has changed');
      expect(await confirmations.resolveBrowserConfirmation(confirmation.id, decision)).toBe(true);
      const result = await outcome;
      expect(await confirmations.resolveBrowserConfirmation(confirmation.id, 'approve')).toBe(false);
      if (!result.ok) throw result.error;
      return result.value;
    };
    try {
      const input = { change: { operation: 'log_estimate', food: { mealName: 'Synthetic reviewed portion', energyKcal: 200 } } };
      const logged = await review(input) as { record: { idempotency_key: string } };
      expect(logged).toMatchObject({ status: 'committed', record: { energy_kcal: 200, protein_grams: null, confidence: 'estimate', capture_method: 'voice', revision: '1' } });
      expect(await tool.execute(input, req, controller.signal)).toEqual(logged);
      expect(notifications).toEqual(['daily.nutrition.meals']);
      const key = logged.record.idempotency_key;
      req.jarvisConversationMessage = { ...source, id: '223002', text: 'Correct this synthetic portion.' };
      const correction = { change: { operation: 'correct', idempotencyKey: key, expectedRevision: '1',
        changes: { energyKcal: 222, occurredAt: '2026-01-01T23:30:00Z' } } };
      const corrected = await review(correction);
      expect(corrected).toMatchObject({ status: 'committed', record: { energy_kcal: 222, meal_date: '2026-01-02', revision: '2' } });
      expect(await tool.execute(correction, req, controller.signal)).toEqual(corrected);
      expect(notifications).toHaveLength(2);
      req.jarvisConversationMessage = { ...source, id: '223003', text: 'Delete this synthetic portion.' };
      const deletion = { change: { operation: 'delete', idempotencyKey: key, expectedRevision: '2' } };
      await expect(review(deletion, 'reject')).rejects.toThrow('rejected');
      expect(await store().intake(key, signal())).toMatchObject({ deleted_at: null, revision: '2' });
      expect(notifications).toHaveLength(2);
      req.jarvisConversationMessage = { ...source, id: '223004', text: 'Now approve deletion of this synthetic portion.' };
      expect(await review(deletion)).toMatchObject({ status: 'committed', record: { energy_kcal: 222, revision: '3', deleted_at: expect.any(String) } });
      expect(await tool.execute(deletion, req, controller.signal)).toMatchObject({ status: 'already-deleted', record: { revision: '3' } });
      expect(notifications).toHaveLength(3);
      expect(confirmations.pendingBrowserConfirmations()).toEqual([]);
      expect((await pool.request().query('SELECT COUNT(*) AS count FROM daily.nutrition_queue')).recordset[0].count).toBe(0);
    } finally {
      controller.abort();
      if (active) await Promise.allSettled([active]);
    }
  });
  it('commits internal saved-food reviews once through real native approval, refreshes preferences and never logs intake', async () => {
    const at = new Date(now()); const sessionId = randomUUID(); const controller = new AbortController();
    const notifications: string[] = [];
    const mealsBefore = (await pool.request().query('SELECT COUNT(*) AS count FROM daily.nutrition_meals')).recordset[0].count;
    const confirmations = createOwnerInteractionService({
      ownerObjectId: owner, store: createConfirmationStore(pool), onWebNotification: async () => {},
    });
    const source = { id: '224001', sessionId, role: 'dan' as const, text: 'Review this synthetic saved-food change.', model: null, at };
    const req = { ...request(owner), headers: {}, jarvisConversationMessage: source,
      server: { ownerObjectId: owner, ownerInteractions: confirmations, awayModeStore: { read: async () => ({ mode: 'present' }) },
        conversationStore: { getSession: async () => ({ id: sessionId, channel: 'voice', language: 'en', startedAt: at, endedAt: null }) } } } as unknown as FastifyRequest;
    const tool = dailySavedFoodTool(request => NutritionStore.forRequest(pool, request, now, {
      publish: change => { notifications.push(...change.sources); },
    }), () => at.getTime());
    let active: Promise<unknown> | undefined;
    const review = async (input: unknown, decision: 'approve' | 'reject' = 'approve') => {
      active = tool.execute(input, req, controller.signal);
      const outcome = active.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
      await vi.waitFor(() => expect(confirmations.pendingBrowserConfirmations()).toHaveLength(1), { timeout: 10000 });
      const confirmation = confirmations.pendingBrowserConfirmations()[0]!;
      expect(confirmation.summary).toContain('Nothing has changed');
      expect(confirmation.summary.length).toBeLessThanOrEqual(4000);
      expect(Date.parse(confirmation.expiresAt) - Date.now()).toBeGreaterThan(0);
      expect(Date.parse(confirmation.expiresAt) - Date.now()).toBeLessThanOrEqual(120000);
      expect(await confirmations.resolveBrowserConfirmation(confirmation.id, decision)).toBe(true);
      const result = await outcome;
      expect(await confirmations.resolveBrowserConfirmation(confirmation.id, 'approve')).toBe(false);
      if (!result.ok) throw result.error;
      return result.value;
    };
    try {
      const favoriteInput = { operation: 'save_favorite', name: 'Internal native saved favourite', aliases: ['Internal native alias'],
        expectedRevision: '0', definition: { mealName: 'Synthetic saved portion', energyKcal: 200, proteinGrams: null, fatGrams: 0 } };
      const saved = await review(favoriteInput) as { record: { id: string } };
      expect(saved).toMatchObject({ status: 'committed', record: { revision: '1', energy_kcal: 200, protein_grams: null, confidence: 'estimate' } });
      expect(await tool.execute(favoriteInput, req, controller.signal)).toMatchObject({ status: 'already-applied' });
      const favoriteId = saved.record.id;
      expect(await tool.execute({ operation: 'lookup_saved', name: 'Internal native alias' }, req, controller.signal)).toMatchObject({
        source: 'favorite', intakeLogged: false, record: { id: favoriteId },
      });
      expect(notifications).toEqual(['daily.nutrition.favorites']);
      req.jarvisConversationMessage = { ...source, id: '224002' };
      const planInput = { operation: 'save_plan', name: 'Internal native saved plan', expectedRevision: '0', description: null,
        entries: ['breakfast', 'lunch', 'dinner'].map(slot => ({ slot, favoriteId })) };
      const savedPlan = await review(planInput) as { record: { id: string } };
      expect(savedPlan).toMatchObject({ status: 'committed', record: { revision: '1', energy_kcal: 600, protein_grams: null, fat_grams: 0 } });
      expect(await tool.execute(planInput, req, controller.signal)).toMatchObject({ status: 'already-applied' });
      req.jarvisConversationMessage = { ...source, id: '224003' };
      const like = { operation: 'set_feedback', favoriteId, expectedRevision: '0', preference: 'like' };
      expect(await review(like)).toMatchObject({ record: { preference: 'like', revision: '1' } });
      expect(await tool.execute(like, req, controller.signal)).toMatchObject({ status: 'already-applied' });
      req.jarvisConversationMessage = { ...source, id: '224004' };
      expect(await review({ ...like, expectedRevision: '1', preference: null })).toMatchObject({ record: { preference: null, revision: '2' } });
      expect(await tool.execute({ operation: 'read_preferences', favoriteIds: [favoriteId] }, req, controller.signal)).toMatchObject({
        records: [{ favoriteId, preference: null, revision: '2', status: 'cleared' }],
      });
      await expect(tool.execute(like, req, controller.signal)).rejects.toThrow('changed');
      expect(notifications).toEqual(['daily.nutrition.favorites', 'daily.nutrition.plans', 'daily.nutrition.favorites', 'daily.nutrition.favorites']);
      req.jarvisConversationMessage = { ...source, id: '224005' };
      const deletion = { operation: 'delete_plan', id: savedPlan.record.id, expectedRevision: '1' };
      await expect(review(deletion, 'reject')).rejects.toThrow('rejected');
      expect((await store().planRecord(savedPlan.record.id, signal()))?.deleted_at).toBeNull();
      expect(await review(deletion)).toMatchObject({ status: 'committed', record: { revision: '2', deleted_at: expect.any(String) } });
      expect(await tool.execute(deletion, req, controller.signal)).toMatchObject({ status: 'already-deleted' });
      expect(notifications).toHaveLength(5);
      expect(notifications[4]).toBe('daily.nutrition.plans');
      expect((await pool.request().query('SELECT COUNT(*) AS count FROM daily.nutrition_meals')).recordset[0].count).toBe(mealsBefore);
      expect((await pool.request().query('SELECT COUNT(*) AS count FROM daily.nutrition_queue')).recordset[0].count).toBe(0);
      expect(confirmations.pendingBrowserConfirmations()).toEqual([]);
    } finally {
      controller.abort();
      if (active) await Promise.allSettled([active]);
    }
  });
});
