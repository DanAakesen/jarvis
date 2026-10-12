import sql from 'mssql';
import type { FastifyRequest } from 'fastify';
import { resolveDailyOwner } from '../owner.js';
import { dailyTables, type DailyTable } from './schema.js';

/** Inactive persistence boundary. Construct only after existing root authentication. */
export class DailyOwnerStore {
  private constructor(private readonly pool: sql.ConnectionPool, private readonly owner: string) {}

  static forRequest(pool: sql.ConnectionPool, request: FastifyRequest): DailyOwnerStore {
    return new DailyOwnerStore(pool, resolveDailyOwner(request));
  }

  /** Exact legacy key lookup. Caller cannot select an owner, email, column or SQL path. */
  async read(table: DailyTable, key: Readonly<Record<string, string | number>>, signal: AbortSignal): Promise<Record<string, unknown> | null> {
    if (!Object.hasOwn(dailyTables, table)) throw new TypeError('Invalid Daily table');
    const definition = dailyTables[table];
    if (Object.keys(key).length !== definition.keys.length ||
        !definition.keys.every((column) => Object.hasOwn(key, column))) throw new TypeError('Invalid Daily key');
    const request = this.pool.request().input('owner', sql.UniqueIdentifier, this.owner);
    const filters = ['owner_object_id = @owner'];
    definition.keys.forEach((column, index) => {
      const value = key[column];
      if (typeof value === 'number') {
        if (!Number.isSafeInteger(value)) throw new TypeError('Invalid Daily key');
        request.input(`key${index}`, sql.BigInt, value);
      } else {
        if (typeof value !== 'string' || value.length === 0 || value.length > 256) throw new TypeError('Invalid Daily key');
        request.input(`key${index}`, sql.NVarChar(256), value);
      }
      filters.push(`[${column}] = @key${index}`);
    });
    const cancel = () => request.cancel();
    signal.addEventListener('abort', cancel, { once: true });
    try {
      signal.throwIfAborted();
      // Tombstones and null unknowns are deliberately returned unchanged.
      const result = await request.query(`SELECT ${definition.columns.map((column) => `[${column}]`).join(', ')}
        FROM daily.[${table}] WHERE ${filters.join(' AND ')};`);
      signal.throwIfAborted();
      return result.recordset[0] ?? null;
    } finally { signal.removeEventListener('abort', cancel); }
  }
}
