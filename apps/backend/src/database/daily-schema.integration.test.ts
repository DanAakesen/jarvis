import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readMigrations, readDownMigration, revertMigration } from './migrations.js';
import { DailyOwnerStore } from '../daily/store/owner-store.js';
import { dailyTables } from '../daily/store/schema.js';

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
    const rollbackPool = new sql.ConnectionPool({ ...configuration, database: isolated });
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
      await waitUntil(`SELECT 1 AS locked FROM sys.dm_tran_locks WHERE resource_database_id=DB_ID(N'${isolated}')
        AND resource_type='OBJECT' AND resource_associated_entity_id=${objectId} AND request_mode='X' AND request_status='GRANT';`);
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
