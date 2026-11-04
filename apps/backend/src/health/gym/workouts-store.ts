import sql from 'mssql';
import type { FastifyRequest } from 'fastify';
import { healthQuerySources } from '@jarvis/contracts';
import { ToolFailure } from '../../core/tool-registry.js';
import { databaseReadRequest } from '../../database/wake-retry.js';
import { dayKey } from '../../proactive/time.js';
import { resolveHealthBrowserOwner } from '../owner.js';
import type { HealthChanges } from '../revisions.js';
import {
  isSessionType, parseWorkoutPatch, presentWorkoutEntry, vaultStateOf,
  type VaultState, type WorkoutCreate, type WorkoutEntry, type WorkoutPatch,
} from './workouts.js';

interface StoredRow {
  id: string;
  session_type: string;
  title: string | null;
  started_at: Date | string;
  gym_day: string;
  duration_minutes: number | null;
  note: string | null;
  deleted_at: Date | string | null;
  updated_at: Date | string;
  revision: number | string;
  vault_synced_revision: number | string | null;
}

/** Vault copy hook; the store never depends on how the note is written. */
export interface WorkoutVaultSync {
  syncWorkout(entry: WorkoutEntry, signal: AbortSignal): Promise<VaultState>;
}

const uuidPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu;
const rowFields = 'id, session_type, title, started_at, gym_day, duration_minutes, note, deleted_at, updated_at, revision, vault_synced_revision';
const insertedFields = rowFields.split(', ').map(field => `INSERTED.${field}`).join(', ');
const selectIdempotent = `SELECT ${rowFields} FROM daily.workout_entries WITH (UPDLOCK, HOLDLOCK)
  WHERE owner_object_id = @owner AND idempotency_key = @idempotencyKey;`;
const insertEntry = `INSERT INTO daily.workout_entries
  (owner_object_id, session_type, title, started_at, gym_day, duration_minutes, note, idempotency_key)
  OUTPUT ${insertedFields}
  VALUES (@owner, @type, @title, @startedAt, @gymDay, @duration, @note, @idempotencyKey);`;
const deleteEntry = `UPDATE daily.workout_entries
  SET deleted_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME(), revision = revision + 1
  OUTPUT ${insertedFields}
  WHERE owner_object_id = @owner AND id = @id AND deleted_at IS NULL;`;
const markSyncedCommand = `UPDATE daily.workout_entries SET vault_synced_revision = @revision
  WHERE owner_object_id = @owner AND id = @id AND revision >= @revision
    AND (vault_synced_revision IS NULL OR vault_synced_revision < @revision);`;
const selectPending = `SELECT TOP (@take) ${rowFields} FROM daily.workout_entries
  WHERE owner_object_id = @owner AND (vault_synced_revision IS NULL OR vault_synced_revision < revision)
  ORDER BY updated_at ASC, id ASC;`;

function stamp(value: Date | string | null): string | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function decode(row: StoredRow): WorkoutEntry {
  const startedAt = stamp(row.started_at);
  const updatedAt = stamp(row.updated_at);
  const revision = Number(row.revision);
  const synced = row.vault_synced_revision === null || row.vault_synced_revision === undefined ? null : Number(row.vault_synced_revision);
  if (!uuidPattern.test(row.id) || !isSessionType(row.session_type) ||
      row.title !== null && (typeof row.title !== 'string' || row.title.length < 1 || row.title.length > 80 || row.session_type !== 'other') ||
      startedAt === null || !updatedAt || typeof row.gym_day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(row.gym_day) ||
      row.duration_minutes !== null && (!Number.isSafeInteger(row.duration_minutes) || row.duration_minutes < 1 || row.duration_minutes > 1440) ||
      row.note !== null && (typeof row.note !== 'string' || row.note.length > 500) ||
      !Number.isSafeInteger(revision) || revision < 1 || synced !== null && !Number.isSafeInteger(synced)) {
    throw new Error('Stored workout entry is invalid');
  }
  return {
    id: row.id.toLowerCase(), sessionType: row.session_type, title: row.title, startedAt, gymDay: row.gym_day,
    durationMinutes: row.duration_minutes, note: row.note, deletedAt: stamp(row.deleted_at), updatedAt, revision,
    vaultSyncedRevision: synced,
  };
}

function bindOwner(request: sql.Request, owner: string): sql.Request {
  return request.input('owner', sql.UniqueIdentifier, owner);
}

