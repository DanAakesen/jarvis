import sql from 'mssql';
import type { FastifyRequest } from 'fastify';
import { healthQuerySources as sources, type HealthSourceId } from '@jarvis/contracts';
import { ownerId, sha256 } from '../health-upload/contracts.js';
import { healthSqlQuery, healthSqlTransaction } from '../health-upload/sql-transaction.js';
import { normalizeHealth } from '../health/normalize.js';
import { validateNormalized, writeNormalized } from '../health/persistence.js';
import { HealthPayloadError } from '../health/value.js';
import { resolveHealthBrowserOwner } from '../owner.js';
import type { HealthChanges } from '../revisions.js';
import { deviceSyncAutomationId, deviceSyncId, deviceSyncPayload, type DeviceSyncBatch } from './device-sync.js';

export interface DeviceSyncResult { status: 'applied' | 'replayed'; id: string; receivedAt: string; counts: Record<string, number> }
export interface DeviceSyncStore { apply(batch: DeviceSyncBatch, signal: AbortSignal): Promise<DeviceSyncResult> }
export type DeviceSyncAccess = (request: FastifyRequest) => DeviceSyncStore;

/** Writes an iPhone batch into the existing Health tables inside one owner-locked transaction. */
export class SqlDeviceSyncStore implements DeviceSyncStore {
  private constructor(private readonly pool: sql.ConnectionPool, private readonly owner: string, private readonly changes: HealthChanges, private readonly now: () => number) {}

  static forRequest(pool: sql.ConnectionPool, request: FastifyRequest, changes: HealthChanges, now: () => number = Date.now): SqlDeviceSyncStore {
    return new SqlDeviceSyncStore(pool, ownerId(resolveHealthBrowserOwner(request)), changes, now);
  }

  async apply(batch: DeviceSyncBatch, signal: AbortSignal): Promise<DeviceSyncResult> {
    const id = deviceSyncId(batch);
    let normalized;
    try {
      normalized = normalizeHealth(deviceSyncPayload(batch));
      validateNormalized(normalized);
    } catch (error) {
      if (error instanceof HealthPayloadError) throw error;
      throw new HealthPayloadError('invalid_payload');
    }
    const received = new Date(this.now());
    const checksum = sha256(id);
    const result = await healthSqlTransaction<DeviceSyncResult>(this.pool, this.owner, signal, async (tx, bounded) => {
      const prior = (await healthSqlQuery(new sql.Request(tx).input('owner', sql.UniqueIdentifier, this.owner)
        .input('automation', sql.NVarChar(256), deviceSyncAutomationId).input('session', sql.NVarChar(256), id),
      'SELECT received_at,normalized_counts_json FROM daily.health_ingestions WHERE owner_object_id=@owner AND automation_id=@automation AND session_id=@session AND status=\'succeeded\';', bounded)).recordset[0];
      if (prior) return { status: 'replayed', id, receivedAt: String(prior.received_at), counts: JSON.parse(String(prior.normalized_counts_json ?? '{}')) as Record<string, number> };
      await writeNormalized(tx, this.owner, id, received, normalized, bounded);
      await healthSqlQuery(new sql.Request(tx).input('owner', sql.UniqueIdentifier, this.owner).input('id', sql.NVarChar(256), id)
        .input('automation', sql.NVarChar(256), deviceSyncAutomationId).input('checksum', sql.Char(64), checksum)
        .input('bytes', sql.BigInt, Buffer.byteLength(JSON.stringify(batch))).input('received', sql.NVarChar(64), received.toISOString())
        .input('counts', sql.NVarChar(sql.MAX), JSON.stringify(normalized.counts)).input('feeds', sql.NVarChar(sql.MAX), JSON.stringify(normalized.feedKinds)),
      `INSERT daily.health_ingestions(owner_object_id,id,automation_id,session_id,checksum,status,content_bytes,received_at,completed_at,normalized_counts_json)
         VALUES(@owner,@id,@automation,@id,@checksum,'succeeded',@bytes,@received,@received,@counts);
       UPDATE daily.health_sync_state SET last_attempt_at=@received,last_success_at=@received,last_automation_id=@automation,last_session_id=@id,last_checksum=@checksum,last_counts_json=@counts,updated_at=@received,last_error=NULL,last_error_at=NULL
         WHERE owner_object_id=@owner AND id=1 AND (last_success_at IS NULL OR TRY_CONVERT(datetimeoffset,last_success_at)<=TRY_CONVERT(datetimeoffset,@received));
       IF NOT EXISTS(SELECT 1 FROM daily.health_sync_state WHERE owner_object_id=@owner AND id=1)
         INSERT daily.health_sync_state(owner_object_id,id,last_attempt_at,last_success_at,last_automation_id,last_session_id,last_checksum,last_counts_json,updated_at)
         VALUES(@owner,1,@received,@received,@automation,@id,@checksum,@counts,@received);
       UPDATE t SET automation_id=@automation,session_id=@id,checksum=@checksum,last_success_at=@received,last_counts_json=@counts,updated_at=@received
         FROM daily.health_sync_feeds t JOIN OPENJSON(@feeds) s ON t.feed_kind=s.[value]
         WHERE t.owner_object_id=@owner AND TRY_CONVERT(datetimeoffset,t.last_success_at)<=TRY_CONVERT(datetimeoffset,@received);
       INSERT daily.health_sync_feeds(owner_object_id,feed_kind,automation_id,session_id,checksum,last_success_at,last_counts_json,updated_at)
         SELECT @owner,s.[value],@automation,@id,@checksum,@received,@counts,@received FROM OPENJSON(@feeds) s
         WHERE NOT EXISTS(SELECT 1 FROM daily.health_sync_feeds t WHERE t.owner_object_id=@owner AND t.feed_kind=s.[value]);`, bounded);
      return { status: 'applied', id, receivedAt: received.toISOString(), counts: normalized.counts };
    });
    if (result.status === 'applied') {
      const changed: HealthSourceId[] = [sources.sync, ...normalized.feedKinds.flatMap(feed => feed === 'metrics'
        ? [sources.metrics, sources.sleep] : [sources.workouts, sources.workout, sources.heartRate])];
      this.changes.publish({ owner: this.owner, sources: changed });
    }
    return result;
  }
}

