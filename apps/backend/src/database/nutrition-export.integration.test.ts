import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations,readDownMigration,readMigrations,revertMigration } from './migrations.js';
import { NutritionStore } from '../daily/nutrition/store.js';
import type { MealInput } from '../daily/nutrition/model.js';
import { NutritionExportStore } from '../daily/nutrition-export/store.js';
import type { NutritionExportDevice } from '../daily/nutrition-export/auth.js';

const config = loadDatabaseConfig();
if (!config || process.env.NODE_ENV !== 'test' || config.server !== '127.0.0.1') throw new Error('Export tests require isolated loopback SQL Server');
const database = `jarvis_export_ci_${randomUUID().replaceAll('-','')}`;
const admin = new sql.ConnectionPool({ ...config,database: 'master' }); const pool = new sql.ConnectionPool({ ...config,database });
const owner = '11111111-1111-4111-8111-111111111111'; const other = '22222222-2222-4222-8222-222222222222';
const base = '2026-10-12T12:00:00.000Z'; let clock = base;
const now = () => clock; const signal = () => new AbortController().signal;
const range = { from: '2026-10-12T00:00:00Z',to: '2026-10-12T12:00:00Z' };
const confirmation = { intent: 'queue-nutrition-export' as const,explicit: true,confirmedPeriod: range };
const request = (id = owner) => ({ server: { ownerObjectId: id },principal: { objectId: id } }) as unknown as FastifyRequest;
const deviceRequest = (deviceId = 'phone-a',id = owner) => ({ server: { ownerObjectId: id },nutritionExportPrincipal: {
  kind: 'nutrition-export-device',scope: 'nutrition-export',ownerObjectId: id,deviceId,expiresAt: '2027-01-01T00:00:00Z',revoked: false,
} satisfies NutritionExportDevice }) as unknown as FastifyRequest;
const ownerStore = (id = owner) => NutritionExportStore.forOwner(pool,request(id),now);
const deviceStore = (deviceId = 'phone-a',id = owner) => NutritionExportStore.forDevice(pool,deviceRequest(deviceId,id),now);
const nutrition = (id = owner) => NutritionStore.forRequest(pool,request(id),now);
const meal = (id = '01'): MealInput => ({ id,idempotencyKey: `synthetic-${id}`,mealName: 'Synthetic meal',mealType: null,components: [],
  occurredAt: '2026-10-12T10:00:00+02:00',mealDate: '2026-10-12',expiresAt: '2028-01-01T00:00:00Z',energyKcal: 123.5,
  proteinGrams: null,carbohydratesGrams: 0,fatGrams: null,fiberGrams: null,confidence: 'accurate',captureMethod: 'text',provenance: {} });
