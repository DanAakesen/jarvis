import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import type { OutreachStore } from '../proactive/events/outreach-store.js';
import type { ChannelOutcome, OutreachRecord } from '../proactive/events/types.js';

interface OutreachRow {
  id: string;
  tier: OutreachRecord['tier'];
  title: string;
  body: string;
  why: string;
  category: OutreachRecord['category'];
  event_ids_json: string;
  batch_id: string;
  item_id: string | null;
  delivery_json: string;
  pushed_at: Date | string | null;
  rating: OutreachRecord['rating'];
  rating_note: string | null;
  created_at: Date | string;
}

const columns = `id, tier, title, body, why, category, event_ids_json, batch_id, item_id, delivery_json,
  pushed_at, rating, rating_note, created_at`;

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function json<T>(text: string, fallback: T): T {
  try { return JSON.parse(text) as T; } catch { return fallback; }
}

function mapRow(row: OutreachRow): OutreachRecord {
  return {
    id: row.id.toLowerCase(), tier: row.tier, title: row.title, body: row.body, why: row.why, category: row.category,
    eventIds: json<string[]>(row.event_ids_json, []), batchId: row.batch_id.toLowerCase(),
    itemId: row.item_id?.toLowerCase() ?? null, delivery: json<ChannelOutcome[]>(row.delivery_json, []),
    pushedAt: row.pushed_at ? iso(row.pushed_at) : null, rating: row.rating, ratingNote: row.rating_note,
    createdAt: iso(row.created_at),
  };
}

export function createProactiveOutreachStore(pool: sql.ConnectionPool, ownerObjectId: string): OutreachStore {
  const owner = ownerObjectId.toLowerCase();
  return {
    async create({ decision, batchId, itemId }, now) {
      const { recordset } = await pool.request()
        .input('id', sql.UniqueIdentifier, randomUUID())
        .input('owner', sql.UniqueIdentifier, owner)
        .input('tier', sql.NVarChar(8), decision.tier)
        .input('title', sql.NVarChar(80), decision.title)
        .input('body', sql.NVarChar(400), decision.body)
        .input('why', sql.NVarChar(400), decision.why)
        .input('category', sql.NVarChar(32), decision.category)
        .input('events', sql.NVarChar(sql.MAX), JSON.stringify(decision.eventIds))
        .input('batch', sql.UniqueIdentifier, batchId)
        .input('item', sql.UniqueIdentifier, itemId)
        .input('createdAt', sql.DateTime2, now)
        .query<OutreachRow>(`INSERT dbo.proactive_outreach
            (id, owner_object_id, tier, title, body, why, category, event_ids_json, batch_id, item_id, created_at)
          OUTPUT ${columns.split(',').map((column) => `inserted.${column.trim()}`).join(', ')}
          VALUES (@id, @owner, @tier, @title, @body, @why, @category, @events, @batch, @item, @createdAt);`);
      return mapRow(recordset[0]!);
    },

    async recordDelivery(id, delivery, pushedAt) {
      await pool.request()
        .input('owner', sql.UniqueIdentifier, owner)
        .input('id', sql.UniqueIdentifier, id)
        .input('delivery', sql.NVarChar(sql.MAX), JSON.stringify(delivery))
        .input('pushedAt', sql.DateTime2, pushedAt)
        .query(`UPDATE dbo.proactive_outreach SET delivery_json = @delivery, pushed_at = @pushedAt
          WHERE owner_object_id = @owner AND id = @id;`);
    },

    async get(id) {
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('id', sql.UniqueIdentifier, id)
        .query<OutreachRow>(`SELECT ${columns} FROM dbo.proactive_outreach WHERE owner_object_id = @owner AND id = @id;`);
      return recordset[0] ? mapRow(recordset[0]) : undefined;
    },

    async recent(limit, since) {
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('since', sql.DateTime2, since)
        .input('limit', sql.Int, limit)
        .query<OutreachRow>(`SELECT TOP (@limit) ${columns} FROM dbo.proactive_outreach
          WHERE owner_object_id = @owner AND created_at >= @since ORDER BY created_at DESC;`);
      return recordset.map(mapRow);
    },

    async rate(id, rating, note) {
      const { recordset } = await pool.request()
        .input('owner', sql.UniqueIdentifier, owner)
        .input('id', sql.UniqueIdentifier, id)
        .input('rating', sql.NVarChar(8), rating)
        .input('note', sql.NVarChar(400), note)
        .query<OutreachRow>(`UPDATE dbo.proactive_outreach SET rating = @rating, rating_note = @note, rated_at = SYSUTCDATETIME()
          OUTPUT ${columns.split(',').map((column) => `inserted.${column.trim()}`).join(', ')}
          WHERE owner_object_id = @owner AND id = @id;`);
      return recordset[0] ? mapRow(recordset[0]) : undefined;
    },

    async rateByItem(itemId, rating) {
      const { recordset } = await pool.request()
        .input('owner', sql.UniqueIdentifier, owner)
        .input('item', sql.UniqueIdentifier, itemId)
        .input('rating', sql.NVarChar(8), rating)
        .query<{ changed: number }>(`UPDATE dbo.proactive_outreach SET rating = @rating, rated_at = SYSUTCDATETIME()
          WHERE owner_object_id = @owner AND item_id = @item;
          SELECT @@ROWCOUNT AS changed;`);
      return (recordset[0]?.changed ?? 0) > 0;
    },

    async pushesSince(since) {
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('since', sql.DateTime2, since)
        .query<{ count: number }>(`SELECT COUNT(*) AS count FROM dbo.proactive_outreach
          WHERE owner_object_id = @owner AND pushed_at >= @since;`);
      return recordset[0]?.count ?? 0;
    },
  };
}
