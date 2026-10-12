import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import sql from 'mssql';
import type { FastifyRequest } from 'fastify';
import { resolveDailyOwner } from '../owner.js';
import { resolveExportDevice, type NutritionExportDevice } from './auth.js';
import { canonicalJson, instant, text } from '../nutrition/model.js';
import { authorizePeriod, claimInput, claimLeaseMs, completion, exportItem, ExportConflict, ExportUnavailable, queueRetentionMs,
  type ClaimInput,type Completion,type ExportItem,type ExportPeriod,type PeriodAuthority } from './model.js';

const exact = (column: string,param = 'id') => `${column}=@${param} AND DATALENGTH(${column})=DATALENGTH(@${param})`;
const snapshotColumns = ['id','idempotency_key','meal_name','meal_type','components_json','occurred_at','energy_kcal','protein_grams','carbohydrates_grams','fat_grams','fiber_grams','confidence','capture_method'] as const;
export interface ClaimResult { state: 'claimed' | 'reconciliation-required'; claimToken: string; claimedAt: string; claimExpiresAt: string; items: ExportItem[] }
export interface ReconciliationAuthority {
  intent: 'reconcile-nutrition-export'; explicit: boolean; checkedInHealth: boolean;
  evidence: 'all-samples-present' | 'all-samples-absent' | 'partial-or-unknown';
}
/** Canonical meals are read, never duplicated/re-ingested. No production registration. */
export class NutritionExportStore {
  private constructor(private readonly pool: sql.ConnectionPool,private readonly owner: string,
    private readonly device: NutritionExportDevice | null,private readonly now: () => string) {}
  static forOwner(pool: sql.ConnectionPool,request: FastifyRequest,now = () => new Date().toISOString()) {
    return new NutritionExportStore(pool,resolveDailyOwner(request),null,now);
  }
  static forDevice(pool: sql.ConnectionPool,request: FastifyRequest,now = () => new Date().toISOString()) {
    const device = resolveExportDevice(request);
    return new NutritionExportStore(pool,device.ownerObjectId,device,now);
  }
  private request(tx: sql.Transaction) { return new sql.Request(tx).input('owner',sql.UniqueIdentifier,this.owner); }
  private async query(request: sql.Request,query: string,signal: AbortSignal) {
    const cancel = () => request.cancel(); signal.addEventListener('abort',cancel,{ once: true });
    try { signal.throwIfAborted(); return await request.query<Record<string,unknown>>(query); }
    finally { signal.removeEventListener('abort',cancel); }
  }
  private clock(): string { const now = this.now(); instant(now); return new Date(now).toISOString(); }
  private async transaction<T>(signal: AbortSignal,action: (tx: sql.Transaction,now: string) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted(); const tx = new sql.Transaction(this.pool);
      try {
        await tx.begin();
        await this.query(this.request(tx).input('lock',sql.NVarChar(255),`daily-export:${this.owner}`),
          "DECLARE @result int; EXEC @result=sys.sp_getapplock @Resource=@lock,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000; IF @result<0 THROW 51044,'Export busy',1;",signal);
        const result = await action(tx,this.clock()); signal.throwIfAborted(); await tx.commit(); return result;
      } catch (error) {
        await tx.rollback().catch(() => undefined); if (signal.aborted) throw signal.reason;
        if ((error as { number?: number }).number === 1205 && attempt < 2) { await delay(20 * (attempt + 1),undefined,{ signal }); continue; }
        if (error instanceof ExportConflict || error instanceof TypeError || error instanceof ExportUnavailable) throw error;
        throw new ExportUnavailable();
      }
    }
  }
  private async expire(tx: sql.Transaction,now: string,signal: AbortSignal) {
    await this.query(this.request(tx).input('now',sql.NVarChar(64),now),`UPDATE q SET status=CASE WHEN q.status=N'pending' THEN N'cancelled' WHEN q.status=N'claimed' THEN N'uncertain' ELSE N'out_of_sync' END,updated_at=@now
      FROM daily.nutrition_queue q JOIN daily.nutrition_meals m ON m.owner_object_id=q.owner_object_id AND m.id=q.id AND DATALENGTH(m.id)=DATALENGTH(q.id)
      WHERE q.owner_object_id=@owner AND q.source_revision IS NOT NULL AND (q.source_revision<>m.revision OR m.deleted_at IS NOT NULL) AND q.status IN(N'pending',N'claimed',N'written');
      UPDATE daily.nutrition_queue SET status=CASE WHEN status=N'claimed' THEN N'uncertain' ELSE N'expired' END,updated_at=@now
      WHERE owner_object_id=@owner AND source_revision IS NOT NULL AND ((status=N'claimed' AND CONVERT(datetimeoffset,claim_expires_at)<=CONVERT(datetimeoffset,@now))
        OR (status=N'pending' AND CONVERT(datetimeoffset,expires_at)<=CONVERT(datetimeoffset,@now)));
      UPDATE m SET apple_health_status=q.status FROM daily.nutrition_meals m JOIN daily.nutrition_queue q ON m.owner_object_id=q.owner_object_id AND m.id=q.id
      WHERE m.owner_object_id=@owner AND q.source_revision IS NOT NULL AND q.status IN(N'uncertain',N'expired',N'cancelled',N'out_of_sync');`,signal);
  }
  async queue(operationKey: string,input: ExportPeriod,authority: PeriodAuthority,signal: AbortSignal): Promise<{ queued: number; skipped: number }> {
    if (this.device) throw new ExportConflict(); text(operationKey); const range = authorizePeriod(input,authority);
    return this.transaction(signal,async (tx,now) => {
      const existing = (await this.query(this.request(tx).input('id',sql.NVarChar(256),operationKey),
        `SELECT * FROM daily.nutrition_export_requests WITH(UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner AND id=@id;`,signal)).recordset[0];
      if (existing) {
        if (existing.id !== operationKey || existing.from_at !== range.from || existing.to_at !== range.to) throw new ExportConflict();
        return { queued: existing.queued_count as number,skipped: existing.skipped_count as number };
      }
      await this.expire(tx,now,signal);
      const rows = (await this.query(this.request(tx).input('from',sql.NVarChar(64),range.from).input('to',sql.NVarChar(64),range.to),
        `SELECT TOP (1001) * FROM daily.nutrition_meals WITH(UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner AND deleted_at IS NULL
          AND CONVERT(datetimeoffset,occurred_at)>=CONVERT(datetimeoffset,@from) AND CONVERT(datetimeoffset,occurred_at)<CONVERT(datetimeoffset,@to) ORDER BY CONVERT(datetimeoffset,occurred_at),id;`,signal)).recordset;
      if (rows.length > 1000) throw new ExportUnavailable();
      let queued = 0; let skipped = 0; let bytes = 0;
      for (const row of rows) {
        const request = this.request(tx).input('id',sql.NVarChar(256),row.id);
        const prior = (await this.query(request,'SELECT id FROM daily.nutrition_queue WITH(UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner AND id=@id;',signal)).recordset[0];
        if (prior || row.apple_health_status !== 'not_exported') { skipped++; continue; }
        const item = exportItem({ ...row,status: 'pending',created_at: now }); bytes += Buffer.byteLength(JSON.stringify(item),'utf8');
        if (bytes > 1024 * 1024) throw new ExportUnavailable();
        const expires = new Date(Date.parse(now) + queueRetentionMs).toISOString();
        const insert = this.request(tx).input('now',sql.NVarChar(64),now).input('expires',sql.NVarChar(64),expires).input('revision',sql.BigInt,String(row.revision));
        for (const column of snapshotColumns) insert.input(column,['energy_kcal','protein_grams','carbohydrates_grams','fat_grams','fiber_grams'].includes(column) ? sql.Float : sql.NVarChar(column === 'components_json' || column === 'meal_name' ? sql.MAX : column === 'occurred_at' ? 64 : 256),row[column]);
        await this.query(insert,`INSERT daily.nutrition_queue(owner_object_id,${snapshotColumns.join(',')},source_revision,status,created_at,expires_at,updated_at)
          VALUES(@owner,${snapshotColumns.map((column) => `@${column}`).join(',')},@revision,N'pending',@now,@expires,@now);
          UPDATE daily.nutrition_meals SET apple_health_status=N'pending' WHERE owner_object_id=@owner AND ${exact('id')};`,signal);
        queued++;
      }
      await this.query(this.request(tx).input('id',sql.NVarChar(256),operationKey).input('from',sql.NVarChar(64),range.from).input('to',sql.NVarChar(64),range.to)
        .input('queued',sql.Int,queued).input('skipped',sql.Int,skipped).input('now',sql.NVarChar(64),now),
        'INSERT daily.nutrition_export_requests(owner_object_id,id,from_at,to_at,queued_count,skipped_count,created_at) VALUES(@owner,@id,@from,@to,@queued,@skipped,@now);',signal);
      return { queued,skipped };
    });
  }
  async claim(input: ClaimInput,signal: AbortSignal): Promise<ClaimResult> {
    if (!this.device) throw new ExportConflict(); const { operationKey,limit } = claimInput(input); const device = this.device;
    return this.transaction(signal,async (tx,now) => {
      if (Date.parse(device.expiresAt) <= Date.parse(now)) throw new ExportConflict();
      await this.expire(tx,now,signal);
      const prior = (await this.query(this.request(tx).input('id',sql.NVarChar(256),operationKey),
        'SELECT * FROM daily.nutrition_export_claims WITH(UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner AND id=@id;',signal)).recordset[0];
      if (prior) {
        if (prior.id !== operationKey || prior.device_id !== device.deviceId || prior.claim_limit !== limit) throw new ExportConflict();
        // An ACK/response may have been lost AFTER native writes: never replay write instructions.
        return { state: 'reconciliation-required',claimToken: String(prior.claim_token).toLowerCase(),claimedAt: prior.claimed_at as string,claimExpiresAt: prior.claim_expires_at as string,items: [] };
      }
      const claimToken = randomUUID(); const expires = new Date(Math.min(Date.parse(now) + claimLeaseMs,Date.parse(device.expiresAt))).toISOString();
      const rows = (await this.query(this.request(tx).input('limit',sql.Int,limit),
        `SELECT TOP (@limit) q.* FROM daily.nutrition_queue q WITH(UPDLOCK,HOLDLOCK) JOIN daily.nutrition_meals m WITH(UPDLOCK,HOLDLOCK)
          ON m.owner_object_id=q.owner_object_id AND m.id=q.id AND DATALENGTH(m.id)=DATALENGTH(q.id)
          WHERE q.owner_object_id=@owner AND q.source_revision=m.revision AND m.deleted_at IS NULL AND q.status=N'pending'
          ORDER BY CONVERT(datetimeoffset,q.occurred_at),q.id;`,signal)).recordset;
      const items = rows.map((row) => exportItem({ ...row,status: 'claimed' }));
      const result: ClaimResult = { state: 'claimed',claimToken,claimedAt: now,claimExpiresAt: expires,items };
      if (Buffer.byteLength(JSON.stringify(result),'utf8') > 256 * 1024) throw new ExportUnavailable();
      await this.query(this.request(tx).input('id',sql.NVarChar(256),operationKey).input('device',sql.NVarChar(256),device.deviceId).input('token',sql.UniqueIdentifier,claimToken)
        .input('limit',sql.Int,limit).input('now',sql.NVarChar(64),now).input('expires',sql.NVarChar(64),expires),
        'INSERT daily.nutrition_export_claims(owner_object_id,id,device_id,claim_token,claim_limit,claimed_at,claim_expires_at) VALUES(@owner,@id,@device,@token,@limit,@now,@expires);',signal);
      for (const row of rows) await this.query(this.request(tx).input('id',sql.NVarChar(256),row.id).input('device',sql.NVarChar(256),device.deviceId)
        .input('token',sql.UniqueIdentifier,claimToken).input('now',sql.NVarChar(64),now).input('expires',sql.NVarChar(64),expires),
        `UPDATE daily.nutrition_queue SET status=N'claimed',claim_token=@token,claim_device_id=@device,claimed_at=@now,claim_expires_at=@expires,updated_at=@now
          WHERE owner_object_id=@owner AND ${exact('id')} AND status=N'pending';
          UPDATE daily.nutrition_meals SET apple_health_status=N'claimed' WHERE owner_object_id=@owner AND ${exact('id')};`,signal);
      return result;
    });
  }
  async complete(input: Completion,signal: AbortSignal): Promise<{ state: string; completedAt: string; replay: boolean }> {
    if (!this.device) throw new ExportConflict(); const receipt = completion(input); const device = this.device;
    const result = await this.transaction(signal,async (tx,now) => {
      if (Date.parse(device.expiresAt) <= Date.parse(now)) throw new ExportConflict();
      await this.expire(tx,now,signal);
      const row = (await this.query(this.request(tx).input('id',sql.NVarChar(256),receipt.id),
        `SELECT q.*,m.revision AS current_revision,m.deleted_at FROM daily.nutrition_queue q WITH(UPDLOCK,HOLDLOCK)
          JOIN daily.nutrition_meals m WITH(UPDLOCK,HOLDLOCK) ON m.owner_object_id=q.owner_object_id AND m.id=q.id AND DATALENGTH(m.id)=DATALENGTH(q.id)
          WHERE q.owner_object_id=@owner AND ${exact('q.id')};`,signal)).recordset[0];
      if (!row || String(row.claim_token).toLowerCase() !== receipt.claimToken || row.claim_device_id !== device.deviceId) throw new ExportConflict();
      if (row.receipt_json !== null) {
        if (row.receipt_json !== receipt.receipt) throw new ExportConflict();
        return { state: row.status as string,completedAt: row.completed_at as string,replay: true };
      }
      if (!['claimed','uncertain'].includes(row.status as string) || !row.claim_expires_at || Date.parse(row.claim_expires_at as string) <= Date.parse(now)) {
        return null; // Commit expiry-to-uncertain before reporting the conflict.
      }
      const stale = row.deleted_at !== null || String(row.source_revision) !== String(row.current_revision);
      const state = receipt.status === 'failed' ? 'uncertain' : stale ? 'out_of_sync' : 'written';
      await this.query(this.request(tx).input('id',sql.NVarChar(256),receipt.id).input('receipt',sql.NVarChar(4000),receipt.receipt).input('state',sql.NVarChar(256),state)
        .input('writer',sql.NVarChar(256),receipt.writer).input('error',sql.NVarChar(sql.MAX),receipt.error).input('now',sql.NVarChar(64),now),
        `UPDATE daily.nutrition_queue SET receipt_json=@receipt,status=@state,completed_at=@now,writer=@writer,last_error=@error,updated_at=@now WHERE owner_object_id=@owner AND ${exact('id')};
          UPDATE daily.nutrition_meals SET apple_health_status=@state,apple_health_completed_at=@now,apple_health_writer=@writer,apple_health_error=@error WHERE owner_object_id=@owner AND ${exact('id')};`,signal);
      return { state,completedAt: now,replay: false };
    });
    if (!result) throw new ExportConflict();
    return result;
  }
  async reconcile(id: string,authority: ReconciliationAuthority,signal: AbortSignal): Promise<{ state: string }> {
    if (this.device || authority?.intent !== 'reconcile-nutrition-export' || authority.explicit !== true || authority.checkedInHealth !== true ||
        !['all-samples-present','all-samples-absent','partial-or-unknown'].includes(authority.evidence)) throw new ExportConflict();
    text(id);
    const checkedEvidence = authority.evidence;
    return this.transaction(signal,async (tx,now) => {
      await this.expire(tx,now,signal);
      const row = (await this.query(this.request(tx).input('id',sql.NVarChar(256),id),
        `SELECT q.*,m.revision AS current_revision,m.deleted_at FROM daily.nutrition_queue q WITH(UPDLOCK,HOLDLOCK)
          JOIN daily.nutrition_meals m WITH(UPDLOCK,HOLDLOCK) ON m.owner_object_id=q.owner_object_id AND m.id=q.id AND DATALENGTH(m.id)=DATALENGTH(q.id)
          WHERE q.owner_object_id=@owner AND ${exact('q.id')};`,signal)).recordset[0];
      const evidence = canonicalJson({ evidence: checkedEvidence });
      if (row?.reconciliation_json === evidence) return { state: row.status as string };
      if (!row || !['uncertain','out_of_sync','failed'].includes(row.status as string) ||
          row.reconciliation_json && row.reconciliation_json !== canonicalJson({ evidence: 'partial-or-unknown' })) throw new ExportConflict();
      const state = checkedEvidence === 'all-samples-absent' ? 'reconciled_absent' : checkedEvidence === 'partial-or-unknown' ? 'uncertain'
        : row.deleted_at !== null || String(row.source_revision) !== String(row.current_revision) ? 'out_of_sync' : 'written';
      await this.query(this.request(tx).input('id',sql.NVarChar(256),id).input('evidence',sql.NVarChar(2000),evidence).input('state',sql.NVarChar(256),state).input('now',sql.NVarChar(64),now),
        `UPDATE daily.nutrition_queue SET status=@state,reconciliation_json=@evidence,updated_at=@now WHERE owner_object_id=@owner AND ${exact('id')};
          UPDATE daily.nutrition_meals SET apple_health_status=@state WHERE owner_object_id=@owner AND ${exact('id')};`,signal);
      // No branch resets pending. Absence/partial evidence does not authorize another native write.
      return { state };
    });
  }
}
