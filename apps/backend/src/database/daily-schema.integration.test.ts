import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readMigrations, readDownMigration, revertMigration } from './migrations.js';
import { DailyOwnerStore } from '../daily/store/owner-store.js';
import { dailyTables } from '../daily/store/schema.js';
import { DailyBriefReadModel } from '../daily/briefs/read-model.js';
import { DailyHealthReadModel } from '../daily/health/read-model.js';
import { DailyQueryService, dailyResultByteLimit } from '../daily/query.js';
import { NutritionStore } from '../daily/nutrition/store.js';
import { dailyQueryTool } from '../daily/tools/query.js';
import { dailyQuerySources as sources } from '@jarvis/contracts';

const configuration = loadDatabaseConfig();
if (!configuration || process.env.NODE_ENV !== 'test' || configuration.server !== '127.0.0.1') {
  throw new Error('Daily integration tests require isolated loopback SQL Server');
}
const database = `jarvis_daily_ci_${randomUUID().replaceAll('-', '')}`;
const admin = new sql.ConnectionPool({ ...configuration, database: 'master' });
const pool = new sql.ConnectionPool({ ...configuration, database });
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const filename = '0041_daily_owner_schema.sql';
const requestFor = (id: string, kind = 'user') => ({
  server: { ownerObjectId: id }, principal: kind === 'user' ? { objectId: id } : null,
  agentPrincipal: kind === 'agent' ? { kind: 'jarvis-agent', objectId: other } : null,
  runnerPrincipal: kind === 'runner' ? { kind: 'jarvis-runner', objectId: other } : null,
}) as unknown as FastifyRequest;
const signal = () => new AbortController().signal;

beforeAll(async () => {
  await admin.connect();
  await admin.request().batch(`CREATE DATABASE [${database}];`);
  await pool.connect();
  await pool.request().batch('CREATE TABLE dbo.existing_jarvis_fixture (id int PRIMARY KEY); INSERT dbo.existing_jarvis_fixture VALUES (7);');
  await applyMigrations(pool, (await readMigrations()).filter((migration) => migration.name === filename));
});
afterAll(async () => {
  await pool.close();
  if (admin.connected) await admin.request().batch(`IF DB_ID(N'${database}') IS NOT NULL BEGIN ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}]; END;`);
  await admin.close();
});

