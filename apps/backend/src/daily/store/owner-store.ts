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
  async read(table: DailyTable, key: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<Record<string, unknown> | null> {
    if (!Object.hasOwn(dailyTables, table)) throw new TypeError('Invalid Daily table');
    const definition = dailyTables[table];
    if (Object.keys(key).length !== definition.keys.length ||
        !definition.keys.every((column) => Object.hasOwn(key, column))) throw new TypeError('Invalid Daily key');
    const metadata = definition.keyTypes as Readonly<Record<string, {
      type: 'text' | 'date' | 'bigint'; maxLength?: number;
    }>>;
    // Validate all key shapes before allocating/executing a database request.
    const bindings = definition.keys.map((column, index) => {
      const value = key[column];
      const field = metadata[column]!;
      if (field.type === 'text') {
        if (typeof value !== 'string' || value.length > field.maxLength!) throw new TypeError('Invalid Daily text key');
        return { column, index, type: sql.NVarChar(field.maxLength!), value, exactText: true };
      }
      if (field.type === 'date') {
        if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(value) || value.startsWith('0000-')) {
          throw new TypeError('Invalid Daily date key');
        }
        const date = new Date(`${value}T00:00:00.000Z`);
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new TypeError('Invalid Daily date key');
        return { column, index, type: sql.Date, value: date, exactText: false };
      }
      if (!(typeof value === 'bigint' || typeof value === 'number' && Number.isSafeInteger(value) ||
          typeof value === 'string' && value.length <= 20 && /^(?:0|-?[1-9][0-9]*)$/u.test(value))) throw new TypeError('Invalid Daily integer key');
      const integer = BigInt(value as string | number | bigint);
      if (integer < -9223372036854775808n || integer > 9223372036854775807n) throw new TypeError('Invalid Daily integer key');
      return { column, index, type: sql.BigInt, value: integer, exactText: false };
    });
    const request = this.pool.request().input('owner', sql.UniqueIdentifier, this.owner);
    const filters = ['owner_object_id = @owner'];
    for (const binding of bindings) {
      request.input(`key${binding.index}`, binding.type, binding.value);
      filters.push(`[${binding.column}] = @key${binding.index}`);
      // SQL equality pads text: the byte-length predicate prevents matching another
      // legacy ID for a request with different trailing spaces. Never trim IDs.
      if (binding.exactText) filters.push(`DATALENGTH([${binding.column}]) = DATALENGTH(@key${binding.index})`);
    }
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