async function run(request: sql.Request, command: string, signal: AbortSignal) {
  const cancel = () => { request.cancel(); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    return await request.query<StoredRow>(command);
  } finally { signal.removeEventListener('abort', cancel); }
}

export class WorkoutEntriesStore {
  private constructor(
    private readonly pool: sql.ConnectionPool,
    private readonly owner: string,
    private readonly changes: HealthChanges,
    private readonly vault: WorkoutVaultSync | undefined,
  ) {}

  static forRequest(pool: sql.ConnectionPool, request: FastifyRequest, changes: HealthChanges, vault?: WorkoutVaultSync): WorkoutEntriesStore {
    const owner = resolveHealthBrowserOwner(request);
    if (!uuidPattern.test(owner)) throw new TypeError('Invalid Health owner');
    return new WorkoutEntriesStore(pool, owner.toLowerCase(), changes, vault);
  }

  /** Server-side jobs act for the configured owner only. */
  static forOwner(pool: sql.ConnectionPool, owner: string, changes: HealthChanges): WorkoutEntriesStore {
    if (!uuidPattern.test(owner)) throw new TypeError('Invalid Health owner');
    return new WorkoutEntriesStore(pool, owner.toLowerCase(), changes, undefined);
  }

  private async finish(entry: WorkoutEntry, signal: AbortSignal) {
    const vault = this.vault && vaultStateOf(entry) === 'pending' ? await this.vault.syncWorkout(entry, signal) : vaultStateOf(entry);
    return presentWorkoutEntry(vault === 'synced' ? { ...entry, vaultSyncedRevision: entry.revision } : entry);
  }

