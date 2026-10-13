import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import { sha256,type HealthCapability } from './contracts.js';

/** Fixed diagnostics only. A failed/canceled mutation may already have committed. */
export class HealthCapabilityLifecycleError extends Error {
  readonly outcome = 'unknown';
  constructor(readonly code: 'invalid-input' | 'conflict' | 'unavailable' | 'canceled') { super(`Health capability operation ${code}`); }
}
const records = new WeakMap<PreparedHealthCapability,HealthCapability>();
/** Retain this operation across retries in the protected operator process.
 * Inspection/JSON never exports a bearer. No delivery channel is installed. */
export class PreparedHealthCapability {
  readonly #token: string;
  private constructor(record: HealthCapability) {
    this.#token = randomBytes(32).toString('base64url');
    records.set(this,{ ...record,permissions: [...record.permissions] }); Object.freeze(this);
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
/** Internal lifecycle metadata, not the bearer. The caller must validate its owner. */
export function preparedHealthRecord(operation: PreparedHealthCapability): HealthCapability | undefined {
  const record = records.get(operation);
  return record ? { ...record,permissions: [...record.permissions] } : undefined;
}
