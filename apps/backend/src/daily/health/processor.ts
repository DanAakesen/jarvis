import sql from 'mssql';
import { HealthUnavailable, ownerId, sha256 } from '../health-upload/contracts.js';
import { healthSqlQuery, healthSqlTransaction } from '../health-upload/sql-transaction.js';
import { normalizeHealth } from './normalize.js';
import { validateNormalized, writeNormalized } from './persistence.js';
import { HealthPayloadError, key, object } from './value.js';
import { dailyQuerySources as sources, type DailySourceId } from '@jarvis/contracts';
import { createDailyChanges, type DailyChangeSink } from '../revisions.js';

type Inbox = { id: string; checksum: string; bytes: Buffer; kind: string; automation: string; session: string; acceptedAt: Date; attempt: number };
export type ProcessingResult = { state: 'idle' | 'processed' | 'quarantined' | 'retry'; acceptanceId?: string; reason?: string };
export const processingRetryDelays = [120000, 300000, 900000] as const;
const processingLeaseMs = 45000;

/** One-item SQL processor. Production invokes it only from the default-off bounded worker. */
export class SqlHealthProcessor {
  readonly owner: string;
  private readonly changes = createDailyChanges();
  constructor(private readonly pool: sql.ConnectionPool, configuredOwner: string, private readonly now: () => number = Date.now,
    changes?: DailyChangeSink) {
    this.owner = ownerId(configuredOwner);
    // Keep notification failures in the existing listener boundary, never SQL replay.
    if (changes) this.changes.subscribe(change => changes.publish(change));
  }