  async history(options: { readonly limit: number; readonly days?: number }, signal: AbortSignal) {
    signal.throwIfAborted();
    if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100 ||
        options.days !== undefined && (!Number.isSafeInteger(options.days) || options.days < 1 || options.days > 90)) {
      throw new TypeError('Invalid workout history options');
    }
    const command = `SELECT TOP (@take) ${rowFields} FROM daily.workout_entries
      WHERE owner_object_id = @owner AND deleted_at IS NULL AND (@since IS NULL OR started_at >= @since)
      ORDER BY started_at DESC, id DESC;`;
    try {
      const since = options.days === undefined ? null : new Date(Date.now() - options.days * 86_400_000);
      const request = bindOwner(databaseReadRequest(this.pool), this.owner)
        .input('take', sql.Int, options.limit)
        .input('since', sql.DateTime2(3), since);
      return { items: (await run(request, command, signal)).recordset.map(decode).map(presentWorkoutEntry) };
    } catch {
      if (signal.aborted) throw signal.reason;
      throw new ToolFailure('Workout history is unavailable.');
    }
  }

  async create(value: WorkoutCreate, signal: AbortSignal): Promise<{ entry: ReturnType<typeof presentWorkoutEntry>; replayed: boolean }> {
    signal.throwIfAborted();
    const transaction = new sql.Transaction(this.pool);
    let created = false;
    let entry: WorkoutEntry;
    try {
      await transaction.begin();
      const existing = (await run(bindOwner(transaction.request(), this.owner)
        .input('idempotencyKey', sql.UniqueIdentifier, value.idempotencyKey), selectIdempotent, signal)).recordset[0];
      if (existing) {
        entry = decode(existing);
      } else {
        const inserted = (await run(bindOwner(transaction.request(), this.owner)
          .input('idempotencyKey', sql.UniqueIdentifier, value.idempotencyKey)
          .input('type', sql.VarChar(24), value.sessionType)
          .input('title', sql.NVarChar(80), value.title)
          .input('startedAt', sql.DateTime2(3), new Date(value.startedAt))
          .input('gymDay', sql.Char(10), dayKey(new Date(value.startedAt)))
          .input('duration', sql.Int, value.durationMinutes)
          .input('note', sql.NVarChar(500), value.note), insertEntry, signal)).recordset[0];
        if (!inserted) throw new Error('Workout insert returned no row');
        entry = decode(inserted);
        created = true;
      }
      signal.throwIfAborted();
      await transaction.commit();
    } catch {
      try { await transaction.rollback(); } catch { /* Preserve the sanitized failure. */ }
      if (signal.aborted) throw signal.reason;
      throw new ToolFailure('Workout could not be saved. Check history before retrying.');
    }
    if (created) this.changes.publish({ owner: this.owner, sources: [healthQuerySources.lifts] });
    return { entry: await this.finish(entry, signal), replayed: !created };
  }

  async update(id: string, patch: WorkoutPatch, signal: AbortSignal) {
    signal.throwIfAborted();
    const checked = parseWorkoutPatch(patch);
    if (!checked.ok || !uuidPattern.test(id)) throw new TypeError('A workout update must include a valid entry and patch');
    const changes: string[] = [];
    const request = bindOwner(databaseReadRequest(this.pool), this.owner).input('id', sql.UniqueIdentifier, id);
    const { sessionType, title, durationMinutes, note } = checked.patch;
    if (sessionType !== undefined) {
      changes.push('session_type = @type');
      request.input('type', sql.VarChar(24), sessionType);
    }
    if (sessionType !== undefined && sessionType !== 'other') changes.push('title = NULL');
    else if (title !== undefined) {
      changes.push(sessionType === 'other' ? 'title = @title' : `title = CASE WHEN session_type = 'other' THEN @title ELSE NULL END`);
      request.input('title', sql.NVarChar(80), title);
    }
    if (durationMinutes !== undefined) {
      changes.push('duration_minutes = @duration');
      request.input('duration', sql.Int, durationMinutes);
    }
    if (note !== undefined) {
      changes.push('note = @note');
      request.input('note', sql.NVarChar(500), note);
    }
    changes.push('updated_at = SYSUTCDATETIME()', 'revision = revision + 1');
    const command = `UPDATE daily.workout_entries SET ${changes.join(', ')}
      OUTPUT ${insertedFields}
      WHERE owner_object_id = @owner AND id = @id AND deleted_at IS NULL;`;
    let entry: WorkoutEntry | null;
    try {
      const row = (await run(request, command, signal)).recordset[0];
      entry = row ? decode(row) : null;
    } catch {
      if (signal.aborted) throw signal.reason;
      throw new ToolFailure('Workout could not be updated.');
    }
    if (!entry) return null;
    this.changes.publish({ owner: this.owner, sources: [healthQuerySources.lifts] });
    return this.finish(entry, signal);
  }

  async delete(id: string, signal: AbortSignal) {
    signal.throwIfAborted();
    if (!uuidPattern.test(id)) throw new TypeError('Invalid workout id');
    let entry: WorkoutEntry | null;
    try {
      const row = (await run(bindOwner(databaseReadRequest(this.pool), this.owner)
        .input('id', sql.UniqueIdentifier, id), deleteEntry, signal)).recordset[0];
      entry = row ? decode(row) : null;
    } catch {
      if (signal.aborted) throw signal.reason;
      throw new ToolFailure('Workout could not be deleted.');
    }
    if (!entry) return null;
    this.changes.publish({ owner: this.owner, sources: [healthQuerySources.lifts] });
    return this.finish(entry, signal);
  }

  /** Reads one live entry for the vault writer. */
  async get(id: string, signal: AbortSignal): Promise<WorkoutEntry | null> {
    signal.throwIfAborted();
    if (!uuidPattern.test(id)) throw new TypeError('Invalid workout id');
    const row = (await run(bindOwner(databaseReadRequest(this.pool), this.owner).input('id', sql.UniqueIdentifier, id),
      `SELECT ${rowFields} FROM daily.workout_entries WHERE owner_object_id = @owner AND id = @id AND deleted_at IS NULL;`, signal)).recordset[0];
    return row ? decode(row) : null;
  }

  async pendingVaultCopies(limit: number, signal: AbortSignal): Promise<WorkoutEntry[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Invalid pending limit');
    const request = bindOwner(databaseReadRequest(this.pool), this.owner).input('take', sql.Int, limit);
    return (await run(request, selectPending, signal)).recordset.map(decode);
  }

  async markVaultSynced(id: string, revision: number, signal: AbortSignal): Promise<void> {
    await run(bindOwner(databaseReadRequest(this.pool), this.owner)
      .input('id', sql.UniqueIdentifier, id).input('revision', sql.BigInt, revision), markSyncedCommand, signal);
  }
}

export type WorkoutEntriesAccess = (request: FastifyRequest) => Pick<WorkoutEntriesStore, 'history' | 'create' | 'update' | 'delete'>;
