import sql from 'mssql';
import type { FastifyRequest } from 'fastify';
import { healthQuerySources } from '@jarvis/contracts';
import { ToolFailure, ToolRefusal } from '../../core/tool-registry.js';
import { databaseReadRequest } from '../../database/wake-retry.js';
import { dayKey } from '../../proactive/time.js';
import { resolveHealthBrowserOwner, resolveHealthConversationOwner } from '../owner.js';
import type { HealthChanges } from '../revisions.js';
import type { VaultState } from '../gym/workouts.js';
import { parseLiftPatch, presentLiftEntry, presentLiftWrite, type LiftCreate, type LiftEntry, type LiftPatch } from './lifts.js';

/** Vault copy hook; the store never depends on how the note is written. */
export interface LiftVaultSync {
  syncLift(entry: LiftEntry, signal: AbortSignal): Promise<VaultState>;
}

export interface LiftCursor {
  readonly performedAt: string;
  readonly id: string;
}

export interface LiftHistoryOptions {
  readonly limit: number;
  readonly cursor?: LiftCursor;
  readonly lastPerExercise?: boolean;
}

interface StoredRow {
  id: string;
  exercise_name: string;
  exercise_key: string;
  weight_kg: number | string;
  reps: number;
  sets: number;
  performed_at: Date | string;
  deleted_at: Date | string | null;
  updated_at: Date | string;
  revision: number | string;
  workout_id?: string | null;
  gym_day?: string | null;
  vault_synced_revision?: number | string | null;
}

const rowFields = 'id, exercise_name, exercise_key, weight_kg, reps, sets, performed_at, deleted_at, updated_at, revision, workout_id, gym_day, vault_synced_revision';
const insertedFields = rowFields.split(', ').map(field => `INSERTED.${field}`).join(', ');
const selectIdempotent = `SELECT ${rowFields} FROM daily.lift_entries WITH (UPDLOCK, HOLDLOCK)
  WHERE owner_object_id = @owner AND idempotency_key = @idempotencyKey;`;
const insertEntry = `INSERT INTO daily.lift_entries
  (owner_object_id, exercise_name, exercise_key, weight_kg, reps, sets, performed_at, idempotency_key, workout_id, gym_day)
  OUTPUT ${insertedFields}
  VALUES (@owner, @name, @key, @weight, @reps, @sets, @performedAt, @idempotencyKey, @workoutId, @gymDay);`;
const selectWorkoutDay = `SELECT gym_day FROM daily.workout_entries
  WHERE owner_object_id = @owner AND id = @workoutId AND deleted_at IS NULL;`;
const markSyncedCommand = `UPDATE daily.lift_entries SET vault_synced_revision = @revision
  WHERE owner_object_id = @owner AND id = @id AND revision >= @revision
    AND (vault_synced_revision IS NULL OR vault_synced_revision < @revision);`;
const selectPending = `SELECT TOP (@take) ${rowFields} FROM daily.lift_entries
  WHERE owner_object_id = @owner AND (vault_synced_revision IS NULL OR vault_synced_revision < revision)
  ORDER BY updated_at ASC, id ASC;`;
const updateBase = `UPDATE daily.lift_entries SET`;
const deleteEntry = `UPDATE daily.lift_entries
  SET deleted_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME(), revision = revision + 1
  OUTPUT ${insertedFields}
  WHERE owner_object_id = @owner AND id = @id AND deleted_at IS NULL;`;

