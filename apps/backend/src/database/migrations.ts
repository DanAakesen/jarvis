import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';

export interface Migration { name: string; checksum: string; sql: string }
export interface DownMigration { name: string; sql: string }
const migrationName = /^\d{4}_[a-z0-9_]+\.sql$/;
export const defaultMigrationsDirectory = fileURLToPath(new URL('../../../../db/migrations/', import.meta.url));

async function readBatch(path: string): Promise<{ contents: Buffer; text: string }> {
  const contents = await readFile(path);
  if (contents.length > 1024 * 1024) throw new Error('Database migration exceeds size limit');
  const text = contents.toString('utf8');
  if (!text.trim() || /^\s*GO(?:\s+\d+)?\s*(?:--.*)?$/im.test(text)) {
    throw new Error('Database migration must be a nonempty SQL batch without GO');
  }
  return { contents, text };
}

// Only reviewed, committed files are executed. SQL Server batch separators (GO)
// are client commands, not SQL: each migration must be one executable batch.
export async function readMigrations(directory = defaultMigrationsDirectory): Promise<Migration[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.name.endsWith('.sql')).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  if (files.length > 1000) throw new Error('Too many database migrations');
  const migrations: Migration[] = [];
  const versions = new Set<string>();
  for (const file of files) {
    const version = file.name.slice(0, 4);
    if (!file.isFile() || !migrationName.test(file.name) || versions.has(version)) {
      throw new Error('Invalid or duplicate database migration name');
    }
    versions.add(version);
    const { contents, text } = await readBatch(join(directory, file.name));
    migrations.push({ name: file.name, checksum: createHash('sha256').update(contents).digest('hex'), sql: text });
  }
  return migrations;
}

// A down script lives in down/ under the same name as the migration it reverses.
// It is never run at startup; see revertMigration.
export async function readDownMigration(name: string, directory = defaultMigrationsDirectory): Promise<DownMigration> {
  if (!migrationName.test(name)) throw new Error('Invalid database migration name');
  return { name, sql: (await readBatch(join(directory, 'down', name))).text };
}

type Run = <T>(request: sql.Request, execute: () => Promise<T>) => Promise<T>;

async function withMigrationLock<T>(pool: sql.ConnectionPool, lockTimeoutMs: number, signal: AbortSignal | undefined,
  body: (transaction: sql.Transaction, run: Run) => Promise<T>): Promise<T> {
  signal?.throwIfAborted();
  const transaction = new sql.Transaction(pool);
  let rolledBack = false;
  transaction.on('rollback', () => { rolledBack = true; });
  await transaction.begin();
  const run: Run = async (request, execute) => {
    signal?.throwIfAborted();
    const cancel = () => { request.cancel(); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const result = await execute();
      signal?.throwIfAborted();
      return result;
    } finally { signal?.removeEventListener('abort', cancel); }
  };
  try {
    signal?.throwIfAborted();
    const lockRequest = new sql.Request(transaction)
      .input('resource', sql.NVarChar(255), 'jarvis.schema-migrations')
      .input('timeout', sql.Int, lockTimeoutMs);
    const lock = await run(lockRequest, () => lockRequest.query<{ result: number }>(`DECLARE @result int;
        EXEC @result = sys.sp_getapplock @Resource=@resource, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=@timeout;
        SELECT @result AS result;`));
    if ((lock.recordset[0]?.result ?? -999) < 0) throw new Error('Database migration lock was not acquired');
    const result = await body(transaction, run);
    signal?.throwIfAborted();
    await transaction.commit();
    return result;
  } catch (error) {
    if (!rolledBack) await transaction.rollback();
    throw error;
  }
}

async function readHistory(transaction: sql.Transaction, run: Run, migrations: readonly Migration[]) {
  const historyRequest = new sql.Request(transaction);
  const { recordset } = await run(historyRequest, () => historyRequest.query<{ name: string; checksum: string }>(
    'SELECT name, checksum FROM dbo.schema_migrations ORDER BY name'));
  // Applied migrations must be an unchanged prefix: never silently remove,
  // rewrite or insert a migration before one deployed by another revision.
  if (recordset.some((row, index) => migrations[index]?.name !== row.name || migrations[index]?.checksum !== row.checksum)) {
    throw new Error('Applied database migrations differ from the committed migration history');
  }
  return recordset;
}

export async function applyMigrations(pool: sql.ConnectionPool, migrations: readonly Migration[], lockTimeoutMs = 60_000, signal?: AbortSignal): Promise<string[]> {
  return withMigrationLock(pool, lockTimeoutMs, signal, async (transaction, run) => {
    const ledgerRequest = new sql.Request(transaction);
    await run(ledgerRequest, () => ledgerRequest.batch(`IF OBJECT_ID(N'dbo.schema_migrations', N'U') IS NULL
      CREATE TABLE dbo.schema_migrations (
        name nvarchar(255) NOT NULL CONSTRAINT PK_schema_migrations PRIMARY KEY,
        checksum char(64) NOT NULL,
        applied_at datetime2(7) NOT NULL CONSTRAINT DF_schema_migrations_applied_at DEFAULT SYSUTCDATETIME()
      );`));
    const history = await readHistory(transaction, run, migrations);
    const applied: string[] = [];
    for (const migration of migrations.slice(history.length)) {
      const batchRequest = new sql.Request(transaction);
      await run(batchRequest, () => batchRequest.batch(migration.sql));
      const insertRequest = new sql.Request(transaction)
        .input('name', sql.NVarChar(255), migration.name)
        .input('checksum', sql.Char(64), migration.checksum);
      await run(insertRequest, () => insertRequest.query('INSERT INTO dbo.schema_migrations (name, checksum) VALUES (@name, @checksum)'));
      applied.push(migration.name);
    }
    return applied;
  });
}

// Reverses only the most recently applied migration, under the same lock and
// transaction as startup, so the schema and ledger change together or not at all.
export async function revertMigration(pool: sql.ConnectionPool, migrations: readonly Migration[], down: DownMigration, lockTimeoutMs = 60_000, signal?: AbortSignal): Promise<string> {
  return withMigrationLock(pool, lockTimeoutMs, signal, async (transaction, run) => {
    const ledgerRequest = new sql.Request(transaction);
    const ledger = await run(ledgerRequest, () => ledgerRequest.query<{ id: number | null }>("SELECT OBJECT_ID(N'dbo.schema_migrations', N'U') AS id"));
    if (ledger.recordset[0]?.id == null) throw new Error('Only the latest applied database migration can be reverted');
    const history = await readHistory(transaction, run, migrations);
    if (history.at(-1)?.name !== down.name) throw new Error('Only the latest applied database migration can be reverted');
    const batchRequest = new sql.Request(transaction);
    await run(batchRequest, () => batchRequest.batch(down.sql));
    const deleteRequest = new sql.Request(transaction).input('name', sql.NVarChar(255), down.name);
    await run(deleteRequest, () => deleteRequest.query('DELETE FROM dbo.schema_migrations WHERE name = @name'));
    return down.name;
  });
}
