import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import type { ContainerClient } from '@azure/storage-blob';
import { healthPermissions,metadataLimit,opaqueId,ownerId,sha256,type HealthCapability,type HealthPermission } from './contracts.js';

/** Fixed diagnostics only. A failed/canceled mutation may already have committed. */
export class HealthCapabilityLifecycleError extends Error {
  readonly outcome = 'unknown';
  constructor(readonly code: 'invalid-input' | 'conflict' | 'unavailable' | 'canceled') { super(`Health capability operation ${code}`); }
}
const preparedRecords = new WeakMap<PreparedHealthCapability,HealthCapability>();
/** Retain this opaque operation across retries in a protected operator process.
 * JSON/inspection never exports the bearer or capability body. No secret channel is installed. */
export class PreparedHealthCapability {
  readonly #token: string;
  private constructor(record: HealthCapability) {
    this.#token = randomBytes(32).toString('base64url');
    preparedRecords.set(this,{ ...record,permissions: [...record.permissions] }); Object.freeze(this);
  }
  static prepare(record: HealthCapability): PreparedHealthCapability { return new PreparedHealthCapability(record); }
  get reference(): string { return sha256(this.#token); }
  async useSecret<T>(protectedConsumer: (secret: string) => Promise<T>): Promise<T> {
    try { return await protectedConsumer(this.#token); } catch { throw new HealthCapabilityLifecycleError('unavailable'); }
  }
  toJSON() { return { type: 'prepared-health-capability',secret: 'redacted' }; }
  toString() { return '[prepared-health-capability: redacted]'; }
  [inspect.custom]() { return this.toString(); }
}
type Rotation = { version: 1; ownerObjectId: string; oldReference: string; replacementReference: string; replacement: HealthCapability };
function httpStatus(error: unknown): number | undefined { return (error as { statusCode?: number })?.statusCode; }
function reference(value: string) { if (!/^[a-f0-9]{64}$/u.test(value)) throw new HealthCapabilityLifecycleError('invalid-input'); return value; }
function sameOwner(value: unknown,expected: string) {
  try { return typeof value === 'string' && ownerId(value) === ownerId(expected); } catch { return false; }
}
function exact(left: HealthCapability,right: HealthCapability,ignoreRevocation = false) {
  return left.version === right.version && sameOwner(left.ownerObjectId,right.ownerObjectId) && left.deviceId === right.deviceId && left.expiresAt === right.expiresAt &&
    (ignoreRevocation || left.revoked === right.revoked) && left.permissions.length === right.permissions.length && left.permissions.every((scope,i) => scope === right.permissions[i]);
}
/** Separate injected write client; never composed into the read-only upload host. */
export class HealthCapabilityLifecycle {
  readonly #owner: string;
  constructor(private readonly container: ContainerClient,configuredOwner: string,private readonly now: () => number = Date.now) { this.#owner = ownerId(configuredOwner); }
  prepare(input: { deviceId: string; permissions: HealthPermission[]; expiresAt: string }): PreparedHealthCapability {
    try {
      if (Object.keys(input).some(key => !['deviceId','permissions','expiresAt'].includes(key))) throw new Error();
      const row = this.validate({ version: 1,ownerObjectId: this.#owner,...input,revoked: false });
      if (Date.parse(row.expiresAt) <= this.now() || new Date(row.expiresAt).toISOString() !== row.expiresAt) throw new Error();
      return PreparedHealthCapability.prepare(row);
    } catch { throw new HealthCapabilityLifecycleError('invalid-input'); }
  }
  private validate(value: unknown): HealthCapability {
    const row = value as HealthCapability;
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== 6 ||
        Object.keys(row).some(key => !['version','ownerObjectId','deviceId','permissions','expiresAt','revoked'].includes(key)) || row.version !== 1 ||
        !sameOwner(row.ownerObjectId,this.#owner) || typeof row.revoked !== 'boolean' || !Array.isArray(row.permissions) || row.permissions.length < 1 || row.permissions.length > 2 ||
        new Set(row.permissions).size !== row.permissions.length || row.permissions.some(scope => !healthPermissions.includes(scope)) ||
        typeof row.expiresAt !== 'string' || row.expiresAt.length > 128 || !Number.isFinite(Date.parse(row.expiresAt))) throw new HealthCapabilityLifecycleError('conflict');
    try { opaqueId(row.deviceId,256); } catch { throw new HealthCapabilityLifecycleError('conflict'); }
    return { version: 1,ownerObjectId: row.ownerObjectId,deviceId: row.deviceId,permissions: [...row.permissions],expiresAt: row.expiresAt,revoked: row.revoked };
  }
  private record(operation: PreparedHealthCapability) {
    const row = preparedRecords.get(operation);
    if (!row || row.revoked !== false) throw new HealthCapabilityLifecycleError('invalid-input');
    return this.validate(row);
  }
  private async read(name: string,signal: AbortSignal): Promise<{ value: unknown; etag: string } | null> {
    const blob = this.container.getBlobClient(name);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const properties = await blob.getProperties({ abortSignal: signal });
        if (!properties.etag || !properties.contentLength || properties.contentLength > metadataLimit) throw new HealthCapabilityLifecycleError('conflict');
        const bytes = await blob.downloadToBuffer(0,properties.contentLength,{ abortSignal: signal,conditions: { ifMatch: properties.etag } });
        if (bytes.length !== properties.contentLength) throw new HealthCapabilityLifecycleError('conflict');
        return { value: JSON.parse(new TextDecoder('utf-8',{ fatal: true }).decode(bytes)),etag: properties.etag };
      } catch (error) { if (httpStatus(error) === 404) return null; if (httpStatus(error) === 412 && attempt < 2) continue; throw error; }
    }
    throw new HealthCapabilityLifecycleError('unavailable');
  }
  private async bounded<T>(signal: AbortSignal,action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const bounded = AbortSignal.any([signal,AbortSignal.timeout(20000)]);
    try {
      bounded.throwIfAborted();
      const properties = await this.container.getProperties({ abortSignal: bounded });
      if (properties.blobPublicAccess !== undefined) throw new HealthCapabilityLifecycleError('unavailable');
      return await action(bounded);
    } catch (error) {
      if (bounded.aborted) throw new HealthCapabilityLifecycleError('canceled');
      if (error instanceof HealthCapabilityLifecycleError) throw error;
      throw new HealthCapabilityLifecycleError('unavailable');
    }
  }
  private async issueRecord(operation: PreparedHealthCapability,signal: AbortSignal) {
    const row = this.record(operation); const name = `health-devices/${operation.reference}.json`;
    if (Date.parse(row.expiresAt) <= this.now()) throw new HealthCapabilityLifecycleError('invalid-input');
    try {
      await this.container.getBlockBlobClient(name).uploadData(Buffer.from(JSON.stringify(row)),{
        abortSignal: signal,conditions: { ifNoneMatch: '*' },blobHTTPHeaders: { blobContentType: 'application/json' } });
      return { state: 'issued' as const };
    } catch (error) {
      if (![409,412].includes(httpStatus(error) ?? 0)) throw error;
      const existing = await this.read(name,signal);
      if (!existing || !exact(this.validate(existing.value),row,true)) throw new HealthCapabilityLifecycleError('conflict');
      return { state: this.validate(existing.value).revoked ? 'revoked' as const : 'issued' as const };
    }
  }
  issue(operation: PreparedHealthCapability,signal: AbortSignal) { return this.bounded(signal,bounded => this.issueRecord(operation,bounded)); }
  private async revokeRecord(id: string,signal: AbortSignal) {
    const name = `health-devices/${reference(id)}.json`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = await this.read(name,signal);
      if (!existing) return { state: 'not-found' as const };
      const row = this.validate(existing.value);
      if (row.revoked) return { state: 'revoked' as const };
      try {
        await this.container.getBlockBlobClient(name).uploadData(Buffer.from(JSON.stringify({ ...row,revoked: true })),{
          abortSignal: signal,conditions: { ifMatch: existing.etag },blobHTTPHeaders: { blobContentType: 'application/json' } });
        return { state: 'revoked' as const };
      } catch (error) { if (httpStatus(error) === 412 && attempt < 2) continue; throw error; }
    }
    throw new HealthCapabilityLifecycleError('unavailable');
  }
  revoke(id: string,signal: AbortSignal) { reference(id); return this.bounded(signal,bounded => this.revokeRecord(id,bounded)); }
  /** A durable reservation permits only one replacement per old reference. Revoke first:
   * availability gap is intentional; no atomic exchange or exactly-once secret handoff. */
  rotate(oldId: string,replacement: PreparedHealthCapability,signal: AbortSignal) {
    reference(oldId);
    return this.bounded(signal,async bounded => {
      const next = this.record(replacement);
      if (Date.parse(next.expiresAt) <= this.now()) throw new HealthCapabilityLifecycleError('invalid-input');
      const journalName = `health-device-rotations/${oldId}.json`;
      const previous = await this.read(`health-devices/${oldId}.json`,bounded);
      if (!previous) throw new HealthCapabilityLifecycleError('conflict');
      const old = this.validate(previous.value);
      if (old.deviceId !== next.deviceId || next.permissions.some(scope => !old.permissions.includes(scope)) || oldId === replacement.reference) throw new HealthCapabilityLifecycleError('conflict');
      const reservation: Rotation = { version: 1,ownerObjectId: this.#owner,oldReference: oldId,replacementReference: replacement.reference,replacement: next };
      const existingJournal = await this.read(journalName,bounded);
      if (!existingJournal) {
        if (old.revoked || Date.parse(old.expiresAt) <= this.now()) throw new HealthCapabilityLifecycleError('conflict');
        try { await this.container.getBlockBlobClient(journalName).uploadData(Buffer.from(JSON.stringify(reservation)),{
          abortSignal: bounded,conditions: { ifNoneMatch: '*' },blobHTTPHeaders: { blobContentType: 'application/json' } });
        } catch (error) { if (![409,412].includes(httpStatus(error) ?? 0)) throw error; }
      }
      const saved = await this.read(journalName,bounded); const row = saved?.value as Rotation;
      if (!row || Object.keys(row).length !== 5 || Object.keys(row).some(key => !['version','ownerObjectId','oldReference','replacementReference','replacement'].includes(key)) ||
          row.version !== 1 || !sameOwner(row.ownerObjectId,this.#owner) || row.oldReference !== oldId || row.replacementReference !== replacement.reference || !exact(this.validate(row.replacement),next)) throw new HealthCapabilityLifecycleError('conflict');
      if ((await this.revokeRecord(oldId,bounded)).state !== 'revoked') throw new HealthCapabilityLifecycleError('conflict');
      const result = await this.issueRecord(replacement,bounded);
      return { state: result.state === 'issued' ? 'rotated' as const : 'replacement-revoked' as const };
    });
  }
}