function stamp(value: Date | string | null): string | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function decode(row: StoredRow): LiftEntry {
  const performedAt = stamp(row.performed_at);
  const deletedAt = stamp(row.deleted_at);
  const updatedAt = stamp(row.updated_at);
  const weightKg = Number(row.weight_kg);
  const revision = Number(row.revision);
  const synced = row.vault_synced_revision === null || row.vault_synced_revision === undefined ? null : Number(row.vault_synced_revision);
  const workoutId = row.workout_id ?? null;
  const gymDay = row.gym_day ?? null;
  if (workoutId !== null && !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(workoutId) ||
      gymDay !== null && !/^\d{4}-\d{2}-\d{2}$/u.test(gymDay) ||
      synced !== null && !Number.isSafeInteger(synced) ||
      !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(row.id) ||
      typeof row.exercise_name !== 'string' || row.exercise_name.length < 1 || row.exercise_name.length > 80 ||
      typeof row.exercise_key !== 'string' || row.exercise_key !== row.exercise_name.trim().toLowerCase() ||
      !Number.isFinite(weightKg) || weightKg < 0 || weightKg > 1000 ||
      !Number.isSafeInteger(row.reps) || row.reps < 1 || row.reps > 1000 ||
      !Number.isSafeInteger(row.sets) || row.sets < 1 || row.sets > 100 ||
      performedAt === null || !updatedAt || !Number.isSafeInteger(revision) || revision < 1) {
    throw new Error('Stored lift entry is invalid');
  }
  return {
    id: row.id.toLowerCase(), exerciseName: row.exercise_name, exerciseKey: row.exercise_key,
    weightKg, reps: row.reps, sets: row.sets, performedAt, deletedAt, updatedAt, revision,
    workoutId: workoutId?.toLowerCase() ?? null, gymDay, vaultSyncedRevision: synced,
  };
}

function bindOwner(request: sql.Request, owner: string): sql.Request {
  return request.input('owner', sql.UniqueIdentifier, owner);
}

function bindCreate(request: sql.Request, owner: string, value: LiftCreate, gymDay: string): sql.Request {
  return bindOwner(request, owner)
    .input('idempotencyKey', sql.UniqueIdentifier, value.idempotencyKey)
    .input('name', sql.NVarChar(80), value.exerciseName)
    .input('key', sql.NVarChar(80), value.exerciseKey)
    .input('weight', sql.Decimal(6, 2), value.weightKg)
    .input('reps', sql.Int, value.reps)
    .input('sets', sql.Int, value.sets)
    .input('performedAt', sql.DateTime2(3), new Date(value.performedAt))
    .input('workoutId', sql.UniqueIdentifier, value.workoutId)
    .input('gymDay', sql.Char(10), gymDay);
}

async function run(request: sql.Request, command: string, signal: AbortSignal) {
  const cancel = () => { request.cancel(); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    return await request.query<StoredRow>(command);
  } finally { signal.removeEventListener('abort', cancel); }
}

export class LiftEntriesStore {
  private constructor(
    private readonly pool: sql.ConnectionPool,
    private readonly owner: string,
    private readonly changes: HealthChanges,
    private readonly vault: LiftVaultSync | undefined,
  ) {}