  async processNext(signal: AbortSignal): Promise<ProcessingResult> {
    signal = AbortSignal.any([signal, AbortSignal.timeout(45000)]);
    signal.throwIfAborted();
    const claimed = await this.claim(signal);
    if (!claimed) return { state: 'idle' };
    if ('state' in claimed) {
      if (claimed.state === 'quarantined') this.changes.publish({ owner: this.owner, sources: [sources.sync] });
      return claimed;
    }
    const row = claimed;
    let result: ProcessingResult;
    let changed: DailySourceId[] = [];
    try {
      if (sha256(row.bytes) !== row.checksum) throw new HealthPayloadError('invalid_payload');
      const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(row.bytes)) as unknown;
      const normalized = row.kind === 'upload' ? normalizeHealth(payload) : null;
      if (normalized) { key(row.automation); key(row.session); validateNormalized(normalized); }
      else this.heartbeat(payload);
      result = await healthSqlTransaction<ProcessingResult>(this.pool, this.owner, signal, async (tx, bounded) => {
        const current = await this.current(tx, row, bounded);
        if (!current) return { state: 'retry', acceptanceId: row.id };
        if (current.processing_status === 'processed') return { state: 'processed', acceptanceId: row.id };
        const completedAt = new Date(this.now());
        if (normalized) {
          const prior = (await healthSqlQuery(new sql.Request(tx).input('owner', sql.UniqueIdentifier, this.owner)
            .input('automation', sql.NVarChar(256), row.automation).input('session', sql.NVarChar(256), row.session),
          'SELECT id,automation_id,session_id,checksum,status,content_bytes FROM daily.health_ingestions WHERE owner_object_id=@owner AND automation_id=@automation AND session_id=@session;', bounded)).recordset[0];
          // Existing imported lineage is never overwritten or reassigned to a new identity.
          if (prior && (prior.automation_id !== row.automation || prior.session_id !== row.session || prior.checksum !== row.checksum || Number(prior.content_bytes) !== row.bytes.length || prior.status !== 'succeeded')) throw new HealthPayloadError('invalid_payload');
          if (!prior) {
            await writeNormalized(tx, this.owner, row.id, row.acceptedAt, normalized, bounded);
            await this.recordSuccess(tx, row, normalized.counts, normalized.feedKinds, completedAt, bounded);
            changed = [sources.sync, ...normalized.feedKinds.flatMap(feed => feed === 'metrics'
              ? [sources.metrics, sources.sleep] : [sources.workouts, sources.workout, sources.heartRate])];
          } else changed = [sources.sync];
        } else {
          const heartbeat = this.heartbeat(payload);
          await healthSqlQuery(new sql.Request(tx).input('owner', sql.UniqueIdentifier, this.owner).input('received', sql.NVarChar(64), row.acceptedAt.toISOString())
            .input('shortcut', sql.NVarChar(256), heartbeat.shortcutName).input('feeds', sql.NVarChar(sql.MAX), JSON.stringify(heartbeat.checkedFeeds)),
          `UPDATE daily.health_phone_sync_state SET last_received_at=@received,shortcut_name=@shortcut,checked_feeds_json=@feeds,updated_at=@received
             WHERE owner_object_id=@owner AND id=1 AND TRY_CONVERT(datetimeoffset,last_received_at)<=TRY_CONVERT(datetimeoffset,@received);
           IF NOT EXISTS(SELECT 1 FROM daily.health_phone_sync_state WHERE owner_object_id=@owner AND id=1)
             INSERT daily.health_phone_sync_state(owner_object_id,id,last_received_at,shortcut_name,checked_feeds_json,updated_at) VALUES(@owner,1,@received,@shortcut,@feeds,@received);`, bounded);
          changed = [sources.sync];
        }
        await healthSqlQuery(this.request(tx, row).input('completed', sql.DateTime2(3), completedAt),
          "UPDATE daily.health_upload_inbox SET processing_status='processed',processed_at=@completed,processing_next_attempt_at=NULL,processing_error_code=NULL WHERE owner_object_id=@owner AND acceptance_id=@id AND processing_attempts=@attempt;", bounded);
        return { state: 'processed', acceptanceId: row.id };
      });
    } catch (error) {
      if (signal.aborted) throw new HealthUnavailable();
      const code = error instanceof HealthPayloadError ? error.code : error instanceof SyntaxError || error instanceof TypeError ? 'invalid_payload' : null;
      if (code) {
        const quarantined = await this.quarantine(row, code, signal);
        if (quarantined.state === 'quarantined') this.changes.publish({ owner: this.owner, sources: [sources.sync] });
        return quarantined;
      }
      if (error instanceof HealthUnavailable) return this.retry(row, signal);
      // Unexpected errors remain failures, with no payload/provider detail crossing the boundary.
      throw new HealthUnavailable();
    }
    if (result.state === 'processed' && changed.length) this.changes.publish({ owner: this.owner, sources: changed });
    return result;
  }
  private heartbeat(payload: unknown): { shortcutName: string; checkedFeeds: string[] } {
    const value = object(payload); const shortcutName = key(value.shortcutName);
    if (!Array.isArray(value.checkedFeeds) || value.checkedFeeds.length > 2 || value.checkedFeeds.some(v => v !== 'metrics' && v !== 'workouts') || new Set(value.checkedFeeds).size !== value.checkedFeeds.length) throw new HealthPayloadError('invalid_payload');
    return { shortcutName, checkedFeeds: value.checkedFeeds as string[] };
  }
  private request(tx: sql.Transaction, row: Pick<Inbox, 'id' | 'attempt'>) {
    return new sql.Request(tx).input('owner', sql.UniqueIdentifier, this.owner).input('id', sql.UniqueIdentifier, row.id).input('attempt', sql.Int, row.attempt);
  }
  private async current(tx: sql.Transaction, row: Inbox, signal: AbortSignal) {
    const found = (await healthSqlQuery(this.request(tx, row), 'SELECT processing_status,processing_attempts,checksum,processing_next_attempt_at FROM daily.health_upload_inbox WHERE owner_object_id=@owner AND acceptance_id=@id;', signal)).recordset[0];
    if (!found || found.checksum !== row.checksum) throw new HealthPayloadError('invalid_payload');
    if (found.processing_status === 'processed') return found;
    if (found.processing_status !== 'processing' || found.processing_attempts !== row.attempt ||
        !(found.processing_next_attempt_at instanceof Date) || found.processing_next_attempt_at.getTime() <= this.now()) return null;
    return found;
  }
  private async claim(signal: AbortSignal): Promise<Inbox | ProcessingResult | null> {
    return healthSqlTransaction<Inbox | ProcessingResult | null>(this.pool, this.owner, signal, async (tx, bounded) => {
      const now = new Date(this.now());
      const found = (await healthSqlQuery(new sql.Request(tx).input('owner', sql.UniqueIdentifier, this.owner).input('now', sql.DateTime2(3), now),
      `SELECT TOP(1) acceptance_id,checksum,byte_count,raw_bytes,kind,automation_id,session_id,accepted_at,processing_attempts
         FROM daily.health_upload_inbox WHERE owner_object_id=@owner AND
           ((processing_status='pending' AND (processing_next_attempt_at IS NULL OR processing_next_attempt_at<=@now)) OR
            (processing_status='processing' AND processing_next_attempt_at<=@now))
         ORDER BY accepted_at,acceptance_id;`, bounded)).recordset[0];
      if (!found) return null;
      const id = String(found.acceptance_id).toLowerCase(); const attempts = Number(found.processing_attempts);
      if (!Number.isInteger(attempts) || attempts < 0 || attempts > 3) throw new HealthUnavailable();
      if (attempts === 3) {
        await healthSqlQuery(this.request(tx, { id, attempt: attempts }), "UPDATE daily.health_upload_inbox SET processing_status='quarantined',processing_error_code='retry_exhausted',processing_next_attempt_at=NULL WHERE owner_object_id=@owner AND acceptance_id=@id;", bounded);
        return { state: 'quarantined', acceptanceId: id, reason: 'retry_exhausted' };
      }
      if (!Buffer.isBuffer(found.raw_bytes) || found.raw_bytes.length !== found.byte_count || !(found.accepted_at instanceof Date)) throw new HealthUnavailable();
      const attempt = attempts + 1;
      await healthSqlQuery(this.request(tx, { id, attempt }).input('next', sql.DateTime2(3), new Date(now.getTime() + processingLeaseMs)),
        "UPDATE daily.health_upload_inbox SET processing_status='processing',processing_attempts=@attempt,processing_next_attempt_at=@next,processing_error_code='interrupted' WHERE owner_object_id=@owner AND acceptance_id=@id;", bounded);
      return { id, checksum: String(found.checksum), bytes: Buffer.from(found.raw_bytes), kind: String(found.kind), automation: String(found.automation_id), session: String(found.session_id), acceptedAt: found.accepted_at, attempt };
    });
  }
  private async quarantine(row: Inbox, code: string, signal: AbortSignal): Promise<ProcessingResult> {
    return healthSqlTransaction<ProcessingResult>(this.pool, this.owner, signal, async (tx, bounded) => {
      const current = await this.current(tx, row, bounded);
      if (current?.processing_status === 'processed') return { state: 'processed', acceptanceId: row.id };
      if (!current) return { state: 'retry', acceptanceId: row.id };
      await healthSqlQuery(this.request(tx, row).input('code', sql.VarChar(64), code),
        "UPDATE daily.health_upload_inbox SET processing_status='quarantined',processing_error_code=@code,processing_next_attempt_at=NULL WHERE owner_object_id=@owner AND acceptance_id=@id AND processing_attempts=@attempt;", bounded);
      return { state: 'quarantined', acceptanceId: row.id, reason: code };
    });
  }
  private async retry(row: Inbox, signal: AbortSignal): Promise<ProcessingResult> {
    return healthSqlTransaction<ProcessingResult>(this.pool, this.owner, signal, async (tx, bounded) => {
      const current = await this.current(tx, row, bounded);
      if (current?.processing_status === 'processed') return { state: 'processed', acceptanceId: row.id };
      if (!current) return { state: 'retry', acceptanceId: row.id };
      const delay = processingRetryDelays[row.attempt - 1]!;
      await healthSqlQuery(this.request(tx, row).input('next', sql.DateTime2(3), new Date(this.now() + delay)),
        "UPDATE daily.health_upload_inbox SET processing_status='pending',processing_next_attempt_at=@next,processing_error_code='interrupted' WHERE owner_object_id=@owner AND acceptance_id=@id AND processing_attempts=@attempt;", bounded);
      return { state: 'retry', acceptanceId: row.id, reason: 'storage_unavailable' };
    });
  }
  private async recordSuccess(tx: sql.Transaction, row: Inbox, counts: Record<string, number>, feeds: string[], completedAt: Date, signal: AbortSignal) {
    await healthSqlQuery(this.request(tx, row).input('ingestion', sql.NVarChar(256), row.id).input('automation', sql.NVarChar(256), row.automation).input('session', sql.NVarChar(256), row.session)
      .input('checksum', sql.Char(64), row.checksum).input('bytes', sql.BigInt, row.bytes.length).input('received', sql.NVarChar(64), row.acceptedAt.toISOString())
      .input('completed', sql.NVarChar(64), completedAt.toISOString()).input('counts', sql.NVarChar(sql.MAX), JSON.stringify(counts)).input('feeds', sql.NVarChar(sql.MAX), JSON.stringify(feeds)),
    `INSERT daily.health_ingestions(owner_object_id,id,automation_id,session_id,checksum,status,content_bytes,received_at,completed_at,normalized_counts_json)
       VALUES(@owner,@ingestion,@automation,@session,@checksum,'succeeded',@bytes,@received,@completed,@counts);
     UPDATE daily.health_sync_state SET last_attempt_at=@received,last_success_at=@received,last_automation_id=@automation,last_session_id=@session,last_checksum=@checksum,last_counts_json=@counts,updated_at=@completed,last_error=NULL,last_error_at=NULL
       WHERE owner_object_id=@owner AND id=1 AND (last_success_at IS NULL OR TRY_CONVERT(datetimeoffset,last_success_at)<=TRY_CONVERT(datetimeoffset,@received));
     IF NOT EXISTS(SELECT 1 FROM daily.health_sync_state WHERE owner_object_id=@owner AND id=1)
       INSERT daily.health_sync_state(owner_object_id,id,last_attempt_at,last_success_at,last_automation_id,last_session_id,last_checksum,last_counts_json,updated_at)
       VALUES(@owner,1,@received,@received,@automation,@session,@checksum,@counts,@completed);
     UPDATE t SET automation_id=@automation,session_id=@session,checksum=@checksum,last_success_at=@received,last_counts_json=@counts,updated_at=@completed
       FROM daily.health_sync_feeds t JOIN OPENJSON(@feeds) s ON t.feed_kind=s.[value]
       WHERE t.owner_object_id=@owner AND TRY_CONVERT(datetimeoffset,t.last_success_at)<=TRY_CONVERT(datetimeoffset,@received);
     INSERT daily.health_sync_feeds(owner_object_id,feed_kind,automation_id,session_id,checksum,last_success_at,last_counts_json,updated_at)
       SELECT @owner,s.[value],@automation,@session,@checksum,@received,@counts,@completed FROM OPENJSON(@feeds) s
       WHERE NOT EXISTS(SELECT 1 FROM daily.health_sync_feeds t WHERE t.owner_object_id=@owner AND t.feed_kind=s.[value]);`, signal);
  }
}
