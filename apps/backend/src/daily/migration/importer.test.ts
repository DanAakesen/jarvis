import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConnectionPool } from 'mssql';
import { afterEach, describe, expect, it } from 'vitest';
import { dailyTables } from '../store/schema.js';
import { columnTypes, decisions, IMPORT_ORDER } from './decisions.js';
import { generateBundle } from './generate.js';
import {
  acquireState, assertConfiguredOwner, canonicalValue, classifyImportRow, importBundle, isTransientSqlError,
  selectedTables, writeCheckpoint, writeMigrationReport, type ImportCheckpoint,
} from './importer.js';

const owned = '11111111-1111-4111-8111-111111111111';
const dirs: string[] = [];
async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'daily-import-test-'));
  dirs.push(path);
  return path;
}
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('Daily import classification and boundaries', () => {
  it('plans selected tables in dependency order and rejects unknown identifiers', () => {
    expect(selectedTables(['health_workout_metrics', 'health_workouts'])).toEqual(['health_workouts', 'health_workout_metrics']);
    for (const table of Object.values(decisions).filter(decision => decision.target).flatMap(decision => decision.parents)) {
      expect(IMPORT_ORDER.indexOf(table.table)).toBeLessThan(IMPORT_ORDER.indexOf(
        Object.entries(decisions).find(([, decision]) => decision.parents.includes(table))![0] as keyof typeof dailyTables,
      ));
    }
    expect(() => selectedTables(['mcp_oauth_tokens'])).toThrow('tables-invalid');
    expect(() => selectedTables(['health_workouts', 'health_workouts'])).toThrow('tables-invalid');
  });

  it('uses the validator source rules for importable mixed rows', () => {
    expect(classifyImportRow('health_workouts', {}, undefined)).toBe(true);
    expect(classifyImportRow('attention_runs', { source_status_json: '{}' }, undefined)).toBe(false);
    expect(classifyImportRow('attention_runs', { source_status_json: '{}' }, { decision: 'exclude', rule: 'reviewed' })).toBe(false);
    expect(classifyImportRow('attention_runs', { source_status_json: '{}' }, { decision: 'import-sanitised', rule: 'empty-payload-v1' })).toBe(true);
    expect(classifyImportRow('attention_items', { source: 'gmail', content_json: '{}' }, { decision: 'import-sanitised', rule: 'empty-payload-v1' })).toBe(false);
    expect(dailyTables.nutrition_queue.columns).not.toContain('claim_token');
    expect(decisions.nutrition_queue?.excludedColumns).toContain('owner_email');
    expect(decisions.nutrition_queue?.excludedColumns).toContain('claim_token');
  });

  it('canonicalizes 64-bit integers, JSON objects, and NULL separately from zero', () => {
    expect(canonicalValue('health_sync_state', 'id', '9223372036854775807')).toBe('9223372036854775807');
    expect(canonicalValue('health_sync_state', 'id', '-9223372036854775808')).toBe('-9223372036854775808');
    expect(canonicalValue('nutrition_meals', 'components_json', '{"b":2,"a":1}')).toBe('{"a":1,"b":2}');
    expect(canonicalValue('nutrition_meals', 'protein_grams', null)).toBeNull();
    expect(canonicalValue('nutrition_meals', 'protein_grams', 0)).toBe(0);
  });

  it('classifies only known transient database conditions and refuses a different configured owner', () => {
    expect(isTransientSqlError({ number: 1205 })).toBe(true);
    expect(isTransientSqlError({ originalError: { code: 'ECONNRESET' } })).toBe(true);
    expect(isTransientSqlError({ number: 547, message: 'constraint' })).toBe(false);
    expect(assertConfiguredOwner(owned, owned)).toBe(owned);
    expect(() => assertConfiguredOwner('22222222-2222-4222-8222-222222222222', owned)).toThrow('owner-mismatch');
  });
});

