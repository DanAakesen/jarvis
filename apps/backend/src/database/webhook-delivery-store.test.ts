import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createWebhookDeliveryStore } from './webhook-delivery-store.js';

describe('webhook delivery store', () => {
  it('inserts new deliveries and reports first-seen status', async () => {
    const query = vi.fn().mockResolvedValue({ rowsAffected: [1] });
    const request = { input: vi.fn().mockReturnThis(), query };
    const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
    const store = createWebhookDeliveryStore(pool);
    const input = { deliveryId: 'delivery-1', event: 'push', outcome: 'ok' as const };

    await expect(store.record(input)).resolves.toBe(true);
    expect(request.input).toHaveBeenCalledWith('deliveryId', sql.NVarChar(100), input.deliveryId);
    expect(query.mock.calls[0]?.[0]).toContain('INSERT INTO dbo.webhook_deliveries');
  });

  it.each([2601, 2627])('reports SQL Server duplicate-key error %i as already recorded', async (number) => {
    const query = vi.fn().mockRejectedValue({ number });
    const request = { input: vi.fn().mockReturnThis(), query };
    const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
    const store = createWebhookDeliveryStore(pool);

    await expect(store.record({ deliveryId: 'delivery-1', event: 'push', outcome: 'ok' })).resolves.toBe(false);
  });

  it('does not hide non-duplicate database errors', async () => {
    const error = { number: 1205 };
    const query = vi.fn().mockRejectedValue(error);
    const request = { input: vi.fn().mockReturnThis(), query };
    const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
    const store = createWebhookDeliveryStore(pool);

    await expect(store.record({ deliveryId: 'delivery-1', event: 'push', outcome: 'ok' })).rejects.toBe(error);
  });
});
