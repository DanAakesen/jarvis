import { createHash, randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readMigrations, type Migration } from './migrations.js';

const configuration = loadDatabaseConfig();
if (!configuration || process.env.NODE_ENV !== 'test' || configuration.server !== '127.0.0.1') {
  throw new Error('Database integration tests require an isolated loopback SQL Server test configuration');
}
const database = `jarvis_ci_${randomUUID().replaceAll('-', '')}`;
const administrator = new sql.ConnectionPool({ ...configuration, database: 'master' });
const pool = new sql.ConnectionPool({ ...configuration, database });
function migration(name: string, text: string): Migration {
  return { name, sql: text, checksum: createHash('sha256').update(text).digest('hex') };
}
const first = migration('0001_fixture.sql', `CREATE TABLE dbo.migration_fixture (id int NOT NULL PRIMARY KEY, value nvarchar(32) NOT NULL);
  INSERT dbo.migration_fixture VALUES (1, N'original');`);

beforeAll(async () => {
  await administrator.connect();
  await administrator.request().batch(`CREATE DATABASE [${database}];`);
  await pool.connect();
});
afterAll(async () => {
  await pool.close();
  if (administrator.connected) {
    await administrator.request().batch(`IF DB_ID(N'${database}') IS NOT NULL BEGIN
      ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
      DROP DATABASE [${database}]; END;`);
  }
  await administrator.close();
});

describe.sequential('real SQL Server migration contract', () => {
  it('boots the committed migration manifest twice without duplicate ledger rows', async () => {
    expect(await applyMigrations(pool, await readMigrations())).toEqual([]);
    expect(await applyMigrations(pool, await readMigrations())).toEqual([]);
  });
  it('serializes concurrent backend replicas and applies the same migration exactly once', async () => {
    const other = new sql.ConnectionPool({ ...configuration, database });
    try {
      await other.connect();
      const results = await Promise.all([applyMigrations(pool, [first]), applyMigrations(other, [first])]);
      expect(results.flat()).toEqual([first.name]);
      const rows = await pool.request().query('SELECT id, value FROM dbo.migration_fixture');
      expect(rows.recordset).toEqual([{ id: 1, value: 'original' }]);
      expect((await pool.request().query('SELECT name FROM dbo.schema_migrations')).recordset).toEqual([{ name: first.name }]);
    } finally { await other.close(); }
  });
  it('rolls back schema, data and ledger together on a failed migration', async () => {
    const broken = migration('0002_broken.sql', `CREATE TABLE dbo.rollback_fixture (id int);
      UPDATE dbo.migration_fixture SET value=N'changed'; THROW 51000, 'fixture failure', 1;`);
    await expect(applyMigrations(pool, [first, broken])).rejects.toThrow();
    expect((await pool.request().query("SELECT OBJECT_ID(N'dbo.rollback_fixture', N'U') AS id")).recordset).toEqual([{ id: null }]);
    expect((await pool.request().query('SELECT value FROM dbo.migration_fixture')).recordset).toEqual([{ value: 'original' }]);
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM dbo.schema_migrations')).recordset).toEqual([{ count: 1 }]);
    const second = migration('0002_recovered.sql', 'ALTER TABLE dbo.migration_fixture ADD recovered bit NULL;');
    expect(await applyMigrations(pool, [first, second])).toEqual([second.name]);
    expect(await applyMigrations(pool, [first, second])).toEqual([]);
  });
  it('rejects changed, removed or reordered applied history without changing stored data', async () => {
    await expect(applyMigrations(pool, [migration(first.name, 'DROP TABLE dbo.migration_fixture;')])).rejects.toThrow('committed migration history');
    await expect(applyMigrations(pool, [])).rejects.toThrow('committed migration history');
    expect((await pool.request().query('SELECT value FROM dbo.migration_fixture')).recordset).toEqual([{ value: 'original' }]);
  });
  it('cancels active SQL and rolls back before allowing another owner', async () => {
    const history = await pool.request().query<{ name: string; checksum: string }>('SELECT name, checksum FROM dbo.schema_migrations ORDER BY name');
    const applied = history.recordset.map((row) => ({ ...row, sql: '' }));
    const pending = migration('0003_cancelled.sql', "CREATE TABLE dbo.cancelled_fixture (id int); WAITFOR DELAY '00:00:30';");
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, 500);
    try { await expect(applyMigrations(pool, [...applied, pending], 60_000, controller.signal)).rejects.toThrow(); }
    finally { clearTimeout(timer); }
    expect((await pool.request().query("SELECT OBJECT_ID(N'dbo.cancelled_fixture', N'U') AS id")).recordset).toEqual([{ id: null }]);
    expect(await applyMigrations(pool, applied)).toEqual([]);
  });
  it('refuses a migration when another owner holds the lock and leaves no new state', async () => {
    const blocker = new sql.Transaction(pool);
    await blocker.begin();
    try {
      await new sql.Request(blocker).query(`EXEC sys.sp_getapplock @Resource=N'jarvis.schema-migrations', @LockMode='Exclusive', @LockOwner='Transaction';`);
      await expect(applyMigrations(pool, [], 25)).rejects.toThrow('lock was not acquired');
    } finally { await blocker.rollback(); }
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM dbo.schema_migrations')).recordset).toEqual([{ count: 2 }]);
  });
});
