import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BackgroundJob } from '@jarvis/contracts';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readDownMigration, readMigrations, revertMigration, type Migration } from './migrations.js';
import { createBackgroundJobStore } from './background-job-store.js';

const configuration = loadDatabaseConfig();
if (!configuration || process.env.NODE_ENV !== 'test' || configuration.server !== '127.0.0.1') {
  throw new Error('Background job integration tests require isolated loopback SQL Server');
}
const database = `jarvis_jobs_ci_${randomUUID().replaceAll('-', '')}`;
const admin = new sql.ConnectionPool({ ...configuration, database: 'master' });
const pool = new sql.ConnectionPool({ ...configuration, database });
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const migrationName = '0053_background_job_dismissals.sql';
const recoveryMigration = '0066_research_result_recovery.sql';
const workspaceMigration = '0067_workspaces_identifiers.sql';
const store = createBackgroundJobStore(pool);
let migrations: Migration[];
let jobs: BackgroundJob[];

beforeAll(async () => {
  await admin.connect();
  await admin.request().batch(`CREATE DATABASE [${database}];`);
  await pool.connect();
  migrations = (await readMigrations()).filter((migration) =>
    ['0029_background_jobs.sql', '0034_research_job_retry.sql', migrationName, recoveryMigration, workspaceMigration].includes(migration.name));
  await applyMigrations(pool, migrations);
});

beforeEach(async () => {
  await pool.request().query('DELETE dbo.background_jobs;');
  const at = new Date().toISOString();
  jobs = (['running', 'done', 'failed', 'cancelled'] as const).map((status) => ({
    jobId: randomUUID(),
    kind: 'research',
    title: `Synthetic ${status}`,
    status,
    step: status === 'done' ? 2 : 1,
    steps: 2,
    ...(status === 'done' ? { viewId: 'synthetic-result' } : {}),
    ...(status === 'failed' ? { detail: 'interrupted by restart' } : {}),
    startedAt: at,
    updatedAt: at,
  }));
  for (const job of jobs) await store.create(job);
});

afterAll(async () => {
  await pool.close();
  if (admin.connected) {
    await admin.request().batch(`IF DB_ID(N'${database}') IS NOT NULL BEGIN
      ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
      DROP DATABASE [${database}]; END;`);
  }
  await admin.close();
});

