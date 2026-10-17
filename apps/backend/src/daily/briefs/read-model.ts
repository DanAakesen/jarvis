import type { FastifyRequest } from 'fastify';
import sql from 'mssql';
import { resolveDailyOwner } from '../owner.js';
import { healthSqlQuery } from '../health-upload/sql-transaction.js';
import { dailyResultByteLimit } from '../records.js';
import { AuthenticationDenied } from '../../auth/verify.js';

export const briefMetadataFields = ['id', 'trigger', 'started_at', 'completed_at', 'status',
  'health_status', 'delivery_status', 'delivered_at', 'updated_at'] as const;
export const briefDetailFields = [...briefMetadataFields, 'preview_text', 'body_json'] as const;
export interface BriefCursor { startedAt: string; id: string }
function id(value: string) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) throw new TypeError('Invalid brief ID');
  return value;
}

/** Historical reads only. No brief generation, delivery, schedules or provider snapshots. */
export class DailyBriefReadModel {
  private constructor(private readonly pool: sql.ConnectionPool, private readonly owner: string) {}
  static forRequest(pool: sql.ConnectionPool, request: FastifyRequest) {
    if (request.dailyConnectorPrincipal) throw new AuthenticationDenied(403);
    return new DailyBriefReadModel(pool, resolveDailyOwner(request));
  }
  async history(options: { limit?: number; after?: BriefCursor }, signal: AbortSignal) {
    const limit = options.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Invalid brief page limit');
    if (options.after) {
      id(options.after.id);
      if (typeof options.after.startedAt !== 'string' || options.after.startedAt.length > 64) throw new TypeError('Invalid brief cursor');
    }
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
    bounded.throwIfAborted();
    const request = this.pool.request().input('owner', sql.UniqueIdentifier, this.owner).input('limit', sql.Int, limit + 1)
      .input('started', sql.NVarChar(64), options.after?.startedAt ?? null)
      .input('id', sql.NVarChar(256), options.after?.id ?? null);
    const rows = (await healthSqlQuery(request, `SELECT TOP(@limit) ${briefMetadataFields.map(field => `[${field}]`).join(',')}
      FROM daily.briefing_runs WHERE owner_object_id=@owner
        AND (@started IS NULL OR started_at<@started OR (started_at=@started AND id<@id))
      ORDER BY started_at DESC,id DESC;`, bounded)).recordset;
    bounded.throwIfAborted();
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    if (items.some(row => typeof row.id !== 'string' || !row.id.length || row.id.length > 256 ||
        typeof row.started_at !== 'string' || row.started_at.length > 64)) throw new TypeError('Stored brief identity is unavailable');
    return { items, next: rows.length > limit && last ? { startedAt: String(last.started_at), id: String(last.id) } : null };
  }
  async detail(briefId: string, signal: AbortSignal) {
    id(briefId);
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
    bounded.throwIfAborted();
    const request = this.pool.request().input('owner', sql.UniqueIdentifier, this.owner)
      .input('id', sql.NVarChar(256), briefId);
    const bytes = dailyResultByteLimit * 2;
    const row = (await healthSqlQuery(request, `SELECT ${briefMetadataFields.map(field => `[${field}]`).join(',')},
      CASE WHEN DATALENGTH(preview_text)<=${bytes} THEN preview_text ELSE NULL END AS preview_text,
      CASE WHEN DATALENGTH(body_json)<=${bytes} THEN body_json ELSE NULL END AS body_json,
      CASE WHEN DATALENGTH(preview_text)>${bytes} OR DATALENGTH(body_json)>${bytes} THEN 1 ELSE 0 END AS oversized
      FROM daily.briefing_runs WHERE owner_object_id=@owner AND id=@id AND DATALENGTH(id)=DATALENGTH(@id);`, bounded)).recordset[0];
    bounded.throwIfAborted();
    if (row?.oversized) throw new TypeError('Stored brief exceeds the read budget');
    return row ?? null;
  }
}
