import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import sql from 'mssql';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readDownMigration, readMigrations, revertMigration } from './migrations.js';
import { SqlHealthBuffer } from '../daily/health-upload/sql-buffer.js';
import { SqlHealthCapabilities } from '../daily/health-upload/sql-capabilities.js';
import { HealthConflict, HealthUnavailable, sha256, type HealthCapability, type HealthKind } from '../daily/health-upload/contracts.js';
import { SqlHealthProcessor, processingRetryDelays } from '../daily/health/processor.js';
import { DailyHealthReadModel } from '../daily/health/read-model.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { dailySourceTools } from '../daily/tools/source-tools.js';
import type { NutritionStore } from '../daily/nutrition/store.js';
import type { DailyCoachStore } from '../daily/coach-store.js';
import { healthUploadLimit } from '../daily/health-upload/contracts.js';

const configuration = loadDatabaseConfig();
if (!configuration || process.env.NODE_ENV !== 'test' || configuration.server !== '127.0.0.1') throw new Error('Health tests require isolated loopback SQL Server');
const database = `jarvis_health_processing_ci_${randomUUID().replaceAll('-', '')}`;
const admin = new sql.ConnectionPool({ ...configuration, database: 'master' });
const pool = new sql.ConnectionPool({ ...configuration, database });
const owner = '11111111-1111-4111-8111-111111111111'; const other = '22222222-2222-4222-8222-222222222222';
const filename = '0047_daily_health_processing.sql';
const base = Date.parse('2026-10-13T18:00:00.000Z'); let clock = base; let serial = 0;
const now = () => clock; const signal = () => new AbortController().signal;
const migrations = async () => (await readMigrations()).filter(({ name }) =>
  ['0041_daily_owner_schema.sql', '0046_daily_health_upload_inbox.sql', filename, '0060_daily_health_processing_state.sql'].includes(name));
const processor = (id = owner) => new SqlHealthProcessor(pool, id, now);
const readModel = (id = owner) => DailyHealthReadModel.forRequest(pool, { server: { ownerObjectId: id }, principal: { objectId: id } } as unknown as FastifyRequest);
const workout = (id = 'synthetic-workout', hr = 100) => ({ id, name: 'Traditional Strength Training', start: '2026-10-13T08:00:00Z', duration: 3600,
  activeEnergyBurned: { qty: 100, units: 'kcal' }, heartRateData: [{ date: '2026-10-13T08:00:10Z', qty: hr, units: 'bpm' }], metadata: { synthetic: true } });
const payload = (qty = 100, workouts = [workout('one'), workout('two')]) => ({ data: { workouts, metrics: [
  { name: 'step_count', units: 'count', data: [{ date: '2026-10-13', qty }] },
  { name: 'sleep_analysis', units: 'hr', data: [{ date: '2026-10-13', totalSleep: 7, core: 4, deep: 2, rem: 1 }] },
] } });
const raw = (value: unknown) => Buffer.from(JSON.stringify(value));
const tableNames = ['health_workout_heart_rate_minute', 'health_workout_metrics', 'health_workouts', 'health_daily_metrics', 'health_sleep_daily', 'health_sync_feeds', 'health_sync_state', 'health_phone_sync_state', 'health_ingestions', 'health_upload_inbox', 'health_upload_capabilities'] as const;
const rows = async (table: typeof tableNames[number]) => (await pool.request().query(`SELECT * FROM daily.[${table}]`)).recordset;
const apps: ReturnType<typeof buildApp>[] = [];
const inbox = () => rows('health_upload_inbox');
async function provision(id = owner) {
  const capabilities = new SqlHealthCapabilities(pool, id, now);
  const operation = capabilities.prepare({ deviceId: 'synthetic-phone', permissions: ['health-ingest', 'health-heartbeat'] as HealthCapability['permissions'], expiresAt: '2099-01-01T00:00:00.000Z' });
  await capabilities.issue(operation, signal());
  const capability = await operation.useSecret(token => capabilities.verify(token, signal()));
  if (!capability) throw new Error('Synthetic capability unavailable');
  return { operation, capability, buffer: new SqlHealthBuffer(pool, id, { now }) };
}
async function accept(device: Awaited<ReturnType<typeof provision>>, value: unknown = payload(), session = `synthetic-session-${serial++}`, kind: HealthKind = 'upload') {
  const bytes = Buffer.isBuffer(value) ? value : raw(value);
  return device.buffer.accept(kind, device.capability, { automationId: 'synthetic-automation', sessionId: session }, bytes, signal(), device.operation.reference);
}
async function failFinalCommit() {
  await pool.request().batch(`CREATE TRIGGER daily.synthetic_fail_health_processed ON daily.health_upload_inbox AFTER UPDATE AS
    IF EXISTS(SELECT 1 FROM inserted WHERE processing_status='processed') THROW 51090,'synthetic-transaction-failure',1;`);
}
beforeAll(async () => {
  await admin.connect(); await admin.request().batch(`CREATE DATABASE [${database}];`); await pool.connect();
  await applyMigrations(pool, await migrations());
});
beforeEach(async () => {
  clock = base; serial = 0;
  await pool.request().batch('DROP TRIGGER IF EXISTS daily.synthetic_fail_health_processed;');
  for (const table of tableNames) await pool.request().batch(`DELETE daily.[${table}];`);
});
afterAll(async () => {
  await Promise.all(apps.map(app => app.close()));
  await pool.close();
  if (admin.connected) await admin.request().batch(`IF DB_ID(N'${database}') IS NOT NULL BEGIN ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}]; END;`);
  await admin.close();
});