describe('durable background job dismissals on SQL Server', () => {
  it('persists the owner-authorized Workspaces result reference and delivery state across store instances', async () => {
    const jobId = jobs[0]!.jobId;
    const completed: BackgroundJob = {
      ...jobs[0]!,
      status: 'done',
      step: 2,
      viewId: `research-${jobId.replaceAll('-', '')}`,
      resultId: `research:${jobId}`,
      resultDelivery: 'pending',
    };
    expect(await store.update(completed)).toMatchObject(completed);
    expect(await store.updateResultDelivery(jobId, 'unknown')).toMatchObject({
      resultId: `research:${jobId}`, resultDelivery: 'unknown',
    });
    const restarted = createBackgroundJobStore(pool);
    expect((await restarted.get(jobId))?.details.job).toMatchObject({
      resultId: `research:${jobId}`, resultDelivery: 'unknown',
    });
    expect(await restarted.updateResultDelivery(jobId, 'delivered')).toMatchObject({ resultDelivery: 'delivered' });
    expect(await restarted.updateResultDelivery(jobId, 'unknown')).toBeNull();
    expect((await store.get(jobId))?.details.job.resultDelivery).toBe('delivered');
  });

  it('applies once and persists idempotent owner visibility across store instances without changing audit details', async () => {
    expect(await applyMigrations(pool, migrations)).toEqual([]);
    const id = jobs[1]!.jobId;
    const before = await store.get(id);
    expect(await store.dismiss!(owner, [id.toUpperCase(), id])).toEqual({ dismissedJobIds: [id], runningJobIds: [] });
    expect(await store.dismiss!(owner.toUpperCase(), [id])).toEqual({ dismissedJobIds: [id], runningJobIds: [] });
    const restored = createBackgroundJobStore(pool);
    expect(await restored.listDismissed!(owner)).toEqual([id]);
    expect(await restored.listDismissed!(other)).toEqual([]);
    expect(await restored.get(id)).toEqual(before);
    expect(await restored.list()).toHaveLength(4);
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM dbo.background_job_dismissals')).recordset[0]?.count).toBe(1);
  });

  it('scopes independent dismissals by owner while preserving failure/restart status and saved results', async () => {
    const failed = jobs[2]!.jobId;
    const done = jobs[1]!.jobId;
    await store.dismiss!(owner, [failed]);
    await store.dismiss!(other, [done]);
    expect(await store.listDismissed!(owner)).toEqual([failed]);
    expect(await store.listDismissed!(other)).toEqual([done]);
    expect((await store.get(failed))?.details).toMatchObject({
      job: { status: 'failed', detail: 'interrupted by restart' }, error: 'interrupted by restart',
    });
    expect((await store.get(done))?.details.resultWindow).toBe('synthetic-result');
  });

  it('refuses direct running dismissals but skips running legacy import IDs', async () => {
    const running = jobs[0]!.jobId;
    expect(await store.dismiss!(owner, [jobs[1]!.jobId, running])).toEqual({
      dismissedJobIds: [], runningJobIds: [running],
    });
    expect(await store.listDismissed!(owner)).toEqual([]);
    expect((await store.get(running))?.details.job.status).toBe('running');
    expect(await store.dismiss!(owner, [jobs[1]!.jobId, running], true)).toEqual({
      dismissedJobIds: [jobs[1]!.jobId], runningJobIds: [running],
    });
    expect(await store.listDismissed!(owner)).toEqual([jobs[1]!.jobId]);
  });

  it('clear-finished dismisses done, failed and cancelled jobs but neither running work nor raw records', async () => {
    const expected = jobs.slice(1).map((job) => job.jobId).sort();
    expect((await store.dismiss!(owner)).dismissedJobIds.sort()).toEqual(expected);
    expect((await store.dismiss!(owner)).dismissedJobIds.sort()).toEqual(expected);
    expect((await store.listDismissed!(owner)).sort()).toEqual(expected);
    expect(await store.get(jobs[0]!.jobId)).toMatchObject({ details: { job: { status: 'running' } } });
    expect(await store.list()).toHaveLength(4);
  });

  it('ignores absent and expired imports while confirming known terminal IDs including existing dismissals', async () => {
    const expired = { ...jobs[1]!, jobId: randomUUID(), startedAt: new Date(Date.now() - 31 * 86_400_000).toISOString() };
    await store.create(expired);
    const known = jobs[2]!.jobId;
    await store.dismiss!(owner, [known]);
    expect(await store.dismiss!(owner, [known, expired.jobId, randomUUID()])).toEqual({
      dismissedJobIds: [known], runningJobIds: [],
    });
    expect(await store.dismiss!(owner, [])).toEqual({ dismissedJobIds: [], runningJobIds: [] });
  });

  it('keeps concurrent duplicate requests idempotent with one durable dismissal', async () => {
    const id = jobs[3]!.jobId;
    const expected = { dismissedJobIds: [id], runningJobIds: [] };
    expect(await Promise.all([store.dismiss!(owner, [id]), store.dismiss!(owner, [id])])).toEqual([expected, expected]);
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM dbo.background_job_dismissals')).recordset[0]?.count).toBe(1);
  });

  it('dismisses all high-volume terminal work while bounding reads and acknowledgements without resurrecting hidden rows', async () => {
    const ids = Array.from({ length: 1_005 }, () => randomUUID());
    await pool.request().input('ids', sql.NVarChar(sql.MAX), JSON.stringify(ids)).query(`INSERT dbo.background_jobs
      (job_id, kind, title, status, step, steps, started_at, updated_at)
      SELECT [value], N'research', N'Synthetic volume', N'done', 1, 1, SYSUTCDATETIME(), SYSUTCDATETIME()
      FROM OPENJSON(@ids);`);
    const visible = await store.listVisible!(owner);
    expect(visible).toHaveLength(1_000);
    expect(visible[0]).toEqual(jobs[0]);
    expect((await store.dismiss!(owner)).dismissedJobIds).toHaveLength(1_000);
    expect(await store.listDismissed!(owner)).toHaveLength(1_000);
    expect(await store.listVisible!(owner)).toEqual([jobs[0]]);
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM dbo.background_job_dismissals')).recordset[0]?.count).toBe(1_008);
    expect(await store.list()).toHaveLength(1_009);
  });

  it('cascades retention pruning to dismissal rows without inventing confirmations for expired work', async () => {
    const id = jobs[1]!.jobId;
    await store.dismiss!(owner, [id]);
    await pool.request().input('id', sql.NVarChar(36), id)
      .query('UPDATE dbo.background_jobs SET started_at = DATEADD(day, -31, SYSUTCDATETIME()) WHERE job_id = @id;');
    expect(await store.listDismissed!(owner)).toEqual([]);
    expect(await store.dismiss!(owner, [id])).toEqual({ dismissedJobIds: [], runningJobIds: [] });
    await store.prune();
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM dbo.background_job_dismissals')).recordset[0]?.count).toBe(0);
    expect(await store.get(id)).toBeNull();
  });

  it('enforces the owner/job primary key and foreign key in SQL', async () => {
    const id = jobs[1]!.jobId;
    await store.dismiss!(owner, [id]);
    await expect(pool.request().input('owner', sql.UniqueIdentifier, owner).input('id', sql.NVarChar(36), id)
      .query('INSERT dbo.background_job_dismissals (owner_object_id, job_id) VALUES (@owner, @id);')).rejects.toThrow();
    await expect(pool.request().input('owner', sql.UniqueIdentifier, owner).input('id', sql.NVarChar(36), randomUUID())
      .query('INSERT dbo.background_job_dismissals (owner_object_id, job_id) VALUES (@owner, @id);')).rejects.toThrow();
    expect(await store.dismiss!(other, [id])).toEqual({ dismissedJobIds: [id], runningJobIds: [] });
  });

  it('refuses rollback while durable dismissals exist without losing preferences, raw history or migration state', async () => {
    const id = jobs[1]!.jobId;
    await store.dismiss!(owner, [id]);
    const before = await store.get(id);
    await revertMigration(pool, migrations, await readDownMigration(workspaceMigration));
    await revertMigration(pool, migrations, await readDownMigration(recoveryMigration));
    await expect(revertMigration(pool, migrations, await readDownMigration(migrationName)))
      .rejects.toThrow('dismissal preferences must be retained');
    expect((await pool.request().query('SELECT TOP (1) name FROM dbo.schema_migrations ORDER BY name DESC')).recordset[0]?.name).toBe(migrationName);
    expect(await applyMigrations(pool, migrations)).toEqual([recoveryMigration, workspaceMigration]);
    expect(await store.listDismissed!(owner)).toEqual([id]);
    expect(await store.get(id)).toEqual(before);
  });

  it('reverts and reapplies empty visibility state, retaining raw jobs and bounded step history', async () => {
    const id = jobs[1]!.jobId;
    const before = await store.get(id);
    expect(await revertMigration(pool, migrations, await readDownMigration(workspaceMigration))).toBe(workspaceMigration);
    expect(await revertMigration(pool, migrations, await readDownMigration(recoveryMigration))).toBe(recoveryMigration);
    expect(await revertMigration(pool, migrations, await readDownMigration(migrationName))).toBe(migrationName);
    expect((await pool.request().query("SELECT OBJECT_ID(N'dbo.background_job_dismissals') AS id")).recordset[0]?.id).toBeNull();
    expect((await pool.request().input('id', sql.NVarChar(36), id)
      .query<{ status: string }>('SELECT status FROM dbo.background_jobs WHERE job_id = @id')).recordset[0]?.status).toBe(before?.details.job.status);
    expect(await applyMigrations(pool, migrations)).toEqual([migrationName, recoveryMigration, workspaceMigration]);
    expect(await store.get(id)).toEqual(before);
    expect(await store.list()).toHaveLength(4);
    expect(await store.listDismissed!(owner)).toEqual([]);
  });
});
