import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { main } from '../daily/migration/cli.js';
import { generateBundle, SYNTHETIC_SENTINEL } from '../daily/migration/generate.js';
import { importBundle, reconcileBundle } from '../daily/migration/importer.js';
import { sha256 } from '../daily/migration/io.js';
import type { Manifest } from '../daily/migration/manifest.js';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readMigrations } from './migrations.js';

const configuration = loadDatabaseConfig();
if (!configuration || process.env.NODE_ENV !== 'test' || configuration.server !== '127.0.0.1') {
  throw new Error('Daily migration integration tests require isolated loopback SQL Server');
}
const database = `jarvis_daily_migration_${randomUUID().replaceAll('-', '')}`;
const admin = new sql.ConnectionPool({ ...configuration, database: 'master' });
const pool = new sql.ConnectionPool({ ...configuration, database });
const dirs: string[] = [];

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'daily-migration-sql-'));
  dirs.push(path);
  return path;
}

async function rewriteRows(bundle: string, table: string, rows: Record<string, unknown>[]): Promise<void> {
  const text = `${rows.map(row => JSON.stringify(row)).join('\n')}\n`;
  await writeFile(join(bundle, `${table}.ndjson`), text, { mode: 0o600 });
  const manifest = JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8')) as Manifest;
  manifest.tables[table]!.rowCount = rows.length;
  manifest.tables[table]!.sha256 = sha256(text);
  await writeFile(join(bundle, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
}

async function bundleFixture(path: string, workouts = 2): Promise<{ bundle: string; workoutRows: Record<string, unknown>[]; mealRow: Record<string, unknown> }> {
  const bundle = join(path, 'bundle');
  await generateBundle({ bundle, seed: 22, rows: workouts });
  const workoutLines = (await readFile(join(bundle, 'health_workouts.ndjson'), 'utf8')).trim().split('\n');
  const workoutRows = workoutLines.map((line, index) => ({
    ...JSON.parse(line) as Record<string, unknown>,
    id: index === 0 ? `SYNTHETIC_${'A'.repeat(245)} ` : `SYNTHETIC_22_${index}`,
    workout_type: index === 0 ? SYNTHETIC_SENTINEL : 'synthetic-run',
    workout_date: `2026-10-0${index + 1}`,
    start_at: `2026-10-0${index + 1}T10:00:00+02:00`,
    end_at: `2026-10-0${index + 1}T10:30:00+02:00`,
    duration_seconds: 1800,
    detail_json: '{}',
    ingestion_id: 'SYNTHETIC_22_0',
    updated_at: '2026-10-18T00:00:00Z',
  }));
  await rewriteRows(bundle, 'health_workouts', workoutRows);
  // Children must follow the renamed parent key or the bundle fails validation (missing-parent).
  for (const table of ['health_workout_metrics', 'health_workout_heart_rate_minute']) {
    const children = (await readFile(join(bundle, `${table}.ndjson`), 'utf8')).trim().split('\n')
      .map(line => JSON.parse(line) as Record<string, unknown>)
      .map(row => row.workout_id === 'SYNTHETIC_22_0' ? { ...row, workout_id: workoutRows[0]!.id } : row);
    await rewriteRows(bundle, table, children);
  }
  const mealLines = (await readFile(join(bundle, 'nutrition_meals.ndjson'), 'utf8')).trim().split('\n');
  const mealRow = {
    ...JSON.parse(mealLines[0]!) as Record<string, unknown>,
    idempotency_key: 'SYNTHETIC_MEAL_KEY',
    meal_name: 'SYNTHETIC_MEAL',
    components_json: '[]',
    occurred_at: '2026-10-01T12:00:00+02:00',
    meal_date: '2026-10-01',
    energy_kcal: 0,
    protein_grams: null,
    carbohydrates_grams: 0,
    fat_grams: null,
    fiber_grams: 0,
    confidence: 'synthetic',
    capture_method: 'text',
    source: 'sites',
    revision: 1,
    nutrient_provenance_json: '{}',
    apple_health_status: 'not_exported',
    created_at: '2026-10-01T12:00:00+02:00',
    expires_at: '2027-10-01T12:00:00+02:00',
    updated_at: '2026-10-18T00:00:00Z',
  };
  await rewriteRows(bundle, 'nutrition_meals', [mealRow]);
  return { bundle, workoutRows, mealRow };
}

async function seedWorkout(owner: string, row: Record<string, unknown>, workoutType: string): Promise<void> {
  await pool.request()
    .input('owner', sql.UniqueIdentifier, owner)
    .input('id', sql.NVarChar(256), row.id)
    .input('type', sql.NVarChar(256), workoutType)
    .input('date', sql.Date, new Date(`${String(row.workout_date)}T00:00:00.000Z`))
    .input('start', sql.NVarChar(64), row.start_at)
    .input('end', sql.NVarChar(64), row.end_at)
    .input('duration', sql.Float, row.duration_seconds)
    .input('detail', sql.NVarChar(sql.MAX), row.detail_json)
    .input('ingestion', sql.NVarChar(256), row.ingestion_id)
    .input('updated', sql.NVarChar(64), row.updated_at)
    .query(`INSERT daily.health_workouts
      (owner_object_id,id,workout_type,workout_date,start_at,end_at,duration_seconds,detail_json,ingestion_id,updated_at)
      VALUES (@owner,@id,@type,@date,@start,@end,@duration,@detail,@ingestion,@updated);`);
}

beforeAll(async () => {
  await admin.connect();
  await admin.request().batch(`CREATE DATABASE [${database}];`);
  await pool.connect();
  await applyMigrations(pool, await readMigrations());
});

afterAll(async () => {
  await pool.close();
  if (admin.connected) await admin.request().batch(`IF DB_ID(N'${database}') IS NOT NULL BEGIN ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}]; END;`);
  await admin.close();
  await Promise.all(dirs.map(path => rm(path, { recursive: true, force: true })));
});

describe('resumable Daily import and reconciliation on synthetic SQL data', () => {
  it('imports workouts and meals idempotently, preserves exact keys/null nutrients, and isolates another owner', async () => {
    const path = await directory();
    const { bundle, workoutRows } = await bundleFixture(path);
    const owner = '11111111-1111-4111-8111-111111111111';
    const other = '22222222-2222-4222-8222-222222222222';
    await seedWorkout(other, workoutRows[0]!, 'other-owner');
    const first = await importBundle({
      bundle, ownerObjectId: owner, stateDir: join(path, 'state'), batchSize: 1, execute: true,
      tables: ['nutrition_meals', 'health_workouts'],
    }, pool, owner);
    expect(first.status).toBe('complete');
    expect(first.tables.health_workouts).toMatchObject({ inserted: 2, conflicts: 0 });
    expect(first.tables.nutrition_meals).toMatchObject({ inserted: 1 });
    const before = await pool.request().input('owner', sql.UniqueIdentifier, owner).query(
      'SELECT id, workout_type, workout_date FROM daily.health_workouts WHERE owner_object_id=@owner ORDER BY id;',
    );
    const repeated = await importBundle({
      bundle, ownerObjectId: owner, stateDir: join(path, 'state'), batchSize: 1, execute: true,
      tables: ['nutrition_meals', 'health_workouts'],
    }, pool, owner);
    const after = await pool.request().input('owner', sql.UniqueIdentifier, owner).query(
      'SELECT id, workout_type, workout_date FROM daily.health_workouts WHERE owner_object_id=@owner ORDER BY id;',
    );
    expect(after.recordset).toEqual(before.recordset);
    expect(repeated.status).toBe('complete');
    expect((await pool.request().input('owner', sql.UniqueIdentifier, owner).query(
      'SELECT protein_grams, fiber_grams FROM daily.nutrition_meals WHERE owner_object_id=@owner;',
    )).recordset).toEqual([{ protein_grams: null, fiber_grams: null }]);
    expect((await pool.request().input('owner', sql.UniqueIdentifier, other).query(
      'SELECT workout_type FROM daily.health_workouts WHERE owner_object_id=@owner;',
    )).recordset).toEqual([{ workout_type: 'other-owner' }]);

    const reconciliation = await reconcileBundle({ bundle, ownerObjectId: owner, tables: ['health_workouts', 'nutrition_meals'] }, pool, owner);
    expect(reconciliation.status).toBe('complete');
    expect(reconciliation.tables.health_workouts).toMatchObject({ missing: 0, extra: 0, different: 0 });
    expect(reconciliation.tables.nutrition_meals?.mealTotalsDigest).toMatch(/^[a-f0-9]{24}$/);
    expect(JSON.stringify(reconciliation)).not.toContain(SYNTHETIC_SENTINEL);

    await pool.request().input('owner', sql.UniqueIdentifier, owner).query(
      'UPDATE daily.nutrition_meals SET protein_grams=0 WHERE owner_object_id=@owner;',
    );
    const nullToZero = await reconcileBundle({ bundle, ownerObjectId: owner, tables: ['nutrition_meals'] }, pool, owner);
    expect(nullToZero.status).toBe('differences');
    expect(nullToZero.tables.nutrition_meals).toMatchObject({ different: 1 });
  });

  it('resumes a table after a committed batch and converges to an uninterrupted import', async () => {
    const path = await directory();
    const { bundle, workoutRows } = await bundleFixture(path);
    const owner = '33333333-3333-4333-8333-333333333333';
    const uninterruptedOwner = '44444444-4444-4444-8444-444444444444';
    // NOCHECK: earlier tests already stored SYNTHETIC_22_1 for other owners; the rule only has to stop new inserts.
    await pool.request().query(`ALTER TABLE daily.health_workouts WITH NOCHECK ADD CONSTRAINT CK_daily_migration_interrupt CHECK (id <> N'SYNTHETIC_22_1');`);
    await expect(importBundle({
      bundle, ownerObjectId: owner, stateDir: join(path, 'resumable'), batchSize: 1, execute: true, tables: ['health_workouts'],
    }, pool, owner)).rejects.toMatchObject({ message: 'import-failed' });
    expect((await pool.request().input('owner', sql.UniqueIdentifier, owner).query(
      'SELECT COUNT(*) AS count FROM daily.health_workouts WHERE owner_object_id=@owner;',
    )).recordset[0]!.count).toBe(1);
    await pool.request().query('ALTER TABLE daily.health_workouts DROP CONSTRAINT CK_daily_migration_interrupt;');

    const resumed = await importBundle({
      bundle, ownerObjectId: owner, stateDir: join(path, 'resumable'), batchSize: 1, execute: true, tables: ['health_workouts'],
    }, pool, owner);
    expect(resumed.status).toBe('complete');
    expect(resumed.tables.health_workouts).toMatchObject({ inserted: 2, conflicts: 0 });
    await importBundle({
      bundle, ownerObjectId: uninterruptedOwner, stateDir: join(path, 'uninterrupted'), batchSize: 1,
      execute: true, tables: ['health_workouts'],
    }, pool, uninterruptedOwner);
    const resumedRows = await pool.request().input('owner', sql.UniqueIdentifier, owner).query(
      'SELECT id, workout_type, workout_date, start_at, end_at, duration_seconds, detail_json FROM daily.health_workouts WHERE owner_object_id=@owner ORDER BY id;',
    );
    const uninterruptedRows = await pool.request().input('owner', sql.UniqueIdentifier, uninterruptedOwner).query(
      'SELECT id, workout_type, workout_date, start_at, end_at, duration_seconds, detail_json FROM daily.health_workouts WHERE owner_object_id=@owner ORDER BY id;',
    );
    expect(resumedRows.recordset).toEqual(uninterruptedRows.recordset);
    expect(resumedRows.recordset.map(row => row.id)).toContain(workoutRows[0]!.id);
  });

  it('reports missing, extra and changed rows without exposing a sentinel value, and rejects unruled mixed tables', async () => {
    const path = await directory();
    const { bundle, workoutRows } = await bundleFixture(path, 1);
    const owner = '55555555-5555-4555-8555-555555555555';
    await importBundle({
      bundle, ownerObjectId: owner, stateDir: join(path, 'state'), execute: true, tables: ['health_workouts'],
    }, pool, owner);

    await pool.request().input('owner', sql.UniqueIdentifier, owner).input('id', sql.NVarChar(256), workoutRows[0]!.id).query(
      'DELETE daily.health_workouts WHERE owner_object_id=@owner AND id=@id;',
    );
    const missing = await reconcileBundle({ bundle, ownerObjectId: owner, tables: ['health_workouts'] }, pool, owner);
    expect(missing.tables.health_workouts?.missing).toBe(1);
    await importBundle({
      bundle, ownerObjectId: owner, stateDir: join(path, 'restored-state'), execute: true, tables: ['health_workouts'],
    }, pool, owner);

    const extra = { ...workoutRows[0]!, id: 'SYNTHETIC_EXTRA_ROW' };
    await seedWorkout(owner, extra, 'extra');
    const withExtra = await reconcileBundle({ bundle, ownerObjectId: owner, tables: ['health_workouts'] }, pool, owner);
    expect(withExtra.tables.health_workouts?.extra).toBe(1);
    await pool.request().input('owner', sql.UniqueIdentifier, owner).input('id', sql.NVarChar(256), extra.id).query(
      'DELETE daily.health_workouts WHERE owner_object_id=@owner AND id=@id;',
    );

    await pool.request().input('owner', sql.UniqueIdentifier, owner).input('id', sql.NVarChar(256), workoutRows[0]!.id)
      .input('type', sql.NVarChar(256), 'SYNTHETIC_CHANGED_SENTINEL')
      .query('UPDATE daily.health_workouts SET workout_type=@type WHERE owner_object_id=@owner AND id=@id;');
    const changed = await reconcileBundle({ bundle, ownerObjectId: owner, tables: ['health_workouts'] }, pool, owner);
    expect(changed.tables.health_workouts?.different).toBe(1);
    expect(JSON.stringify(changed)).not.toContain('SYNTHETIC_CHANGED_SENTINEL');

    const manifest = JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8')) as Manifest;
    delete manifest.rulings!.attention_runs;
    await writeFile(join(bundle, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
    await expect(importBundle({
      bundle, ownerObjectId: owner, stateDir: join(path, 'unruled-state'), execute: true, tables: ['health_workouts'],
    }, pool, owner)).rejects.toThrow('validation-failed');
  });

  it('returns the distinct conflict exit code and does not overwrite an existing row', async () => {
    const path = await directory();
    const { bundle, workoutRows } = await bundleFixture(path, 1);
    const owner = '66666666-6666-4666-8666-666666666666';
    await seedWorkout(owner, workoutRows[0]!, 'preexisting-value');
    const previousDatabase = process.env.SQL_DATABASE;
    const previousOwner = process.env.ENTRA_OWNER_OBJECT_ID;
    process.env.SQL_DATABASE = database;
    process.env.ENTRA_OWNER_OBJECT_ID = owner;
    const output: string[] = [];
    try {
      const code = await main([
        'import', '--bundle', bundle, '--owner-object-id', owner, '--state-dir', join(path, 'state'),
        '--execute', '--batch-size', '1', '--tables', 'health_workouts',
      ], text => output.push(text));
      expect(code).toBe(3);
      expect(output.join('')).not.toContain('preexisting-value');
      expect(output.join('')).not.toContain(SYNTHETIC_SENTINEL);
      expect(JSON.parse(output.join(''))).toMatchObject({ status: 'conflicts', tables: { health_workouts: { conflicts: 1 } } });
    } finally {
      if (previousDatabase === undefined) delete process.env.SQL_DATABASE; else process.env.SQL_DATABASE = previousDatabase;
      if (previousOwner === undefined) delete process.env.ENTRA_OWNER_OBJECT_ID; else process.env.ENTRA_OWNER_OBJECT_ID = previousOwner;
    }
    expect((await pool.request().input('owner', sql.UniqueIdentifier, owner).input('id', sql.NVarChar(256), workoutRows[0]!.id).query(
      'SELECT workout_type FROM daily.health_workouts WHERE owner_object_id=@owner AND id=@id;',
    )).recordset).toEqual([{ workout_type: 'preexisting-value' }]);
  });

  it('imports only positively classified sanitized mixed rows and writes no excluded rows', async () => {
    const path = await directory();
    const bundle = join(path, 'bundle');
    await generateBundle({ bundle, seed: 22 });
    const readRows = async (table: string) => (await readFile(join(bundle, `${table}.ndjson`), 'utf8')).trim().split('\n')
      .map(line => JSON.parse(line) as Record<string, unknown>);
    const runs = (await readRows('attention_runs')).map(row => ({
      ...row, idempotency_key: 'SYNTHETIC_RUN_KEY', mode: 'synthetic', captured_at: '2026-10-18T00:00:00Z',
      received_at: '2026-10-18T00:00:00Z', checksum: 'SYNTHETIC_CHECKSUM', status: 'complete', source_status_json: '{}',
    }));
    const snapshots = (await readRows('attention_source_snapshots')).map(row => ({ ...row, source: 'SYNTHETIC_TICKTICK' }));
    const items = (await readRows('attention_items')).map(row => ({ ...row, source: 'SYNTHETIC_TICKTICK' }));
    const briefs = (await readRows('briefing_runs')).map(row => ({
      ...row, trigger: 'synthetic', started_at: '2026-10-18T00:00:00Z', status: 'complete',
      body_json: '{}', source_snapshots_json: '{}', delivery_status: 'not_requested', updated_at: '2026-10-18T00:00:00Z',
    }));
    const rules = (await readRows('attention_rule_config')).map(row => ({ ...row, source: 'SYNTHETIC_UNCLASSIFIED' }));
    await rewriteRows(bundle, 'attention_runs', runs);
    await rewriteRows(bundle, 'attention_source_snapshots', snapshots);
    await rewriteRows(bundle, 'attention_items', items);
    await rewriteRows(bundle, 'briefing_runs', briefs);
    await rewriteRows(bundle, 'attention_rule_config', rules);
    const manifest = JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8')) as Manifest;
    manifest.rulings!.attention_source_snapshots = { decision: 'exclude', rule: 'synthetic excluded source' };
    manifest.rulings!.attention_items = { decision: 'import-sanitised', rule: 'empty-payload-v1' };
    manifest.rulings!.attention_rule_config = { decision: 'exclude', rule: 'synthetic excluded source' };
    await writeFile(join(bundle, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });

    const owner = '77777777-7777-4777-8777-777777777777';
    const report = await importBundle({
      bundle, ownerObjectId: owner, stateDir: join(path, 'state'), execute: true,
      tables: ['attention_items', 'attention_source_snapshots', 'attention_runs', 'attention_rule_config', 'briefing_runs'],
    }, pool, owner);
    expect(report.tables.attention_runs).toMatchObject({ inserted: 1, excludedRows: 0 });
    expect(report.tables.briefing_runs).toMatchObject({ inserted: 1 });
    expect(report.tables.attention_items?.excludedRows).toBe(1);
    expect(report.tables.attention_source_snapshots?.excludedRows).toBe(1);
    expect(report.tables.attention_rule_config?.excludedRows).toBe(1);
    for (const table of ['attention_source_snapshots', 'attention_items', 'attention_rule_config']) {
      expect((await pool.request().input('owner', sql.UniqueIdentifier, owner).query(
        `SELECT COUNT(*) AS count FROM daily.[${table}] WHERE owner_object_id=@owner;`,
      )).recordset[0]!.count).toBe(0);
    }
  });

  it('preserves bigint boundaries and exact maximum-length padded keys', async () => {
    const path = await directory();
    const { bundle, workoutRows } = await bundleFixture(path, 1);
    const sync = (await readFile(join(bundle, 'health_sync_state.ndjson'), 'utf8')).trim().split('\n')
      .map(line => JSON.parse(line) as Record<string, unknown>);
    await rewriteRows(bundle, 'health_sync_state', [
      { ...sync[0], id: '-9223372036854775808' },
      { ...sync[0], id: '9223372036854775807' },
    ]);
    const owner = '88888888-8888-4888-8888-888888888888';
    const report = await importBundle({
      bundle, ownerObjectId: owner, stateDir: join(path, 'state'), execute: true, batchSize: 1,
      tables: ['health_workouts', 'health_sync_state'],
    }, pool, owner);
    expect(report.status).toBe('complete');
    const keys = await pool.request().input('owner', sql.UniqueIdentifier, owner).query<{ id: string; length: number }>(
      'SELECT id, DATALENGTH(id) AS length FROM daily.health_workouts WHERE owner_object_id=@owner;',
    );
    expect(keys.recordset[0]!.id).toBe(workoutRows[0]!.id);
    expect(keys.recordset[0]!.length).toBe(512);
    const integers = await pool.request().input('owner', sql.UniqueIdentifier, owner).query<{ id: string }>(
      'SELECT id FROM daily.health_sync_state WHERE owner_object_id=@owner ORDER BY id;',
    );
    expect(integers.recordset.map(row => row.id)).toEqual(['-9223372036854775808', '9223372036854775807']);
  });
});
