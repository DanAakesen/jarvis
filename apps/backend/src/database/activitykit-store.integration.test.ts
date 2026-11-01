import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readDownMigration, readMigrations, revertMigration, type Migration } from './migrations.js';
import { createActivityRegistrationStore, type ActivityRegistration } from './activitykit-store.js';

const configuration = loadDatabaseConfig();
if (!configuration || process.env.NODE_ENV !== 'test' || configuration.server !== '127.0.0.1') {
  throw new Error('ActivityKit integration tests require isolated loopback SQL Server');
}
const database = `jarvis_activitykit_ci_${randomUUID().replaceAll('-', '')}`;
const admin = new sql.ConnectionPool({ ...configuration, database: 'master' });
const pool = new sql.ConnectionPool({ ...configuration, database });
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const name = '0071_activitykit_registrations.sql';
let migrations: Migration[];
const registration: ActivityRegistration = {
  activityId: 'fixture', kind: 'factory_task', resourceId: '42', pushToken: 'ab'.repeat(32), language: 'en',
};
const store = createActivityRegistrationStore(pool);
beforeAll(async () => {
  await admin.connect();
  await admin.request().batch(`CREATE DATABASE [${database}];`);
  await pool.connect();
  migrations = (await readMigrations()).filter((migration) => migration.name === name);
  await applyMigrations(pool, migrations);
});
beforeEach(async () => { await pool.request().query('DELETE dbo.activitykit_registrations;'); });
afterAll(async () => {
  await pool.close();
  if (admin.connected) await admin.request().batch(`IF DB_ID(N'${database}') IS NOT NULL BEGIN
    ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}]; END;`);
  await admin.close();
});
describe('durable ActivityKit registrations', () => {
  it('persists owner scope across instances and protects a rotated token from stale invalidation', async () => {
    expect(await store.upsert(owner, registration)).toBe(true);
    expect(await createActivityRegistrationStore(pool).list(owner)).toEqual([registration]);
    expect(await store.list(other)).toEqual([]);
    await store.remove(other, registration.activityId);
    const rotated = { ...registration, pushToken: 'cd'.repeat(32) };
    expect(await store.upsert(owner, rotated)).toBe(true);
    await store.remove(owner, registration.activityId, registration.pushToken);
    expect(await store.list(owner)).toEqual([rotated]);
    await store.remove(owner, registration.activityId, rotated.pushToken);
    expect(await store.list(owner)).toEqual([]);
  });
  it('bounds concurrent inserts per owner without dropping another live activity', async () => {
    const results = await Promise.all(Array.from({ length: 24 }, (_, index) =>
      store.upsert(owner, { ...registration, activityId: `fixture-${index}` })));
    expect(results.filter(Boolean)).toHaveLength(20);
    expect(await store.list(owner)).toHaveLength(20);
    expect(await store.upsert(other, registration)).toBe(true);
    expect(await store.list(other)).toHaveLength(1);
  });
  it('filters expired registrations, prunes on registration and refuses destructive rollback', async () => {
    await store.upsert(owner, registration);
    await pool.request().query("UPDATE dbo.activitykit_registrations SET expires_at=DATEADD(second, -1, SYSUTCDATETIME());");
    expect(await store.list(owner)).toEqual([]);
    await store.upsert(owner, { ...registration, activityId: 'new-fixture' });
    expect(await store.list(owner)).toHaveLength(1);
    const down = await readDownMigration(name);
    await expect(revertMigration(pool, migrations, down)).rejects.toThrow('must be removed explicitly');
    await store.remove(owner, 'new-fixture');
    expect(await revertMigration(pool, migrations, down)).toBe(name);
    expect(await applyMigrations(pool, migrations)).toEqual([name]);
  });
});
