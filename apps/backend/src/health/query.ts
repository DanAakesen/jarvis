import { createHash } from 'node:crypto';
import {
  healthQuerySources as sources, isHealthQuery,
  type HealthCursor, type HealthJson, type HealthQuery, type HealthQueryResult,
} from '@jarvis/contracts';
import type { FastifyRequest } from 'fastify';
import type sql from 'mssql';
import { ToolFailure, ToolRefusal } from '../core/tool-registry.js';
import { AuthenticationDenied } from '../auth/verify.js';
import { resolveHealthBrowserOwner, resolveHealthOwner } from './owner.js';
import { HealthReadModel } from './health/read-model.js';
import { healthDefinitions } from './health/persistence.js';
import { SqlHealthProcessor } from './health/processor.js';
import { NutritionStore } from './nutrition/store.js';
import type { FridaLookup, FridaLookupAdapter, LookupComponent } from './nutrition/frida.js';
import { createHealthChanges, type HealthChanges } from './revisions.js';
import { healthJson as json, projectHealthRecord as project, projectNutritionRecord, healthResultByteLimit } from './records.js';
import { HealthBriefReadModel, briefDetailFields, briefMetadataFields } from './briefs/read-model.js';
import { SqlHealthCoachStore } from './coach-store.js';
import type { HealthCoachStore } from './coach-store.js';
import { TrainingTargetsStore } from './training/targets-store.js';
import type { TrainingTargetsAccess } from './training/targets-store.js';
import { presentTrainingTargets } from './training/targets.js';
import { LiftEntriesStore } from './lifts/lifts-store.js';
import type { LiftEntriesAccess } from './lifts/lifts-store.js';
import { WorkoutEntriesStore } from './gym/workouts-store.js';
import type { WorkoutEntriesAccess } from './gym/workouts-store.js';
import { SqlDeviceSyncStore, type DeviceSyncAccess } from './sync/device-sync-store.js';
import { createGymLogWriter } from './gym/gym-log.js';
import { createGymVaultSync, type GymSyncLogger } from './gym/gym-sync.js';
import type { createGitHubVaultClient } from '../vault/github-client.js';
import { name as healthName } from './health/value.js';
export { projectNutritionRecord, healthResultByteLimit } from './records.js';

export interface HealthReaders {
  health(request: FastifyRequest): Pick<HealthReadModel, 'history' | 'metricCatalog' | 'workoutDetail' | 'workoutMetrics' | 'heartRate' | 'sync'>;
  nutrition(request: FastifyRequest): Pick<NutritionStore, 'history' | 'days' | 'favorites' | 'plans'>;
  briefs(request: FastifyRequest): Pick<HealthBriefReadModel, 'history' | 'detail'>;
  trainingTargets?(request: FastifyRequest): Pick<TrainingTargetsStore, 'read'>;
  lifts?(request: FastifyRequest): Pick<LiftEntriesStore, 'history'>;
}
const feedFields = ['feed_kind', 'accepted_evidence_at', 'processed_committed_at', 'metric_rows', 'sleep_rows', 'workout_rows', 'heart_rate_minutes'];
const inboxFields = ['retained', 'retained_bytes', 'byte_limit', 'row_limit', 'pending', 'processing', 'quarantined', 'last_accepted_at', 'last_processed_upload_at'];
function latest(values: unknown[]): string | null {
  const times = values.filter(value => value !== null && value !== undefined).map(value => {
    if (!(typeof value === 'string' || value instanceof Date)) throw new ToolFailure('Health timestamps are unavailable.');
    const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
    if (!Number.isFinite(timestamp)) throw new ToolFailure('Health timestamps are unavailable.');
    return new Date(timestamp).toISOString();
  });
  return times.sort().at(-1) ?? null;
}

/** One read path for HTTP, shared tools and future browsing/GenUI; never an intake writer. */
export class HealthQueryService {
  constructor(private readonly readers: HealthReaders, private readonly now: () => number = Date.now) {}

