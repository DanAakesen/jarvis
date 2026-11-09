import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readDownMigration, readMigrations, revertMigration } from './migrations.js';
import { createProactiveStore } from './proactive-store.js';
import { createProactiveAlertStore } from './proactive-alert-store.js';
import { createContextSources } from '../proactive/sources/context.js';
import { defaultProactiveSettings } from '../proactive/store.js';

const config = loadDatabaseConfig();
if (!config || process.env.NODE_ENV !== 'test' || config.server !== '127.0.0.1') throw new Error('Only isolated loopback SQL fixtures are allowed');
const database = `jarvis_proactive_context_${randomUUID().replaceAll('-', '')}`;
const admin = new sql.ConnectionPool({ ...config, database: 'master' });
const pool = new sql.ConnectionPool({ ...config, database });
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-11-09T10:00:00Z');
beforeAll(async () => {
  await admin.connect(); await admin.request().batch(`CREATE DATABASE [${database}];`);
  await pool.connect(); await applyMigrations(pool, await readMigrations());
});
afterAll(async () => {
  await pool.close();
  if (admin.connected) {
    await admin.request().batch(`IF DB_ID(N'${database}') IS NOT NULL BEGIN ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}]; END;`);
  }
  await admin.close();
});
describe('proactive context SQL boundaries', () => {
  it('persists the new source statuses and native insight receipts under the existing owner ledger', async () => {
    const store = createProactiveStore(pool, owner);
    await store.sources.upsert({ id: 'health', label: 'Health and training', enabled: true, state: 'ok', reason: null, observedAt: now.toISOString() });
    expect(await store.sources.list()).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'health' })]));
    const ledger = createProactiveAlertStore(pool, owner);
    await ledger.upsert({ alertKey: 'a'.repeat(32), class: 'insight', itemId: randomUUID(), runId: randomUUID(), dayKey: '2026-11-09', status: 'sent', reason: null });
    expect(await ledger.countSent('2026-11-09')).toBe(1);
    expect(await createProactiveAlertStore(pool, other).get('a'.repeat(32))).toBeUndefined();
    const migrations = await readMigrations();
    await expect(revertMigration(pool, migrations, await readDownMigration('0076_proactive_context.sql'))).rejects.toThrow();
    expect(await ledger.get('a'.repeat(32))).toMatchObject({ class: 'insight', status: 'sent' });
  });
  it('reads canonical health and nutrition with owner isolation and real saved goals', async () => {
    await pool.request().input('owner', sql.UniqueIdentifier, owner).input('other', sql.UniqueIdentifier, other).batch(`
      INSERT daily.training_targets(owner_object_id,gym_sessions_per_week,run_sessions_per_week,daily_steps,updated_at) VALUES(@owner,3,2,8000,SYSUTCDATETIME());
      INSERT daily.health_daily_metrics(owner_object_id,metric_name,metric_date,unit,value,ingestion_id,updated_at)
      VALUES(@owner,N'step_count','2026-11-09',N'count',6400,N'fixture','2026-11-09T09:00:00Z'),
            (@other,N'step_count','2026-11-09',N'count',99999,N'fixture','2026-11-09T09:00:00Z');`);
    const sources = createContextSources({ pool, ownerObjectId: owner, healthEnabled: true });
    const context = { now, settings: defaultProactiveSettings(), signal: new AbortController().signal };
    const health = await sources.find(source => source.id === 'health')!.read(context);
    expect(health.state).toBe('ok');
    const progress = JSON.parse(health.facts.find(fact => fact.identity === 'training:progress')!.text);
    expect(progress.steps).toEqual({ actual: 6400, target: 8000, percent: 80, remaining: 1600 });
    expect(progress.gym.actual).toBeNull();
    expect(JSON.stringify(health.facts)).not.toContain('99999');
    expect(await sources.find(source => source.id === 'nutrition')!.read(context)).toMatchObject({ state: 'ok' });
    const disabled = createContextSources({ pool, ownerObjectId: owner, healthEnabled: false });
    expect(await disabled.find(source => source.id === 'health')!.read(context)).toMatchObject({ state: 'unavailable' });
  });
});
