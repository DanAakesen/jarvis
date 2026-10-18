import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import type { AlertClass, AlertLedgerRow, AlertLedgerStore, AlertLedgerWrite } from '../proactive/alert-ledger.js';

interface AlertRow {
  id: string;
  alert_key: string;
  class: AlertClass;
  item_id: string;
  run_id: string;
  day_key: string;
  status: AlertLedgerRow['status'];
  reason: string | null;
  attempts: number;
  updated_at: Date | string;
}

function mapRow(row: AlertRow): AlertLedgerRow {
  return {
    id: row.id.toLowerCase(),
    alertKey: row.alert_key,
    class: row.class,
    itemId: row.item_id.toLowerCase(),
    runId: row.run_id.toLowerCase(),
    dayKey: row.day_key,
    status: row.status,
    reason: row.reason,
    attempts: row.attempts,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
  };
}

function isUniqueIndexError(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'number' in error && ((error.number === 2601) || (error.number === 2627));
}

function writeRequest(pool: sql.ConnectionPool, ownerObjectId: string, input: AlertLedgerWrite) {
  return pool.request()
    .input('id', sql.UniqueIdentifier, randomUUID())
    .input('owner', sql.UniqueIdentifier, ownerObjectId)
    .input('alertKey', sql.Char(32), input.alertKey)
    .input('class', sql.NVarChar(32), input.class)
    .input('itemId', sql.UniqueIdentifier, input.itemId)
    .input('runId', sql.UniqueIdentifier, input.runId)
    .input('dayKey', sql.Char(10), input.dayKey)
    .input('status', sql.NVarChar(8), input.status)
    .input('reason', sql.NVarChar(64), input.reason);
}

const outputColumns = `inserted.id, inserted.alert_key, inserted.class, inserted.item_id,
  inserted.run_id, inserted.day_key, inserted.status, inserted.reason, inserted.attempts, inserted.updated_at`;

export function createProactiveAlertStore(pool: sql.ConnectionPool, ownerObjectId: string): AlertLedgerStore {
  const owner = ownerObjectId.toLowerCase();
  return {
    async get(alertKey) {
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('alertKey', sql.Char(32), alertKey)
        .query<AlertRow>(`SELECT id, alert_key, class, item_id, run_id, day_key, status, reason, attempts, updated_at
          FROM dbo.proactive_alerts WHERE owner_object_id = @owner AND alert_key = @alertKey;`);
      return recordset[0] ? mapRow(recordset[0]) : undefined;
    },
    async countSent(dayKey) {
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('dayKey', sql.Char(10), dayKey)
        .query<{ count: number }>(`SELECT COUNT(DISTINCT run_id) AS count FROM dbo.proactive_alerts
          WHERE owner_object_id = @owner AND day_key = @dayKey AND status = N'sent';`);
      return recordset[0]?.count ?? 0;
    },
    async upsert(input) {
      try {
        const { recordset } = await writeRequest(pool, owner, input).query<AlertRow>(`MERGE dbo.proactive_alerts WITH (HOLDLOCK) AS target
          USING (SELECT @owner AS owner_object_id, @alertKey AS alert_key) AS source
          ON target.owner_object_id = source.owner_object_id AND target.alert_key = source.alert_key
          WHEN MATCHED THEN UPDATE SET class = @class, item_id = @itemId, run_id = @runId,
            day_key = @dayKey, status = @status, reason = @reason,
            attempts = CASE WHEN target.attempts < 255 THEN target.attempts + 1 ELSE 255 END,
            updated_at = SYSUTCDATETIME()
          WHEN NOT MATCHED THEN INSERT
            (id, owner_object_id, alert_key, class, item_id, run_id, day_key, status, reason, attempts)
            VALUES (@id, @owner, @alertKey, @class, @itemId, @runId, @dayKey, @status, @reason, 1)
          OUTPUT ${outputColumns};`);
        if (!recordset[0]) throw new Error('Proactive alert ledger write returned no row');
        return mapRow(recordset[0]);
      } catch (error) {
        if (!isUniqueIndexError(error)) throw error;
        try {
          const { recordset } = await writeRequest(pool, owner, input).query<AlertRow>(`UPDATE dbo.proactive_alerts
            SET class = @class, item_id = @itemId, run_id = @runId, day_key = @dayKey,
              status = @status, reason = @reason,
              attempts = CASE WHEN attempts < 255 THEN attempts + 1 ELSE 255 END,
              updated_at = SYSUTCDATETIME()
            OUTPUT ${outputColumns}
            WHERE owner_object_id = @owner AND alert_key = @alertKey;`);
          if (recordset[0]) return mapRow(recordset[0]);
        } catch (retryError) {
          if (!isUniqueIndexError(retryError)) throw retryError;
        }
        const existing = await this.get(input.alertKey);
        if (existing) return existing;
        throw error;
      }
    },
  };
}