  async query(input: unknown, request: FastifyRequest, signal: AbortSignal): Promise<HealthQueryResult> {
    resolveHealthOwner(request);
    if (!isHealthQuery(input)) throw new ToolRefusal('Invalid Health query. Use one source with only its supported selectors and exact returned cursor.');
    if (input.source === sources.lifts) resolveHealthBrowserOwner(request);
    if ((input.source === sources.briefs || input.source === sources.brief) && request.healthConnectorPrincipal) throw new AuthenticationDenied(403);
    signal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
    signal.throwIfAborted();
    try { return await this.read(input, request, signal); }
    catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof ToolRefusal || error instanceof ToolFailure || error instanceof AuthenticationDenied) throw error;
      throw new ToolFailure('Health data is unavailable. No complete result or fresh source is claimed.');
    }
  }

  private async read(input: HealthQuery, request: FastifyRequest, signal: AbortSignal): Promise<HealthQueryResult> {
    let items: Record<string, HealthJson>[] = [];
    let next: HealthCursor | null = null;
    let sourceProcessedCommittedAt: string | null = null;
    let detailMetricsTruncated = false;
    let units: Record<string, string>;
    const brief = input.source === sources.briefs || input.source === sources.brief;
    if (input.source === sources.lifts) {
      const lifts = this.readers.lifts?.(request);
      if (!lifts) throw new ToolFailure('Lift history is unavailable.');
      const page = await lifts.history({
        limit: input.limit ?? 50,
        ...(input.cursor ? { cursor: input.cursor } : {}),
        ...(input.lastPerExercise === undefined ? {} : { lastPerExercise: input.lastPerExercise }),
      }, signal);
      items = page.items as Record<string, HealthJson>[];
      next = page.next;
      units = { weightKg: 'kg', reps: 'reps', sets: 'sets' };
    } else if (input.source === sources.trainingTargets) {
      const targets = this.readers.trainingTargets?.(request);
      if (!targets) throw new ToolFailure('Training targets are unavailable.');
      const result = presentTrainingTargets(await targets.read(signal));
      items = [result as unknown as Record<string, HealthJson>];
      units = { gymSessionsPerWeek: 'sessions/week', runSessionsPerWeek: 'sessions/week', dailySteps: 'steps/day' };
    } else if (input.source === sources.briefs) {
      const page = await this.readers.briefs(request).history({
        limit: input.limit ?? 50, ...(input.cursor ? { after: input.cursor } : {}),
      }, signal);
      items = page.items.map(row => project(row, briefMetadataFields));
      next = page.next;
      units = {};
    } else if (input.source === sources.brief) {
      const row = await this.readers.briefs(request).detail(input.briefId, signal);
      if (row) items = [project(row, briefDetailFields)];
      units = {};
    } else if (input.source === sources.days) {
      const page = await this.readers.nutrition(request).days({
        from: input.startDate, to: input.endDate, limit: input.limit ?? 50,
        ...(input.cursor ? { after: input.cursor } : {}),
      }, signal);
      items = page.rows.map(row => project(row, [
        'meal_date', 'meal_count', 'energy_kcal', 'protein_grams', 'carbohydrates_grams',
        'fat_grams', 'fiber_grams', 'unknown_nutrients', 'partial_nutrients', 'latest_updated_at',
      ]));
      next = page.next;
      units = { meal_count: 'retained non-deleted meals', energy_kcal: 'kcal', '*_grams': 'g',
        meal_date: 'Europe/Copenhagen calendar date' };
    } else if (input.source === sources.meals) {
      const page = await this.readers.nutrition(request).history({
        from: input.startDate, to: input.endDate, limit: input.limit ?? 50,
        ...(input.cursor ? { after: input.cursor } : {}),
      }, signal);
      items = page.rows.map(row => projectNutritionRecord(row, 'history'));
      next = page.next;
      units = { energy_kcal: 'kcal', '*_grams': 'g', meal_date: 'Europe/Copenhagen calendar date' };
    } else if (input.source === sources.favorites || input.source === sources.plans) {
      const nutrition = this.readers.nutrition(request);
      const page = await nutrition[input.source === sources.favorites ? 'favorites' : 'plans']({
        limit: input.limit ?? 50, ...(input.cursor ? { afterId: input.cursor.id } : {}),
      }, signal);
      items = page.rows.map(row => projectNutritionRecord(row, input.source === sources.favorites ? 'favorite' : 'plan'));
      next = page.nextId === null ? null : { id: page.nextId };
      units = { energy_kcal: 'kcal', '*_grams': 'g' };
    } else {
      const health = this.readers.health(request);
      if (input.source === sources.sync) {
        const sync = await health.sync(signal);
        const feeds = sync.feeds.map(row => project(row, feedFields));
        items = [{ feeds, heartbeat: sync.heartbeat ? project(sync.heartbeat, ['last_received_at']) : null,
          inbox: sync.inbox ? project(sync.inbox, inboxFields) : null }];
        sourceProcessedCommittedAt = latest(sync.feeds.map(row => row.processed_committed_at));
      } else {
        if (input.source === sources.workout) {
          const row = await health.workoutDetail(input.workoutId, signal);
          if (row) {
            const metrics = await health.workoutMetrics(input.workoutId, signal);
            const metricRows = metrics.items as Record<string, unknown>[];
            const detail = row.detail && typeof row.detail === 'object' && !Array.isArray(row.detail)
              ? row.detail as Record<string, unknown> : {};
            const additionalMetrics = metricRows.filter(metric => {
              const metricName = String(metric.metric_name ?? '');
              const field = Object.entries(detail).find(([fieldName]) => healthName(fieldName) === metricName)?.[1];
              if (!field || typeof field !== 'object' || Array.isArray(field)) return true;
              const summary = field as Record<string, unknown>;
              return summary.samples !== Number(metric.sample_count) || summary.unit !== metric.unit ||
                summary.value !== metric.value || summary.min_value !== metric.min_value ||
                summary.avg_value !== metric.avg_value || summary.max_value !== metric.max_value;
            }).map(metric => project(metric, [
              'metric_name', 'unit', 'value', 'min_value', 'avg_value', 'max_value', 'sample_count',
              'fields', 'ingestion_id', 'updated_at',
            ]));
            detailMetricsTruncated = metrics.truncated;
            items = [{ id: row.id, detail: json(row.detail), additionalMetrics, metricsTruncated: metrics.truncated }];
          }
        } else if (input.source === sources.heartRate) {
          const page = await health.heartRate(input.workoutId, {
            limit: input.limit ?? 50, ...(input.cursor ? { after: input.cursor } : {}),
            ...('metric' in input && input.metric !== undefined ? { metric: input.metric } : {}),
          }, signal);
          items = page.items.map(row => project(row, [
            'sample_minute', 'metric_name', 'min_value', 'avg_value', 'max_value', 'unit', 'sample_count', 'sources', 'sourcesTruncated',
          ]));
          next = page.next;
        } else if (input.source === sources.metricCatalog) {
          const page = await health.metricCatalog({
            startDate: input.startDate, endDate: input.endDate, limit: input.limit ?? 100,
            ...(input.cursor ? { after: input.cursor } : {}),
          }, signal);
          items = page.items.map(row => project(row, [
            'metric_name', 'units', 'first_date', 'last_date', 'day_count', 'latest_updated_at',
          ]));
          next = page.next;
        } else {
          const kind = input.source === sources.metrics ? 'metrics' : input.source === sources.sleep ? 'sleep' : 'workouts';
          const page = await health.history(kind, {
            startDate: input.startDate, endDate: input.endDate, limit: input.limit ?? 50,
            ...(input.source === sources.metrics && input.metric !== undefined ? { metric: input.metric } : {}),
            ...(input.cursor ? { after: input.cursor } : {}),
          }, signal);
          items = page.items.map(row => project(row, [
            ...Object.keys(healthDefinitions[kind].fields).filter(field => !field.endsWith('_json')),
            ...(kind === 'metrics' ? ['fields'] : kind === 'sleep' ? ['sources', 'sourcesTruncated'] : []),
            'ingestion_id', 'updated_at',
          ]));
          next = page.next;
        }
        const feed = input.source === sources.metrics || input.source === sources.sleep || input.source === sources.metricCatalog ? 'metrics' : 'workouts';
        const sync = await health.sync(signal);
        sourceProcessedCommittedAt = latest(sync.feeds.filter(row => row.feed_kind === feed).map(row => row.processed_committed_at));
      }
      units = input.source === sources.sleep ? { '*_hours': 'h' }
        : input.source === sources.workouts ? { duration_seconds: 's', '*_unit': 'retained per-record unit', '*_heart_rate': 'bpm' }
            : { unit: 'retained per-record unit' };
    }
    signal.throwIfAborted();
    const result: HealthQueryResult = {
      source: input.source,
      period: 'startDate' in input ? { startDate: input.startDate, endDate: input.endDate, timeZone: 'Europe/Copenhagen' } : null,
      items,
      status: next || detailMetricsTruncated
        ? 'partial' : items.length ? 'available' : 'empty',
      units,
      provenance: { store: 'daily-sql', detail: 'retained-record',
        calculations: input.source === sources.days ? 'derived-from-retained-meals' : 'existing-read-model',
        consistency: 'independent-committed-reads' },
      freshness: { observedAt: new Date(this.now()).toISOString(), sourceProcessedCommittedAt,
        latestReturnedRecordUpdatedAt: brief ? null : latest(items.map(row => row.updated_at ?? row.latest_updated_at ?? row.updatedAt)), staleness: 'unknown' },
      coverage: { returned: items.length, hasMore: next !== null, next, sourceCompleteness: 'unknown',
        ...(detailMetricsTruncated ? { detailMetricsTruncated: true } : {}) },
      revision: '0'.repeat(64), // Reserve the final fingerprint bytes in the response budget.
    };
    if (Buffer.byteLength(JSON.stringify(result)) > healthResultByteLimit) throw new ToolRefusal('Health result exceeds the shared response limit. Request a smaller page; oversized single detail remains unavailable.');
    // Exclude observation time; independent reads are not an atomic/global snapshot.
    // Read DTOs use their response budget, not nutrition's per-write JSON limits.
    result.revision = createHash('sha256').update(JSON.stringify({
      ...result, query: input, revision: null, freshness: { ...result.freshness, observedAt: null },
    }, (_key, value: unknown) => value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
      : value)).digest('hex');
    return result;
  }
}

