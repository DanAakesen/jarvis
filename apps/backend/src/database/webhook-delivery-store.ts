import sql from 'mssql';
import type { WebhookDeliveryStore } from '../github/webhook-delivery.js';

export function createWebhookDeliveryStore(pool: sql.ConnectionPool): WebhookDeliveryStore {
  return {
    async record({ deliveryId, event, outcome }) {
      try {
        const { rowsAffected } = await pool.request()
          .input('deliveryId', sql.NVarChar(100), deliveryId)
          .input('event', sql.NVarChar(64), event)
          .input('outcome', sql.NVarChar(8), outcome)
          .query(`DECLARE @receivedAt datetime2(7) = SYSUTCDATETIME();
            INSERT INTO dbo.webhook_deliveries (delivery_id, event, received_at, processed_at, outcome)
            VALUES (@deliveryId, @event, @receivedAt, @receivedAt, @outcome);`);
        return (rowsAffected[0] ?? 0) === 1;
      } catch (error) {
        const number = (error as { number?: unknown }).number;
        if (number === 2601 || number === 2627) return false;
        throw error;
      }
    },
  };
}