describe('private importer state', () => {
  it('writes digest/count-only checkpoints atomically and resumes only the same bundle and batch size', async () => {
    const path = await directory();
    const digest = 'a'.repeat(64);
    const state = await acquireState(path, digest, 500);
    const checkpoint: ImportCheckpoint = {
      version: 1, manifestDigest: digest, batchSize: 500,
      tables: { health_workouts: { complete: false, batches: [{
        sourceRows: 1, importableRows: 1, excludedRows: 0, inserted: 1, skipped: 0, conflicts: 0,
        wouldInsert: 0, wouldSkip: 0, wouldConflict: 0, digest: 'b'.repeat(64),
      }] } },
    };
    await writeCheckpoint(path, checkpoint);
    await expect(acquireState(path, digest, 500)).rejects.toThrow('state-running');
    await state.release();

    const text = await readFile(join(path, '.daily-import-state.json'), 'utf8');
    expect(text).not.toContain('SYNTHETIC_PRIVATE_SENTINEL');
    const resumed = await acquireState(path, digest, 500);
    expect(resumed.checkpoint).toEqual(checkpoint);
    await resumed.release();
    await expect(acquireState(path, 'c'.repeat(64), 500)).rejects.toThrow('state-bundle-mismatch');
    await expect(acquireState(path, digest, 1000)).rejects.toThrow('state-bundle-mismatch');
  });

  it('refuses unknown state contents and a state directory inside the repository', async () => {
    const path = await directory();
    await writeFile(join(path, 'unknown'), '');
    await expect(acquireState(path, 'a'.repeat(64), 500)).rejects.toThrow('state-unknown');
    await expect(acquireState(process.cwd(), 'a'.repeat(64), 500)).rejects.toThrow('state-location-invalid');
  });

  it('does not reclaim a stale lock by pathname and admits only one concurrent importer', async () => {
    const path = await directory();
    const lockPath = join(path, '.daily-import.lock');
    const staleLock = JSON.stringify({ pid: Number.MAX_SAFE_INTEGER });
    await writeFile(lockPath, staleLock, { mode: 0o600 });
    await expect(acquireState(path, 'a'.repeat(64), 500)).rejects.toThrow('state-running');
    expect(await readFile(lockPath, 'utf8')).toBe(staleLock);
    await rm(lockPath);

    const attempts = await Promise.allSettled([
      acquireState(path, 'a'.repeat(64), 500),
      acquireState(path, 'a'.repeat(64), 500),
    ]);
    const acquired = attempts.filter((attempt): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof acquireState>>> =>
      attempt.status === 'fulfilled');
    expect(acquired).toHaveLength(1);
    expect(attempts.filter(attempt => attempt.status === 'rejected')).toHaveLength(1);
    await acquired[0]!.value.release();
  });

  it('opens checkpoint state without following links and keeps writes anchored to the acquired directory', async () => {
    const root = await directory();
    const path = join(root, 'state');
    await mkdir(path, { mode: 0o700 });
    const sentinel = join(root, 'sentinel');
    await writeFile(sentinel, 'synthetic external state', { mode: 0o600 });
    await symlink(sentinel, join(path, '.daily-import-state.json'));
    await expect(acquireState(path, 'a'.repeat(64), 500)).rejects.toThrow('state-invalid');
    expect(await readFile(sentinel, 'utf8')).toBe('synthetic external state');

    await rm(join(path, '.daily-import-state.json'));
    const state = await acquireState(path, 'a'.repeat(64), 500);
    const moved = join(root, 'moved-state');
    await rename(path, moved);
    await symlink(sentinel, path);
    await writeCheckpoint(state.directory, {
      version: 1, manifestDigest: 'a'.repeat(64), batchSize: 500, tables: {},
    });
    expect(await readdir(moved)).toContain('.daily-import-state.json');
    expect(await readFile(sentinel, 'utf8')).toBe('synthetic external state');
    await state.release();
    expect(await readdir(moved)).not.toContain('.daily-import.lock');
  });

  it('writes a report over a symlink without changing its target', async () => {
    const root = await directory();
    const reports = join(root, 'reports');
    await mkdir(reports, { mode: 0o700 });
    const sentinel = join(root, 'sentinel');
    await writeFile(sentinel, 'synthetic external report', { mode: 0o600 });
    const output = join(reports, 'report.json');
    await symlink(sentinel, output);
    await writeMigrationReport(output, join(root, 'bundle'), undefined, {
      formatVersion: 1, operation: 'import', status: 'complete', bundleDigest: 'a'.repeat(64),
      tables: {}, excludedTables: 0, excludedRows: 0,
    });
    expect(JSON.parse(await readFile(output, 'utf8'))).toMatchObject({ bundleDigest: 'a'.repeat(64) });
    expect(await readFile(sentinel, 'utf8')).toBe('synthetic external report');
  });
});

describe('dry-run import', () => {
  it('classifies rows against the owner target without issuing any write statement', async () => {
    const root = await directory();
    const bundle = join(root, 'bundle');
    const stateDir = join(root, 'state');
    await mkdir(stateDir, { mode: 0o700 });
    await generateBundle({ bundle, seed: 22 });
    const statements: string[] = [];
    const rows = Object.entries(dailyTables).flatMap(([table, definition]) => [
      { TABLE_NAME: table, COLUMN_NAME: 'owner_object_id', DATA_TYPE: 'uniqueidentifier', CHARACTER_MAXIMUM_LENGTH: null },
      ...definition.columns.map(column => ({
        TABLE_NAME: table, COLUMN_NAME: column, DATA_TYPE: columnTypes[table as keyof typeof dailyTables][column]!,
        CHARACTER_MAXIMUM_LENGTH: (definition.keyTypes as Record<string, { type: string; maxLength?: number }>)[column]?.maxLength ?? null,
      })),
    ]);
    const fakePool = {
      connected: true,
      request: () => ({
        input() { return this; },
        async query(statement: string) {
          statements.push(statement);
          return { recordset: statement.includes('INFORMATION_SCHEMA.COLUMNS') ? rows : [] };
        },
      }),
    } as unknown as ConnectionPool;
    const result = await importBundle({
      bundle, ownerObjectId: owned, stateDir, batchSize: 1, tables: ['health_workouts'],
    }, fakePool, owned);
    expect(result.status).toBe('complete');
    expect(result.tables.health_workouts).toMatchObject({
      sourceRows: 1, importableRows: 1, wouldInsert: 1, inserted: 0, skipped: 0, conflicts: 0,
    });
    expect(statements.every(statement => /^\s*SELECT/i.test(statement))).toBe(true);
    expect(await readdir(stateDir)).toEqual([]);
  });
});