const intakeAuthority = { intent: 'log-intake' as const,explicit: true,estimateAccepted: false,proposalRequired: false };
const log = (id = '01',ownerId = owner) => nutrition(ownerId).log(meal(id),intakeAuthority,signal());
const queue = (key = 'queue') => ownerStore().queue(key,range,confirmation,signal());
const migrations = async () => (await readMigrations()).filter(({ name }) => /^004[1234]_daily/u.test(name));
const rows = async () => (await pool.request().query('SELECT * FROM daily.nutrition_queue ORDER BY id')).recordset;
beforeAll(async () => { await admin.connect(); await admin.request().batch(`CREATE DATABASE [${database}];`); await pool.connect(); await applyMigrations(pool,await migrations()); });
beforeEach(async () => { clock = base; await pool.request().batch('DELETE daily.nutrition_export_claims; DELETE daily.nutrition_export_requests; DELETE daily.nutrition_queue; DELETE daily.nutrition_meals;'); });
afterAll(async () => { await pool.close(); if (admin.connected) await admin.request().batch(`IF DB_ID(N'${database}') IS NOT NULL BEGIN ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}]; END;`); await admin.close(); });
describe('inactive nutrition export on isolated SQL Server',() => {
  it('keeps food logging independent and queues an exact confirmed half-open period idempotently',async () => {
    await log(); await log('1'); await log('other-owner',other);
    await nutrition().log({ ...meal('boundary'),occurredAt: range.to,mealDate: '2026-10-12' },intakeAuthority,signal());
    expect(await rows()).toEqual([]);
    await expect(ownerStore().queue('bad',range,{ ...confirmation,explicit: false },signal())).rejects.toThrow();
    const outcomes = await Promise.all(Array.from({ length: 5 },() => queue()));
    expect(outcomes).toEqual(Array.from({ length: 5 },() => ({ queued: 2,skipped: 0 })));
    expect((await rows()).map(row => row.id)).toEqual(['01','1']);
    expect((await rows())[0]).toMatchObject({ energy_kcal: 123.5,protein_grams: null,source_revision: '1',occurred_at: meal().occurredAt });
    await expect(ownerStore().queue('queue ',range,confirmation,signal())).rejects.toThrow('conflicts');
    await expect(ownerStore().queue('queue',{ ...range,to: '2026-10-14T00:00:00Z' },{ ...confirmation,confirmedPeriod: { ...range,to: '2026-10-14T00:00:00Z' } },signal())).rejects.toThrow('conflicts');
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM daily.nutrition_meals')).recordset[0].count).toBe(4);
  });
  it('conditionally claims across devices and never replays native-write instructions after response loss',async () => {
    await log(); await log('1'); await queue();
    const results = await Promise.all([deviceStore().claim({ operationKey: 'a',limit: 1 },signal()),deviceStore('phone-b').claim({ operationKey: 'b',limit: 1 },signal())]);
    expect(new Set(results.flatMap(result => result.items.map(item => item.id))).size).toBe(2);
    expect(results[0].items[0]?.nutrients).toEqual({ caloriesKcal: 123.5,proteinGrams: null,carbohydratesGrams: 0,fatGrams: null,fiberGrams: null });
    expect(await deviceStore().claim({ operationKey: 'a',limit: 1 },signal())).toMatchObject({ state: 'reconciliation-required',items: [] });
    await expect(deviceStore('phone-b').claim({ operationKey: 'a',limit: 1 },signal())).rejects.toThrow('conflicts');
    await expect(deviceStore().claim({ operationKey: 'a',limit: 2 },signal())).rejects.toThrow('conflicts');
    expect((await rows()).map(row => row.status)).toEqual(['claimed','claimed']);
  });
  it('ACK retry is harmless and conflicting/wrong-device/owner/padded receipts cannot complete a claim',async () => {
    await log(); await queue(); const claimed = await deviceStore().claim({ operationKey: 'a' },signal());
    const ack = { id: '01',claimToken: claimed.claimToken,status: 'written' as const };
    await expect(deviceStore('phone-b').complete(ack,signal())).rejects.toThrow();
    await expect(deviceStore('phone-a',other).complete(ack,signal())).rejects.toThrow();
    await expect(deviceStore().complete({ ...ack,id: '01 ' },signal())).rejects.toThrow();
    expect(await deviceStore().complete(ack,signal())).toMatchObject({ state: 'written',replay: false,completedAt: base });
    clock = '2026-10-12T12:10:00Z';
    expect(await deviceStore().complete({ ...ack,writer: 'Apple Shortcuts' },signal())).toMatchObject({ state: 'written',replay: true,completedAt: base });
    await expect(deviceStore().complete({ ...ack,writer: 'Different writer' },signal())).rejects.toThrow();
    await expect(deviceStore().complete({ ...ack,status: 'failed',error: 'Synthetic' },signal())).rejects.toThrow();
    expect((await deviceStore().claim({ operationKey: 'next' },signal())).items).toEqual([]);
  });
  it('expires claims exactly at five minutes to uncertainty, never automatic pending retry',async () => {
    await log(); await queue(); const claimed = await deviceStore().claim({ operationKey: 'a' },signal());
    expect(claimed.claimExpiresAt).toBe('2026-10-12T12:05:00.000Z'); clock = claimed.claimExpiresAt;
    await expect(deviceStore().complete({ id: '01',claimToken: claimed.claimToken,status: 'written' },signal())).rejects.toThrow();
    expect((await rows())[0].status).toBe('uncertain');
    expect((await deviceStore().claim({ operationKey: 'later' },signal())).items).toEqual([]);
    expect((await nutrition().intake('synthetic-01',signal()))?.energy_kcal).toBe(123.5);
  });
  it('records partial native failure and requires explicit checked reconciliation without requeue',async () => {
    await log(); await queue(); const claimed = await deviceStore().claim({ operationKey: 'a' },signal());
    const ack = { id: '01',claimToken: claimed.claimToken,status: 'failed' as const,error: 'Synthetic energy written, macro outcome unknown' };
    expect(await deviceStore().complete(ack,signal())).toMatchObject({ state: 'uncertain' });
    expect(await deviceStore().complete(ack,signal())).toMatchObject({ state: 'uncertain',replay: true });
    const authority = { intent: 'reconcile-nutrition-export' as const,explicit: true,checkedInHealth: true,evidence: 'partial-or-unknown' as const };
    await expect(ownerStore().reconcile('01',{ ...authority,checkedInHealth: false },signal())).rejects.toThrow();
    expect(await ownerStore().reconcile('01',authority,signal())).toEqual({ state: 'uncertain' });
    expect(await ownerStore().reconcile('01',{ ...authority,evidence: 'all-samples-present' },signal())).toEqual({ state: 'written' });
    expect((await deviceStore().claim({ operationKey: 'later' },signal())).items).toEqual([]);
    expect((await rows())[0].receipt_json).toContain('failed'); // Preserve the original receipt/evidence.
  });
  it('confirmed absence is terminal evidence, not permission to issue another native write',async () => {
    await log(); await queue(); await deviceStore().claim({ operationKey: 'a' },signal()); clock = '2026-10-12T12:05:00Z';
    const authority = { intent: 'reconcile-nutrition-export' as const,explicit: true,checkedInHealth: true,evidence: 'all-samples-absent' as const };
    expect(await ownerStore().reconcile('01',authority,signal())).toEqual({ state: 'reconciled_absent' });
    expect(await queue('again')).toEqual({ queued: 0,skipped: 1 });
    expect((await deviceStore().claim({ operationKey: 'later' },signal())).items).toEqual([]);
  });
  it.each(['correct','delete'])('rejects a %s snapshot changed before claim without rewriting measurements',async action => {
    await log(); await queue();
    if (action === 'correct') await nutrition().correct({ ...meal(),energyKcal: 222 },1n,signal());
    else await nutrition().remove('synthetic-01',1n,signal());
    expect((await deviceStore().claim({ operationKey: 'a' },signal())).items).toEqual([]);
    expect((await rows())[0]).toMatchObject({ status: 'cancelled',energy_kcal: 123.5,source_revision: '1' });
    expect((await nutrition().intake('synthetic-01',signal()))?.energy_kcal).toBe(action === 'correct' ? 222 : 123.5);
  });
  it.each(['correct','delete'])('retains claimed %s snapshot but marks its later written ACK out_of_sync',async action => {
    await log(); await queue(); const claimed = await deviceStore().claim({ operationKey: 'a' },signal());
    if (action === 'correct') await nutrition().correct({ ...meal(),energyKcal: 222 },1n,signal());
    else await nutrition().remove('synthetic-01',1n,signal());
    expect(await deviceStore().complete({ id: '01',claimToken: claimed.claimToken,status: 'written' },signal())).toMatchObject({ state: 'out_of_sync' });
    expect((await rows())[0]).toMatchObject({ status: 'out_of_sync',energy_kcal: 123.5,source_revision: '1' });
    expect((await deviceStore().claim({ operationKey: 'next' },signal())).items).toEqual([]);
  });
  it('marks corrections to written meals out_of_sync and never queues failed/out_of_sync/legacy-written meals',async () => {
    await log(); await queue(); const claimed = await deviceStore().claim({ operationKey: 'a' },signal());
    await deviceStore().complete({ id: '01',claimToken: claimed.claimToken,status: 'written' },signal());
    await nutrition().correct({ ...meal(),energyKcal: 222 },1n,signal());
    expect((await pool.request().query("SELECT apple_health_status FROM daily.nutrition_meals WHERE id=N'01'")).recordset[0].apple_health_status).toBe('out_of_sync');
    await log('legacy'); await pool.request().query("UPDATE daily.nutrition_meals SET apple_health_status=N'written' WHERE id=N'legacy';");
    expect(await queue('again')).toEqual({ queued: 0,skipped: 2 });
    expect((await deviceStore().claim({ operationKey: 'later' },signal())).items).toEqual([]);
  });
  it('expires pending eligibility after seven days and denies revoked/mixed principals',async () => {
    await log(); await queue(); clock = '2026-10-19T12:00:00Z';
    expect((await deviceStore().claim({ operationKey: 'late' },signal())).items).toEqual([]);
    expect((await rows())[0].status).toBe('expired');
    const revoked = deviceRequest(); revoked.nutritionExportPrincipal!.revoked = true;
    expect(() => NutritionExportStore.forDevice(pool,revoked,now)).toThrow();
    expect(() => NutritionExportStore.forDevice(pool,{ ...deviceRequest(),principal: request().principal } as FastifyRequest,now)).toThrow();
  });
  it('rolls back an oversized claim response before issuing any native-write instructions',async () => {
    for (let i = 0; i < 10; i++) await nutrition().log({ ...meal(`large-${i}`),components: ['界'.repeat(10000)] },intakeAuthority,signal());
    await queue();
    await expect(deviceStore().claim({ operationKey: 'large' },signal())).rejects.toThrow('unavailable');
    expect((await rows()).every(row => row.status === 'pending')).toBe(true);
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM daily.nutrition_export_claims')).recordset[0].count).toBe(0);
    expect((await deviceStore().claim({ operationKey: 'small',limit: 1 },signal())).items).toHaveLength(1);
  });
  it('executes guarded rollback only with empty export evidence and preserves canonical meals',async () => {
    await log(); await queue();
    await expect(revertMigration(pool,await migrations(),await readDownMigration('0044_daily_nutrition_export.sql'))).rejects.toThrow('requires empty');
    expect((await rows())[0].id).toBe('01');
    await pool.request().batch('DELETE daily.nutrition_export_claims; DELETE daily.nutrition_export_requests; DELETE daily.nutrition_queue;');
    await revertMigration(pool,await migrations(),await readDownMigration('0044_daily_nutrition_export.sql'));
    expect((await nutrition().intake('synthetic-01',signal()))?.energy_kcal).toBe(123.5);
    await applyMigrations(pool,await migrations());
  });
});
