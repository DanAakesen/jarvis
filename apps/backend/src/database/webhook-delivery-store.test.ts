import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createWebhookDeliveryStore } from './webhook-delivery-store.js';

describe('webhook delivery store', () => {
  it('uses a serialized insert and reports whether the delivery was first-seen', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowsAffected: [1] })
      .mockResolvedValueOnce({ rowsAffected: [0] });
    const request = { input: vi.fn().mockReturnThis(), query };
    const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
    const store = createWebhookDeliveryStore(pool);
    const input = { deliveryId: 'delivery-1', event: 'push', outcome: 'ok' as const };

    await expect(store.record(input)).resolves.toBe(true);
    await expect(store.record(input)).resolves.toBe(false);
    expect(request.input).toHaveBeenCalledWith('deliveryId', sql.NVarChar(100), input.deliveryId);
    expect(query.mock.calls[0]?.[0]).toContain('WITH (UPDLOCK, HOLDLOCK)');
  });
});