describe('Daily SQL owner schema on real SQL Server', () => {
  it('creates only empty mapped tables, preserves Jarvis, and applies once', async () => {
    const tables = (await pool.request().query("SELECT name FROM sys.tables WHERE schema_id=SCHEMA_ID(N'daily') ORDER BY name")).recordset.map((row) => row.name);
    expect(tables).toEqual(Object.keys(dailyTables).sort());
    expect((await pool.request().query('SELECT id FROM dbo.existing_jarvis_fixture')).recordset).toEqual([{ id: 7 }]);
    for (const table of Object.keys(dailyTables)) expect((await pool.request().query(`SELECT COUNT(*) AS count FROM daily.[${table}]`)).recordset[0].count).toBe(0);
    expect(await applyMigrations(pool, (await readMigrations()).filter((migration) => migration.name === filename))).toEqual([]);
  });

  it('preserves global-source keys, null unknown metrics and measurements on recovery dates', async () => {
    await pool.request().input('owner', sql.UniqueIdentifier, owner).batch(`
      INSERT daily.health_daily_metrics(owner_object_id,metric_name,metric_date,unit,value,ingestion_id,updated_at)
        VALUES (@owner,N'weight', '2026-01-01',N'kg',NULL,N'synthetic-ingestion',N'2026-01-01T23:00:00+01:00');
      INSERT daily.recovery_days(owner_object_id,recovery_date,context_text,created_at,updated_at)
        VALUES (@owner,'2026-01-01',N'synthetic recovery',N'2026-01-01',N'2026-01-01');`);
    const store = DailyOwnerStore.forRequest(pool, requestFor(owner));
    const row = await store.read('health_daily_metrics', { metric_name: 'weight', metric_date: '2026-01-01' }, signal());
    expect(row).toMatchObject({ value: null, min_value: null, avg_value: null, max_value: null, unit: 'kg', sample_count: '0' });
    expect(await DailyOwnerStore.forRequest(pool, requestFor(other)).read('health_daily_metrics', { metric_name: 'weight', metric_date: '2026-01-01' }, signal())).toBeNull();
    expect(await DailyOwnerStore.forRequest(pool, requestFor(owner, 'agent')).read('health_daily_metrics', { metric_name: 'weight', metric_date: '2026-01-01' }, signal())).toEqual(row);
    expect(() => DailyOwnerStore.forRequest(pool, requestFor(owner, 'runner'))).toThrow();
    await expect(store.read('recovery_days', { recovery_date: '2026-01-01', owner_object_id: other }, signal())).rejects.toThrow('Invalid Daily key');
  });

  it('enforces idempotency and retains revisions/tombstones without inventing nutrient values', async () => {
    const insert = (id: string, ownerId: string) => pool.request().input('owner', sql.UniqueIdentifier, ownerId).input('id', sql.NVarChar(256), id).batch(`
      INSERT daily.nutrition_meals(owner_object_id,id,idempotency_key,meal_name,occurred_at,meal_date,energy_kcal,confidence,capture_method,revision,deleted_at,created_at,expires_at,updated_at)
      VALUES (@owner,@id,N'synthetic-key',N'synthetic meal',N'2026-01-01T10:00:00+01:00','2026-01-01',100,N'synthetic',N'text',3,N'2026-01-02',N'2026-01-01',N'2027-01-01',N'2026-01-02');`);
    await insert('meal', owner);
    await expect(insert('different', owner)).rejects.toThrow();
    await insert('meal', other);
    expect(await DailyOwnerStore.forRequest(pool, requestFor(owner)).read('nutrition_meals', { id: 'meal' }, signal())).toMatchObject({ revision: '3', deleted_at: '2026-01-02', protein_grams: null, fiber_grams: null });
  });

  it('keeps original/sanitized raw checksums distinct and excludes legacy credentials/TickTick sources', async () => {
    await pool.request().input('owner', sql.UniqueIdentifier, owner).batch(`INSERT daily.health_raw_objects(owner_object_id,ingestion_id,object_key,checksum,sanitized_checksum,content_bytes,content_type,stored_at,expires_at,storage_status,deleted_at)
      VALUES (@owner,N'raw-ledger',N'synthetic-key',N'original-checksum',N'sanitized-checksum',0,N'application/json',N'2026-01-01',N'2026-01-02',N'deleted',N'2026-01-02');`);
    expect(await DailyOwnerStore.forRequest(pool, requestFor(owner)).read('health_raw_objects', { ingestion_id: 'raw-ledger' }, signal())).toMatchObject({ checksum: 'original-checksum', sanitized_checksum: 'sanitized-checksum', storage_status: 'deleted', deleted_at: '2026-01-02' });
    await expect(pool.request().input('owner', sql.UniqueIdentifier, owner).batch(`INSERT daily.attention_rule_config(owner_object_id,[key],value_json,source,updated_at) VALUES (@owner,N'bad',N'{}',N'ticktick',N'2026-01-01');`)).rejects.toThrow();
    expect((await pool.request().query("SELECT name FROM sys.columns WHERE object_id=OBJECT_ID(N'daily.nutrition_queue') AND name IN (N'claim_token',N'owner_email')")).recordset).toEqual([]);
  });

  it('enforces owner-composite relationships and preserves case-distinct source IDs', async () => {
    await pool.request().input('owner', sql.UniqueIdentifier, owner).batch(`
      INSERT daily.attention_runs(owner_object_id,id,idempotency_key,mode,captured_at,received_at,checksum,status)
        VALUES (@owner,N'Run',N'Run',N'synthetic',N'2026-01-01',N'2026-01-01',N'synthetic',N'complete'),
               (@owner,N'run',N'run',N'synthetic',N'2026-01-01',N'2026-01-01',N'synthetic',N'complete');`);
    await expect(pool.request().input('other', sql.UniqueIdentifier, other).batch(`
      INSERT daily.attention_source_snapshots(owner_object_id,id,run_id,source,status,captured_at,received_at)
        VALUES (@other,N'synthetic-child',N'Run',N'gmail',N'complete',N'2026-01-01',N'2026-01-01');`)).rejects.toThrow();
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM daily.attention_runs')).recordset[0].count).toBe(2);
    await expect(pool.request().input('owner', sql.UniqueIdentifier, owner).batch(`
      INSERT daily.attention_rule_config(owner_object_id,[key],value_json,source,updated_at)
        VALUES (@owner,N'invalid-json',N'not json',N'synthetic',N'2026-01-01');`)).rejects.toThrow();
    await pool.request().input('owner', sql.UniqueIdentifier, owner).batch(`
      INSERT daily.attention_rule_config(owner_object_id,[key],value_json,source,updated_at)
        VALUES (@owner,N'scalar-json',N'true',N'synthetic',N'2026-01-01');`);
    expect(await DailyOwnerStore.forRequest(pool, requestFor(owner)).read('attention_rule_config', { key: 'scalar-json' }, signal()))
      .toMatchObject({ value_json: 'true' });
  });

  it('reads real owned brief history/body without generation, delivery, snapshots or timestamp reinterpretation', async () => {
    const insert = (ownerId: string, id: string, body: string) => pool.request()
      .input('owner', sql.UniqueIdentifier, ownerId).input('id', sql.NVarChar(256), id)
      .input('body', sql.NVarChar(sql.MAX), body).batch(`
        INSERT daily.briefing_runs(owner_object_id,id,[trigger],started_at,status,preview_text,body_json,
          source_snapshots_json,delivery_evidence_json,updated_at)
        VALUES(@owner,@id,N'manual',N'raw stored time',N'completed',N'Synthetic historical preview',@body,
          N'{"private":"must-not-escape"}',N'{"private":"must-not-escape"}',N'unknown source time');`);
    for (const id of ['CaseID', 'caseid', 'padded ']) await insert(owner, id, '{"text":"Synthetic historical body"}');
    await insert(other, 'CaseID', '{"text":"Other owner"}');
    const reader = DailyBriefReadModel.forRequest(pool, requestFor(owner));
    const service = new DailyQueryService({
      health: () => { throw new Error('Brief reads must not load health'); },
      nutrition: () => { throw new Error('Brief reads must not load nutrition'); },
      briefs: req => DailyBriefReadModel.forRequest(pool, req),
    }, () => Date.parse('2026-10-17T08:00:00Z'));
    const tool = dailyQueryTool(service);
    const seen: string[] = [];
    let after: { startedAt: string; id: string } | null = null;
    do {
      const page = await reader.history({ limit: 1, ...(after ? { after } : {}) }, signal());
      seen.push(...page.items.map(row => String(row.id)));
      expect(page.items[0]).not.toHaveProperty('body_json');
      after = page.next;
    } while (after);
    expect(seen).toEqual(['padded ', 'caseid', 'CaseID']);
    expect(await reader.detail('padded', signal())).toBeNull();
    expect(await reader.detail('Padded ', signal())).toBeNull();
    const result = await tool.execute({ source: sources.brief, briefId: 'padded ' }, requestFor(owner), signal());
    expect(result).toMatchObject({ period: null, status: 'available', items: [{
      id: 'padded ', started_at: 'raw stored time', body_json: { text: 'Synthetic historical body' }, delivery_status: 'not_requested',
    }], freshness: { sourceProcessedCommittedAt: null, latestReturnedRecordUpdatedAt: null, staleness: 'unknown' } });
    expect(JSON.stringify(result)).not.toContain('must-not-escape');
    expect(JSON.stringify(result)).not.toContain(owner);
    expect((await DailyBriefReadModel.forRequest(pool, requestFor(other)).history({}, signal())).items).toHaveLength(1);
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM daily.briefing_runs')).recordset[0].count).toBe(4);
    expect((await pool.request().query("SELECT COUNT(*) AS count FROM daily.briefing_runs WHERE delivery_status<>N'not_requested'")).recordset[0].count).toBe(0);
    await insert(owner, 'oversized', JSON.stringify('x'.repeat(dailyResultByteLimit)));
    await expect(reader.detail('oversized', signal())).rejects.toThrow('read budget');
    const bytes = (await pool.request().query<{ bytes: string }>("SELECT DATALENGTH(body_json) AS bytes FROM daily.briefing_runs WHERE id=N'oversized'")).recordset[0]!.bytes;
    expect(BigInt(bytes)).toBeGreaterThan(BigInt(dailyResultByteLimit) * 2n);
  });

  it('filters metrics and pages the owner-scoped metric catalogue and non-deleted daily nutrition totals', async () => {
    const insertMetric = async (ownerId: string, name: string, date: string, unit: string, value: number) =>
      pool.request().input('owner', sql.UniqueIdentifier, ownerId).input('name', sql.NVarChar(256), name)
        .input('date', sql.Date, new Date(`${date}T00:00:00Z`)).input('unit', sql.NVarChar(256), unit)
        .input('value', sql.Float, value).input('updated', sql.NVarChar(64), `${date}T12:00:00.000Z`)
        .query(`INSERT daily.health_daily_metrics(owner_object_id,metric_name,metric_date,unit,value,ingestion_id,updated_at)
          VALUES(@owner,@name,@date,@unit,@value,N'synthetic-read-model',@updated);`);
    try {
      await insertMetric(owner, 'weight', '2026-02-01', 'kg', 70);
      await insertMetric(owner, 'weight', '2026-02-02', 'lb', 154);
      await insertMetric(owner, 'weight', '2026-02-03', 'oz', 2469);
      await insertMetric(owner, 'weight', '2026-02-04', 'stone', 11);
      await insertMetric(owner, 'weight', '2026-02-05', 'g', 70000);
      await insertMetric(owner, 'weight', '2026-02-06', 'cm', 170);
      await insertMetric(owner, 'steps', '2026-02-01', 'count', 1000);
      await insertMetric(other, 'weight', '2026-02-01', 'foreign-unit', 11);

      const insertMeal = async (ownerId: string, id: string, day: string, nutrients: {
        energy: number; protein: number | null; carbohydrates: number | null; fat: number | null; fiber: number | null;
      }, deletedAt: string | null = null) => {
        const stamp = `${day}T12:00:00.000Z`;
        await pool.request().input('owner', sql.UniqueIdentifier, ownerId).input('id', sql.NVarChar(256), id)
          .input('key', sql.NVarChar(256), `synthetic-${id}`).input('day', sql.Date, new Date(`${day}T00:00:00Z`))
          .input('occurred', sql.NVarChar(64), stamp).input('energy', sql.Float, nutrients.energy)
          .input('protein', sql.Float, nutrients.protein).input('carbohydrates', sql.Float, nutrients.carbohydrates)
          .input('fat', sql.Float, nutrients.fat).input('fiber', sql.Float, nutrients.fiber)
          .input('deleted', sql.NVarChar(64), deletedAt).input('stamp', sql.NVarChar(64), stamp)
          .query(`INSERT daily.nutrition_meals(owner_object_id,id,idempotency_key,meal_name,occurred_at,meal_date,
            energy_kcal,protein_grams,carbohydrates_grams,fat_grams,fiber_grams,confidence,capture_method,
            deleted_at,created_at,expires_at,updated_at)
            VALUES(@owner,@id,@key,N'Synthetic meal',@occurred,@day,@energy,@protein,@carbohydrates,@fat,@fiber,
              N'synthetic',N'text',@deleted,@stamp,N'2027-02-01T00:00:00.000Z',@stamp);`);
      };
      await insertMeal(owner, 'day-one-a', '2026-02-01', { energy: 100, protein: null, carbohydrates: 20, fat: 3, fiber: null });
      await insertMeal(owner, 'day-one-b', '2026-02-01', { energy: 200, protein: null, carbohydrates: null, fat: 4, fiber: 1 });
      await insertMeal(owner, 'day-one-deleted', '2026-02-01', { energy: 900, protein: 90, carbohydrates: 90, fat: 90, fiber: 90 }, '2026-02-02T00:00:00.000Z');
      await insertMeal(owner, 'day-two', '2026-02-02', { energy: 0, protein: null, carbohydrates: null, fat: null, fiber: null });
      await insertMeal(owner, 'day-three', '2026-02-03', { energy: 250, protein: 10, carbohydrates: 30, fat: 5, fiber: 2 });
      await insertMeal(other, 'foreign-day', '2026-02-01', { energy: 999, protein: 999, carbohydrates: 999, fat: 999, fiber: 999 });

      // This fixture applies only migration 0041; sync() also reads the upload inbox created by a later migration.
      const health = (request: FastifyRequest) => {
        const model = DailyHealthReadModel.forRequest(pool, request);
        return {
          history: model.history.bind(model), metricCatalog: model.metricCatalog.bind(model),
          workoutDetail: model.workoutDetail.bind(model), heartRate: model.heartRate.bind(model),
          sync: async () => ({ feeds: [], heartbeat: null, inbox: {} }) as unknown as Awaited<ReturnType<DailyHealthReadModel['sync']>>,
        };
      };
      const service = new DailyQueryService({
        health,
        nutrition: request => NutritionStore.forRequest(pool, request),
        briefs: () => { throw new Error('No brief read is expected'); },
      }, () => Date.parse('2026-02-04T00:00:00Z'));
      const period = { startDate: '2026-02-01', endDate: '2026-02-04' };
      const metricPeriod = { startDate: '2026-02-01', endDate: '2026-02-07' };
      const metrics = await service.query({ source: sources.metrics, ...metricPeriod, metric: 'weight' }, requestFor(owner), signal());
      expect(metrics.items).toHaveLength(6);
      expect(metrics.items.every(row => row.metric_name === 'weight')).toBe(true);
      expect(metrics.items.some(row => row.unit === 'foreign-unit')).toBe(false);

      const catalogFirst = await service.query({ source: sources.metricCatalog, ...metricPeriod, limit: 1 }, requestFor(owner), signal());
      expect(catalogFirst.items[0]).toMatchObject({ metric_name: 'steps', units: ['count'], first_date: '2026-02-01' });
      expect(catalogFirst.coverage).toMatchObject({ hasMore: true, next: { key: 'steps' } });
      const catalogSecond = await service.query({ source: sources.metricCatalog, ...metricPeriod, limit: 1,
        cursor: catalogFirst.coverage.next! as { key: string } }, requestFor(owner), signal());
      expect(catalogSecond.items).toEqual([expect.objectContaining({
        metric_name: 'weight', units: ['cm', 'g', 'kg', 'lb', 'oz'], day_count: 6,
      })]);
      expect(catalogSecond.coverage).toMatchObject({ hasMore: false, next: null });

      let after: { date: string } | null = null;
      const totals: Record<string, unknown>[] = [];
      do {
        const page = await service.query({ source: sources.days, ...period, limit: 1, ...(after ? { cursor: after } : {}) }, requestFor(owner), signal());
        totals.push(...page.items);
        after = page.coverage.next as { date: string } | null;
      } while (after);
      expect(totals).toHaveLength(3);
      expect(totals[0]).toMatchObject({
        meal_date: '2026-02-01', meal_count: 2, energy_kcal: 300, protein_grams: null,
        carbohydrates_grams: 20, fat_grams: 7, fiber_grams: 1,
        unknown_nutrients: ['protein_grams'], partial_nutrients: ['carbohydrates_grams', 'fiber_grams'],
      });
      expect(totals[1]).toMatchObject({
        meal_date: '2026-02-02', meal_count: 1, energy_kcal: 0, protein_grams: null,
        unknown_nutrients: ['protein_grams', 'carbohydrates_grams', 'fat_grams', 'fiber_grams'],
        partial_nutrients: [],
      });
      expect(totals[2]).toMatchObject({
        meal_date: '2026-02-03', meal_count: 1, energy_kcal: 250, protein_grams: 10,
        carbohydrates_grams: 30, fat_grams: 5, fiber_grams: 2,
        unknown_nutrients: [], partial_nutrients: [],
      });
      expect(totals.map(row => row.meal_date)).not.toContain('2026-02-04');
      expect(JSON.stringify(totals)).not.toContain('999');
      expect(JSON.stringify(totals)).not.toContain('900');
    } finally {
      // The database is shared: later tests assert exact record counts, so remove only this test's rows.
      await pool.request().batch(`
        DELETE daily.nutrition_meals WHERE id IN (N'day-one-a', N'day-one-b', N'day-one-deleted', N'day-two', N'day-three', N'foreign-day');
        DELETE daily.health_daily_metrics WHERE ingestion_id = N'synthetic-read-model';`);
    }
  });

  it('refuses destructive down migration while any Daily record exists', async () => {
    await expect(revertMigration(pool, (await readMigrations()).filter((migration) => migration.name === filename), await readDownMigration(filename)))
      .rejects.toThrow('Daily rollback requires empty tables');
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM daily.nutrition_meals')).recordset[0].count).toBe(2);
  });

  it('looks up exact numeric-looking text IDs, padded text and date/bigint keys', async () => {
    await pool.request().input('owner', sql.UniqueIdentifier, owner).batch(`
      INSERT daily.health_ingestions(owner_object_id,id,automation_id,session_id,checksum,status,content_bytes,received_at)
        VALUES (@owner,N'01',N'synthetic',N'01',N'synthetic',N'complete',0,N'2026-01-01'),
               (@owner,N'1',N'synthetic',N'1',N'synthetic',N'complete',0,N'2026-01-01'),
               (@owner,N'padded ',N'synthetic',N'padded ',N'synthetic',N'complete',0,N'2026-01-01');
      INSERT daily.health_sync_state(owner_object_id,id) VALUES (@owner,9223372036854775807);`);
    const store = DailyOwnerStore.forRequest(pool, requestFor(owner));
    await expect(store.read('health_ingestions', { id: 1 }, signal())).rejects.toThrow('text key');
    expect(await store.read('health_ingestions', { id: '01' }, signal())).toMatchObject({ id: '01' });
    expect(await store.read('health_ingestions', { id: '1' }, signal())).toMatchObject({ id: '1' });
    expect(await store.read('health_ingestions', { id: '1 ' }, signal())).toBeNull();
    expect(await store.read('health_ingestions', { id: 'padded' }, signal())).toBeNull();
    expect(await store.read('health_ingestions', { id: 'padded ' }, signal())).toMatchObject({ id: 'padded ' });
    const maximum = await store.read('health_sync_state', { id: 9223372036854775807n }, signal());
    expect(maximum).toMatchObject({ id: '9223372036854775807' });
    expect(await store.read('health_sync_state', { id: '9223372036854775807' }, signal())).toEqual(maximum);
    const metric = await store.read('health_daily_metrics', { metric_name: 'weight', metric_date: '2026-01-01' }, signal());
    expect((metric?.metric_date as Date).toISOString().slice(0, 10)).toBe('2026-01-01');
    await expect(store.read('health_daily_metrics', { metric_name: 'weight', metric_date: '2026-02-30' }, signal())).rejects.toThrow('date key');
  });

  it('holds Daily writer locks from empty checks through drops during concurrent rollback', async () => {
    const isolated = `jarvis_daily_race_${randomUUID().replaceAll('-', '')}`;
    const rollbackPool = new sql.ConnectionPool({ ...configuration, database: isolated, pool: { min: 1, max: 1 } });
    const writerPool = new sql.ConnectionPool({ ...configuration, database: isolated, pool: { min: 1, max: 1 } });
    await admin.request().batch(`CREATE DATABASE [${isolated}];`);
    let rollback: Promise<string> | undefined;
    let writer: Promise<string> | undefined;
    let rollbackError: unknown;
    let writerError: unknown;
    try {
      await rollbackPool.connect(); await writerPool.connect();
      const migrations = (await readMigrations()).filter((migration) => migration.name === filename);
      await applyMigrations(rollbackPool, migrations);
      const objectId = (await rollbackPool.request().query("SELECT OBJECT_ID(N'daily.health_ingestions') AS id")).recordset[0].id;
      const rollbackId = (await rollbackPool.request().query('SELECT @@SPID AS id')).recordset[0].id;
      const writerId = (await writerPool.request().query('SELECT @@SPID AS id')).recordset[0].id;
      const down = await readDownMigration(filename);
      // Test-only pause at the boundary after all production emptiness checks.
      const paused = { ...down, sql: down.sql.replace('DROP TABLE', "WAITFOR DELAY '00:00:05';\nDROP TABLE") };
      rollback = revertMigration(rollbackPool, migrations, paused).catch((error: unknown) => {
        rollbackError = error; return 'aborted';
      });
      const waitUntil = async (query: string) => {
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
          if ((await admin.request().query(query)).recordset.length) return;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error('SQL concurrency fixture did not reach the required lock state');
      };
      await waitUntil(`SELECT 1 AS locked FROM sys.dm_exec_requests AS requests
        WHERE requests.session_id=${rollbackId} AND requests.wait_type='WAITFOR'
        AND EXISTS (SELECT 1 FROM sys.dm_tran_locks WHERE request_session_id=${rollbackId}
          AND resource_database_id=DB_ID(N'${isolated}') AND resource_type='OBJECT'
          AND resource_associated_entity_id=${objectId} AND request_mode='X' AND request_status='GRANT');`);
      let outcome = 'pending';
      writer = writerPool.request().input('owner', sql.UniqueIdentifier, owner).query(`
        INSERT daily.health_ingestions(owner_object_id,id,automation_id,session_id,checksum,status,content_bytes,received_at)
          VALUES (@owner,N'concurrent',N'synthetic',N'concurrent',N'synthetic',N'complete',0,N'2026-01-01');`)
        .then(() => { outcome = 'committed'; return outcome; }, (error: unknown) => {
          writerError = error; outcome = 'rejected'; return outcome;
        });
      await waitUntil(`SELECT 1 AS blocked FROM sys.dm_exec_requests WHERE session_id=${writerId} AND blocking_session_id>0;`);
      expect(outcome).toBe('pending');
      const rollbackResult = await rollback;
      const writerResult = await writer;
      if (rollbackResult === filename) {
        expect(writerResult).toBe('rejected');
        // A blocked writer can lose a schema-lock deadlock or resume after DROP.
        expect([1205, 208]).toContain((writerError as sql.RequestError).number);
        expect((await rollbackPool.request().query("SELECT OBJECT_ID(N'daily.health_ingestions') AS id")).recordset[0].id).toBeNull();
      } else {
        // If SQL selects rollback as the deadlock victim, the writer's commit survives.
        expect((rollbackError as sql.RequestError).number).toBe(1205);
        expect(writerResult).toBe('committed');
        expect((await rollbackPool.request().query("SELECT id FROM daily.health_ingestions WHERE id=N'concurrent'")).recordset)
          .toEqual([{ id: 'concurrent' }]);
      }
    } finally {
      await Promise.allSettled([rollback, writer]);
      await rollbackPool.close(); await writerPool.close();
      await admin.request().batch(`ALTER DATABASE [${isolated}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${isolated}];`);
    }
  });
});
