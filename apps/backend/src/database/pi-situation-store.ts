import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import {
  PI_SITUATION_SCHEMA_VERSION,
  freshnessFor,
  piSituationHash,
  sanitizeLegacyPiSituationState,
  sourceRefsFor,
  staleReasonsFor,
  PiSituationError,
  type PiActivationType,
  type PiSituationRecord,
  type PiSituationStore,
} from '../pi/situation.js';

interface SituationRow {
  owner_object_id: string;
  schema_version: number;
  revision: string | number;
  state_json: string;
  content_hash: string;
  last_activation_id: string | null;
  last_activation_type: PiActivationType | null;
  last_activation_source: string | null;
  last_activation_at: Date | string | null;
  as_of_at: Date | string;
  updated_at: Date | string;
}

const date = (value: Date | string): Date => value instanceof Date ? value : new Date(value);

function decodeRow(row: SituationRow): {
  readonly record: PiSituationRecord;
  readonly originalState: PiSituationRecord['state'];
  readonly changed: boolean;
} {
  let decoded: ReturnType<typeof sanitizeLegacyPiSituationState>;
  try {
    decoded = sanitizeLegacyPiSituationState(JSON.parse(row.state_json));
  } catch (error) {
    if (error instanceof PiSituationError) {
      throw new PiSituationError('unavailable', 'The stored PI situational state is invalid. No replacement was invented.');
    }
    throw error;
  }
  if (row.schema_version !== PI_SITUATION_SCHEMA_VERSION ||
      row.content_hash.trim() !== piSituationHash(decoded.original)) {
    throw new PiSituationError('unavailable', 'The stored PI situational state hash is invalid. No replacement was invented.');
  }
  return {
    record: {
      owner: row.owner_object_id.toLowerCase(),
      revision: Number(row.revision),
      state: decoded.state,
      hash: row.content_hash.trim(),
      asOf: date(row.as_of_at),
      updatedAt: date(row.updated_at),
      lastActivation: row.last_activation_id && row.last_activation_type && row.last_activation_at
        ? {
          id: row.last_activation_id.toLowerCase(),
          type: row.last_activation_type,
          source: row.last_activation_source,
          at: date(row.last_activation_at),
        }
        : null,
    },
    originalState: decoded.original,
    changed: decoded.changed,
  };
}

async function query<T>(request: sql.Request, statement: string, signal: AbortSignal): Promise<sql.IResult<T>> {
  signal.throwIfAborted();
  const cancel = () => request.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try { return await request.query<T>(statement); }
  finally { signal.removeEventListener('abort', cancel); }
}