describe('inactive processor on real isolated SQL Server, synthetic records only', () => {
  it('applies once and leaves all tables empty without automatic processing', async () => {
    expect(await applyMigrations(pool, await migrations())).toEqual([]);
    expect(await processor().processNext(signal())).toEqual({ state: 'idle' });
    for (const table of tableNames) expect(await rows(table)).toEqual([]);
  });
  it('creates, rotates and revokes hashed owner credentials without cross-owner visibility', async () => {
    const capabilities = new SqlHealthCapabilities(pool, owner, now);
    const otherCapabilities = new SqlHealthCapabilities(pool, other, now);
    const first = capabilities.prepare({ deviceId: 'synthetic-phone', permissions: ['health-ingest', 'health-heartbeat'], expiresAt: '2099-01-01T00:00:00.000Z' });
    expect(await capabilities.create(first, signal())).toEqual({ state: 'issued' });
    const firstToken = await first.useSecret(async value => value);
    expect(await capabilities.verify(firstToken, signal())).toMatchObject({ ownerObjectId: owner });
    expect(await capabilities.status(signal())).toMatchObject({ state: 'active' });
    expect(await otherCapabilities.status(signal())).toEqual({ state: 'empty', expiresAt: null });
    expect(await otherCapabilities.verify(firstToken, signal())).toBeNull();
    const stored = await pool.request().input('owner', sql.UniqueIdentifier, owner)
      .query('SELECT token_hash FROM daily.health_upload_capabilities WHERE owner_object_id=@owner');
    expect(stored.recordset).toEqual([{ token_hash: sha256(firstToken) }]);

    const replacement = capabilities.prepare({ deviceId: 'synthetic-phone', permissions: ['health-ingest', 'health-heartbeat'], expiresAt: '2099-01-01T00:00:00.000Z' });
    expect(await capabilities.rotateCurrent(replacement, signal())).toEqual({ state: 'issued' });
    const replacementToken = await replacement.useSecret(async value => value);
    expect(await capabilities.verify(firstToken, signal())).toBeNull();
    expect(await capabilities.verify(replacementToken, signal())).toMatchObject({ ownerObjectId: owner });
    expect(await capabilities.revokeCurrent(signal())).toEqual({ state: 'revoked' });
    expect(await capabilities.verify(replacementToken, signal())).toBeNull();
    expect(await capabilities.status(signal())).toMatchObject({ state: 'revoked' });
    expect(await otherCapabilities.status(signal())).toEqual({ state: 'empty', expiresAt: null });
  });
  it('proves owner credential → HTTP upload → worker → read model and native summary with replay safeguards', async () => {
    const backendConfig = loadConfig({});
    const capabilityStore = new SqlHealthCapabilities(pool, owner, now);
    // The authentication hook only forwards tokens shaped like a JWT (three base64url segments).
    const ownerJwt = 'synthetic.owner.jwt';
    const foreignJwt = 'synthetic.foreign.jwt';
    const ownerAuth = {
      authorization: ['Bearer', ownerJwt].join(' '),
    };
    const foreignAuth = {
      authorization: ['Bearer', foreignJwt].join(' '),
    };
    const instance = buildApp({ ...backendConfig, auth: { ...backendConfig.auth, ownerObjectId: owner } }, undefined, {
      modules: [],
      auth: async token => {
        if (token === ownerJwt) return { objectId: owner, tenantId: backendConfig.auth.tenantId, displayName: 'Synthetic owner' };
        if (token === foreignJwt) return { objectId: other, tenantId: backendConfig.auth.tenantId, displayName: 'Synthetic foreign owner' };
        return null;
      },
      healthUpload: {
        enabled: true,
        buffer: new SqlHealthBuffer(pool, owner, { now }),
        verifier: capabilityStore.verify,
      },
      healthProcessor: processor(),
      healthCapabilities: capabilityStore,
    });
    apps.push(instance);
    await instance.ready();
    const credential = await instance.inject({
      method: 'POST', url: '/api/health/upload-credential', headers: ownerAuth, payload: { action: 'create' },
    });
    expect(credential.statusCode).toBe(200);
    expect(credential.headers['cache-control']).toBe('no-store');
    const token = credential.json().token as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43,256}$/u);

    const bytes = raw(payload(120, [workout('synthetic-e2e-workout', 120)]));
    const upload = (bearer: string, sessionId: string, body: Buffer = bytes) => instance.inject({
      method: 'POST',
      url: '/api/health/ingest',
      headers: {
        authorization: ['Bearer', bearer].join(' '),
        'content-type': 'application/json',
        'automation-id': 'synthetic-automation',
        'session-id': sessionId,
      },
      payload: body,
    });

    expect((await instance.inject({ method: 'GET', url: '/api/health/upload-credential', headers: foreignAuth })).statusCode).toBe(403);
    expect((await upload('synthetic-invalid-token', 'synthetic-bad-token')).statusCode).toBe(403);
    const first = await upload(token, 'synthetic-e2e-session');
    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({ status: 'accepted', storage: 'sql', processing: 'not-confirmed', duplicate: false });
    expect((await upload(token, 'synthetic-e2e-session')).json()).toMatchObject({ duplicate: true });
    expect((await upload(token, 'synthetic-e2e-session', raw(payload(121)))).statusCode).toBe(409);
    expect((await upload(token, 'synthetic-oversize', Buffer.alloc(healthUploadLimit + 1, 0x20))).statusCode).toBe(413);

    const foreignCapabilities = new SqlHealthCapabilities(pool, other, now);
    const foreignOperation = foreignCapabilities.prepare({
      deviceId: 'synthetic-foreign-phone',
      permissions: ['health-ingest'],
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    await foreignCapabilities.create(foreignOperation, signal());
    const foreignToken = await foreignOperation.useSecret(value => value);
    expect((await upload(foreignToken, 'synthetic-wrong-owner')).statusCode).toBe(403);

    const request = {
      server: { ownerObjectId: owner },
      principal: { objectId: owner },
    } as unknown as FastifyRequest;
    const read = readModel();
    const data = { query: {} as never, changes: {} as never, health: () => read };
    const sourceTools = dailySourceTools(data, () => ({} as NutritionStore), () => ({} as DailyCoachStore), now);
    await vi.waitFor(async () => {
      expect((await read.sync(signal())).inbox).toMatchObject({ accepted: 0, processing: 0, succeeded: 1, quarantined: 0 });
    }, { timeout: 10_000, interval: 25 });
    const metricRows = await read.history('metrics', { startDate: '2026-10-13', endDate: '2026-10-13', limit: 100 }, signal());
    expect(metricRows.items).toEqual(expect.arrayContaining([expect.objectContaining({ metric_name: 'step_count', value: 120 })]));
    const summary = await sourceTools[0]!.execute({ operation: 'get_health_summary' }, request, signal()) as Record<string, unknown>;
    expect(summary).toMatchObject({ status: 'available', today: { date: '2026-10-13' } });

    clock = base - 1000;
    const partial = raw({ data: { metrics: [{ name: 'step_count', units: 'count', data: [{ date: '2026-10-13', qty: 40 }] }], workouts: [] } });
    expect((await upload(token, 'synthetic-older-partial', partial)).statusCode).toBe(202);
    await vi.waitFor(async () => {
      expect((await read.sync(signal())).inbox).toMatchObject({ accepted: 0, processing: 0, succeeded: 2, quarantined: 0 });
    }, { timeout: 10_000, interval: 25 });
    const afterReplay = await read.history('metrics', { startDate: '2026-10-13', endDate: '2026-10-13', limit: 100 }, signal());
    expect(afterReplay.items).toEqual(expect.arrayContaining([expect.objectContaining({ metric_name: 'step_count', value: 120 })]));

    clock = base + 1000;
    const laterPartial = raw({ data: { metrics: [{ name: 'step_count', units: 'count', data: [{ date: '2026-10-13', qty: 40 }] }], workouts: [] } });
    expect((await upload(token, 'synthetic-later-partial', laterPartial)).statusCode).toBe(202);
    await vi.waitFor(async () => {
      expect((await read.sync(signal())).inbox).toMatchObject({ accepted: 0, processing: 0, succeeded: 3, quarantined: 0 });
    }, { timeout: 10_000, interval: 25 });
    const afterLaterPartial = await read.history('metrics', { startDate: '2026-10-13', endDate: '2026-10-13', limit: 100 }, signal());
    expect(afterLaterPartial.items).toEqual(expect.arrayContaining([expect.objectContaining({ metric_name: 'step_count', value: 40 })]));

    const revoked = await instance.inject({ method: 'POST', url: '/api/health/upload-credential', headers: ownerAuth, payload: { action: 'revoke' } });
    expect(revoked.statusCode).toBe(200);
    expect((await upload(token, 'synthetic-revoked')).statusCode).toBe(403);
    // Stop this app's background worker now so it cannot claim rows created by later tests.
    await instance.close();
    apps.splice(apps.indexOf(instance), 1);
  });
  it('reports accepted, processing and succeeded inbox states truthfully across a processor restart', async () => {
    const device = await provision();
    const receipt = await accept(device);
    expect((await readModel().sync(signal())).inbox).toMatchObject({ accepted: 1, processing: 0, succeeded: 0, quarantined: 0 });

    await pool.request().input('id', sql.UniqueIdentifier, receipt.acceptanceId).input('lease', sql.DateTime2(3), new Date(clock + 45_000))
      .query("UPDATE daily.health_upload_inbox SET processing_status='processing',processing_attempts=1,processing_next_attempt_at=@lease WHERE acceptance_id=@id;");
    expect((await readModel().sync(signal())).inbox).toMatchObject({ accepted: 0, processing: 1, succeeded: 0, quarantined: 0 });
    clock += 45_001;
    expect(await processor().processNext(signal())).toMatchObject({ state: 'processed', acceptanceId: receipt.acceptanceId });
    expect((await readModel().sync(signal())).inbox).toMatchObject({ accepted: 0, processing: 0, succeeded: 1, quarantined: 0 });
  });
  it('commits exact raw lineage, normalization and freshness together once across concurrent processors/reconstruction', async () => {
    const device = await provision(); const bytes = raw(payload()); const receipt = await accept(device, bytes, 'same');
    expect((await readModel().sync(signal())).feeds).toEqual([]);
    const results = await Promise.all([processor().processNext(signal()), processor().processNext(signal())]);
    expect(results.filter(row => row.state === 'processed')).toHaveLength(1);
    expect(await processor().processNext(signal())).toEqual({ state: 'idle' });
    expect(await accept(device, bytes, 'same')).toMatchObject({ acceptanceId: receipt.acceptanceId, duplicate: true });
    await expect(accept(device, payload(200), 'same')).rejects.toBeInstanceOf(HealthConflict);
    expect((await inbox())[0]).toMatchObject({ raw_bytes: bytes, checksum: sha256(bytes), processing_status: 'processed', processing_attempts: 1 });
    expect(await rows('health_ingestions')).toHaveLength(1);
    // mssql preserves bigint as decimal text; do not narrow the storage contract to a JS number.
    expect((await rows('health_ingestions'))[0]).toMatchObject({ id: receipt.acceptanceId, status: 'succeeded', content_bytes: String(bytes.length) });
    expect(await rows('health_workouts')).toHaveLength(2); expect(await rows('health_workout_heart_rate_minute')).toHaveLength(2);
    expect((await rows('health_sleep_daily'))[0]).toMatchObject({ total_sleep_hours: 7, deep_hours: 2 });
    expect((await rows('health_daily_metrics')).find(row => row.metric_name === 'step_count')).toMatchObject({ value: 100, ingestion_id: receipt.acceptanceId });
    expect((await readModel().sync(signal())).feeds).toEqual(expect.arrayContaining([
      expect.objectContaining({ feed_kind: 'metrics', accepted_evidence_at: new Date(base).toISOString(), processed_committed_at: new Date(base).toISOString() }),
      expect.objectContaining({ feed_kind: 'workouts' }),
    ]));
  });
  it('accepts an empty workout export without erasing prior sessions or minute details', async () => {
    const device = await provision(); await accept(device); await processor().processNext(signal());
    const prior = await rows('health_workouts'); const details = await rows('health_workout_heart_rate_minute');
    clock += 1000; await accept(device, { data: { workouts: [] } }); await processor().processNext(signal());
    expect(await rows('health_workouts')).toEqual(prior); expect(await rows('health_workout_heart_rate_minute')).toEqual(details);
    const feeds = (await readModel().sync(signal())).feeds;
    expect(feeds.find(row => row.feed_kind === 'workouts')?.accepted_evidence_at).toBe(new Date(clock).toISOString());
    expect(feeds.find(row => row.feed_kind === 'metrics')?.accepted_evidence_at).toBe(new Date(base).toISOString());
  });
  it('reads canonical BPM summaries and minute series back from SQL without inventing missing units or values', async () => {
    const device = await provision();
    const declared = { ...workout('declared'), avgHeartRate: { qty: 110, units: 'count/min' }, maxHeartRate: { qty: 120, units: 'beats/min' },
      heartRateData: [{ date: '2026-10-13T08:00:10Z', qty: 100, units: 'count/min' }, { date: '2026-10-13T08:00:50Z', qty: 120, units: 'BPM' }] };
    const bytes = raw({ data: { workouts: [declared,
      { ...workout('nested'), heartRate: { unit: 'beats/min', avg: { qty: 115 }, Max: 155 } },
      { ...workout('implicit'), avgHeartRate: { qty: 105 }, maxHeartRate: { qty: 145 } },
      { ...workout('zero'), avgHeartRate: { qty: 0 }, maxHeartRate: { qty: 0 } },
      { ...workout('unknown'), heartRateData: [{ date: '2026-10-13T08:00:10Z', qty: 95 }] },
    ], metrics: [{ name: 'resting_heart_rate', units: 'count/min', data: [{ date: '2026-10-13', qty: 60 }] },
      { name: 'heart_rate_variability_sdnn', units: 'ms', data: [{ date: '2026-10-13', qty: 45 }] }] } });
    await accept(device, bytes); expect(await processor().processNext(signal())).toMatchObject({ state: 'processed' });
    const history = (await readModel().history('workouts', { startDate: '2026-10-13', endDate: '2026-10-13' }, signal())).items;
    for (const [id, avg_heart_rate, max_heart_rate] of [['declared', 110, 120], ['nested', 115, 155], ['implicit', 105, 145], ['zero', 0, 0], ['unknown', null, null]]) {
      expect(history.find(row => row.id === id)).toMatchObject({ avg_heart_rate, max_heart_rate });
    }
    expect((await readModel().heartRate('declared', {}, signal())).items[0]).toMatchObject({ unit: 'bpm', min_value: 100, avg_value: 110, max_value: 120 });
    expect((await readModel().heartRate('unknown', {}, signal())).items[0]).toMatchObject({ unit: null, avg_value: 95 });
    const details = await rows('health_workout_metrics');
    expect(details.find(row => row.workout_id === 'declared' && row.metric_name === 'avg_heart_rate')).toMatchObject({ value: 110, unit: 'bpm' });
    expect(details.find(row => row.workout_id === 'implicit' && row.metric_name === 'avg_heart_rate')).toMatchObject({ value: 105, unit: null });
    expect((await readModel().history('metrics', { startDate: '2026-10-13', endDate: '2026-10-13' }, signal())).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric_name: 'resting_heart_rate', value: 60, unit: 'bpm' }),
      expect.objectContaining({ metric_name: 'heart_rate_variability_sdnn', value: 45, unit: 'ms' }),
    ]));
    expect(await readModel().workoutDetail('declared', signal())).toMatchObject({ detail: { avgHeartRate: { qty: 110, units: 'count/min' } } });
    expect((await inbox())[0]).toMatchObject({ raw_bytes: bytes, checksum: sha256(bytes), processing_status: 'processed' });
  });
  it('quarantines unsupported heart-rate units without domain writes or false processed freshness and retains raw evidence', async () => {
    const device = await provision(); await accept(device); await processor().processNext(signal());
    const domainTables = tableNames.filter(table => !['health_upload_inbox', 'health_upload_capabilities'].includes(table));
    const before = await Promise.all(domainTables.map(rows));
    const badWorkouts = [
      { avgHeartRate: { qty: 2, units: 'Hz' }, maxHeartRate: { qty: 3, units: 'Hz' } },
      { maxHeartRate: { qty: 3, unit: 'made-up' } },
      { heartRate: { avg: { qty: 2, units: 'Hz' }, max: { qty: 3, units: 'Hz' } } },
      { heartRate: { units: 'Hz', Avg: 2, Max: 3 } },
      { avgHeartRate: { qty: 110, units: 'bpm' }, heartRate: { avg: { qty: 2, units: 'Hz' } } },
      { heartRateData: [{ date: '2026-10-13T08:00:10Z', qty: 2, units: 'made-up' }] },
      { heartRateRecovery: [{ date: '2026-10-13T09:00:10Z', qty: 2, units: 'ms' }] },
    ].map(fields => ({ data: { workouts: [{ ...workout('one'), ...fields }] } }));
    const rejected: unknown[] = [...badWorkouts, { data: { metrics: [{ name: 'resting_heart_rate', units: 'Hz', data: [{ date: '2026-10-13', qty: 2 }] }] } }];
    for (const value of rejected) {
      clock += 1000; const bytes = raw(value); const receipt = await accept(device, bytes);
      expect(await processor().processNext(signal())).toMatchObject({ state: 'quarantined', reason: 'unsupported_unit' });
      // Match the buffer's canonical GUID receipt, not the driver's UUID letter casing.
      expect((await inbox()).find(row => String(row.acceptance_id).toLowerCase() === receipt.acceptanceId)).toMatchObject({ raw_bytes: bytes, checksum: sha256(bytes),
        processing_status: 'quarantined', processing_error_code: 'unsupported_unit', processing_attempts: 1, processed_at: null });
      expect(await Promise.all(domainTables.map(rows))).toEqual(before);
    }
  });
  it('reads supported body-fat units canonically from SQL while retaining unknowns, zero and raw evidence', async () => {
    const device = await provision();
    const cases = [
      { date: '2026-10-13', units: '%', qty: 20, expected: 20, unit: '%' },
      { date: '2026-10-14', units: 'percent', qty: 21, expected: 21, unit: '%' },
      { date: '2026-10-15', units: 'fraction', qty: 0.22, expected: 22, unit: '%' },
      { date: '2026-10-16', units: '1', qty: 0.23, expected: 23, unit: '%' },
      { date: '2026-10-17', units: undefined, qty: 0.2, expected: 0.2, unit: null },
      { date: '2026-10-18', units: 'fraction', qty: 0, expected: 0, unit: '%' },
      { date: '2026-10-19', units: '%', qty: null, expected: null, unit: '%' },
    ];
    const bytes = raw({ data: { metrics: cases.map(({ date, units, qty }) => ({ name: 'body_fat_percentage', units, data: [{ date, qty }] })) } });
    await accept(device, bytes); expect(await processor().processNext(signal())).toMatchObject({ state: 'processed' });
    const history = (await readModel().history('metrics', { startDate: '2026-10-13', endDate: '2026-10-19' }, signal())).items;
    expect(history).toHaveLength(cases.length);
    for (const { date, expected, unit } of cases) {
      const row = history.find(item => (item.metric_date instanceof Date ? item.metric_date.toISOString().slice(0, 10) : String(item.metric_date)) === date);
      expect(row).toMatchObject({ metric_name: 'body_fat_percentage', value: expected, unit });
    }
    expect((await inbox())[0]).toMatchObject({ raw_bytes: bytes, checksum: sha256(bytes), processing_status: 'processed' });
  });
  it('quarantines unsupported body-fat units atomically without changing prior domains or processed freshness', async () => {
    const device = await provision(); await accept(device); await processor().processNext(signal());
    const domainTables = tableNames.filter(table => !['health_upload_inbox', 'health_upload_capabilities'].includes(table));
    const before = await Promise.all(domainTables.map(rows));
    for (const units of ['kg', 'made-up', 'Hz', 'constructor', '__proto__']) for (const pointUnit of [false, true]) {
      clock += 1000;
      const bodyFat = { name: 'body_fat_percentage', units: pointUnit ? '%' : units,
        data: [{ date: '2026-10-13', qty: 20, ...(pointUnit ? { unit: units } : {}) }] };
      const bytes = raw({ data: { workouts: [workout('must-not-commit')], metrics: [bodyFat] } });
      const receipt = await accept(device, bytes);
      expect(await processor().processNext(signal())).toMatchObject({ state: 'quarantined', reason: 'unsupported_unit' });
      expect((await inbox()).find(row => String(row.acceptance_id).toLowerCase() === receipt.acceptanceId)).toMatchObject({ raw_bytes: bytes, checksum: sha256(bytes),
        processing_status: 'quarantined', processing_error_code: 'unsupported_unit', processing_attempts: 1, processed_at: null });
      expect(await Promise.all(domainTables.map(rows))).toEqual(before);
    }
  });
  it('quarantines malformed or shadowed body-fat declarations before sanitization or fallback writes', async () => {
    const device = await provision(); await accept(device); await processor().processNext(signal());
    const domainTables = tableNames.filter(table => !['health_upload_inbox', 'health_upload_capabilities'].includes(table));
    const before = await Promise.all(domainTables.map(rows));
    const sample = { date: '2026-10-13', qty: 0.2 };
    const candidates = [
      { metrics: [{ name: 'body_fat_percentage', units: 1, data: [sample] }] },
      { metrics: [{ name: 'body_fat_percentage', unit: false, data: [{ ...sample, units: 'fraction' }] }] },
      { metrics: [{ name: 'body_fat_percentage', units: '%', data: [{ ...sample, units: 1 }] }] },
      { metrics: [{ name: 'body_fat_percentage', units: '%', data: [{ ...sample, units: '%', unit: false }] }] },
      { metrics: [{ name: 'body_fat_percentage', units: '%', data: [{ ...sample, units: { type: 'dietary_energy' } }] }] },
      { metrics: [{ name: 'body_fat_percentage', units: 'kg', data: [{ ...sample, unit: 'fraction' }] }] },
      { metrics: [{ name: 'body_fat_percentage', units: [], data: [] }] },
      { workouts: [{ ...workout('must-not-commit'), bodyFatPercentage: { qty: 0, units: 1 } }] },
      { workouts: [{ ...workout('must-not-commit'), bodyFatPercentage: [{ ...sample, units: { type: 'dietary_energy' } }] }] },
    ];
    for (const candidate of candidates) {
      clock += 1000;
      const bytes = raw({ data: { ...payload(999, [workout('must-not-commit')]).data, ...candidate } });
      const receipt = await accept(device, bytes);
      expect(await processor().processNext(signal())).toMatchObject({ state: 'quarantined', reason: 'unsupported_unit' });
      expect((await inbox()).find(row => String(row.acceptance_id).toLowerCase() === receipt.acceptanceId)).toMatchObject({ raw_bytes: bytes, checksum: sha256(bytes),
        processing_status: 'quarantined', processing_error_code: 'unsupported_unit', processing_attempts: 1, processed_at: null });
      expect(await Promise.all(domainTables.map(rows))).toEqual(before);
    }
  });
  it('keeps heartbeat separate from processed data freshness, including before the first upload', async () => {
    const device = await provision();
    await accept(device, { shortcutName: 'Synthetic shortcut', checkedFeeds: ['metrics', 'workouts'] }, 'heartbeat', 'heartbeat');
    await processor().processNext(signal());
    const status = await readModel().sync(signal());
    expect(status.feeds).toEqual([]); expect(status.heartbeat).toEqual({ last_received_at: new Date(base).toISOString() });
    expect(status.inbox).toMatchObject({ pending: 0, last_processed_upload_at: null });
    expect(await rows('health_ingestions')).toEqual([]);
  });
  it('isolates owners and case-sensitive workout/session identities in persistence and paged reads', async () => {
    const device = await provision(); const foreign = await provision(other);
    await accept(device, payload(100, [workout('One'), workout('one')])); await accept(foreign, payload(900), 'foreign');
    await processor().processNext(signal());
    expect((await inbox()).filter(row => row.processing_status === 'pending')).toHaveLength(1);
    expect((await readModel(other).history('workouts', { startDate: '2026-10-13', endDate: '2026-10-13' }, signal())).items).toEqual([]);
    await processor(other).processNext(signal());
    const first = await readModel().history('workouts', { startDate: '2026-10-13', endDate: '2026-10-13', limit: 1 }, signal());
    const second = await readModel().history('workouts', { startDate: '2026-10-13', endDate: '2026-10-13', limit: 1, after: first.next! }, signal());
    expect(first.items.map(row => row.id)).toEqual(['One']); expect(second.items.map(row => row.id)).toEqual(['one']);
    expect(first.truncated).toBe(true); expect(second.next).toBeNull();
    expect((await readModel().heartRate('ONE', {}, signal())).items).toEqual([]);
    const hr = await readModel().heartRate('One', { limit: 1 }, signal()); expect(hr.items).toHaveLength(1);
    expect(await readModel().workoutDetail('One', signal())).toMatchObject({ id: 'One', detail: { metadata: { synthetic: true } } });
    expect(await readModel(other).workoutDetail('One', signal())).toBeNull();
    expect((await readModel().history('metrics', { startDate: '2026-10-13', endDate: '2026-10-13' }, signal())).items.find(row => row.metric_name === 'step_count')?.value).toBe(100);
  });
  it('rolls every target and freshness back on a late failure but retains raw bytes and bounded retry evidence', async () => {
    const device = await provision(); const bytes = raw(payload()); await accept(device, bytes); await failFinalCommit();
    expect(await processor().processNext(signal())).toMatchObject({ state: 'retry', reason: 'storage_unavailable' });
    for (const table of tableNames.filter(name => !['health_upload_inbox', 'health_upload_capabilities'].includes(name))) expect(await rows(table)).toEqual([]);
    expect((await inbox())[0]).toMatchObject({ raw_bytes: bytes, processing_status: 'pending', processed_at: null, processing_attempts: 1, processing_error_code: 'interrupted' });
    expect(await processor().processNext(signal())).toEqual({ state: 'idle' });
    await pool.request().batch('DROP TRIGGER daily.synthetic_fail_health_processed;'); clock += processingRetryDelays[0];
    expect(await processor().processNext(signal())).toMatchObject({ state: 'processed' });
    const status = await readModel().sync(signal());
    expect(status.feeds[0]).toMatchObject({ accepted_evidence_at: new Date(base).toISOString(), processed_committed_at: new Date(clock).toISOString() });
  });
  it('reconciles a lost processing commit acknowledgement without duplicate domain writes', async () => {
    const device = await provision(); await accept(device);
    const original = sql.Transaction.prototype.commit; let commits = 0;
    const lost = vi.spyOn(sql.Transaction.prototype, 'commit').mockImplementation(async function(this: sql.Transaction) {
      await original.call(this); if (++commits === 2) throw new Error('synthetic-commit-response-lost');
    });
    // The retry transaction finds the committed row and reports it processed instead of scheduling a second run.
    try { expect(await processor().processNext(signal())).toMatchObject({ state: 'processed' }); } finally { lost.mockRestore(); }
    expect((await inbox())[0].processing_status).toBe('processed');
    expect(await processor().processNext(signal())).toEqual({ state: 'idle' });
    expect(await rows('health_ingestions')).toHaveLength(1); expect(await rows('health_workouts')).toHaveLength(2);
  });
  it('quarantines after three interrupted attempts with no automatic deletion or unbounded retry', async () => {
    const device = await provision(); await accept(device); await failFinalCommit();
    for (const delay of processingRetryDelays) {
      expect(await processor().processNext(signal())).toMatchObject({ state: 'retry' }); clock += delay;
    }
    expect(await processor().processNext(signal())).toMatchObject({ state: 'quarantined', reason: 'retry_exhausted' });
    expect((await inbox())[0]).toMatchObject({ processing_attempts: 3, processing_status: 'quarantined', processed_at: null });
    expect(await processor().processNext(signal())).toEqual({ state: 'idle' }); expect(await rows('health_ingestions')).toEqual([]);
  });
  it('quarantines malformed JSON, invalid timestamps, checksum mismatch and overlong mapped identities immediately', async () => {
    const device = await provision();
    const cases: [unknown, string, string][] = [
      [{ data: { metrics: [{ name: 'steps', data: [{ date: '2026-02-30', qty: 1 }] }] } }, 'date', 'invalid_timestamp'],
      [payload(), 'x'.repeat(257), 'invalid_identifier'],
    ];
    for (const [value, session, reason] of cases) {
      await accept(device, value, session);
      expect(await processor().processNext(signal())).toMatchObject({ state: 'quarantined', reason });
    }
    // Ingress rejects malformed JSON. Simulate corrupted retained bytes to exercise processor recovery.
    const malformed = await accept(device, payload(), 'corrupted-json');
    await pool.request().input('id', sql.UniqueIdentifier, malformed.acceptanceId).input('checksum', sql.Char(64), sha256('{'))
      .input('bytes', sql.VarBinary(sql.MAX), Buffer.from('{')).query('UPDATE daily.health_upload_inbox SET raw_bytes=@bytes,byte_count=1,checksum=@checksum WHERE acceptance_id=@id;');
    expect(await processor().processNext(signal())).toMatchObject({ state: 'quarantined', reason: 'invalid_payload' });
    const receipt = await accept(device, payload(), 'checksum');
    await pool.request().input('id', sql.UniqueIdentifier, receipt.acceptanceId).input('checksum', sql.Char(64), '0'.repeat(64)).query('UPDATE daily.health_upload_inbox SET checksum=@checksum WHERE acceptance_id=@id;');
    expect(await processor().processNext(signal())).toMatchObject({ state: 'quarantined', reason: 'invalid_payload' });
    expect((await inbox()).every(row => row.processing_attempts === 1 && row.processed_at === null)).toBe(true);
    expect((await readModel().sync(signal())).feeds).toEqual([]);
  });
  it('does not regress newer snapshots or introduce stale workout children when an older attempt resumes', async () => {
    const device = await provision();
    const old = workout('one', 100); old.heartRateData.push({ date: '2026-10-13T08:01:10Z', qty: 110, units: 'bpm' });
    await accept(device, payload(100, [old]), 'old'); await failFinalCommit(); await processor().processNext(signal());
    await pool.request().batch('DROP TRIGGER daily.synthetic_fail_health_processed;'); clock += 1000;
    await accept(device, payload(500, [workout('one', 150)]), 'new'); await processor().processNext(signal());
    clock = base + processingRetryDelays[0]; await processor().processNext(signal());
    expect((await rows('health_daily_metrics')).find(row => row.metric_name === 'step_count')?.value).toBe(500);
    expect(await rows('health_workout_heart_rate_minute')).toHaveLength(1);
    expect((await rows('health_workout_heart_rate_minute'))[0].avg_value).toBe(150);
    expect((await readModel().sync(signal())).feeds[0].accepted_evidence_at).toBe(new Date(base + 1000).toISOString());
    expect(await rows('health_ingestions')).toHaveLength(2);
  });
  it('preserves imported matching lineage and quarantines conflicting imported sessions without overwriting IDs', async () => {
    const device = await provision(); const bytes = raw(payload());
    for (const session of ['matching', 'conflicting']) {
      await pool.request().input('owner', sql.UniqueIdentifier, owner).input('id', sql.NVarChar(256), `original-${session}`).input('session', sql.NVarChar(256), session)
        .input('checksum', sql.Char(64), session === 'matching' ? sha256(bytes) : '0'.repeat(64)).input('bytes', sql.BigInt, bytes.length)
        .query("INSERT daily.health_ingestions(owner_object_id,id,automation_id,session_id,checksum,status,content_bytes,received_at,completed_at,normalized_counts_json) VALUES(@owner,@id,N'synthetic-automation',@session,@checksum,N'succeeded',@bytes,N'2026-10-12T18:00:00.000Z',N'2026-10-12T18:00:00.000Z',N'{}');");
      await accept(device, bytes, session);
      expect(await processor().processNext(signal())).toMatchObject({ state: session === 'matching' ? 'processed' : 'quarantined' });
    }
    expect((await rows('health_ingestions')).map(row => row.id).sort()).toEqual(['original-conflicting', 'original-matching']);
    expect(await rows('health_workouts')).toEqual([]); expect((await readModel().sync(signal())).feeds).toEqual([]);
  });
  it('paginates minute details and preserves multiple sleep days without duplicate cursors', async () => {
    const device = await provision(); const w = workout();
    w.heartRateData.push({ date: '2026-10-13T08:01:10Z', qty: 101, units: 'bpm' });
    await accept(device, payload(100, [w])); await processor().processNext(signal());
    const first = await readModel().heartRate(w.id, { limit: 1 }, signal());
    const next = await readModel().heartRate(w.id, { limit: 1, after: first.next! }, signal());
    expect(first.items[0].sample_minute).toBe('2026-10-13T08:00:00.000Z'); expect(next.items[0].sample_minute).toBe('2026-10-13T08:01:00.000Z'); expect(next.next).toBeNull();
    await accept(device, { data: { metrics: [{ name: 'sleep_analysis', units: 'hr', data: [{ date: '2026-10-14', totalSleep: 6 }] }] } }); await processor().processNext(signal());
    const sleep = await readModel().history('sleep', { startDate: '2026-10-13', endDate: '2026-10-14', limit: 1 }, signal());
    expect(sleep.next).toEqual({ date: '2026-10-13', key: '2026-10-13' });
    expect((await readModel().history('sleep', { startDate: '2026-10-13', endDate: '2026-10-14', limit: 1, after: sleep.next! }, signal())).next).toBeNull();
  });
  it('fails closed on cancellation/offline SQL and refuses rollback once processing evidence exists', async () => {
    const device = await provision(); await accept(device);
    await expect(processor().processNext(AbortSignal.abort())).rejects.toThrow();
    expect((await inbox())[0].processing_attempts).toBe(0);
    const offline = new sql.ConnectionPool({ ...configuration, database });
    try { await expect(new SqlHealthProcessor(offline, owner).processNext(signal())).rejects.toBeInstanceOf(HealthUnavailable); } finally { await offline.close(); }
    await processor().processNext(signal());
    const down = await readDownMigration(filename);
    // Only the newest applied migration can be reverted, so the processing-state migration goes first.
    await revertMigration(pool, await migrations(), await readDownMigration('0060_daily_health_processing_state.sql'));
    await expect(revertMigration(pool, await migrations(), down)).rejects.toThrow('no processing evidence');
    expect((await inbox())[0].processing_status).toBe('processed');
    // Only this synthetic isolated test database is cleaned; no runtime cleanup operation exists.
    for (const table of tableNames) await pool.request().batch(`DELETE daily.[${table}];`);
    await revertMigration(pool, await migrations(), down);
    expect((await pool.request().query("SELECT name FROM sys.columns WHERE object_id=OBJECT_ID('daily.health_upload_inbox') AND name='processing_attempts'")).recordset).toEqual([]);
    await applyMigrations(pool, await migrations());
  });
});
