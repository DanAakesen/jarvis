import sql from 'mssql';
import type { FastifyRequest } from 'fastify';
import { ToolFailure } from '../../core/tool-registry.js';
import { databaseReadRequest } from '../../database/wake-retry.js';
import { resolveDailyOwner } from '../owner.js';
import {
  emptyNutritionTargets, nutritionTargetFields, nutritionTargetKey, parseNutritionTargetsPatch, parseStoredNutritionTarget,
  type NutritionTargetField, type NutritionTargetsPatch, type StoredNutritionTargets,
} from './targets.js';

interface StoredRow { key: string; value: string; updated_at: Date | string | null }

const selectTargets = 'SELECT [key], value, updated_at FROM dbo.settings WHERE scope = @scope AND [key] IN (@key0, @key1, @key2);';
const saveTarget = `MERGE dbo.settings WITH (HOLDLOCK) AS target
  USING (SELECT @scope AS scope, @key AS [key], @value AS value) AS source
  ON target.scope = source.scope AND target.[key] = source.[key]
  WHEN MATCHED THEN UPDATE SET value = source.value, updated_at = SYSUTCDATETIME()
  WHEN NOT MATCHED THEN INSERT (scope, [key], value) VALUES (source.scope, source.[key], source.value);`;
const clearTarget = 'DELETE FROM dbo.settings WHERE scope = @scope AND [key] = @key;';

async function run(request: sql.Request, command: string, signal: AbortSignal) {
  const cancel = () => { request.cancel(); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    return await request.query<StoredRow>(command);
  } finally { signal.removeEventListener('abort', cancel); }
}

/**
 * The owner's three nutrition targets as Daily-owned rows in the existing `dbo.settings` table (scope
 * global, owner-namespaced keys). No migration, no change to the released core settings, and nothing
 * is read or written unless Daily is composed. A cleared target is a deleted row, so "unset" is explicit.
 */
export class NutritionTargetsStore {
  private constructor(private readonly pool: sql.ConnectionPool, private readonly owner: string) {}

  static forRequest(pool: sql.ConnectionPool, request: FastifyRequest): NutritionTargetsStore {
    const owner = resolveDailyOwner(request);
    nutritionTargetKey(owner, 'restingKcal');
    return new NutritionTargetsStore(pool, owner);
  }

  private keyed(request: sql.Request): sql.Request {
    request.input('scope', sql.NVarChar(64), 'global');
    nutritionTargetFields.forEach((field, index) => {
      request.input(`key${index}`, sql.NVarChar(128), nutritionTargetKey(this.owner, field));
    });
    return request;
  }

  private decode(rows: readonly StoredRow[]): StoredNutritionTargets {
    const targets: Record<NutritionTargetField, number | null> = { ...emptyNutritionTargets };
    let latest = Number.NEGATIVE_INFINITY;
    for (const field of nutritionTargetFields) {
      const key = nutritionTargetKey(this.owner, field);
      const row = rows.find((candidate) => candidate.key === key);
      const value = row ? parseStoredNutritionTarget(field, row.value) : null;
      targets[field] = value;
      if (value === null) continue;
      const stamp = row?.updated_at instanceof Date ? row.updated_at.getTime()
        : typeof row?.updated_at === 'string' ? Date.parse(row.updated_at) : Number.NaN;
      if (Number.isFinite(stamp) && stamp > latest) latest = stamp;
    }
    return { targets, updatedAt: Number.isFinite(latest) ? new Date(latest).toISOString() : null };
  }

  async read(signal: AbortSignal): Promise<StoredNutritionTargets> {
    signal.throwIfAborted();
    try {
      const result = await run(this.keyed(databaseReadRequest(this.pool)), selectTargets, signal);
      return this.decode(result.recordset);
    } catch {
      if (signal.aborted) throw signal.reason;
      throw new ToolFailure('Nutrition targets are unavailable.');
    }
  }

  /** Applies only the named targets (null deletes one) in one transaction and returns what is stored, read before commit. */
  async write(patch: NutritionTargetsPatch, signal: AbortSignal): Promise<StoredNutritionTargets> {
    signal.throwIfAborted();
    const checked = parseNutritionTargetsPatch(patch);
    if (!checked.ok) throw new TypeError('A nutrition-target change must name valid targets');
    const entries = nutritionTargetFields.flatMap((field) => {
      const value = checked.patch[field];
      return value === undefined ? [] : [[field, value] as const];
    });
    const transaction = new sql.Transaction(this.pool);
    try {
      await transaction.begin();
      for (const [field, value] of entries) {
        const request = transaction.request()
          .input('scope', sql.NVarChar(64), 'global')
          .input('key', sql.NVarChar(128), nutritionTargetKey(this.owner, field));
        if (value === null) await run(request, clearTarget, signal);
        else await run(request.input('value', sql.NVarChar(sql.MAX), JSON.stringify(value)), saveTarget, signal);
      }
      const stored = this.decode((await run(this.keyed(transaction.request()), selectTargets, signal)).recordset);
      signal.throwIfAborted();
      await transaction.commit();
      return stored;
    } catch {
      try { await transaction.rollback(); } catch { /* Preserve the sanitized failure. */ }
      if (signal.aborted) throw signal.reason;
      throw new ToolFailure('Nutrition targets could not be saved. Read them to check the current values before retrying.');
    }
  }
}

export type NutritionTargetsAccess = (request: FastifyRequest) => Pick<NutritionTargetsStore, 'read' | 'write'>;
