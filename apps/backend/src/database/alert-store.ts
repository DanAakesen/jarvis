import sql from 'mssql';
import type { ActivityAlert } from '../alerts.js';

export async function insertActivityAlert(
  transaction: sql.Transaction, alert: ActivityAlert, dedupePrefix?: string,
): Promise<boolean> {
  const { recordset } = await new sql.Request(transaction)
    .input('kind', sql.NVarChar(64), alert.type)
    .input('title', sql.NVarChar(400), alert.title)
    .input('link', sql.NVarChar(100), alert.link)
    .input('dedupeKey', sql.NVarChar(200), alert.dedupeKey)
    .input('dedupePrefix', sql.NVarChar(200), dedupePrefix ?? null)
    .query<{ id: string }>(`INSERT dbo.activity (area, kind, title, link, alert_key)
      OUTPUT CAST(inserted.id AS varchar(19)) AS id
      SELECT N'operations', @kind, @title, @link, @dedupeKey
      WHERE NOT EXISTS (
        SELECT 1 FROM dbo.activity WITH (UPDLOCK, HOLDLOCK)
        WHERE alert_key = @dedupeKey OR (
          @dedupePrefix IS NOT NULL AND alert_key LIKE @dedupePrefix + N'%'
          AND at > DATEADD(hour, -1, SYSUTCDATETIME())
        )
      );`);
  return recordset.length > 0;
}

export interface AlertActivityStore {
  record(alert: ActivityAlert): Promise<boolean>;
}

export function createAlertActivityStore(
  pool: sql.ConnectionPool,
  onCreated: () => void,
): AlertActivityStore {
  return {
    async record(alert) {
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        const inserted = await insertActivityAlert(transaction, alert);
        await transaction.commit();
        if (inserted) onCreated();
        return inserted;
      } catch (error) {
        await transaction.rollback().catch(() => undefined);
        throw error;
      }
    },
  };
}
