import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import {
  PI_SITUATION_SCHEMA_VERSION,
  freshnessFor,
  parsePiSituationState,
  piSituationHash,
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

function toRecord(row: SituationRow): PiSituationRecord {
  let state: ReturnType<typeof parsePiSituationState>;
  try {
    state = parsePiSituationState(JSON.parse(row.state_json));
  } catch (error) {
    if (error instanceof PiSituationError) {
      throw new PiSituationError('unavailable', 'The stored PI situational state is invalid. No replacement was invented.');
    }
    throw error;
  }
  if (row.schema_version !== PI_SITUATION_SCHEMA_VERSION || row.content_hash.trim() !== piSituationHash(state)) {
    throw new PiSituationError('unavailable', 'The stored PI situational state hash is invalid. No replacement was invented.');
  }
  return {
    owner: row.owner_object_id.toLowerCase(),
    revision: Number(row.revision),
    state,
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
      return recordset[0] ? toRecord(recordset[0]) : null;
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
          .input('activationId', sql.UniqueIdentifier, input.activation.id)
          .input('activationType', sql.VarChar(10), input.activation.type)
          .input('activationSource', sql.NVarChar(64), input.activation.source)
          .input('asOf', sql.DateTime2, new Date(input.state.asOf))
          .input('updated', sql.DateTime2, input.activation.at);
        if (row) {
          activeRequest = request;
          const updated = await request.query(`UPDATE dbo.pi_situational_state
            SET schema_version=@schema, revision=@revision, state_json=@state, content_hash=@hash,
              source_refs_json=@refs, freshness_json=@freshness, stale_reasons_json=@reasons,
              last_activation_id=@activationId, last_activation_type=@activationType,
              last_activation_source=@activationSource, last_activation_at=@updated,
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
              @activationId, @activationType, @activationSource, @updated, @asOf, @updated
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
          updatedAt: input.activation.at,
          lastActivation: {
            id: input.activation.id,
            type: input.activation.type,
            source: input.activation.source,
            at: input.activation.at,
          },
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
