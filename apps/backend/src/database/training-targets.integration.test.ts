import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { TrainingTargetsStore } from '../daily/training/targets-store.js';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readMigrations } from './migrations.js';

const configuration = loadDatabaseConfig();
if (!configuration || process.env.NODE_ENV !== 'test' || configuration.server !== '127.0.0.1') {
  throw new Error('Training-target integration tests require isolated loopback SQL Server');
}
const database = `jarvis_training_targets_ci_${randomUUID().replaceAll('-', '')}`;
const admin = new sql.ConnectionPool({ ...configuration, database: 'master' });
const pool = new sql.ConnectionPool({ ...configuration, database });
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const requestFor = (id: string) => ({
  server: { ownerObjectId: id }, principal: { objectId: id },
  agentPrincipal: null, runnerPrincipal: null,
}) as unknown as FastifyRequest;
const signal = () => new AbortController().signal;
const migrationNames = new Set(['0041_daily_owner_schema.sql', '0061_daily_training_targets.sql']);

beforeAll(async () => {
  await admin.connect();
  await admin.request().batch(`CREATE DATABASE [${database}];`);
  await pool.connect();
  const migrations = (await readMigrations()).filter((migration) => migrationNames.has(migration.name));
  await applyMigrations(pool, migrations);
});

afterAll(async () => {
  await pool.close();
  if (admin.connected) {
    await admin.request().batch(`IF DB_ID(N'${database}') IS NOT NULL BEGIN ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}]; END;`);
    await admin.close();
  }
});

describe('Daily training-target SQL persistence', () => {
  it('isolates owners, applies partial changes, clears all values, and enforces bounds', async () => {
    const store = TrainingTargetsStore.forRequest(pool, requestFor(owner));
    const otherStore = TrainingTargetsStore.forRequest(pool, requestFor(other));
    const empty = { gymSessionsPerWeek: null, runSessionsPerWeek: null, dailySteps: null };

    expect(await store.read(signal())).toEqual({ targets: empty, updatedAt: null });
    await store.write({ gymSessionsPerWeek: 3, dailySteps: 8_000 }, signal());
    expect(await store.read(signal())).toMatchObject({
      targets: { gymSessionsPerWeek: 3, runSessionsPerWeek: null, dailySteps: 8_000 },
    });
    expect(await otherStore.read(signal())).toEqual({ targets: empty, updatedAt: null });

    await store.write({ runSessionsPerWeek: 2 }, signal());
    expect(await store.read(signal())).toMatchObject({
      targets: { gymSessionsPerWeek: 3, runSessionsPerWeek: 2, dailySteps: 8_000 },
    });
    await store.write({ gymSessionsPerWeek: null, runSessionsPerWeek: null, dailySteps: null }, signal());
    expect(await store.read(signal())).toEqual({ targets: empty, updatedAt: null });

    await expect(pool.request().input('owner', sql.UniqueIdentifier, owner).query(`
      INSERT daily.training_targets (owner_object_id, daily_steps, updated_at)
      VALUES (@owner, 100001, SYSUTCDATETIME());`)).rejects.toThrow();
  });
});
