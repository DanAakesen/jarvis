import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { authorizeHealth,HealthConflict,HealthDenied,HealthUnavailable,healthUploadLimit,metadataLimit,opaqueId,ownerId,sha256,
  type HealthBuffer,type HealthCapability,type HealthKind,type HealthReceipt,type UploadIdentity } from './contracts.js';
import { readSqlHealthCapability,sqlHealthCapability } from './sql-capabilities.js';
import { healthSqlQuery,healthSqlTransaction } from './sql-transaction.js';

export const healthInboxByteLimit = 256 * 1024 * 1024;
export const healthInboxRowLimit = 10000;
/** Durable acceptance only. No normalization, raw deletion, external queue, or automatic replay. */
export class SqlHealthBuffer implements HealthBuffer {
  readonly owner: string;
  private readonly now: () => number;
  private readonly maxRawBytes: number;
  constructor(private readonly pool: sql.ConnectionPool,configuredOwner: string,options: { now?: () => number; maxRawBytes?: number } = {}) {
    this.owner = ownerId(configuredOwner); this.now = options.now ?? Date.now;
    this.maxRawBytes = options.maxRawBytes ?? healthInboxByteLimit;
    if (!Number.isSafeInteger(this.maxRawBytes) || this.maxRawBytes < 1 || this.maxRawBytes > healthInboxByteLimit) throw new TypeError('Invalid health inbox capacity');
  }
  async accept(kind: HealthKind,capability: HealthCapability,identity: UploadIdentity,body: Buffer,signal: AbortSignal,credentialReference?: string): Promise<HealthReceipt> {
    if (!['upload','heartbeat'].includes(kind)) throw new TypeError('Invalid health kind');
    const permission = kind === 'upload' ? 'health-ingest' : 'health-heartbeat';
    const checked = authorizeHealth(capability,this.owner,permission,this.now());
    if (!credentialReference || !/^[a-f0-9]{64}$/u.test(credentialReference)) throw new HealthDenied();
    opaqueId(identity.automationId); opaqueId(identity.sessionId);
    if (!Buffer.isBuffer(body) || !body.length || body.length > (kind === 'upload' ? healthUploadLimit : metadataLimit)) throw new TypeError('Invalid health payload');
    const bytes = Buffer.from(body); // The caller cannot mutate an in-flight acceptance.
    try { JSON.parse(new TextDecoder('utf-8',{ fatal: true }).decode(bytes)); } catch { throw new TypeError('Invalid health JSON'); }
    const checksum = sha256(bytes);
    const sessionHash = sha256(JSON.stringify([this.owner,kind,identity.automationId,identity.sessionId]));
    return healthSqlTransaction(this.pool,this.owner,signal,async (tx,bounded) => {
      // Recheck under the SAME lock used by revoke/rotate. A pre-body lookup is not final authority.
      const deviceRow = await readSqlHealthCapability(tx,this.owner,credentialReference,bounded);
      const current = authorizeHealth(deviceRow ? sqlHealthCapability(deviceRow) : null,this.owner,permission,this.now());
      if (current.deviceId !== checked.deviceId) throw new HealthDenied();
      const prior = (await healthSqlQuery(new sql.Request(tx).input('owner',sql.UniqueIdentifier,this.owner).input('session',sql.Char(64),sessionHash),
        'SELECT acceptance_id,device_id,kind,automation_id,session_id,checksum,byte_count,accepted_at FROM daily.health_upload_inbox WHERE owner_object_id=@owner AND session_hash=@session;',bounded)).recordset[0];
      if (prior) {
        if (prior.kind !== kind || prior.device_id !== current.deviceId || prior.automation_id !== identity.automationId || prior.session_id !== identity.sessionId || prior.checksum !== checksum || prior.byte_count !== bytes.length) throw new HealthConflict();
        if (!(prior.accepted_at instanceof Date)) throw new HealthUnavailable();
        return this.receipt(String(prior.acceptance_id).toLowerCase(),prior.accepted_at.toISOString(),true);
      }
      const total = (await healthSqlQuery(new sql.Request(tx).input('owner',sql.UniqueIdentifier,this.owner),
        'SELECT COUNT_BIG(*) AS row_count,COALESCE(SUM(CONVERT(bigint,byte_count)),0) AS bytes FROM daily.health_upload_inbox WHERE owner_object_id=@owner;',bounded)).recordset[0];
      const used = Number(total?.bytes); const count = Number(total?.row_count);
      if (!Number.isSafeInteger(count) || count < 0 || count >= healthInboxRowLimit || !Number.isSafeInteger(used) || used < 0 || used + bytes.length > this.maxRawBytes) throw new HealthUnavailable();
      const acceptanceId = randomUUID(); const acceptedAt = new Date(this.now());
      await healthSqlQuery(new sql.Request(tx).input('owner',sql.UniqueIdentifier,this.owner).input('sessionHash',sql.Char(64),sessionHash)
        .input('id',sql.UniqueIdentifier,acceptanceId).input('reference',sql.Char(64),credentialReference).input('device',sql.NVarChar(256),current.deviceId)
        .input('kind',sql.VarChar(16),kind).input('automation',sql.NVarChar(1024),identity.automationId).input('session',sql.NVarChar(1024),identity.sessionId)
        .input('checksum',sql.Char(64),checksum).input('bytes',sql.Int,bytes.length).input('raw',sql.VarBinary(sql.MAX),bytes).input('now',sql.DateTime2(3),acceptedAt),
        `INSERT daily.health_upload_inbox(owner_object_id,session_hash,acceptance_id,capability_reference,device_id,kind,automation_id,session_id,checksum,byte_count,raw_bytes,accepted_at)
          VALUES(@owner,@sessionHash,@id,@reference,@device,@kind,@automation,@session,@checksum,@bytes,@raw,@now);`,bounded);
      return this.receipt(acceptanceId,acceptedAt.toISOString(),false);
    });
  }
  private receipt(acceptanceId: string,acceptedAt: string,duplicate: boolean): HealthReceipt {
    return { acceptanceId,acceptedAt,status: 'accepted',queue: 'pending',storage: 'sql',processing: 'not-confirmed',duplicate };
  }
}
