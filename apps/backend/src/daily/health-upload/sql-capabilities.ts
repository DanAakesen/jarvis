import sql from 'mssql';
import { authorizeHealth,HealthConflict,HealthDenied,HealthUnavailable,ownerId,sha256,
  type HealthCapability,type HealthCredentialVerifier,type HealthPermission } from './contracts.js';
import { HealthCapabilityLifecycleError,PreparedHealthCapability,preparedHealthRecord } from './capability-operation.js';
import { healthSqlQuery,healthSqlTransaction } from './sql-transaction.js';

function reference(value: string) {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('Invalid capability reference');
  return value;
}
export function sqlHealthCapability(row: Record<string,unknown>): HealthCapability {
  if (typeof row.can_ingest !== 'boolean' || typeof row.can_heartbeat !== 'boolean' || typeof row.revoked !== 'boolean' || !(row.expires_at instanceof Date)) throw new HealthDenied();
  return {
    version: 1,ownerObjectId: String(row.owner_object_id).toLowerCase(),deviceId: row.device_id as string,
    permissions: [...(row.can_ingest ? ['health-ingest' as const] : []),...(row.can_heartbeat ? ['health-heartbeat' as const] : [])],
    expiresAt: row.expires_at.toISOString(),revoked: row.revoked,
  };
}
export async function readSqlHealthCapability(context: sql.ConnectionPool | sql.Transaction,owner: string,id: string,signal: AbortSignal) {
  const result = await healthSqlQuery(new sql.Request(context).input('owner',sql.UniqueIdentifier,owner).input('reference',sql.Char(64),reference(id)),
    'SELECT owner_object_id,device_id,can_ingest,can_heartbeat,expires_at,revoked,replacement_reference FROM daily.health_upload_capabilities WHERE owner_object_id=@owner AND token_hash=@reference;',signal);
  return result.recordset[0];
}
/** Inactive operator library. Only its read-only verifier is passed to the upload routes. */
export class SqlHealthCapabilities {
  readonly owner: string;
  constructor(private readonly pool: sql.ConnectionPool,configuredOwner: string,private readonly now: () => number = Date.now) {
    this.owner = ownerId(configuredOwner);
  }
  readonly verify: HealthCredentialVerifier = async (token,signal) => {
    if (!/^[A-Za-z0-9_-]{43,256}$/u.test(token)) return null;
    const bounded = AbortSignal.any([signal,AbortSignal.timeout(10000)]);
    try {
      const row = await readSqlHealthCapability(this.pool,this.owner,sha256(token),bounded);
      if (!row) return null;
      const capability = sqlHealthCapability(row);
      // The route separately requires the precise operation's scope.
      return authorizeHealth(capability,this.owner,capability.permissions[0]!,this.now());
    } catch (error) {
      if (error instanceof HealthDenied && !bounded.aborted) return null;
      throw new HealthUnavailable();
    }
  };
  prepare(input: { deviceId: string; permissions: HealthPermission[]; expiresAt: string }): PreparedHealthCapability {
    try {
      if (Object.keys(input).some(key => !['deviceId','permissions','expiresAt'].includes(key))) throw new TypeError();
      const row = this.validate({ version: 1,ownerObjectId: this.owner,...input,revoked: false });
      return PreparedHealthCapability.prepare(row);
    } catch { throw new HealthCapabilityLifecycleError('invalid-input'); }
  }
  private validate(row: HealthCapability): HealthCapability {
    const checked = authorizeHealth(row,this.owner,row.permissions[0]!,this.now());
    if (new Date(checked.expiresAt).toISOString() !== checked.expiresAt) throw new TypeError();
    return { ...checked,permissions: [...checked.permissions].sort() };
  }
  private record(operation: PreparedHealthCapability) {
    try {
      const row = preparedHealthRecord(operation);
      if (!row) throw new TypeError();
      return this.validate(row);
    } catch { throw new HealthCapabilityLifecycleError('invalid-input'); }
  }
  private async mutate<T>(signal: AbortSignal,action: (tx: sql.Transaction,signal: AbortSignal) => Promise<T>) {
    try { return await healthSqlTransaction(this.pool,this.owner,signal,action); }
    catch (error) {
      throw new HealthCapabilityLifecycleError(signal.aborted ? 'canceled' : error instanceof HealthConflict ? 'conflict' : 'unavailable');
    }
  }
  private async issueRecord(tx: sql.Transaction,operation: PreparedHealthCapability,row: HealthCapability,signal: AbortSignal) {
    const existing = await readSqlHealthCapability(tx,this.owner,operation.reference,signal);
    if (existing) {
      const previous = sqlHealthCapability(existing);
      if (previous.deviceId !== row.deviceId || previous.expiresAt !== row.expiresAt ||
          [...previous.permissions].sort().join(',') !== row.permissions.join(',')) throw new HealthConflict();
      return { state: previous.revoked ? 'revoked' as const : 'issued' as const };
    }
    await healthSqlQuery(new sql.Request(tx).input('owner',sql.UniqueIdentifier,this.owner).input('reference',sql.Char(64),operation.reference)
      .input('device',sql.NVarChar(256),row.deviceId).input('ingest',sql.Bit,row.permissions.includes('health-ingest'))
      .input('heartbeat',sql.Bit,row.permissions.includes('health-heartbeat')).input('expires',sql.DateTime2(3),new Date(row.expiresAt)),
      'INSERT daily.health_upload_capabilities(owner_object_id,token_hash,device_id,can_ingest,can_heartbeat,expires_at,revoked) VALUES(@owner,@reference,@device,@ingest,@heartbeat,@expires,0);',signal);
    return { state: 'issued' as const };
  }
  issue(operation: PreparedHealthCapability,signal: AbortSignal) {
    const row = this.record(operation);
    return this.mutate(signal,(tx,bounded) => this.issueRecord(tx,operation,row,bounded));
  }
  revoke(id: string,signal: AbortSignal) {
    try { reference(id); } catch { throw new HealthCapabilityLifecycleError('invalid-input'); }
    return this.mutate(signal,async (tx,bounded) => {
      if (!await readSqlHealthCapability(tx,this.owner,id,bounded)) return { state: 'not-found' as const };
      await healthSqlQuery(new sql.Request(tx).input('owner',sql.UniqueIdentifier,this.owner).input('reference',sql.Char(64),id),
        'UPDATE daily.health_upload_capabilities SET revoked=1 WHERE owner_object_id=@owner AND token_hash=@reference;',bounded);
      return { state: 'revoked' as const };
    });
  }
  rotate(oldId: string,replacement: PreparedHealthCapability,signal: AbortSignal) {
    try { reference(oldId); } catch { throw new HealthCapabilityLifecycleError('invalid-input'); }
    const next = this.record(replacement);
    return this.mutate(signal,async (tx,bounded) => {
      const row = await readSqlHealthCapability(tx,this.owner,oldId,bounded);
      if (!row || oldId === replacement.reference) throw new HealthConflict();
      const old = sqlHealthCapability(row);
      if (old.deviceId !== next.deviceId || next.permissions.some(scope => !old.permissions.includes(scope))) throw new HealthConflict();
      if (row.replacement_reference !== null && row.replacement_reference !== replacement.reference) throw new HealthConflict();
      if (row.replacement_reference === null && (old.revoked || Date.parse(old.expiresAt) <= this.now())) throw new HealthConflict();
      await healthSqlQuery(new sql.Request(tx).input('owner',sql.UniqueIdentifier,this.owner).input('old',sql.Char(64),oldId).input('next',sql.Char(64),replacement.reference),
        'UPDATE daily.health_upload_capabilities SET revoked=1,replacement_reference=@next WHERE owner_object_id=@owner AND token_hash=@old;',bounded);
      const result = await this.issueRecord(tx,replacement,next,bounded);
      return { state: result.state === 'issued' ? 'rotated' as const : 'replacement-revoked' as const };
    });
  }
}
