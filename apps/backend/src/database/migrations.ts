import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';

export interface Migration { name: string; checksum: string; sql: string }
export const defaultMigrationsDirectory = fileURLToPath(new URL('../../../../db/migrations/', import.meta.url));

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
    if (!file.isFile() || !/^\d{4}_[a-z0-9_]+\.sql$/.test(file.name) || versions.has(version)) {
      throw new Error('Invalid or duplicate database migration name');
    }
    versions.add(version);
    const contents = await readFile(join(directory, file.name));
    if (contents.length > 1024 * 1024) throw new Error('Database migration exceeds size limit');
    const text = contents.toString('utf8');
    if (!text.trim() || /^\s*GO(?:\s+\d+)?\s*(?:--.*)?$/im.test(text)) {
      throw new Error('Database migration must be a nonempty SQL batch without GO');
    }
    migrations.push({ name: file.name, checksum: createHash('sha256').update(contents).digest('hex'), sql: text });
  }
  return migrations;
}

export async function applyMigrations(pool: sql.ConnectionPool, migrations: readonly Migration[], lockTimeoutMs = 60_000, signal?: AbortSignal): Promise<string[]> {
  signal?.throwIfAborted();
  const transaction = new sql.Transaction(pool);
  let rolledBack = false;
  transaction.on('rollback', () => { rolledBack = true; });
  await transaction.begin();
  const run = async <T>(request: sql.Request, execute: () => Promise<T>): Promise<T> => {
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
    const ledgerRequest = new sql.Request(transaction);
    await run(ledgerRequest, () => ledgerRequest.batch(`IF OBJECT_ID(N'dbo.schema_migrations', N'U') IS NULL
      CREATE TABLE dbo.schema_migrations (
        name nvarchar(255) NOT NULL CONSTRAINT PK_schema_migrations PRIMARY KEY,
        checksum char(64) NOT NULL,
        applied_at datetime2(7) NOT NULL CONSTRAINT DF_schema_migrations_applied_at DEFAULT SYSUTCDATETIME()
      );`));
    const historyRequest = new sql.Request(transaction);
    const { recordset } = await run(historyRequest, () => historyRequest.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM dbo.schema_migrations ORDER BY name'));
    // Applied migrations must be an unchanged prefix: never silently remove,
    // rewrite or insert a migration before one deployed by another revision.
    if (recordset.some((row, index) => migrations[index]?.name !== row.name || migrations[index]?.checksum !== row.checksum)) {
      throw new Error('Applied database migrations differ from the committed migration history');
    }
    const applied: string[] = [];
    for (const migration of migrations.slice(recordset.length)) {
      const batchRequest = new sql.Request(transaction);
      await run(batchRequest, () => batchRequest.batch(migration.sql));
      const insertRequest = new sql.Request(transaction)
        .input('name', sql.NVarChar(255), migration.name)
        .input('checksum', sql.Char(64), migration.checksum);
      await run(insertRequest, () => insertRequest.query('INSERT INTO dbo.schema_migrations (name, checksum) VALUES (@name, @checksum)'));
      applied.push(migration.name);
    }
    signal?.throwIfAborted();
    await transaction.commit();
    return applied;
  } catch (error) {
    if (!rolledBack) await transaction.rollback();
    throw error;
  }
}
