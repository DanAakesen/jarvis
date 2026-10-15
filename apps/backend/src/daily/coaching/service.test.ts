import { beforeEach, describe, expect, it, vi } from 'vitest';
import sql from 'mssql';
import type { FastifyRequest } from 'fastify';
import { DailyCoachingService } from './service.js';
import { defaultTargets } from './model.js';

const db = vi.hoisted(() => ({ query: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), cancel: vi.fn(),
  ownerRead: vi.fn(), healthHistory: vi.fn(), healthSync: vi.fn(), meals: vi.fn(), inputs: [] as unknown[][] }));
vi.mock('mssql', async original => {
  const module = await original<typeof import('mssql')>();
  class Request {
    input(...values: unknown[]) { db.inputs.push(values); return this; }
    query(query: string) { return db.query(query); }
    cancel() { db.cancel(); }
  }
  class Transaction { begin() { return db.begin(); } commit() { return db.commit(); } rollback() { return db.rollback(); } }
  return { ...module, default: { ...module.default, Request, Transaction } };
});
vi.mock('../store/owner-store.js', () => ({ DailyOwnerStore: { forRequest: () => ({ read: db.ownerRead }) } }));
vi.mock('../health/read-model.js', () => ({ DailyHealthReadModel: { forRequest: () => ({ history: db.healthHistory, sync: db.healthSync }) } }));
vi.mock('../nutrition/store.js', () => ({ NutritionStore: { forRequest: () => ({ history: db.meals }) } }));
const owner = '11111111-1111-4111-8111-111111111111';
const request = { server: { ownerObjectId: owner }, principal: { objectId: owner } } as unknown as FastifyRequest;
const service = () => DailyCoachingService.forRequest({} as sql.ConnectionPool, request);
const signal = () => new AbortController().signal;
const now = '2026-10-15T12:00:00Z';
const experiment = { id: 'synthetic', metric: 'protein', instruction: 'Retain the agreed target.', targetValue: 180, targetDays: 7,
  unit: 'g', startsOn: '2026-10-15', endsOn: '2026-10-21', lockedVariables: ['steps'], baselineValue: null, baselineDays: null, rationale: null };
