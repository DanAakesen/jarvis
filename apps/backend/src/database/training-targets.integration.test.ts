import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { TrainingTargetsStore } from '../daily/training/targets-store.js';
import { composeDaily } from '../daily/composition.js';
import { createToolRegistry } from '../core/tool-registry.js';
import { dailyQuerySources } from '@jarvis/contracts';
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
  it('reads owner targets through the production-registered daily_query handler without defaults or cross-owner access', async () => {
    const ownerModule = composeDaily({ enabled: true, pool, ownerObjectId: owner })!;
    const ownerTool = createToolRegistry([ownerModule]).get('daily_query')!;
    const query = { source: dailyQuerySources.trainingTargets };
    const empty = await ownerTool.execute(query, requestFor(owner), signal()) as Record<string, unknown>;
    expect(empty).toMatchObject({
      status: 'available',
      items: [{ targets: { gymSessionsPerWeek: null, runSessionsPerWeek: null, dailySteps: null },
        missing: ['gymSessionsPerWeek', 'runSessionsPerWeek', 'dailySteps'], updatedAt: null }],
      freshness: { sourceProcessedCommittedAt: null, latestReturnedRecordUpdatedAt: null },
    });
    await TrainingTargetsStore.forRequest(pool, requestFor(owner)).write({ gymSessionsPerWeek: 0, dailySteps: 8_000 }, signal());
    await TrainingTargetsStore.forRequest(pool, requestFor(other)).write({ runSessionsPerWeek: 2 }, signal());

    const ownerResult = await ownerTool.execute(query, {
      server: { ownerObjectId: owner }, principal: null,
      agentPrincipal: { kind: 'jarvis-agent', objectId: owner, tenantId: 'synthetic-tenant' },
    } as unknown as FastifyRequest, signal()) as Record<string, unknown>;
    expect(ownerResult).toMatchObject({
      items: [{ targets: { gymSessionsPerWeek: 0, runSessionsPerWeek: null, dailySteps: 8_000 },
        missing: ['runSessionsPerWeek'] }],
      units: { gymSessionsPerWeek: 'sessions/week', runSessionsPerWeek: 'sessions/week', dailySteps: 'steps/day' },
    });
    expect(JSON.stringify(ownerResult)).not.toContain(owner);
    await expect(ownerTool.execute(query, {
      server: { ownerObjectId: owner }, principal: null,
    } as unknown as FastifyRequest, signal())).rejects.toThrow();
    await expect(ownerTool.execute(query, requestFor(other), signal())).rejects.toThrow();

    const otherModule = composeDaily({ enabled: true, pool, ownerObjectId: other })!;
    const otherTool = createToolRegistry([otherModule]).get('daily_query')!;
    const otherResult = await otherTool.execute(query, requestFor(other), signal()) as Record<string, unknown>;
    expect(otherResult).toMatchObject({ items: [{ targets: {
      gymSessionsPerWeek: null, runSessionsPerWeek: 2, dailySteps: null,
    } }] });
    expect(composeDaily({ enabled: false, pool: undefined, ownerObjectId: owner })).toBeUndefined();
  });
});
