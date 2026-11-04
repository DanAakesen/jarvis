import type sql from 'mssql';
import { SqlHealthBuffer } from './sql-buffer.js';
import { SqlHealthCapabilities } from './sql-capabilities.js';
import type { HealthUploadOptions } from './server.js';

/** Default-off wiring to the existing backend pool. Production composition requires explicit enablement. */
export function createSqlHealthUpload(pool: sql.ConnectionPool,configuredOwner: string): HealthUploadOptions {
  const capabilities = new SqlHealthCapabilities(pool,configuredOwner);
  return { enabled: false,buffer: new SqlHealthBuffer(pool,configuredOwner),verifier: capabilities.verify };
}
