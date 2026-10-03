import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultMigrationsDirectory, readMigrations } from './migrations.js';

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
});
