import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultMigrationsDirectory, readDownMigration, readMigrations } from './migrations.js';

const directories: string[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'jarvis-migration-'));
  directories.push(path);
  return path;
}
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true }))); });

describe('committed SQL manifest', () => {
  it('finds committed migrations at the repository root without a directory override', async () => {
    expect(defaultMigrationsDirectory).toMatch(/\/db\/migrations\/$/);
    await expect(readMigrations()).resolves.toBeInstanceOf(Array);
  });
  it('orders numbered migrations and computes immutable checksums from bytes', async () => {
    const path = await directory();
    await writeFile(join(path, '0002_second.sql'), 'SELECT 2;');
    await writeFile(join(path, '0001_first.sql'), 'SELECT 1;');
    await writeFile(join(path, 'README.md'), 'Not SQL');
    const migrations = await readMigrations(path);
    expect(migrations.map((migration) => migration.name)).toEqual(['0001_first.sql', '0002_second.sql']);
    expect(migrations[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
    await writeFile(join(path, '0001_first.sql'), 'SELECT 3;');
    expect((await readMigrations(path))[0]?.checksum).not.toBe(migrations[0]?.checksum);
  });
  it.each(['SELECT 1;\nGO\nSELECT 2;', '', 'GO 2 -- repeat'])('rejects unsupported empty or GO batches %#', async (contents) => {
    const path = await directory();
    await writeFile(join(path, '0001_first.sql'), contents);
    await expect(readMigrations(path)).rejects.toThrow('nonempty SQL batch');
  });
  it('rejects duplicate sequence numbers', async () => {
    const path = await directory();
    await writeFile(join(path, '0001_first.sql'), 'SELECT 1;');
    await writeFile(join(path, '0001_second.sql'), 'SELECT 2;');
    await expect(readMigrations(path)).rejects.toThrow('duplicate');
  });
  it('ships a reviewed down script for every committed migration', async () => {
    const migrations = await readMigrations();
    const names = migrations.map((migration) => migration.name);
    expect(names).toEqual([
      '0001_core_tables.sql', '0002_sandbox_operations.sql', '0003_sandbox_agent_name.sql',
      '0004_credential_renewal.sql', '0005_task_event_archives.sql', '0007_usage.sql',
      '0008_activity_dismissals.sql', '0009_github_release_records.sql',
      '0010_idle_expired_sessions.sql', '0011_alert_deduplication.sql', '0014_teams_notifications.sql',
    ]);
    for (const migration of migrations) await expect(readDownMigration(migration.name)).resolves.toMatchObject({ name: migration.name });
  });
  it('reads down scripts from down/ without treating them as forward migrations', async () => {
    const path = await directory();
    await mkdir(join(path, 'down'));
    await writeFile(join(path, '0001_first.sql'), 'CREATE TABLE dbo.t (id int);');
    await writeFile(join(path, 'down', '0001_first.sql'), 'DROP TABLE dbo.t;');
    expect((await readMigrations(path)).map((migration) => migration.name)).toEqual(['0001_first.sql']);
    expect(await readDownMigration('0001_first.sql', path)).toEqual({ name: '0001_first.sql', sql: 'DROP TABLE dbo.t;' });
    await writeFile(join(path, 'down', '0001_first.sql'), 'DROP TABLE dbo.t;\nGO');
    await expect(readDownMigration('0001_first.sql', path)).rejects.toThrow('nonempty SQL batch');
    await expect(readDownMigration('../0001_first.sql', path)).rejects.toThrow('Invalid database migration name');
    await expect(readDownMigration('0002_missing.sql', path)).rejects.toThrow();
  });
});
