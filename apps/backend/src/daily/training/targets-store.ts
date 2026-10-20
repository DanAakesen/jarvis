import sql from 'mssql';
import type { FastifyRequest } from 'fastify';
import { ToolFailure } from '../../core/tool-registry.js';
import { databaseReadRequest } from '../../database/wake-retry.js';
import { resolveDailyOwner } from '../owner.js';
import {
  emptyTrainingTargets, parseStoredTrainingTarget, parseTrainingTargetsPatch, trainingTargetFields,
  type StoredTrainingTargets, type TrainingTargets, type TrainingTargetsPatch,
} from './targets.js';

interface StoredRow {
  gym_sessions_per_week: number | null;
  run_sessions_per_week: number | null;
  daily_steps: number | null;
  updated_at: Date | string | null;
}

const selectTargets = `SELECT gym_sessions_per_week, run_sessions_per_week, daily_steps, updated_at
  FROM daily.training_targets WHERE owner_object_id = @owner;`;
const selectForUpdate = `SELECT gym_sessions_per_week, run_sessions_per_week, daily_steps, updated_at
  FROM daily.training_targets WITH (UPDLOCK, HOLDLOCK) WHERE owner_object_id = @owner;`;
const updateTargets = `UPDATE daily.training_targets
  SET gym_sessions_per_week = @gym, run_sessions_per_week = @run, daily_steps = @steps, updated_at = SYSUTCDATETIME()
  WHERE owner_object_id = @owner;`;
const insertTargets = `INSERT INTO daily.training_targets
  (owner_object_id, gym_sessions_per_week, run_sessions_per_week, daily_steps, updated_at)
  VALUES (@owner, @gym, @run, @steps, SYSUTCDATETIME());`;
const deleteTargets = 'DELETE FROM daily.training_targets WHERE owner_object_id = @owner;';

async function run(request: sql.Request, command: string, signal: AbortSignal) {
  const cancel = () => { request.cancel(); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    return await request.query<StoredRow>(command);
  } finally { signal.removeEventListener('abort', cancel); }
}

function storedRow(rows: readonly StoredRow[]): StoredTrainingTargets {
  const row = rows[0];
  if (!row) return { targets: { ...emptyTrainingTargets }, updatedAt: null };
  const targets: TrainingTargets = {
    gymSessionsPerWeek: parseStoredTrainingTarget('gymSessionsPerWeek', row.gym_sessions_per_week),
    runSessionsPerWeek: parseStoredTrainingTarget('runSessionsPerWeek', row.run_sessions_per_week),
    dailySteps: parseStoredTrainingTarget('dailySteps', row.daily_steps),
  };
  const hasTargets = trainingTargetFields.some((field) => targets[field] !== null);
  const stamp = row.updated_at instanceof Date ? row.updated_at.getTime()
    : typeof row.updated_at === 'string' ? Date.parse(row.updated_at) : Number.NaN;
  return {
    targets,
    updatedAt: hasTargets && Number.isFinite(stamp) ? new Date(stamp).toISOString() : null,
  };
}

function requestForOwner(request: sql.Request, owner: string): sql.Request {
  return request.input('owner', sql.UniqueIdentifier, owner);
}

function requestForTargets(request: sql.Request, owner: string, targets: TrainingTargets): sql.Request {
  return requestForOwner(request, owner)
    .input('gym', sql.Int, targets.gymSessionsPerWeek)
    .input('run', sql.Int, targets.runSessionsPerWeek)
    .input('steps', sql.Int, targets.dailySteps);
}

export class TrainingTargetsStore {
  private constructor(private readonly pool: sql.ConnectionPool, private readonly owner: string) {}

  static forRequest(pool: sql.ConnectionPool, request: FastifyRequest): TrainingTargetsStore {
    const owner = resolveDailyOwner(request);
    if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(owner)) throw new TypeError('Invalid Health owner');
    return new TrainingTargetsStore(pool, owner.toLowerCase());
  }

  async read(signal: AbortSignal): Promise<StoredTrainingTargets> {
    signal.throwIfAborted();
    try {
      const result = await run(requestForOwner(databaseReadRequest(this.pool), this.owner), selectTargets, signal);
      return storedRow(result.recordset);
    } catch {
      if (signal.aborted) throw signal.reason;
      throw new ToolFailure('Training targets are unavailable.');
    }
  }

  async write(patch: TrainingTargetsPatch, signal: AbortSignal): Promise<StoredTrainingTargets> {
    signal.throwIfAborted();
    const checked = parseTrainingTargetsPatch(patch);
    if (!checked.ok) throw new TypeError('A training-target change must name valid targets');
    const transaction = new sql.Transaction(this.pool);
    try {
      await transaction.begin();
      const currentResult = await run(requestForOwner(transaction.request(), this.owner), selectForUpdate, signal);
      const current = storedRow(currentResult.recordset);
      const targets: TrainingTargets = { ...current.targets, ...checked.patch };
      const request = requestForTargets(transaction.request(), this.owner, targets);
      if (trainingTargetFields.every((field) => targets[field] === null)) {
        await run(requestForOwner(transaction.request(), this.owner), deleteTargets, signal);
      } else if (currentResult.recordset.length) {
        await run(request, updateTargets, signal);
      } else {
        await run(request, insertTargets, signal);
      }
      const stored = storedRow((await run(requestForOwner(transaction.request(), this.owner), selectTargets, signal)).recordset);
      signal.throwIfAborted();
      await transaction.commit();
      return stored;
    } catch {
      try { await transaction.rollback(); } catch { /* Preserve the sanitized failure. */ }
      if (signal.aborted) throw signal.reason;
      throw new ToolFailure('Training targets could not be saved. Read them to check the current values before retrying.');
    }
  }
}

export type TrainingTargetsAccess = (request: FastifyRequest) => Pick<TrainingTargetsStore, 'read' | 'write'>;