/** Bounded, owner-scoped situational state. The row is revision checked; provider conversation state is never used. */
export function createPiSituationStore(pool: sql.ConnectionPool): PiSituationStore {
  const select = `SELECT owner_object_id, schema_version, revision, state_json, content_hash,
    last_activation_id, last_activation_type, last_activation_source, last_activation_at,
    as_of_at, updated_at FROM dbo.pi_situational_state`;

  return {
    async read(owner, signal) {
      const { recordset } = await query<SituationRow>(
        databaseReadRequest(pool).input('owner', sql.UniqueIdentifier, owner),
        `${select} WHERE owner_object_id=@owner;`,
        signal,
      );
      const row = recordset[0];
      if (!row) return null;
      const decoded = decodeRow(row);
      if (!decoded.changed) return decoded.record;

      signal.throwIfAborted();
      const transaction = new sql.Transaction(pool);
      let activeRequest: sql.Request | undefined;
      const cancel = () => activeRequest?.cancel();
      signal.addEventListener('abort', cancel, { once: true });
      try {
        await transaction.begin();
        activeRequest = new sql.Request(transaction);
        const locked = await activeRequest
          .input('owner', sql.UniqueIdentifier, owner)
          .query<SituationRow>(`${select}
            WITH (UPDLOCK, HOLDLOCK) WHERE owner_object_id=@owner;`);
        activeRequest = undefined;
        const current = locked.recordset[0];
        if (!current) {
          await transaction.commit();
          return null;
        }
        const safe = decodeRow(current);
        const safeHash = piSituationHash(safe.record.state);
        if (!safe.changed) {
          await transaction.commit();
          return safe.record;
        }
        const revision = safe.record.revision + 1;
        const migratedAt = new Date();
        const request = new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, owner)
          .input('expectedRevision', sql.BigInt, safe.record.revision)
          .input('expectedHash', sql.Char(64), current.content_hash.trim())
          .input('revision', sql.BigInt, revision)
          .input('state', sql.NVarChar(sql.MAX), JSON.stringify(safe.record.state))
          .input('hash', sql.Char(64), safeHash)
          .input('refs', sql.NVarChar(sql.MAX), JSON.stringify(sourceRefsFor(safe.record.state)))
          .input('freshness', sql.NVarChar(sql.MAX), JSON.stringify(freshnessFor(safe.record.state)))
          .input('reasons', sql.NVarChar(sql.MAX), JSON.stringify(staleReasonsFor(safe.record.state)))
          .input('updatedAt', sql.DateTime2, migratedAt);
        activeRequest = request;
        const migrated = await request.query<SituationRow>(`UPDATE dbo.pi_situational_state
          SET revision=@revision, state_json=@state, content_hash=@hash,
            source_refs_json=@refs, freshness_json=@freshness, stale_reasons_json=@reasons,
            updated_at=@updatedAt
          OUTPUT INSERTED.owner_object_id, INSERTED.schema_version, INSERTED.revision,
            INSERTED.state_json, INSERTED.content_hash, INSERTED.last_activation_id,
            INSERTED.last_activation_type, INSERTED.last_activation_source,
            INSERTED.last_activation_at, INSERTED.as_of_at, INSERTED.updated_at
          WHERE owner_object_id=@owner
            AND revision=@expectedRevision
            AND content_hash=@expectedHash;`);
        activeRequest = undefined;
        const migratedRow = migrated.recordset[0];
        if (!migratedRow) {
          throw new PiSituationError('conflict', 'Situational state changed during credential migration.');
        }
        const migratedRecord = decodeRow(migratedRow);
        await transaction.commit();
        return migratedRecord.record;
      } catch (error) {
        try { await transaction.rollback(); } catch { /* Preserve migration error. */ }
        throw error;
      } finally {
        signal.removeEventListener('abort', cancel);
      }
    },
    async initialize(owner, state, at, signal) {
      signal.throwIfAborted();
      const transaction = new sql.Transaction(pool);
      let activeRequest: sql.Request | undefined;
      const cancel = () => activeRequest?.cancel();
      signal.addEventListener('abort', cancel, { once: true });
      try {
        await transaction.begin();
        activeRequest = new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, owner);
        const current = await activeRequest.query<SituationRow>(
          `${select} WITH (UPDLOCK, HOLDLOCK) WHERE owner_object_id=@owner;`,
        );
        if (current.recordset[0]) {
          await transaction.commit();
          return decodeRow(current.recordset[0]).record;
        }
        const hash = piSituationHash(state);
        activeRequest = new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, owner)
          .input('schema', sql.SmallInt, PI_SITUATION_SCHEMA_VERSION)
          .input('state', sql.NVarChar(sql.MAX), JSON.stringify(state))
          .input('hash', sql.Char(64), hash)
          .input('refs', sql.NVarChar(sql.MAX), JSON.stringify(sourceRefsFor(state)))
          .input('freshness', sql.NVarChar(sql.MAX), JSON.stringify(freshnessFor(state)))
          .input('reasons', sql.NVarChar(sql.MAX), JSON.stringify(staleReasonsFor(state)))
          .input('asOf', sql.DateTime2, new Date(state.asOf))
          .input('at', sql.DateTime2, at);
        await activeRequest.query(`INSERT dbo.pi_situational_state (
            owner_object_id, schema_version, revision, state_json, content_hash,
            source_refs_json, freshness_json, stale_reasons_json, as_of_at, updated_at
          ) VALUES (
            @owner, @schema, 1, @state, @hash, @refs, @freshness, @reasons, @asOf, @at
          );`);
        await transaction.commit();
        return {
          owner: owner.toLowerCase(),
          revision: 1,
          state: structuredClone(state),
          hash,
          asOf: new Date(state.asOf),
          updatedAt: at,
          lastActivation: null,
        };
      } catch (error) {
        try { await transaction.rollback(); } catch { /* Preserve the initialization error. */ }
        throw error;
      } finally {
        signal.removeEventListener('abort', cancel);
      }
    },
    async commit(input, signal) {
      signal.throwIfAborted();
      const transaction = new sql.Transaction(pool);
      let activeRequest: sql.Request | undefined;
      const cancel = () => activeRequest?.cancel();
      signal.addEventListener('abort', cancel, { once: true });
      try {
        await transaction.begin();
        activeRequest = new sql.Request(transaction);
        const current = await activeRequest
          .input('owner', sql.UniqueIdentifier, input.owner)
          .query<SituationRow & { content_hash: string }>(`${select}
            WITH (UPDLOCK, HOLDLOCK) WHERE owner_object_id=@owner;`);
        activeRequest = undefined;
        const row = current.recordset[0];
        if ((row ? Number(row.revision) : 0) !== input.expectedRevision ||
            row !== undefined && row.content_hash.trim() !== input.expectedHash) {
          throw new PiSituationError('conflict', 'Situational state changed. Read the current revision before committing.');
        }
        const revision = input.expectedRevision + 1;
        const stateJson = JSON.stringify(input.state);
        const hash = piSituationHash(input.state);
        const activation = input.activation;
        const updatedAt = activation?.at ?? new Date(input.state.asOf);
        const request = new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, input.owner)
          .input('schema', sql.SmallInt, PI_SITUATION_SCHEMA_VERSION)
          .input('revision', sql.BigInt, revision)
          .input('expected', sql.BigInt, input.expectedRevision)
          .input('state', sql.NVarChar(sql.MAX), stateJson)
          .input('hash', sql.Char(64), hash)
          .input('refs', sql.NVarChar(sql.MAX), JSON.stringify(sourceRefsFor(input.state)))
          .input('freshness', sql.NVarChar(sql.MAX), JSON.stringify(freshnessFor(input.state)))
          .input('reasons', sql.NVarChar(sql.MAX), JSON.stringify(staleReasonsFor(input.state)))
          .input('activationId', sql.UniqueIdentifier, activation?.id ?? null)
          .input('activationType', sql.VarChar(10), activation?.type ?? null)
          .input('activationSource', sql.NVarChar(64), activation?.source ?? null)
          .input('asOf', sql.DateTime2, new Date(input.state.asOf))
          .input('updated', sql.DateTime2, updatedAt);
        if (row) {
          activeRequest = request;
          const updated = await request.query(`UPDATE dbo.pi_situational_state
            SET schema_version=@schema, revision=@revision, state_json=@state, content_hash=@hash,
              source_refs_json=@refs, freshness_json=@freshness, stale_reasons_json=@reasons,
              last_activation_id=COALESCE(@activationId, last_activation_id),
              last_activation_type=COALESCE(@activationType, last_activation_type),
              last_activation_source=CASE WHEN @activationId IS NULL
                THEN last_activation_source ELSE @activationSource END,
              last_activation_at=CASE WHEN @activationId IS NULL
                THEN last_activation_at ELSE @updated END,
              as_of_at=@asOf, updated_at=@updated
            WHERE owner_object_id=@owner AND revision=@expected;`);
          if (updated.rowsAffected[0] === 0) {
            throw new PiSituationError('conflict', 'Situational state changed. Read the current revision before committing.');
          }
        } else {
          activeRequest = request;
          await request.query(`INSERT dbo.pi_situational_state (
              owner_object_id, schema_version, revision, state_json, content_hash,
              source_refs_json, freshness_json, stale_reasons_json,
              last_activation_id, last_activation_type, last_activation_source,
              last_activation_at, as_of_at, updated_at
            ) VALUES (
              @owner, @schema, @revision, @state, @hash, @refs, @freshness, @reasons,
              @activationId, @activationType, @activationSource,
              CASE WHEN @activationId IS NULL THEN NULL ELSE @updated END, @asOf, @updated
            );`);
        }
        activeRequest = undefined;
        await transaction.commit();
        return {
          owner: input.owner.toLowerCase(),
          revision,
          state: structuredClone(input.state),
          hash,
          asOf: new Date(input.state.asOf),
          updatedAt,
          lastActivation: activation ? {
            id: activation.id,
            type: activation.type,
            source: activation.source,
            at: activation.at,
          } : row?.last_activation_id && row.last_activation_type && row.last_activation_at
            ? {
              id: row.last_activation_id.toLowerCase(),
              type: row.last_activation_type,
              source: row.last_activation_source,
              at: date(row.last_activation_at),
            }
            : null,
        };
      } catch (error) {
        try { await transaction.rollback(); } catch { /* Preserve the commit error. */ }
        throw error;
      } finally {
        signal.removeEventListener('abort', cancel);
      }
    },
    async recordActivation(owner, activation, signal) {
      await query(
        pool.request()
          .input('owner', sql.UniqueIdentifier, owner)
          .input('activationId', sql.UniqueIdentifier, activation.id)
          .input('activationType', sql.VarChar(10), activation.type)
          .input('activationSource', sql.NVarChar(64), activation.source)
          .input('at', sql.DateTime2, activation.at),
        `UPDATE dbo.pi_situational_state
          SET last_activation_id=@activationId, last_activation_type=@activationType,
              last_activation_source=@activationSource, last_activation_at=@at, updated_at=@at
          WHERE owner_object_id=@owner;`,
        signal,
      );
    },
  };
}
