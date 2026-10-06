import type sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createAwayModeStore } from './away-mode-store.js';

describe('SQL away-mode store', () => {
  it('skips SQL when a cached presence observation leaves state unchanged', async () => {
    const state = {
      away: false,
      source: null,
      changedAt: null,
      presenceAwaySince: '2026-10-06T12:00:00.000Z',
    };
    const query = vi.fn(async () => ({ recordset: [{ value: JSON.stringify(state) }] }));
    const request = { input: vi.fn(), query };
    request.input.mockReturnValue(request);
    const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
    const store = createAwayModeStore(pool);

    await store.read();
    await expect(store.observePresence(true, new Date('2026-10-06T12:01:00.000Z'))).resolves.toEqual(state);

    expect(pool.request).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledOnce();
  });
});