export type HealthFoodLookup = (input: readonly LookupComponent[], request: FastifyRequest, signal: AbortSignal) => Promise<FridaLookup>;

/** Explicit inactive composition: no timer, automatic provider request, route or production registration. */
export interface HealthGymVault {
  readonly vault: Pick<ReturnType<typeof createGitHubVaultClient>, 'read' | 'write'>;
  readonly logger?: GymSyncLogger;
}

export function createHealthData(pool: sql.ConnectionPool, owner: string, now: () => number = Date.now, frida?: Pick<FridaLookupAdapter, 'lookup'>, gymVault?: HealthGymVault) {
  const changes = createHealthChanges();
  const checkOwner = (request: FastifyRequest) => {
    if (resolveHealthOwner(request).toLowerCase() !== owner.toLowerCase()) throw new AuthenticationDenied(403);
  };
  const nutrition = (request: FastifyRequest) => {
    checkOwner(request);
    return NutritionStore.forRequest(pool, request, () => new Date(now()).toISOString(), changes);
  };
  const trainingTargets: TrainingTargetsAccess = request => {
    checkOwner(request);
    return TrainingTargetsStore.forRequest(pool, request);
  };
  const gymSync = gymVault ? createGymVaultSync({
    writer: createGymLogWriter({ vault: gymVault.vault }),
    workouts: WorkoutEntriesStore.forOwner(pool, owner, changes),
    lifts: LiftEntriesStore.forOwner(pool, owner, changes),
    ...(gymVault.logger ? { logger: gymVault.logger } : {}),
    now,
  }) : undefined;
  const lifts: LiftEntriesAccess = request => {
    checkOwner(request);
    return LiftEntriesStore.forRequest(pool, request, changes, gymSync);
  };
  const workouts: WorkoutEntriesAccess = request => {
    checkOwner(request);
    return WorkoutEntriesStore.forRequest(pool, request, changes, gymSync);
  };
  const deviceSync: DeviceSyncAccess = request => {
    checkOwner(request);
    return SqlDeviceSyncStore.forRequest(pool, request, changes, now);
  };
  const readers: HealthReaders = {
    health: request => { checkOwner(request); return HealthReadModel.forRequest(pool, request); },
    nutrition,
    briefs: request => { checkOwner(request); return HealthBriefReadModel.forRequest(pool, request); },
    trainingTargets,
    lifts,
  };
  const foodLookup: HealthFoodLookup | undefined = frida
    ? async (input, request, signal) => { checkOwner(request); return frida.lookup(input, signal); }
    : undefined;
  return {
    query: new HealthQueryService(readers, now), changes, trainingTargets, lifts, workouts, deviceSync,
    gymTools: {
      lifts: (request: FastifyRequest) => { checkOwner(request); return LiftEntriesStore.forConversation(pool, request, changes, gymSync); },
      workouts: (request: FastifyRequest) => { checkOwner(request); return WorkoutEntriesStore.forConversation(pool, request, changes, gymSync); },
    },
    ...(gymSync ? { retryGymVault: (signal: AbortSignal) => gymSync.retryPending(signal) } : {}),
    health: (request: FastifyRequest) => { checkOwner(request); return readers.health(request); },
    nutrition,
    coach: (request: FastifyRequest) => { checkOwner(request); return SqlHealthCoachStore.forRequest(pool, request); },
    processor: new SqlHealthProcessor(pool, owner, now, changes),
    ...(foodLookup ? { foodLookup } : {}),
  };
}
export interface HealthData {
  query: Pick<HealthQueryService, 'query'>;
  changes: HealthChanges;
  trainingTargets?: TrainingTargetsAccess;
  lifts?: LiftEntriesAccess;
  workouts?: WorkoutEntriesAccess;
  gymTools?: { lifts: LiftEntriesAccess; workouts: WorkoutEntriesAccess };
  deviceSync?: DeviceSyncAccess;
  retryGymVault?: (signal: AbortSignal) => Promise<{ synced: number; pending: number }>;
  health?: (request: FastifyRequest) => Pick<HealthReadModel, 'history' | 'sync'>;
  nutrition?: (request: FastifyRequest) => Pick<NutritionStore, 'history' | 'days' | 'feedback' | 'preferences'>;
  coach?: (request: FastifyRequest) => HealthCoachStore;
  foodLookup?: HealthFoodLookup;
}
