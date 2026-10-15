import type { FastifyRequest } from 'fastify';
import sql from 'mssql';
import { ToolFailure, ToolRefusal } from '../../core/tool-registry.js';
import { DailyHealthReadModel } from '../health/read-model.js';
import { dateOnly, day, instant, key } from '../health/value.js';
import { HealthConflict, ownerId } from '../health-upload/contracts.js';
import { healthSqlQuery, healthSqlTransaction } from '../health-upload/sql-transaction.js';
import { canonicalJson } from '../nutrition/model.js';
import { NutritionStore } from '../nutrition/store.js';
import { resolveDailyOwner } from '../owner.js';
import { DailyOwnerStore } from '../store/owner-store.js';
import { calculateCoaching, calendarDate, missingReading, validateExperiment, validateProfile, type CoachingDay, type CoachingProfile, type Experiment, type Readiness } from './model.js';
import { readProfile as profile, readExperiment as experiment, readMetric as metric, readMealTotal as mealTotal,
  storedDate as date, storedNumber as finite, storedText as text, type CoachingRow as Row } from './evidence.js';

export interface CoachingAuthority {
  intent: 'update-targets' | 'record-readiness' | 'record-recovery' | 'commit-experiment' | 'review-experiment';
  explicit: boolean;
}
function authorize(authority: CoachingAuthority, intent: CoachingAuthority['intent']): void {
  if (authority.intent !== intent || authority.explicit !== true) throw new ToolRefusal('Explicit matching user intent is required for this coaching change.');
}
export interface ExperimentCommit {
  experiment: Experiment;
  operationKey: string;
  reviewStartDate: string;
  reviewEndDate: string;
}
/** Inactive shared owner service. No routes, tools, timers, provider calls or new persistence. */
export class DailyCoachingService {
  private constructor(
    private readonly pool: sql.ConnectionPool, private readonly request: FastifyRequest, private readonly owner: string,
  ) {}
  static forRequest(pool: sql.ConnectionPool, request: FastifyRequest) {
    return new DailyCoachingService(pool, request, ownerId(resolveDailyOwner(request)));
  }
  async read(asOf: string, signal: AbortSignal) {
    const today = day(instant(asOf)); const start = calendarDate(today, -13);
    signal = AbortSignal.any([signal, AbortSignal.timeout(45000)]); signal.throwIfAborted();
    const ownerStore = DailyOwnerStore.forRequest(this.pool, this.request);
    const health = DailyHealthReadModel.forRequest(this.pool, this.request);
    const nutrition = NutritionStore.forRequest(this.pool, this.request, () => asOf);
    const history = async (kind: 'metrics' | 'sleep' | 'workouts') => {
      const rows: Row[] = []; let after: { date: string; key: string } | undefined;
      for (let page = 0; page < 20; page++) {
        const result = await health.history(kind, { startDate: start, endDate: today, limit: 500, ...(after ? { after } : {}) }, signal);
        rows.push(...result.items);
        if (!result.next) return rows;
        after = result.next;
      }
      throw new ToolFailure('Coaching history exceeds the bounded read. No complete summary is claimed.');
    };
    const meals = async () => {
      const rows: Row[] = []; let after: { createdAt: string; id: string } | undefined;
      for (let page = 0; page < 100; page++) {
        const result = await nutrition.history({ from: start, to: today, limit: 100, ...(after ? { after } : {}) }, signal);
        rows.push(...result.rows);
        if (!result.next) return rows;
        after = result.next;
      }
      throw new ToolFailure('Coaching intake exceeds the bounded read. No complete summary is claimed.');
    };
    const [storedProfile, storedReadiness, metrics, sleep, workouts, intake, recovery, active, healthSync] = await Promise.all([
      ownerStore.read('coach_profiles', {}, signal),
      ownerStore.read('readiness_checkins', { checkin_date: today }, signal),
      history('metrics'), history('sleep'), history('workouts'), meals(),
      Promise.all(Array.from({ length: 14 }, (_, index) => ownerStore.read('recovery_days', { recovery_date: calendarDate(today, index - 13) }, signal))),
      healthSqlTransaction(this.pool, this.owner, signal, async (tx, bounded) => (await healthSqlQuery(
        new sql.Request(tx).input('owner', sql.UniqueIdentifier, this.owner),
        "SELECT TOP(2) id,metric,instruction,target_value,target_days,unit,starts_on,ends_on,locked_variables_json,baseline_value,baseline_days,rationale FROM daily.coach_experiments WHERE owner_object_id=@owner AND status=N'active' ORDER BY starts_on,id;", bounded)).recordset),
      health.sync(signal),
    ]);
    if (active.length > 1) throw new ToolRefusal('More than one active experiment requires reconciliation.');
    if (!healthSync.inbox || !Number.isSafeInteger(finite(healthSync.inbox.pending)) || !Number.isSafeInteger(finite(healthSync.inbox.quarantined)) ||
        finite(healthSync.inbox.pending) < 0 || finite(healthSync.inbox.quarantined) < 0) throw new ToolFailure('Health processing evidence is unavailable.');
    const unsettled = finite(healthSync.inbox.pending) > 0 || finite(healthSync.inbox.quarantined) > 0;
    const days: CoachingDay[] = Array.from({ length: 14 }, (_, index) => {
      const current = calendarDate(today, index - 13); const night = sleep.find(row => date(row.sleep_date) === current);
      const sleepValue = night?.total_sleep_hours === null || !night ? null : finite(night.total_sleep_hours);
      return { date: current, recovery: recovery[index] !== null,
        steps: metric(metrics, current, ['step_count'], 'count'),
        sleepHours: { value: sleepValue, coverage: sleepValue === null ? 'missing' : 'partial', sources: night ? [text(night.ingestion_id, 256)] : [] },
        restingKcal: metric(metrics, current, ['basal_energy', 'basal_energy_burned', 'resting_energy', 'resting_energy_burned'], 'kcal'),
        activeKcal: metric(metrics, current, ['active_energy', 'active_energy_burned'], 'kcal'),
        // SQL rows prove recorded observations, not complete nutrition or an authoritative TDEE formula.
        maintenanceKcal: missingReading(), intakeKcal: mealTotal(intake, current, 'energy_kcal'), proteinGrams: mealTotal(intake, current, 'protein_grams'),
        weightKg: metric(metrics, current, ['body_mass', 'body_weight', 'weight'], 'kg'),
        waistMetres: metric(metrics, current, ['waist_circumference'], 'm'),
        fatPercentage: metric(metrics, current, ['body_fat_percentage'], '%'), leanMassKg: metric(metrics, current, ['lean_body_mass'], 'kg'),
        workoutIds: workouts.filter(row => date(row.workout_date) === current).map(row => key(row.id)),
      };
    });
    if (unsettled) for (const evidence of days) {
      for (const field of ['steps', 'sleepHours', 'restingKcal', 'activeKcal', 'weightKg', 'waistMetres', 'fatPercentage', 'leanMassKg'] as const) {
        if (evidence[field].value !== null) evidence[field] = { ...evidence[field], coverage: 'stale' };
      }
    }
    const readiness: Readiness | null = storedReadiness ? { date: today, rating: finite(storedReadiness.feeling_rating),
      context: storedReadiness.context_text === null ? null : text(storedReadiness.context_text) } : null;
    return { ...calculateCoaching({ asOf, profile: profile(storedProfile), days, readiness, activeExperiments: active.map(experiment) }),
      evidence: { healthSync, coverage: 'partial' as const, capture: 'independent owner reads' as const,
        limitations: ['maintenance contract unavailable', 'nutrition day completeness unverified', 'freshness expiry policy unverified',
          ...(unsettled ? ['pending or quarantined health uploads; prior observations are stale'] : [])] } };
  }