  static forRequest(pool: sql.ConnectionPool, request: FastifyRequest, changes: HealthChanges, vault?: LiftVaultSync): LiftEntriesStore {
    const owner = resolveHealthBrowserOwner(request);
    if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(owner)) throw new TypeError('Invalid Health owner');
    return new LiftEntriesStore(pool, owner.toLowerCase(), changes, vault);
  }

  /** The tool handler verifies the current owner conversation before mutations. */
  static forConversation(pool: sql.ConnectionPool, request: FastifyRequest, changes: HealthChanges, vault?: LiftVaultSync): LiftEntriesStore {
    const owner = resolveHealthConversationOwner(request);
    if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(owner)) throw new TypeError('Invalid Health owner');
    return new LiftEntriesStore(pool, owner.toLowerCase(), changes, vault);
  }

  /** Server-side jobs act for the configured owner only. */
  static forOwner(pool: sql.ConnectionPool, owner: string, changes: HealthChanges): LiftEntriesStore {
    if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(owner)) throw new TypeError('Invalid Health owner');
    return new LiftEntriesStore(pool, owner.toLowerCase(), changes, undefined);
  }

  private async finish(entry: LiftEntry, signal: AbortSignal) {
    const pending = entry.vaultSyncedRevision === null || entry.vaultSyncedRevision < entry.revision;
    const vault = this.vault && pending ? await this.vault.syncLift(entry, signal) : pending ? 'pending' : 'synced';
    return presentLiftWrite(vault === 'synced' ? { ...entry, vaultSyncedRevision: entry.revision } : entry);
  }

  async history(options: LiftHistoryOptions, signal: AbortSignal) {
    signal.throwIfAborted();
    if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100 ||
        options.cursor && (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(options.cursor.id) ||
          !Number.isFinite(Date.parse(options.cursor.performedAt)))) {
      throw new TypeError('Invalid lift history options');
    }
    const take = options.limit + 1;
    const command = options.lastPerExercise
      ? `WITH latest AS (
          SELECT ${rowFields}, ROW_NUMBER() OVER (PARTITION BY exercise_key ORDER BY performed_at DESC, id DESC) AS row_number
          FROM daily.lift_entries WHERE owner_object_id = @owner AND deleted_at IS NULL
        )
        SELECT TOP (@take) ${rowFields} FROM latest
        WHERE row_number = 1 AND (@cursorAt IS NULL OR performed_at < @cursorAt OR (performed_at = @cursorAt AND id < @cursorId))
        ORDER BY performed_at DESC, id DESC;`
      : `SELECT TOP (@take) ${rowFields} FROM daily.lift_entries
        WHERE owner_object_id = @owner AND deleted_at IS NULL
          AND (@cursorAt IS NULL OR performed_at < @cursorAt OR (performed_at = @cursorAt AND id < @cursorId))
        ORDER BY performed_at DESC, id DESC;`;
    try {
      const request = bindOwner(databaseReadRequest(this.pool), this.owner)
        .input('take', sql.Int, take)
        .input('cursorAt', sql.DateTime2(3), options.cursor ? new Date(options.cursor.performedAt) : null)
        .input('cursorId', sql.UniqueIdentifier, options.cursor?.id ?? null);
      const rows = (await run(request, command, signal)).recordset.map(decode);
      const hasMore = rows.length > options.limit;
      const items = rows.slice(0, options.limit);
      const last = items.at(-1);
      return {
        items: items.map(presentLiftEntry),
        next: hasMore && last ? { performedAt: last.performedAt, id: last.id } : null,
      };
    } catch {
      if (signal.aborted) throw signal.reason;
      throw new ToolFailure('Lift history is unavailable.');
    }
  }

  async create(value: LiftCreate, signal: AbortSignal): Promise<{ entry: ReturnType<typeof presentLiftWrite>; replayed: boolean }> {
    signal.throwIfAborted();
    const transaction = new sql.Transaction(this.pool);
    let created = false;
    let entry: LiftEntry;
    try {
      await transaction.begin();
      const existing = (await run(bindOwner(transaction.request(), this.owner)
        .input('idempotencyKey', sql.UniqueIdentifier, value.idempotencyKey), selectIdempotent, signal)).recordset[0];
      if (existing) {
        entry = decode(existing);
      } else {
        let gymDay = dayKey(new Date(value.performedAt));
        if (value.workoutId) {
          const workout = (await bindOwner(transaction.request(), this.owner)
            .input('workoutId', sql.UniqueIdentifier, value.workoutId)
            .query<{ gym_day: string }>(selectWorkoutDay)).recordset[0];
          if (!workout) throw new ToolRefusal('Workout entry not found.');
          gymDay = workout.gym_day;
        }
        const inserted = (await run(bindCreate(transaction.request(), this.owner, value, gymDay), insertEntry, signal)).recordset[0];
        if (!inserted) throw new Error('Lift insert returned no row');
        entry = decode(inserted);
        created = true;
      }
      signal.throwIfAborted();
      await transaction.commit();
    } catch (error) {
      try { await transaction.rollback(); } catch { /* Preserve the sanitized failure. */ }
      if (signal.aborted) throw signal.reason;
      if (error instanceof ToolRefusal) throw error;
      throw new ToolFailure('Lift could not be saved. Check history before retrying.');
    }
    if (created) this.changes.publish({ owner: this.owner, sources: [healthQuerySources.lifts] });
    return { entry: await this.finish(entry, signal), replayed: !created };
  }

  async update(id: string, patch: LiftPatch, signal: AbortSignal): Promise<ReturnType<typeof presentLiftWrite> | null> {
    signal.throwIfAborted();
    const checked = parseLiftPatch(patch);
    if (!checked.ok || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(id)) {
      throw new TypeError('A lift update must include a valid entry and patch');
    }
    const changes: string[] = [];
    const request = bindOwner(databaseReadRequest(this.pool), this.owner).input('id', sql.UniqueIdentifier, id);
    if (checked.patch.exerciseName !== undefined) {
      changes.push('exercise_name = @name', 'exercise_key = @key');
      request.input('name', sql.NVarChar(80), checked.patch.exerciseName)
        .input('key', sql.NVarChar(80), checked.patch.exerciseName.toLowerCase());
    }
    if (checked.patch.weightKg !== undefined) {
      changes.push('weight_kg = @weight');
      request.input('weight', sql.Decimal(6, 2), checked.patch.weightKg);
    }
    if (checked.patch.reps !== undefined) {
      changes.push('reps = @reps');
      request.input('reps', sql.Int, checked.patch.reps);
    }
    if (checked.patch.sets !== undefined) {
      changes.push('sets = @sets');
      request.input('sets', sql.Int, checked.patch.sets);
    }
    changes.push('updated_at = SYSUTCDATETIME()', 'revision = revision + 1');
    const command = `${updateBase} ${changes.join(', ')}
      OUTPUT ${insertedFields}
      WHERE owner_object_id = @owner AND id = @id AND deleted_at IS NULL;`;
    let entry: LiftEntry | null;
    try {
      const row = (await run(request, command, signal)).recordset[0];
      entry = row ? decode(row) : null;
    } catch {
      if (signal.aborted) throw signal.reason;
      throw new ToolFailure('Lift could not be updated.');
    }
    if (!entry) return null;
    this.changes.publish({ owner: this.owner, sources: [healthQuerySources.lifts] });
    return this.finish(entry, signal);
  }

  async delete(id: string, signal: AbortSignal): Promise<ReturnType<typeof presentLiftWrite> | null> {
    signal.throwIfAborted();
    if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(id)) throw new TypeError('Invalid lift id');
    let entry: LiftEntry | null;
    try {
      const row = (await run(bindOwner(databaseReadRequest(this.pool), this.owner)
        .input('id', sql.UniqueIdentifier, id), deleteEntry, signal)).recordset[0];
      entry = row ? decode(row) : null;
    } catch {
      if (signal.aborted) throw signal.reason;
      throw new ToolFailure('Lift could not be deleted.');
    }
    if (!entry) return null;
    this.changes.publish({ owner: this.owner, sources: [healthQuerySources.lifts] });
    return this.finish(entry, signal);
  }

  async pendingVaultCopies(limit: number, signal: AbortSignal): Promise<LiftEntry[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Invalid pending limit');
    const request = bindOwner(databaseReadRequest(this.pool), this.owner).input('take', sql.Int, limit);
    return (await run(request, selectPending, signal)).recordset.map(decode);
  }

  async markVaultSynced(id: string, revision: number, signal: AbortSignal): Promise<void> {
    await run(bindOwner(databaseReadRequest(this.pool), this.owner)
      .input('id', sql.UniqueIdentifier, id).input('revision', sql.BigInt, revision), markSyncedCommand, signal);
  }
}

export type LiftEntriesAccess = (request: FastifyRequest) => Pick<LiftEntriesStore, 'history' | 'create' | 'update' | 'delete'>;
