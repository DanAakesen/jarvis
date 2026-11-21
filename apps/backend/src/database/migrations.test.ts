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
  it('rejects duplicate sequence numbers', async () => {
    const path = await directory();
    await writeFile(join(path, '0001_first.sql'), 'SELECT 1;');
    await writeFile(join(path, '0001_second.sql'), 'SELECT 2;');
    await expect(readMigrations(path)).rejects.toThrow('duplicate');
  });
  it('ships a same-named down script for every committed migration', async () => {
    const migrations = await readMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    for (const migration of migrations) await expect(readDownMigration(migration.name)).resolves.toMatchObject({ name: migration.name });
  });
  it('ships the durable reply outbox and turn-claim store contract', async () => {
    const migrations = await readMigrations();
    const migration = migrations.find(({ name }) => name === '0093_reply_notification_outbox.sql');
    expect(migration?.sql).toContain('CREATE TABLE dbo.reply_notification_approval_claims');
    expect(migration?.sql).toContain('CREATE TABLE dbo.reply_notification_deliveries');
    expect(migration?.sql).toContain('UX_reply_notification_deliveries_message_registration');
    expect(migration?.sql).toContain("'pending', 'sending', 'accepted', 'failed', 'expired', 'invalid_token'");
    expect((await readDownMigration('0093_reply_notification_outbox.sql')).sql)
      .toContain('DROP TABLE dbo.reply_notification_deliveries');
  });
  it('ships per-device approval reconciliation for reply suppression', async () => {
    const migration = (await readMigrations()).find(({ name }) =>
      name === '0094_reply_notification_reconciliation.sql');
    expect(migration?.sql).toContain('CREATE TABLE dbo.reply_notification_approval_deliveries');
    expect(migration?.sql).toContain("state IN ('pending', 'sending', 'accepted', 'failed', 'expired', 'invalid_token', 'suppressed')");
    expect((await readDownMigration('0094_reply_notification_reconciliation.sql')).sql)
      .toContain('DROP TABLE dbo.reply_notification_approval_deliveries');
  });
  it('ships immutable registration terminalization for every delete path', async () => {
    const migration = (await readMigrations()).find(({ name }) =>
      name === '0095_notification_registration_terminalization.sql');
    expect(migration?.sql).toContain('INSTEAD OF DELETE');
    expect(migration?.sql).toContain('a.device_reference = CONVERT(char(36), r.registration_id)');
    expect(migration?.sql).toContain("a.state = N'sending'");
    expect((await readDownMigration('0095_notification_registration_terminalization.sql')).sql)
      .toContain('DROP TRIGGER');
  });
  it('ships persistent invalid APNs token tombstones', async () => {
    const migration = (await readMigrations()).find(({ name }) =>
      name === '0096_apns_device_token_tombstones.sql');
    expect(migration?.sql).toContain('CREATE TABLE dbo.approval_notification_token_tombstones');
    expect(migration?.sql).toContain('PRIMARY KEY (owner_object_id, device_token_hash)');
    expect((await readDownMigration('0096_apns_device_token_tombstones.sql')).sql)
      .toContain('DROP TABLE dbo.approval_notification_token_tombstones');
  });
  it('ships the durable owner-reminder APNs outbox and retry state', async () => {
    const migration = (await readMigrations()).find(({ name }) =>
      name === '0102_owner_reminder_delivery_outbox.sql');
    expect(migration?.sql).toContain('CREATE TABLE dbo.owner_reminder_deliveries');
    expect(migration?.sql).toContain('CREATE TABLE dbo.owner_reminder_delivery_snapshots');
    expect(migration?.sql).toContain("N'scheduled', N'sending', N'retrying'");
    expect(migration?.sql).toContain('UX_owner_reminder_deliveries_occurrence_device');
    expect(migration?.sql).toContain('ALTER TRIGGER dbo.TR_approval_notification_registrations_terminalize_deliveries');
    expect((await readDownMigration('0102_owner_reminder_delivery_outbox.sql')).sql)
      .toContain('DROP TABLE dbo.owner_reminder_deliveries');
  });
  it('reads down scripts from down/ without treating them as forward migrations', async () => {
    const path = await directory();
    await mkdir(join(path, 'down'));
    await writeFile(join(path, '0001_first.sql'), 'CREATE TABLE dbo.t (id int);');
    await writeFile(join(path, 'down', '0001_first.sql'), 'DROP TABLE dbo.t;');
    expect((await readMigrations(path)).map((migration) => migration.name)).toEqual(['0001_first.sql']);
    expect(await readDownMigration('0001_first.sql', path)).toEqual({ name: '0001_first.sql', sql: 'DROP TABLE dbo.t;' });
  });
});