  async updateTargets(targets: CoachingProfile, expectedRevision: bigint, authority: CoachingAuthority, asOf: string, signal: AbortSignal) {
    authorize(authority, 'update-targets'); validateProfile(targets);
    const now = instant(asOf);
    if (typeof expectedRevision !== 'bigint' || expectedRevision < 1n || expectedRevision >= 9223372036854775807n) throw new TypeError('Invalid profile revision');
    const accepted = structuredClone(targets);
    return healthSqlTransaction(this.pool, this.owner, signal, async (tx, bounded) => {
      const result = await healthSqlQuery(new sql.Request(tx).input('owner', sql.UniqueIdentifier, this.owner).input('revision', sql.BigInt, expectedRevision)
        .input('deficit', sql.Float, accepted.deficitRate).input('minimum', sql.Float, accepted.proteinMinimumGrams)
        .input('perKg', sql.Float, accepted.proteinPerKg).input('steps', sql.BigInt, accepted.stepsTarget).input('sleep', sql.Float, accepted.sleepTargetHours)
        .input('intensity', sql.NVarChar(256), accepted.coachingIntensity).input('profanity', sql.NVarChar(256), accepted.profanityPreference)
        .input('now', sql.NVarChar(64), now),
      `UPDATE daily.coach_profiles SET deficit_rate=@deficit,protein_minimum_grams=@minimum,protein_per_kg=@perKg,
       steps_target=@steps,sleep_target_hours=@sleep,coaching_intensity=@intensity,profanity_preference=@profanity,revision=revision+1,updated_at=@now
       OUTPUT INSERTED.revision WHERE owner_object_id=@owner AND revision=@revision;`, bounded);
      if (!result.recordset.length) throw new HealthConflict();
      return { targets: accepted, revision: String(result.recordset[0]!.revision) };
    });
  }
  async recordReadiness(update: { date: string; rating?: number; context?: string | null }, authority: CoachingAuthority, asOf: string, signal: AbortSignal) {
    authorize(authority, 'record-readiness');
    const now = instant(asOf); const current = dateOnly(update.date); const rating = update.rating ?? null;
    const context = update.context ?? null; const hasContext = Object.hasOwn(update, 'context');
    if (Object.keys(update).some(field => !['date', 'rating', 'context'].includes(field)) ||
        Object.hasOwn(update, 'rating') && typeof update.rating !== 'number' || hasContext && update.context === undefined ||
        current > day(now) || current < calendarDate(day(now), -365) || rating === null && !hasContext ||
        rating !== null && !Number.isSafeInteger(rating) || context !== null && (typeof context !== 'string' || context.length > 4096)) throw new TypeError('Invalid readiness change');
    return healthSqlTransaction(this.pool, this.owner, signal, async (tx, bounded) => {
      const query = () => new sql.Request(tx).input('owner', sql.UniqueIdentifier, this.owner).input('date', sql.Date, new Date(current));
      const existing = (await healthSqlQuery(query(), 'SELECT feeling_rating FROM daily.readiness_checkins WITH(UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner AND checkin_date=@date;', bounded)).recordset[0];
      if (!existing && rating === null) throw new HealthConflict();
      await healthSqlQuery(query().input('rating', sql.BigInt, rating).input('context', sql.NVarChar(sql.MAX), context)
        .input('hasContext', sql.Bit, hasContext).input('now', sql.NVarChar(64), now),
      `IF EXISTS(SELECT 1 FROM daily.readiness_checkins WHERE owner_object_id=@owner AND checkin_date=@date)
       UPDATE daily.readiness_checkins SET feeling_rating=COALESCE(@rating,feeling_rating),context_text=CASE WHEN @hasContext=1 THEN @context ELSE context_text END,captured_at=@now,updated_at=@now WHERE owner_object_id=@owner AND checkin_date=@date;
       ELSE INSERT daily.readiness_checkins(owner_object_id,checkin_date,feeling_rating,context_text,captured_at,created_at,updated_at) VALUES(@owner,@date,@rating,@context,@now,@now,@now);`, bounded);
      return { date: current };
    });
  }
  async recordRecovery(current: string, context: string | null, authority: CoachingAuthority, asOf: string, signal: AbortSignal) {
    authorize(authority, 'record-recovery'); dateOnly(current); const now = instant(asOf);
    if (current > day(now) || current < calendarDate(day(now), -365) || context !== null && (typeof context !== 'string' || context.length > 4096)) throw new TypeError('Invalid recovery change');
    return healthSqlTransaction(this.pool, this.owner, signal, async (tx, bounded) => {
      await healthSqlQuery(new sql.Request(tx).input('owner', sql.UniqueIdentifier, this.owner).input('date', sql.Date, new Date(current))
        .input('context', sql.NVarChar(sql.MAX), context).input('now', sql.NVarChar(64), now),
      `IF EXISTS(SELECT 1 FROM daily.recovery_days WITH(UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner AND recovery_date=@date)
       UPDATE daily.recovery_days SET context_text=@context,updated_at=@now WHERE owner_object_id=@owner AND recovery_date=@date;
       ELSE INSERT daily.recovery_days(owner_object_id,recovery_date,context_text,created_at,updated_at) VALUES(@owner,@date,@context,@now,@now);`, bounded);
      return { date: current, recovery: true };
    });
  }
  /** Authority comes from existing trusted user intent, never model/client arguments. */
  async commitExperiment(input: ExperimentCommit, authority: CoachingAuthority, asOf: string, signal: AbortSignal) {
    authorize(authority, 'commit-experiment');
    if (Object.keys(input).some(field => !['experiment', 'operationKey', 'reviewStartDate', 'reviewEndDate'].includes(field))) throw new TypeError('Invalid experiment operation fields');
    const now = instant(asOf); validateExperiment(input.experiment); key(input.experiment.id); key(input.operationKey);
    dateOnly(input.reviewStartDate); dateOnly(input.reviewEndDate);
    if (input.reviewEndDate < input.reviewStartDate || input.reviewEndDate >= input.experiment.startsOn) throw new TypeError('Invalid experiment review period');
    const accepted = structuredClone(input);
    return healthSqlTransaction(this.pool, this.owner, signal, async (tx, bounded) => {
      const query = () => new sql.Request(tx).input('owner', sql.UniqueIdentifier, this.owner);
      const prior = (await healthSqlQuery(query().input('operation', sql.NVarChar(256), accepted.operationKey),
        'SELECT id,metric,instruction,target_value,target_days,unit,starts_on,ends_on,locked_variables_json,baseline_value,baseline_days,rationale,review_start_date,review_end_date,status,idempotency_key FROM daily.coach_experiments WITH(UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner AND idempotency_key=@operation;', bounded)).recordset[0];
      if (prior) {
        if (prior.idempotency_key !== accepted.operationKey || canonicalJson(experiment(prior)) !== canonicalJson(accepted.experiment) ||
            date(prior.review_start_date) !== accepted.reviewStartDate || date(prior.review_end_date) !== accepted.reviewEndDate) {
          throw new HealthConflict();
        }
        return { experiment: experiment(prior), status: text(prior.status, 256), duplicate: true };
      }
      if (accepted.experiment.startsOn < day(now)) throw new TypeError('A new experiment cannot start in the past');
      const active = (await healthSqlQuery(query(), "SELECT TOP(1) id FROM daily.coach_experiments WITH(UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner AND status=N'active';", bounded)).recordset[0];
      if (active) throw new HealthConflict();
      const sameId = (await healthSqlQuery(query().input('id', sql.NVarChar(256), accepted.experiment.id),
        'SELECT TOP(1) id FROM daily.coach_experiments WITH(UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner AND id=@id;', bounded)).recordset[0];
      if (sameId) throw new HealthConflict();
      const e = accepted.experiment;
      await healthSqlQuery(query().input('id', sql.NVarChar(256), e.id).input('metric', sql.NVarChar(256), e.metric).input('instruction', sql.NVarChar(sql.MAX), e.instruction)
        .input('value', sql.Float, e.targetValue).input('days', sql.BigInt, e.targetDays).input('unit', sql.NVarChar(256), e.unit)
        .input('starts', sql.Date, new Date(e.startsOn)).input('ends', sql.Date, new Date(e.endsOn))
        .input('reviewStart', sql.Date, new Date(accepted.reviewStartDate)).input('reviewEnd', sql.Date, new Date(accepted.reviewEndDate))
        .input('baselineValue', sql.Float, e.baselineValue).input('baselineDays', sql.BigInt, e.baselineDays).input('rationale', sql.NVarChar(sql.MAX), e.rationale)
        .input('variables', sql.NVarChar(sql.MAX), JSON.stringify(e.lockedVariables)).input('operation', sql.NVarChar(256), accepted.operationKey).input('now', sql.NVarChar(64), now),
      `INSERT daily.coach_experiments(owner_object_id,id,metric,instruction,target_value,target_days,unit,starts_on,ends_on,status,review_start_date,review_end_date,locked_variables_json,baseline_value,baseline_days,rationale,idempotency_key,created_at,updated_at)
       VALUES(@owner,@id,@metric,@instruction,@value,@days,@unit,@starts,@ends,N'active',@reviewStart,@reviewEnd,@variables,@baselineValue,@baselineDays,@rationale,@operation,@now,@now);`, bounded);
      return { experiment: e, status: 'active', duplicate: false };
    });
  }
  async reviewExperiment(id: string, outcome: 'completed' | 'abandoned', authority: CoachingAuthority, asOf: string, signal: AbortSignal) {
    authorize(authority, 'review-experiment'); key(id); const now = instant(asOf);
    if (!['completed', 'abandoned'].includes(outcome)) throw new TypeError('Invalid experiment outcome');
    return healthSqlTransaction(this.pool, this.owner, signal, async (tx, bounded) => {
      const query = () => new sql.Request(tx).input('owner', sql.UniqueIdentifier, this.owner).input('id', sql.NVarChar(256), id);
      const existing = (await healthSqlQuery(query(), 'SELECT status FROM daily.coach_experiments WITH(UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner AND id=@id AND DATALENGTH(id)=DATALENGTH(@id);', bounded)).recordset[0];
      if (!existing || existing.status !== 'active' && existing.status !== outcome) throw new HealthConflict();
      if (existing.status === outcome) return { id, status: outcome, duplicate: true };
      await healthSqlQuery(query().input('outcome', sql.NVarChar(256), outcome).input('now', sql.NVarChar(64), now),
        "UPDATE daily.coach_experiments SET status=@outcome,updated_at=@now WHERE owner_object_id=@owner AND id=@id AND DATALENGTH(id)=DATALENGTH(@id) AND status=N'active';", bounded);
      return { id, status: outcome, duplicate: false };
    });
  }
}
