import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import { proactiveSettingsFromRow, type ProactiveSettingsRow } from './proactive-store.js';
import { defaultProactiveSettings } from '../proactive/store.js';
import { proactiveSettingsRevision } from '../proactive/preferences.js';
import {
  PI_SITUATION_SCHEMA_VERSION,
  canonicalizePiSituationState,
  freshnessFor,
  parsePiSituationState,
  piSituationHash,
  sanitizeLegacyPiSituationState,
  sourceRefsFor,
  staleReasonsFor,
  PiSituationError,
  type PiActivationType,
  type PiSituationRecord,
  type PiSituationStore,
  type PiSituationAuthorityRef,
  type PiSituationSourceObservation,
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

interface AuthorityRow {
  receipt_id: string;
  source_id: PiSituationAuthorityRef['source'];
  ref_id: string;
  provider_identity: string;
  label: string;
  observed_at: Date | string;
  expires_at: Date | string | null;
  material_hash: string | null;
  verified_at: Date | string;
  activated_at: Date | string | null;
  invalidated_at: Date | string | null;
  stale_reason: string | null;
}

const date = (value: Date | string): Date => value instanceof Date ? value : new Date(value);

function authorityRef(row: AuthorityRow): PiSituationAuthorityRef {
  return {
    id: row.ref_id,
    source: row.source_id,
    identity: row.provider_identity,
    label: row.label,
    observedAt: date(row.observed_at).toISOString(),
    expiresAt: row.expires_at ? date(row.expires_at).toISOString() : null,
    ...(row.material_hash ? { materialHash: row.material_hash.trim() } : {}),
    verifiedAt: date(row.verified_at).toISOString(),
    receiptId: row.receipt_id.toLowerCase(),
    activatedAt: row.activated_at ? date(row.activated_at).toISOString() : null,
    invalidatedAt: row.invalidated_at ? date(row.invalidated_at).toISOString() : null,
    staleReason: row.stale_reason,
  };
}

function authorityKey(
  ref: Pick<PiSituationAuthorityRef, 'source' | 'id' | 'verifiedAt' | 'materialHash'>,
): string {
  return `${ref.source}\u0000${ref.id}\u0000${ref.verifiedAt}\u0000${ref.materialHash ?? ''}`;
}

function decodeRow(row: SituationRow, authoritativeRefs: readonly PiSituationAuthorityRef[]): {
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
      authoritativeRefs: decoded.state.refs.flatMap((safe) => {
        const current = authoritativeRefs.find((ref) =>
          ref.source === safe.source && ref.id === safe.id);
        return current ? [structuredClone({
          ...current,
          ...safe,
          verifiedAt: safe.verifiedAt ?? current.verifiedAt,
          invalidatedAt: current.invalidatedAt,
          staleReason: current.staleReason,
        })] : [];
      }),
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
  const authoritySelect = `SELECT authority.receipt_id, authority.source_id, authority.ref_id,
      authority.provider_identity,
      authority.label, authority.observed_at, authority.expires_at, authority.material_hash,
      authority.verified_at, authority.activated_at, authority.invalidated_at, authority.stale_reason
    FROM dbo.pi_situation_ref_authority AS authority WITH (UPDLOCK, HOLDLOCK)
    WHERE authority.owner_object_id = @owner`;

  return {
    atomicObservations: true,
    async read(owner, signal) {
      const { recordset } = await query<SituationRow>(
        databaseReadRequest(pool).input('owner', sql.UniqueIdentifier, owner),
        `${select} WHERE owner_object_id=@owner;`,
        signal,
      );
      const row = recordset[0];
      if (!row) return null;
      const initialAuthority = await query<AuthorityRow>(
        databaseReadRequest(pool).input('owner', sql.UniqueIdentifier, owner),
        `${authoritySelect};`,
        signal,
      );
      const decoded = decodeRow(
        row,
        initialAuthority.recordset.map(authorityRef),
      );
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
        const lockedAuthority = await new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, owner)
          .query<AuthorityRow>(authoritySelect);
        const safe = decodeRow(
          current,
          lockedAuthority.recordset.map(authorityRef),
        );
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
        const migratedRecord = decodeRow(
          migratedRow,
          lockedAuthority.recordset.map(authorityRef),
        );
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
          const existingAuthority = await new sql.Request(transaction)
            .input('owner', sql.UniqueIdentifier, owner)
            .query<AuthorityRow>(authoritySelect);
          await transaction.commit();
          return decodeRow(
            current.recordset[0],
            existingAuthority.recordset.map(authorityRef),
          ).record;
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
          authoritativeRefs: [],
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
        const policy = await new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, input.owner)
          .query<ProactiveSettingsRow>(`SELECT paused, monthly_budget_dkk, background_turns_per_day,
              sources_json, categories_json, suggestion_scope, news_feeds_json, guidance
            FROM dbo.proactive_settings WITH (UPDLOCK, HOLDLOCK)
            WHERE owner_object_id=@owner;`);
        const settings = policy.recordset[0]
          ? proactiveSettingsFromRow(policy.recordset[0])
          : defaultProactiveSettings();
        if (proactiveSettingsRevision(settings) !== input.policyRevision) {
          throw new PiSituationError('conflict', 'Proactive policy changed. Read the situation again before committing.');
        }
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
        activeRequest = new sql.Request(transaction).input('owner', sql.UniqueIdentifier, input.owner);
        const storedAuthority = await activeRequest.query<AuthorityRow>(authoritySelect);
        const existingAuthority = storedAuthority.recordset.map(authorityRef);
        const existingByGeneration = new Map(existingAuthority.map((ref) =>
          [authorityKey(ref), ref] as const));
        const sourceInvalidations = await new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, input.owner)
          .query<{
            source_id: PiSituationAuthorityRef['source'];
            state: 'ok' | 'unavailable' | 'stale';
            reason: string | null;
            observed_at: Date | string;
            verified_at: Date | string;
            invalidated_at: Date | string | null;
          }>(`SELECT source_id, state, reason, observed_at, verified_at, invalidated_at
            FROM dbo.proactive_source_status WITH (UPDLOCK, HOLDLOCK)
            WHERE owner_object_id = @owner;`);
        const invalidations = new Map(sourceInvalidations.recordset.map((entry) =>
          [entry.source_id, entry.invalidated_at ? date(entry.invalidated_at).getTime() : null]));
        const guardedObservations = new Map<string, {
          source: PiSituationSourceObservation['source'];
          verifiedAt: string;
        }>();
        const guardObservation = (observation: {
          source: PiSituationSourceObservation['source'];
          verifiedAt: string;
        }) => {
          const previous = guardedObservations.get(observation.source);
          if (!previous ||
              Date.parse(observation.verifiedAt) > Date.parse(previous.verifiedAt)) {
            guardedObservations.set(observation.source, observation);
          }
        };
        for (const observation of input.observations) guardObservation(observation);
        for (const ref of input.authoritativeRefs) {
          guardObservation({ source: ref.source, verifiedAt: ref.verifiedAt });
        }
        for (const ref of input.state.refs) {
          if (ref.verifiedAt) {
            const receipt = existingByGeneration.get(authorityKey({
              source: ref.source,
              id: ref.id,
              verifiedAt: ref.verifiedAt,
              materialHash: ref.materialHash,
            }));
            if (receipt?.activatedAt === null && receipt.invalidatedAt === null) {
              guardObservation({ source: ref.source, verifiedAt: ref.verifiedAt });
            }
          }
        }
        for (const observation of guardedObservations.values()) {
          const guard = await new sql.Request(transaction)
            .input('owner', sql.UniqueIdentifier, input.owner)
            .input('source', sql.NVarChar(16), observation.source)
            .input('verifiedAt', sql.DateTime2, new Date(observation.verifiedAt))
            .input('enabled', sql.Bit, settings.sources[observation.source])
            .query<{ accepted: boolean }>(`DECLARE @current datetime2(7);
              DECLARE @invalidated datetime2(7);
              SELECT @current = verified_at, @invalidated = invalidated_at
                FROM dbo.proactive_source_status WITH (UPDLOCK, HOLDLOCK)
                WHERE owner_object_id = @owner AND source_id = @source;
              SELECT CONVERT(bit, CASE
                WHEN @enabled = 1
                  AND (@current IS NULL OR @verifiedAt >= @current)
                  AND (@invalidated IS NULL OR @verifiedAt > @invalidated)
                  THEN 1 ELSE 0 END) AS accepted;`);
          if (!guard.recordset[0]?.accepted) {
            throw new PiSituationError(
              'conflict',
              'The source generation is no longer admissible for this situation commit.',
            );
          }
        }
        const activation = input.activation;
        const updatedAt = activation?.at ?? new Date(input.state.asOf);
        for (const ref of input.authoritativeRefs) {
          if (ref.activatedAt === null) {
            throw new PiSituationError(
              'invalid',
              'Provider authority supplied to a state commit must be an activated observation.',
            );
          }
          const invalidatedAt = invalidations.get(ref.source);
          if (!settings.sources[ref.source]) {
            throw new PiSituationError('conflict', 'A source became disabled before its observation was committed.');
          }
          if (invalidatedAt !== null && invalidatedAt !== undefined &&
              Date.parse(ref.verifiedAt) <= invalidatedAt) {
            throw new PiSituationError(
              'conflict',
              'A provider verification is not newer than the persisted source-disable epoch.',
            );
          }
          const priorActive = existingAuthority.find((entry) =>
            entry.source === ref.source &&
            entry.id === ref.id &&
            entry.activatedAt !== null &&
            entry.invalidatedAt === null);
          if (priorActive &&
              Date.parse(ref.verifiedAt) < Date.parse(priorActive.verifiedAt)) {
            throw new PiSituationError(
              'conflict',
              'The provider observation is older than the active reference generation.',
            );
          }
          if (priorActive &&
              Date.parse(ref.verifiedAt) === Date.parse(priorActive.verifiedAt) &&
              ((priorActive.materialHash ?? null) !== (ref.materialHash ?? null) ||
                priorActive.identity !== ref.identity)) {
            throw new PiSituationError(
              'conflict',
              'The source emitted different material for an already accepted verification generation.',
            );
          }
          const materialChanged = priorActive !== undefined &&
            ((priorActive.materialHash ?? null) !== (ref.materialHash ?? null) ||
              priorActive.identity !== ref.identity);
          activeRequest = new sql.Request(transaction)
            .input('receiptId', sql.UniqueIdentifier, randomUUID())
            .input('priorReceipt', sql.UniqueIdentifier, priorActive?.receiptId ?? randomUUID())
            .input('owner', sql.UniqueIdentifier, input.owner)
            .input('source', sql.NVarChar(16), ref.source)
            .input('ref', sql.NVarChar(120), ref.id)
            .input('identity', sql.NVarChar(240), ref.identity)
            .input('label', sql.NVarChar(160), ref.label)
            .input('observedAt', sql.DateTime2, new Date(ref.observedAt))
            .input('expiresAt', sql.DateTime2, ref.expiresAt ? new Date(ref.expiresAt) : null)
            .input('materialHash', sql.Char(64), ref.materialHash ?? null)
            .input('verifiedAt', sql.DateTime2, new Date(ref.verifiedAt))
            .input('activatedAt', sql.DateTime2, ref.activatedAt ? new Date(ref.activatedAt) : null);
          if (materialChanged) {
            await activeRequest.query(`UPDATE dbo.pi_situation_ref_authority
              SET invalidated_at = @verifiedAt,
                stale_reason = N'superseded_by_material_change'
              WHERE owner_object_id = @owner AND receipt_id = @priorReceipt
                AND activated_at IS NOT NULL AND invalidated_at IS NULL;

              INSERT dbo.pi_situation_ref_authority (
                receipt_id, owner_object_id, source_id, ref_id, provider_identity, label,
                observed_at, expires_at, material_hash, verified_at,
                activated_at, invalidated_at, stale_reason
              ) VALUES (
                @receiptId, @owner, @source, @ref, @identity, @label,
                @observedAt, @expiresAt, @materialHash, @verifiedAt,
                @activatedAt, NULL, NULL
              );

              UPDATE dbo.pi_situation_ref_authority
                SET invalidated_at = @verifiedAt,
                  stale_reason = N'superseded_by_provider_observation'
                WHERE owner_object_id = @owner
                  AND source_id = @source AND ref_id = @ref
                  AND verified_at = @verifiedAt
                  AND ((material_hash = @materialHash)
                    OR (material_hash IS NULL AND @materialHash IS NULL))
                  AND activated_at IS NULL
                  AND invalidated_at IS NULL;`);
            continue;
          }
          await activeRequest.query(`MERGE dbo.pi_situation_ref_authority WITH (HOLDLOCK) AS target
            USING (SELECT @owner AS owner_object_id,
              @source COLLATE Latin1_General_100_BIN2 AS source_id,
              @ref COLLATE Latin1_General_100_BIN2 AS ref_id) AS source
            ON target.owner_object_id = source.owner_object_id
              AND target.source_id = source.source_id
              AND target.ref_id = source.ref_id
              AND target.activated_at IS NOT NULL
              AND target.invalidated_at IS NULL
                    WHEN MATCHED AND @verifiedAt >= target.verified_at THEN UPDATE SET
              provider_identity = @identity, label = @label, observed_at = @observedAt,
              expires_at = @expiresAt, material_hash = @materialHash, verified_at = @verifiedAt,
              activated_at = @activatedAt,
              stale_reason = NULL
            WHEN NOT MATCHED THEN INSERT (
              receipt_id, owner_object_id, source_id, ref_id, provider_identity, label,
              observed_at, expires_at, material_hash, verified_at,
              activated_at, invalidated_at, stale_reason
            ) VALUES (
              @receiptId, @owner, @source, @ref, @identity, @label,
              @observedAt, @expiresAt, @materialHash, @verifiedAt,
              @activatedAt, NULL, NULL
            );
            UPDATE dbo.pi_situation_ref_authority
              SET invalidated_at = @verifiedAt,
                stale_reason = N'superseded_by_provider_observation'
              WHERE owner_object_id = @owner
                AND source_id = @source AND ref_id = @ref
                AND verified_at = @verifiedAt
                AND ((material_hash = @materialHash)
                  OR (material_hash IS NULL AND @materialHash IS NULL))
                AND activated_at IS NULL
                AND invalidated_at IS NULL;`);
        }
        activeRequest = new sql.Request(transaction).input('owner', sql.UniqueIdentifier, input.owner);
        const refreshedAuthority = await activeRequest.query<AuthorityRow>(authoritySelect);
        let authoritativeRefs = refreshedAuthority.recordset.map(authorityRef);
        const authority = new Map(authoritativeRefs.map((ref) =>
          [authorityKey(ref), ref] as const));
        let state = canonicalizePiSituationState(
          input.state,
          authoritativeRefs,
          input.observations.length > 0,
        );
        for (const ref of state.refs) {
          const receipt = ref.verifiedAt
            ? authority.get(authorityKey({
              source: ref.source,
              id: ref.id,
              verifiedAt: ref.verifiedAt,
              materialHash: ref.materialHash,
            }))
            : undefined;
          if (!receipt || receipt.activatedAt !== null || receipt.invalidatedAt !== null) {
            continue;
          }
          activeRequest = new sql.Request(transaction)
            .input('owner', sql.UniqueIdentifier, input.owner)
            .input('source', sql.NVarChar(16), receipt.source)
            .input('ref', sql.NVarChar(120), receipt.id)
            .input('receipt', sql.UniqueIdentifier, receipt.receiptId!)
            .input('activatedAt', sql.DateTime2, updatedAt)
            .input('staleAt', sql.DateTime2, new Date(receipt.verifiedAt));
          const activated = await activeRequest.query(`UPDATE dbo.pi_situation_ref_authority
              SET invalidated_at = @staleAt,
                stale_reason = N'superseded_by_committed_lookup'
              WHERE owner_object_id = @owner
                AND source_id = @source AND ref_id = @ref
                AND activated_at IS NOT NULL AND invalidated_at IS NULL
                AND receipt_id <> @receipt;

            UPDATE dbo.pi_situation_ref_authority
              SET activated_at = @activatedAt
              WHERE owner_object_id = @owner AND receipt_id = @receipt
                AND activated_at IS NULL AND invalidated_at IS NULL;`);
          if ((activated.rowsAffected[1] ?? 0) !== 1) {
            throw new PiSituationError(
              'conflict',
              'The exact lookup receipt was consumed or invalidated before the situation commit.',
            );
          }
        }
        const activatedAuthority = await new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, input.owner)
          .query<AuthorityRow>(authoritySelect);
        authoritativeRefs = activatedAuthority.recordset.map(authorityRef);
        const observations = new Map<string, {
          source: PiSituationSourceObservation['source'];
          state: PiSituationSourceObservation['state'];
          reason: string | null;
          observedAt: string | null;
          verifiedAt: string;
        }>();
        for (const observation of input.observations) {
          const previous = observations.get(observation.source);
          if (!previous || Date.parse(observation.verifiedAt) >= Date.parse(previous.verifiedAt)) {
            observations.set(observation.source, { ...observation });
          }
        }
        for (const ref of input.authoritativeRefs) {
          const previous = observations.get(ref.source);
          if (!previous || Date.parse(ref.verifiedAt) >= Date.parse(previous.verifiedAt)) {
            observations.set(ref.source, {
              source: ref.source,
              state: 'ok',
              reason: null,
              observedAt: ref.observedAt,
              verifiedAt: ref.verifiedAt,
            });
          }
        }
        for (const ref of state.refs) {
          const receipt = ref.verifiedAt
            ? authority.get(authorityKey({
              source: ref.source,
              id: ref.id,
              verifiedAt: ref.verifiedAt,
              materialHash: ref.materialHash,
            }))
            : undefined;
          if (!receipt || receipt.activatedAt !== null ||
              receipt.invalidatedAt !== null) continue;
          const previous = observations.get(ref.source);
          if (!previous || Date.parse(receipt.verifiedAt) > Date.parse(previous.verifiedAt)) {
            observations.set(ref.source, {
              source: ref.source,
              state: 'ok',
              reason: null,
              observedAt: receipt.observedAt,
              verifiedAt: receipt.verifiedAt,
            });
          }
        }
        const effectiveObservations = new Map<string, {
          source: PiSituationSourceObservation['source'];
          state: PiSituationSourceObservation['state'];
          reason: string | null;
          observedAt: string | null;
          verifiedAt: string;
        }>();
        for (const observation of observations.values()) {
          if (!settings.sources[observation.source]) continue;
          const invalidatedAt = invalidations.get(observation.source);
          const admissible = invalidatedAt === null || invalidatedAt === undefined ||
            Date.parse(observation.verifiedAt) > invalidatedAt;
          const effective = {
            ...observation,
            state: admissible ? observation.state : 'stale' as const,
            reason: admissible
              ? observation.reason
              : 'observation_not_newer_than_source_invalidation',
          };
          effectiveObservations.set(observation.source, effective);
          if (effective.state !== 'ok') {
            activeRequest = new sql.Request(transaction)
              .input('owner', sql.UniqueIdentifier, input.owner)
              .input('source', sql.NVarChar(16), observation.source)
              .input('invalidatedAt', sql.DateTime2, new Date(observation.verifiedAt))
              .input('staleReason', sql.NVarChar(160),
                effective.reason ?? 'source_unavailable');
            await activeRequest.query(`UPDATE dbo.pi_situation_ref_authority
              SET invalidated_at = @invalidatedAt,
                stale_reason = @staleReason
              WHERE owner_object_id = @owner
                AND source_id = @source
                AND activated_at IS NOT NULL
                AND invalidated_at IS NULL;`);
          }
          activeRequest = new sql.Request(transaction)
            .input('owner', sql.UniqueIdentifier, input.owner)
            .input('source', sql.NVarChar(16), observation.source)
            .input('state', sql.NVarChar(16), effective.state)
            .input('reason', sql.NVarChar(160), effective.reason)
            .input('observedAt', sql.DateTime2, observation.observedAt
              ? new Date(observation.observedAt)
              : null)
            .input('verifiedAt', sql.DateTime2, new Date(observation.verifiedAt));
          await activeRequest.query(`MERGE dbo.proactive_source_status WITH (HOLDLOCK) AS target
            USING (SELECT @owner AS owner_object_id, @source AS source_id) AS source
            ON target.owner_object_id = source.owner_object_id
              AND target.source_id = source.source_id
            WHEN MATCHED AND @verifiedAt >= target.verified_at THEN UPDATE SET
              state = @state, reason = @reason,
              observed_at = COALESCE(@observedAt, target.observed_at),
              verified_at = @verifiedAt
            WHEN NOT MATCHED THEN INSERT (
              owner_object_id, source_id, state, reason, observed_at, verified_at
            ) VALUES (
              @owner, @source, @state, @reason,
              COALESCE(@observedAt, @verifiedAt), @verifiedAt
            );`);
        }
        state = parsePiSituationState({
          ...state,
          sources: state.sources.map((source) => {
            const observation = effectiveObservations.get(source.id);
            if (!observation) return source;
            return {
              ...source,
              state: observation.state === 'ok'
                ? 'fresh' as const
                : observation.state === 'unavailable' ? 'missing' as const : 'stale' as const,
              observedAt: observation.observedAt ?? source.observedAt,
              verifiedAt: observation.verifiedAt,
              reason: observation.reason,
            };
          }),
        });
        const revision = input.expectedRevision + 1;
        const stateJson = JSON.stringify(state);
        const hash = piSituationHash(state);
        const request = new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, input.owner)
          .input('schema', sql.SmallInt, PI_SITUATION_SCHEMA_VERSION)
          .input('revision', sql.BigInt, revision)
          .input('expected', sql.BigInt, input.expectedRevision)
          .input('state', sql.NVarChar(sql.MAX), stateJson)
          .input('hash', sql.Char(64), hash)
          .input('refs', sql.NVarChar(sql.MAX), JSON.stringify(sourceRefsFor(state)))
          .input('freshness', sql.NVarChar(sql.MAX), JSON.stringify(freshnessFor(state)))
          .input('reasons', sql.NVarChar(sql.MAX), JSON.stringify(staleReasonsFor(state)))
          .input('activationId', sql.UniqueIdentifier, activation?.id ?? null)
          .input('activationType', sql.VarChar(10), activation?.type ?? null)
          .input('activationSource', sql.NVarChar(64), activation?.source ?? null)
          .input('asOf', sql.DateTime2, new Date(state.asOf))
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
        activeRequest = new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, input.owner)
          .input('revision', sql.BigInt, revision)
          .input('actions', sql.NVarChar(sql.MAX), JSON.stringify(input.followUpActions))
          .input('createdAt', sql.DateTime2, updatedAt);
        await activeRequest.query(`INSERT dbo.pi_situation_outbox (
            owner_object_id, situation_revision, actions_json, created_at
          ) VALUES (@owner, @revision, @actions, @createdAt);`);
        activeRequest = new sql.Request(transaction).input('owner', sql.UniqueIdentifier, input.owner);
        const finalAuthority = await activeRequest.query<AuthorityRow>(authoritySelect);
        authoritativeRefs = finalAuthority.recordset.map(authorityRef);
        activeRequest = undefined;
        await transaction.commit();
        return {
          owner: input.owner.toLowerCase(),
          revision,
          state: structuredClone(state),
          hash,
          asOf: new Date(state.asOf),
          updatedAt,
          authoritativeRefs,
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
    async recordLookupAuthority(owner, ref, policyRevision, signal) {
      signal.throwIfAborted();
      const transaction = new sql.Transaction(pool);
      let activeRequest: sql.Request | undefined;
      const cancel = () => activeRequest?.cancel();
      signal.addEventListener('abort', cancel, { once: true });
      try {
        await transaction.begin();
        activeRequest = new sql.Request(transaction).input('owner', sql.UniqueIdentifier, owner);
        const policy = await activeRequest.query<ProactiveSettingsRow>(
          `SELECT paused, monthly_budget_dkk, background_turns_per_day,
              sources_json, categories_json, suggestion_scope, news_feeds_json, guidance
            FROM dbo.proactive_settings WITH (UPDLOCK, HOLDLOCK)
            WHERE owner_object_id = @owner;`,
        );
        const settings = policy.recordset[0]
          ? proactiveSettingsFromRow(policy.recordset[0])
          : defaultProactiveSettings();
        if (!settings.sources[ref.source] || proactiveSettingsRevision(settings) !== policyRevision) {
          throw new PiSituationError(
            'conflict',
            'Proactive source policy changed before the live lookup receipt could be accepted.',
          );
        }
        activeRequest = new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, owner)
          .input('source', sql.NVarChar(16), ref.source);
        const status = await activeRequest.query<{
          verified_at: Date | string;
          invalidated_at: Date | string | null;
        }>(
          `SELECT verified_at, invalidated_at
            FROM dbo.proactive_source_status WITH (UPDLOCK, HOLDLOCK)
            WHERE owner_object_id = @owner AND source_id = @source;`,
        );
        const invalidatedAt = status.recordset[0]?.invalidated_at
          ? date(status.recordset[0].invalidated_at).getTime()
          : null;
        if (invalidatedAt !== null && Date.parse(ref.verifiedAt) <= invalidatedAt) {
          throw new PiSituationError(
            'invalid',
            'The live provider verification is not newer than the persisted source-disable epoch.',
          );
        }
        if (status.recordset[0] &&
            date(status.recordset[0].verified_at).getTime() > Date.parse(ref.verifiedAt)) {
          throw new PiSituationError(
            'conflict',
            'The provider verification is older than the current source generation.',
          );
        }
        activeRequest = new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, owner)
          .input('source', sql.NVarChar(16), ref.source)
          .input('ref', sql.NVarChar(120), ref.id);
        const existingAuthority = await activeRequest.query<{
          provider_identity: string;
          material_hash: string | null;
          verified_at: Date | string;
        }>(`
          SELECT provider_identity, material_hash, verified_at
          FROM dbo.pi_situation_ref_authority WITH (UPDLOCK, HOLDLOCK)
          WHERE owner_object_id = @owner
            AND source_id COLLATE Latin1_General_100_BIN2 =
              @source COLLATE Latin1_General_100_BIN2
            AND ref_id COLLATE Latin1_General_100_BIN2 =
              @ref COLLATE Latin1_General_100_BIN2
            AND activated_at IS NOT NULL
            AND invalidated_at IS NULL;`);
        const active = existingAuthority.recordset[0];
        if (active) {
          const currentVerifiedAt = date(active.verified_at).getTime();
          if (currentVerifiedAt > Date.parse(ref.verifiedAt)) {
            throw new PiSituationError(
              'conflict',
              'The provider verification is older than its current reference receipt.',
            );
          }
          if (currentVerifiedAt === Date.parse(ref.verifiedAt) &&
              active.provider_identity === ref.identity &&
              (active.material_hash?.trim() ?? null) === (ref.materialHash ?? null)) {
            await transaction.commit();
            return;
          }
        }
        activeRequest = new sql.Request(transaction)
          .input('receiptId', sql.UniqueIdentifier, randomUUID())
          .input('owner', sql.UniqueIdentifier, owner)
          .input('source', sql.NVarChar(16), ref.source)
          .input('ref', sql.NVarChar(120), ref.id)
          .input('identity', sql.NVarChar(240), ref.identity)
          .input('label', sql.NVarChar(160), ref.label)
          .input('observedAt', sql.DateTime2, new Date(ref.observedAt))
          .input('expiresAt', sql.DateTime2, ref.expiresAt ? new Date(ref.expiresAt) : null)
          .input('materialHash', sql.Char(64), ref.materialHash ?? null)
          .input('verifiedAt', sql.DateTime2, new Date(ref.verifiedAt));
        await activeRequest.query(`MERGE dbo.pi_situation_ref_authority WITH (HOLDLOCK) AS target
          USING (SELECT @owner AS owner_object_id,
          @source COLLATE Latin1_General_100_BIN2 AS source_id,
          @ref COLLATE Latin1_General_100_BIN2 AS ref_id) AS source
          ON target.owner_object_id = source.owner_object_id
          AND target.source_id = source.source_id
          AND target.ref_id = source.ref_id
          AND target.verified_at = @verifiedAt
          AND ((target.material_hash = @materialHash)
            OR (target.material_hash IS NULL AND @materialHash IS NULL))
          AND target.activated_at IS NULL
          AND target.invalidated_at IS NULL
          WHEN NOT MATCHED THEN INSERT (
          receipt_id, owner_object_id, source_id, ref_id, provider_identity, label,
          observed_at, expires_at, material_hash, verified_at,
          activated_at, invalidated_at, stale_reason
          ) VALUES (
          @receiptId, @owner, @source, @ref, @identity, @label,
          @observedAt, @expiresAt, @materialHash, @verifiedAt,
          NULL, NULL, NULL
          );`);
        await transaction.commit();
      } catch (error) {
        try { await transaction.rollback(); } catch { /* Preserve the authority receipt failure. */ }
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