const input = { experiment, operationKey: 'synthetic-operation', reviewStartDate: '2026-10-08', reviewEndDate: '2026-10-14' };
const commit = { intent: 'commit-experiment' as const, explicit: true };
beforeEach(() => {
  vi.clearAllMocks(); db.inputs.length = 0;
  db.begin.mockResolvedValue(undefined); db.commit.mockResolvedValue(undefined); db.rollback.mockResolvedValue(undefined);
  db.query.mockReset().mockResolvedValue({ recordset: [] });
  db.ownerRead.mockReset().mockResolvedValue(null); db.healthHistory.mockReset().mockResolvedValue({ items: [], next: null });
  db.healthSync.mockReset().mockResolvedValue({ inbox: { pending: 0, quarantined: 0 }, feeds: [], heartbeat: null });
  db.meals.mockReset().mockResolvedValue({ rows: [], next: null });
});
describe('inactive owner-bound coaching orchestration', () => {
  it('denies foreign owners, coding runners and anonymous callers before SQL', () => {
    for (const patch of [{ principal: { objectId: 'another' } }, { runnerPrincipal: { kind: 'jarvis-runner' } }, { principal: undefined }]) {
      expect(() => DailyCoachingService.forRequest({} as sql.ConnectionPool, { ...request, ...patch } as unknown as FastifyRequest)).toThrow();
    }
    expect(db.begin).not.toHaveBeenCalled();
  });
  it('uses bounded existing owner stores and exposes missing contracts instead of inventing zero intake or TDEE', async () => {
    const result = await service().read(now, signal());
    expect(result.status.energy).toMatchObject({ maintenanceKcal: null, deficitTargetKcal: null, loggedIntakeKcal: null });
    expect(result.evidence.coverage).toBe('partial'); expect(result.evidence.limitations).toContain('maintenance contract unavailable');
    expect(db.healthHistory.mock.calls.every(([, range]) => range.startDate === '2026-10-02' && range.endDate === '2026-10-15')).toBe(true);
    expect(db.ownerRead).toHaveBeenCalledTimes(16);
  });
  it('pages health and intake, excludes tombstones and never promotes logged meals to complete-day evidence', async () => {
    db.meals.mockResolvedValueOnce({ rows: [{ meal_date: '2026-10-15', energy_kcal: 100, protein_grams: 10, deleted_at: null }], next: { createdAt: now, id: 'one' } })
      .mockResolvedValueOnce({ rows: [{ meal_date: '2026-10-15', energy_kcal: 999, protein_grams: 999, deleted_at: now }], next: null });
    const result = await service().read(now, signal());
    expect(result.status.energy.loggedIntakeKcal).toBe(100); expect(result.status.protein.consumedGrams).toBe(10);
    expect(result.status.energy.intakeCoverage).toBe('partial'); expect(result.review.consistency.deficit.missed).toBe(0);
    expect(db.meals).toHaveBeenCalledTimes(2);
  });
  it('does not guess missing physical units or choose between conflicting same-day aliases', async () => {
    const metric = { metric_date: '2026-10-15', metric_name: 'weight', value: 90, unit: null, ingestion_id: 'synthetic' };
    db.healthHistory.mockImplementation(async kind => ({ items: kind === 'metrics' ? [metric] : [], next: null }));
    expect((await service().read(now, signal())).targets.proteinGrams).toBeNull();
    db.healthHistory.mockImplementation(async kind => ({ items: kind === 'metrics' ? [
      { ...metric, unit: 'kg' }, { ...metric, metric_name: 'body_mass', value: 91, unit: 'kg' },
    ] : [], next: null }));
    await expect(service().read(now, signal())).rejects.toThrow('Conflicting');
  });
  it('does not give step orders or a current weight target while committed SQL reports pending health work', async () => {
    db.healthHistory.mockImplementation(async kind => ({ items: kind === 'metrics' ? [
      { metric_date: '2026-10-15', metric_name: 'weight', value: 90, unit: 'kg', ingestion_id: 'synthetic' },
      { metric_date: '2026-10-15', metric_name: 'step_count', value: 100, unit: 'count', ingestion_id: 'synthetic' },
    ] : [], next: null }));
    db.healthSync.mockResolvedValue({ inbox: { pending: 1, quarantined: 0 }, feeds: [], heartbeat: { last_received_at: now } });
    const result = await service().read(now, signal());
    expect(result.status.orders).toEqual([]); expect(result.targets.proteinGrams).toBeNull();
    expect(result.evidence.limitations).toContain('pending or quarantined health uploads; prior observations are stale');
  });
  it('carries the recorded waist metric through dated 14-day trends without dropping it or converting metres twice', async () => {
    db.healthHistory.mockImplementation(async kind => ({ items: kind === 'metrics' ? [
      { metric_date: '2026-10-02', metric_name: 'waist_circumference', value: 0.90, unit: 'm', ingestion_id: 'waist-first' },
      { metric_date: '2026-10-15', metric_name: 'waist_circumference', value: 0.88, unit: 'm', ingestion_id: 'waist-last' },
      { metric_date: '2026-10-15', metric_name: 'lean_body_mass', value: 65, unit: 'kg', ingestion_id: 'lean-source' },
    ] : [], next: null }));
    const result = await service().read(now, signal());
    expect(result.recomp.waistMetres).toEqual({ observedDays: 2, average: 0.89, change: -0.02, firstDate: '2026-10-02', lastDate: '2026-10-15' });
    expect(result.recomp.units.waistMetres).toBe('m');
    expect(result.recomp.points[0]).toMatchObject({ date: '2026-10-02', waistMetres: 0.9, sources: { waist: ['waist-first'] } });
    expect(result.recomp.points.at(-1)).toMatchObject({ date: '2026-10-15', waistMetres: 0.88, leanMassKg: 65, sources: { waist: ['waist-last'] } });
    expect(result.recomp.fatMassKg).toMatchObject({ average: null, derived: true });
  });
  it.each(['pending', 'quarantined'])('excludes stale waist while %s health work remains despite a heartbeat', async kind => {
    db.healthHistory.mockImplementation(async history => ({ items: history === 'metrics' ? [
      { metric_date: '2026-10-15', metric_name: 'waist_circumference', value: 0.88, unit: 'm', ingestion_id: 'waist-source' },
    ] : [], next: null }));
    db.healthSync.mockResolvedValue({ inbox: { pending: 0, quarantined: 0, [kind]: 1 }, feeds: [], heartbeat: { last_received_at: now } });
    const result = await service().read(now, signal());
    expect(result.recomp.waistMetres).toMatchObject({ observedDays: 0, average: null, change: null });
    expect(result.recomp.points.at(-1)).toMatchObject({ waistMetres: null, sources: { waist: ['waist-source'] } });
  });
  it('keeps actual recovery-day waist points while excluding them from the trend', async () => {
    db.healthHistory.mockImplementation(async kind => ({ items: kind === 'metrics' ? [
      { metric_date: '2026-10-02', metric_name: 'waist_circumference', value: 0.90, unit: 'm', ingestion_id: 'waist-first' },
      { metric_date: '2026-10-15', metric_name: 'waist_circumference', value: 0.88, unit: 'm', ingestion_id: 'waist-last' },
    ] : [], next: null }));
    db.ownerRead.mockImplementation(async (table, key) => table === 'recovery_days' && key.recovery_date === '2026-10-15' ? {} : null);
    const result = await service().read(now, signal());
    expect(result.recomp.points.at(-1)).toMatchObject({ recovery: true, waistMetres: 0.88 });
    expect(result.recomp.waistMetres).toMatchObject({ observedDays: 1, average: 0.9, change: null });
  });
  it('fails visibly on incomplete pagination instead of returning a truncated success', async () => {
    db.meals.mockResolvedValue({ rows: [], next: { createdAt: now, id: 'repeated' } });
    await expect(service().read(now, signal())).rejects.toThrow('bounded read');
    expect(db.meals).toHaveBeenCalledTimes(100);
  });
  it('requires trusted matching explicit intent and validates before opening write transactions', async () => {
    await expect(service().commitExperiment(input, { ...commit, explicit: false }, now, signal())).rejects.toThrow('intent');
    await expect(service().recordReadiness({ date: '2026-10-15', rating: 1.5 }, { intent: 'record-readiness', explicit: true }, now, signal())).rejects.toThrow();
    await expect(service().commitExperiment({ ...input, experiment: { ...experiment, targetDays: 8 } }, commit, now, signal())).rejects.toThrow();
    expect(db.begin).not.toHaveBeenCalled();
  });
  it('commits one experiment only after owner-locked SQL commit and binds retained baseline/locked variables', async () => {
    const result = await service().commitExperiment(input, commit, now, signal());
    expect(result).toMatchObject({ experiment, status: 'active', duplicate: false }); expect(db.commit).toHaveBeenCalledOnce();
    expect(db.inputs.some(([name, , value]) => name === 'owner' && value === owner)).toBe(true);
    expect(db.inputs.some(([name, , value]) => name === 'variables' && value === '["steps"]')).toBe(true);
    expect(db.inputs.some(([name, , value]) => name === 'baselineValue' && value === null)).toBe(true);
  });
  it('refuses a second active experiment without inserting or committing', async () => {
    db.query.mockImplementation(async query => ({ recordset: query.includes("status=N'active'") ? [{ id: 'existing' }] : [] }));
    await expect(service().commitExperiment(input, commit, now, signal())).rejects.toThrow();
    expect(db.query.mock.calls.some(([query]) => String(query).startsWith('INSERT'))).toBe(false);
    expect(db.commit).not.toHaveBeenCalled(); expect(db.rollback).toHaveBeenCalledOnce();
  });
  it('replays the retained operation independently of object-property order, and rejects changed payloads', async () => {
    const row = { id: experiment.id, metric: experiment.metric, instruction: experiment.instruction, target_value: 180, target_days: '7', unit: 'g',
      starts_on: '2026-10-15', ends_on: '2026-10-21', locked_variables_json: '["steps"]', baseline_value: null, baseline_days: null, rationale: null,
      review_start_date: input.reviewStartDate, review_end_date: input.reviewEndDate, status: 'active', idempotency_key: input.operationKey };
    db.query.mockImplementation(async query => ({ recordset: query.includes('idempotency_key=@operation') ? [row] : [] }));
    const { metric, ...rest } = experiment;
    expect((await service().commitExperiment({ ...input, experiment: { ...rest, metric } }, commit, now, signal())).duplicate).toBe(true);
    expect((await service().commitExperiment(input, commit, '2026-10-16T12:00:00Z', signal())).duplicate).toBe(true);
    await expect(service().commitExperiment({ ...input, experiment: { ...experiment, targetValue: 181 } }, commit, now, signal())).rejects.toThrow();
  });
  it('sanitizes uncertain SQL commit failure and never claims success or silently retries', async () => {
    db.commit.mockRejectedValueOnce(new Error('synthetic-sensitive-SQL-diagnostic'));
    const error = await service().commitExperiment(input, commit, now, signal()).catch((value: Error) => value);
    expect(String(error)).not.toContain('synthetic-sensitive'); expect(String(error)).toContain('unavailable');
    expect(db.begin).toHaveBeenCalledOnce(); expect(db.rollback).toHaveBeenCalledOnce();
  });
  it('updates only policy fields using profile revision CAS, never recreating or overwriting the full profile', async () => {
    db.query.mockImplementation(async query => ({ recordset: query.includes('OUTPUT INSERTED.revision') ? [{ revision: '2' }] : [] }));
    await expect(service().updateTargets({ ...defaultTargets, deficitRate: 0.2, coachingIntensity: 'direct', profanityPreference: 'natural' },
      1n, { intent: 'update-targets', explicit: true }, now, signal())).resolves.toMatchObject({ revision: '2' });
    expect(db.query.mock.calls.some(([query]) => String(query).includes('display_name='))).toBe(false);
  });
  it('patches readiness context without inventing or re-asking an existing rating', async () => {
    db.query.mockImplementation(async query => ({ recordset: query.includes('SELECT feeling_rating') ? [{ feeling_rating: '3' }] : [] }));
    await service().recordReadiness({ date: '2026-10-15', context: 'Synthetic.' }, { intent: 'record-readiness', explicit: true }, now, signal());
    expect(db.inputs.some(([name, , value]) => name === 'rating' && value === null)).toBe(true);
    expect(db.query.mock.calls.some(([query]) => String(query).includes('COALESCE(@rating,feeling_rating)'))).toBe(true);
    expect(db.commit).toHaveBeenCalledOnce();
  });
  it('records recovery only in its mapped table without deleting health measurements or intake', async () => {
    await service().recordRecovery('2026-10-14', 'Synthetic.', { intent: 'record-recovery', explicit: true }, now, signal());
    expect(db.query.mock.calls.some(([query]) => String(query).includes('INSERT daily.recovery_days'))).toBe(true);
    expect(db.query.mock.calls.some(([query]) => /DELETE|health_daily_metrics|nutrition_meals/u.test(String(query)))).toBe(false);
  });
  it('settles the existing experiment idempotently before another can be committed', async () => {
    db.query.mockImplementation(async query => ({ recordset: query.includes('SELECT status') ? [{ status: 'completed' }] : [] }));
    expect(await service().reviewExperiment('synthetic', 'completed', { intent: 'review-experiment', explicit: true }, now, signal())).toEqual({ id: 'synthetic', status: 'completed', duplicate: true });
  });
  it('honours cancellation before SQL and never claims a committed change', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(service().commitExperiment(input, commit, now, controller.signal)).rejects.toThrow();
    expect(db.begin).not.toHaveBeenCalled(); expect(db.commit).not.toHaveBeenCalled();
  });
});
