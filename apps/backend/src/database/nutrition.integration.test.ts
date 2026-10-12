import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readMigrations, readDownMigration, revertMigration } from './migrations.js';
import { NutritionStore } from '../daily/nutrition/store.js';
import { type FoodDefinition, type MealInput, type PlanRequest } from '../daily/nutrition/model.js';

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
  await applyMigrations(pool, (await readMigrations()).filter(({ name }) => /^004[123]_daily/u.test(name)));
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
    await expect(revertMigration(pool, (await readMigrations()).filter(({ name }) => /^004[123]_daily/u.test(name)), await readDownMigration('0043_daily_favorite_definitions.sql'))).rejects.toThrow('cannot discard');
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
});
