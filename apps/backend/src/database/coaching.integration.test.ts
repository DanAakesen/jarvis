import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readMigrations } from './migrations.js';
import { DailyCoachingService } from '../daily/coaching/service.js';
import { defaultTargets } from '../daily/coaching/model.js';

const config = loadDatabaseConfig();
if (!config || process.env.NODE_ENV !== 'test' || config.server !== '127.0.0.1') throw new Error('Coaching tests require isolated loopback SQL Server');
const database = `jarvis_coaching_ci_${randomUUID().replaceAll('-', '')}`;
const admin = new sql.ConnectionPool({ ...config, database: 'master' });
const pool = new sql.ConnectionPool({ ...config, database });
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const now = '2026-10-15T12:00:00Z';
const request = (id: string) => ({ server: { ownerObjectId: id }, principal: { objectId: id } }) as unknown as FastifyRequest;
const service = (id = owner) => DailyCoachingService.forRequest(pool, request(id));
const signal = () => new AbortController().signal;
const commit = { intent: 'commit-experiment' as const, explicit: true };
const experiment = { id: 'synthetic', metric: 'protein', instruction: 'Keep the agreed target.', targetValue: 180, targetDays: 7, unit: 'g',
  startsOn: '2026-10-15', endsOn: '2026-10-21', lockedVariables: ['steps', 'sleep'], baselineValue: 170, baselineDays: 4, rationale: 'Synthetic review.' };
const input = { experiment, operationKey: 'synthetic-operation', reviewStartDate: '2026-10-08', reviewEndDate: '2026-10-14' };
beforeAll(async () => {
  await admin.connect(); await admin.request().batch(`CREATE DATABASE [${database}];`); await pool.connect();
  await applyMigrations(pool, (await readMigrations()).filter(({ name }) => /^004[1-7]_daily/u.test(name)));
});
afterAll(async () => {
  await pool.close();
  if (admin.connected) await admin.request().batch(`IF DB_ID(N'${database}') IS NOT NULL BEGIN ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}]; END;`);
  await admin.close();
});
describe('inactive coaching services on isolated real SQL, synthetic data only', () => {
  it('serializes concurrent same-operation commitments, rejects changed bytes and isolates owners', async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => service().commitExperiment(input, commit, now, signal())));
    expect(results.filter(result => !result.duplicate)).toHaveLength(1);
    expect(results.every(result => result.experiment.baselineDays === 4)).toBe(true);
    await expect(service().commitExperiment({ ...input, experiment: { ...experiment, targetValue: 181 } }, commit, now, signal())).rejects.toThrow();
    await service(other).commitExperiment(input, commit, now, signal());
    const count = (await pool.request().query('SELECT COUNT(*) AS count FROM daily.coach_experiments')).recordset[0].count;
    expect(count).toBe(2);
  });
  it('requires an explicit reviewed terminal transition before the next one-experiment commitment', async () => {
    const next = { ...input, operationKey: 'next-operation', experiment: { ...experiment, id: 'next' } };
    await expect(service().commitExperiment(next, commit, now, signal())).rejects.toThrow();
    await expect(service().reviewExperiment('synthetic ', 'completed', { intent: 'review-experiment', explicit: true }, now, signal())).rejects.toThrow();
    await service().reviewExperiment('synthetic', 'completed', { intent: 'review-experiment', explicit: true }, now, signal());
    expect((await service().reviewExperiment('synthetic', 'completed', { intent: 'review-experiment', explicit: true }, now, signal())).duplicate).toBe(true);
    expect((await service().commitExperiment(input, commit, '2026-10-16T12:00:00Z', signal())).status).toBe('completed');
    await service().commitExperiment(next, commit, now, signal());
  });
  it('updates readiness one field at a time, preserving zero rating and owner-local context', async () => {
    const authority = { intent: 'record-readiness' as const, explicit: true };
    await service().recordReadiness({ date: '2026-10-15', rating: 0 }, authority, now, signal());
    await service().recordReadiness({ date: '2026-10-15', context: 'Synthetic context.' }, authority, now, signal());
    expect((await service().read(now, signal())).readiness).toEqual({ rating: 0, context: 'Synthetic context.', missing: [] });
    expect((await service(other).read(now, signal())).readiness.missing).toEqual(['rating', 'context']);
    await expect(service().recordReadiness({ date: '2026-10-14', context: 'No invented rating.' }, authority, now, signal())).rejects.toThrow();
  });
  it('retains recovery-day measurements but excludes the date from aggregates and never invents maintenance/completeness', async () => {
    await pool.request().input('owner', sql.UniqueIdentifier, owner).query(`INSERT daily.health_daily_metrics(owner_object_id,metric_name,metric_date,unit,value,sample_count,fields_json,ingestion_id,updated_at)
      VALUES(@owner,N'weight','2026-10-14',N'kg',90,1,N'{}',N'synthetic','2026-10-15T12:00:00.000Z');`);
    await service().recordRecovery('2026-10-14', 'Synthetic recovery.', { intent: 'record-recovery', explicit: true }, now, signal());
    const result = await service().read(now, signal());
    expect(result.recomp.points.find(point => point.date === '2026-10-14')).toMatchObject({ recovery: true, weightKg: 90 });
    expect(result.recomp.weightKg.observedDays).toBe(0); expect(result.review.consistency.steps.eligibleDays).toBe(6);
    expect(result.status.energy).toMatchObject({ maintenanceKcal: null, deficitTargetKcal: null, loggedIntakeKcal: null });
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM daily.health_daily_metrics')).recordset[0].count).toBe(1);
  });
  it('CAS-updates target policy without altering unrelated profile fields', async () => {
    await pool.request().input('owner', sql.UniqueIdentifier, owner).query(`INSERT daily.coach_profiles(owner_object_id,display_name,primary_goal,current_phase,date_of_birth,deficit_rate,protein_minimum_grams,protein_per_kg,
      sleep_target_hours,steps_target,gym_target_weekly,run_target_weekly,coaching_intensity,profanity_preference,created_at,updated_at)
      VALUES(@owner,N'Synthetic',N'Retain goal',N'phase','2000-01-01',0.2,180,2,7,8000,2,1,N'direct',N'natural',N'2026-10-15T12:00:00.000Z',N'2026-10-15T12:00:00.000Z');`);
    const targets = { ...defaultTargets, deficitRate: 0.15, coachingIntensity: 'direct', profanityPreference: 'natural' };
    await service().updateTargets(targets, 1n, { intent: 'update-targets', explicit: true }, now, signal());
    await expect(service().updateTargets(targets, 1n, { intent: 'update-targets', explicit: true }, now, signal())).rejects.toThrow();
    expect((await pool.request().query('SELECT primary_goal,revision,deficit_rate FROM daily.coach_profiles')).recordset[0]).toMatchObject({ primary_goal: 'Retain goal', revision: '2', deficit_rate: 0.15 });
  });
});
