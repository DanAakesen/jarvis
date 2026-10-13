import type sql from 'mssql';
import { SqlHealthBuffer } from './sql-buffer.js';
import { SqlHealthCapabilities } from './sql-capabilities.js';
import type { HealthUploadOptions } from './server.js';

/** Rehearsal-only wiring to the existing backend pool. The caller must explicitly opt in.
 * No environment flag, pool creation, credential provisioning or production index registration. */
export function createSqlHealthUpload(pool: sql.ConnectionPool,configuredOwner: string): HealthUploadOptions {
  const capabilities = new SqlHealthCapabilities(pool,configuredOwner);
  return { enabled: false,buffer: new SqlHealthBuffer(pool,configuredOwner),verifier: capabilities.verify };
}
